use super::*;
use crate::security::{
    facts::{Fact, Facts},
    hardening,
    modules::ModuleId,
    report::MAX_SCOPE_SUMMARY_CHARS,
};
use std::collections::BTreeMap;

/// Exercise actual report construction without contacting a host or reading local configuration.
fn sample() -> Facts {
    Facts(BTreeMap::from([
        (
            "os".into(),
            Fact {
                output: "ID=ubuntu\nVERSION_ID=24.04".into(),
                status: 0,
            },
        ),
        (
            "aslr".into(),
            Fact {
                output: "0".into(),
                status: 0,
            },
        ),
        (
            "ssh_defaults".into(),
            Fact {
                output: "permitrootlogin yes".into(),
                status: 0,
            },
        ),
    ]))
}

/// Presentation summaries preserve complete catalog context and the original evidence bindings.
#[test]
fn concise_scope_preserves_full_context_and_comparison_identity() {
    let modules = [ModuleId::Host, ModuleId::Nginx, ModuleId::DockerWorkloads];
    let report = hardening::assess_selected(&sample(), &modules).unwrap();
    for finding in &report.findings {
        let rule = modules
            .iter()
            .flat_map(|module| module.rules())
            .find(|rule| rule.id == finding.id)
            .unwrap();
        assert_eq!(finding.scope, rule.scope);
        assert_eq!(finding.rationale, rule.rationale);
        assert_eq!(finding.rule_version, rule.rule_version);
        let summary = finding.scope_summary.as_ref().unwrap();
        assert!(!summary.trim().is_empty() && summary.chars().count() <= MAX_SCOPE_SUMMARY_CHARS);
        if !finding.target_key.is_empty() {
            assert_eq!(
                finding.evidence_key,
                crate::security::policy::digest(&format!(
                    "{}\0{}\0{}\0{}\0{}",
                    finding.target_key,
                    rule.id,
                    rule.rule_version,
                    finding.status,
                    finding.evidence
                ))
            );
        }
    }
    assert!(report
        .findings
        .iter()
        .any(|finding| finding.status == "attention"));
    assert!(report
        .findings
        .iter()
        .any(|finding| finding.status == "notAssessed"));
}

/// Key source limitations remain visible even when the full technical explanation is collapsed.
#[test]
fn summaries_keep_loaded_policy_sample_and_runtime_boundaries() {
    use crate::security::{
        modules::{ssh_policy, workloads},
        runtime::Check,
    };
    for (evaluation, required) in [
        (
            Evaluation::SshPolicy(ssh_policy::Check::RootLogin),
            vec!["captured numeric", "UseDNS=no", "loaded server policy"],
        ),
        (
            Evaluation::DockerWorkload(workloads::Check::Privileged),
            vec!["up to 20", "incomplete reads", "images", "running-process"],
        ),
        (
            Evaluation::Application(applications::Check::Service {
                key: "fixture",
                property: applications::ServiceProperty::ProtectHome,
            }),
            vec![
                "Named service-unit",
                "running-process",
                "application security",
            ],
        ),
        (
            Evaluation::Runtime(Check::PgHbaTrust),
            vec!["Current authentication-file", "ordering", "loaded policy"],
        ),
        (
            Evaluation::Runtime(Check::PgPassword),
            vec!["default only", "existing password hashes"],
        ),
        (
            Evaluation::Runtime(Check::RedisDefaultAdmin),
            vec!["simulations only", "not executed", "authorization"],
        ),
    ] {
        let summary = scope_summary(evaluation);
        for phrase in required {
            assert!(
                summary.contains(phrase),
                "Missing scope limit {phrase}: {summary}"
            );
        }
    }
}

/// Every compiled rule has bounded, inert context; new evaluation variants need an explicit authored choice.
#[test]
fn all_compiled_scope_summaries_are_bounded_plain_text() {
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
    for rule in modules.iter().flat_map(|module| module.rules()) {
        let summary = scope_summary(rule.evaluation);
        assert!(
            !summary.is_empty() && summary.chars().count() <= MAX_SCOPE_SUMMARY_CHARS,
            "{}",
            rule.id
        );
        assert!(!summary.chars().any(char::is_control), "{}", rule.id);
    }
}
