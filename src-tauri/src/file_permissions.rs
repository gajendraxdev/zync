//! Single-target permission metadata and ordinary-account mode editing. No
//! content opens in metadata/edit paths, automatic mutation replay or recursive
//! chmod. Explicit SSH administrator review is isolated in `elevation`, never an
//! automatic fallback.
//! Explicit Copy preflight lives in `access`: read-only handles, no data reads.
//!
//! SFTP v3 SETSTAT is path-based: fresh LSTAT/parent checks reduce stale edits,
//! but cannot provide inode compare-and-swap against an external rename/link race.

use crate::file_transfers::endpoint::{
    local_snapshot, remote_snapshot, Endpoint, EntryKind, FileEndpoint, Snapshot,
};
use russh_sftp::{
    client::error::Error as SftpError,
    protocol::{FileAttributes, StatusCode},
};
use serde::{Deserialize, Serialize};

pub mod access;
pub mod elevation;
pub mod local;
#[cfg(windows)]
pub mod system_editor;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub identity: String,
    pub session: String,
    pub model: Model,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Model {
    Posix,
    Windows,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    pub binding: Binding,
    pub path: String,
    pub canonical_parent: String,
    #[serde(with = "PermissionSnapshot")]
    pub snapshot: Snapshot,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    pub link_count: Option<u64>,
    pub read_only: Option<bool>,
    /// Advisory local access check, never inferred from POSIX mode or remote UID.
    #[serde(default)]
    pub write_access: Option<bool>,
    /// Explicit OS-owned editor handoff, never a successful POSIX chmod claim.
    #[serde(default)]
    pub system_editor: bool,
    /// Selected local object evidence; never synthesized from a remote listing.
    #[serde(default)]
    pub local_identity: Option<String>,
    /// A reason means unsupported, not that the current account was denied access.
    pub edit_unavailable: Option<String>,
}

/// Permission evidence makes a round trip through JavaScript before freshness
/// comparison. Keep 64/128-bit native integers lossless on this IPC boundary;
/// the shared transfer snapshot and persisted recovery format remain unchanged.
#[derive(Serialize, Deserialize)]
#[serde(remote = "Snapshot")]
struct PermissionSnapshot {
    kind: EntryKind,
    #[serde(with = "decimal_u64")]
    size: u64,
    #[serde(with = "optional_decimal_u128")]
    modified: Option<u128>,
    mode: Option<u32>,
}

mod decimal_u64 {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(value: &u64, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&value.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u64, D::Error> {
        String::deserialize(deserializer)?
            .parse()
            .map_err(serde::de::Error::custom)
    }
}

mod optional_decimal_u128 {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(
        value: &Option<u128>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value.map(|value| value.to_string()).serialize(serializer)
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<u128>, D::Error> {
        Option::<String>::deserialize(deserializer)?
            .map(|value| value.parse().map_err(serde::de::Error::custom))
            .transpose()
    }
    use serde::Serialize;
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub status: OutcomeStatus,
    pub metadata: Option<Metadata>,
    pub message: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OutcomeStatus {
    Verified,
    Adjusted,
    AppliedUnverified,
    Rejected,
    Unknown,
}

/// Classify the remote detector's Windows marker or nonempty Unix/distro ID.
/// Never infer the server's model from the desktop OS or path spelling.
pub fn remote_model(os: Option<&str>) -> Model {
    match os.map(str::trim) {
        None | Some("") => Model::Unknown,
        Some(os) if os.eq_ignore_ascii_case("windows") => Model::Windows,
        Some(_) => Model::Posix,
    }
}

pub(crate) fn validate_path(path: &str) -> Result<(), String> {
    if path.is_empty() || path.len() > 32_768 || path.contains('\0') {
        return Err("A valid, bounded native path is required".into());
    }
    Ok(())
}

/// Only ordinary permission bits are editable; retain special bits from the fresh
/// native base, never from a client-supplied replacement mode or file-type bits.
pub fn changed_mode(base: u32, set: u32, clear: u32) -> Result<u32, String> {
    if (set | clear) & !0o777 != 0 || set & clear != 0 {
        return Err("Permission changes require disjoint ordinary set/clear masks".into());
    }
    Ok(((base & 0o7777) | set) & !clear)
}

/// Read only one explicit Properties target. Unknown attributes remain optional;
/// this is not a directory scan or proof of effective account access.
pub async fn inspect(
    endpoint: &Endpoint,
    binding: Binding,
    path: &str,
) -> Result<Metadata, String> {
    validate_path(path)?;
    let canonical_parent = endpoint.canonicalize(&endpoint.sibling(path, ".")?).await?;
    let (snapshot, uid, gid, link_count, read_only, local_identity) = match endpoint {
        Endpoint::Remote(sftp) => {
            let attrs = sftp
                .symlink_metadata(path)
                .await
                .map_err(|e| e.to_string())?;
            (
                remote_snapshot(&attrs),
                attrs.uid,
                attrs.gid,
                None,
                None,
                None,
            )
        }
        Endpoint::Local => {
            let metadata = tokio::fs::symlink_metadata(path)
                .await
                .map_err(|e| e.to_string())?;
            let snapshot = local_snapshot(&metadata);
            #[cfg(unix)]
            let ids = {
                use std::os::unix::fs::MetadataExt;
                (
                    Some(metadata.uid()),
                    Some(metadata.gid()),
                    Some(metadata.nlink()),
                )
            };
            #[cfg(not(unix))]
            let ids = (None, None, None);
            #[cfg(windows)]
            let read_only = Some(metadata.permissions().readonly());
            #[cfg(not(windows))]
            let read_only = None;
            (
                snapshot,
                ids.0,
                ids.1,
                ids.2,
                read_only,
                local::identity(&metadata),
            )
        }
    };
    let allow_system_editor = binding.model == Model::Windows;
    let (write_access, system_editor) = if matches!(endpoint, Endpoint::Local)
        && matches!(snapshot.kind, EntryKind::File | EntryKind::Directory)
    {
        let path = path.to_owned();
        let is_file = snapshot.kind == EntryKind::File;
        tokio::task::spawn_blocking(move || {
            let write_access = if is_file {
                std::path::Path::new(&path)
                    .parent()
                    .and_then(|parent| {
                        access::inspect(parent.to_string_lossy().into_owned(), Some(path.clone()))
                            .ok()
                    })
                    .and_then(|access| access.target_access.write)
            } else {
                None
            };
            (
                write_access,
                allow_system_editor && access::supports_system_editor(&path),
            )
        })
        .await
        .unwrap_or((None, false))
    } else {
        (None, false)
    };
    let edit_unavailable = if system_editor {
        None
    } else if binding.model == Model::Windows {
        Some("Windows uses access-control lists. POSIX mode editing is not supported here.".into())
    } else if binding.model != Model::Posix {
        Some("The endpoint's POSIX permission model has not been identified. Refresh after the connection is ready.".into())
    } else if !matches!(snapshot.kind, EntryKind::File | EntryKind::Directory) {
        Some("Permission editing is available only for regular files and folders, not links or special entries.".into())
    } else if snapshot.mode.is_none() {
        Some("The server did not report mode bits. Zync cannot safely prepare an edit.".into())
    } else if matches!(endpoint, Endpoint::Local) {
        let path = path.to_owned();
        let expected_identity = local_identity.clone();
        let qualified = tokio::task::spawn_blocking(move || {
            local::Target::open(std::path::Path::new(&path))
                .ok()
                .is_some_and(|target| {
                    target.mode_edit_supported()
                        && target
                            .metadata()
                            .ok()
                            .is_some_and(|metadata| local::identity(&metadata) == expected_identity)
                })
        })
        .await
        .unwrap_or(false);
        (!qualified).then(|| "Handle-bound local mode editing requires Linux 6.6 or newer and a supported local filesystem. This platform or target is not qualified.".into())
    } else {
        None
    };
    Ok(Metadata {
        binding,
        path: path.into(),
        canonical_parent,
        snapshot,
        uid,
        gid,
        link_count,
        read_only,
        write_access,
        system_editor,
        local_identity,
        edit_unavailable,
    })
}

/// Called under the shared native destination lease. Apply once to the captured
/// endpoint. A failed acknowledgement is not permission to retry or roll back.
pub async fn apply<F, Fut>(
    endpoint: &Endpoint,
    binding: Binding,
    expected: &Metadata,
    set: u32,
    clear: u32,
    check_binding: F,
) -> Result<Outcome, String>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    changed_mode(0, set, clear)?;
    if binding.model != Model::Posix {
        return Err("This endpoint does not support POSIX mode editing".into());
    }
    if binding != expected.binding {
        return Err("Connection changed. Refresh permissions before editing.".into());
    }
    let fresh = inspect(endpoint, binding.clone(), &expected.path).await?;
    if fresh.edit_unavailable.is_some() {
        return Err(fresh.edit_unavailable.unwrap());
    }
    if fresh != *expected {
        return Err(
            "The item or its permissions changed. Refresh and review before applying.".into(),
        );
    }
    let mode = fresh.snapshot.mode.ok_or("Mode is unavailable")?;
    let requested = changed_mode(mode, set, clear)?;
    // An asynchronous metadata read may span a reconnect/account replacement.
    check_binding().await?;
    if requested == mode & 0o7777 {
        return Ok(Outcome {
            status: OutcomeStatus::Verified,
            metadata: Some(fresh),
            message: "Permissions are unchanged.".into(),
        });
    }
    let mut local_after = None;
    if matches!(endpoint, Endpoint::Local) {
        let captured = fresh.clone();
        let result = tokio::task::spawn_blocking(move || {
            let target = local::Target::open(std::path::Path::new(&captured.path))
                .map_err(|error| (OutcomeStatus::Rejected, error.to_string()))?;
            let identity = captured.local_identity.as_deref().ok_or((
                OutcomeStatus::Rejected,
                "Native local identity is unavailable".to_string(),
            ))?;
            target
                .set_mode(identity, mode, requested)
                .map_err(|error| {
                    (
                        if local::definite_rejection(&error) {
                            OutcomeStatus::Rejected
                        } else {
                            OutcomeStatus::Unknown
                        },
                        error.to_string(),
                    )
                })?;
            // Retain handle-bound post-change evidence, even if the displayed
            // path was moved/replaced while the kernel applied the change.
            Ok::<_, (OutcomeStatus, String)>(
                target
                    .metadata()
                    .ok()
                    .and_then(|metadata| local::identity(&metadata)),
            )
        })
        .await;
        local_after = match result {
            Ok(Ok(identity)) => identity,
            Ok(Err((status, error))) => return Ok(Outcome {
                status,
                metadata: None,
                message: format!(
                    "Local permission change did not complete normally: {error}. Refresh permissions before retrying. No elevation was attempted."
                ),
            }),
            Err(_) => return Ok(Outcome {
                status: OutcomeStatus::Unknown,
                metadata: None,
                message:
                    "Local permission task was interrupted. Refresh permissions before retrying."
                        .into(),
            }),
        };
    } else if let Endpoint::Remote(sftp) = endpoint {
        // Do not round-trip size, owner/group, atime or mtime: SETSTAT's only field is mode.
        let mut attrs = FileAttributes::empty();
        attrs.permissions = Some(requested);
        if let Err(error) = sftp.set_metadata(&expected.path, attrs).await {
            let rejected = matches!(&error, SftpError::Status(status)
            if matches!(status.status_code, StatusCode::PermissionDenied | StatusCode::OpUnsupported | StatusCode::NoSuchFile));
            return Ok(Outcome {
                status: if rejected {
                    OutcomeStatus::Rejected
                } else {
                    OutcomeStatus::Unknown
                },
                metadata: None,
                message: if rejected {
                    format!(
                    "Server rejected the permission change: {error}. No elevation was attempted."
                )
                } else {
                    format!("Permission change outcome is unknown: {error}. Refresh to check the current mode; do not blindly retry.")
                },
            });
        }
    }
    let readback = inspect(endpoint, binding, &expected.path).await;
    if check_binding().await.is_err() {
        return Ok(Outcome { status: OutcomeStatus::AppliedUnverified, metadata: None,
            message: "The permission change was acknowledged, but the endpoint changed before verification. Refresh permissions.".into() });
    }
    match readback {
        Ok(actual) if actual.canonical_parent == fresh.canonical_parent
            && same_item_evidence(&actual, &fresh) && actual.snapshot.mode.is_some()
            && (!matches!(endpoint, Endpoint::Local) || (local_after.is_some() && actual.local_identity == local_after)) => {
            let verified = actual.snapshot.mode.map(|mode| mode & 0o7777) == Some(requested);
            Ok(Outcome { status: if verified { OutcomeStatus::Verified } else { OutcomeStatus::Adjusted },
                metadata: Some(actual), message: if verified { "Permissions updated; current mode verified.".into() }
                    else { "The filesystem acknowledged the change but reported a different mode. Review the current permissions.".into() } })
        }
        result => Ok(Outcome { status: OutcomeStatus::AppliedUnverified, metadata: None,
            message: format!("The permission change was acknowledged, but the current item could not be verified. Refresh permissions; do not blindly retry.{}",
                result.err().map(|e| format!(" {e}")).unwrap_or_default()) }),
    }
}

/// Conservative evidence, not immutable SFTP identity. A content/owner/time
/// change makes read-back unverified even when mode happens to match the request.
fn same_item_evidence(actual: &Metadata, expected: &Metadata) -> bool {
    actual.snapshot.kind == expected.snapshot.kind
        && actual.snapshot.size == expected.snapshot.size
        && actual.snapshot.modified == expected.snapshot.modified
        && actual.uid == expected.uid
        && actual.gid == expected.gid
}

#[cfg(test)]
mod tests;
