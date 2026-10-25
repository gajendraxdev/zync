//! Runtime observers preserve credential privacy, narrow policy semantics and owned I/O lifetimes.
use super::*;
use crate::security::{facts::Facts, hardening::Outcome, modules::ExtraResult};
use std::collections::BTreeMap;

/// Build synthetic credentials only; the test suite never reads user passwords or opens app endpoints.
fn credential(kind: RuntimeKind) -> RuntimeCredential {
    RuntimeCredential {
        kind,
        port: 5432,
        username: "observer".into(),
        database: if kind == RuntimeKind::Postgresql {
            "postgres".into()
        } else {
            String::new()
        },
        secret: "fixture-private-credential".into(),
    }
}
/// Exercise the public closed module ID contract without reproducing enum spelling in the test.
fn selected(id: &str) -> Vec<ModuleId> {
    vec![serde_json::from_value(Value::String(id.into())).unwrap()]
}

/// A credential is accepted only for its explicitly selected observer, never an unrelated module.
#[test]
fn runtime_credentials_are_exact_and_bound_to_selected_scope() {
    let value = credential(RuntimeKind::Postgresql);
    assert!(validate_credentials(&[value], &selected("postgres-runtime")).is_ok());
    assert!(validate_credentials(&[], &selected("postgres-runtime")).is_err());
    assert!(validate_credentials(
        &[credential(RuntimeKind::Postgresql)],
        &selected("redis-runtime")
    )
    .is_err());
    assert!(validate_credentials(
        &[
            credential(RuntimeKind::Postgresql),
            credential(RuntimeKind::Postgresql)
        ],
        &selected("postgres-runtime")
    )
    .is_err());
    let mut value = credential(RuntimeKind::Mysql);
    value.secret = "x".repeat(80);
    let message = validate_credentials(&[value], &selected("mysql-runtime")).unwrap_err();
    assert!(message.contains("Keep your password unchanged"));
    let mut value = credential(RuntimeKind::Jenkins);
    value.username = "observer:other".into();
    assert!(validate_credentials(&[value], &selected("jenkins-runtime")).is_err());
    let mut value = credential(RuntimeKind::Postgresql);
    value.secret.clear();
    assert!(validate_credentials(&[value], &selected("postgres-runtime")).is_ok());
    let mut value = credential(RuntimeKind::Redis);
    value.username.clear();
    value.secret.clear();
    assert!(validate_credentials(&[value], &selected("redis-runtime")).is_ok());
}

/// Password rotation cannot relabel a target, while endpoint/account/database changes cannot be compared as one.
#[test]
fn runtime_target_identity_never_contains_or_depends_on_secret() {
    let mut value = credential(RuntimeKind::Postgresql);
    let first = context_key(&value);
    value.secret = "different-fixture-secret".into();
    assert_eq!(context_key(&value), first);
    value.port += 1;
    assert_ne!(context_key(&value), first);
    value.port -= 1;
    value.username.push('2');
    assert_ne!(context_key(&value), first);
    value.username.pop();
    value.database.push('2');
    assert_ne!(context_key(&value), first);
    let output = envelope(&value, Err("authentication_failed"));
    for private in [&value.secret, &value.username, &value.database] {
        assert!(!output.contains(private));
    }
    let facts = Facts(BTreeMap::from([(
        "pg_runtime".into(),
        Fact { output, status: 0 },
    )]));
    assert!(target_key(&facts, "postgres-runtime")
        .unwrap()
        .starts_with("sha256:"));
    assert!(target_key(&facts, "redis-runtime").is_none());
}

/// Failed credentials and malformed fields use collection guidance and never request host sudo.
#[test]
fn runtime_failures_and_types_never_become_security_passes() {
    let value = credential(RuntimeKind::Jenkins);
    let facts = Facts(BTreeMap::from([(
        "jenkins_runtime".into(),
        Fact {
            output: envelope(&value, Err("authentication_failed")),
            status: 0,
        },
    )]));
    assert!(matches!(
        evaluate(&facts, Check::JenkinsSecurity),
        ExtraResult::UnavailableWith { .. }
    ));
    let output = envelope(
        &value,
        Ok(Map::from_iter([("use_security".into(), "true".into())])),
    );
    let facts = Facts(BTreeMap::from([(
        "jenkins_runtime".into(),
        Fact { output, status: 0 },
    )]));
    assert!(matches!(
        evaluate(&facts, Check::JenkinsSecurity),
        ExtraResult::UnavailableWith { .. }
    ));
}

/// Scope-limited runtime signals cannot be upgraded into universal authentication or exposure claims.
#[test]
fn runtime_interpretation_retains_context_and_narrow_conditions() {
    let result = |kind, key: &str, value: Value, check| {
        let credential = credential(kind);
        let mut values = Map::from_iter([(key.into(), value)]);
        if kind == RuntimeKind::Jenkins {
            values.insert("observer_authenticated".into(), true.into());
        }
        let facts = Facts(BTreeMap::from([(
            credential.kind.key().into(),
            Fact {
                output: envelope(&credential, Ok(values)),
                status: 0,
            },
        )]));
        evaluate(&facts, check)
    };
    assert!(matches!(
        result(
            RuntimeKind::Jenkins,
            "use_security",
            true.into(),
            Check::JenkinsSecurity
        ),
        ExtraResult::Available {
            outcome: Outcome::Informational,
            ..
        }
    ));
    assert!(matches!(
        result(
            RuntimeKind::Jenkins,
            "use_security",
            false.into(),
            Check::JenkinsSecurity
        ),
        ExtraResult::Available {
            outcome: Outcome::Attention,
            ..
        }
    ));
    assert!(matches!(
        result(
            RuntimeKind::Redis,
            "default_dangerous_allowed",
            2.into(),
            Check::RedisDefaultAdmin
        ),
        ExtraResult::Available {
            outcome: Outcome::Informational,
            ..
        }
    ));
    assert!(matches!(
        result(
            RuntimeKind::Postgresql,
            "password_encryption",
            "scram-sha-256".into(),
            Check::PgPassword
        ),
        ExtraResult::Available {
            outcome: Outcome::Passed,
            ..
        }
    ));
    assert!(matches!(
        result(
            RuntimeKind::Postgresql,
            "password_encryption",
            "future-hash".into(),
            Check::PgPassword
        ),
        ExtraResult::UnavailableWith { .. }
    ));
}

/// Every runtime rule uses a declared native fact and complete bounded source/scope metadata.
#[test]
fn runtime_catalog_is_complete_unique_and_not_executable() {
    let mut ids = BTreeSet::new();
    let mut count = 0;
    for kind in [
        RuntimeKind::Postgresql,
        RuntimeKind::Mysql,
        RuntimeKind::Redis,
        RuntimeKind::Jenkins,
    ] {
        let module = kind.module_id();
        assert_eq!(keys(module), &[kind.key()]);
        for rule in rules(module) {
            count += 1;
            assert!(ids.insert(rule.id));
            assert_eq!(rule.fact_key, kind.key());
            for field in [
                rule.title,
                rule.expected,
                rule.rationale,
                rule.scope,
                rule.guidance,
                rule.reference,
            ] {
                assert!(!field.is_empty() && field.len() < 1024);
            }
        }
    }
    assert_eq!(count, 24);
    assert!(rules("untrusted; exec").is_empty());
    assert!(keys("untrusted").is_empty());
}

/// Published protocol clients receive a hard connection-local byte quota rather than unlimited stream input.
#[tokio::test]
async fn runtime_transport_budgets_input_and_output() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let data = vec![b'x'; transport::MAX_BYTES + 1];
    let mut stream = transport::Bounded::new(data.as_slice());
    let mut output = Vec::new();
    assert!(stream.read_to_end(&mut output).await.is_err());
    assert_eq!(output.len(), transport::MAX_BYTES);
    let mut writer = transport::Bounded::new(tokio::io::sink());
    writer
        .write_all(&data[..transport::MAX_BYTES])
        .await
        .unwrap();
    assert!(writer.write_all(b"x").await.is_err());
}

/// Dropping a protocol driver releases its owned future instead of leaving a pooled/background connection.
#[tokio::test]
async fn runtime_driver_is_abort_owned() {
    struct Signal(Option<tokio::sync::oneshot::Sender<()>>);
    impl Drop for Signal {
        fn drop(&mut self) {
            if let Some(sender) = self.0.take() {
                let _ = sender.send(());
            }
        }
    }
    let (entered, ready) = tokio::sync::oneshot::channel();
    let (sender, dropped) = tokio::sync::oneshot::channel();
    let driver = transport::Driver::spawn(async move {
        let _signal = Signal(Some(sender));
        let _ = entered.send(());
        std::future::pending::<()>().await;
    });
    ready.await.unwrap();
    drop(driver);
    tokio::time::timeout(Duration::from_secs(1), dropped)
        .await
        .unwrap()
        .unwrap();
}

/// An outer deadline must close an acquired raw SSH session even before exec establishes a remote timeout.
#[tokio::test]
async fn runtime_outer_deadline_closes_unexecuted_raw_ssh_channel() {
    use russh::{client, keys, server, Channel, ChannelId};
    use std::sync::Arc;
    struct PinnedClient(keys::PublicKey);
    impl client::Handler for PinnedClient {
        type Error = anyhow::Error;
        async fn check_server_key(
            &mut self,
            key: &keys::PublicKeyOrCertificate,
        ) -> anyhow::Result<bool> {
            Ok(
                matches!(key,keys::PublicKeyOrCertificate::PublicKey{key,..} if key.key_data()==self.0.key_data()),
            )
        }
    }
    struct CloseServer(Option<tokio::sync::oneshot::Sender<()>>);
    impl server::Handler for CloseServer {
        type Error = anyhow::Error;
        async fn auth_password(
            &mut self,
            user: &str,
            password: &str,
        ) -> anyhow::Result<server::Auth> {
            Ok(if user == "fixture" && password == "fixture-only" {
                server::Auth::Accept
            } else {
                server::Auth::reject()
            })
        }
        async fn channel_open_session(
            &mut self,
            _channel: Channel<server::Msg>,
            reply: server::ChannelOpenHandle,
            _: &mut server::Session,
        ) -> anyhow::Result<()> {
            reply.accept().await;
            Ok(())
        }
        async fn channel_close(
            &mut self,
            _: ChannelId,
            _: &mut server::Session,
        ) -> anyhow::Result<()> {
            if let Some(sender) = self.0.take() {
                let _ = sender.send(());
            }
            Ok(())
        }
    }
    tokio::time::timeout(Duration::from_secs(5), async {
        let key =
            keys::PrivateKey::random(&mut keys::key::safe_rng(), keys::Algorithm::Ed25519).unwrap();
        let pin = key.public_key().clone();
        let server_config = Arc::new(server::Config {
            keys: vec![key],
            auth_rejection_time: Duration::ZERO,
            auth_rejection_time_initial: Some(Duration::ZERO),
            ..Default::default()
        });
        let (sent, closed) = tokio::sync::oneshot::channel();
        let (local, remote) = tokio::io::duplex(64 * 1024);
        let server_task = transport::Driver::spawn(async move {
            let session = server::run_stream(server_config, remote, CloseServer(Some(sent)))
                .await
                .unwrap();
            let _ = session.await;
        });
        let mut client = client::connect_stream(
            Arc::new(client::Config::default()),
            local,
            PinnedClient(pin),
        )
        .await
        .unwrap();
        assert!(client
            .authenticate_password("fixture", "fixture-only")
            .await
            .unwrap()
            .success());
        let raw = client.channel_open_session().await.unwrap();
        let held = async move {
            let _channel = transport::ExecChannel::new(raw);
            std::future::pending::<()>().await;
        };
        assert!(tokio::time::timeout(Duration::from_millis(10), held)
            .await
            .is_err());
        tokio::time::timeout(Duration::from_secs(1), closed)
            .await
            .expect("outer deadline must close the raw SSH channel")
            .unwrap();
        client
            .disconnect(russh::Disconnect::ByApplication, "Fixture complete", "")
            .await
            .unwrap();
        drop(server_task);
    })
    .await
    .unwrap();
}
