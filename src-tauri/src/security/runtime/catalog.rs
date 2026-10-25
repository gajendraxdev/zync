//! Authenticated runtime facts carry narrower guarantees than a complete application audit.
use super::super::{
    catalog::{ApplicabilityPolicy, Category, Evaluation, RuleDefinition},
    facts::Facts,
    hardening::Outcome,
    modules::ExtraResult,
};
use serde_json::{Map, Value};

#[derive(Clone, Copy, Debug)]
pub(in crate::security) enum Check {
    PgSsl,
    PgPassword,
    PgRowSecurity,
    PgConnectionLogging,
    PgLoggingCollector,
    PgSuperusers,
    PgHbaErrors,
    PgHbaTrust,
    MysqlTransport,
    MysqlLocalInfile,
    MysqlFileScope,
    MysqlDns,
    MysqlGeneralLog,
    MysqlAdmins,
    RedisProtected,
    RedisBind,
    RedisTls,
    RedisPersistence,
    RedisEviction,
    RedisDefaultAdmin,
    JenkinsSecurity,
    JenkinsExecutors,
    JenkinsCsrf,
    JenkinsAnonymous,
}
impl Check {
    /// Each interpreter belongs to exactly one authenticated connection envelope.
    pub(super) const fn key(self) -> &'static str {
        match self {
            Self::PgSsl
            | Self::PgPassword
            | Self::PgRowSecurity
            | Self::PgConnectionLogging
            | Self::PgLoggingCollector
            | Self::PgSuperusers
            | Self::PgHbaErrors
            | Self::PgHbaTrust => "pg_runtime",
            Self::MysqlTransport
            | Self::MysqlLocalInfile
            | Self::MysqlFileScope
            | Self::MysqlDns
            | Self::MysqlGeneralLog
            | Self::MysqlAdmins => "mysql_runtime",
            Self::RedisProtected
            | Self::RedisBind
            | Self::RedisTls
            | Self::RedisPersistence
            | Self::RedisEviction
            | Self::RedisDefaultAdmin => "redis_runtime",
            _ => "jenkins_runtime",
        }
    }
}

/// Static definitions own wording and source provenance; application data supplies no policy or commands.
const fn rule(
    check: Check,
    id: &'static str,
    title: &'static str,
    expected: &'static str,
    rationale: &'static str,
    scope: &'static str,
    guidance: &'static str,
    reference: &'static str,
) -> RuleDefinition {
    RuleDefinition {
        id,
        fact_key: check.key(),
        category: Category::Services,
        title,
        target: "Explicit local application connection over this SSH host",
        expected,
        rationale,
        scope,
        guidance,
        reference,
        rule_version: "1",
        reviewed_at: "2026-10-25",
        applicability: ApplicabilityPolicy::Linux,
        evaluation: Evaluation::Runtime(check),
    }
}
const PG: &str = "https://www.postgresql.org/docs/current/view-pg-settings.html";
const MYSQL: &str = "https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html";
const REDIS: &str = "https://redis.io/docs/latest/commands/config-get/";
const JENKINS: &str = "https://www.jenkins.io/doc/book/security/";
const PG_SCOPE:&str="Reported runtime settings for this database connection only. Client-specific overrides, every database and external network access are not assessed.";
const MYSQL_SCOPE:&str="Reported settings of the explicitly selected local MySQL server only. Account grants, all clients, plugins and external reachability are not fully assessed.";
const REDIS_SCOPE:&str="Exact non-secret runtime parameters from this local Redis endpoint. ACL hashes, passwords, stored keys and external reachability are not collected.";
const JENKINS_SCOPE:&str="Fixed read-only Jenkins API fields only. Public metadata may be observed when the supplied token cannot be verified. This does not validate every job, plugin, authorization rule or agent boundary.";

const POSTGRES:&[RuleDefinition]=&[
    rule(Check::PgSsl,"PG-RUNTIME-tls","PostgreSQL TLS support","Review whether TLS support is enabled for this server.","TLS can protect database traffic outside the SSH connection.",PG_SCOPE,"Review the server's network clients and connection rules. Enabled TLS alone does not require every client to use it.",PG),
    rule(Check::PgPassword,"PG-RUNTIME-password-default","PostgreSQL password-hash default","Prefer SCRAM-SHA-256 for newly assigned passwords where clients support it.","Modern password hashing strengthens stored credentials.","Current password_encryption setting only; existing password hashes are not read and may use other algorithms.","Review client compatibility before changing the default and rotating existing credentials. No password hashes were inspected.",PG),
    rule(Check::PgRowSecurity,"PG-RUNTIME-row-security","PostgreSQL row-security setting","Review the row_security setting used by this connection.","Row-level policy depends on the connecting role, table policies and bypass privileges.",PG_SCOPE,"Review table policies, owner/superuser exceptions and application roles separately. This setting alone does not establish enforced row isolation.",PG),
    rule(Check::PgConnectionLogging,"PG-RUNTIME-connection-logging","PostgreSQL connection logging","Review the server's connection-logging setting.","Connection events can support incident investigation.",PG_SCOPE,"Confirm that logging meets operational and privacy requirements. Retention and delivery were not tested.",PG),
    rule(Check::PgLoggingCollector,"PG-RUNTIME-log-collector","PostgreSQL log collector","Review how this server collects logs.","The built-in collector is one of several valid logging arrangements.",PG_SCOPE,"Confirm the active log destination, retention and monitoring; a disabled built-in collector can be intentional.",PG),
    rule(Check::PgSuperusers,"PG-RUNTIME-login-superusers","PostgreSQL login superusers","Review the number of roles that can log in with superuser privileges.","Login-capable superusers have broad database control.","Aggregate pg_roles count only; no names, password fields, grants or reachable login paths are exported.","Keep administrative access limited to intended operators and review authentication policy separately.","https://www.postgresql.org/docs/current/view-pg-roles.html"),
    rule(Check::PgHbaErrors,"PG-RUNTIME-hba-errors","PostgreSQL authentication-file errors","The current authentication file has no reported parse errors.","Invalid declarations may prevent intended authentication changes from applying.","Current pg_hba_file_rules content only, not what the server last loaded. The view may require separately granted access.","Review file errors and reload state with the database administrator. Zync does not reload or change authentication settings.","https://www.postgresql.org/docs/current/view-pg-hba-file-rules.html"),
    rule(Check::PgHbaTrust,"PG-RUNTIME-hba-trust","PostgreSQL trust declarations","Review trust declarations in the current authentication file.","Trust authentication can allow matching clients to connect without a password.","Current file declarations only; ordering, includes, effective loaded policy and reachability remain separate.","Confirm that every trust declaration is intentional and constrained. Its presence alone does not prove an externally reachable passwordless login.","https://www.postgresql.org/docs/current/view-pg-hba-file-rules.html"),
];
const MYSQL_RULES:&[RuleDefinition]=&[
    rule(Check::MysqlTransport,"MYSQL-RUNTIME-transport","MySQL secure transport","Review whether the server requires secure transport.","Requiring secure transport can protect client credentials and data.",MYSQL_SCOPE,"Review require_secure_transport alongside Unix-socket use and network client requirements. This observer uses TLS through the SSH-host loopback connection.",MYSQL),
    rule(Check::MysqlLocalInfile,"MYSQL-RUNTIME-local-infile","MySQL local-file loading","Review whether LOCAL INFILE is enabled on the server.","Local-file loading expands the client/server file-transfer surface.",MYSQL_SCOPE,"Disable local-file loading where unused, after checking import workflows. The Zync observer disables its client-side LOCAL INFILE support.",MYSQL),
    rule(Check::MysqlFileScope,"MYSQL-RUNTIME-file-scope","MySQL server file-operation scope","Review whether server file import/export is disabled, directory-scoped or unrestricted.","Restricting server file operations can reduce misuse of FILE privileges.","The secure_file_priv setting only; actual directory paths and file contents are not exported.","Review FILE grants and intended import/export paths. A directory scope alone does not validate directory permissions.",MYSQL),
    rule(Check::MysqlDns,"MYSQL-RUNTIME-name-resolution","MySQL account name resolution","Review whether account matching uses hostname resolution.","Hostname-based matching has operational and network dependencies.",MYSQL_SCOPE,"Review skip_name_resolve with existing host-based account grants before changing it.",MYSQL),
    rule(Check::MysqlGeneralLog,"MYSQL-RUNTIME-general-log","MySQL general query logging","Review whether general query logging is enabled.","General query logs may capture sensitive statements and add overhead.",MYSQL_SCOPE,"Use a logging strategy that balances investigation, performance and secret retention. No log content was read.",MYSQL),
    rule(Check::MysqlAdmins,"MYSQL-RUNTIME-admin-count","MySQL login administrator count","Review enabled accounts with the legacy SUPER privilege.","Administrative accounts can have broad control over the database server.","Aggregate mysql.user metadata only if readable. Dynamic privileges and every effective grant are not assessed; account names and authentication strings are not read.","Review intended administrative accounts and dynamic grants with the DBA. Do not grant broader database access merely to complete this check.","https://dev.mysql.com/doc/refman/8.4/en/grant-tables.html"),
];
const REDIS_RULES:&[RuleDefinition]=&[
    rule(Check::RedisProtected,"REDIS-RUNTIME-protected-mode","Redis protected mode","Review whether protected mode is enabled.","Protected mode can reduce accidental access under default configurations.",REDIS_SCOPE,"Review this value alongside bind addresses and ACL policy; protected mode alone does not establish secure authorization.",REDIS),
    rule(Check::RedisBind,"REDIS-RUNTIME-bind","Redis runtime binding","Review the configured bind scope.","Restricting listeners can reduce unintended network access.",REDIS_SCOPE,"Confirm intended clients and firewall rules. Binding beyond loopback does not establish internet exposure.",REDIS),
    rule(Check::RedisTls,"REDIS-RUNTIME-tls","Redis runtime listener ports","Review the plaintext and TLS listener configuration.","TLS can protect traffic to network clients.",REDIS_SCOPE,"Confirm transport requirements and any trusted proxy. The observer does not test external certificate negotiation.",REDIS),
    rule(Check::RedisPersistence,"REDIS-RUNTIME-appendonly","Redis append-only persistence","Review whether append-only persistence is enabled.","Persistence expectations depend on whether Redis is a cache or primary data store.",REDIS_SCOPE,"Review backup, recovery and durability needs for this workload. AOF status is not a backup-restoration test.",REDIS),
    rule(Check::RedisEviction,"REDIS-RUNTIME-eviction","Redis eviction policy","Review the runtime eviction policy.","Eviction behavior can affect application availability and data retention.",REDIS_SCOPE,"Choose an eviction policy appropriate to the workload and monitor memory pressure.",REDIS),
    rule(Check::RedisDefaultAdmin,"REDIS-RUNTIME-default-admin","Redis default-account command permissions","Review simulated dangerous-command permissions for the default account.","Broad default-account permissions can expand the impact of unauthorized access.","ACL DRYRUN simulations only; commands are not executed. Account enabled/password state and all ACL selectors are not inspected.","Review the default account's intended authorization. No hashes, ACL content or stored data were collected.","https://redis.io/docs/latest/commands/acl-dryrun/"),
];
const JENKINS_RULES:&[RuleDefinition]=&[
    rule(Check::JenkinsSecurity,"JENKINS-RUNTIME-security","Jenkins security restrictions","Jenkins reports some security restrictions are configured.","A fully unrestricted controller allows broad access.",JENKINS_SCOPE,"Review the authentication realm and authorization strategy separately. A true useSecurity flag does not prove both are correctly enforced.",JENKINS),
    rule(Check::JenkinsExecutors,"JENKINS-RUNTIME-executors","Jenkins built-in executors","Prefer no build executors on the built-in controller node.","Builds running on the controller share its filesystem authority.",JENKINS_SCOPE,"Use appropriately isolated agents and review agent-to-controller permissions before moving builds.","https://www.jenkins.io/doc/book/security/controller-isolation/"),
    rule(Check::JenkinsCsrf,"JENKINS-RUNTIME-csrf","Jenkins CSRF protection","Review whether a crumb issuer is configured.","CSRF protection helps protect browser-authenticated operations.",JENKINS_SCOPE,"Review CSRF configuration and supported authentication workflows. API-token requests have separate CSRF handling.","https://www.jenkins.io/doc/book/security/csrf-protection/"),
    rule(Check::JenkinsAnonymous,"JENKINS-RUNTIME-anonymous-api","Jenkins anonymous metadata access","Review whether an unauthenticated request can read the selected controller metadata.","Anonymous metadata access may disclose controller configuration.","One fixed anonymous API GET only; job, credential and other endpoint permissions are not tested.","Decide whether this metadata should be public. A denied request does not prove that all anonymous access is blocked.","https://www.jenkins.io/doc/book/security/access-control/"),
];

/// Public catalog counts are derived from the same rule slices the report dispatcher uses.
pub(in crate::security) fn rules(id: &str) -> &'static [RuleDefinition] {
    match id {
        "postgres-runtime" => POSTGRES,
        "mysql-runtime" => MYSQL_RULES,
        "redis-runtime" => REDIS_RULES,
        "jenkins-runtime" => JENKINS_RULES,
        _ => &[],
    }
}
/// Runtime keys are never appended to the shell collector; native observers supply them separately.
pub(in crate::security) fn keys(id: &str) -> &'static [&'static str] {
    match id {
        "postgres-runtime" => &["pg_runtime"],
        "mysql-runtime" => &["mysql_runtime"],
        "redis-runtime" => &["redis_runtime"],
        "jenkins-runtime" => &["jenkins_runtime"],
        _ => &[],
    }
}

/// Missing authority or unsupported runtime fields never become a host-sudo recommendation.
fn unavailable(code: Option<&str>) -> ExtraResult {
    let (reason,next_step)=match code {
        Some("unsupported_client")=>("The installed MySQL client is outside this observer's qualified interface.","Keep the existing credential unchanged and use service checks, or review the observer's supported client requirements."),
        Some("timeout")=>("The application did not finish this read-only check within its deadline.","Review the local application endpoint and account with its administrator, then try again."),
        Some("authentication_failed")=>("The application did not accept the supplied read-only connection.","Review the selected local port, account, database and credential. Zync does not change credentials or retry other authentication methods."),
        Some("connection_failed")=>("The selected local application endpoint could not be reached through this SSH connection.","Check the application's local listener and SSH direct-TCP policy. Custom or remote endpoints are outside this observer's scope."),
        _=>("This application did not expose usable information for this check.","Review the check's supported version and read permissions with the application administrator. Host sudo does not grant database or API permissions."),
    };
    ExtraResult::UnavailableWith { reason, next_step }
}

/// Require one bounded native envelope and a known typed value; remote data never selects a rule.
pub(in crate::security) fn evaluate(facts: &Facts, check: Check) -> ExtraResult {
    let Some(source) = facts.get(check.key()) else {
        return unavailable(None);
    };
    let Ok(Value::Object(envelope)) = serde_json::from_str::<Value>(source) else {
        return unavailable(None);
    };
    if envelope.get("version").and_then(Value::as_u64) != Some(1) {
        return unavailable(None);
    }
    if let Some(error) = envelope.get("error") {
        return unavailable(error.as_str());
    }
    let Some(Value::Object(values)) = envelope.get("values") else {
        return unavailable(None);
    };
    interpret(check, values).unwrap_or_else(|| unavailable(None))
}

/// Keep observations and classifications explicit for each narrow application condition.
fn interpret(check: Check, values: &Map<String, Value>) -> Option<ExtraResult> {
    let flag = |key| values.get(key)?.as_bool();
    let count = |key| {
        values
            .get(key)?
            .as_u64()
            .filter(|value| *value <= 1_000_000_000)
    };
    let word = |key| {
        values.get(key)?.as_str().filter(|value| {
            !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
        })
    };
    let (mut value, mut observed, outcome) = match check {
        Check::PgSsl => {
            let value = flag("ssl")?;
            (value.to_string(),format!("The PostgreSQL server reports TLS support {}. This does not require every connection to use TLS.",if value{"enabled"}else{"disabled"}),Outcome::Informational)
        }
        Check::PgPassword => {
            let value = word("password_encryption")?;
            if !["scram-sha-256", "md5"].contains(&value) {
                return None;
            }
            (value.into(),format!("Newly assigned passwords use the {value} default; existing password hashes were not read."),Outcome::baseline(value=="scram-sha-256"))
        }
        Check::PgRowSecurity => {
            let value = flag("row_security")?;
            (value.to_string(),format!("Row security is {} for this connection; role and table policy exceptions still need review.",if value{"on"}else{"off"}),Outcome::Informational)
        }
        Check::PgConnectionLogging => {
            let value = word("log_connections")?;
            (value.into(),format!("Connection logging reports: {value}. Log contents and retention were not read."),Outcome::Informational)
        }
        Check::PgLoggingCollector => {
            let value = flag("logging_collector")?;
            (value.to_string(),format!("The built-in PostgreSQL log collector is {}. Other log delivery may be configured.",if value{"enabled"}else{"disabled"}),Outcome::Informational)
        }
        Check::PgSuperusers => {
            let value = count("login_superusers")?;
            (value.to_string(),format!("{value} database roles can log in with superuser privileges. Account names were not collected."),Outcome::Informational)
        }
        Check::PgHbaErrors => {
            let value = count("hba_errors")?;
            (value.to_string(),format!("The current authentication file has {value} reported parse errors; last-loaded rules were not verified."),Outcome::baseline(value==0))
        }
        Check::PgHbaTrust => {
            let value = count("hba_trust")?;
            (value.to_string(),format!("The current authentication file contains {value} trust declarations. Loaded policy and reachability need separate review."),Outcome::Informational)
        }
        Check::MysqlTransport => {
            let value = flag("require_secure_transport")?;
            (
                value.to_string(),
                format!(
                    "MySQL {} secure transport for client connections.",
                    if value {
                        "requires"
                    } else {
                        "does not require"
                    }
                ),
                Outcome::Informational,
            )
        }
        Check::MysqlLocalInfile => {
            let value = flag("local_infile")?;
            (value.to_string(),format!("Server-side LOCAL INFILE support is {}. This observer disables it on the client.",if value{"enabled"}else{"disabled"}),Outcome::Informational)
        }
        Check::MysqlFileScope => {
            let value = word("secure_file_scope")?;
            if !["disabled", "directory", "unrestricted"].contains(&value) {
                return None;
            }
            (value.into(),format!("MySQL server file operations are {value}; actual paths and FILE grants were not collected."),Outcome::Informational)
        }
        Check::MysqlDns => {
            let value = flag("skip_name_resolve")?;
            (
                value.to_string(),
                format!(
                    "Hostname resolution for MySQL account matching is {}.",
                    if value { "disabled" } else { "enabled" }
                ),
                Outcome::Informational,
            )
        }
        Check::MysqlGeneralLog => {
            let value = flag("general_log")?;
            (
                value.to_string(),
                format!(
                    "MySQL general query logging is {}. No statements or log content were read.",
                    if value { "enabled" } else { "disabled" }
                ),
                Outcome::Informational,
            )
        }
        Check::MysqlAdmins => {
            let value = count("login_admins")?;
            (value.to_string(),format!("{value} enabled accounts have the legacy SUPER privilege; dynamic privileges remain outside this count."),Outcome::Informational)
        }
        Check::RedisProtected => {
            let value = flag("protected_mode")?;
            (
                value.to_string(),
                format!(
                    "Redis protected mode is {}. Binding and ACL policy still need review.",
                    if value { "enabled" } else { "disabled" }
                ),
                Outcome::Informational,
            )
        }
        Check::RedisBind => {
            let value = word("bind_scope")?;
            if ![
                "loopback-only",
                "includes-non-loopback",
                "unspecified",
                "unrecognized",
            ]
            .contains(&value)
            {
                return None;
            }
            if value == "unrecognized" {
                return None;
            }
            (
                value.into(),
                format!("Redis binding scope: {value}. External reachability was not tested."),
                Outcome::Informational,
            )
        }
        Check::RedisTls => {
            let plain = count("plain_port")?;
            let tls = count("tls_port")?;
            if plain > 65535 || tls > 65535 {
                return None;
            }
            (format!("plain_port={plain} tls_port={tls}"),format!("Redis reports plaintext port {plain} and TLS port {tls}; zero disables that listener."),Outcome::Informational)
        }
        Check::RedisPersistence => {
            let value = flag("appendonly")?;
            (value.to_string(),format!("Append-only persistence is {}. Durability requirements depend on this workload.",if value{"enabled"}else{"disabled"}),Outcome::Informational)
        }
        Check::RedisEviction => {
            let value = word("maxmemory_policy")?;
            if ![
                "noeviction",
                "allkeys-lru",
                "volatile-lru",
                "allkeys-lfu",
                "volatile-lfu",
                "allkeys-random",
                "volatile-random",
                "volatile-ttl",
            ]
            .contains(&value)
            {
                return None;
            }
            (value.into(),format!("Redis uses the {value} memory-eviction policy. Review this against the workload's data-retention needs."),Outcome::Informational)
        }
        Check::RedisDefaultAdmin => {
            let value = count("default_dangerous_allowed")?;
            if value > 2 {
                return None;
            }
            (value.to_string(),format!("{value} of two simulated dangerous commands are allowed for the default account. No command was executed or account-enabled state inferred."),Outcome::Informational)
        }
        Check::JenkinsSecurity => {
            let value = flag("use_security")?;
            (
                value.to_string(),
                if value {
                    "Jenkins reports some security restrictions. Authentication and authorization strategy details still need review.".into()
                } else {
                    "Jenkins reports no security restrictions configured.".into()
                },
                if value {
                    Outcome::Informational
                } else {
                    Outcome::Attention
                },
            )
        }
        Check::JenkinsExecutors => {
            let value = count("controller_executors")?;
            (value.to_string(),format!("The built-in controller node has {value} configured build executors. Agent isolation was not assessed."),Outcome::baseline(value==0))
        }
        Check::JenkinsCsrf => {
            let value = flag("use_crumbs")?;
            (value.to_string(),format!("Jenkins reports a CSRF crumb issuer {}. Authentication workflows still need review.",if value{"configured"}else{"not configured"}),Outcome::Informational)
        }
        Check::JenkinsAnonymous => {
            let value = flag("anonymous_metadata")?;
            (
                value.to_string(),
                if value {
                    "The fixed controller metadata endpoint answered an anonymous request. Other endpoint permissions were not tested.".into()
                } else {
                    "The fixed anonymous metadata request was denied. This does not establish that all anonymous access is blocked.".into()
                },
                Outcome::Informational,
            )
        }
    };
    if check.key() == "jenkins_runtime" {
        let authenticated = flag("observer_authenticated")?;
        value = format!("observer_authenticated={authenticated} {value}");
        if !authenticated {
            observed.push_str(" Public API evidence only; the supplied token was not verified.");
        }
    }
    Some(ExtraResult::Available {
        value,
        observed,
        outcome,
    })
}
