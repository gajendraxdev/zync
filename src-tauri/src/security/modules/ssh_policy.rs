//! Connection-aware interpretation of the current named config, never proof of loaded live policy.
use super::ExtraResult;
use crate::security::{
    catalog::{ApplicabilityPolicy, Category, Evaluation, RuleDefinition},
    facts::Facts,
    hardening::Outcome,
};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, net::IpAddr};

pub(super) const KEYS: &[&str] = &[
    "ssh_preview_context",
    "ssh_preview_probe",
    "ssh_preview_base",
    "ssh_preview_policy",
];
pub(super) const SCRIPT: &str = include_str!("../collectors/ssh-policy.sh");
const REFERENCE: &str = "https://man.openbsd.org/sshd";
const SCOPE: &str = "Current /etc/ssh/sshd_config preview for the captured user and numeric connection inputs, only with UseDNS=no. Running-daemon arguments, reload state and actual authentication policy are not established. No Passed result is issued.";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::security) enum Check {
    RootLogin,
    Password,
    PublicKey,
    EmptyPassword,
    HostBased,
    X11,
    Attempts,
    StrictModes,
}

/// The preview has distinct IDs and precise scope rather than relabeling default-file observations as live policy.
const fn rule(
    check: Check,
    id: &'static str,
    title: &'static str,
    expected: &'static str,
    guidance: &'static str,
) -> RuleDefinition {
    RuleDefinition {
        id,
        fact_key: "ssh_preview_policy",
        category: Category::Ssh,
        title,
        target: "Current standard SSH config: captured connection inputs",
        expected,
        rationale: "Connection-specific Match blocks can differ from configuration defaults; a current-file preview still does not prove what the running daemon loaded.",
        scope: SCOPE,
        guidance,
        reference: REFERENCE,
        rule_version: "1",
        reviewed_at: "2026-10-25",
        applicability: ApplicabilityPolicy::Linux,
        evaluation: Evaluation::SshPolicy(check),
    }
}
pub(super) const RULES: &[RuleDefinition] = &[
    rule(
        Check::RootLogin,
        "SSH-PREVIEW-root-login",
        "SSH preview: root login",
        "Review root-login policy calculated for these connection inputs.",
        "Prefer named administrative accounts and controlled elevation where appropriate. Establish the actual daemon startup/reload context before treating this preview as live policy.",
    ),
    rule(
        Check::Password,
        "SSH-PREVIEW-password",
        "SSH preview: password login",
        "Review password authentication calculated for these connection inputs.",
        "Review password authentication with the host's MFA, access and recovery requirements. Do not disable an access method without a tested alternative.",
    ),
    rule(
        Check::PublicKey,
        "SSH-PREVIEW-public-key",
        "SSH preview: public-key login",
        "Review public-key authentication calculated for these connection inputs.",
        "Review key/certificate and other authentication requirements together. This preview does not validate authorized keys or which authentication path succeeded.",
    ),
    rule(
        Check::EmptyPassword,
        "SSH-PREVIEW-empty-password",
        "SSH preview: empty passwords",
        "Review empty-password policy calculated for these connection inputs.",
        "Review any permission to use empty passwords alongside PAM and account policy. This value alone does not prove that an empty-password login is accepted.",
    ),
    rule(
        Check::HostBased,
        "SSH-PREVIEW-host-based",
        "SSH preview: host-based authentication",
        "Review host-based trust calculated for these connection inputs.",
        "Review deliberate host-based authentication and its host/user trust files. Those files and effective trust relationships were not evaluated.",
    ),
    rule(
        Check::X11,
        "SSH-PREVIEW-x11",
        "SSH preview: X11 forwarding",
        "Review X11 forwarding calculated for these connection inputs.",
        "Retain X11 forwarding only where required, after reviewing application and access needs. The client and actual session forwarding were not tested.",
    ),
    rule(
        Check::Attempts,
        "SSH-PREVIEW-attempts",
        "SSH preview: authentication attempts",
        "Review the calculated authentication-attempt limit.",
        "Choose limits with authentication methods and recovery in mind. Rate limits, source bans and authentication logs were not inspected.",
    ),
    rule(
        Check::StrictModes,
        "SSH-PREVIEW-strict-modes",
        "SSH preview: key-file ownership checks",
        "Review ownership checks calculated for these connection inputs.",
        "Prefer StrictModes where compatible. Its configured value does not verify every authorized-key file, ACL or parent directory.",
    ),
];

struct Context {
    client: IpAddr,
    client_port: u16,
    local: IpAddr,
    local_port: u16,
    user_hash: String,
}

/// Accept one exact bounded key/value record per declared connection field; no remote environment is sourced.
fn fields(source: &str) -> Option<BTreeMap<&str, &str>> {
    if source.len() > 2048 {
        return None;
    }
    let mut values = BTreeMap::new();
    for line in source.lines() {
        let (key, value) = line.split_once('=')?;
        if values.insert(key, value).is_some() {
            return None;
        }
    }
    Some(values)
}

/// Match parameters are numeric socket addresses/ports plus an opaque hash of the actual session account.
fn context(facts: &Facts) -> Option<Context> {
    let values = fields(facts.get(KEYS[0])?)?;
    if values.len() != 6 || values.get("schema") != Some(&"1") {
        return None;
    }
    let port = |key: &str| {
        let value = *values.get(key)?;
        (!value.is_empty() && value.len() <= 5 && value.bytes().all(|b| b.is_ascii_digit()))
            .then(|| value.parse::<u16>().ok())
            .flatten()
            .filter(|value| *value != 0)
    };
    let hash = *values.get("userHash")?;
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return None;
    }
    Some(Context {
        client: values.get("client")?.parse().ok()?,
        client_port: port("clientPort")?,
        local: values.get("local")?.parse().ok()?,
        local_port: port("localPort")?,
        user_hash: hash.into(),
    })
}

/// Comparison identity includes exactly the Match inputs; source TCP ephemeral ports are not Match criteria.
pub(in crate::security) fn target_key(facts: &Facts) -> Option<String> {
    let context = context(facts)?;
    let mut hash = Sha256::new();
    hash.update(b"zync-ssh-policy-preview-target-v1\0/etc/ssh/sshd_config\0");
    hash.update(
        format!(
            "{}\0{}\0{}\0{}",
            context.client, context.local, context.local_port, context.user_hash
        )
        .as_bytes(),
    );
    Some(
        hash.finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    )
}

/// The parser returns one field independently, so an unfamiliar sibling setting cannot validate it.
fn setting<'a>(source: &'a str, name: &str) -> Option<&'a str> {
    if source.len() > 4096 {
        return None;
    }
    let mut values = source.lines().filter_map(|line| line.strip_prefix(name));
    let value = values.next()?;
    (values.next().is_none() && !value.is_empty() && value.len() <= 32).then_some(value)
}

/// Context and hostname uncertainty remain unavailable; recognized current-file settings never receive Passed.
pub(super) fn evaluate(facts: &Facts, check: Check) -> ExtraResult {
    let Some(context) = context(facts) else {
        return ExtraResult::UnavailableWith{reason:"The SSH connection inputs could not be verified for this preview.",next_step:"Run on an existing SSH session whose original SSH_CONNECTION metadata is available. No environment or daemon-command guess is used."};
    };
    // Keep both source and destination ports validated even though only the destination is a Match input.
    let _ = context.client_port;
    match facts.get(KEYS[1]) {
        Some("mode=G" | "mode=T") => {}
        _ => return ExtraResult::UnavailableAt(KEYS[1]),
    }
    let Some(base) = facts.get(KEYS[2]) else {
        return ExtraResult::UnavailableAt(KEYS[2]);
    };
    if base != "usedns no" {
        return ExtraResult::UnavailableWith{reason:"Hostname-dependent SSH Match inputs could not be established from the checked configuration.",next_step:"Review the named SSH configuration with its administrator. This preview requires an explicit calculated UseDNS=no result; it does not guess reverse DNS or the running daemon's policy."};
    }
    let Some(source) = facts.get(KEYS[3]) else {
        return ExtraResult::UnavailableAt(KEYS[3]);
    };
    if setting(source, "usedns ") != Some("no") {
        return ExtraResult::UnavailableAt(KEYS[3]);
    }
    let (field, title, attention) = match check {
        Check::RootLogin => ("permitrootlogin ", "root login", Some("yes")),
        Check::Password => (
            "passwordauthentication ",
            "password authentication",
            Some("yes"),
        ),
        Check::PublicKey => ("pubkeyauthentication ", "public-key authentication", None),
        Check::EmptyPassword => (
            "permitemptypasswords ",
            "empty-password authentication",
            Some("yes"),
        ),
        Check::HostBased => (
            "hostbasedauthentication ",
            "host-based authentication",
            Some("yes"),
        ),
        Check::X11 => ("x11forwarding ", "X11 forwarding", Some("yes")),
        Check::Attempts => ("maxauthtries ", "authentication attempts", None),
        Check::StrictModes => ("strictmodes ", "key-file ownership checks", Some("no")),
    };
    let Some(value) = setting(source, field) else {
        return ExtraResult::UnavailableAt(KEYS[3]);
    };
    let valid = match check {
        Check::RootLogin => matches!(
            value,
            "yes" | "no" | "prohibit-password" | "without-password" | "forced-commands-only"
        ),
        Check::Attempts => {
            value.len() <= 10
                && value.bytes().all(|b| b.is_ascii_digit())
                && value.parse::<u32>().is_ok()
        }
        _ => matches!(value, "yes" | "no"),
    };
    if !valid {
        return ExtraResult::UnavailableAt(KEYS[3]);
    }
    let outcome = if attention == Some(value) {
        Outcome::Attention
    } else {
        Outcome::Informational
    };
    ExtraResult::Available {value:format!("{}{}; source=current /etc/ssh/sshd_config; evaluated Match inputs=captured connection; loaded daemon policy=unverified",field,value),
        observed:format!("Current-file preview for {title}: {value}. Running-daemon overrides and reload state are unverified."),outcome}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::facts::Fact;
    /// The actual user is represented only by a hash; socket metadata is inert synthetic test data.
    fn fixture() -> Facts {
        Facts(BTreeMap::from([
            (KEYS[0].into(),Fact{output:format!("schema=1\nclient=192.0.2.10\nclientPort=49222\nlocal=192.0.2.20\nlocalPort=22\nuserHash={}","a".repeat(64)),status:0}),
            (KEYS[1].into(),Fact{output:"mode=G".into(),status:0}),(KEYS[2].into(),Fact{output:"usedns no".into(),status:0}),
            (KEYS[3].into(),Fact{output:"usedns no\npermitrootlogin no\npasswordauthentication no\npubkeyauthentication yes\npermitemptypasswords no\nhostbasedauthentication no\nx11forwarding no\nmaxauthtries 6\nstrictmodes yes".into(),status:0})]))
    }
    #[test]
    fn previews_never_claim_live_pass_or_guess_unknown_match_context() {
        for rule in RULES {
            let Evaluation::SshPolicy(check) = rule.evaluation else {
                panic!("Wrong evaluator");
            };
            assert!(matches!(
                evaluate(&fixture(), check),
                ExtraResult::Available {
                    outcome: Outcome::Informational,
                    ..
                }
            ));
        }
        let mut facts = fixture();
        facts.0.get_mut(KEYS[2]).unwrap().output = "usedns yes".into();
        assert!(matches!(
            evaluate(&facts, Check::Password),
            ExtraResult::UnavailableWith { .. }
        ));
        let mut facts = fixture();
        facts
            .0
            .get_mut(KEYS[0])
            .unwrap()
            .output
            .push_str("\nclient=evil");
        assert!(target_key(&facts).is_none());
        assert!(matches!(
            evaluate(&facts, Check::Password),
            ExtraResult::UnavailableWith { .. }
        ));
    }
    #[test]
    fn projected_settings_are_independent_and_attention_is_only_current_file() {
        let mut facts = fixture();
        facts.0.get_mut(KEYS[3]).unwrap().output="usedns no\npermitrootlogin yes\npasswordauthentication maybe\npubkeyauthentication yes".into();
        assert!(matches!(
            evaluate(&facts, Check::RootLogin),
            ExtraResult::Available {
                outcome: Outcome::Attention,
                ..
            }
        ));
        assert!(matches!(
            evaluate(&facts, Check::Password),
            ExtraResult::UnavailableAt(_)
        ));
        assert!(matches!(
            evaluate(&facts, Check::PublicKey),
            ExtraResult::Available {
                outcome: Outcome::Informational,
                ..
            }
        ));
        facts
            .0
            .get_mut(KEYS[3])
            .unwrap()
            .output
            .push_str("\npubkeyauthentication no");
        assert!(matches!(
            evaluate(&facts, Check::PublicKey),
            ExtraResult::UnavailableAt(_)
        ));
    }
    #[test]
    fn comparison_keys_bind_match_inputs_not_ephemeral_client_ports() {
        let mut facts = fixture();
        let key = target_key(&facts).unwrap();
        facts.0.get_mut(KEYS[0]).unwrap().output =
            facts.0[KEYS[0]].output.replace("49222", "49223");
        assert_eq!(target_key(&facts).unwrap(), key);
        facts.0.get_mut(KEYS[0]).unwrap().output = facts.0[KEYS[0]]
            .output
            .replace("localPort=22", "localPort=2222");
        assert_ne!(target_key(&facts).unwrap(), key);
        facts.0.get_mut(KEYS[0]).unwrap().output = facts.0[KEYS[0]]
            .output
            .replace("localPort=2222", "localPort=65536");
        assert!(target_key(&facts).is_none());
    }
    #[test]
    fn preview_protocol_and_metadata_have_exact_scope() {
        assert_eq!(RULES.len(), 8);
        let keys: Vec<_> = SCRIPT
            .lines()
            .filter_map(|line| {
                line.strip_prefix("collect ")
                    .and_then(|line| line.split_whitespace().next())
            })
            .collect();
        assert_eq!(keys, KEYS);
        let commands = SCRIPT
            .lines()
            .map(str::trim)
            .filter(|line| !line.starts_with('#'))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            !commands.contains("ps ")
                && !commands.contains("/proc/")
                && !commands.contains("eval ")
        );
        for rule in RULES {
            assert!(rule.scope.contains("No Passed"));
        }
    }

    /// Exercise the production projection against OpenSSH itself without opening a listener or reading host keys.
    #[cfg(target_os = "linux")]
    #[test]
    fn real_openssh_match_preview_is_bounded_filtered_and_not_live_policy() {
        let Ok(probe) = std::process::Command::new("/usr/sbin/sshd")
            .args(["-G", "-T", "-f", "/dev/null"])
            .output()
        else {
            eprintln!("Real OpenSSH preview fixture skipped: local /usr/sbin/sshd is not installed. The opt-in Docker matrix provisions its own daemon.");
            return;
        };
        if !probe.status.success() {
            eprintln!("Real OpenSSH preview fixture skipped: local sshd does not support parsing-only -G -T. The opt-in matrix separately qualifies legacy -T.");
            return;
        }
        let folder = tempfile::tempdir().unwrap();
        let config = folder.path().join("sshd_config");
        let source = SCRIPT.split("collect ssh_preview_context").next().unwrap();
        let source = source.replace("/etc/ssh/sshd_config", "$PREVIEW_CONFIG");
        let code = format!("protected() {{ if [ \"${{PREVIEW_DELAY:-}}\" = 1 ]; then sleep 5; fi; /usr/bin/timeout 4s \"$@\"; }}\nsudo_nonce=fixture-nonce\nlabel=ssh_preview_base\n{source}\nssh_preview_context >/dev/null || exit $?\nssh_preview_probe >/dev/null || exit $?\nssh_preview_base || exit $?\nlabel=ssh_preview_policy\nssh_preview_policy");
        let run = |connection: &str, delay: bool| {
            std::process::Command::new("/usr/bin/timeout")
                .args(["--kill-after=1s", "20s", "/bin/sh", "-c", &code])
                .env_clear()
                .env("PATH", "/usr/sbin:/usr/bin:/bin")
                .env("LC_ALL", "C")
                .env("PREVIEW_CONFIG", &config)
                .env("PREVIEW_DELAY", if delay { "1" } else { "0" })
                .env("ZYNC_SSH_CONNECTION", connection)
                .output()
                .unwrap()
        };
        std::fs::write(&config,"UseDNS no\nPasswordAuthentication yes\nAuthorizedKeysCommand /private-fixture-must-not-leave-host\nAuthorizedKeysCommandUser nobody\nMatch Address 192.0.2.10 LocalAddress 192.0.2.20 LocalPort 2222\n PasswordAuthentication no\n X11Forwarding no\n").unwrap();
        let result = run("192.0.2.10 49152 192.0.2.20 2222", false);
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let output = String::from_utf8(result.stdout).unwrap();
        assert_eq!(setting(&output, "passwordauthentication "), Some("no"));
        assert!(!output.contains("private-fixture") && !output.contains("authorizedkeys"));
        let result = run("192.0.2.11 49152 192.0.2.20 2222", false);
        assert_eq!(
            setting(
                &String::from_utf8(result.stdout).unwrap(),
                "passwordauthentication "
            ),
            Some("yes")
        );
        let result = run("192.0.2.10 49152 192.0.2.20 2222", true);
        assert!(
            result.status.success(),
            "Consumers must wait for approved authentication"
        );
        for bad in [
            "192.0.2.10 49152 192.0.2.20 65536",
            "host 49152 192.0.2.20 22",
            "192.0.2.10 49152 192.0.2.20 22 extra",
            "192.0.2.10 49152 192.0.2.20 22;id",
        ] {
            let result = run(bad, false);
            assert_eq!(result.status.code(), Some(65));
            assert!(result.stdout.is_empty());
        }
        std::fs::write(&config, "UseDNS yes\nPasswordAuthentication no\n").unwrap();
        let result = run("192.0.2.10 49152 192.0.2.20 2222", false);
        assert_eq!(result.status.code(), Some(66));
        assert_eq!(String::from_utf8(result.stdout).unwrap(), "usedns yes\n");
    }

    /// A process failure or cutoff never turns an otherwise plausible field into a successful preview.
    #[cfg(target_os = "linux")]
    #[test]
    fn preview_projection_requires_completion_and_preserves_protected_failures() {
        let source = SCRIPT.split("collect ssh_preview_context").next().unwrap();
        for status in [0, 1, 77, 124, 137] {
            let code = format!("protected() {{ printf 'usedns no\\npasswordauthentication no\\n'; return {status}; }}\nsudo_nonce=fixture-nonce\nlabel=ssh_preview_policy\nssh_preview_mode=G\nssh_preview_tool=/usr/sbin/sshd\n{source}\nssh_preview_read policy");
            let result = std::process::Command::new("/bin/sh")
                .args(["-c", &code])
                .env_clear()
                .env("PATH", "/usr/bin:/bin")
                .output()
                .unwrap();
            assert_eq!(result.status.code(), Some(status));
            if status != 0 {
                assert!(result.stdout.is_empty());
            }
        }
        let code = format!("protected() {{ sleep 5; printf 'usedns no\\npasswordauthentication no\\n'; }}\nsudo_nonce=fixture-nonce\nlabel=ssh_preview_policy\nssh_preview_mode=G\nssh_preview_tool=/usr/sbin/sshd\n{source}\nssh_preview_read policy");
        let result = std::process::Command::new("/usr/bin/timeout")
            .args(["--kill-after=1s", "10s", "/bin/sh", "-c", &code])
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "The bounded consumer must survive approval waits independently of installed sshd"
        );
        assert!(String::from_utf8(result.stdout)
            .unwrap()
            .contains("passwordauthentication no"));
        let code = format!("protected() {{ head -c 600000 /dev/zero | tr '\\000' x; printf '\\nusedns no\\n'; }}\nsudo_nonce=fixture-nonce\nlabel=ssh_preview_policy\nssh_preview_mode=G\nssh_preview_tool=/usr/sbin/sshd\n{source}\nssh_preview_read policy");
        let result = std::process::Command::new("/bin/sh")
            .args(["-c", &code])
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .output()
            .unwrap();
        assert_eq!(result.status.code(), Some(65));
        assert!(result.stdout.is_empty());
    }
}
