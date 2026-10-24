use super::{
    facts::{self, Fact, Facts},
    hardening,
    report::{HostIdentity, Kind, Request},
};
use std::collections::BTreeMap;

/// Build inert observations without invoking SSH or host commands.
fn facts(values: &[(&str, &str)]) -> Facts {
    Facts(
        values
            .iter()
            .map(|(key, value)| {
                (
                    key.to_string(),
                    Fact {
                        output: value.to_string(),
                        status: 0,
                    },
                )
            })
            .collect::<BTreeMap<_, _>>(),
    )
}
/// A complete nonce-bound envelope and exact record order are required, even on exit zero.
#[test]
fn protocol_completion_and_status() {
    let valid = b"ZYNC_FACTS_V2\0nonce\0os\0ID=ubuntu\nVERSION_ID=\"24.04\"\n\x000\0complete\0";
    let parsed = facts::decode(valid, "nonce", &["os"]).unwrap();
    assert_eq!(parsed.os().unwrap(), ("ubuntu".into(), "24.04".into()));
    assert!(facts::decode(valid, "wrong", &["os"]).is_err());
    assert!(facts::decode(&valid[..valid.len() - 2], "nonce", &["os"]).is_err());
    assert!(facts::decode(valid, "nonce", &["os", "extra"]).is_err());
    let denied = facts::decode(
        b"ZYNC_FACTS_V2\0n\0os\0denied\x001\0complete\0",
        "n",
        &["os"],
    )
    .unwrap();
    assert!(denied.get("os").is_none());
}
/// Denied reads, malformed numeric values and SSH context ambiguity must not pass.
#[test]
fn hardening_unknowns_permissions_and_context() {
    let facts = facts(&[
        ("os", "ID=debian\nVERSION_ID=12"),
        ("aslr", "2"),
        ("ptrace", "0"),
        ("kptr", "garbage"),
        ("passwd", "81a4 0 0"),
        ("shadow", "81a0 0 42"),
        ("shadow_group", "42"),
        ("ssh_config", "81b6 0 0"),
        (
            "ssh_defaults",
            "permitrootlogin no\npasswordauthentication no",
        ),
    ]);
    let report = hardening::assess(&facts).unwrap();
    let status = |id: &str| {
        report
            .findings
            .iter()
            .find(|finding| finding.id == id)
            .unwrap()
            .status
            .as_str()
    };
    assert_eq!(status("LINUX-aslr"), "passed");
    assert_eq!(status("LINUX-ptrace"), "attention");
    assert_eq!(status("LINUX-kptr"), "notAssessed");
    assert_eq!(status("LINUX-dmesg"), "notAssessed");
    assert_eq!(status("FILE-shadow"), "passed");
    assert_eq!(status("FILE-ssh_config"), "attention");
    assert_eq!(status("SSH-permitrootlogin"), "informational");
    assert_eq!(report.findings.len(), 38);
    assert_eq!(
        super::report::text("NoNewPrivileges=no\nProtectSystem=no\tPrivateTmp=no", 100),
        "NoNewPrivileges=no ProtectSystem=no PrivateTmp=no"
    );
}
/// Group-readable shadow files require known trusted group ownership, while unsafe modes never pass.
#[test]
fn shadow_permissions_require_group_evidence() {
    for (metadata, group, expected) in [
        ("81a0 0 42", Some("42"), "passed"),
        ("81a0 0 1000", Some("42"), "attention"),
        ("81a0 0 42", Some("absent"), "attention"),
        ("81a0 0 42", None, "notAssessed"),
        ("81a0 0 42", Some("invalid"), "notAssessed"),
        ("81a0 0 42", Some("-1"), "notAssessed"),
        ("81a0 0 0", None, "passed"),
        ("8180 0 1000", None, "passed"),
        ("81a4 0 42", None, "attention"),
        ("81b0 0 42", None, "attention"),
        ("81a0 1000 42", None, "attention"),
        ("41a0 0 42", Some("42"), "notAssessed"),
        ("a1a0 0 42", Some("42"), "notAssessed"),
        ("81a0 0 42 extra", Some("42"), "notAssessed"),
        ("81a0 0 -1", Some("42"), "notAssessed"),
        ("181a0 0 42", Some("42"), "notAssessed"),
        ("640 0 regular file", Some("42"), "notAssessed"),
    ] {
        let mut values = facts(&[("os", "ID=ubuntu\nVERSION_ID=22.04"), ("shadow", metadata)]);
        if let Some(output) = group {
            values.0.insert(
                "shadow_group".into(),
                Fact {
                    status: 0,
                    output: output.into(),
                },
            );
        }
        let report = hardening::assess(&values).unwrap();
        let finding = report
            .findings
            .iter()
            .find(|item| item.id == "FILE-shadow")
            .unwrap();
        assert_eq!(
            finding.status, expected,
            "metadata={metadata}, group={group:?}"
        );
        if expected == "passed" {
            assert!(finding.evidence.contains("gid="));
        }
        assert!(!finding.sudo_retry_eligible && !finding.needs_elevated_access);
    }
    let mut values = facts(&[
        ("os", "ID=ubuntu\nVERSION_ID=22.04"),
        ("shadow", "81a0 0 42"),
        ("shadow_group", "42"),
    ]);
    values.0.get_mut("shadow_group").unwrap().status = 77;
    let report = hardening::assess(&values).unwrap();
    let finding = report
        .findings
        .iter()
        .find(|item| item.id == "FILE-shadow")
        .unwrap();
    assert_eq!(finding.status, "notAssessed");
    assert!(finding.evidence.contains("denied"));
    assert!(!finding.sudo_retry_eligible && !finding.needs_elevated_access);
}

/// Numeric stat mode validates permissions independently of file length or human-readable type labels.
#[test]
fn regular_file_metadata_is_size_independent() {
    for (metadata, expected) in [
        ("81a4 0 0", "passed"),
        ("81b6 0 0", "attention"),
        ("41a4 0 0", "notAssessed"),
        ("81a4 0 0 extra", "notAssessed"),
    ] {
        let report = hardening::assess(&facts(&[
            ("os", "ID=ubuntu\nVERSION_ID=22.04"),
            ("ssh_config", metadata),
        ]))
        .unwrap();
        let finding = report
            .findings
            .iter()
            .find(|item| item.id == "FILE-ssh_config")
            .unwrap();
        assert_eq!(finding.status, expected);
        if expected == "passed" {
            assert_eq!(finding.evidence, "mode=0644 uid=0 gid=0");
        }
    }
}

/// Every interpreted fact observes the same raw-byte budget, including padding and multi-byte UTF-8.
#[test]
fn shared_fact_budget_bounds_all_rules_before_trimming() {
    for key in facts::HARDENING_KEYS {
        for size in [
            facts::MAX_FACT_BYTES - 1,
            facts::MAX_FACT_BYTES,
            facts::MAX_FACT_BYTES + 1,
        ] {
            let values = facts(&[(key, &"x".repeat(size))]);
            assert_eq!(
                values.get(key).is_some(),
                size <= facts::MAX_FACT_BYTES,
                "{key}: {size}"
            );
        }
    }
    let mut values = facts(&[
        ("os", "ID=ubuntu\nVERSION_ID=22.04"),
        ("aslr", "2"),
        ("ssh_defaults", "permitrootlogin no"),
        ("listeners", ""),
        ("journal", "LoadState=loaded\nActiveState=active"),
        ("shadow", "81a0 0 42"),
        ("shadow_group", "42"),
    ]);
    for key in [
        "aslr",
        "ssh_defaults",
        "listeners",
        "journal",
        "shadow_group",
    ] {
        let fact = values.0.get_mut(key).unwrap();
        fact.output.push_str(&" ".repeat(facts::MAX_FACT_BYTES + 1));
    }
    let report = hardening::assess(&values).unwrap();
    for id in [
        "LINUX-aslr",
        "SSH-permitrootlogin",
        "NETWORK-listeners",
        "SERVICE-journal",
        "FILE-shadow",
    ] {
        let finding = report.findings.iter().find(|item| item.id == id).unwrap();
        assert_eq!(finding.status, "notAssessed", "{id}");
        assert!(finding.evidence.contains("interpretation budget"));
        assert!(!finding.sudo_retry_eligible);
    }
    let unicode = "é".repeat(facts::MAX_FACT_BYTES / 2 + 1);
    assert!(facts(&[("listeners", &unicode)]).get("listeners").is_none());
    values.0.get_mut("os").unwrap().output = " ".repeat(facts::MAX_FACT_BYTES + 1);
    assert!(hardening::assess(&values).is_err());
}

/// SSH defaults flag specific policy choices without claiming active policy or passing restrictive defaults.
#[test]
fn ssh_defaults_distinguish_attention_from_information() {
    for (key, information, attention) in [
        ("permitrootlogin", "no", Some("yes")),
        ("passwordauthentication", "no", Some("yes")),
        ("pubkeyauthentication", "yes", None),
        ("permitemptypasswords", "no", Some("yes")),
        ("hostbasedauthentication", "no", Some("yes")),
        ("x11forwarding", "no", Some("yes")),
        ("maxauthtries", "6", None),
        ("strictmodes", "yes", Some("no")),
    ] {
        for (value, expected) in [
            (information, "informational"),
            (
                attention.unwrap_or(information),
                if attention.is_some() {
                    "attention"
                } else {
                    "informational"
                },
            ),
            ("garbage", "notAssessed"),
        ] {
            let defaults = format!("{key} {value}");
            let report = hardening::assess(&facts(&[
                ("os", "ID=ubuntu\nVERSION_ID=22.04"),
                ("ssh_defaults", &defaults),
            ]))
            .unwrap();
            let exported = serde_json::to_value(&report).unwrap();
            let finding = exported["findings"]
                .as_array()
                .unwrap()
                .iter()
                .find(|item| item["id"] == format!("SSH-{key}"))
                .unwrap();
            assert_eq!(finding["status"], expected, "{key}={value}");
            if expected != "notAssessed" {
                assert_eq!(finding["evidence"], value);
            }
            assert!(report
                .notes
                .iter()
                .any(|note| note.contains("connection-specific Match")));
        }
    }
    for value in [
        "prohibit-password",
        "without-password",
        "forced-commands-only",
    ] {
        let defaults = format!("permitrootlogin {value}");
        let report = hardening::assess(&facts(&[
            ("os", "ID=ubuntu\nVERSION_ID=22.04"),
            ("ssh_defaults", &defaults),
        ]))
        .unwrap();
        assert_eq!(
            report
                .findings
                .iter()
                .find(|item| item.id == "SSH-permitrootlogin")
                .unwrap()
                .status,
            "informational"
        );
    }
}

/// Context-only evidence never creates warnings or passes; an explicit maintenance signal does.
#[test]
fn contextual_observations_and_maintenance_signals() {
    let mut values = facts(&[
        ("os", "ID=ubuntu\nVERSION_ID=22.04"),
        ("redirects", "0"), ("send_redirects", "1"), ("source_route", "0"),
        ("rp_filter", "2"), ("ipv6_redirects", "1"), ("dumps", "2"),
        ("listeners", ""), ("nft", r#"{"nftables":[]}"#),
        ("iptables", "*filter\n:INPUT ACCEPT [0:0]\nCOMMIT"),
        ("ip6tables", "*filter\n:INPUT DROP [0:0]\nCOMMIT"),
        ("tmp_mount", "/ rw,relatime"), ("shm_mount", "/dev/shm rw,nosuid,nodev"),
        ("apt_policy", "Periodic='1'\nUpgrade='0'"),
        ("journal", "LoadState=loaded\nActiveState=active"),
        ("ssh_service", "LoadState=loaded\nActiveState=active\nPrivateTmp=no"),
        ("reboot", "present"), ("package_health", "incomplete package fixture"),
        ("aslr", "2"), ("ptrace", "1"), ("kptr", "1"), ("dmesg", "1"),
        ("hardlinks", "1"), ("symlinks", "1"), ("bpf", "2"),
        ("passwd", "81a4 0 0"), ("shadow", "81a0 0 42"), ("shadow_group", "42"),
        ("ssh_config", "81a4 0 0"), ("accounts", "1 0"), ("shadow_empty", "0"),
        ("ssh_defaults", "permitrootlogin yes\npasswordauthentication yes\npubkeyauthentication yes\npermitemptypasswords no\nhostbasedauthentication no\nx11forwarding yes\nmaxauthtries 6\nstrictmodes yes"),
    ]);
    let report = hardening::assess(&values).unwrap();
    for id in [
        "LINUX-redirects",
        "LINUX-send_redirects",
        "LINUX-source_route",
        "LINUX-rp_filter",
        "LINUX-ipv6_redirects",
        "LINUX-dumps",
        "NETWORK-listeners",
        "NETWORK-nft",
        "NETWORK-iptables",
        "NETWORK-ip6tables",
        "MOUNT-tmp_mount",
        "MOUNT-shm_mount",
        "UPDATE-policy",
        "SERVICE-journal",
        "SERVICE-ssh",
    ] {
        assert_eq!(
            report
                .findings
                .iter()
                .find(|item| item.id == id)
                .unwrap()
                .status,
            "informational",
            "{id}"
        );
    }
    for id in ["UPDATE-reboot", "UPDATE-dpkg"] {
        assert_eq!(
            report
                .findings
                .iter()
                .find(|item| item.id == id)
                .unwrap()
                .status,
            "attention"
        );
    }
    values.0.get_mut("package_health").unwrap().output.clear();
    let report = hardening::assess(&values).unwrap();
    assert_eq!(report.findings.len(), 38);
    for (status, count) in [
        ("passed", 14),
        ("attention", 4),
        ("informational", 20),
        ("notAssessed", 0),
    ] {
        assert_eq!(
            report
                .findings
                .iter()
                .filter(|item| item.status == status)
                .count(),
            count,
            "{status}"
        );
    }
    for (value, expected) in [("absent", "informational"), ("invalid", "notAssessed")] {
        values.0.get_mut("reboot").unwrap().output = value.into();
        let report = hardening::assess(&values).unwrap();
        assert_eq!(
            report
                .findings
                .iter()
                .find(|item| item.id == "UPDATE-reboot")
                .unwrap()
                .status,
            expected
        );
    }
    values.0.get_mut("journal").unwrap().status = 77;
    let report = hardening::assess(&values).unwrap();
    assert_eq!(
        report
            .findings
            .iter()
            .find(|item| item.id == "SERVICE-journal")
            .unwrap()
            .status,
        "notAssessed"
    );
    assert!(report.findings.iter().all(|item| [
        "attention",
        "informational",
        "passed",
        "notAssessed"
    ]
    .contains(&item.status.as_str())));
    assert_eq!(report.version, "zync-linux-4 (2026-10-24)");
}

/// Collection failures cannot retain a rule's configuration recommendation, including in compatible JSON exports.
#[test]
fn unavailable_checks_offer_collection_next_steps() {
    for (status, hint) in [
        (None, "collector record"),
        (Some(0), "collector output"),
        (Some(1), "collection failure"),
        (Some(77), "Retry with sudo"),
        (Some(126), "could not execute"),
        (Some(127), "collector tool"),
        (Some(124), "deadline"),
        (Some(137), "deadline"),
    ] {
        let mut values = facts(&[
            ("os", "ID=ubuntu\nVERSION_ID=22.04"),
            ("privilege", "1000 user"),
            ("aslr", "2"),
        ]);
        if let Some(status) = status {
            values.0.insert(
                "ssh_defaults".into(),
                Fact {
                    output: "malformed".into(),
                    status,
                },
            );
        }
        let report = hardening::assess(&values).unwrap();
        let ssh = report
            .findings
            .iter()
            .find(|item| item.id == "SSH-permitrootlogin")
            .unwrap();
        assert_eq!(ssh.status, "notAssessed");
        assert_eq!(
            ssh.recommendation,
            values.collection_next_step("ssh_defaults")
        );
        assert!(ssh.recommendation.contains(hint));
        assert!(!ssh
            .recommendation
            .contains("Prefer named administrative accounts"));
        assert!(!ssh.recommendation.contains("PermitRootLogin"));
        assert_eq!(ssh.needs_elevated_access, status == Some(77));
        assert_eq!(ssh.sudo_retry_eligible, matches!(status, Some(1 | 77)));
        let passed = report
            .findings
            .iter()
            .find(|item| item.id == "LINUX-aslr")
            .unwrap();
        assert_eq!(passed.status, "passed");
        assert!(passed.recommendation.starts_with("Use full ASLR"));
        let exported = serde_json::to_value(&report).unwrap();
        let exported_ssh = exported["findings"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == "SSH-permitrootlogin")
            .unwrap();
        assert_eq!(exported_ssh["status"], "notAssessed");
        assert_eq!(exported_ssh["recommendation"], ssh.recommendation);
        assert_eq!(exported_ssh["sudoRetryEligible"], ssh.sudo_retry_eligible);
    }
    for privilege in ["0 user", "1000 sudo", "unknown"] {
        let mut values = facts(&[("privilege", privilege)]);
        values.0.insert(
            "ssh_defaults".into(),
            Fact {
                output: String::new(),
                status: 77,
            },
        );
        assert!(values
            .collection_next_step("ssh_defaults")
            .contains("access restriction"));
        assert!(!values
            .collection_next_step("ssh_defaults")
            .contains("Retry with sudo"));
    }
    let values = facts(&[
        ("os", "ID=ubuntu\nVERSION_ID=22.04"),
        ("ssh_defaults", "permitrootlogin yes"),
    ]);
    let report = hardening::assess(&values).unwrap();
    let ssh = report
        .findings
        .iter()
        .find(|item| item.id == "SSH-permitrootlogin")
        .unwrap();
    assert_eq!(ssh.status, "attention");
    assert!(ssh
        .recommendation
        .starts_with("Prefer named administrative accounts"));
}

/// Uncertain failures offer only an optional approved attempt; known tool/data/deadline failures do not.
#[test]
fn sudo_retry_eligibility_is_bounded_to_protected_unelevated_reads() {
    for key in facts::HARDENING_KEYS {
        for privilege in [
            "1000 user",
            "0 user",
            "1000 sudo",
            "0 sudo",
            "garbage",
            "-1 user",
        ] {
            let mut values = facts(&[
                ("privilege", privilege),
                ("os", "ID=ubuntu\nVERSION_ID=22.04"),
            ]);
            for status in 0..=255 {
                values.0.insert(
                    (*key).into(),
                    Fact {
                        status,
                        output: String::new(),
                    },
                );
                let expected = facts::is_protected_read(key)
                    && privilege == "1000 user"
                    && (1..=123).contains(&status)
                    && status != 65;
                assert_eq!(
                    values.can_retry_with_sudo(key),
                    expected,
                    "{key}: {privilege}, exit {status}"
                );
                assert_eq!(values.needs_elevated_access(key), expected && status == 77);
            }
        }
    }
    let mut values = facts(&[
        ("os", "ID=ubuntu\nVERSION_ID=22.04"),
        ("privilege", "1000 user"),
    ]);
    values.0.insert(
        "ssh_defaults".into(),
        Fact {
            status: 1,
            output: String::new(),
        },
    );
    let report = hardening::assess(&values).unwrap();
    assert!(report
        .findings
        .iter()
        .filter(|finding| finding.id.starts_with("SSH-"))
        .all(|finding| finding.status == "notAssessed"
            && finding.sudo_retry_eligible
            && !finding.needs_elevated_access
            && finding.recommendation.contains("Try with sudo")
            && finding.recommendation.contains("not confirmed")));
    values.0.get_mut("ssh_defaults").unwrap().status = 0;
    values.0.get_mut("ssh_defaults").unwrap().output = "permitrootlogin no".into();
    let report = hardening::assess(&values).unwrap();
    assert!(report
        .findings
        .iter()
        .all(|finding| !finding.sudo_retry_eligible));
}

/// Only hardening can be requested; removed VA requests cannot reach the collector through direct IPC.
#[test]
fn hardening_request_and_live_identity() {
    for elevation in [false, true] {
        let request: Request = serde_json::from_value(
            serde_json::json!({ "kind": "hardening", "elevationConsent": elevation }),
        )
        .unwrap();
        assert_eq!(request.kind, Kind::Hardening);
        assert_eq!(request.elevation_consent, elevation);
    }
    let request: Request =
        serde_json::from_value(serde_json::json!({ "kind": "hardening" })).unwrap();
    assert!(!request.elevation_consent);
    for invalid in [
        serde_json::json!({ "kind": "vulnerabilities" }),
        serde_json::json!({ "kind": "vulnerabilities", "elevationConsent": true }),
        serde_json::json!({ "kind": "hardening", "onlineConsent": true }),
        serde_json::json!({ "kind": "hardening", "program": "arbitrary" }),
    ] {
        assert!(serde_json::from_value::<Request>(invalid).is_err());
    }
    let live = HostIdentity {
        host: "one".into(),
        username: "user".into(),
        port: 22,
    };
    assert!(live.verify_expected(&live).is_ok());
    assert!(live
        .verify_expected(&HostIdentity {
            host: "two".into(),
            ..live.clone()
        })
        .is_err());
}

/// Denied, absent, timed-out and malformed evidence retain distinct explanations rather than passes.
#[test]
fn expanded_baseline_permission_and_capability_diagnostics() {
    let mut values = facts(&[
        ("os", "ID=ubuntu\nVERSION_ID=22.04"),
        ("privilege", "1000 sudo"),
        ("accounts", "2 1"),
        ("shadow_empty", "0"),
        ("listeners", "tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:*"),
        (
            "nft",
            r#"{"nftables":[{"chain":{"family":"inet","hook":"input","policy":"drop"}},{"rule":{}}]}"#,
        ),
        ("tmp_mount", "/ rw,relatime"),
        ("journal", "LoadState=not-found\nActiveState=inactive"),
    ]);
    values.0.insert(
        "ssh_defaults".into(),
        Fact {
            output: String::new(),
            status: 1,
        },
    );
    values.0.insert(
        "hardlinks".into(),
        Fact {
            output: String::new(),
            status: 127,
        },
    );
    values.0.insert(
        "symlinks".into(),
        Fact {
            output: String::new(),
            status: 77,
        },
    );
    values.0.insert(
        "ip6tables".into(),
        Fact {
            output: String::new(),
            status: 124,
        },
    );
    let report = hardening::assess(&values).unwrap();
    let finding = |id: &str| {
        report
            .findings
            .iter()
            .find(|finding| finding.id == id)
            .unwrap()
    };
    assert_eq!(report.collector_uid, Some(1000));
    assert!(report.elevation_requested);
    assert_eq!(finding("ACCOUNT-uid0").status, "attention");
    assert_eq!(finding("ACCOUNT-duplicate_uids").status, "attention");
    assert_eq!(finding("ACCOUNT-empty_passwords").status, "passed");
    assert!(finding("LINUX-hardlinks")
        .evidence
        .contains("not installed"));
    assert!(finding("LINUX-symlinks").evidence.contains("denied"));
    assert!(finding("SSH-permitrootlogin")
        .evidence
        .to_lowercase()
        .contains("sudo"));
    assert!(finding("NETWORK-ip6tables").evidence.contains("deadline"));
    assert!(finding("NETWORK-listeners")
        .evidence
        .contains("1 bound beyond loopback"));
    assert_eq!(finding("NETWORK-listeners").status, "informational");
    assert!(finding("NETWORK-nft").evidence.contains("inet/input: drop"));
    assert_eq!(finding("NETWORK-nft").status, "informational");
    assert_eq!(finding("SERVICE-journal").status, "notAssessed");
    assert_eq!(finding("MOUNT-tmp_mount").status, "informational");
    assert_eq!(finding("UPDATE-dpkg").status, "notAssessed");
    values.0.get_mut("accounts").unwrap().output = "".into();
    values.0.get_mut("listeners").unwrap().output = "malformed socket output".into();
    values.0.get_mut("nft").unwrap().output = "malformed ruleset".into();
    let malformed = hardening::assess(&values).unwrap();
    for id in ["ACCOUNT-uid0", "NETWORK-listeners", "NETWORK-nft"] {
        let finding = malformed
            .findings
            .iter()
            .find(|finding| finding.id == id)
            .unwrap();
        assert_eq!(finding.status, "notAssessed");
        assert!(finding.evidence.contains("malformed"));
    }
    values.0.get_mut("nft").unwrap().output = "x".repeat(512 * 1024 + 1);
    values.0.get_mut("listeners").unwrap().output =
        "tcp LISTEN 0 128 [::ffff:127.0.0.1]:22 [::]:*".into();
    let bounded = hardening::assess(&values).unwrap();
    assert!(bounded
        .findings
        .iter()
        .find(|finding| finding.id == "NETWORK-nft")
        .unwrap()
        .evidence
        .contains("interpretation budget"));
    assert!(bounded
        .findings
        .iter()
        .find(|finding| finding.id == "NETWORK-listeners")
        .unwrap()
        .evidence
        .contains("0 bound beyond loopback"));
    for (address, non_loopback) in [
        ("[fe80::1]%eth0", 1),
        ("[fe80::1%eth0]", 1),
        ("fe80::1%eth0", 1),
        ("[::1]%lo", 0),
        ("[::ffff:127.0.0.1]%lo", 0),
    ] {
        values.0.get_mut("listeners").unwrap().output = format!(
            "tcp LISTEN 0 128 127.0.0.1:22 0.0.0.0:*\nudp UNCONN 0 0 {address}:5353 [::]:*"
        );
        let report = hardening::assess(&values).unwrap();
        let finding = report
            .findings
            .iter()
            .find(|item| item.id == "NETWORK-listeners")
            .unwrap();
        assert_eq!(finding.status, "informational", "{address}");
        assert!(
            finding.evidence.contains(&format!(
                "2 listening TCP/UDP sockets; {non_loopback} bound beyond loopback"
            )),
            "{address}"
        );
        assert!(
            finding.evidence.contains(&format!("udp {address}:5353")),
            "Keep the original scoped endpoint in evidence"
        );
    }
}
