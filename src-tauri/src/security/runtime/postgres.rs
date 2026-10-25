//! Fixed PostgreSQL queries use the published client over one captured SSH channel.
use super::{
    transport::{self, Driver},
    RuntimeCredential,
};
use crate::security::jobs::Lease;
use serde_json::{Map, Value};
use std::time::Duration;
use tokio_postgres::{Config, NoTls};

const SETTINGS:&str="SELECT name, setting FROM pg_catalog.pg_settings WHERE name IN ('ssl','password_encryption','row_security','log_connections','logging_collector')";
const SUPERUSERS: &str =
    "SELECT count(*)::bigint FROM pg_catalog.pg_roles WHERE rolsuper AND rolcanlogin";
const HBA:&str="SELECT count(*) FILTER (WHERE error IS NOT NULL)::bigint, count(*) FILTER (WHERE auth_method = 'trust')::bigint FROM pg_catalog.pg_hba_file_rules";

/// Query only settings/aggregates; no application data, password hashes or role names are selected.
pub(super) async fn collect(
    lease: &Lease<'_>,
    credential: &RuntimeCredential,
) -> Result<Map<String, Value>, &'static str> {
    let stream = transport::connect(lease, credential.port).await?;
    let mut config = Config::new();
    config
        .user(&credential.username)
        .password(&credential.secret)
        .dbname(&credential.database)
        .application_name("zync-readonly-assessment")
        .options(
            "-c default_transaction_read_only=on -c statement_timeout=4000 -c lock_timeout=1000",
        );
    // The database hop is confined to the authenticated SSH host's loopback interface.
    // TLS support is observed separately; TLS-only database policies can reject this local observer.
    let (client, connection) =
        tokio::time::timeout(Duration::from_secs(5), config.connect_raw(stream, NoTls))
            .await
            .map_err(|_| "timeout")?
            .map_err(|_| "authentication_failed")?;
    let _driver = Driver::spawn(async move {
        let _ = connection.await;
    });
    let mut values = Map::new();
    if let Ok(Ok(rows)) =
        tokio::time::timeout(Duration::from_secs(5), client.query(SETTINGS, &[])).await
    {
        if rows.len() > 5 {
            return Err("invalid_response");
        }
        for row in rows {
            let (Ok(name), Ok(setting)) =
                (row.try_get::<_, String>(0), row.try_get::<_, String>(1))
            else {
                return Err("invalid_response");
            };
            if setting.len() > 256 || values.contains_key(&name) {
                return Err("invalid_response");
            }
            match name.as_str() {
                "ssl" | "row_security" | "logging_collector" => {
                    if let Some(value) = boolean(&setting) {
                        values.insert(name, value.into());
                    }
                }
                "password_encryption" | "log_connections" => {
                    values.insert(name, setting.into());
                }
                _ => return Err("invalid_response"),
            }
        }
    }
    if let Ok(Ok(row)) =
        tokio::time::timeout(Duration::from_secs(5), client.query_one(SUPERUSERS, &[])).await
    {
        if let Ok(count) = row.try_get::<_, i64>(0) {
            if count >= 0 {
                values.insert("login_superusers".into(), (count as u64).into());
            }
        }
    }
    // This view is commonly restricted. Denial leaves only these two fields unavailable;
    // no broader grants or database-superuser credential is requested automatically.
    if let Ok(Ok(row)) =
        tokio::time::timeout(Duration::from_secs(5), client.query_one(HBA, &[])).await
    {
        if let (Ok(errors), Ok(trust)) = (row.try_get::<_, i64>(0), row.try_get::<_, i64>(1)) {
            if errors >= 0 && trust >= 0 {
                values.insert("hba_errors".into(), (errors as u64).into());
                values.insert("hba_trust".into(), (trust as u64).into());
            }
        }
    }
    Ok(values)
}

/// PostgreSQL's boolean settings use canonical textual states rather than inferred truthiness.
fn boolean(value: &str) -> Option<bool> {
    match value {
        "on" => Some(true),
        "off" => Some(false),
        _ => None,
    }
}
