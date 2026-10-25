//! Role context and evidence identity must not turn missing data into a security decision.
use super::*;
use crate::security::{facts::Fact, hardening};
use std::collections::{BTreeMap, BTreeSet};

/// Construct inert host facts without running a collector or requesting privileged access.
fn facts(os: &str, forwarding: Option<(&str, u32)>) -> Facts {
    let mut values = BTreeMap::from([(
        "os".into(),
        Fact {
            output: os.into(),
            status: 0,
        },
    )]);
    if let Some((output, status)) = forwarding {
        values.insert(
            "ext_ipv4_forward".into(),
            Fact {
                output: output.into(),
                status,
            },
        );
    }
    Facts(values)
}

/// Presets are native scope shortcuts; authenticated observers always require an explicit choice.
#[test]
fn catalog_presets_are_closed_and_do_not_request_application_credentials() {
    let catalog = catalog();
    assert_eq!(catalog.default_preset_id, RoleId::General);
    assert_eq!(catalog.modules.len(), 15);
    assert_eq!(
        catalog
            .modules
            .iter()
            .map(|module| module.check_count)
            .sum::<usize>(),
        183
    );
    assert_eq!(catalog.presets.len(), 5);
    let mut ids = BTreeSet::new();
    for preset in catalog.presets {
        assert!(ids.insert(serde_json::to_string(&preset.id).unwrap()));
        assert_eq!(preset.revision, preset.id.metadata().revision);
        assert!(!preset.module_ids.is_empty());
        assert_eq!(
            modules::selection(Some(&preset.module_ids)).unwrap(),
            preset.module_ids
        );
        assert!(preset.module_ids.iter().all(|module| !module.is_runtime()));
    }
}

/// Only an explicit Router role supplies a forwarding expectation, and never for unavailable evidence.
#[test]
fn router_expectation_requires_a_valid_observation() {
    for (value, router_status) in [("0", "attention"), ("1", "passed")] {
        let source = facts("ID=ubuntu\nVERSION_ID=24.04", Some((value, 0)));
        for (role, expected) in [
            (RoleId::General, "informational"),
            (RoleId::Router, router_status),
        ] {
            let report =
                hardening::assess_policy(&source, &[ModuleId::ExtendedHost], role).unwrap();
            let finding = report
                .findings
                .iter()
                .find(|finding| finding.id == "HOST-ipv4-forward")
                .unwrap();
            assert_eq!(finding.status, expected);
            assert_eq!(finding.priority.is_some(), expected == "attention");
        }
    }
    for value in [None, Some(("0", 77)), Some(("unknown", 0)), Some(("2", 0))] {
        let source = facts("ID=ubuntu\nVERSION_ID=24.04", value);
        let report =
            hardening::assess_policy(&source, &[ModuleId::ExtendedHost], RoleId::Router).unwrap();
        let finding = report
            .findings
            .iter()
            .find(|finding| finding.id == "HOST-ipv4-forward")
            .unwrap();
        assert_eq!(finding.status, "notAssessed");
        assert!(finding.priority.is_none());
    }
}

/// Comparisons bind targets to platform scope, while changing evidence invalidates accepted-risk notes.
#[test]
fn target_and_evidence_keys_change_only_with_their_bound_inputs() {
    let finding = |os, value| {
        hardening::assess_policy(
            &facts(os, Some((value, 0))),
            &[ModuleId::ExtendedHost],
            RoleId::General,
        )
        .unwrap()
        .findings
        .into_iter()
        .find(|finding| finding.id == "HOST-ipv4-forward")
        .unwrap()
    };
    let first = finding("ID=ubuntu\nVERSION_ID=24.04", "0");
    let same = finding("ID=ubuntu\nVERSION_ID=24.04", "0");
    let changed = finding("ID=ubuntu\nVERSION_ID=24.04", "1");
    let platform = finding("ID=debian\nVERSION_ID=12", "0");
    assert_eq!(first.target_key, same.target_key);
    assert_eq!(first.evidence_key, same.evidence_key);
    assert_eq!(first.target_key, changed.target_key);
    assert_ne!(first.evidence_key, changed.evidence_key);
    assert_ne!(first.target_key, platform.target_key);
    assert_eq!(first.target_key.len(), 71);
}

/// PostgreSQL's HBA views parse current files; they cannot establish the policy last loaded by the server.
#[test]
fn hba_and_ssh_previews_keep_configuration_provenance() {
    assert_eq!(
        evidence_kind(Evaluation::Runtime(
            super::super::runtime::Check::PgHbaErrors
        )),
        EvidenceKind::NamedConfiguration
    );
    assert_eq!(
        evidence_kind(Evaluation::Runtime(
            super::super::runtime::Check::PgHbaTrust
        )),
        EvidenceKind::NamedConfiguration
    );
    for rule in ModuleId::SshPolicy.rules() {
        assert_eq!(
            evidence_kind(rule.evaluation),
            EvidenceKind::EffectiveConfiguration
        );
    }
}
