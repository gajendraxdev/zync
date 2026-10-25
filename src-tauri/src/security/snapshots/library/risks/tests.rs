//! Isolated database tests cover migration, explicit revocation and atomic report/risk deletion.
use super::*;
use serde_json::{json, Value};

/// Build a validated exact-match acceptance without observing this machine or any user data.
fn payload() -> Value {
    let mut value = super::super::tests::payload();
    let now = snapshots::current_time().unwrap();
    let finding = &value["report"]["findings"][0];
    value["annotations"] = json!([{"id":uuid::Uuid::new_v4().to_string(),"host":"fixture.invalid","username":"fixture","port":22,
        "transportFingerprint":value["report"]["transportFingerprint"],"policyId":"general","policyRevision":"zync-role-1","moduleId":"host",
        "targetKey":finding["targetKey"],"ruleId":"LINUX-aslr","ruleVersion":"1","evidenceKey":finding["evidenceKey"],"reason":"Temporary exception","createdAt":now,"expiresAt":now+86400000}]);
    value
}

/// Removing a report keeps independent acceptance, including legacy embedded notes, across restarts.
#[test]
fn legacy_notes_survive_report_deletion_and_revocation_does_not_resurrect_them() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("risk.redb");
    let value = payload();
    let scope = super::super::tests::subject(&value);
    {
        let store = ReportLibrary::new(path.clone());
        let first = store.save(&value.to_string(), "First", None).unwrap();
        store.save(&value.to_string(), "Second", None).unwrap();
        store
            .delete(
                Revision {
                    id: first.id,
                    revision: 1,
                },
                &scope,
            )
            .unwrap();
        assert_eq!(store.list_risks(&scope).unwrap().len(), 1);
    }
    let store = ReportLibrary::new(path.clone());
    let risk = store.list_risks(&scope).unwrap().remove(0);
    store
        .remove_risk(
            Revision {
                id: risk.id,
                revision: risk.revision,
            },
            &scope,
        )
        .unwrap();
    assert_eq!(store.list(&scope).unwrap().len(), 1);
    drop(store);
    let reopened = ReportLibrary::new(path);
    assert!(reopened.list_risks(&scope).unwrap().is_empty());
    let saved = reopened.list(&scope).unwrap().remove(0);
    assert_eq!(
        reopened
            .load(&saved.id, &scope)
            .unwrap()
            .package
            .annotations
            .len(),
        1,
        "Historical notes remain recorded without reactivating acceptance"
    );
    reopened
        .save(&value.to_string(), "Another historical copy", None)
        .unwrap();
    assert!(
        reopened.list_risks(&scope).unwrap().is_empty(),
        "Saving an old snapshot never reactivates revoked acceptance"
    );
}

/// A renewal cannot be removed by a stale pane; atomic report deletion rolls back on any changed risk.
#[test]
fn renewals_are_revision_checked_and_deleting_both_is_atomic() {
    let dir = tempfile::tempdir().unwrap();
    let store = ReportLibrary::new(dir.path().join("risk.redb"));
    let mut value = payload();
    let scope = super::super::tests::subject(&value);
    let saved = store.save(&value.to_string(), "Original", None).unwrap();
    let old = store.list_risks(&scope).unwrap().remove(0);
    value["annotations"][0]["reason"] = "Updated reason".into();
    assert!(store.save_risks(&value.to_string(), Vec::new()).is_err());
    let renewed = store
        .save_risks(
            &value.to_string(),
            vec![Revision {
                id: old.id.clone(),
                revision: old.revision,
            }],
        )
        .unwrap()
        .remove(0);
    assert_eq!(renewed.revision, 2);
    let mut older = value.clone();
    older["annotations"][0]["createdAt"] = (renewed.annotation.created_at - 1).into();
    assert!(
        store
            .save_risks(
                &older.to_string(),
                vec![Revision {
                    id: renewed.id.clone(),
                    revision: 2
                }]
            )
            .is_err(),
        "An older imported note cannot overwrite a newer acceptance even with the current revision"
    );
    assert!(store
        .delete_with_risks(
            Revision {
                id: saved.id.clone(),
                revision: 1
            },
            &scope,
            vec![Revision {
                id: old.id.clone(),
                revision: 1
            }]
        )
        .is_err());
    assert_eq!(store.list(&scope).unwrap().len(), 1);
    assert!(
        store
            .delete_with_risks(
                Revision {
                    id: saved.id.clone(),
                    revision: 1
                },
                &scope,
                vec![Revision {
                    id: renewed.id.clone(),
                    revision: 2
                }]
            )
            .is_err(),
        "A renewed acceptance is no longer the exact note recorded by the old report"
    );
    let updated = store
        .save(
            &value.to_string(),
            "Updated",
            Some(Revision {
                id: saved.id.clone(),
                revision: 1,
            }),
        )
        .unwrap();
    store
        .delete_with_risks(
            Revision {
                id: saved.id,
                revision: updated.revision,
            },
            &scope,
            vec![Revision {
                id: renewed.id,
                revision: 2,
            }],
        )
        .unwrap();
    assert!(store.list(&scope).unwrap().is_empty());
    assert!(store.list_risks(&scope).unwrap().is_empty());
}

/// A deleted binding never reuses its old revision, even when the exact same note is imported again.
#[test]
fn delete_and_reaccept_rejects_stale_removal_and_replacement_across_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("risk.redb");
    let value = payload();
    let scope = super::super::tests::subject(&value);
    let old = {
        let store = ReportLibrary::new(path.clone());
        let old = store
            .save_risks(&value.to_string(), Vec::new())
            .unwrap()
            .remove(0);
        store
            .remove_risk(
                Revision {
                    id: old.id.clone(),
                    revision: old.revision,
                },
                &scope,
            )
            .unwrap();
        assert!(store.list_risks(&scope).unwrap().is_empty());
        old
    };
    let store = ReportLibrary::new(path);
    let reaccepted = store
        .save_risks(&value.to_string(), Vec::new())
        .unwrap()
        .remove(0);
    assert_eq!(reaccepted.id, old.id);
    assert!(reaccepted.annotation == old.annotation);
    assert!(reaccepted.revision > old.revision);
    assert!(store
        .remove_risk(
            Revision {
                id: old.id.clone(),
                revision: old.revision
            },
            &scope
        )
        .is_err());
    assert!(store
        .save_risks(
            &value.to_string(),
            vec![Revision {
                id: old.id,
                revision: old.revision
            }]
        )
        .is_err());
    let kept = store.list_risks(&scope).unwrap().remove(0);
    assert_eq!(kept.revision, reaccepted.revision);
    assert!(kept.annotation == reaccepted.annotation);
}

/// Upgrading an already-migrated database seeds generations from existing rows without reimporting history.
#[test]
fn legacy_revision_upgrade_preserves_generation_after_atomic_report_removal() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("risk.redb");
    let store = ReportLibrary::new(path.clone());
    let value = payload();
    let scope = super::super::tests::subject(&value);
    let saved = store
        .save(&value.to_string(), "Recorded note", None)
        .unwrap();
    let mut risk = store.list_risks(&scope).unwrap().remove(0);
    // Reproduce the pre-generation schema after its embedded-note migration completed.
    let database = store.database().unwrap();
    let tx = database.begin_write().unwrap();
    risk.revision = 37;
    tx.open_table(RISKS)
        .unwrap()
        .insert(risk.id.as_str(), encode(&risk).unwrap().as_slice())
        .unwrap();
    tx.open_table(META).unwrap().remove(GENERATION).unwrap();
    tx.commit().unwrap();
    store
        .delete_with_risks(
            Revision {
                id: saved.id,
                revision: saved.revision,
            },
            &scope,
            vec![Revision {
                id: risk.id.clone(),
                revision: risk.revision,
            }],
        )
        .unwrap();
    assert!(store.list_risks(&scope).unwrap().is_empty());
    drop(database);
    drop(store);
    let reopened = ReportLibrary::new(path);
    let reaccepted = reopened
        .save_risks(&value.to_string(), Vec::new())
        .unwrap()
        .remove(0);
    assert!(reaccepted.revision > risk.revision);
    assert!(reopened
        .remove_risk(
            Revision {
                id: risk.id,
                revision: risk.revision
            },
            &scope
        )
        .is_err());
}

/// Another account/host cannot revoke an acceptance, and unmatched imported notes are never saved.
#[test]
fn risk_mutations_are_scoped_and_keep_only_matching_validated_data() {
    let dir = tempfile::tempdir().unwrap();
    let store = ReportLibrary::new(dir.path().join("risk.redb"));
    let mut value = payload();
    let scope = super::super::tests::subject(&value);
    value["credentials"] = json!({"secret":"never-store-this"});
    let risk = store
        .save_risks(&value.to_string(), Vec::new())
        .unwrap()
        .remove(0);
    let mut foreign = super::super::tests::subject(&value);
    foreign.username = "other".into();
    assert!(store
        .remove_risk(
            Revision {
                id: risk.id.clone(),
                revision: risk.revision
            },
            &foreign
        )
        .is_err());
    assert!(store.list_risks(&foreign).unwrap().is_empty());
    assert!(!serde_json::to_string(&risk)
        .unwrap()
        .contains("never-store-this"));
    value["annotations"][0]["evidenceKey"] = format!("sha256:{}", "b".repeat(64)).into();
    assert!(store.save_risks(&value.to_string(), Vec::new()).is_err());
    assert_eq!(store.list_risks(&scope).unwrap().len(), 1);
}

/// A failed legacy migration rolls back both its rows and marker, retaining every original report.
#[test]
fn incomplete_migration_is_atomic_and_retryable() {
    let dir = tempfile::tempdir().unwrap();
    let store = ReportLibrary::new(dir.path().join("risk.redb"));
    let value = payload();
    let scope = super::super::tests::subject(&value);
    store.save(&value.to_string(), "Valid", None).unwrap();
    let broken = store
        .save(&value.to_string(), "Temporarily unreadable", None)
        .unwrap();
    let database = store.database().unwrap();
    let tx = database.begin_write().unwrap();
    tx.open_table(REPORTS)
        .unwrap()
        .insert(broken.id.as_str(), b"invalid JSON".as_slice())
        .unwrap();
    tx.commit().unwrap();
    assert!(store.list_risks(&scope).is_err());
    {
        let read = database.begin_read().unwrap();
        assert_eq!(read.open_table(RISKS).unwrap().len().unwrap(), 0);
        assert!(read
            .open_table(META)
            .unwrap()
            .get("embedded-notes-migrated")
            .unwrap()
            .is_none());
    }
    let package = snapshots::decode_package(
        &serde_json::to_vec(&value).unwrap(),
        snapshots::current_time().unwrap(),
    )
    .unwrap();
    let encoded = snapshots::encode_package(&package).unwrap();
    let tx = database.begin_write().unwrap();
    tx.open_table(REPORTS)
        .unwrap()
        .insert(broken.id.as_str(), encoded.as_slice())
        .unwrap();
    tx.commit().unwrap();
    assert_eq!(store.list_risks(&scope).unwrap().len(), 1);
    assert_eq!(store.list(&scope).unwrap().len(), 2);
}

/// A full 183-check report can retain all its acceptances; the old 100-note cap would make it unsavable.
#[test]
fn full_report_acceptances_roundtrip_and_expired_entries_remain_removable() {
    let dir = tempfile::tempdir().unwrap();
    let store = ReportLibrary::new(dir.path().join("risk.redb"));
    let mut value = payload();
    let scope = super::super::tests::subject(&value);
    let mut findings = Vec::new();
    let mut annotations = Vec::new();
    for index in 0..183 {
        let mut finding = value["report"]["findings"][0].clone();
        finding["id"] = format!("RULE-{index}").into();
        finding["targetKey"] = format!("sha256:{index:064x}").into();
        finding["evidenceKey"] = format!("sha256:{:064x}", index + 1).into();
        let mut annotation = value["annotations"][0].clone();
        annotation["id"] = uuid::Uuid::new_v4().to_string().into();
        annotation["ruleId"] = finding["id"].clone();
        annotation["targetKey"] = finding["targetKey"].clone();
        annotation["evidenceKey"] = finding["evidenceKey"].clone();
        if index == 0 {
            annotation["createdAt"] = 1000.into();
            annotation["expiresAt"] = 5000.into();
        }
        findings.push(finding);
        annotations.push(annotation);
    }
    value["report"]["findings"] = json!(findings);
    value["report"]["totalFindings"] = 183.into();
    value["annotations"] = json!(annotations);
    let risks = store.save_risks(&value.to_string(), Vec::new()).unwrap();
    assert_eq!(risks.len(), 183);
    let report = store.save(&value.to_string(), "Complete", None).unwrap();
    assert_eq!(
        store
            .load(&report.id, &scope)
            .unwrap()
            .package
            .annotations
            .len(),
        183
    );
    let expired = risks
        .iter()
        .find(|item| item.annotation.expires_at == 5000)
        .unwrap();
    store
        .remove_risk(
            Revision {
                id: expired.id.clone(),
                revision: expired.revision,
            },
            &scope,
        )
        .unwrap();
    assert_eq!(store.list_risks(&scope).unwrap().len(), 182);
    assert_eq!(
        store
            .load(&report.id, &scope)
            .unwrap()
            .package
            .annotations
            .len(),
        183
    );
}
