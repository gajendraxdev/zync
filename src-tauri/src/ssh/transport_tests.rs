//! Encrypted in-memory upgrade checks: authentication, SFTP and forwarding.
//! Fixtures never read credentials, connect sockets or mutate real files.

use super::{keys, SshManager};
use russh::{client, server, Channel, ChannelId, ChannelOpenFailure};
use russh_sftp::protocol::{Attrs, Data, FileAttributes, Handle, OpenFlags, Status, StatusCode};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const CONTENT: &[u8] = b"encrypted SSH to SFTP fixture bytes\0\xff\r\n";
const DEADLINE: Duration = Duration::from_secs(20);
const OUTPUT_CHUNKS: usize = 256;
const OUTPUT_CHUNK_BYTES: usize = 16 * 1024;

/// Pin the generated fixture key; certificates and unrelated keys fail closed.
struct Client(keys::PublicKey);

impl client::Handler for Client {
    type Error = anyhow::Error;
    async fn check_server_key(
        &mut self,
        key: &keys::PublicKeyOrCertificate,
    ) -> anyhow::Result<bool> {
        Ok(matches!(key, keys::PublicKeyOrCertificate::PublicKey { key, .. } if *key == self.0))
    }
}

/// Serve only a fixed byte slice; no filesystem or ambient account access exists.
struct MemoryFile;

impl russh_sftp::server::Handler for MemoryFile {
    type Error = StatusCode;
    fn unimplemented(&self) -> StatusCode {
        StatusCode::OpUnsupported
    }
    async fn lstat(&mut self, id: u32, path: String) -> Result<Attrs, StatusCode> {
        if path != "/fixture" {
            return Err(StatusCode::NoSuchFile);
        }
        let mut attrs = FileAttributes::empty();
        attrs.size = Some(CONTENT.len() as u64);
        attrs.permissions = Some(0o100400);
        Ok(Attrs { id, attrs })
    }
    async fn open(
        &mut self,
        id: u32,
        path: String,
        flags: OpenFlags,
        _: FileAttributes,
    ) -> Result<Handle, StatusCode> {
        if path != "/fixture" || flags.bits() != OpenFlags::READ.bits() {
            return Err(StatusCode::PermissionDenied);
        }
        Ok(Handle { id, handle: path })
    }
    async fn read(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        len: u32,
    ) -> Result<Data, StatusCode> {
        if handle != "/fixture" {
            return Err(StatusCode::NoSuchFile);
        }
        let offset = usize::try_from(offset).map_err(|_| StatusCode::Eof)?;
        if offset >= CONTENT.len() {
            return Err(StatusCode::Eof);
        }
        Ok(Data {
            id,
            data: CONTENT[offset..CONTENT.len().min(offset.saturating_add(len as usize))].to_vec(),
        })
    }
    async fn close(&mut self, id: u32, _: String) -> Result<Status, StatusCode> {
        Ok(Status {
            id,
            status_code: StatusCode::Ok,
            error_message: String::new(),
            language_tag: String::new(),
        })
    }
}

/// Authenticate explicit fixture credentials and accept SFTP or echo-forward channels.
struct Server {
    key: keys::PublicKey,
    certificate: Option<keys::Certificate>,
    sessions: HashMap<ChannelId, Channel<server::Msg>>,
    output_tasks: tokio::task::JoinSet<anyhow::Result<()>>,
}

impl server::Handler for Server {
    type Error = anyhow::Error;
    async fn auth_password(&mut self, user: &str, password: &str) -> anyhow::Result<server::Auth> {
        Ok(if user == "fixture" && password == "fixture-only-secret" {
            server::Auth::Accept
        } else {
            server::Auth::reject()
        })
    }
    async fn auth_publickey(
        &mut self,
        user: &str,
        key: &keys::PublicKey,
    ) -> anyhow::Result<server::Auth> {
        Ok(
            if self.certificate.is_none() && user == "fixture" && *key == self.key {
                server::Auth::Accept
            } else {
                server::Auth::reject()
            },
        )
    }
    async fn auth_openssh_certificate(
        &mut self,
        user: &str,
        certificate: &keys::Certificate,
    ) -> anyhow::Result<server::Auth> {
        Ok(
            if user == "fixture" && self.certificate.as_ref() == Some(certificate) {
                server::Auth::Accept
            } else {
                server::Auth::reject()
            },
        )
    }
    async fn channel_open_session(
        &mut self,
        channel: Channel<server::Msg>,
        reply: server::ChannelOpenHandle,
        _: &mut server::Session,
    ) -> anyhow::Result<()> {
        self.sessions.insert(channel.id(), channel);
        reply.accept().await;
        Ok(())
    }
    async fn subsystem_request(
        &mut self,
        id: ChannelId,
        name: &str,
        session: &mut server::Session,
    ) -> anyhow::Result<()> {
        if name != "sftp" {
            session.channel_failure(id)?;
            return Ok(());
        }
        let channel = self.sessions.remove(&id).expect("known fixture channel");
        session.channel_success(id)?;
        tokio::spawn(russh_sftp::server::run(channel.into_stream(), MemoryFile));
        Ok(())
    }
    /// Generate bounded chunks through the published channel API, including stderr and exit tail.
    async fn exec_request(
        &mut self,
        id: ChannelId,
        command: &[u8],
        session: &mut server::Session,
    ) -> anyhow::Result<()> {
        if command != b"fixture-output" {
            session.channel_failure(id)?;
            return Ok(());
        }
        let channel = self.sessions.remove(&id).expect("known fixture channel");
        session.channel_success(id)?;
        // The server owns this task, so failed/timeout fixtures also cancel its producer.
        self.output_tasks.spawn(async move {
            for index in 0..OUTPUT_CHUNKS {
                let marker = (index % 251) as u8;
                channel.data_bytes(vec![marker; OUTPUT_CHUNK_BYTES]).await?;
                channel.extended_data(1, &[marker][..]).await?;
            }
            channel.exit_status(17).await?;
            channel.eof().await?;
            channel.close().await?;
            Ok(())
        });
        Ok(())
    }
    async fn channel_open_direct_tcpip(
        &mut self,
        channel: Channel<server::Msg>,
        host: &str,
        port: u32,
        _: &str,
        _: u32,
        reply: server::ChannelOpenHandle,
        _: &mut server::Session,
    ) -> anyhow::Result<()> {
        if host != "fixture.invalid" || port != 4242 {
            reply
                .reject(ChannelOpenFailure::AdministrativelyProhibited)
                .await;
            return Ok(());
        }
        reply.accept().await;
        tokio::spawn(async move {
            let (mut read, mut write) = tokio::io::split(channel.into_stream());
            let _ = tokio::io::copy(&mut read, &mut write).await;
            let _ = write.shutdown().await;
        });
        Ok(())
    }
}

/// Abort fixture transport on success, assertion failure or the enclosing timeout.
struct Transport {
    client: client::Handle<Client>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Transport {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Exercise production encryption and channel framing over a bounded memory pipe.
async fn transport(user_key: &keys::PublicKey) -> Transport {
    transport_with_certificate(user_key, None).await
}

/// Reuse the bounded encrypted fixture with an optional certificate-only authentication policy.
async fn transport_with_certificate(
    user_key: &keys::PublicKey,
    certificate: Option<keys::Certificate>,
) -> Transport {
    let host_key =
        keys::PrivateKey::random(&mut keys::key::safe_rng(), keys::Algorithm::Ed25519).unwrap();
    let expected_host_key = host_key.public_key().clone();
    let config = Arc::new(server::Config {
        keys: vec![host_key],
        auth_rejection_time: Duration::ZERO,
        auth_rejection_time_initial: Some(Duration::ZERO),
        ..Default::default()
    });
    let server = Server {
        key: user_key.clone(),
        certificate,
        sessions: HashMap::new(),
        output_tasks: tokio::task::JoinSet::new(),
    };
    let (local, remote) = tokio::io::duplex(64 * 1024);
    let task = tokio::spawn(async move {
        let session = server::run_stream(config, remote, server).await.unwrap();
        let _ = session.await;
    });
    let client = client::connect_stream(
        Arc::new(client::Config::default()),
        local,
        Client(expected_host_key),
    )
    .await
    .unwrap();
    Transport { client, task }
}

#[tokio::test]
async fn user_certificate_authentication_uses_certificate_without_bare_key_fallback() {
    // RSA generation must not consume the encrypted-transport deadline under parallel CI load.
    for algorithm in [
        keys::Algorithm::Ed25519,
        keys::Algorithm::Rsa { hash: None },
    ] {
        let key = keys::PrivateKey::random(&mut keys::key::safe_rng(), algorithm).unwrap();
        tokio::time::timeout(DEADLINE, async {
            let ca = keys::PrivateKey::random(&mut keys::key::safe_rng(), keys::Algorithm::Ed25519)
                .unwrap();
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            let mut builder = keys::ssh_key::certificate::Builder::new(
                vec![7; 32],
                key.public_key().key_data().clone(),
                now - 1,
                now + 300,
            )
            .unwrap();
            builder.valid_principal("fixture").unwrap();
            let cert = builder.sign(&ca).unwrap();
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join("user-cert.pub");
            std::fs::write(&path, cert.to_openssh().unwrap()).unwrap();
            let mut encoded = Vec::new();
            keys::encode_pkcs8_pem(&key, &mut encoded).unwrap();
            let encoded = String::from_utf8(encoded).unwrap();
            let mut fixture = transport_with_certificate(key.public_key(), Some(cert)).await;
            assert!(!SshManager::auth_with_key_data(
                &mut fixture.client,
                "fixture",
                &encoded,
                None,
                None
            )
            .await
            .unwrap());
            assert!(SshManager::auth_with_key_data(
                &mut fixture.client,
                "fixture",
                &encoded,
                None,
                path.to_str()
            )
            .await
            .unwrap());
            // A bad configured certificate must fail even when the server accepts the bare key.
            let mut fixture = transport(key.public_key()).await;
            std::fs::write(&path, "invalid certificate").unwrap();
            assert!(SshManager::auth_with_key_data(
                &mut fixture.client,
                "fixture",
                &encoded,
                None,
                path.to_str()
            )
            .await
            .is_err());
        })
        .await
        .expect("certificate transport timed out");
    }
}

#[tokio::test]
async fn published_session_channel_preserves_stdout_stderr_and_exit_tail() {
    tokio::time::timeout(DEADLINE, async {
        let key =
            keys::PrivateKey::random(&mut keys::key::safe_rng(), keys::Algorithm::Ed25519).unwrap();
        let mut fixture = transport(key.public_key()).await;
        assert!(fixture
            .client
            .authenticate_password("fixture", "fixture-only-secret")
            .await
            .unwrap()
            .success());
        let mut channel = fixture.client.channel_open_session().await.unwrap();
        channel.exec(true, "fixture-output").await.unwrap();
        let (mut stdout, mut stderr) = (0, 0);
        let (mut status, mut eof, mut closed) = (None, false, false);
        while let Some(message) = channel.wait().await {
            match message {
                russh::ChannelMsg::Data { data } => {
                    for byte in data {
                        assert_eq!(byte, ((stdout / OUTPUT_CHUNK_BYTES) % 251) as u8);
                        stdout += 1;
                    }
                }
                russh::ChannelMsg::ExtendedData { ext, data } => {
                    assert_eq!(ext, 1);
                    for byte in data {
                        assert_eq!(byte, (stderr % 251) as u8);
                        stderr += 1;
                    }
                }
                russh::ChannelMsg::ExitStatus { exit_status } => {
                    assert_eq!(stdout, OUTPUT_CHUNKS * OUTPUT_CHUNK_BYTES);
                    assert_eq!(stderr, OUTPUT_CHUNKS);
                    status = Some(exit_status);
                }
                russh::ChannelMsg::Eof => eof = true,
                russh::ChannelMsg::Close => {
                    closed = true;
                    break;
                }
                _ => {}
            }
            tokio::task::yield_now().await;
        }
        assert_eq!(stdout, OUTPUT_CHUNKS * OUTPUT_CHUNK_BYTES);
        assert_eq!(stderr, OUTPUT_CHUNKS);
        assert_eq!(status, Some(17));
        assert!(eof && closed);
    })
    .await
    .expect("published SSH session output check timed out");
}

#[tokio::test]
async fn encrypted_password_sftp_and_direct_forwarding_remain_compatible() {
    tokio::time::timeout(DEADLINE, async {
        let key =
            keys::PrivateKey::random(&mut keys::key::safe_rng(), keys::Algorithm::Ed25519).unwrap();
        let mut fixture = transport(key.public_key()).await;
        assert!(!fixture
            .client
            .authenticate_password("fixture", "wrong")
            .await
            .unwrap()
            .success());
        assert!(fixture
            .client
            .authenticate_password("fixture", "fixture-only-secret")
            .await
            .unwrap()
            .success());

        let channel = fixture.client.channel_open_session().await.unwrap();
        channel.request_subsystem(true, "sftp").await.unwrap();
        let sftp = russh_sftp::client::SftpSession::new(channel.into_stream())
            .await
            .unwrap();
        assert_eq!(
            sftp.symlink_metadata("/fixture").await.unwrap().size,
            Some(CONTENT.len() as u64)
        );
        let mut file = sftp.open("/fixture").await.unwrap();
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).await.unwrap();
        assert_eq!(bytes, CONTENT);
        file.shutdown().await.unwrap();
        sftp.close().await.unwrap();

        assert!(fixture
            .client
            .channel_open_direct_tcpip("wrong.invalid", 4242, "127.0.0.1", 0)
            .await
            .is_err());
        let channel = fixture
            .client
            .channel_open_direct_tcpip("fixture.invalid", 4242, "127.0.0.1", 0)
            .await
            .unwrap();
        let mut stream = channel.into_stream();
        stream.write_all(CONTENT).await.unwrap();
        let mut echoed = vec![0; CONTENT.len()];
        stream.read_exact(&mut echoed).await.unwrap();
        assert_eq!(echoed, CONTENT);
        stream.shutdown().await.unwrap();
    })
    .await
    .expect("in-memory SSH/SFTP/forward compatibility check timed out");
}

#[tokio::test]
async fn encrypted_private_key_authentication_uses_the_production_decoder_and_hash_policy() {
    for algorithm in [
        keys::Algorithm::Ed25519,
        keys::Algorithm::Rsa { hash: None },
    ] {
        let key = keys::PrivateKey::random(&mut keys::key::safe_rng(), algorithm).unwrap();
        // Test-only low-cost KDF: this checks wire compatibility, not KDF throughput.
        let openssh = key
            .encrypt_with(
                keys::ssh_key::Cipher::Aes256Ctr,
                keys::ssh_key::Kdf::Bcrypt {
                    salt: vec![17; 16],
                    rounds: 1,
                },
                0x1234_5678,
                b"fixture passphrase",
            )
            .unwrap()
            .to_openssh(keys::ssh_key::LineEnding::LF)
            .unwrap();
        assert!(matches!(
            keys::decode_secret_key(&openssh, None),
            Err(keys::Error::KeyIsEncrypted)
        ));
        assert!(keys::decode_secret_key(&openssh, Some("wrong")).is_err());
        assert_eq!(
            keys::decode_secret_key(&openssh, Some("fixture passphrase"))
                .unwrap()
                .public_key(),
            key.public_key(),
        );
        let mut encoded = Vec::new();
        keys::encode_pkcs8_pem_encrypted(&key, b"fixture passphrase", 2, &mut encoded).unwrap();
        let encoded = String::from_utf8(encoded).unwrap();
        // CPU-bound RSA generation/KDF checks above must not consume the
        // transport deadline under the full suite's parallel crypto load.
        let mut fixture = tokio::time::timeout(DEADLINE, transport(key.public_key()))
            .await
            .expect("in-memory private-key transport handshake timed out");
        assert!(tokio::time::timeout(
            DEADLINE,
            SshManager::auth_with_key_data(
                &mut fixture.client,
                "fixture",
                &encoded,
                Some("wrong"),
                None
            )
        )
        .await
        .expect("rejected private-key authentication timed out")
        .is_err());
        assert!(tokio::time::timeout(
            DEADLINE,
            SshManager::auth_with_key_data(
                &mut fixture.client,
                "fixture",
                &encoded,
                Some("fixture passphrase"),
                None,
            )
        )
        .await
        .expect("accepted private-key authentication timed out")
        .unwrap());
    }
}
