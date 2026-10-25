//! Compiled assessment scopes: selection controls collection as well as evaluation.
pub(super) mod applications;
pub(super) mod ssh_policy;
pub(super) mod system;
#[cfg(test)]
mod tests;
pub(super) mod workloads;

use super::{
    catalog::{RuleDefinition, RULES},
    facts::{Facts, HARDENING_KEYS},
    hardening::Outcome,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ModuleId {
    Host,
    ExtendedHost,
    SshPolicy,
    Nginx,
    Apache,
    Docker,
    DockerWorkloads,
    Postgresql,
    Mysql,
    Redis,
    Jenkins,
    PostgresRuntime,
    MysqlRuntime,
    RedisRuntime,
    JenkinsRuntime,
}

/// Canonical order makes collector envelopes deterministic regardless of checkbox order.
const ORDER: &[ModuleId] = &[
    ModuleId::Host,
    ModuleId::ExtendedHost,
    ModuleId::SshPolicy,
    ModuleId::Nginx,
    ModuleId::Apache,
    ModuleId::Docker,
    ModuleId::DockerWorkloads,
    ModuleId::Postgresql,
    ModuleId::Mysql,
    ModuleId::Redis,
    ModuleId::Jenkins,
    ModuleId::PostgresRuntime,
    ModuleId::MysqlRuntime,
    ModuleId::RedisRuntime,
    ModuleId::JenkinsRuntime,
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleDefinition {
    pub id: ModuleId,
    pub label: &'static str,
    pub description: &'static str,
    pub group: &'static str,
    pub check_count: usize,
    pub recommended: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth: Option<ApplicationAccess>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_limit: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_label: Option<&'static str>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationAccess {
    pub kind: &'static str,
    pub default_port: u16,
    pub username_required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_database: Option<&'static str>,
    pub secret_label: &'static str,
    pub max_secret_bytes: usize,
    pub secret_required: bool,
}

pub(super) enum ExtraResult {
    Available {
        value: String,
        observed: String,
        outcome: Outcome,
    },
    Unavailable,
    UnavailableAt(&'static str),
    UnavailableWith {
        reason: &'static str,
        next_step: &'static str,
    },
    NotApplicable(&'static str),
}

impl ModuleId {
    /// Stable public IDs are data, never command names or remote paths.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Host => "host",
            Self::ExtendedHost => "extended-host",
            Self::SshPolicy => "ssh-policy",
            Self::Nginx => "nginx",
            Self::Apache => "apache",
            Self::Docker => "docker",
            Self::DockerWorkloads => "docker-workloads",
            Self::Postgresql => "postgresql",
            Self::Mysql => "mysql",
            Self::Redis => "redis",
            Self::Jenkins => "jenkins",
            Self::PostgresRuntime => "postgres-runtime",
            Self::MysqlRuntime => "mysql-runtime",
            Self::RedisRuntime => "redis-runtime",
            Self::JenkinsRuntime => "jenkins-runtime",
        }
    }
    /// Metadata and counts share the native rule catalog used for the actual run.
    pub fn definition(self) -> ModuleDefinition {
        let (label, description) = match self {
            Self::Host => (
                "Host baseline",
                "Kernel, SSH, accounts, files, network and maintenance",
            ),
            Self::ExtendedHost => (
                "Additional host protections",
                "Account hygiene, audit, isolation and runtime controls",
            ),
            Self::SshPolicy => (
                "SSH connection-policy preview",
                "Current standard config with captured connection inputs",
            ),
            Self::Nginx => (
                "Nginx",
                "Standard service protections and named configuration files",
            ),
            Self::Apache => ("Apache", "Standard service-unit protections"),
            Self::Docker => (
                "Docker Engine",
                "Local daemon observations, socket and service protections",
            ),
            Self::DockerWorkloads => (
                "Docker containers",
                "Security settings for a bounded sample of running containers",
            ),
            Self::Postgresql => (
                "PostgreSQL",
                "Standard service-unit protections; database policy is not checked",
            ),
            Self::Mysql => (
                "MySQL",
                "Standard mysql.service protections; database policy is not checked",
            ),
            Self::Redis => (
                "Redis",
                "Standard service protections and named configuration settings",
            ),
            Self::Jenkins => (
                "Jenkins",
                "Standard service-unit protections; job and authorization policy is not checked",
            ),
            Self::PostgresRuntime => (
                "PostgreSQL policy",
                "Read selected runtime settings and authentication declarations",
            ),
            Self::MysqlRuntime => (
                "MySQL policy",
                "Read selected server transport and access settings",
            ),
            Self::RedisRuntime => (
                "Redis policy",
                "Read selected runtime settings and simulate limited permission checks",
            ),
            Self::JenkinsRuntime => (
                "Jenkins policy",
                "Read controller security and isolation metadata",
            ),
        };
        ModuleDefinition {
            id: self,
            label,
            description,
            group: if matches!(self, Self::Host | Self::ExtendedHost | Self::SshPolicy) {
                "host"
            } else {
                "applications"
            },
            check_count: self.rules().len(),
            recommended: self == Self::Host,
            auth: match self {
                Self::PostgresRuntime => Some(ApplicationAccess {
                    kind: "postgresql",
                    default_port: 5432,
                    username_required: true,
                    default_database: Some("postgres"),
                    secret_label: "Password",
                    max_secret_bytes: 4096,
                    secret_required: false,
                }),
                Self::MysqlRuntime => Some(ApplicationAccess {
                    kind: "mysql",
                    default_port: 3306,
                    username_required: true,
                    default_database: None,
                    secret_label: "Password",
                    max_secret_bytes: 79,
                    secret_required: true,
                }),
                Self::RedisRuntime => Some(ApplicationAccess {
                    kind: "redis",
                    default_port: 6379,
                    username_required: false,
                    default_database: None,
                    secret_label: "Password",
                    max_secret_bytes: 4096,
                    secret_required: false,
                }),
                Self::JenkinsRuntime => Some(ApplicationAccess {
                    kind: "jenkins",
                    default_port: 8080,
                    username_required: true,
                    default_database: None,
                    secret_label: "API token",
                    max_secret_bytes: 4096,
                    secret_required: true,
                }),
                _ => None,
            },
            target_limit: (self == Self::DockerWorkloads).then_some(20),
            target_label: (self == Self::DockerWorkloads).then_some("running containers"),
        }
    }
    /// Select only compiled rule sets; no renderer-supplied evaluator can execute.
    pub(super) fn rules(self) -> &'static [RuleDefinition] {
        match self {
            Self::Host => RULES,
            Self::ExtendedHost => system::RULES,
            Self::SshPolicy => ssh_policy::RULES,
            Self::DockerWorkloads => workloads::RULES,
            Self::PostgresRuntime
            | Self::MysqlRuntime
            | Self::RedisRuntime
            | Self::JenkinsRuntime => super::runtime::rules(self.as_str()),
            _ => applications::rules(self.as_str()),
        }
    }
    /// The expected record sequence is derived from exactly the selected collectors.
    fn keys(self) -> &'static [&'static str] {
        match self {
            Self::Host => &HARDENING_KEYS[2..],
            Self::ExtendedHost => system::KEYS,
            Self::SshPolicy => ssh_policy::KEYS,
            Self::DockerWorkloads => workloads::KEYS,
            Self::PostgresRuntime
            | Self::MysqlRuntime
            | Self::RedisRuntime
            | Self::JenkinsRuntime => super::runtime::keys(self.as_str()),
            _ => applications::keys(self.as_str()),
        }
    }
    /// Only embedded, reviewed fragments enter the existing empty-environment SSH boundary.
    fn script(self) -> &'static str {
        match self {
            Self::Host => include_str!("../collectors/host.sh"),
            Self::ExtendedHost => system::SCRIPT,
            Self::SshPolicy => ssh_policy::SCRIPT,
            Self::DockerWorkloads => workloads::SCRIPT,
            Self::PostgresRuntime
            | Self::MysqlRuntime
            | Self::RedisRuntime
            | Self::JenkinsRuntime => "",
            _ => applications::script(self.as_str()),
        }
    }
    /// Runtime protocols use the same selected scope but do not emit shell fact records.
    pub fn is_runtime(self) -> bool {
        matches!(
            self,
            Self::PostgresRuntime | Self::MysqlRuntime | Self::RedisRuntime | Self::JenkinsRuntime
        )
    }
}

/// Reading local module metadata never opens SSH, discovers hosts or starts an assessment.
pub fn definitions() -> Vec<ModuleDefinition> {
    ORDER.iter().map(|id| id.definition()).collect()
}

/// Reject explicit empty and duplicate selections; legacy callers retain host-only scope.
pub fn selection(requested: Option<&[ModuleId]>) -> Result<Vec<ModuleId>, String> {
    let selected = requested.unwrap_or(&[ModuleId::Host]);
    if selected.is_empty() || selected.len() > ORDER.len() {
        return Err("Choose at least one assessment module.".into());
    }
    let canonical: Vec<_> = ORDER
        .iter()
        .copied()
        .filter(|id| selected.contains(id))
        .collect();
    if canonical.len() != selected.len() {
        return Err("Choose each assessment module only once.".into());
    }
    Ok(canonical)
}

/// Metadata records are shared once; unselected modules have neither commands nor output slots.
pub fn keys(selected: &[ModuleId]) -> Vec<&'static str> {
    let mut keys = vec!["os", "privilege"];
    for id in selected {
        if !id.is_runtime() {
            keys.extend_from_slice(id.keys());
        }
    }
    keys
}

/// Assemble embedded source without evaluating remote config, loading remote scripts or interpolating IDs.
pub fn script(selected: &[ModuleId]) -> String {
    let mut script = include_str!("../collect.sh").to_string();
    for id in selected {
        script.push('\n');
        script.push_str(id.script());
        script.push('\n');
    }
    script.push_str("printf 'complete\\000'\n");
    script
}

/// Additional evaluators use the same bounded facts and closed outcome types as the host baseline.
pub(super) fn evaluate(facts: &Facts, rule: &RuleDefinition) -> ExtraResult {
    match rule.evaluation {
        super::catalog::Evaluation::ExtendedHost(check) => system::evaluate(facts, check),
        super::catalog::Evaluation::Application(check) => applications::evaluate(facts, check),
        super::catalog::Evaluation::DockerWorkload(check) => workloads::evaluate(facts, check),
        super::catalog::Evaluation::SshPolicy(check) => ssh_policy::evaluate(facts, check),
        super::catalog::Evaluation::Runtime(check) => super::runtime::evaluate(facts, check),
        _ => ExtraResult::Unavailable,
    }
}
