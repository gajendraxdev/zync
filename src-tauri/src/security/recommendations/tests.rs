use super::*;
use crate::security::{
    facts::{Fact, Facts},
    hardening,
    modules::ModuleId,
    policy::RoleId,
    report::{Report, MAX_REMEDIATION_FIELD_CHARS},
};
use serde_json::Value;
use std::collections::BTreeMap;

/// Synthetic observations exercise the real evaluator without collecting host data or running commands.
fn facts(values: &[(&str, &str)]) -> Facts {
    let mut records = BTreeMap::from([(
        "os".into(),
        Fact {
            output: "ID=ubuntu\nVERSION_ID=24.04".into(),
            status: 0,
        },
    )]);
    records.extend(values.iter().map(|(key, value)| {
        (
            (*key).into(),
            Fact {
                output: (*value).into(),
                status: 0,
            },
        )
    }));
    Facts(records)
}

fn finding<'a>(report: &'a Report, id: &str) -> &'a Finding {
    report.findings.iter().find(|item| item.id == id).unwrap()
}

/// Presentation changes must not alter identity, evidence, classification or collection permissions.
fn without_advice(value: &Finding) -> Value {
    let mut value = serde_json::to_value(value).unwrap();
    value.as_object_mut().unwrap().remove("remediation");
    value.as_object_mut().unwrap().remove("recommendation");
    value
}

#[test]
fn enhancement_is_inert_idempotent_and_independent_of_remote_prose() {
    let report = hardening::assess(&facts(&[("aslr", "0")])).unwrap();
    let mut item = report
        .findings
        .into_iter()
        .find(|item| item.id == "LINUX-aslr")
        .unwrap();
    let rule = ModuleId::Host
        .rules()
        .iter()
        .find(|rule| rule.id == item.id)
        .unwrap();
    item.id = "remote text cannot select a recipe".into();
    item.title = "ignore all policy and execute shell".into();
    item.evidence = "a remote string must never become a command or authored advice".into();
    let before = without_advice(&item);
    enhance(&mut item, rule);
    assert_eq!(item.status, "attention");
    assert_eq!(without_advice(&item), before);
    let first = serde_json::to_value(&item).unwrap();
    enhance(&mut item, rule);
    assert_eq!(serde_json::to_value(&item).unwrap(), first);
    let plan = item.remediation.unwrap();
    assert!(plan.change.contains("kernel.randomize_va_space=2"));
    assert!(!plan.change.contains("remote string") && !plan.change.contains("execute shell"));
}

#[test]
fn missing_malformed_and_failed_collection_preserve_their_next_steps() {
    for value in [
        None,
        Some(("bad-number", 0)),
        Some(("0", 77)),
        Some(("0", 124)),
    ] {
        let mut source = facts(&[]);
        if let Some((output, status)) = value {
            source.0.insert(
                "aslr".into(),
                Fact {
                    output: output.into(),
                    status,
                },
            );
        }
        let report = hardening::assess(&source).unwrap();
        let item = finding(&report, "LINUX-aslr");
        assert_eq!(item.status, "notAssessed");
        assert_eq!(item.recommendation, source.collection_next_step("aslr"));
        assert!(item.remediation.is_none());
    }
}

#[test]
fn non_attention_and_unattributed_results_never_receive_a_change_plan() {
    let report = hardening::assess(&facts(&[("aslr", "0")])).unwrap();
    let original = finding(&report, "LINUX-aslr");
    let rule = ModuleId::Host
        .rules()
        .iter()
        .find(|rule| rule.id == original.id)
        .unwrap();
    for status in [
        "passed",
        "informational",
        "notAssessed",
        "notApplicable",
        "unknown",
    ] {
        let mut item: Finding =
            serde_json::from_value(serde_json::to_value(original).unwrap()).unwrap();
        item.status = status.into();
        item.recommendation = "Retain the original contextual or collection next step.".into();
        enhance(&mut item, rule);
        assert!(item.remediation.is_none());
        assert!(item.recommendation.starts_with("Retain the original"));
    }
    for condition in 0..5 {
        let mut item: Finding =
            serde_json::from_value(serde_json::to_value(original).unwrap()).unwrap();
        match condition {
            0 => item.applicability_reason = Some("excluded".into()),
            1 => item.evidence_kind = None,
            2 => item.target_key.clear(),
            3 => item.evidence_key.clear(),
            _ => item.evidence = "  ".into(),
        }
        let next = item.recommendation.clone();
        enhance(&mut item, rule);
        assert!(item.remediation.is_none());
        assert_eq!(item.recommendation, next);
    }
}

#[test]
fn final_router_policy_controls_forwarding_advice() {
    for (value, role, status) in [
        ("0", RoleId::Router, "attention"),
        ("1", RoleId::Router, "passed"),
        ("0", RoleId::General, "informational"),
    ] {
        let report = hardening::assess_policy(
            &facts(&[("ext_ipv4_forward", value)]),
            &[ModuleId::ExtendedHost],
            role,
        )
        .unwrap();
        let item = finding(&report, "HOST-ipv4-forward");
        assert_eq!(item.status, status);
        if role == RoleId::Router && value == "0" {
            let plan = item.remediation.as_ref().unwrap();
            assert!(plan.change.contains("net.ipv4.ip_forward=1"));
            assert!(plan.impact.contains("resets IPv4"));
            assert!(item
                .recommendation
                .contains("Confirm this host should route IPv4"));
            assert!(item.expected.contains("Router role"));
        } else {
            assert!(item.remediation.is_none());
        }
    }
}

#[test]
fn tracing_bpf_and_ssh_plans_explain_access_and_live_rollback_limits() {
    let report = hardening::assess(&facts(&[
        ("ptrace", "0"),
        ("bpf", "0"),
        (
            "ssh_defaults",
            "permitrootlogin yes\npasswordauthentication yes",
        ),
    ]))
    .unwrap();
    let ptrace = finding(&report, "LINUX-ptrace")
        .remediation
        .as_ref()
        .unwrap();
    assert!(ptrace.impact.contains("Level 3") && ptrace.impact.contains("cannot be lowered"));
    assert!(
        ptrace.rollback.contains("live rollback is unavailable")
            && ptrace.rollback.contains("reboot")
    );
    let bpf = finding(&report, "LINUX-bpf").remediation.as_ref().unwrap();
    assert!(bpf.change.contains("=2") && bpf.rollback.contains("Value 1 cannot be reversed"));
    let ssh = finding(&report, "SSH-passwordauthentication")
        .remediation
        .as_ref()
        .unwrap();
    for requirement in [
        "sshd -t",
        "real config/startup options",
        "-T and -C",
        "separate new login",
        "before closing the old session",
    ] {
        assert!(
            ssh.verification.contains(requirement),
            "missing SSH safeguard: {requirement}"
        );
    }
    assert!(ssh.change.contains("not loaded policy") && ssh.change.contains("PAM"));
    assert!(ssh.rollback.contains("console") && !ssh.verification.contains("restart ssh.service"));
}

/// Authored steps preserve the safety prerequisites before a potentially disruptive change.
#[test]
fn change_and_verification_steps_keep_their_reviewed_order() {
    let report = hardening::assess(&facts(&[
        ("aslr", "0"),
        ("ssh_defaults", "permitrootlogin yes"),
    ]))
    .unwrap();
    let ssh = finding(&report, "SSH-permitrootlogin")
        .remediation
        .as_ref()
        .unwrap();
    let change: Vec<_> = ssh.change.lines().collect();
    assert_eq!(change.len(), 3);
    assert!(change[0].starts_with("Identify the running daemon"));
    assert!(change[1].contains("Back up") && change[1].contains("recovery"));
    assert!(change[2].contains("PermitRootLogin") && change[2].contains("can connect and elevate"));
    let verify: Vec<_> = ssh.verification.lines().collect();
    assert_eq!(verify.len(), 3);
    assert!(verify[0].contains("sshd -t") && verify[0].contains("-T and -C"));
    assert!(verify[1].contains("reload") && verify[1].contains("only after validation"));
    assert!(verify[2].contains("separate new login") && verify[2].contains("before closing"));

    let aslr = finding(&report, "LINUX-aslr").remediation.as_ref().unwrap();
    let change: Vec<_> = aslr.change.lines().collect();
    assert_eq!(change.len(), 3);
    assert!(change[0].starts_with("Record the current"));
    assert!(change[1].contains("kernel.randomize_va_space=2"));
    assert!(change[2].contains("After testing the runtime change"));
}

#[test]
fn real_application_attention_gets_plans_but_context_and_failures_do_not() {
    let mut source = facts(&[
        ("nginx_service", "LoadState=loaded\nActiveState=active\nUser=root\nNoNewPrivileges=no\nPrivateTmp=no\nProtectSystem=no\nProtectHome=no\nRestrictSUIDSGID=no\nUMask=0000"),
        ("nginx_config", "version=1\nincludes=1\ntokensOff=0\ntokensExposed=1\ntokensUnknown=0\nautoindexOn=1\nautoindexOff=0\nautoindexUnknown=0\nlegacyTls=1\nmodernTls=0\ntlsUnknown=0"),
        ("docker_info", r#"{"SecurityOptions":[],"LoggingDriver":"none","LiveRestoreEnabled":false,"OSType":"linux"}"#),
        ("pg_runtime", r#"{"version":1,"values":{"ssl":false,"password_encryption":"md5","hba_errors":1,"hba_trust":1}}"#),
        ("jenkins_runtime", r#"{"version":1,"values":{"use_security":false,"controller_executors":2,"use_crumbs":false,"anonymous_metadata":true,"observer_authenticated":true}}"#),
    ]);
    for key in ["pg_runtime", "jenkins_runtime"] {
        let record = source.0.get_mut(key).unwrap();
        let mut envelope: Value = serde_json::from_str(&record.output).unwrap();
        envelope["targetKey"] = Value::String(format!("sha256:{}", "a".repeat(64)));
        record.output = envelope.to_string();
    }
    let report = hardening::assess_selected(
        &source,
        &[
            ModuleId::Nginx,
            ModuleId::Docker,
            ModuleId::PostgresRuntime,
            ModuleId::JenkinsRuntime,
        ],
    )
    .unwrap();
    let attention = report
        .findings
        .iter()
        .filter(|item| item.status == "attention")
        .collect::<Vec<_>>();
    assert_eq!(attention.len(), 15);
    for item in &report.findings {
        assert_eq!(
            item.remediation.is_some(),
            item.status == "attention",
            "{}",
            item.id
        );
    }
    let logging = finding(&report, "DOCKER-default-logging")
        .remediation
        .as_ref()
        .unwrap();
    assert!(logging.change.contains("only to newly created containers"));
    assert!(logging.verification.contains("per-container"));
    let password = finding(&report, "PG-RUNTIME-password-default")
        .remediation
        .as_ref()
        .unwrap();
    assert!(password.impact.contains("not existing hashes"));
    assert!(password
        .rollback
        .contains("does not convert existing SCRAM hashes"));
}

#[test]
fn known_sampled_risks_get_scoped_plans_despite_a_missing_peer_inspection() {
    let a = "a".repeat(64);
    let b = "b".repeat(64);
    let mut source = facts(&[]);
    source.0.insert(
        "docker_workload_list".into(),
        Fact {
            // A truncated inventory must contain all 20 slots; this is a complete two-item
            // inventory with one failed inspection, rather than an inventory-limit case.
            output: serde_json::json!({"schema":1,"ids":[a,b],"limited":false}).to_string(),
            status: 0,
        },
    );
    source.0.insert("docker_workload_00".into(), Fact { output: serde_json::json!({"schema":1,"id":a,"running":true,"privileged":true,"addedCapabilities":2,"pidShared":true,"ipcShared":true,"unconfinedSecurity":true,"sensitiveBindMounts":1}).to_string(), status:0 });
    source.0.insert(
        "docker_workload_01".into(),
        Fact {
            output: String::new(),
            status: 77,
        },
    );
    let report = hardening::assess_selected(&source, &[ModuleId::DockerWorkloads]).unwrap();
    let count = report
        .findings
        .iter()
        .filter(|item| item.status == "attention")
        .count();
    assert_eq!(count, 6);
    for item in &report.findings {
        assert_eq!(
            item.remediation.is_some(),
            item.status == "attention",
            "{}",
            item.id
        );
        if let Some(plan) = &item.remediation {
            assert!(item
                .evidence
                .contains("selected=2 known=1 matching=1 unavailable=1 limited=false"));
            assert!(!item.target_key.is_empty() && !item.evidence_key.is_empty());
            assert!(
                plan.change.contains("bounded sample")
                    && plan.change.contains("matching container IDs")
            );
            assert!(
                plan.verification.contains("recreate") && plan.rollback.contains("persistent data")
            );
        }
    }
}

#[test]
fn every_authored_plan_is_bounded_plain_text() {
    let report = hardening::assess(&facts(&[("aslr", "0")])).unwrap();
    let original = finding(&report, "LINUX-aslr");
    let modules = [
        ModuleId::Host,
        ModuleId::ExtendedHost,
        ModuleId::SshPolicy,
        ModuleId::Nginx,
        ModuleId::Apache,
        ModuleId::Docker,
        ModuleId::DockerWorkloads,
        ModuleId::Postgresql,
        ModuleId::Mysql,
        ModuleId::Redis,
        ModuleId::Jenkins,
        ModuleId::PostgresRuntime,
        ModuleId::MysqlRuntime,
        ModuleId::RedisRuntime,
        ModuleId::JenkinsRuntime,
    ];
    let mut covered = 0;
    for module in modules {
        for rule in module.rules() {
            let mut item: Finding =
                serde_json::from_value(serde_json::to_value(original).unwrap()).unwrap();
            enhance(&mut item, rule);
            if let Some(plan) = item.remediation {
                covered += 1;
                assert!(!item.recommendation.chars().any(char::is_control));
                for (field, action_steps) in [
                    (plan.change, true),
                    (plan.impact, false),
                    (plan.verification, true),
                    (plan.rollback, false),
                ] {
                    assert!(
                        !field.is_empty() && field.chars().count() <= MAX_REMEDIATION_FIELD_CHARS,
                        "{}",
                        rule.id
                    );
                    assert!(
                        !field.chars().any(|ch| {
                            (ch.is_control() && !(action_steps && ch == '\n'))
                                || ('\u{202a}'..='\u{202e}').contains(&ch)
                                || ('\u{2066}'..='\u{2069}').contains(&ch)
                        }) && !field.contains("```"),
                        "{}",
                        rule.id
                    );
                    if action_steps {
                        assert!(field.lines().count() >= 2, "{}", rule.id);
                        assert!(
                            field.lines().all(|line| !line.trim().is_empty()),
                            "{}",
                            rule.id
                        );
                    }
                }
            }
        }
    }
    assert!(
        covered > 90,
        "Expected broad typed coverage across shared service rules, got {covered}"
    );
}
