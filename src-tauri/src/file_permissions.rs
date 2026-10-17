//! Single-target, ordinary-account permission metadata. No shell commands,
//! content opens, elevation, automatic mutation replay or recursive chmod.
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
    pub snapshot: Snapshot,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    pub link_count: Option<u64>,
    pub read_only: Option<bool>,
    /// A reason means unsupported, not that the current account was denied access.
    pub edit_unavailable: Option<String>,
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
    let (snapshot, uid, gid, link_count, read_only) = match endpoint {
        Endpoint::Remote(sftp) => {
            let attrs = sftp
                .symlink_metadata(path)
                .await
                .map_err(|e| e.to_string())?;
            (remote_snapshot(&attrs), attrs.uid, attrs.gid, None, None)
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
            (snapshot, ids.0, ids.1, ids.2, read_only)
        }
    };
    let edit_unavailable = if binding.model == Model::Windows {
        Some("Windows uses access-control lists. POSIX mode editing is not supported here.".into())
    } else if binding.model != Model::Posix {
        Some("The endpoint's POSIX permission model has not been identified. Refresh after the connection is ready.".into())
    } else if matches!(endpoint, Endpoint::Local) {
        Some(
            "Local permission editing is not yet available with verified no-follow safeguards."
                .into(),
        )
    } else if !matches!(snapshot.kind, EntryKind::File | EntryKind::Directory) {
        Some("Permission editing is available only for regular files and folders, not links or special entries.".into())
    } else if snapshot.mode.is_none() {
        Some("The server did not report mode bits. Zync cannot safely prepare an edit.".into())
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
        edit_unavailable,
    })
}

/// Called under the shared native destination lease. Apply once to the captured
/// SFTP channel. A failed acknowledgement is not permission to retry or roll back.
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
    let Endpoint::Remote(sftp) = endpoint else {
        return Err("Unsupported permission endpoint".into());
    };
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
    let readback = inspect(endpoint, binding, &expected.path).await;
    if check_binding().await.is_err() {
        return Ok(Outcome { status: OutcomeStatus::AppliedUnverified, metadata: None,
            message: "Server acknowledged the change on the captured session, but the connection changed before verification. Refresh permissions.".into() });
    }
    match readback {
        Ok(actual) if actual.canonical_parent == fresh.canonical_parent
            && same_item_evidence(&actual, &fresh) && actual.snapshot.mode.is_some() => {
            let verified = actual.snapshot.mode.map(|mode| mode & 0o7777) == Some(requested);
            Ok(Outcome { status: if verified { OutcomeStatus::Verified } else { OutcomeStatus::Adjusted },
                metadata: Some(actual), message: if verified { "Permissions updated; current mode verified.".into() }
                    else { "The server acknowledged the change but reported a different mode. Review the current permissions.".into() } })
        }
        result => Ok(Outcome { status: OutcomeStatus::AppliedUnverified, metadata: None,
            message: format!("Server acknowledged the change, but the current item could not be verified. Refresh permissions.{}",
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
