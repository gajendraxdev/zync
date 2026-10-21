//! Bounded OpenSSH user-certificate loading. Server trust remains in `ssh`.

use anyhow::{anyhow, bail, Context, Result};
use russh::keys::{Certificate, PrivateKey};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::AsyncReadExt;

const MAX_CERTIFICATE_BYTES: u64 = 64 * 1024;

/// Read the configured public certificate afresh, so renewed certificates work on reconnect.
pub(crate) async fn load(path: &str, key: &PrivateKey) -> Result<Certificate> {
    let path = if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        dirs::home_dir()
            .context("Cannot resolve certificate home directory")?
            .join(rest)
    } else {
        std::path::PathBuf::from(path)
    };
    let metadata = tokio::fs::metadata(&path)
        .await
        .context("Cannot read SSH user certificate")?;
    if !metadata.is_file() || metadata.len() > MAX_CERTIFICATE_BYTES {
        bail!("SSH user certificate must be a regular file of at most 64 KiB");
    }
    let file = tokio::fs::File::open(&path)
        .await
        .context("Cannot open SSH user certificate")?;
    let mut bytes = Vec::new();
    file.take(MAX_CERTIFICATE_BYTES + 1)
        .read_to_end(&mut bytes)
        .await?;
    if bytes.len() as u64 > MAX_CERTIFICATE_BYTES {
        bail!("SSH user certificate exceeds 64 KiB");
    }
    let text = std::str::from_utf8(&bytes).context("SSH user certificate is not UTF-8")?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    validate(text.trim(), key, now)
}

/// Check key ownership, certificate type, signature and lifetime, not server authorization policy.
fn validate(text: &str, key: &PrivateKey, now: u64) -> Result<Certificate> {
    let cert = Certificate::from_openssh(text).context("Invalid OpenSSH user certificate")?;
    if cert.cert_type() != russh::keys::ssh_key::certificate::CertType::User {
        bail!("A user certificate is required, not a host certificate");
    }
    if cert.public_key() != key.public_key().key_data() {
        bail!("SSH user certificate does not match the selected private key");
    }
    cert.verify_signature()
        .map_err(|_| anyhow!("SSH user certificate signature is invalid"))?;
    if now < cert.valid_after() {
        bail!("SSH user certificate is not valid yet");
    }
    if now >= cert.valid_before() {
        bail!("SSH user certificate has expired; renew it before connecting");
    }
    // Principals, critical options, revocation and CA authorization belong to sshd.
    Ok(cert)
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh::keys::ssh_key::certificate::{Builder, CertType};
    use russh::keys::{key::safe_rng, Algorithm};

    /// Generate only ephemeral keys and certificates; never use device identities.
    fn fixture(kind: CertType) -> (PrivateKey, String) {
        let ca = PrivateKey::random(&mut safe_rng(), Algorithm::Ed25519).unwrap();
        let key = PrivateKey::random(&mut safe_rng(), Algorithm::Ed25519).unwrap();
        let mut builder =
            Builder::new(vec![1; 32], key.public_key().key_data().clone(), 100, 200).unwrap();
        builder.cert_type(kind).unwrap();
        builder.valid_principal("role-not-login-name").unwrap();
        let cert = builder.sign(&ca).unwrap().to_openssh().unwrap();
        (key, cert)
    }

    #[test]
    fn accepts_matching_user_certificate_and_rejects_lifetime_boundaries() {
        let (key, cert) = fixture(CertType::User);
        assert!(validate(&cert, &key, 100).is_ok());
        assert!(validate(&cert, &key, 199).is_ok());
        assert!(validate(&cert, &key, 99).is_err());
        assert!(validate(&cert, &key, 200).is_err());
    }

    #[test]
    fn rejects_host_certificate_mismatched_key_and_malformed_input() {
        let (key, host_cert) = fixture(CertType::Host);
        assert!(validate(&host_cert, &key, 150).is_err());
        let (_, other_cert) = fixture(CertType::User);
        assert!(validate(&other_cert, &key, 150).is_err());
        assert!(validate("not a certificate", &key, 150).is_err());
    }

    #[tokio::test]
    async fn rejects_missing_directory_and_oversized_certificate_files() {
        let (key, _) = fixture(CertType::User);
        let directory = tempfile::tempdir().unwrap();
        assert!(load(directory.path().to_str().unwrap(), &key)
            .await
            .is_err());
        let path = directory.path().join("certificate.pub");
        assert!(load(path.to_str().unwrap(), &key).await.is_err());
        std::fs::write(&path, vec![b'x'; MAX_CERTIFICATE_BYTES as usize + 1]).unwrap();
        assert!(load(path.to_str().unwrap(), &key).await.is_err());
    }
}
