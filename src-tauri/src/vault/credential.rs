//! Typed credential model + compatibility helpers for vault record storage.
//!
//! Vault records still keep the legacy `secret` field encrypted for runtime SSH
//! compatibility, while persisting a typed `credential` envelope for future
//! multi-kind credential workflows. Older records are normalized on read/write.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use super::types::PlaintextRecord;

pub const CURRENT_CREDENTIAL_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CredentialKind {
    SshPrivateKey,
    SshPassword,
    SshKeyWithPassphrase,
    SshCertificate,
    UsernamePassword,
    ApiToken,
    SecretText,
    Certificate,
    CertificateKeyPair,
    CertificateChain,
    GitCredential,
    JenkinsCredential,
    ContainerRegistryCredential,
    CloudProviderCredential,
    ExternalKeychainReference,
    PluginDefined,
    GenericSecret,
}

impl CredentialKind {
    pub fn from_legacy_kind(kind: &str) -> Self {
        match kind {
            "ssh-private-key" => Self::SshPrivateKey,
            "ssh-password" => Self::SshPassword,
            "ssh-agent-key" => Self::ExternalKeychainReference,
            "api-token" | "api-key" => Self::ApiToken,
            "secret-text" | "secure-note" => Self::SecretText,
            "username-password" => Self::UsernamePassword,
            "certificate" => Self::Certificate,
            "certificate-key-pair" => Self::CertificateKeyPair,
            "jenkins-credential" => Self::JenkinsCredential,
            "git-credential" => Self::GitCredential,
            "plugin-defined" => Self::PluginDefined,
            _ => Self::GenericSecret,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CredentialFieldFormat {
    Text,
    Username,
    Password,
    PrivateKey,
    Certificate,
    Token,
    Url,
    Json,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CredentialFieldEncoding {
    Plain,
    Pem,
    Base64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialField {
    pub name: String,
    pub label: String,
    pub secret: bool,
    #[serde(default)]
    pub required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<CredentialFieldFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encoding: Option<CredentialFieldEncoding>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_ref_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legacy_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialEnvelope {
    pub credential_id: String,
    pub kind: CredentialKind,
    pub label: String,
    pub fields: Vec<CredentialField>,
    pub metadata: CredentialMetadata,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub revision: u64,
    pub schema_version: u32,
}

pub fn normalize_record_credential(record: &mut PlaintextRecord) {
    let mut credential = record
        .credential
        .take()
        .unwrap_or_else(|| legacy_record_to_credential(record));
    let normalized_kind = CredentialKind::from_legacy_kind(&record.kind);

    credential.credential_id = record
        .logical_id
        .as_ref()
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| record.id.clone());
    credential.kind = normalized_kind.clone();
    credential.label = record.label.clone();
    credential.created_at = record.created_at;
    credential.updated_at = record.updated_at;
    credential.revision = record.revision;
    credential.schema_version = CURRENT_CREDENTIAL_SCHEMA_VERSION;
    credential.metadata.legacy_kind = Some(record.kind.clone());

    if credential.metadata.notes.is_none() {
        credential.metadata.notes = record.notes.clone();
    }

    if credential.fields.is_empty() {
        credential
            .fields
            .push(legacy_secret_field(record, &normalized_kind));
    } else {
        let mut has_secret_field = false;
        for field in &mut credential.fields {
            if field.secret {
                has_secret_field = true;
                field.value = None;
                if field.value_ref.is_none() {
                    field.value_ref = Some(format!("legacy:{}:secret", record.id));
                }
            }
        }
        if !has_secret_field {
            credential
                .fields
                .push(legacy_secret_field(record, &normalized_kind));
        }
    }

    record.credential = Some(credential);
}

pub fn legacy_record_to_credential(record: &PlaintextRecord) -> CredentialEnvelope {
    let kind = CredentialKind::from_legacy_kind(&record.kind);
    let field = legacy_secret_field(record, &kind);
    let credential_id = record
        .logical_id
        .clone()
        .unwrap_or_else(|| record.id.clone());

    CredentialEnvelope {
        credential_id,
        kind,
        label: record.label.clone(),
        fields: vec![field],
        metadata: CredentialMetadata {
            legacy_kind: Some(record.kind.clone()),
            notes: record.notes.clone(),
            ..CredentialMetadata::default()
        },
        tags: Vec::new(),
        created_at: record.created_at,
        updated_at: record.updated_at,
        revision: record.revision,
        schema_version: CURRENT_CREDENTIAL_SCHEMA_VERSION,
    }
}

fn legacy_secret_field(record: &PlaintextRecord, kind: &CredentialKind) -> CredentialField {
    let (name, label, format, encoding) = match kind {
        CredentialKind::SshPrivateKey | CredentialKind::SshKeyWithPassphrase => (
            "privateKey",
            "Private Key",
            Some(CredentialFieldFormat::PrivateKey),
            Some(CredentialFieldEncoding::Pem),
        ),
        CredentialKind::SshPassword | CredentialKind::UsernamePassword => (
            "password",
            "Password",
            Some(CredentialFieldFormat::Password),
            None,
        ),
        CredentialKind::ApiToken => (
            "token",
            "Token",
            Some(CredentialFieldFormat::Token),
            None,
        ),
        _ => ("secret", "Secret", Some(CredentialFieldFormat::Text), None),
    };

    CredentialField {
        name: name.to_string(),
        label: label.to_string(),
        secret: true,
        required: true,
        format,
        value: None,
        value_ref: Some(format!("legacy:{}:secret", record.id)),
        encoding,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legacy_record(kind: &str) -> PlaintextRecord {
        PlaintextRecord {
            id: "item-1".to_string(),
            logical_id: Some("cred-1".to_string()),
            kind: kind.to_string(),
            label: "Prod credential".to_string(),
            secret: "not-copied-to-envelope".to_string(),
            notes: Some("owned by ops".to_string()),
            credential: None,
            revision: 7,
            created_at: 10,
            updated_at: 20,
        }
    }

    #[test]
    fn legacy_private_key_maps_to_typed_secret_ref_without_plaintext() {
        let record = legacy_record("ssh-private-key");

        let credential = legacy_record_to_credential(&record);

        assert_eq!(credential.credential_id, "cred-1");
        assert_eq!(credential.kind, CredentialKind::SshPrivateKey);
        assert_eq!(credential.fields.len(), 1);
        assert_eq!(credential.fields[0].name, "privateKey");
        assert_eq!(credential.fields[0].format, Some(CredentialFieldFormat::PrivateKey));
        assert_eq!(credential.fields[0].encoding, Some(CredentialFieldEncoding::Pem));
        assert_eq!(
            credential.fields[0].value_ref.as_deref(),
            Some("legacy:item-1:secret")
        );
        assert_eq!(credential.fields[0].value, None);
        assert_eq!(credential.metadata.notes.as_deref(), Some("owned by ops"));
    }

    #[test]
    fn legacy_record_without_logical_id_uses_physical_id_for_compatibility() {
        let mut record = legacy_record("ssh-password");
        record.logical_id = None;

        let credential = legacy_record_to_credential(&record);

        assert_eq!(credential.credential_id, "item-1");
        assert_eq!(credential.kind, CredentialKind::SshPassword);
        assert_eq!(credential.fields[0].name, "password");
    }

    #[test]
    fn unknown_legacy_kind_preserves_kind_in_metadata() {
        let record = legacy_record("legacy-custom-secret");

        let credential = legacy_record_to_credential(&record);

        assert_eq!(credential.kind, CredentialKind::GenericSecret);
        assert_eq!(
            credential.metadata.legacy_kind.as_deref(),
            Some("legacy-custom-secret")
        );
    }

    #[test]
    fn normalize_record_credential_builds_and_stabilizes_envelope() {
        let mut record = legacy_record("ssh-password");
        normalize_record_credential(&mut record);

        let credential = record
            .credential
            .as_ref()
            .expect("credential envelope");
        assert_eq!(credential.credential_id, "cred-1");
        assert_eq!(credential.kind, CredentialKind::SshPassword);
        assert_eq!(credential.label, "Prod credential");
        assert_eq!(credential.revision, 7);
        assert_eq!(
            credential.fields[0].value_ref.as_deref(),
            Some("legacy:item-1:secret")
        );
        assert_eq!(credential.fields[0].value, None);
    }
}
