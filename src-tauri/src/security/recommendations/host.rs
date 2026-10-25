//! Host recipes preserve the difference between current values, named-file metadata and maintenance evidence.
use super::{advice, steps, Advice};
use crate::security::{
    catalog::{Evaluation, RuleDefinition},
    modules::system::Check,
    wording::{AccountKind, KernelSetting},
};

/// Share persistence and recovery steps without guessing which local policy file has precedence.
fn sysctl(rule: &RuleDefinition, next_step: &'static str, change: &str, impact: &str) -> Advice {
    advice(
        next_step,
        steps(&[
            &format!("Record the current {} value and check the affected workload's requirements.", rule.target),
            change,
            "After testing the runtime change, update the host's managed sysctl policy for persistence.",
        ]),
        impact,
        steps(&[
            &format!("Read {} again in the same host/network namespace and test the affected workload.", rule.target),
            "Rerun this area. Verify persistence separately after a planned restart.",
        ]),
        "Restore the recorded runtime value and only the persistent override you changed. Keep console or other administrator recovery access available.",
    )
}

/// Kernel documentation defines the precise values; workload exceptions are an operator decision.
fn kernel(setting: KernelSetting, rule: &RuleDefinition) -> Option<Advice> {
    Some(match setting {
        KernelSetting::Aslr => sysctl(rule,
            "Enable full memory-address randomization after compatibility testing.",
            "Consider kernel.randomize_va_space=2 for full address randomization.",
            "Older applications with unusual memory-layout requirements may need compatibility testing; this does not prove every program uses all available defenses."),
        KernelSetting::Ptrace => {
            let mut plan = sysctl(rule,
                "Restrict process tracing after checking debugger and monitoring needs.",
                "Consider kernel.yama.ptrace_scope=1 for related-process tracing, or 2 when only administrators should trace. Review approved debugger exceptions first.",
                "Debugger attachment, crash handlers and monitoring may stop working. Level 3 blocks tracing even for administrators and cannot be lowered while this kernel is running; do not use it as a trial setting.");
            plan.guide.rollback = "For levels 1 or 2, restore the recorded runtime value and your persistent override. If level 3 was set, live rollback is unavailable: restore the intended persistent policy and arrange a controlled reboot with console access.".into();
            plan
        }
        KernelSetting::KernelPointers => sysctl(rule,
            "Hide kernel memory addresses while preserving required troubleshooting access.",
            "Consider kernel.kptr_restrict=1 to restrict kernel addresses, or 2 if hiding them from every reader fits the workload.",
            "Symbol lookup, performance tools and troubleshooting may lose address information. This setting does not cover every source of kernel addresses."),
        KernelSetting::KernelLog => sysctl(rule,
            "Restrict kernel-log reading and preserve approved monitoring access.",
            "Consider kernel.dmesg_restrict=1 to require the kernel-log administrator capability.",
            "Unprivileged troubleshooting and log readers may lose access. Preserve an approved way for administrators and monitoring to read required logs."),
        KernelSetting::HardLinks => sysctl(rule,
            "Enable hard-link protection after checking cross-user file workflows.",
            "Consider fs.protected_hardlinks=1 to limit unsafe links to files owned by other users.",
            "Applications relying on cross-user hard-link creation may need adjustment; ordinary links owned by the same user are a different case."),
        KernelSetting::SymbolicLinks => sysctl(rule,
            "Enable symbolic-link protection after checking shared temporary-file workflows.",
            "Consider fs.protected_symlinks=1 for link-following protection in shared sticky directories.",
            "Programs using cross-user symbolic links in shared temporary directories may behave differently. This is not a check of every symbolic link."),
        KernelSetting::Bpf => {
            let mut plan = sysctl(rule,
                "Restrict unprivileged BPF loading after checking tracing and networking tools.",
                "Where supported, consider kernel.unprivileged_bpf_disabled=2 after checking unprivileged BPF users. Value 1 also disables unprivileged BPF but locks that choice until reboot.",
                "Unprivileged networking, tracing or profiling tools may stop loading BPF programs; existing capabilities and loaded programs are outside this check.");
            plan.guide.rollback = "If value 2 was used, restore the recorded runtime value and your persistent override. Value 1 cannot be reversed while this kernel is running; correct persistent policy before a controlled reboot.".into();
            plan
        }
        KernelSetting::Ipv4Redirects | KernelSetting::SendRedirects | KernelSetting::SourceRoute
        | KernelSetting::ReversePath | KernelSetting::Ipv6Redirects | KernelSetting::CoreDumps => return None,
    })
}

/// Metadata repair stays on the exact checked object; recursive permission changes are never suggested.
fn file(rule: &RuleDefinition, protected: bool, sudoers: bool) -> Advice {
    let change = if sudoers {
        "Use the distribution's sudo policy tools to restore root ownership and the expected protected mode. Validate sudoers with visudo; check included policy separately."
    } else if protected {
        "Restore root ownership and the distribution's expected protected mode, removing unintended execute/special-mode bits, other-user access and group writes. Allow group reads only for root or the distribution's shadow group; do not expose the contents."
    } else {
        "Restore root ownership and the distribution's expected file mode, removing unexpected execute/special-mode bits and group/other writes on this exact file. Do not apply recursive ownership or mode changes."
    };
    advice(
        "Restore this file's expected ownership and permissions while preserving required access.",
        steps(&[
            &format!("Save the current metadata for {} and confirm required administrative access before changing it.", rule.target),
            change,
        ]),
        "An incorrect owner or mode can break account lookup, authentication or scheduled administration. ACLs, symlink targets and parent directories need a separate review.",
        steps(&[
            "Recheck numeric ownership and mode on the same file; review ACLs separately.",
            "Verify required administrative access in a separate session, then rerun this area.",
        ]),
        "Restore the recorded metadata if legitimate access breaks, using the existing administrator session or recovery console. Do not restore publicly readable protected data without administrator review.",
    )
}

/// Aggregate account counts identify a local review, not which account can safely be deleted.
fn accounts(change: &str, impact: &str) -> Advice {
    advice(
        "Review the affected local accounts with the administrator before changing access.",
        steps(&[
            "Inspect the records locally; this report contains counts, not account names. Back up account databases securely and keep a tested administrator recovery path.",
            change,
        ]),
        impact,
        steps(&[
            "Check local account/group consistency with the distribution's tools and verify intended ownership and login/elevation paths.",
            "Rerun this area. Review directory-service identities separately.",
        ]),
        "Use the secure account-database backup and recorded ownership mapping to restore only the intended records through recovery access. Password or ownership changes may require a separate recovery procedure.",
    )
}

pub(super) fn baseline(rule: &RuleDefinition) -> Option<Advice> {
    Some(match rule.evaluation {
        Evaluation::KernelRange { setting, .. } => return kernel(setting, rule),
        Evaluation::File { restricted } => file(rule, restricted, false),
        Evaluation::Account { kind: AccountKind::Superuser, .. } => accounts(
            "Identify every local UID 0 record and confirm why it exists. Prefer one managed root identity and named administrators with controlled elevation; resolve intentional aliases before changing IDs.",
            "Changing or removing UID 0 identities can break administrative access, jobs and file ownership. Do not delete an account from this count alone."),
        Evaluation::Account { kind: AccountKind::DuplicateIds, .. } => accounts(
            "Review local records sharing a UID. Resolve unintended aliases using supported account tools and an explicit file-ownership migration plan.",
            "A UID change affects access to existing files and running services. Intentional shared identities need policy review rather than automatic renumbering."),
        Evaluation::EmptyPasswords => accounts(
            "Identify empty local shadow password fields and review PAM and service policy. Set an approved credential or lock the affected password where appropriate; verify other authentication paths separately.",
            "Locking a password may leave key or other login methods available and can break legitimate workflows. A reported empty field alone does not prove a usable passwordless login."),
        Evaluation::PackageHealth => advice(
            "Review interrupted package operations and plan their repair with the administrator.",
            steps(&[
                "Inspect dpkg's reported problems, package-manager logs, disk space and the earlier failure.",
                "Use the distribution's repair procedure in an agreed maintenance window after reviewing the cause.",
            ]),
            "Package repair can run maintainer scripts, replace files and restart services; it is not a vulnerability or patch-freshness assessment.",
            steps(&[
                "Confirm required services still work and dpkg --audit is clear, then rerun this area.",
                "Check security updates through the host's separate patch-management process.",
            ]),
            "Use the package-specific recovery procedure or a tested system backup if repair fails. Do not assume that reinstalling an older package safely reverses data or schema changes."),
        Evaluation::Reboot => advice(
            "Review the restart requirement and schedule a maintenance reboot.",
            steps(&[
                "Review which installed changes requested a reboot; do not remove the marker just to clear this result.",
                "Check backups, service dependencies and console recovery before scheduling the host restart.",
            ]),
            "A reboot interrupts sessions and workloads. This marker alone does not establish which running software is outdated.",
            steps(&[
                "After the restart, confirm host and application health and rerun this area.",
                "Verify running kernel/service versions against installed updates separately.",
            ]),
            "A completed reboot cannot be undone. If startup fails, use the tested console, known-good boot entry or backup recovery procedure."),
        _ => return None,
    })
}

/// Additional host findings share typed helpers while contextual observations intentionally have no repair plan.
pub(super) fn extended(check: Check, rule: &RuleDefinition) -> Option<Advice> {
    Some(match check {
        Check::Fifos => sysctl(rule,
            "Protect shared directories against unexpected FIFO writes after compatibility testing.",
            "Consider fs.protected_fifos=1 for world-writable sticky directories, or 2 if group-writable sticky directories also need this protection.",
            "Applications that open another user's existing FIFO in shared directories may fail; test intended shared-directory workflows."),
        Check::Regular => sysctl(rule,
            "Protect shared directories against unexpected regular-file writes after compatibility testing.",
            "Consider fs.protected_regular=1 for world-writable sticky directories, or 2 to also cover group-writable sticky directories.",
            "Programs opening another user's existing regular files with creation flags in shared directories may fail; test shared-file workflows."),
        Check::Syncookies => sysctl(rule,
            "Enable the SYN-cookie overflow fallback and review connection-queue capacity.",
            "Consider net.ipv4.tcp_syncookies=1 as the queue-overflow fallback. Diagnose listen backlog and capacity alongside it; value 2 is an unconditional test mode.",
            "SYN cookies affect connection handling under backlog pressure and do not replace capacity planning or denial-of-service controls."),
        Check::BroadcastIcmp => sysctl(rule,
            "Ignore broadcast ping requests unless the network has a documented need for replies.",
            "Consider net.ipv4.icmp_echo_ignore_broadcasts=1 unless a documented network requirement needs broadcast or multicast echo replies.",
            "Broadcast-based discovery or diagnostics may no longer receive replies. Unicast traffic and firewall rules are separate concerns."),
        Check::Ipv4Forward => {
            let mut plan = sysctl(rule,
                "Review the selected Router role and intended IPv4 forwarding policy.",
                "Confirm the selected Router role is correct, then consider net.ipv4.ip_forward=1 with reviewed forwarding firewall rules and routes.",
                "Enabling routing can expose traffic between interfaces. Changing ip_forward also resets IPv4 configuration parameters to host/router defaults; preserve required VPN, route and per-interface settings.");
            // This condition is promoted only by final role policy; keep its role-specific short next step.
            plan.next_step = None;
            plan.guide.verification = steps(&[
                "Verify intended IPv4 routes, per-interface settings, forwarding firewall and administrator access after the change.",
                "Rerun this area. Test IPv6 and external reachability separately.",
            ]);
            plan.guide.rollback = "Restore the recorded forwarding value, persistent override and affected network settings through console recovery if necessary. Recheck routes and firewall behavior; reversing ip_forward may reset defaults again.".into();
            plan
        }
        Check::GroupFile | Check::CrontabFile => file(rule, false, false),
        Check::GshadowFile => file(rule, true, false),
        Check::SudoersFile => file(rule, true, true),
        Check::DuplicateLogins => accounts(
            "Identify repeated local login names and resolve unintended records using the distribution's supported account tools. Preserve the intended account's UID, ownership and access.",
            "Removing a duplicate name without checking its numeric identity can break file ownership, service accounts or administrator access."),
        Check::NonshadowPasswords => accounts(
            "Review the affected local passwd records and migrate unintended password data into protected shadow storage with supported tools. Confirm whether an alternative authentication format is intentional.",
            "Account-storage changes can break authentication. Existing exposed credentials may need rotation; do not paste password fields into this report."),
        Check::DuplicateGroupNames => accounts(
            "Resolve unintended repeated local group names with supported group-management tools after identifying intended numeric IDs and memberships.",
            "Changing groups can alter service access and file permissions; preserve intended memberships and ownership mappings."),
        Check::AuditEnabled => advice(
            "Review and enable the host's intended audit collection policy.",
            steps(&[
                "Confirm which audit service and rule policy manage this host.",
                "Consider enabling kernel auditing and an appropriate collector through that policy; do not choose immutable mode merely to clear this check.",
            ]),
            "Audit rules and traffic volume affect storage and performance. Immutable enabled=2 cannot be changed until reboot; an enabled flag alone does not provide useful event coverage.",
            steps(&[
                "Check audit status and confirm a controlled expected audit event reaches its destination.",
                "Check storage capacity and rerun this area. Review rules and retention separately.",
            ]),
            "Restore only the recorded policy changes while preserving collected events. Immutable mode requires correcting persistent policy and a controlled reboot before it can be changed."),
        Check::AuditLost => advice(
            "Investigate why audit records were discarded before resetting the counter.",
            steps(&[
                "Record the cumulative lost counter and collection status.",
                "Review audit backlog, rate limits, collector health and storage pressure with the administrator; address the verified bottleneck.",
            ]),
            "Changing audit capacity or failure policy affects memory, performance and availability. Lost events cannot be reconstructed by clearing the counter.",
            steps(&[
                "Confirm new expected events reach the audit destination and the recorded lost counter stops increasing under normal load.",
                "Rerun this area. A historical nonzero counter can remain after the cause is fixed.",
            ]),
            "Restore the recorded capacity or policy settings if they harm availability, retaining existing audit evidence. A counter reset does not recover earlier missing records."),
        Check::Perf | Check::Kexec | Check::Modules | Check::Sysrq | Check::Uring | Check::BogusIcmp
        | Check::Ipv6Forward | Check::DuplicateGids | Check::Lsm | Check::Selinux | Check::Apparmor
        | Check::TimeSync => return None,
    })
}
