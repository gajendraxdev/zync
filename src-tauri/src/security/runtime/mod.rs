//! Optional authenticated observers stay native, run-bound and limited to fixed loopback targets.
mod catalog;
mod http;
mod mysql;
mod postgres;
mod redis;
mod transport;

use super::{
    facts::{Fact, Facts},
    jobs::Lease,
    modules::ModuleId,
};
pub(in crate::security) use catalog::{evaluate, keys, rules, Check};
use serde::Deserialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;
use zeroize::{Zeroize, ZeroizeOnDrop};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub(crate) enum RuntimeKind {
    Postgresql,
    Mysql,
    Redis,
    Jenkins,
}

impl RuntimeKind {
    /// Public credential kinds and compiled module IDs have a fixed one-to-one mapping.
    pub(in crate::security) fn module_id(self) -> &'static str {
        match self {
            Self::Postgresql => "postgres-runtime",
            Self::Mysql => "mysql-runtime",
            Self::Redis => "redis-runtime",
            Self::Jenkins => "jenkins-runtime",
        }
    }
    /// A separate fact prevents one application's failed authentication from validating another.
    fn key(self) -> &'static str {
        match self {
            Self::Postgresql => "pg_runtime",
            Self::Mysql => "mysql_runtime",
            Self::Redis => "redis_runtime",
            Self::Jenkins => "jenkins_runtime",
        }
    }
}

/// Secrets intentionally have neither Debug nor Serialize and are erased on owned-input drop.
#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct RuntimeCredential {
    #[zeroize(skip)]
    pub kind: RuntimeKind,
    #[zeroize(skip)]
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub database: String,
    pub secret: String,
}

/// Fail before connecting if credentials do not describe exactly the explicitly selected observers.
pub(in crate::security) fn validate_credentials(
    credentials: &[RuntimeCredential],
    selected: &[ModuleId],
) -> Result<(), String> {
    let expected: BTreeSet<_> = selected
        .iter()
        .map(|id| id.as_str())
        .filter(|id| id.ends_with("-runtime"))
        .collect();
    let mut actual = BTreeSet::new();
    for credential in credentials {
        let text_valid = |value: &str, limit: usize, required: bool| {
            (!required || !value.is_empty())
                && value.len() <= limit
                && !value.chars().any(|ch| ch.is_control())
        };
        if !actual.insert(credential.kind.module_id())
            || !expected.contains(credential.kind.module_id())
        {
            return Err(
                "Provide one connection only for each selected application policy check.".into(),
            );
        }
        let user_required = credential.kind != RuntimeKind::Redis;
        let secret_required = matches!(credential.kind, RuntimeKind::Mysql | RuntimeKind::Jenkins);
        if credential.port == 0
            || !text_valid(&credential.username, 128, user_required)
            || !text_valid(&credential.database, 128, false)
            || !text_valid(&credential.secret, 4096, secret_required)
            || (credential.kind == RuntimeKind::Jenkins && credential.username.contains(':'))
        {
            return Err("Enter a valid local application port, username and credential without control characters.".into());
        }
        if credential.kind == RuntimeKind::Postgresql && credential.database.is_empty() {
            return Err("Enter the PostgreSQL database used for this read-only connection.".into());
        }
        if credential.kind == RuntimeKind::Mysql && credential.secret.len() > 79 {
            return Err("This MySQL client observer cannot safely handle credentials longer than 79 UTF-8 bytes. Keep your password unchanged and use the service checks instead.".into());
        }
    }
    if actual != expected {
        return Err(
            "Configure a read-only connection for each selected application policy check.".into(),
        );
    }
    Ok(())
}

/// A stable non-secret observer identity prevents comparisons across different local app endpoints/accounts.
fn context_key(credential: &RuntimeCredential) -> String {
    let mut hash = Sha256::new();
    for value in [
        credential.kind.module_id(),
        &credential.port.to_string(),
        &credential.username,
        &credential.database,
    ] {
        hash.update((value.len() as u64).to_be_bytes());
        hash.update(value.as_bytes());
    }
    super::policy::hex_digest(hash.finalize().as_slice())
}

/// Build only inert allowlisted values and a generic failure code, never client errors or credentials.
fn envelope(
    credential: &RuntimeCredential,
    result: Result<Map<String, Value>, &'static str>,
) -> String {
    let mut value = Map::new();
    value.insert("version".into(), 1.into());
    value.insert("targetKey".into(), context_key(credential).into());
    match result {
        Ok(values) => {
            value.insert("values".into(), values.into());
        }
        Err(error) => {
            value.insert("error".into(), error.into());
        }
    }
    Value::Object(value).to_string()
}

/// Run observers serially under the existing admission/lease, without detached connection pools or retries.
pub(in crate::security) async fn collect(
    lease: &Lease<'_>,
    credentials: &[RuntimeCredential],
) -> Result<Facts, String> {
    let mut result = BTreeMap::new();
    for credential in credentials {
        let mut cancel = lease.cancel.clone();
        let work = async {
            match credential.kind {
                RuntimeKind::Postgresql => postgres::collect(lease, credential).await,
                RuntimeKind::Mysql => mysql::collect(lease, credential).await,
                RuntimeKind::Redis => redis::collect(lease, credential).await,
                RuntimeKind::Jenkins => http::collect(lease, credential).await,
            }
        };
        tokio::pin!(work);
        let values = tokio::select! { biased;
            _=async {let _=cancel.wait_for(|value|*value).await;}=>{
                // Dedicated exec readers observe the same cancellation and can close their channel;
                // raw protocol drivers remain drop/abort-owned if their operation cannot finish.
                let _=tokio::time::timeout(Duration::from_secs(2),&mut work).await;
                return Err("Assessment cancelled. No application result was published.".into());
            },
            value=tokio::time::timeout(Duration::from_secs(25),&mut work)=>value.unwrap_or(Err("timeout")),
        };
        result.insert(
            credential.kind.key().to_string(),
            Fact {
                output: envelope(credential, values),
                status: 0,
            },
        );
    }
    Ok(Facts(result))
}

/// Only a validated fixed-length digest is exposed to comparison code; endpoint/account strings stay private.
pub(in crate::security) fn target_key(facts: &Facts, module_id: &str) -> Option<String> {
    let key = keys(module_id).first()?;
    let source: Value = serde_json::from_str(facts.get(key)?).ok()?;
    let key = source.get("targetKey")?.as_str()?;
    (key.len() == 71
        && key.starts_with("sha256:")
        && key[7..].bytes().all(|byte| byte.is_ascii_hexdigit()))
    .then(|| key.into())
}

#[cfg(test)]
mod qualification_tests;
#[cfg(test)]
mod tests;
