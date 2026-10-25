//! Optional application checks inspect named service units and small, fixed local projections.
//! They do not authenticate to databases, discover arbitrary layouts or claim live application policy.
use super::ExtraResult;
use crate::security::{
    catalog::{ApplicabilityPolicy, Category, Evaluation, RuleDefinition},
    facts::{file_metadata, Facts},
    hardening::Outcome,
};
use std::collections::BTreeMap;

const SYSTEMD: &str = "https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html";
const NGINX: &str = "https://nginx.org/en/docs/http/ngx_http_core_module.html";
const REDIS: &str = "https://redis.io/docs/latest/operate/oss_and_stack/management/security/";
const DOCKER: &str = "https://docs.docker.com/engine/security/";
type RuleSet = &'static [RuleDefinition];

#[derive(Clone, Copy, Debug)]
pub(in crate::security) enum ServiceProperty {
    State,
    User,
    NoNewPrivileges,
    PrivateTmp,
    ProtectSystem,
    ProtectHome,
    RestrictSuid,
    Umask,
}

#[derive(Clone, Copy, Debug)]
pub(in crate::security) enum NginxProperty {
    Tokens,
    DirectoryListing,
    TlsProtocols,
}

#[derive(Clone, Copy, Debug)]
pub(in crate::security) enum RedisProperty {
    ProtectedMode,
    Binding,
    Tls,
    Authentication,
}

#[derive(Clone, Copy, Debug)]
pub(in crate::security) enum DockerProperty {
    Seccomp,
    Isolation,
    Logging,
    LiveRestore,
}

#[derive(Clone, Copy, Debug)]
pub(in crate::security) enum Check {
    Service {
        key: &'static str,
        property: ServiceProperty,
    },
    Metadata {
        key: &'static str,
        directory: bool,
        socket: bool,
    },
    Nginx(NginxProperty),
    Redis(RedisProperty),
    Docker(DockerProperty),
}

/// Keep metadata construction shared while each rule retains a stable explicit identifier.
const fn rule(
    id: &'static str,
    key: &'static str,
    title: &'static str,
    target: &'static str,
    expected: &'static str,
    rationale: &'static str,
    scope: &'static str,
    guidance: &'static str,
    reference: &'static str,
    check: Check,
) -> RuleDefinition {
    RuleDefinition {
        id,
        fact_key: key,
        category: Category::Services,
        title,
        target,
        expected,
        rationale,
        scope,
        guidance,
        reference,
        rule_version: "1",
        reviewed_at: "2026-10-25",
        applicability: ApplicabilityPolicy::Linux,
        evaluation: Evaluation::Application(check),
    }
}

/// Describe the resolved named unit only; a service can still need application-specific privileges.
const fn service_rule(
    id: &'static str,
    key: &'static str,
    title: &'static str,
    unit: &'static str,
    property: ServiceProperty,
) -> RuleDefinition {
    let (expected, rationale, guidance) = match property {
        ServiceProperty::State => ("Review whether this named unit should be running.", "An unused service may add attack surface; an inactive service may be intentional.", "Confirm that this unit is required. This observation does not prove whether the application runs under another name or inside a container."),
        ServiceProperty::User => ("Review the service's configured startup identity.", "A dedicated service identity can limit access, although some services require root startup before dropping privileges.", "Check startup and worker privileges against the application's requirements. Do not change the unit user without testing access and recovery."),
        ServiceProperty::NoNewPrivileges => ("The named unit blocks gaining new privileges (NoNewPrivileges=yes).", "This prevents executed programs from gaining privileges through setuid, setgid or file capabilities.", "Consider NoNewPrivileges=yes after testing the service. It does not remove existing privileges or establish that every running process is confined."),
        ServiceProperty::PrivateTmp => ("The named unit uses a private temporary directory.", "A private temporary directory reduces unintended sharing with other services.", "Consider PrivateTmp=yes or disconnected where compatible; some applications intentionally share temporary files."),
        ServiceProperty::ProtectSystem => ("The named unit requests read-only system paths.", "Read-only system paths reduce the files a compromised service can alter.", "Consider ProtectSystem=yes, full or strict, with narrow writable paths where needed. Test service startup, updates and recovery."),
        ServiceProperty::ProtectHome => ("The named unit restricts access to home directories.", "A service often does not need access to users' home-directory contents.", "Consider ProtectHome=yes, read-only or tmpfs if compatible with the workload. This does not inspect every bind mount or namespace capability."),
        ServiceProperty::RestrictSuid => ("The named unit prevents creating setuid/setgid files.", "Restricting privileged file creation reduces one way to persist elevated access.", "Consider RestrictSUIDSGID=yes after testing compatibility. Existing privileged files and capabilities are outside this check."),
        ServiceProperty::Umask => ("The unit's file-creation mask removes group and other write permissions.", "A restrictive creation mask helps keep newly created files from being writable by unrelated users.", "Use a suitable UMask that removes group/other write access. Sensitive application files may need stricter confidentiality permissions."),
    };
    rule(id, key, title, unit, expected, rationale,
        "Resolved properties of this exact systemd unit only. Custom units, containers, child/cluster services, running process restrictions and application authentication/TLS are not verified.",
        guidance, SYSTEMD, Check::Service { key, property })
}

macro_rules! service_rules {
    ($name:ident, $prefix:literal, $label:literal, $key:literal, $unit:literal, [$($extra:expr),* $(,)?]) => {
        const $name: RuleSet = &[
            service_rule(concat!($prefix, "-service-state"), $key, concat!($label, " service state"), $unit, ServiceProperty::State),
            service_rule(concat!($prefix, "-service-user"), $key, concat!($label, " startup identity"), $unit, ServiceProperty::User),
            service_rule(concat!($prefix, "-no-new-privileges"), $key, concat!($label, " privilege-gain restriction"), $unit, ServiceProperty::NoNewPrivileges),
            service_rule(concat!($prefix, "-private-tmp"), $key, concat!($label, " temporary-file isolation"), $unit, ServiceProperty::PrivateTmp),
            service_rule(concat!($prefix, "-protect-system"), $key, concat!($label, " system-path protection"), $unit, ServiceProperty::ProtectSystem),
            service_rule(concat!($prefix, "-protect-home"), $key, concat!($label, " home-directory protection"), $unit, ServiceProperty::ProtectHome),
            service_rule(concat!($prefix, "-restrict-suid"), $key, concat!($label, " privileged-file restriction"), $unit, ServiceProperty::RestrictSuid),
            service_rule(concat!($prefix, "-umask"), $key, concat!($label, " new-file write permissions"), $unit, ServiceProperty::Umask),
            $($extra),*
        ];
    }
}

/// Metadata of named paths is independent of file contents and service discovery.
const fn metadata(
    id: &'static str,
    key: &'static str,
    title: &'static str,
    target: &'static str,
    directory: bool,
    socket: bool,
) -> RuleDefinition {
    rule(id, key, title, target,
        if socket { "The named Docker socket is root-owned and has no access permissions for other users." } else { "The named path is root-owned and not writable by group or other users." },
        if socket { "Access to the rootful Docker socket can give extensive control over this host." } else { "Writable configuration paths can let another account change the service's behavior." },
        "Metadata of the exact default-layout path, following symlinks. Other layouts, parent directories, ACLs, group membership and application use of this path are not verified.",
        "Review ownership and access with the administrator. Preserve required service access; this check does not audit ACLs or every directory component.",
        if socket { DOCKER } else { SYSTEMD }, Check::Metadata { key, directory, socket })
}

service_rules!(NGINX_RULES, "NGINX", "Nginx", "nginx_service", "nginx.service", [
    metadata("NGINX-config-permissions", "nginx_config_meta", "Nginx main-config permissions", "/etc/nginx/nginx.conf", false, false),
    metadata("NGINX-directory-permissions", "nginx_dir_meta", "Nginx config-directory permissions", "/etc/nginx", true, false),
    rule("NGINX-version-declarations", "nginx_config", "Nginx version-disclosure declarations", "/etc/nginx/nginx.conf", "Review explicit server_tokens declarations in this file.", "Version disclosure can make software fingerprinting easier.", "Static declarations in the named file only; includes, inheritance, custom paths, running workers and actual HTTP responses are not evaluated.", "Consider server_tokens off where appropriate. An off declaration in this file does not prove that every virtual host hides its version.", NGINX, Check::Nginx(NginxProperty::Tokens)),
    rule("NGINX-listing-declarations", "nginx_config", "Nginx directory-listing declarations", "/etc/nginx/nginx.conf", "Review explicit autoindex declarations in this file.", "Directory listings can reveal files that were not intended to be browsable.", "Static declarations in the named file only; includes, location matching, effective virtual-host configuration and HTTP responses are not evaluated.", "Review autoindex on declarations against the intended public content. Keep intentionally published listings only where required.", "https://nginx.org/en/docs/http/ngx_http_autoindex_module.html", Check::Nginx(NginxProperty::DirectoryListing)),
    rule("NGINX-tls-declarations", "nginx_config", "Nginx TLS-protocol declarations", "/etc/nginx/nginx.conf", "Review explicit ssl_protocols declarations for obsolete protocols.", "Obsolete SSL/TLS protocols should not be enabled for new secure deployments.", "Static named-file declarations only. Compiled defaults, includes, certificate validity, cipher policy and endpoint negotiation are not tested.", "Review explicit SSLv2/SSLv3/TLSv1/TLSv1.1 declarations and client requirements. Prefer current TLS policy, then verify the actual endpoint separately.", "https://nginx.org/en/docs/http/configuring_https_servers.html", Check::Nginx(NginxProperty::TlsProtocols)),
]);
service_rules!(
    APACHE_RULES,
    "APACHE",
    "Apache",
    "apache_service",
    "apache2.service",
    []
);
service_rules!(
    POSTGRES_RULES,
    "POSTGRESQL",
    "PostgreSQL",
    "postgresql_service",
    "postgresql.service",
    []
);
service_rules!(
    MYSQL_RULES,
    "MYSQL",
    "MySQL",
    "mysql_service",
    "mysql.service",
    []
);
service_rules!(
    JENKINS_RULES,
    "JENKINS",
    "Jenkins",
    "jenkins_service",
    "jenkins.service",
    []
);
service_rules!(DOCKER_RULES, "DOCKER", "Docker", "docker_service", "docker.service", [
    metadata("DOCKER-socket-permissions", "docker_socket", "Docker socket access", "/var/run/docker.sock", false, true),
    rule("DOCKER-seccomp-support", "docker_info", "Docker seccomp support", "Local Docker Engine /info", "The checked local engine reports seccomp support.", "Seccomp can reduce the system calls available to containers.", "The rootful default Unix socket only; the reported engine option does not prove that every container uses a seccomp profile.", "Review the engine's seccomp support and each workload's security options. Do not treat daemon support as a container-by-container audit.", "https://docs.docker.com/engine/security/seccomp/", Check::Docker(DockerProperty::Seccomp)),
    rule("DOCKER-user-isolation", "docker_info", "Docker user-namespace mode", "Local Docker Engine /info", "Review whether rootless or user-namespace remapping fits this host.", "User-namespace isolation can reduce the host privileges associated with container processes.", "Reported security options of the rootful default local socket only. Rootless per-user sockets and per-container overrides are not discovered.", "Consider rootless mode or userns-remap where compatible. Their absence is contextual, not a confirmed vulnerability.", "https://docs.docker.com/engine/security/rootless/", Check::Docker(DockerProperty::Isolation)),
    rule("DOCKER-default-logging", "docker_info", "Docker default logging", "Local Docker Engine /info", "Review the engine's default logging driver and retention policy.", "Logging helps investigation, while unbounded local logs can exhaust storage.", "Default logging-driver name only; per-container overrides, log content and rotation settings are not read.", "Review container log collection and retention. json-file alone does not show whether rotation is configured; existing containers can use different settings.", "https://docs.docker.com/engine/logging/configure/", Check::Docker(DockerProperty::Logging)),
    rule("DOCKER-live-restore", "docker_info", "Docker live restore", "Local Docker Engine /info", "Review whether live restore fits this host's availability requirements.", "Live restore can keep containers running while the daemon is unavailable.", "The reported local engine setting only. This is an availability observation, not a container isolation or recovery test.", "Evaluate live restore with the deployment and recovery plan. A disabled setting is not automatically a security weakness.", "https://docs.docker.com/engine/daemon/live-restore/", Check::Docker(DockerProperty::LiveRestore)),
]);
service_rules!(REDIS_RULES, "REDIS", "Redis", "redis_service", "redis-server.service", [
    metadata("REDIS-config-permissions", "redis_config_meta", "Redis config permissions", "/etc/redis/redis.conf", false, false),
    rule("REDIS-protected-declaration", "redis_config", "Redis protected-mode declaration", "/etc/redis/redis.conf", "Review an explicit protected-mode declaration in this file.", "Protected mode reduces accidental unauthenticated access in default configurations.", "Static default-layout file only; includes, command-line overrides, runtime CONFIG changes, ACL permissions and effective server state are not verified.", "Review protected-mode no against the intended binding and authentication policy. Enabling protected mode alone does not establish secure access control.", REDIS, Check::Redis(RedisProperty::ProtectedMode)),
    rule("REDIS-bind-declarations", "redis_config", "Redis bind declarations", "/etc/redis/redis.conf", "Review the explicitly declared network binding.", "Limiting network access can reduce exposure, but shared-service deployments may require non-loopback access.", "Static declarations only; DNS names, complex/unrecognized addresses, includes, runtime overrides and external reachability are not resolved.", "Restrict network access to intended clients and review ACL/TLS policy. A declared non-loopback address is not proof of internet exposure.", REDIS, Check::Redis(RedisProperty::Binding)),
    rule("REDIS-tls-declarations", "redis_config", "Redis TLS-port declarations", "/etc/redis/redis.conf", "Review the explicit plaintext and TLS port declarations.", "TLS can protect traffic between clients and Redis when network transport is required.", "Static port declarations only; certificate/key contents, client policy, overrides and endpoint negotiation are not inspected.", "Review plaintext and TLS listeners against the deployment's transport requirements. No declared TLS port does not establish whether an external proxy provides encryption.", REDIS, Check::Redis(RedisProperty::Tls)),
    rule("REDIS-auth-declarations", "redis_config", "Redis authentication declarations", "/etc/redis/redis.conf", "Review the presence of ACL or legacy-password declarations.", "Redis authorization should grant clients only the commands and data they require.", "Presence counts only; passwords, ACL hashes, user names and ACL content are never exported. Effective authentication and authorization are not assessed.", "Use a reviewed least-privilege ACL policy. A legacy password or ACL declaration alone does not prove that every client must authenticate.", "https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/", Check::Redis(RedisProperty::Authentication)),
]);

/// Resolve optional module identifiers to immutable compiled rules; unknown identifiers add no policy.
pub(super) fn rules(id: &str) -> RuleSet {
    match id {
        "nginx" => NGINX_RULES,
        "apache" => APACHE_RULES,
        "docker" => DOCKER_RULES,
        "postgresql" => POSTGRES_RULES,
        "mysql" => MYSQL_RULES,
        "redis" => REDIS_RULES,
        "jenkins" => JENKINS_RULES,
        _ => &[],
    }
}

/// Match each selected fragment's exact record order for nonce-bound decoding.
pub(super) fn keys(id: &str) -> &'static [&'static str] {
    match id {
        "nginx" => &[
            "nginx_service",
            "nginx_config_meta",
            "nginx_dir_meta",
            "nginx_config",
        ],
        "apache" => &["apache_service"],
        "docker" => &["docker_service", "docker_socket", "docker_info"],
        "postgresql" => &["postgresql_service"],
        "mysql" => &["mysql_service"],
        "redis" => &["redis_service", "redis_config_meta", "redis_config"],
        "jenkins" => &["jenkins_service"],
        _ => &[],
    }
}

/// Embed fixed application fragments; no selected identifier becomes a shell argument or path.
pub(super) fn script(id: &str) -> &'static str {
    match id {
        "nginx" => include_str!("../collectors/applications/nginx.sh"),
        "apache" => include_str!("../collectors/applications/apache.sh"),
        "docker" => include_str!("../collectors/applications/docker.sh"),
        "postgresql" => include_str!("../collectors/applications/postgresql.sh"),
        "mysql" => include_str!("../collectors/applications/mysql.sh"),
        "redis" => include_str!("../collectors/applications/redis.sh"),
        "jenkins" => include_str!("../collectors/applications/jenkins.sh"),
        _ => "",
    }
}

/// Parse only unique declared fields so repeated or unsolicited data cannot choose a safer value.
fn fields<'a>(source: &'a str, allowed: &[&str]) -> Option<BTreeMap<&'a str, &'a str>> {
    if source.len() > 8192 {
        return None;
    }
    let mut parsed = BTreeMap::new();
    for line in source.lines() {
        let (key, value) = line.split_once('=')?;
        if !allowed.contains(&key) || parsed.insert(key, value).is_some() {
            return None;
        }
    }
    Some(parsed)
}

/// Construct a human summary while retaining a small normalized technical observation.
fn available(value: String, observed: String, outcome: Outcome) -> ExtraResult {
    ExtraResult::Available {
        value,
        observed,
        outcome,
    }
}

/// A missing exact unit excludes only those unit-property checks, not the whole application.
fn service(facts: &Facts, key: &str, property: ServiceProperty) -> ExtraResult {
    let Some(source) = facts.get(key) else {
        return ExtraResult::Unavailable;
    };
    let Some(values) = fields(
        source,
        &[
            "LoadState",
            "ActiveState",
            "User",
            "NoNewPrivileges",
            "PrivateTmp",
            "ProtectSystem",
            "ProtectHome",
            "RestrictSUIDSGID",
            "UMask",
        ],
    ) else {
        return ExtraResult::Unavailable;
    };
    match values.get("LoadState").copied() {
        Some("not-found") => return ExtraResult::NotApplicable("The exact systemd unit named by this check was not found. The application may use another unit, layout or container; its absence was not established."),
        Some("loaded") => {},
        _ => return ExtraResult::Unavailable,
    }
    let (name, value, accepted, observed) = match property {
        ServiceProperty::State => {
            let Some(state) = values.get("ActiveState").copied().filter(|value| {
                [
                    "active",
                    "inactive",
                    "failed",
                    "activating",
                    "deactivating",
                    "maintenance",
                    "reloading",
                    "refreshing",
                ]
                .contains(value)
            }) else {
                return ExtraResult::Unavailable;
            };
            return available(format!("LoadState=loaded ActiveState={state}"), format!("The exact checked service unit is {state}; other application processes were not checked."), Outcome::Informational);
        }
        ServiceProperty::User => {
            let Some(user) = values.get("User").copied().filter(|value| {
                value.len() <= 64
                    && value
                        .bytes()
                        .all(|ch| ch.is_ascii_alphanumeric() || b"_-.".contains(&ch))
            }) else {
                return ExtraResult::Unavailable;
            };
            let root = user.is_empty() || user == "root" || user.parse::<u32>() == Ok(0);
            return available(format!("LoadState=loaded User={}", if root { "root-or-default" } else { "configured-identity" }),
                if root { "The checked unit starts as root by default; worker privilege changes were not checked." } else { "The checked unit declares a startup identity; its resolved UID and effective process privileges were not checked." }.into(), Outcome::Informational);
        }
        ServiceProperty::NoNewPrivileges => (
            "NoNewPrivileges",
            values.get("NoNewPrivileges").copied(),
            &["yes"][..],
            "gaining new privileges",
        ),
        ServiceProperty::PrivateTmp => (
            "PrivateTmp",
            values.get("PrivateTmp").copied(),
            &["yes", "disconnected"][..],
            "shared temporary-directory access",
        ),
        ServiceProperty::ProtectSystem => (
            "ProtectSystem",
            values.get("ProtectSystem").copied(),
            &["yes", "full", "strict"][..],
            "writes to system paths",
        ),
        ServiceProperty::ProtectHome => (
            "ProtectHome",
            values.get("ProtectHome").copied(),
            &["yes", "read-only", "tmpfs"][..],
            "home-directory access",
        ),
        ServiceProperty::RestrictSuid => (
            "RestrictSUIDSGID",
            values.get("RestrictSUIDSGID").copied(),
            &["yes"][..],
            "creation of setuid/setgid files",
        ),
        ServiceProperty::Umask => {
            let Some(mask) = values
                .get("UMask")
                .filter(|value| {
                    value.len() == 4
                        && value.starts_with('0')
                        && value.bytes().all(|ch| (b'0'..=b'7').contains(&ch))
                })
                .and_then(|value| u32::from_str_radix(value, 8).ok())
            else {
                return ExtraResult::Unavailable;
            };
            let accepted = mask & 0o022 == 0o022;
            return available(
                format!("LoadState=loaded UMask={mask:04o}"),
                if accepted {
                    "The checked unit's creation mask removes group and other write permissions."
                } else {
                    "The checked unit's creation mask can allow group or other write permissions."
                }
                .into(),
                Outcome::baseline(accepted),
            );
        }
    };
    let Some(value) = value.filter(|value| *value == "no" || accepted.contains(value)) else {
        return ExtraResult::Unavailable;
    };
    let enabled = accepted.contains(&value);
    available(
        format!("LoadState=loaded {name}={value}"),
        format!(
            "The checked unit {} restrictions on {observed} ({name}={value}).",
            if enabled {
                "requests"
            } else {
                "does not request"
            }
        ),
        Outcome::baseline(enabled),
    )
}

/// Check exact path type and numeric mode/ownership without opening application configuration.
fn path_metadata(facts: &Facts, key: &str, directory: bool, socket: bool) -> ExtraResult {
    let Some(source) = facts.get(key) else {
        return ExtraResult::Unavailable;
    };
    let kind = if directory {
        0o040000
    } else if socket {
        0o140000
    } else {
        0o100000
    };
    let Some((mode, uid, gid)) = file_metadata(source, kind) else {
        return ExtraResult::Unavailable;
    };
    let accepted = uid == 0 && mode & if socket { 0o007 } else { 0o022 } == 0;
    available(
        format!("mode={:04o} uid={uid} gid={gid}", mode & 0o7777),
        if accepted {
            "The named path meets this check's ownership and permission condition."
        } else {
            "Review the named path's ownership and access permissions."
        }
        .into(),
        Outcome::baseline(accepted),
    )
}

/// Validate a remote redacted projection before using any counter as evidence.
fn counters(source: &str, allowed: &[&str]) -> Option<BTreeMap<String, u32>> {
    let parsed = fields(source, allowed)?;
    if parsed.len() != allowed.len() || parsed.get("version") != Some(&"1") {
        return None;
    }
    parsed
        .into_iter()
        .map(|(key, value)| {
            value
                .bytes()
                .all(|byte| byte.is_ascii_digit())
                .then_some(value)?
                .parse::<u32>()
                .ok()
                .filter(|value| *value <= 100_000)
                .map(|value| (key.into(), value))
        })
        .collect()
}

/// Static declarations remain contextual even when a hardening-oriented declaration is present.
fn nginx(facts: &Facts, property: NginxProperty) -> ExtraResult {
    let Some(values) = facts.get("nginx_config").and_then(|source| {
        counters(
            source,
            &[
                "version",
                "includes",
                "tokensOff",
                "tokensExposed",
                "tokensUnknown",
                "autoindexOn",
                "autoindexOff",
                "autoindexUnknown",
                "legacyTls",
                "modernTls",
                "tlsUnknown",
            ],
        )
    }) else {
        return ExtraResult::Unavailable;
    };
    let (unsafe_key, other_key, unknown_key, subject) = match property {
        NginxProperty::Tokens => (
            "tokensExposed",
            "tokensOff",
            "tokensUnknown",
            "version-disclosure",
        ),
        NginxProperty::DirectoryListing => (
            "autoindexOn",
            "autoindexOff",
            "autoindexUnknown",
            "directory-listing",
        ),
        NginxProperty::TlsProtocols => (
            "legacyTls",
            "modernTls",
            "tlsUnknown",
            "obsolete TLS-protocol",
        ),
    };
    if values[unknown_key] > 0 {
        return ExtraResult::Unavailable;
    }
    let flagged = values[unsafe_key];
    let other = values[other_key];
    available(
        format!(
            "{unsafe_key}={flagged} {other_key}={other} includes={}",
            values["includes"]
        ),
        if flagged > 0 {
            format!("The named file contains {flagged} explicit {subject} {} to review; live policy was not verified.", if flagged == 1 { "declaration" } else { "declarations" })
        } else {
            format!("No explicit {subject} declaration needing attention was recognized in the named file; includes and live policy were not checked.")
        },
        if flagged > 0 {
            Outcome::Attention
        } else {
            Outcome::Informational
        },
    )
}

/// Report only redacted static Redis declarations, never a successful authentication or TLS claim.
fn redis(facts: &Facts, property: RedisProperty) -> ExtraResult {
    let Some(values) = facts.get("redis_config").and_then(|source| {
        counters(
            source,
            &[
                "version",
                "includes",
                "protectedYes",
                "protectedNo",
                "protectedUnknown",
                "bindLoopback",
                "bindOther",
                "bindUnknown",
                "plainEnabled",
                "plainDisabled",
                "plainUnknown",
                "tlsEnabled",
                "tlsDisabled",
                "tlsUnknown",
                "aclFile",
                "aclUsers",
                "legacyPassword",
            ],
        )
    }) else {
        return ExtraResult::Unavailable;
    };
    let (keys, observation, attention): (&[&str], String, bool) = match property {
        RedisProperty::ProtectedMode => {
            if values["protectedUnknown"] > 0 { return ExtraResult::Unavailable; }
            (&["protectedYes", "protectedNo"], if values["protectedNo"] > 0 { "The named file explicitly disables protected mode; effective binding and authentication were not verified." } else { "The named file does not contain a recognized protected-mode no declaration; effective server policy was not verified." }.into(), values["protectedNo"] > 0)
        },
        RedisProperty::Binding => {
            if values["bindUnknown"] > 0 { return ExtraResult::Unavailable; }
            (&["bindLoopback", "bindOther"], if values["bindOther"] > 0 { "A non-loopback binding is declared in the named file; external reachability was not tested." } else if values["bindLoopback"] > 0 { "Only loopback addresses were recognized in this file's bind declarations; runtime overrides were not checked." } else { "No bind declaration was recognized in the named file; runtime binding was not checked." }.into(), false)
        },
        RedisProperty::Tls => {
            if values["plainUnknown"] > 0 || values["tlsUnknown"] > 0 { return ExtraResult::Unavailable; }
            (&["plainEnabled", "plainDisabled", "tlsEnabled", "tlsDisabled"], "The named file's plaintext/TLS port declarations were counted; encryption at the actual endpoint was not verified.".into(), false)
        },
        RedisProperty::Authentication => (&["aclFile", "aclUsers", "legacyPassword"], "ACL and legacy-password declaration counts are available; no password, ACL content or effective authentication was inspected.".into(), false),
    };
    let evidence = keys
        .iter()
        .map(|key| format!("{key}={}", values[*key]))
        .collect::<Vec<_>>()
        .join(" ");
    available(
        format!("{evidence} includes={}", values["includes"]),
        observation,
        if attention {
            Outcome::Attention
        } else {
            Outcome::Informational
        },
    )
}

/// Strict deserialization rejects repeated, omitted, extra and wrongly typed projected fields.
#[derive(serde::Deserialize)]
#[serde(rename_all = "PascalCase", deny_unknown_fields)]
struct DockerInfo {
    security_options: Vec<String>,
    logging_driver: String,
    live_restore_enabled: bool,
    #[serde(rename = "OSType")]
    os_type: String,
}

/// Accept only the four allowlisted typed fields from the successful local Engine projection.
fn docker(facts: &Facts, property: DockerProperty) -> ExtraResult {
    let Some(source) = facts
        .get("docker_info")
        .filter(|source| source.len() <= 8192)
    else {
        return ExtraResult::Unavailable;
    };
    let Ok(values) = serde_json::from_str::<DockerInfo>(source) else {
        return ExtraResult::Unavailable;
    };
    let options = &values.security_options;
    if values.os_type != "linux"
        || options.len() > 32
        || options.iter().any(|option| {
            option.is_empty()
                || option.len() > 128
                || !option.bytes().all(|ch| ch.is_ascii_graphic())
        })
    {
        return ExtraResult::Unavailable;
    }
    let Some(logging) = Some(values.logging_driver.as_str()).filter(|value| {
        !value.is_empty()
            && value.len() <= 32
            && value
                .bytes()
                .all(|ch| ch.is_ascii_alphanumeric() || b"_-".contains(&ch))
    }) else {
        return ExtraResult::Unavailable;
    };
    let restore = values.live_restore_enabled;
    let enabled = |name: &str| {
        options
            .iter()
            .any(|option| option.split(',').next() == Some(name))
    };
    match property {
        DockerProperty::Seccomp => {
            let seccomp = enabled("name=seccomp");
            available(format!("seccomp={seccomp}"), if seccomp { "The checked local engine reports seccomp support; individual container profiles were not checked." } else { "The checked local engine did not report seccomp support; review engine and workload restrictions." }.into(), Outcome::baseline(seccomp))
        },
        DockerProperty::Isolation => available(format!("rootless={} userns={}", enabled("name=rootless"), enabled("name=userns")), "The checked local engine's rootless/user-namespace options were recorded; per-user sockets and individual containers were not checked.".into(), Outcome::Informational),
        DockerProperty::Logging => available(format!("LoggingDriver={logging}"), format!("The checked engine's default logging driver is {logging}; per-container settings and rotation were not checked."), if logging == "none" { Outcome::Attention } else { Outcome::Informational }),
        DockerProperty::LiveRestore => available(format!("LiveRestoreEnabled={restore}"), format!("Live restore is {} on the checked local engine; recovery behavior was not tested.", if restore { "enabled" } else { "disabled" }), Outcome::Informational),
    }
}

/// Dispatch application evidence without changing status when collection or parsing is uncertain.
pub(super) fn evaluate(facts: &Facts, check: Check) -> ExtraResult {
    match check {
        Check::Service { key, property } => service(facts, key, property),
        Check::Metadata {
            key,
            directory,
            socket,
        } => path_metadata(facts, key, directory, socket),
        Check::Nginx(property) => nginx(facts, property),
        Check::Redis(property) => redis(facts, property),
        Check::Docker(property) => docker(facts, property),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::facts::Fact;

    /// Fixtures contain only bounded synthetic records, never a real application or host.
    fn facts(key: &str, output: &str, status: u32) -> Facts {
        Facts(BTreeMap::from([(
            key.into(),
            Fact {
                output: output.into(),
                status,
            },
        )]))
    }

    #[test]
    fn service_scope_missing_unknown_and_independent_properties() {
        let check = Check::Service {
            key: "nginx_service",
            property: ServiceProperty::NoNewPrivileges,
        };
        assert!(matches!(
            evaluate(&facts("nginx_service", "LoadState=not-found", 0), check),
            ExtraResult::NotApplicable(_)
        ));
        assert!(matches!(
            evaluate(&facts("nginx_service", "LoadState=not-found", 1), check),
            ExtraResult::Unavailable
        ));
        assert!(matches!(
            evaluate(
                &facts(
                    "nginx_service",
                    "LoadState=loaded\nNoNewPrivileges=maybe",
                    0
                ),
                check
            ),
            ExtraResult::Unavailable
        ));
        assert!(matches!(
            evaluate(
                &facts(
                    "nginx_service",
                    "LoadState=loaded\nNoNewPrivileges=yes\nNoNewPrivileges=no",
                    0
                ),
                check
            ),
            ExtraResult::Unavailable
        ));
        assert!(matches!(
            evaluate(
                &facts(
                    "nginx_service",
                    "LoadState=loaded\nNoNewPrivileges=yes\nPrivateTmp=unfamiliar",
                    0
                ),
                check
            ),
            ExtraResult::Available {
                outcome: Outcome::Passed,
                ..
            }
        ));
        let state = evaluate(
            &facts("nginx_service", "LoadState=loaded\nActiveState=inactive", 0),
            Check::Service {
                key: "nginx_service",
                property: ServiceProperty::State,
            },
        );
        assert!(
            matches!(state, ExtraResult::Available { outcome: Outcome::Informational, observed, .. } if observed.contains("exact checked service unit"))
        );
    }

    #[test]
    fn service_masks_and_names_do_not_infer_worker_privileges() {
        let mask = Check::Service {
            key: "mysql_service",
            property: ServiceProperty::Umask,
        };
        assert!(matches!(
            evaluate(
                &facts("mysql_service", "LoadState=loaded\nUMask=0022", 0),
                mask
            ),
            ExtraResult::Available {
                outcome: Outcome::Passed,
                ..
            }
        ));
        assert!(matches!(
            evaluate(
                &facts("mysql_service", "LoadState=loaded\nUMask=0002", 0),
                mask
            ),
            ExtraResult::Available {
                outcome: Outcome::Attention,
                ..
            }
        ));
        assert!(matches!(
            evaluate(
                &facts("mysql_service", "LoadState=loaded\nUMask=0999", 0),
                mask
            ),
            ExtraResult::Unavailable
        ));
        let user = Check::Service {
            key: "mysql_service",
            property: ServiceProperty::User,
        };
        assert!(
            matches!(evaluate(&facts("mysql_service", "LoadState=loaded\nUser=", 0), user), ExtraResult::Available { outcome: Outcome::Informational, observed, .. } if observed.contains("worker privilege changes were not checked"))
        );
    }

    #[test]
    fn application_path_metadata_requires_types_and_root_ownership() {
        let config = Check::Metadata {
            key: "nginx_config_meta",
            directory: false,
            socket: false,
        };
        assert!(matches!(
            evaluate(&facts("nginx_config_meta", "81a4 0 0", 0), config),
            ExtraResult::Available {
                outcome: Outcome::Passed,
                ..
            }
        ));
        assert!(matches!(
            evaluate(&facts("nginx_config_meta", "81b6 0 0", 0), config),
            ExtraResult::Available {
                outcome: Outcome::Attention,
                ..
            }
        ));
        assert!(matches!(
            evaluate(&facts("nginx_config_meta", "41ed 0 0", 0), config),
            ExtraResult::Unavailable
        ));
        let socket = Check::Metadata {
            key: "docker_socket",
            directory: false,
            socket: true,
        };
        assert!(matches!(
            evaluate(&facts("docker_socket", "c1b0 0 998", 0), socket),
            ExtraResult::Available {
                outcome: Outcome::Passed,
                ..
            }
        ));
        assert!(matches!(
            evaluate(&facts("docker_socket", "c1b6 0 998", 0), socket),
            ExtraResult::Available {
                outcome: Outcome::Attention,
                ..
            }
        ));
    }

    #[test]
    fn docker_projection_requires_success_types_and_no_extra_fields() {
        let valid = r#"{"SecurityOptions":["name=seccomp,profile=builtin","name=cgroupns"],"LoggingDriver":"json-file","LiveRestoreEnabled":false,"OSType":"linux"}"#;
        assert!(matches!(
            evaluate(
                &facts("docker_info", valid, 0),
                Check::Docker(DockerProperty::Seccomp)
            ),
            ExtraResult::Available {
                outcome: Outcome::Passed,
                ..
            }
        ));
        assert!(matches!(
            evaluate(
                &facts("docker_info", valid, 1),
                Check::Docker(DockerProperty::Seccomp)
            ),
            ExtraResult::Unavailable
        ));
        assert!(matches!(
            evaluate(
                &facts("docker_info", &valid.replace("false", "\"false\""), 0),
                Check::Docker(DockerProperty::Seccomp)
            ),
            ExtraResult::Unavailable
        ));
        assert!(matches!(
            evaluate(
                &facts(
                    "docker_info",
                    &valid.replace(
                        "\"OSType\":\"linux\"",
                        "\"OSType\":\"linux\",\"Secret\":\"withheld\""
                    ),
                    0
                ),
                Check::Docker(DockerProperty::Seccomp)
            ),
            ExtraResult::Unavailable
        ));
        assert!(matches!(
            evaluate(
                &facts(
                    "docker_info",
                    &valid.replace("name=seccomp", "name=not-seccomp"),
                    0
                ),
                Check::Docker(DockerProperty::Seccomp)
            ),
            ExtraResult::Available {
                outcome: Outcome::Attention,
                ..
            }
        ));
        assert!(matches!(
            evaluate(
                &facts(
                    "docker_info",
                    &valid.replace(
                        "\"OSType\":\"linux\"",
                        "\"OSType\":\"linux\",\"LoggingDriver\":\"none\""
                    ),
                    0
                ),
                Check::Docker(DockerProperty::Logging)
            ),
            ExtraResult::Unavailable
        ));
    }

    /// Extract only the production function body; fixtures substitute paths, never scanner policy.
    #[cfg(target_os = "linux")]
    fn projection_source(id: &str, function: &str) -> String {
        let source = script(id);
        let start = source.find(&format!("{function}() {{\n")).unwrap();
        let end = source[start..].find("\n}\n").unwrap();
        source[start..start + end + 2].to_string()
    }

    /// A disposable file replaces the fixed path under the bounded fixture harness.
    #[cfg(target_os = "linux")]
    fn project_file(
        id: &str,
        function: &str,
        original_path: &str,
        path: &std::path::Path,
    ) -> std::process::Output {
        project_file_with_delay(id, function, original_path, path, "0")
    }

    /// Simulate time spent approving sudo before the protected command's own execution timer starts.
    #[cfg(target_os = "linux")]
    fn project_file_with_delay(
        id: &str,
        function: &str,
        original_path: &str,
        path: &std::path::Path,
        delay: &str,
    ) -> std::process::Output {
        let source = projection_source(id, function)
            .replace(original_path, "\"$APP_TEST_FILE\"")
            .replace("/etc/nginx", "\"$APP_TEST_PARENT\"")
            .replace("/etc/redis", "\"$APP_TEST_PARENT\"");
        std::process::Command::new("/usr/bin/timeout")
            .args(["--signal=TERM", "--kill-after=1s", "10s", "/bin/sh", "-c", &format!("collection_mode=user\nsudo_nonce=fixture-bound-nonce\nprotected() {{ if [ \"$APP_TEST_DELAY\" != 0 ]; then sleep \"$APP_TEST_DELAY\"; fi; /usr/bin/timeout --signal=TERM --kill-after=1s 4s \"$@\"; }}\n{source}\n{function}")])
            .env_clear().env("PATH", "/usr/bin:/bin").env("LC_ALL", "C").env("APP_TEST_FILE", path).env("APP_TEST_PARENT", path.parent().unwrap()).env("APP_TEST_DELAY", delay)
            .output().unwrap()
    }

    /// Query-tool availability is a fixture prerequisite, never an application dependency installer.
    #[cfg(target_os = "linux")]
    fn docker_fixture_tools_available() -> bool {
        std::process::Command::new("/bin/sh")
            .args([
                "-c",
                "command -v jq >/dev/null && command -v curl >/dev/null",
            ])
            .status()
            .unwrap()
            .success()
    }

    /// A fixed mock producer supplies a disposable body and status after an optional approval delay.
    #[cfg(target_os = "linux")]
    fn project_docker(path: &std::path::Path, status: &str, delay: &str) -> std::process::Output {
        let source = projection_source("docker", "docker_projection")
            .replace("/var/run/docker.sock", "\"$APP_TEST_FILE\"");
        std::process::Command::new("/usr/bin/timeout")
            .args(["--signal=TERM", "--kill-after=1s", "10s", "/bin/sh", "-c", &format!("collection_mode=sudo\nsudo_nonce=fixture-bound-nonce\nprotected() {{ if [ \"$APP_TEST_DELAY\" != 0 ]; then sleep \"$APP_TEST_DELAY\"; fi; cat \"$APP_TEST_FILE\"; return \"$APP_TEST_STATUS\"; }}\n{source}\ndocker_projection")])
            .env_clear().env("PATH", "/usr/bin:/bin").env("LC_ALL", "C").env("APP_TEST_FILE", path).env("APP_TEST_STATUS", status).env("APP_TEST_DELAY", delay)
            .output().unwrap()
    }

    /// Static projections remove secrets and never upgrade scoped declarations into live-policy passes.
    #[cfg(target_os = "linux")]
    #[test]
    fn named_application_projections_redact_secrets_and_preserve_scope() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("application.conf");
        std::fs::write(&file, "http {\nserver_tokens off;\nautoindex off;\nssl_protocols TLSv1.2 TLSv1.3;\ninclude /private-layout/secrets.conf;\nproxy_set_header Authorization \"Bearer private-proxy-secret\nserver_tokens on;\n\";\n}\n").unwrap();
        let output = project_file("nginx", "nginx_projection", "/etc/nginx/nginx.conf", &file);
        assert!(output.status.success());
        let source = String::from_utf8(output.stdout).unwrap();
        assert!(!source.contains("private") && !source.contains("Authorization"));
        assert!(source.contains("includes=1\n"));
        assert!(matches!(
            evaluate(
                &facts("nginx_config", &source, 0),
                Check::Nginx(NginxProperty::Tokens)
            ),
            ExtraResult::Available {
                outcome: Outcome::Informational,
                ..
            }
        ));
        std::fs::write(
            &file,
            "server_tokens $unresolved;\nssl_protocols TLSv1 TLSv1.2;\n",
        )
        .unwrap();
        let output = project_file("nginx", "nginx_projection", "/etc/nginx/nginx.conf", &file);
        let source = String::from_utf8(output.stdout).unwrap();
        assert!(matches!(
            evaluate(
                &facts("nginx_config", &source, 0),
                Check::Nginx(NginxProperty::Tokens)
            ),
            ExtraResult::Unavailable
        ));
        assert!(matches!(
            evaluate(
                &facts("nginx_config", &source, 0),
                Check::Nginx(NginxProperty::TlsProtocols)
            ),
            ExtraResult::Available {
                outcome: Outcome::Attention,
                ..
            }
        ));
        std::fs::write(&file, "x".repeat(16385)).unwrap();
        let output = project_file("nginx", "nginx_projection", "/etc/nginx/nginx.conf", &file);
        assert_eq!(
            output.status.code(),
            Some(65),
            "An unterminated lexical statement has its own small bound"
        );
        assert!(output.stdout.is_empty());
        std::fs::write(&file, "protected-mode yes\nbind 127.0.0.1 ::1\nport 0\ntls-port 6379\ninclude /private-layout/redis.conf\nrequirepass \"private-redis-password\"\naclfile /private-layout/users.acl\nuser private-user on >private-acl-password #private-acl-hash ~* +@all\n").unwrap();
        let output = project_file("redis", "redis_projection", "/etc/redis/redis.conf", &file);
        assert!(output.status.success());
        let source = String::from_utf8(output.stdout).unwrap();
        assert!(!source.contains("private") && !source.contains("+@all"));
        assert!(source.contains("aclUsers=1\n") && source.contains("legacyPassword=1\n"));
        assert!(matches!(
            evaluate(
                &facts("redis_config", &source, 0),
                Check::Redis(RedisProperty::ProtectedMode)
            ),
            ExtraResult::Available {
                outcome: Outcome::Informational,
                ..
            }
        ));
        assert!(matches!(
            evaluate(
                &facts("redis_config", &source, 0),
                Check::Redis(RedisProperty::Authentication)
            ),
            ExtraResult::Available {
                outcome: Outcome::Informational,
                ..
            }
        ));
        std::fs::write(
            &file,
            "protected-mode no\nbind unknown-hostname\ntls-port invalid\n",
        )
        .unwrap();
        let output = project_file("redis", "redis_projection", "/etc/redis/redis.conf", &file);
        let source = String::from_utf8(output.stdout).unwrap();
        assert!(matches!(
            evaluate(
                &facts("redis_config", &source, 0),
                Check::Redis(RedisProperty::ProtectedMode)
            ),
            ExtraResult::Available {
                outcome: Outcome::Attention,
                ..
            }
        ));
        assert!(matches!(
            evaluate(
                &facts("redis_config", &source, 0),
                Check::Redis(RedisProperty::Binding)
            ),
            ExtraResult::Unavailable
        ));
        assert!(matches!(
            evaluate(
                &facts("redis_config", &source, 0),
                Check::Redis(RedisProperty::Tls)
            ),
            ExtraResult::Unavailable
        ));
        for (id, function, original) in [
            ("nginx", "nginx_projection", "/etc/nginx/nginx.conf"),
            ("redis", "redis_projection", "/etc/redis/redis.conf"),
        ] {
            std::fs::write(&file, "x".repeat(524289)).unwrap();
            let output = project_file(id, function, original, &file);
            assert_eq!(output.status.code(), Some(65));
            assert!(output.stdout.is_empty());
        }
        std::fs::remove_file(&file).unwrap();
        for (id, function, original) in [
            ("nginx", "nginx_projection", "/etc/nginx/nginx.conf"),
            ("redis", "redis_projection", "/etc/redis/redis.conf"),
        ] {
            let output = project_file(id, function, original, &file);
            assert_eq!(output.status.code(), Some(66));
            assert!(output.stdout.is_empty());
        }
        std::os::unix::fs::symlink(folder.path().join("missing-target"), &file).unwrap();
        for (id, function, original) in [
            ("nginx", "nginx_projection", "/etc/nginx/nginx.conf"),
            ("redis", "redis_projection", "/etc/redis/redis.conf"),
        ] {
            let output = project_file(id, function, original, &file);
            assert_eq!(
                output.status.code(),
                Some(1),
                "A dangling target is not confirmed permission denial"
            );
            assert!(output.stdout.is_empty());
        }
        std::fs::remove_file(&file).unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(folder.path(), std::fs::Permissions::from_mode(0o111)).unwrap();
        for (id, function, original) in [
            ("nginx", "nginx_projection", "/etc/nginx/nginx.conf"),
            ("redis", "redis_projection", "/etc/redis/redis.conf"),
        ] {
            let output = project_file(id, function, original, &file);
            assert!(
                matches!(output.status.code(), Some(1 | 66)),
                "A missing file under an execute-only parent is not confirmed permission denial"
            );
            assert!(output.stdout.is_empty());
        }
        std::fs::set_permissions(folder.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    }

    /// The real jq gate sees only disposable bodies, never a live Docker endpoint or CLI plugin.
    #[cfg(target_os = "linux")]
    #[test]
    fn docker_collector_requires_complete_successful_bounded_transfer() {
        if !docker_fixture_tools_available() {
            eprintln!("Docker projection fixture requires the optional jq and curl system tools.");
            return;
        }
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("engine.json");
        let run = |status: &str| project_docker(&file, status, "0");
        let valid = r#"{"SecurityOptions":["name=seccomp,profile=builtin"],"LoggingDriver":"json-file","LiveRestoreEnabled":false,"OSType":"linux","HTTPProxy":"http://private-user:private-password@proxy.invalid","Labels":["private-label"]}"#;
        std::fs::write(&file, valid).unwrap();
        let output = run("0");
        assert!(output.status.success());
        let projected = String::from_utf8(output.stdout).unwrap();
        assert!(!projected.contains("private") && !projected.contains("HTTPProxy"));
        assert!(matches!(
            evaluate(
                &facts("docker_info", &projected, 0),
                Check::Docker(DockerProperty::Seccomp)
            ),
            ExtraResult::Available {
                outcome: Outcome::Passed,
                ..
            }
        ));
        for status in ["7", "22", "28", "77", "124", "137"] {
            let output = run(status);
            assert!(
                !output.status.success(),
                "valid JSON cannot hide transfer exit {status}"
            );
            assert!(output.stdout.is_empty());
        }
        for body in [
            "{\"SecurityOptions\":",
            "{}\n{}",
            "{}\nZYNC-CURL-other-nonce-status:0\n",
        ] {
            std::fs::write(&file, body).unwrap();
            let output = run("0");
            assert_eq!(output.status.code(), Some(65));
            assert!(output.stdout.is_empty());
        }
        std::fs::write(
            &file,
            format!("{{\"padding\":\"{}\"}}", "x".repeat(600_000)),
        )
        .unwrap();
        let output = run("0");
        assert_eq!(output.status.code(), Some(65));
        assert!(output.stdout.is_empty());
    }

    /// Parser consumers must survive a human approval delay longer than a protected command's timer.
    #[cfg(target_os = "linux")]
    #[test]
    fn application_consumers_wait_for_delayed_protected_producers() {
        let folder = tempfile::tempdir().unwrap();
        let nginx = folder.path().join("nginx.conf");
        let redis = folder.path().join("redis.conf");
        let docker = folder.path().join("docker.json");
        std::fs::write(&nginx, "server_tokens off;\n").unwrap();
        std::fs::write(&redis, "protected-mode yes\n").unwrap();
        std::fs::write(&docker, r#"{"SecurityOptions":["name=seccomp,profile=builtin"],"LoggingDriver":"json-file","LiveRestoreEnabled":false,"OSType":"linux"}"#).unwrap();
        std::thread::scope(|scope| {
            let nginx_run = scope.spawn(|| {
                project_file_with_delay(
                    "nginx",
                    "nginx_projection",
                    "/etc/nginx/nginx.conf",
                    &nginx,
                    "5",
                )
            });
            let redis_run = scope.spawn(|| {
                project_file_with_delay(
                    "redis",
                    "redis_projection",
                    "/etc/redis/redis.conf",
                    &redis,
                    "5",
                )
            });
            let docker_run = docker_fixture_tools_available()
                .then(|| scope.spawn(|| project_docker(&docker, "0", "5")));
            for (id, key, output, check) in [
                (
                    "nginx",
                    "nginx_config",
                    nginx_run.join().unwrap(),
                    Check::Nginx(NginxProperty::Tokens),
                ),
                (
                    "redis",
                    "redis_config",
                    redis_run.join().unwrap(),
                    Check::Redis(RedisProperty::ProtectedMode),
                ),
            ] {
                assert!(
                    output.status.success(),
                    "{id} consumer must wait for approval"
                );
                let source = String::from_utf8(output.stdout).unwrap();
                assert!(matches!(
                    evaluate(&facts(key, &source, 0), check),
                    ExtraResult::Available { .. }
                ));
            }
            if let Some(run) = docker_run {
                let output = run.join().unwrap();
                assert!(
                    output.status.success(),
                    "Docker consumers must wait for approval"
                );
                let source = String::from_utf8(output.stdout).unwrap();
                assert!(matches!(
                    evaluate(
                        &facts("docker_info", &source, 0),
                        Check::Docker(DockerProperty::Seccomp)
                    ),
                    ExtraResult::Available {
                        outcome: Outcome::Passed,
                        ..
                    }
                ));
            }
        });
    }

    #[test]
    fn app_registry_has_unique_ids_aligned_keys_and_no_runtime_shell_selection() {
        let mut ids = std::collections::BTreeSet::new();
        for id in [
            "nginx",
            "apache",
            "docker",
            "postgresql",
            "mysql",
            "redis",
            "jenkins",
        ] {
            assert!(!rules(id).is_empty());
            let actual: Vec<_> = script(id)
                .lines()
                .filter_map(|line| {
                    line.strip_prefix("collect ")
                        .and_then(|line| line.split_whitespace().next())
                })
                .collect();
            assert_eq!(actual, keys(id));
            for rule in rules(id) {
                assert!(ids.insert(rule.id));
                assert!(keys(id).contains(&rule.fact_key));
                assert!(rule.scope.len() <= 500 && !rule.expected.is_empty());
            }
        }
        assert!(rules("untrusted; command").is_empty());
        assert_eq!(script("untrusted; command"), "");
    }
}
