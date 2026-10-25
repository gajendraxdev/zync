//! Concise authored scope keeps decisive evidence limits visible without rewriting full rule metadata.
use super::{
    catalog::Evaluation,
    modules::{applications, system},
    runtime,
    wording::KernelSetting,
};

const CURRENT_KERNEL: &str =
    "Current kernel value only; persistence and workload compatibility were not checked.";
const NAMED_FILE: &str =
    "Named-path ownership and permissions only; parent paths, extra access rules and effective access were not checked.";
const LOCAL_ACCOUNTS: &str =
    "Local account or group counts only; directory services, login rules and effective access were not checked.";

/// Select scope from the compiled evaluation type, never from remote text or localized finding names.
pub(super) fn scope_summary(evaluation: Evaluation) -> &'static str {
    match evaluation {
        Evaluation::KernelRange { setting, .. } | Evaluation::KernelObservation(setting) => {
            match setting {
                KernelSetting::Ipv4Redirects
                | KernelSetting::SendRedirects
                | KernelSetting::SourceRoute
                | KernelSetting::ReversePath
                | KernelSetting::Ipv6Redirects =>
                    "Current all-interface setting only; individual interfaces and persistence were not checked.",
                KernelSetting::Aslr
                | KernelSetting::Ptrace
                | KernelSetting::KernelPointers
                | KernelSetting::KernelLog
                | KernelSetting::HardLinks
                | KernelSetting::SymbolicLinks
                | KernelSetting::Bpf => CURRENT_KERNEL,
                KernelSetting::CoreDumps =>
                    "Current dump-policy flag only; actual dump handling, destinations and persistence were not checked.",
            }
        }
        Evaluation::File { .. } => NAMED_FILE,
        Evaluation::Ssh { .. } =>
            "SSH defaults only; running-server options and connection-specific rules were not verified.",
        Evaluation::Account { .. } | Evaluation::EmptyPasswords => LOCAL_ACCOUNTS,
        Evaluation::Listeners =>
            "Listeners in the current network namespace only; internet access and cloud firewalls were not tested.",
        Evaluation::Firewall =>
            "This firewall tool in the current network namespace only; internet access and cloud firewalls were not tested.",
        Evaluation::Mount =>
            "Options on the containing mount only; a separate mount or exploitable weakness is not established.",
        Evaluation::AptPolicy =>
            "Two APT update settings only; update history and package freshness were not checked.",
        Evaluation::PackageHealth =>
            "Local dpkg consistency only; security advisories and package freshness were not checked.",
        Evaluation::Reboot =>
            "Debian/Ubuntu reboot marker only; installed fixes in the running kernel and services were not verified.",
        Evaluation::Journal =>
            "The named journal service's state only; log contents, retention and delivery were not checked.",
        Evaluation::SshService =>
            "Named SSH unit settings only; custom startup paths and running-process protections were not verified.",
        Evaluation::SshPolicy(_) =>
            "Current SSH config preview for captured numeric connection inputs with UseDNS=no; loaded server policy is not verified.",
        Evaluation::DockerWorkload(_) =>
            "Configured settings in up to 20 running containers on this engine; incomplete reads limit coverage, and images and running-process protection are not assessed.",
        Evaluation::ExtendedHost(check) => extended_scope(check),
        Evaluation::Application(check) => application_scope(check),
        Evaluation::Runtime(check) => runtime_scope(check),
    }
}

/// Additional host summaries preserve the distinction between a setting, a counter and enforced policy.
fn extended_scope(check: system::Check) -> &'static str {
    use system::Check::*;
    match check {
        Fifos | Regular => CURRENT_KERNEL,
        Perf =>
            "Current profiling setting only; process capabilities and distribution-specific extensions were not checked.",
        Kexec =>
            "Current replacement-kernel flag only; Secure Boot and crash-recovery policy were not verified.",
        Modules =>
            "Current module-loading flag only; loaded modules, signing policy and future driver needs were not checked.",
        Uring =>
            "New I/O-ring creation setting only; existing rings, capabilities and the permitted group were not checked.",
        Sysrq =>
            "Keyboard permission mask only; privileged emergency-trigger access was not checked.",
        Syncookies =>
            "Current network setting only; capacity and denial-of-service protection were not tested.",
        BroadcastIcmp =>
            "Current IPv4 namespace setting only; firewall behavior and external traffic were not tested.",
        BogusIcmp =>
            "Current IPv4 warning-log setting only; this does not establish that malformed traffic is blocked.",
        Ipv4Forward | Ipv6Forward =>
            "Current namespace-wide forwarding setting only; routes, individual interfaces and forwarding firewalls were not evaluated.",
        GroupFile | GshadowFile => NAMED_FILE,
        SudoersFile =>
            "Main sudo policy metadata only; policy contents, includes and effective privileges were not checked.",
        CrontabFile =>
            "Main crontab metadata only; scheduled commands, other crontabs and timers were not checked.",
        DuplicateLogins | NonshadowPasswords | DuplicateGroupNames | DuplicateGids => LOCAL_ACCOUNTS,
        Lsm =>
            "Active security-module names only; enforcement and application coverage were not verified.",
        Selinux =>
            "Global SELinux mode only; per-application policy and enforcement were not audited.",
        Apparmor =>
            "Loaded policy-mode counts only; running processes and application coverage were not checked.",
        AuditEnabled =>
            "Kernel audit-enabled flag only; rules, event completeness and retention were not checked.",
        AuditLost =>
            "Cumulative lost-event counter only; audit logs, earlier resets and event completeness were not checked.",
        TimeSync =>
            "Reported synchronization flag only; clock accuracy, time sources and alternative services were not tested.",
    }
}

/// Named configuration and service summaries never turn declarations into claims about a running application.
fn application_scope(check: applications::Check) -> &'static str {
    match check {
        applications::Check::Service { .. } =>
            "Named service-unit settings only; running-process protection and application security were not verified.",
        applications::Check::Metadata { .. } => NAMED_FILE,
        applications::Check::Nginx(_) | applications::Check::Redis(_) =>
            "Named-file declarations only; includes, overrides and running-server behavior were not verified.",
        applications::Check::Docker(_) =>
            "Reported settings from the default local engine only; individual workloads and other engines were not verified.",
    }
}

/// Runtime summaries describe the selected observation, including current-file and simulated-command limits.
fn runtime_scope(check: runtime::Check) -> &'static str {
    use runtime::Check::*;
    match check {
        PgPassword =>
            "Current password-hash default only; existing password hashes were not inspected.",
        PgSuperusers =>
            "Login-superuser count only; grants and reachable authentication paths were not checked.",
        PgHbaErrors | PgHbaTrust =>
            "Current authentication-file diagnostics only; rule ordering, loaded policy and reachability were not verified.",
        PgSsl | PgRowSecurity | PgConnectionLogging | PgLoggingCollector =>
            "Selected settings for this database connection only; other roles, databases and external access were not assessed.",
        MysqlFileScope =>
            "Reported file-operation scope only; directory permissions and file contents were not inspected.",
        MysqlAdmins =>
            "Legacy administrator-privilege count only; dynamic privileges and all effective grants were not assessed.",
        MysqlTransport | MysqlLocalInfile | MysqlDns | MysqlGeneralLog =>
            "Selected settings on this MySQL instance only; all grants, clients and external access were not assessed.",
        RedisDefaultAdmin =>
            "Default-account command simulations only; commands were not executed and full account authorization was not verified.",
        RedisProtected | RedisBind | RedisTls | RedisPersistence | RedisEviction =>
            "Selected settings on this Redis endpoint only; stored data, full ACL policy and external access were not assessed.",
        JenkinsAnonymous =>
            "One anonymous metadata request only; other endpoints, jobs and credential permissions were not tested.",
        JenkinsSecurity | JenkinsExecutors | JenkinsCsrf =>
            "Selected Jenkins metadata only; some fields may be public, and complete access control was not verified.",
    }
}

#[cfg(test)]
mod tests;
