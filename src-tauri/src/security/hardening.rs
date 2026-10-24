//! Reviewed first-party Linux baseline. Recommendations are not automatic remediation.
use super::{
    facts::Facts,
    report::{text, Finding, Kind, Report},
};
const SYSCTL: &str = "https://docs.kernel.org/admin-guide/sysctl/";
const SSH: &str = "https://man.openbsd.org/sshd_config";
/// Distinguish a narrow baseline decision from evidence that needs workload-specific interpretation.
pub(super) enum Outcome {
    Passed,
    Attention,
    Informational,
}
impl Outcome {
    /// Convert only an established baseline condition into a pass; deviations need attention.
    pub(super) fn baseline(accepted: bool) -> Self {
        if accepted {
            Self::Passed
        } else {
            Self::Attention
        }
    }
}
/// Normalize rules with evidence-based guidance; unavailable checks receive collection next steps only.
pub(super) fn check(
    report: &mut Report,
    facts: &Facts,
    key: &str,
    id: &str,
    title: &str,
    target: &str,
    observed: Option<&str>,
    outcome: Outcome,
    recommendation: &str,
    reference: &str,
) {
    report.push(Finding {
        id: id.into(),
        category: match id.split('-').next().unwrap_or("") {
            "LINUX" => "Kernel",
            "FILE" | "MOUNT" => "Filesystems",
            "SSH" => "SSH",
            "ACCOUNT" => "Accounts",
            "NETWORK" => "Network",
            "UPDATE" => "Updates",
            _ => "Services",
        }
        .into(),
        needs_elevated_access: observed.is_none() && facts.needs_elevated_access(key),
        sudo_retry_eligible: observed.is_none() && facts.can_retry_with_sudo(key),
        status: if observed.is_none() {
            "notAssessed"
        } else {
            match outcome {
                Outcome::Passed => "passed",
                Outcome::Attention => "attention",
                Outcome::Informational => "informational",
            }
        }
        .into(),
        title: title.into(),
        target: target.into(),
        evidence: observed
            .map(|value| text(value, 1024))
            .unwrap_or_else(|| facts.diagnostic(key)),
        recommendation: if observed.is_none() {
            facts.collection_next_step(key).into()
        } else {
            recommendation.into()
        },
        reference: reference.into(),
    });
}
/// Evaluate narrowly scoped rules; never infer full-host coverage from an available subset.
pub fn assess(facts: &Facts) -> Result<Report, String> {
    let (id, version) = facts.os()?;
    let mut report = Report::new(Kind::Hardening, format!("{id} {version}"));
    if let Some(privilege) = facts.get("privilege") {
        let mut parts = privilege.split_whitespace();
        report.collector_uid = parts.next().and_then(|value| value.parse().ok());
        report.elevation_requested = parts.next() == Some("sudo");
    }
    for (key, title, target, minimum, maximum, recommendation) in [
        (
            "aslr",
            "Address-space randomization",
            "kernel.randomize_va_space",
            2,
            2,
            "Use full ASLR (2) unless a documented workload requires otherwise.",
        ),
        (
            "ptrace",
            "Process tracing restrictions",
            "kernel.yama.ptrace_scope",
            1,
            3,
            "Restrict cross-process tracing; validate debugger and monitoring requirements first.",
        ),
        (
            "kptr",
            "Kernel pointer exposure",
            "kernel.kptr_restrict",
            1,
            2,
            "Restrict kernel pointer disclosure; review observability requirements.",
        ),
        (
            "dmesg",
            "Kernel log access",
            "kernel.dmesg_restrict",
            1,
            1,
            "Restrict unprivileged kernel log reads where operationally appropriate.",
        ),
        (
            "hardlinks",
            "Hard-link protection",
            "fs.protected_hardlinks",
            1,
            1,
            "Enable protected hard links.",
        ),
        (
            "symlinks",
            "Symbolic-link protection",
            "fs.protected_symlinks",
            1,
            1,
            "Enable protected symbolic links in sticky writable directories.",
        ),
        (
            "bpf",
            "Unprivileged BPF restrictions",
            "kernel.unprivileged_bpf_disabled",
            1,
            2,
            "Restrict unprivileged BPF. Review workload needs before changing this setting.",
        ),
    ] {
        let observed = facts.get(key);
        let numeric = observed.and_then(|value| value.parse::<u32>().ok());
        check(
            &mut report,
            facts,
            key,
            &format!("LINUX-{key}"),
            title,
            target,
            numeric.and(observed),
            Outcome::baseline(numeric.is_some_and(|value| (minimum..=maximum).contains(&value))),
            recommendation,
            SYSCTL,
        );
    }
    // None means unavailable group evidence; Some(None) means no local shadow group exists.
    let shadow_group = facts.get("shadow_group").and_then(|value| {
        if value == "absent" {
            Some(None)
        } else {
            value.parse::<u32>().ok().map(Some)
        }
    });
    for (key, target, title, restricted) in [
        (
            "passwd",
            "/etc/passwd",
            "Account database permissions",
            false,
        ),
        (
            "shadow",
            "/etc/shadow",
            "Password database permissions",
            true,
        ),
        (
            "ssh_config",
            "/etc/ssh/sshd_config",
            "SSH configuration permissions",
            false,
        ),
    ] {
        let raw = facts.get(key);
        let parsed =
            raw.and_then(|value| {
                let mut fields = value.split_whitespace();
                let mode = u32::from_str_radix(fields.next()?, 16).ok()?;
                let uid = fields.next()?.parse::<u32>().ok()?;
                let gid = fields.next()?.parse::<u32>().ok()?;
                (fields.next().is_none() && mode <= 0xffff && mode & 0o170000 == 0o100000)
                    .then_some((mode & 0o7777, uid, gid))
            });
        let mode_accepted = parsed.is_some_and(|(mode, uid, _)| {
            uid == 0 && mode & 0o022 == 0 && (!restricted || mode & 0o007 == 0)
        });
        let needs_group = mode_accepted
            && restricted
            && parsed.is_some_and(|(mode, _, gid)| mode & 0o040 != 0 && gid != 0);
        let group_known = !needs_group || shadow_group.is_some();
        let accepted = mode_accepted
            && (!needs_group || parsed.is_some_and(|(_, _, gid)| shadow_group == Some(Some(gid))));
        let observed = parsed
            .filter(|_| group_known)
            .map(|(mode, uid, gid)| format!("mode={mode:04o} uid={uid} gid={gid}"));
        check(
            &mut report,
            facts,
            if group_known { key } else { "shadow_group" },
            &format!("FILE-{key}"),
            title,
            target,
            observed.as_deref(),
            Outcome::baseline(accepted),
            if restricted {
                "Keep root ownership, no group/world writes and no world access. Group read is accepted only for GID 0 or the local shadow group. Group membership and extended ACLs are not assessed."
            } else {
                "Keep root ownership and prevent group/world writes. This checks only the named file, not included files or parent directories."
            },
            "https://man7.org/linux/man-pages/man7/inode.7.html",
        );
    }
    let defaults = facts.get("ssh_defaults");
    for (key, title, recommendation) in [
        ("permitrootlogin", "SSH root-login policy", "Prefer named administrative accounts and controlled elevation. Review global PermitRootLogin and applicable Match blocks."),
        ("passwordauthentication", "SSH password-authentication policy", "Consider key/certificate authentication. Confirm a working alternative before disabling password access."),
        ("pubkeyauthentication", "SSH public-key authentication", "Review public-key and certificate authentication alongside AuthenticationMethods and applicable Match blocks."),
        ("permitemptypasswords", "SSH empty-password policy", "Do not allow empty-password authentication. Check PAM and the connection-specific effective policy before changing access."),
        ("hostbasedauthentication", "SSH host-based trust", "Disable host-based authentication unless explicitly required and managed for this host."),
        ("x11forwarding", "SSH X11 forwarding", "Enable X11 forwarding only for workflows that require it; review connection-specific policy."),
        ("maxauthtries", "SSH authentication-attempt limit", "Review authentication attempts alongside the identity/agent workflow. A low limit alone does not prevent distributed guessing."),
        ("strictmodes", "SSH authentication-file ownership checks", "Keep StrictModes enabled unless a documented requirement justifies otherwise. Verify key paths and ownership separately."),
    ] {
        let observed = defaults.and_then(|source| source.lines().find_map(|line| line.strip_prefix(&format!("{key} ")))).filter(|value| {
            match key {
                "permitrootlogin" => matches!(*value, "yes" | "no" | "prohibit-password" | "without-password" | "forced-commands-only"),
                "maxauthtries" => value.parse::<u32>().is_ok_and(|value| value > 0 && value <= 1024),
                _ => matches!(*value, "yes" | "no"),
            }
        });
        // Flag specific defaults, never claim effective session policy or pass from defaults alone.
        let attention = match key {
            "permitrootlogin" | "passwordauthentication" | "permitemptypasswords"
                | "hostbasedauthentication" | "x11forwarding" => observed == Some("yes"),
            "strictmodes" => observed == Some("no"),
            _ => false,
        };
        let outcome = if attention { Outcome::Attention } else { Outcome::Informational };
        check(&mut report, facts, "ssh_defaults", &format!("SSH-{key}"), title, "sshd configuration (default settings)", observed, outcome, recommendation, SSH);
    }
    super::hardening_checks::assess(facts, &mut report);
    report.notes.extend([
        "Coverage includes selected kernel settings, three file permissions, default SSH policy, local account counts, listening sockets, firewall observations, two mount policies, dpkg/APT health and systemd observations. It is not a compliance audit, penetration test or application/container assessment.".into(),
        "Needs attention identifies a baseline deviation, a specific default policy to review, or a maintenance signal; it is not a confirmed vulnerability. Informational observations have no automatic pass/fail decision. Passed applies only to the named baseline condition.".into(),
        "SSH defaults use config-only sshd -G when supported, with sshd -T as an older-version fallback. Host-key validity is not assessed. Running-daemon overrides and connection-specific Match rules are not established; SSH defaults never receive a pass. Restricted or missing checks are Evidence unavailable, not passed or failed.".into(),
        "Network observations describe only this host's current network namespace. Listening sockets and local firewall rules do not establish internet reachability or cloud firewall policy.".into(),
        if report.elevation_requested { "Sudo was explicitly authorized for fixed protected commands only. Password input is requested only after a run-bound sudo challenge and held in native memory only for this run; no sudo shell or sudoers changes. Server authentication-cache/logging policy still applies. Authorization or command failure leaves Evidence unavailable.".into() } else { "No sudo was requested. Checks run with the existing SSH user's privileges, including root if already connected as root. Protected evidence may be unavailable.".into() },
        "Baseline rules are reviewed with Zync releases; their version is shown above. Review recommendations against the server's role before making changes.".into(),
    ]);
    Ok(report)
}
