//! Additional host checks interpret fixed, count-only or explicitly selected runtime facts.
use super::ExtraResult;
use crate::security::{
    catalog::{ApplicabilityPolicy, Category, Evaluation, RuleDefinition},
    facts::{file_metadata, Facts},
    hardening::Outcome,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::security) enum Check {
    Fifos,
    Regular,
    Perf,
    Kexec,
    Modules,
    Sysrq,
    Uring,
    Syncookies,
    BroadcastIcmp,
    BogusIcmp,
    Ipv4Forward,
    Ipv6Forward,
    GroupFile,
    GshadowFile,
    SudoersFile,
    CrontabFile,
    DuplicateLogins,
    NonshadowPasswords,
    DuplicateGroupNames,
    DuplicateGids,
    Lsm,
    Selinux,
    Apparmor,
    AuditEnabled,
    AuditLost,
    TimeSync,
}

pub(super) const KEYS: &[&str] = &[
    "ext_fifos",
    "ext_regular",
    "ext_perf",
    "ext_kexec",
    "ext_modules",
    "ext_sysrq",
    "ext_uring",
    "ext_syncookies",
    "ext_broadcast_icmp",
    "ext_bogus_icmp",
    "ext_ipv4_forward",
    "ext_ipv6_forward",
    "ext_group_file",
    "ext_gshadow_file",
    "ext_sudoers_file",
    "ext_crontab_file",
    "ext_shadow_group",
    "ext_account_counts",
    "ext_group_counts",
    "ext_lsm",
    "ext_selinux",
    "ext_apparmor",
    "ext_audit",
    "ext_time_sync",
];
pub(super) const SCRIPT: &str = include_str!("../collectors/extended-host.sh");

/// Keep stable keys independent of enum spelling and shared aggregate facts explicit.
impl Check {
    /// Map one compiled check to its fixed record, including explicitly shared aggregate records.
    pub(super) const fn key(self) -> &'static str {
        match self {
            Self::Fifos => "ext_fifos",
            Self::Regular => "ext_regular",
            Self::Perf => "ext_perf",
            Self::Kexec => "ext_kexec",
            Self::Modules => "ext_modules",
            Self::Sysrq => "ext_sysrq",
            Self::Uring => "ext_uring",
            Self::Syncookies => "ext_syncookies",
            Self::BroadcastIcmp => "ext_broadcast_icmp",
            Self::BogusIcmp => "ext_bogus_icmp",
            Self::Ipv4Forward => "ext_ipv4_forward",
            Self::Ipv6Forward => "ext_ipv6_forward",
            Self::GroupFile => "ext_group_file",
            Self::GshadowFile => "ext_gshadow_file",
            Self::SudoersFile => "ext_sudoers_file",
            Self::CrontabFile => "ext_crontab_file",
            Self::DuplicateLogins | Self::NonshadowPasswords => "ext_account_counts",
            Self::DuplicateGroupNames | Self::DuplicateGids => "ext_group_counts",
            Self::Lsm => "ext_lsm",
            Self::Selinux => "ext_selinux",
            Self::Apparmor => "ext_apparmor",
            Self::AuditEnabled | Self::AuditLost => "ext_audit",
            Self::TimeSync => "ext_time_sync",
        }
    }
}

/// Supply common revision/applicability metadata once for this compiled module.
const fn rule(
    check: Check,
    id: &'static str,
    title: &'static str,
    target: &'static str,
    expected: &'static str,
    rationale: &'static str,
    scope: &'static str,
    guidance: &'static str,
    reference: &'static str,
    category: Category,
) -> RuleDefinition {
    RuleDefinition {
        id,
        fact_key: check.key(),
        title,
        target,
        expected,
        rationale,
        scope,
        guidance,
        reference,
        category,
        rule_version: "1",
        reviewed_at: "2026-10-25",
        applicability: ApplicabilityPolicy::Linux,
        evaluation: Evaluation::ExtendedHost(check),
    }
}

pub(super) const RULES: &[RuleDefinition] = &[
    rule(Check::Fifos, "HOST-fifos", "Protection against unexpected FIFO writes", "fs.protected_fifos",
        "FIFO creation protections are enabled (value 1 or 2).",
        "These protections reduce attacks using files placed in shared writable directories.",
        "Current kernel value only; directory ownership, application behavior and persistence were not checked.",
        "Review enabling protections for world-writable sticky directories, and group-writable ones where appropriate.",
        "https://docs.kernel.org/admin-guide/sysctl/fs.html", Category::Kernel),
    rule(Check::Regular, "HOST-regular", "Protection against unexpected regular-file writes", "fs.protected_regular",
        "Regular-file creation protections are enabled (value 1 or 2).",
        "These protections limit unintended writes through files created by another user.",
        "Current kernel value only; shared-directory and application behavior were not checked.",
        "Review shared-directory use before enabling additional regular-file creation restrictions.",
        "https://docs.kernel.org/admin-guide/sysctl/fs.html", Category::Kernel),
    rule(Check::Perf, "HOST-perf", "Access to performance monitoring", "kernel.perf_event_paranoid",
        "Informational: match profiling restrictions to monitoring and debugging requirements.",
        "Performance monitoring can expose information about other processes and the kernel.",
        "Current sysctl only; process capabilities and distribution-specific extensions were not evaluated.",
        "Restrict unprivileged profiling where suitable; preserve the monitoring capabilities the workload needs.",
        "https://docs.kernel.org/admin-guide/perf-security.html", Category::Kernel),
    rule(Check::Kexec, "HOST-kexec", "Loading a replacement kernel without rebooting", "kernel.kexec_load_disabled",
        "Informational: review whether this host needs kexec and its recovery workflows.",
        "Disabling kexec reduces one path for loading a replacement kernel but can affect crash recovery.",
        "Current value only; Secure Boot, kdump, signatures and boot configuration were not verified.",
        "Review crash-dump and recovery requirements before changing this one-way-until-reboot restriction.",
        "https://docs.kernel.org/admin-guide/sysctl/kernel.html", Category::Kernel),
    rule(Check::Modules, "HOST-modules", "Loading additional kernel modules", "kernel.modules_disabled",
        "Informational: review module-loading restrictions against hardware and recovery requirements.",
        "Restricting module loading reduces kernel attack surface but may prevent required drivers from loading.",
        "Current value only; loaded modules, signing policy and future hardware requirements were not audited.",
        "Consider restrictions only after required modules are loaded and a tested recovery plan is available.",
        "https://docs.kernel.org/admin-guide/sysctl/kernel.html", Category::Kernel),
    rule(Check::Sysrq, "HOST-sysrq", "Emergency keyboard command access", "kernel.sysrq",
        "Informational: review the enabled SysRq functions against console and recovery needs.",
        "Emergency console functions can help recovery and may expose powerful local actions.",
        "The sysctl's keyboard permission mask only; privileged /proc/sysrq-trigger access was not checked.",
        "Review the bitmask and physical/remote-console access before restricting emergency functions.",
        "https://docs.kernel.org/admin-guide/sysrq.html", Category::Kernel),
    rule(Check::Uring, "HOST-uring", "Creating asynchronous I/O rings", "kernel.io_uring_disabled",
        "Informational: review io_uring restrictions against application requirements.",
        "Limiting creation of I/O rings can reduce kernel attack surface while affecting some applications.",
        "Current creation restriction only; existing rings, capabilities and the permitted group were not checked.",
        "Check application compatibility before restricting new io_uring instances; existing instances may remain usable.",
        "https://docs.kernel.org/admin-guide/sysctl/kernel.html", Category::Kernel),
    rule(Check::Syncookies, "HOST-syncookies", "TCP SYN-flood fallback", "net.ipv4.tcp_syncookies",
        "SYN cookies are available as a fallback when the SYN queue overflows (value 1).",
        "SYN cookies can preserve some connection handling during a SYN-flood attack.",
        "Current network namespace only; this does not measure capacity or prove denial-of-service protection.",
        "Review SYN cookies and queue sizing together. Value 2 is an unconditional test mode, not the normal production setting.",
        "https://docs.kernel.org/networking/ip-sysctl.html", Category::Network),
    rule(Check::BroadcastIcmp, "HOST-broadcast-icmp", "Replies to broadcast ping requests", "net.ipv4.icmp_echo_ignore_broadcasts",
        "Broadcast and multicast ICMP echo requests are ignored (value 1).",
        "Ignoring these requests reduces one way the host could participate in traffic amplification.",
        "Current IPv4 namespace setting only; firewall policy and external traffic were not tested.",
        "Review ignoring broadcast echo requests unless a documented network requirement needs them.",
        "https://docs.kernel.org/networking/ip-sysctl.html", Category::Network),
    rule(Check::BogusIcmp, "HOST-bogus-icmp", "Handling invalid broadcast ICMP error responses", "net.ipv4.icmp_ignore_bogus_error_responses",
        "Informational: review whether warnings about bogus broadcast ICMP error responses should be suppressed.",
        "Suppressing these warnings helps avoid log noise from nonconforming network devices.",
        "Current IPv4 logging behavior only; this does not mean all malformed traffic is blocked.",
        "Review warning volume and network troubleshooting needs before changing this logging behavior.",
        "https://docs.kernel.org/networking/ip-sysctl.html", Category::Network),
    rule(Check::Ipv4Forward, "HOST-ipv4-forward", "IPv4 packet forwarding", "net.ipv4.ip_forward",
        "Informational: forwarding should match this host's router, VPN or container role.",
        "Forwarding allows traffic to pass between interfaces; some workloads intentionally require it.",
        "Current namespace-wide IPv4 setting only; routes, containers and firewall forwarding rules were not evaluated.",
        "Confirm whether this host routes traffic. Do not disable forwarding blindly on VPN, router or container hosts.",
        "https://docs.kernel.org/networking/ip-sysctl.html", Category::Network),
    rule(Check::Ipv6Forward, "HOST-ipv6-forward", "IPv6 packet forwarding", "net.ipv6.conf.all.forwarding",
        "Informational: forwarding should match this host's router, VPN or container role.",
        "Forwarding changes IPv6 host/router behavior and may be necessary for the workload.",
        "Current namespace-wide IPv6 setting only; routes, per-interface settings and external access were not tested.",
        "Review IPv6 routing and address configuration before changing forwarding behavior.",
        "https://docs.kernel.org/networking/ip-sysctl.html", Category::Network),
    rule(Check::GroupFile, "HOST-group-file", "Ownership and permissions of the local group database", "/etc/group",
        "A regular file owned by root, with no group or other-user write access.",
        "Unauthorized group-database changes can alter local access decisions.",
        "Named-file mode and numeric ownership only; ACLs, parent paths and directory-service groups were not checked.",
        "Review root ownership and remove unexpected write access using the distribution's supported account-management tools.",
        "https://man7.org/linux/man-pages/man5/group.5.html", Category::Filesystems),
    rule(Check::GshadowFile, "HOST-gshadow-file", "Ownership and permissions of protected group data", "/etc/gshadow",
        "Root-owned regular file, no other-user access or group write/execute; group reads only for root or the local shadow group.",
        "Protected group data can contain authentication material and administrative access information.",
        "Named-file metadata and the local shadow-group ID only; ACLs, members and included policy were not audited.",
        "Review the distribution's protected-group ownership and read-access policy without exposing the file contents.",
        "https://man7.org/linux/man-pages/man5/gshadow.5.html", Category::Filesystems),
    rule(Check::SudoersFile, "HOST-sudoers-file", "Ownership and permissions of the main sudo policy", "/etc/sudoers",
        "Root-owned regular file, no other-user access or group write/execute; root-group reads are allowed.",
        "Unexpected access to this policy can expose or change privilege rules.",
        "Main-file metadata only. Policy contents, sudoers.d includes, LDAP rules, ACLs and effective privileges were not read.",
        "Use visudo to review ownership and permissions. This observation does not validate effective sudo privileges.",
        "https://www.sudo.ws/docs/man/sudoers.man/", Category::Filesystems),
    rule(Check::CrontabFile, "HOST-crontab-file", "Ownership and permissions of the system crontab", "/etc/crontab",
        "A regular file owned by root, with no group or other-user write access.",
        "Unauthorized changes to system schedules can execute commands with elevated privileges.",
        "Main-file metadata only; scheduled commands, user crontabs, cron.d and systemd timers were not read.",
        "Review the distribution's ownership and write permissions; do not assume that a missing main crontab means no scheduled work.",
        "https://man7.org/linux/man-pages/man5/crontab.5.html", Category::Filesystems),
    rule(Check::DuplicateLogins, "HOST-duplicate-logins", "Duplicate local login names", "/etc/passwd (counts only)",
        "No duplicate local login names.", "Repeated names make local account lookup and administration ambiguous.",
        "Local passwd file only; names, hashes, LDAP/NSS identities and actual authentication were not exported or tested.",
        "Review duplicate records locally with supported account-management tools; preserve access before editing.",
        "https://man7.org/linux/man-pages/man5/passwd.5.html", Category::Accounts),
    rule(Check::NonshadowPasswords, "HOST-nonshadow-passwords", "Local password fields outside protected storage", "/etc/passwd (count only)",
        "Every local password field uses the shadow marker x or a locked marker beginning with ! or *.",
        "Other password fields can expose authentication data in a normally readable file.",
        "Counts of local fields only; no field values, passwords or hashes leave the host. PAM/NSS authentication was not evaluated.",
        "Inspect the affected records locally and review shadow-password use. Alternative authentication formats need administrator interpretation.",
        "https://man7.org/linux/man-pages/man5/passwd.5.html", Category::Accounts),
    rule(Check::DuplicateGroupNames, "HOST-duplicate-group-names", "Duplicate local group names", "/etc/group (count only)",
        "No duplicate local group names.", "Repeated group names can make ownership and membership administration ambiguous.",
        "Local group-file counts only; names, members and directory-service groups were not exported or audited.",
        "Review duplicate local group names with the administrator before changing ownership or membership.",
        "https://man7.org/linux/man-pages/man5/group.5.html", Category::Accounts),
    rule(Check::DuplicateGids, "HOST-duplicate-gids", "Shared numeric IDs in local groups", "/etc/group (count only)",
        "Informational: review whether groups intentionally share numeric IDs.",
        "Groups sharing a numeric ID share the same filesystem group identity; aliases may be intentional.",
        "Local group-file counts only; no membership, LDAP/NSS or effective access assessment.",
        "Confirm that local group-ID aliases are intentional and documented before changing them.",
        "https://man7.org/linux/man-pages/man5/group.5.html", Category::Accounts),
    rule(Check::Lsm, "HOST-lsm", "Active Linux security modules", "/sys/kernel/security/lsm",
        "Informational: review which security modules are active and how workload policy is enforced.",
        "Active security modules provide hooks for additional access controls.",
        "Kernel-reported active module names only; listing a module does not establish enforcement or application coverage.",
        "Review the active access-control framework and its workload policies; a listed module alone is not a complete protection.",
        "https://docs.kernel.org/security/lsm.html", Category::Kernel),
    rule(Check::Selinux, "HOST-selinux", "SELinux enforcement mode", "getenforce",
        "Informational: review enforcing, permissive or disabled mode with the host's access-control design.",
        "SELinux can confine applications when suitable policy is enforced.",
        "Current global mode only; policy completeness, per-domain permissive settings and application labels were not audited.",
        "Review SELinux mode and application policy with the administrator; another access-control framework may be used.",
        "https://man7.org/linux/man-pages/man8/getenforce.8.html", Category::Kernel),
    rule(Check::Apparmor, "HOST-apparmor", "Loaded AppArmor policy modes", "/sys/kernel/security/apparmor/profiles (counts only)",
        "Informational: review enforced, complain and other policy modes against intended application coverage.",
        "Complain-mode policies record allowed behavior without enforcing the same restrictions as enforce mode.",
        "Loaded-policy counts only; profile names, process lists, log events and application completeness were not collected.",
        "Review policies left in complain or other modes and whether important applications have suitable enforced profiles.",
        "https://ubuntu.com/server/docs/how-to/security/apparmor/", Category::Kernel),
    rule(Check::AuditEnabled, "HOST-audit-enabled", "Kernel audit collection mode", "auditctl -s (enabled field)",
        "Kernel auditing is enabled (value 1 or 2).",
        "The audit subsystem supports security-event recording when suitable rules and a collector are configured.",
        "Kernel enabled flag only; audit rules, event completeness, retention and remote forwarding were not read.",
        "Review audit policy and collection requirements; an enabled flag alone does not establish useful event coverage.",
        "https://man7.org/linux/man-pages/man8/auditctl.8.html", Category::Services),
    rule(Check::AuditLost, "HOST-audit-lost", "Discarded kernel audit records", "auditctl -s (lost field)",
        "The current kernel lost-record counter is zero.",
        "Discarded audit records can leave gaps in investigation evidence.",
        "Cumulative kernel counter since initialization or reset only; no audit logs, events or earlier resets were inspected.",
        "Investigate discarded records and collection capacity. A zero counter does not prove that all required events are recorded.",
        "https://man7.org/linux/man-pages/man8/auditctl.8.html", Category::Services),
    rule(Check::TimeSync, "HOST-time-sync", "Reported clock synchronization", "timedatectl NTPSynchronized",
        "Informational: review clock synchronization with the host's time-service design.",
        "Reliable time supports certificate validation and correlation of security events.",
        "The system time service's synchronization flag only; clock error, time sources and alternative implementations were not tested.",
        "Review time-source trust and monitoring. A synchronized flag alone does not measure clock accuracy.",
        "https://www.freedesktop.org/software/systemd/man/latest/timedatectl.html", Category::Services),
];

/// Return one bounded decimal integer, without accepting signs or additional records.
fn unsigned(source: &str) -> Option<u32> {
    (!source.is_empty() && source.len() <= 10 && source.bytes().all(|byte| byte.is_ascii_digit()))
        .then(|| source.parse().ok())
        .flatten()
}

/// Read exact count slots; every collector limits its aggregate input before emitting numbers.
fn counts(source: &str, expected: usize) -> Option<Vec<u32>> {
    let parts: Vec<_> = source.split_whitespace().take(expected + 1).collect();
    if parts.len() != expected {
        return None;
    }
    parts.into_iter().map(unsigned).collect()
}

/// Build presentation without using its text to choose the result state.
fn available(value: String, observed: String, outcome: Outcome) -> ExtraResult {
    ExtraResult::Available {
        value,
        observed,
        outcome,
    }
}

/// Require one regular-file mode and numeric ownership; empty files remain assessable.
fn metadata(facts: &Facts, check: Check, source: &str) -> Option<ExtraResult> {
    let (mode, uid, gid) = file_metadata(source, 0o100000)?;
    let permissions = mode & 0o7777;
    let restricted = matches!(check, Check::GshadowFile | Check::SudoersFile);
    let mut accepted = uid == 0 && permissions & 0o7022 == 0;
    if restricted {
        accepted &= permissions & 0o0137 == 0;
        if permissions & 0o0040 != 0 && gid != 0 {
            if check == Check::GshadowFile {
                let shadow = facts.get("ext_shadow_group")?;
                let allowed = if shadow == "absent" {
                    None
                } else {
                    Some(unsigned(shadow)?)
                };
                accepted &= allowed == Some(gid);
            } else {
                accepted = false;
            }
        }
    }
    let value = format!("mode {:04o}; owner UID {uid}; group GID {gid}", permissions);
    let observed = if accepted {
        "The checked file has the expected root ownership and access restrictions."
    } else {
        "The checked file's ownership or permissions need review."
    };
    Some(available(
        value,
        observed.into(),
        Outcome::baseline(accepted),
    ))
}

/// Keep names bounded and unique; active module names never establish enforcement coverage.
fn lsm_names(source: &str) -> Option<Vec<&str>> {
    if source.is_empty() || source.len() > 1024 {
        return None;
    }
    let names: Vec<_> = source.split(',').take(33).collect();
    if names.len() > 32
        || names.iter().enumerate().any(|(index, name)| {
            name.is_empty()
                || name.len() > 32
                || !name.bytes().all(|byte| {
                    byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_-".contains(&byte)
                })
                || names[..index].contains(name)
        })
    {
        return None;
    }
    Some(names)
}

/// A known different active framework can exclude only its own optional framework-specific check.
fn inactive_framework(facts: &Facts, name: &str) -> bool {
    facts
        .get("ext_lsm")
        .and_then(lsm_names)
        .is_some_and(|names| !names.contains(&name))
}

/// Interpret one requested status field independently; extra metrics cannot substitute for missing/duplicate values.
fn audit_number(source: &str, field: &str) -> Option<u32> {
    let mut matching = source
        .lines()
        .filter(|line| line.split_whitespace().next() == Some(field));
    let line = matching.next()?;
    if matching.next().is_some() {
        return None;
    }
    let parts: Vec<_> = line.split_whitespace().take(3).collect();
    if parts.len() != 2 {
        return None;
    }
    unsigned(parts[1])
}

/// Evaluate a selected host rule; failed, malformed or oversized evidence never becomes a pass.
pub(super) fn evaluate(facts: &Facts, check: Check) -> ExtraResult {
    if check == Check::Selinux && inactive_framework(facts, "selinux") {
        if matches!(facts.get(check.key()), Some("Enforcing" | "Permissive")) {
            return ExtraResult::Unavailable;
        }
        return ExtraResult::NotApplicable("SELinux is not listed among the kernel's active security modules; another framework may be used.");
    }
    if check == Check::Apparmor && inactive_framework(facts, "apparmor") {
        if facts
            .get(check.key())
            .and_then(|source| counts(source, 4))
            .is_some_and(|values| values[0] != 0)
        {
            return ExtraResult::Unavailable;
        }
        return ExtraResult::NotApplicable("AppArmor is not listed among the kernel's active security modules; another framework may be used.");
    }
    let Some(source) = facts.get(check.key()) else {
        return ExtraResult::Unavailable;
    };
    let result = match check {
        Check::GroupFile | Check::GshadowFile | Check::SudoersFile | Check::CrontabFile => metadata(facts, check, source),
        Check::DuplicateLogins | Check::NonshadowPasswords | Check::DuplicateGroupNames | Check::DuplicateGids => {
            counts(source, 2).filter(|values| values.iter().all(|value| *value <= 100000)).map(|values| {
                let index = usize::from(matches!(check, Check::NonshadowPasswords | Check::DuplicateGids));
                let value = values[index];
                let (singular, plural) = match check {
                    Check::DuplicateLogins => ("duplicate local login name", "duplicate local login names"),
                    Check::NonshadowPasswords => ("local password field outside shadow or locked-marker forms", "local password fields outside shadow or locked-marker forms"),
                    Check::DuplicateGroupNames => ("duplicate local group name", "duplicate local group names"),
                    _ => ("local numeric group ID shared by multiple group names", "local numeric group IDs shared by multiple group names"),
                };
                let observed = format!("{value} {} found.", if value == 1 { singular } else { plural });
                available(value.to_string(), observed, if check == Check::DuplicateGids { Outcome::Informational } else { Outcome::baseline(value == 0) })
            })
        }
        Check::Lsm => lsm_names(source).map(|names| {
            let visible = names.iter().take(6).copied().collect::<Vec<_>>().join(", ");
            available(names.join(","), format!("{} active security module{} reported: {visible}{}.", names.len(), if names.len() == 1 { "" } else { "s" }, if names.len() > 6 { ", …" } else { "" }), Outcome::Informational)
        }),
        Check::Selinux => match source {
            "Enforcing" | "Permissive" | "Disabled" => Some(available(source.into(), format!("SELinux reports {} mode.", source.to_ascii_lowercase()), Outcome::Informational)),
            _ => None,
        },
        Check::Apparmor => counts(source, 4).filter(|values| values.iter().all(|value| *value <= 100000)
            && values[1].checked_add(values[2]).and_then(|sum| sum.checked_add(values[3])) == Some(values[0])).map(|values| {
                available(format!("loaded={}; enforce={}; complain={}; other={}", values[0], values[1], values[2], values[3]),
                    format!("{} loaded AppArmor {}: {} enforced, {} in complain mode and {} in other modes.", values[0], if values[0] == 1 { "policy" } else { "policies" }, values[1], values[2], values[3]), Outcome::Informational)
            }),
        Check::AuditEnabled => audit_number(source, "enabled").filter(|value| *value <= 2).map(|value| {
            available(format!("enabled={value}"), match value { 0 => "Kernel auditing is disabled.", 1 => "Kernel auditing is enabled; its configuration remains changeable.", _ => "Kernel auditing is enabled and its configuration is locked until reboot." }.into(), Outcome::baseline(value != 0))
        }),
        Check::AuditLost => audit_number(source, "lost").map(|value| available(format!("lost={value}"), format!("The kernel reports {value} discarded audit record{} since initialization or the last counter reset.", if value == 1 { "" } else { "s" }), Outcome::baseline(value == 0))),
        Check::TimeSync => match source {
            "NTPSynchronized=yes" | "NTPSynchronized=no" => Some(available(source.into(), if source.ends_with("=yes") { "The time service reports that the system clock is synchronized." } else { "The time service does not currently report a synchronized clock." }.into(), Outcome::Informational)),
            _ => None,
        },
        Check::Perf => source.parse::<i32>().ok().filter(|value| (-1..=4).contains(value) && value.to_string() == source).map(|value| {
            let observed = match value { -1 => "Unprivileged performance monitoring has no restrictions from this setting.".into(),
                0 => "Unprivileged performance monitoring restricts raw tracepoint access.".into(),
                1 => "Unprivileged performance monitoring restricts CPU-wide event access.".into(),
                2 => "Unprivileged performance monitoring restricts kernel profiling.".into(),
                _ => format!("Additional unprivileged performance-monitoring restrictions are configured (value {value}).") };
            available(value.to_string(), observed, Outcome::Informational)
        }),
        _ => unsigned(source).and_then(|value| {
            let (observed, outcome) = match check {
                Check::Fifos | Check::Regular if value <= 2 => (format!("{} creation protections are {}.", if check == Check::Fifos { "FIFO" } else { "Regular-file" }, match value { 0 => "disabled", 1 => "enabled for world-writable sticky directories", _ => "enabled for world- and group-writable sticky directories" }), Outcome::baseline(value != 0)),
                Check::Kexec if value <= 1 => (if value == 1 { "Loading replacement kernels through kexec is disabled until reboot." } else { "Loading replacement kernels through kexec is not disabled by this setting." }.into(), Outcome::Informational),
                Check::Modules if value <= 1 => (if value == 1 { "Loading and unloading kernel modules is disabled until reboot." } else { "Loading and unloading kernel modules is not disabled by this setting." }.into(), Outcome::Informational),
                Check::Sysrq => (match value { 0 => "Keyboard SysRq functions are disabled.".into(), 1 => "All keyboard SysRq functions are enabled.".into(), _ => format!("Keyboard SysRq functions use permission bitmask {value}.") }, Outcome::Informational),
                Check::Uring if value <= 2 => (match value { 0 => "Creation of io_uring instances is not restricted by this setting.", 1 => "Creation of io_uring instances is restricted to privileged processes or a configured group.", _ => "Creation of new io_uring instances is disabled; existing instances may remain usable." }.into(), Outcome::Informational),
                Check::Syncookies if value <= 2 => (match value { 0 => "The TCP SYN-cookie fallback is disabled.", 1 => "TCP SYN cookies are enabled as an overflow fallback.", _ => "TCP SYN cookies are in unconditional test mode." }.into(), if value == 2 { Outcome::Informational } else { Outcome::baseline(value == 1) }),
                Check::BroadcastIcmp if value <= 1 => (if value == 1 { "Broadcast and multicast ping requests are ignored." } else { "Broadcast and multicast ping requests are not ignored by this setting." }.into(), Outcome::baseline(value == 1)),
                Check::BogusIcmp if value <= 1 => (if value == 1 { "Warnings about bogus broadcast ICMP error responses are suppressed." } else { "Warnings about bogus broadcast ICMP error responses are not suppressed." }.into(), Outcome::Informational),
                Check::Ipv4Forward | Check::Ipv6Forward if value <= 1 => (format!("{} packet forwarding is {} in this network namespace.", if check == Check::Ipv4Forward { "IPv4" } else { "IPv6" }, if value == 1 { "enabled" } else { "disabled" }), Outcome::Informational),
                _ => return None,
            };
            Some(available(value.to_string(), observed, outcome))
        }),
    };
    result.unwrap_or(ExtraResult::Unavailable)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::facts::{Fact, MAX_FACT_BYTES};
    use std::collections::{BTreeMap, BTreeSet};

    /// Build inert collector data; no host access is performed by evaluator regressions.
    fn fixture(values: &[(&str, &str)]) -> Facts {
        Facts(
            values
                .iter()
                .map(|(key, output)| {
                    (
                        (*key).into(),
                        Fact {
                            output: (*output).into(),
                            status: 0,
                        },
                    )
                })
                .collect(),
        )
    }

    /// Narrow control checks retain meaningful decisions while workload-dependent settings stay informational.
    #[test]
    fn scalar_states_keep_workload_context() {
        for check in [
            Check::Fifos,
            Check::Regular,
            Check::Syncookies,
            Check::BroadcastIcmp,
        ] {
            assert!(matches!(
                evaluate(&fixture(&[(check.key(), "0")]), check),
                ExtraResult::Available {
                    outcome: Outcome::Attention,
                    ..
                }
            ));
            assert!(matches!(
                evaluate(&fixture(&[(check.key(), "1")]), check),
                ExtraResult::Available {
                    outcome: Outcome::Passed,
                    ..
                }
            ));
        }
        for check in [
            Check::Perf,
            Check::Kexec,
            Check::Modules,
            Check::Sysrq,
            Check::Uring,
            Check::BogusIcmp,
            Check::Ipv4Forward,
            Check::Ipv6Forward,
        ] {
            assert!(matches!(
                evaluate(&fixture(&[(check.key(), "0")]), check),
                ExtraResult::Available {
                    outcome: Outcome::Informational,
                    ..
                }
            ));
        }
        assert!(matches!(
            evaluate(&fixture(&[("ext_perf", "-1")]), Check::Perf),
            ExtraResult::Available { .. }
        ));
        assert!(matches!(
            evaluate(&fixture(&[("ext_syncookies", "2")]), Check::Syncookies),
            ExtraResult::Available {
                outcome: Outcome::Informational,
                ..
            }
        ));
    }

    /// Missing, failed, oversized and unfamiliar scalar evidence cannot produce a result.
    #[test]
    fn unavailable_and_bounded_facts_fail_closed() {
        for rule in RULES {
            let Evaluation::ExtendedHost(check) = rule.evaluation else {
                panic!("Wrong module evaluator");
            };
            for output in ["", "invalid syntax", "1\n1\n1\n1\n1", "+1"] {
                assert!(matches!(
                    evaluate(&fixture(&[(rule.fact_key, output)]), check),
                    ExtraResult::Unavailable
                ));
            }
            let mut facts = fixture(&[(rule.fact_key, "1")]);
            facts.0.get_mut(rule.fact_key).unwrap().status = 77;
            assert!(matches!(evaluate(&facts, check), ExtraResult::Unavailable));
            facts.0.get_mut(rule.fact_key).unwrap().status = 0;
            facts.0.get_mut(rule.fact_key).unwrap().output = " ".repeat(MAX_FACT_BYTES + 1);
            assert!(matches!(evaluate(&facts, check), ExtraResult::Unavailable));
        }
        assert!(matches!(
            evaluate(&fixture(&[("ext_fifos", "3")]), Check::Fifos),
            ExtraResult::Unavailable
        ));
        assert!(matches!(
            evaluate(&fixture(&[("ext_perf", "-2")]), Check::Perf),
            ExtraResult::Unavailable
        ));
    }

    /// Named-file checks inspect type and ownership without needing file contents or a nonempty file.
    #[test]
    fn named_metadata_keeps_shadow_group_evidence() {
        assert!(matches!(
            evaluate(
                &fixture(&[("ext_group_file", "81a4 0 0")]),
                Check::GroupFile
            ),
            ExtraResult::Available {
                outcome: Outcome::Passed,
                ..
            }
        ));
        for metadata in ["81b4 0 0", "81a4 1000 0", "89a4 0 0"] {
            assert!(matches!(
                evaluate(&fixture(&[("ext_group_file", metadata)]), Check::GroupFile),
                ExtraResult::Available {
                    outcome: Outcome::Attention,
                    ..
                }
            ));
        }
        assert!(matches!(
            evaluate(
                &fixture(&[("ext_group_file", "41ed 0 0")]),
                Check::GroupFile
            ),
            ExtraResult::Unavailable
        ));
        assert!(matches!(
            evaluate(
                &fixture(&[("ext_gshadow_file", "81a0 0 42")]),
                Check::GshadowFile
            ),
            ExtraResult::Unavailable
        ));
        assert!(matches!(
            evaluate(
                &fixture(&[
                    ("ext_gshadow_file", "81a0 0 42"),
                    ("ext_shadow_group", "42")
                ]),
                Check::GshadowFile
            ),
            ExtraResult::Available {
                outcome: Outcome::Passed,
                ..
            }
        ));
        assert!(matches!(
            evaluate(
                &fixture(&[
                    ("ext_gshadow_file", "81a0 0 43"),
                    ("ext_shadow_group", "42")
                ]),
                Check::GshadowFile
            ),
            ExtraResult::Available {
                outcome: Outcome::Attention,
                ..
            }
        ));
        assert!(matches!(
            evaluate(
                &fixture(&[("ext_sudoers_file", "8120 0 0")]),
                Check::SudoersFile
            ),
            ExtraResult::Available {
                outcome: Outcome::Passed,
                ..
            }
        ));
        assert!(matches!(
            evaluate(
                &fixture(&[("ext_sudoers_file", "81a4 0 0")]),
                Check::SudoersFile
            ),
            ExtraResult::Available {
                outcome: Outcome::Attention,
                ..
            }
        ));
    }

    /// Aggregate counts never export identities and preserve informational group-ID aliases.
    #[test]
    fn local_counts_are_exact_and_bounded() {
        let facts = fixture(&[("ext_account_counts", "1 2"), ("ext_group_counts", "0 3")]);
        assert!(matches!(
            evaluate(&facts, Check::DuplicateLogins),
            ExtraResult::Available {
                outcome: Outcome::Attention,
                ..
            }
        ));
        assert!(matches!(
            evaluate(&facts, Check::DuplicateGroupNames),
            ExtraResult::Available {
                outcome: Outcome::Passed,
                ..
            }
        ));
        assert!(matches!(
            evaluate(&facts, Check::DuplicateGids),
            ExtraResult::Available {
                outcome: Outcome::Informational,
                ..
            }
        ));
        assert!(matches!(
            evaluate(
                &fixture(&[("ext_group_counts", "0 0 0")]),
                Check::DuplicateGids
            ),
            ExtraResult::Unavailable
        ));
        assert!(matches!(
            evaluate(
                &fixture(&[("ext_account_counts", "0 100001")]),
                Check::NonshadowPasswords
            ),
            ExtraResult::Unavailable
        ));
        let ExtraResult::Available { value, .. } = evaluate(&facts, Check::NonshadowPasswords)
        else {
            panic!("Expected counts");
        };
        assert_eq!(value, "2");
    }

    /// Framework exclusions require an affirmative valid kernel list, not a missing tool or denied read.
    #[test]
    fn framework_modes_and_exclusions_are_scoped() {
        let facts = fixture(&[
            ("ext_lsm", "capability,yama,apparmor,bpf"),
            ("ext_apparmor", "4 2 1 1"),
        ]);
        assert!(matches!(
            evaluate(&facts, Check::Selinux),
            ExtraResult::NotApplicable(_)
        ));
        assert!(matches!(
            evaluate(&facts, Check::Apparmor),
            ExtraResult::Available {
                outcome: Outcome::Informational,
                ..
            }
        ));
        assert!(matches!(
            evaluate(&fixture(&[("ext_apparmor", "4 2 1 2")]), Check::Apparmor),
            ExtraResult::Unavailable
        ));
        assert!(matches!(
            evaluate(&fixture(&[("ext_lsm", "apparmor,,bpf")]), Check::Selinux),
            ExtraResult::Unavailable
        ));
        assert!(matches!(
            evaluate(&fixture(&[("ext_lsm", "apparmor,apparmor")]), Check::Lsm),
            ExtraResult::Unavailable
        ));
        assert!(matches!(
            evaluate(
                &fixture(&[("ext_lsm", "apparmor"), ("ext_selinux", "Enforcing")]),
                Check::Selinux
            ),
            ExtraResult::Unavailable
        ));
        assert!(matches!(
            evaluate(
                &fixture(&[("ext_lsm", "selinux"), ("ext_apparmor", "1 1 0 0")]),
                Check::Apparmor
            ),
            ExtraResult::Unavailable
        ));
        for mode in ["Enforcing", "Permissive", "Disabled"] {
            assert!(matches!(
                evaluate(&fixture(&[("ext_selinux", mode)]), Check::Selinux),
                ExtraResult::Available {
                    outcome: Outcome::Informational,
                    ..
                }
            ));
        }
    }

    /// Independent audit fields preserve a valid result when an unrelated field is malformed.
    #[test]
    fn audit_and_clock_fields_preserve_uncertainty() {
        let facts = fixture(&[("ext_audit", "enabled 2\nlost broken\npid 100")]);
        assert!(matches!(
            evaluate(&facts, Check::AuditEnabled),
            ExtraResult::Available {
                outcome: Outcome::Passed,
                ..
            }
        ));
        assert!(matches!(
            evaluate(&facts, Check::AuditLost),
            ExtraResult::Unavailable
        ));
        assert!(matches!(
            evaluate(
                &fixture(&[("ext_audit", "enabled 1\nenabled 0\nlost 0")]),
                Check::AuditEnabled
            ),
            ExtraResult::Unavailable
        ));
        assert!(matches!(
            evaluate(
                &fixture(&[("ext_audit", "enabled 0\nlost 1")]),
                Check::AuditLost
            ),
            ExtraResult::Available {
                outcome: Outcome::Attention,
                ..
            }
        ));
        for state in ["NTPSynchronized=yes", "NTPSynchronized=no"] {
            assert!(matches!(
                evaluate(&fixture(&[("ext_time_sync", state)]), Check::TimeSync),
                ExtraResult::Available {
                    outcome: Outcome::Informational,
                    ..
                }
            ));
        }
    }

    /// Every selected rule resolves to one exact collector key; metadata remains bounded and unique.
    #[test]
    fn module_contract_matches_fixed_collector_order() {
        assert_eq!(RULES.len(), 26);
        let shell_keys: Vec<_> = SCRIPT
            .lines()
            .filter_map(|line| {
                line.strip_prefix("collect ")
                    .and_then(|line| line.split_whitespace().next())
            })
            .collect();
        assert_eq!(shell_keys, KEYS);
        assert_eq!(
            KEYS.iter().copied().collect::<BTreeSet<_>>().len(),
            KEYS.len()
        );
        assert_eq!(
            RULES
                .iter()
                .map(|rule| rule.id)
                .collect::<BTreeSet<_>>()
                .len(),
            RULES.len()
        );
        for rule in RULES {
            let Evaluation::ExtendedHost(check) = rule.evaluation else {
                panic!("Wrong module evaluator");
            };
            assert_eq!(rule.fact_key, check.key());
            assert!(KEYS.contains(&rule.fact_key));
            assert!(
                rule.title.len() <= 100 && rule.expected.len() <= 200 && rule.scope.len() <= 250
            );
        }
        let _: Facts = Facts(BTreeMap::new());
    }

    /// Exercise production aggregate readers against disposable files without reading the test host's account data.
    #[cfg(target_os = "linux")]
    #[test]
    fn account_and_profile_collectors_project_only_bounded_counts() {
        let folder = tempfile::tempdir().unwrap();
        let data = folder.path().join("fixture");
        let run = |function: &str, original_path: &str| {
            let marker = format!("{function}() {{\n");
            let start = SCRIPT.find(&marker).unwrap();
            let end = SCRIPT[start..].find("\n}\n").unwrap();
            let function_source =
                SCRIPT[start..start + end + 2].replace(original_path, "\"$EXT_TEST_FILE\"");
            std::process::Command::new("/bin/sh").args(["-c", &format!("protected() {{ /usr/bin/timeout --signal=TERM --kill-after=1s 4s \"$@\"; }}\n{function_source}\n{function}")])
                .env_clear().env("PATH", "/usr/bin:/bin").env("LC_ALL", "C").env("EXT_TEST_FILE", &data)
                .output().unwrap()
        };
        std::fs::write(&data, "root:x:0:0::/root:/bin/sh\nsample:x:1000:1000::/tmp:/bin/sh\nsample:$6$private-hash:1001:1001::/tmp:/bin/sh\nempty::1002:1002::/tmp:/bin/sh\nlocked:!:1003:1003::/tmp:/bin/sh\n").unwrap();
        let output = run("ext_account_counts", "/etc/passwd");
        assert!(output.status.success());
        assert_eq!(output.stdout, b"1 2\n");
        assert!(output.stderr.is_empty());
        std::fs::write(
            &data,
            "root:x:0:\nshared:x:1000:private-members\nshared:x:1000:other-members\n",
        )
        .unwrap();
        let output = run("ext_group_counts", "/etc/group");
        assert!(output.status.success());
        assert_eq!(output.stdout, b"1 1\n");
        std::fs::write(&data, "root:x:0:\nfirst:x:1000:\nsecond:x:001000:\n").unwrap();
        let output = run("ext_group_counts", "/etc/group");
        assert!(output.status.success());
        assert_eq!(output.stdout, b"0 1\n");
        std::fs::write(&data, "invalid:x:4294967296:\n").unwrap();
        let output = run("ext_group_counts", "/etc/group");
        assert_eq!(output.status.code(), Some(65));
        assert!(output.stdout.is_empty());
        std::fs::write(&data, "private-profile (enforce)\nprivate-profile-two (complain)\nprivate-profile-three (kill)\n").unwrap();
        let output = run("ext_apparmor", "/sys/kernel/security/apparmor/profiles");
        assert!(output.status.success());
        assert_eq!(output.stdout, b"3 1 1 1\n");
        for (function, path) in [
            ("ext_account_counts", "/etc/passwd"),
            ("ext_group_counts", "/etc/group"),
            ("ext_apparmor", "/sys/kernel/security/apparmor/profiles"),
        ] {
            std::fs::write(&data, "malformed record\n").unwrap();
            let output = run(function, path);
            assert_eq!(output.status.code(), Some(65));
            assert!(output.stdout.is_empty());
            std::fs::write(&data, "x".repeat(16385)).unwrap();
            let output = run(function, path);
            assert_eq!(output.status.code(), Some(65));
            assert!(output.stdout.is_empty());
        }
    }
}
