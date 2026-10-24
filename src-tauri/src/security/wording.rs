//! Plain-language presentation of already evaluated evidence; wording never decides a check's status.
use super::{catalog::Evaluation, hardening::Outcome};

#[derive(Clone, Copy, Debug)]
pub(super) enum KernelSetting {
    Aslr,
    Ptrace,
    KernelPointers,
    KernelLog,
    HardLinks,
    SymbolicLinks,
    Bpf,
    Ipv4Redirects,
    SendRedirects,
    SourceRoute,
    ReversePath,
    Ipv6Redirects,
    CoreDumps,
}
#[derive(Clone, Copy, Debug)]
pub(super) enum SshSetting {
    RootLogin,
    Password,
    PublicKey,
    EmptyPassword,
    HostBased,
    X11,
    Attempts,
    StrictModes,
}
#[derive(Clone, Copy, Debug)]
pub(super) enum AccountKind {
    Superuser,
    DuplicateIds,
}

/// Translate current kernel values without claiming that they persist or describe each interface.
fn kernel(setting: KernelSetting, value: &str) -> String {
    let value = value.parse::<u32>().ok();
    let description = match (setting, value) {
        (KernelSetting::Aslr, Some(0)) => "Memory-address randomization is disabled",
        (KernelSetting::Aslr, Some(1)) => "Partial memory-address randomization is enabled",
        (KernelSetting::Aslr, Some(2)) => "Full memory-address randomization is enabled",
        (KernelSetting::Ptrace, Some(0)) => "No extra Yama restrictions limit process tracing",
        (KernelSetting::Ptrace, Some(1)) => "Process tracing is limited to related processes or approved exceptions",
        (KernelSetting::Ptrace, Some(2)) => "Process tracing requires the administrator's tracing privilege",
        (KernelSetting::Ptrace, Some(3)) => "Yama blocks process tracing and attachment",
        (KernelSetting::KernelPointers, Some(0)) => "Kernel addresses covered by this setting are not hidden",
        (KernelSetting::KernelPointers, Some(1)) => "Kernel addresses covered by this setting are hidden from readers without the required privilege",
        (KernelSetting::KernelPointers, Some(2)) => "Kernel addresses covered by this setting are hidden from all readers",
        (KernelSetting::KernelLog, Some(0)) => "This setting does not restrict kernel-log reading",
        (KernelSetting::KernelLog, Some(1)) => "Kernel-log reading requires the appropriate administrator privilege",
        (KernelSetting::HardLinks, Some(0)) => "Protection against unsafe hard links is disabled",
        (KernelSetting::HardLinks, Some(1)) => "Protection against unsafe hard links is enabled",
        (KernelSetting::SymbolicLinks, Some(0)) => "Protection against unsafe symbolic links is disabled",
        (KernelSetting::SymbolicLinks, Some(1)) => "Protection against unsafe symbolic links is enabled",
        (KernelSetting::Bpf, Some(0)) => "Unprivileged users can use BPF under this setting",
        (KernelSetting::Bpf, Some(1 | 2)) => "BPF use by unprivileged users is disabled",
        (KernelSetting::CoreDumps, Some(0)) => "This setting disables memory dumps from processes that changed privileges",
        (KernelSetting::CoreDumps, Some(1)) => "This setting permits memory dumps from processes that changed privileges",
        (KernelSetting::CoreDumps, Some(2)) => "Memory dumps from processes that changed privileges require a protected handling path",
        (KernelSetting::Ipv4Redirects, Some(0)) => "The IPv4 'all' setting is off for accepting route redirects",
        (KernelSetting::Ipv4Redirects, Some(1)) => "The IPv4 'all' setting is on for accepting route redirects",
        (KernelSetting::SendRedirects, Some(0)) => "The IPv4 'all' setting is off for sending route redirects",
        (KernelSetting::SendRedirects, Some(1)) => "The IPv4 'all' setting is on for sending route redirects",
        (KernelSetting::SourceRoute, Some(0)) => "The IPv4 'all' setting is off for accepting sender-selected routes",
        (KernelSetting::SourceRoute, Some(1)) => "The IPv4 'all' setting is on for accepting sender-selected routes",
        (KernelSetting::ReversePath, Some(0)) => "The IPv4 'all' setting disables reverse-path address checks",
        (KernelSetting::ReversePath, Some(1)) => "The IPv4 'all' setting uses strict reverse-path address checks",
        (KernelSetting::ReversePath, Some(2)) => "The IPv4 'all' setting uses loose reverse-path address checks",
        (KernelSetting::Ipv6Redirects, Some(0)) => "The IPv6 'all' setting is off for accepting route redirects",
        (KernelSetting::Ipv6Redirects, Some(1)) => "The IPv6 'all' setting is on for accepting route redirects",
        _ => "This setting returned an unfamiliar numeric value; review Technical details",
    };
    let limitation = if matches!(
        setting,
        KernelSetting::Ipv4Redirects
            | KernelSetting::SendRedirects
            | KernelSetting::SourceRoute
            | KernelSetting::ReversePath
            | KernelSetting::Ipv6Redirects
    ) {
        "Settings for each network adapter and after a restart were not checked."
    } else {
        "Current value only; whether it stays the same after a restart was not checked."
    };
    format!("{description}. {limitation}")
}

/// Describe parsed SSH defaults while keeping the live-connection limitation in every summary.
fn ssh(setting: SshSetting, value: &str) -> String {
    let description = match (setting, value) {
        (SshSetting::RootLogin, "yes") => "Root login is allowed".into(),
        (SshSetting::RootLogin, "no") => "Root login is disabled".into(),
        (SshSetting::RootLogin, "prohibit-password" | "without-password") => {
            "Root login is limited to non-password methods".into()
        }
        (SshSetting::RootLogin, "forced-commands-only") => {
            "Root login with keys is limited to forced commands".into()
        }
        (SshSetting::Attempts, value) => {
            format!("Up to {value} authentication attempts are allowed per connection")
        }
        (setting, value @ ("yes" | "no")) => {
            let feature = match setting {
                SshSetting::Password => "Password login",
                SshSetting::PublicKey => "Public-key authentication",
                SshSetting::EmptyPassword => "Authentication with an empty password",
                SshSetting::HostBased => "Authentication that trusts another host",
                SshSetting::X11 => "Forwarding graphical X11 applications",
                SshSetting::StrictModes => {
                    "Ownership and permission checks on authentication files"
                }
                _ => "This SSH setting",
            };
            format!(
                "{feature} {} {}",
                if matches!(setting, SshSetting::StrictModes) {
                    "are"
                } else {
                    "is"
                },
                if value == "yes" {
                    "enabled"
                } else {
                    "disabled"
                }
            )
        }
        _ => "This SSH default needs manual review".into(),
    };
    format!("{description} by default. The rules for this live connection were not checked.")
}

/// Name Unix read/write/execute permissions without treating the display as an ACL assessment.
fn permissions(bits: u32) -> String {
    let mut names = vec![];
    if bits & 4 != 0 {
        names.push("read");
    }
    if bits & 2 != 0 {
        names.push("write");
    }
    if bits & 1 != 0 {
        names.push("execute");
    }
    if names.is_empty() {
        "no access".into()
    } else {
        names.join(" + ")
    }
}

/// Translate the normalized mode/UID/GID evidence without changing the metadata or group decision.
fn file(value: &str) -> String {
    let fields: Vec<_> = value.split_whitespace().collect();
    let parsed = (|| {
        Some((
            u32::from_str_radix(fields.first()?.strip_prefix("mode=")?, 8).ok()?,
            fields.get(1)?.strip_prefix("uid=")?.parse::<u32>().ok()?,
            fields.get(2)?.strip_prefix("gid=")?.parse::<u32>().ok()?,
        ))
    })();
    let Some((mode, uid, gid)) = parsed else {
        return "File ownership and permissions were returned; review Technical details.".into();
    };
    let owner = if uid == 0 {
        "root".into()
    } else {
        format!("user ID {uid}")
    };
    format!(
        "Owned by {owner}, group ID {gid}. Access: owner {}; group {}; others {}.{}",
        permissions((mode >> 6) & 7),
        permissions((mode >> 3) & 7),
        permissions(mode & 7),
        if mode & 0o7000 != 0 {
            " Special permission bits are set."
        } else {
            ""
        }
    )
}

/// Summarize local account counts without extending them to external identities or sudo access.
fn account(kind: AccountKind, value: &str) -> String {
    match kind {
        AccountKind::Superuser => format!("{value} local {} full root privileges through user ID 0. Other sources of administrator access were not checked.", if value == "1" { "account has" } else { "accounts have" }),
        AccountKind::DuplicateIds => format!("{value} local {} shared by more than one account. External account directories were not checked.", if value == "1" { "user ID is" } else { "user IDs are" }),
    }
}

/// Explain socket counts without inferring that any endpoint can be reached from the internet.
fn listeners(value: &str) -> String {
    let first = value.split(';').next().unwrap_or_default();
    let count = first.split_whitespace().next().unwrap_or("Unknown");
    let beyond = value
        .split(';')
        .nth(1)
        .and_then(|part| part.split_whitespace().next())
        .unwrap_or("unknown");
    format!("{count} TCP/UDP {} waiting for traffic; {beyond} {} addresses beyond localhost. Connections from the internet were not tested.", if count == "1" { "socket is" } else { "sockets are" }, if beyond == "1" { "uses" } else { "use" })
}

/// Describe a firewall observation without converting rule counts into protection claims.
fn firewall(value: &str) -> String {
    let count = value.split_whitespace().next().unwrap_or("Unknown");
    format!("{count} firewall {} returned. Rule order and default policies need review; this does not show whether the internet can reach the server.", if count == "1" { "rule was" } else { "rules were" })
}

/// Explain only the three observed mount options; absent flags require workload-specific review.
fn mount(value: &str) -> String {
    let flags = value.split_whitespace().nth(1).unwrap_or_default();
    let has = |flag| flags.split(',').any(|value| value == flag);
    format!("On the filesystem containing this path: device files {}; running files with their owner's or group's privileges {}; direct execution {}. Review workload needs.", if has("nodev") { "blocked" } else { "allowed" }, if has("nosuid") { "blocked" } else { "allowed" }, if has("noexec") { "blocked" } else { "allowed" })
}

/// Translate recognized apt-config shell values as inert data, without assuming update execution.
fn apt(value: &str) -> String {
    let interval = |name: &str| {
        let prefix = format!("{name}='");
        let mut values = value.lines().filter_map(|line| {
            line.strip_prefix(&prefix)
                .and_then(|value| value.strip_suffix('\''))
        });
        let number = values.next()?.parse::<u32>().ok()?;
        if values.next().is_some() {
            return None;
        }
        Some(match number {
            0 => "disabled".into(),
            1 => "daily".into(),
            days => format!("every {days} days"),
        })
    };
    match (interval("Periodic"), interval("Upgrade")) {
        (Some(lists), Some(upgrades)) => format!("Package-list refresh: {lists}. Automatic upgrades: {upgrades}. These settings do not prove updates ran successfully or packages are current."),
        (None, None) => "No recognized APT update schedule was available. Another system may manage updates; update runs and package freshness were not checked.".into(),
        _ => "APT update settings were returned; review Technical details for missing or unfamiliar values. Update runs and package freshness were not checked.".into(),
    }
}

/// Describe loaded systemd service state and translate known SSH isolation values without scoring.
fn service(value: &str, ssh_service: bool) -> String {
    let property = |name: &str| value.lines().find_map(|line| line.strip_prefix(name));
    let state = match property("ActiveState=") {
        Some("active") => "active",
        Some("inactive") => "inactive",
        Some("failed") => "in a failed state",
        Some("activating") => "starting",
        Some("deactivating") => "stopping",
        _ => "in an unrecognized state",
    };
    if !ssh_service {
        return format!("The system journal service is {state}. Log retention, contents and forwarding were not checked.");
    }
    let flag = |name| match property(name) {
        Some("yes" | "true" | "1") => "on",
        Some("no" | "false" | "0") => "off",
        _ => "needs review",
    };
    let filesystem = match property("ProtectSystem=") {
        Some("no" | "false" | "0") => "off",
        Some("yes" | "true" | "1") => "system folders read-only",
        Some("full") => "system and config folders read-only",
        Some("strict") => "read-only with exceptions",
        _ => "needs review",
    };
    format!("The checked SSH service unit is {state}. Block extra privileges: {}; filesystem: {filesystem}; separate temporary folder: {}.", flag("NoNewPrivileges="), flag("PrivateTmp="))
}

/// Format each typed evaluation family independently of rule IDs, status decisions and raw evidence.
pub(super) fn observed(evaluation: Evaluation, value: &str, outcome: Outcome) -> String {
    match evaluation {
        Evaluation::KernelRange { setting, .. } | Evaluation::KernelObservation(setting) => kernel(setting, value),
        Evaluation::File { .. } => file(value),
        Evaluation::Ssh { setting, .. } => ssh(setting, value),
        Evaluation::Account { kind, .. } => account(kind, value),
        Evaluation::EmptyPasswords => {
            let count = value.split_whitespace().next().unwrap_or("Unknown");
            format!("{count} local {} an empty password field. Whether a login service accepts an empty password was not checked.", if count == "1" { "account has" } else { "accounts have" })
        }
        Evaluation::Listeners => listeners(value),
        Evaluation::Firewall => firewall(value),
        Evaluation::Mount => mount(value),
        Evaluation::AptPolicy => apt(value),
        Evaluation::PackageHealth => if matches!(outcome, Outcome::Passed) { "The package database reports no incomplete package operations. This does not show whether packages are current or free of vulnerabilities." } else { "The package database reports incomplete package operations that need review. This does not identify security vulnerabilities; see Technical details." }.into(),
        Evaluation::Reboot => if value == "present" { "The system has a reboot-required marker. Review installed changes and plan a suitable maintenance restart." } else { "No reboot-required marker was found. This does not prove the running kernel or services use all installed fixes." }.into(),
        Evaluation::Journal => service(value, false),
        Evaluation::SshService => service(value, true),
    }
}
