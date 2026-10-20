//! Streaming breadth-first metadata traversal: one open directory and one SFTP
//! response at a time; only pending folder paths are retained (byte-budgeted).
use crate::file_transfers::endpoint::{local_snapshot, posix_child, remote_snapshot, EntryKind};
use russh_sftp::{
    client::{error::Error as SftpError, RawSftpSession},
    protocol::{File, StatusCode},
};
use serde::Serialize;
use std::{
    collections::VecDeque,
    time::{Duration, Instant},
};

pub(super) const MAX_ENTRIES: u64 = 100_000;
pub(super) const MAX_DEPTH: u32 = 64;
pub(super) const MAX_PENDING_BYTES: usize = 1024 * 1024;
pub(super) const MAX_PENDING_FOLDERS: usize = 4096;
pub(super) const MAX_PATH_BYTES: usize = 32 * 1024;
pub(super) const TIME_LIMIT: Duration = Duration::from_secs(30);

#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    /// Decimal string: native u64 totals must not lose precision over JSON.
    pub bytes: String,
    pub entries: u64,
    pub files: u64,
    pub folders: u64,
    pub skipped: u64,
    pub errors: u64,
    pub elapsed_ms: u64,
    pub complete: bool,
    pub reason: String,
}
pub enum Endpoint {
    Local,
    Remote(RawSftpSession),
}
enum Cursor {
    Local(tokio::fs::ReadDir),
    Remote {
        handle: String,
        batch: std::vec::IntoIter<File>,
    },
}
struct Entry {
    path: String,
    kind: EntryKind,
    size: Option<u64>,
}

impl Endpoint {
    async fn root_is_directory(&self, path: &str) -> Result<bool, String> {
        match self {
            Self::Local => {
                let metadata = tokio::fs::symlink_metadata(path)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(local_kind(&metadata) == EntryKind::Directory)
            }
            Self::Remote(raw) => Ok(remote_snapshot(
                &raw.lstat(path).await.map_err(|e| e.to_string())?.attrs,
            )
            .kind
                == EntryKind::Directory),
        }
    }
    async fn open(&self, path: &str) -> Result<Cursor, String> {
        match self {
            Self::Local => tokio::fs::read_dir(path)
                .await
                .map(Cursor::Local)
                .map_err(|e| e.to_string()),
            Self::Remote(raw) => raw
                .opendir(path)
                .await
                .map(|handle| Cursor::Remote {
                    handle: handle.handle,
                    batch: Vec::new().into_iter(),
                })
                .map_err(|e| e.to_string()),
        }
    }
    /// Entry failures consume one item; cursor failures stop this directory.
    async fn next(
        &self,
        path: &str,
        cursor: &mut Cursor,
    ) -> Result<Option<Result<Entry, String>>, String> {
        match (self, cursor) {
            (Self::Local, Cursor::Local(dir)) => {
                let Some(entry) = dir.next_entry().await.map_err(|e| e.to_string())? else {
                    return Ok(None);
                };
                let path = entry
                    .path()
                    .into_os_string()
                    .into_string()
                    .map_err(|_| "Non-Unicode folder entry".to_string());
                let path = match path {
                    Ok(path) => path,
                    Err(error) => return Ok(Some(Err(error))),
                };
                let meta = match tokio::fs::symlink_metadata(&path).await {
                    Ok(meta) => meta,
                    Err(error) => return Ok(Some(Err(error.to_string()))),
                };
                Ok(Some(Ok(Entry {
                    path,
                    kind: local_kind(&meta),
                    size: Some(meta.len()),
                })))
            }
            (Self::Remote(raw), Cursor::Remote { handle, batch }) => loop {
                if let Some(entry) = batch.next() {
                    if entry.filename == "." || entry.filename == ".." {
                        continue;
                    }
                    // Reuse the transfer adapter's POSIX leaf validation, not local Path::join.
                    let child = match posix_child(path, &entry.filename) {
                        Ok(child) => child,
                        Err(error) => return Ok(Some(Err(error))),
                    };
                    if child.len() > MAX_PATH_BYTES {
                        return Ok(Some(Err(
                            "Folder entry exceeds the path-length safety limit".into(),
                        )));
                    }
                    let attrs = if entry.attrs.permissions.is_some()
                        && (!entry.attrs.file_type().is_file() || entry.attrs.size.is_some())
                    {
                        entry.attrs
                    } else {
                        match raw.lstat(&child).await {
                            Ok(meta) => meta.attrs,
                            Err(error) => return Ok(Some(Err(error.to_string()))),
                        }
                    };
                    if attrs.permissions.is_none() {
                        return Ok(Some(Err("Server did not report entry type".into())));
                    }
                    return Ok(Some(Ok(Entry {
                        path: child,
                        kind: remote_snapshot(&attrs).kind,
                        size: attrs.size,
                    })));
                }
                match raw.readdir(handle.clone()).await {
                    Ok(names) if names.files.is_empty() => {
                        return Err("Server returned an empty directory page".into())
                    }
                    Ok(names) => *batch = names.files.into_iter(),
                    Err(SftpError::Status(status)) if status.status_code == StatusCode::Eof => {
                        return Ok(None)
                    }
                    Err(error) => return Err(error.to_string()),
                }
            },
            _ => Err("Mismatched folder-size cursor".into()),
        }
    }
    async fn close(&self, cursor: Cursor) -> Result<(), String> {
        if let (Self::Remote(raw), Cursor::Remote { handle, .. }) = (self, cursor) {
            raw.close(handle).await.map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

fn local_kind(meta: &std::fs::Metadata) -> EntryKind {
    // Junctions and other reparse points are not ordinary directories to recurse into.
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return EntryKind::Symlink;
        }
    }
    local_snapshot(meta).kind
}

/// Limits bound retained work, not filesystem latency or snapshot consistency.
/// Links/special files are skipped; hard links count per directory entry. Mounts
/// are traversed within the same budgets. No content/hash/disk-allocation reads.
pub async fn calculate(endpoint: &Endpoint, root: &str) -> Report {
    calculate_with_time(endpoint, root, TIME_LIMIT).await
}

pub(super) async fn calculate_with_time(endpoint: &Endpoint, root: &str, time: Duration) -> Report {
    let start = Instant::now();
    let mut report = Report::default();
    let mut bytes = 0u64;
    let outcome = tokio::time::timeout(time, walk(endpoint, root, &mut report, &mut bytes))
        .await
        .unwrap_or_else(|_| Err(format!("Time limit reached ({} seconds)", time.as_secs())));
    report.bytes = bytes.to_string();
    report.elapsed_ms = start.elapsed().as_millis().min(u64::MAX as u128) as u64;
    report.complete = outcome.is_ok() && report.errors == 0;
    report.reason = match outcome {
        Err(reason) => reason,
        Ok(()) if report.errors > 0 => {
            "Some entries were inaccessible, changed or had unavailable metadata".into()
        }
        Ok(()) => "Traversal finished".into(),
    };
    report
}

async fn walk(
    endpoint: &Endpoint,
    root: &str,
    report: &mut Report,
    bytes: &mut u64,
) -> Result<(), String> {
    if !endpoint.root_is_directory(root).await? {
        return Err("The selected item is no longer an ordinary folder".into());
    }
    let mut pending = VecDeque::with_capacity(MAX_PENDING_FOLDERS);
    let root = root.to_owned();
    let mut pending_bytes = root.capacity();
    pending.push_back((root, 0u32));
    while let Some((path, depth)) = pending.pop_front() {
        pending_bytes -= path.capacity();
        let mut cursor = match endpoint.open(&path).await {
            Ok(cursor) => cursor,
            Err(_) => {
                report.errors += 1;
                continue;
            }
        };
        let result: Result<(), String> = async {
            loop {
                if report.entries >= MAX_ENTRIES {
                    return Err("Entry limit reached (100,000)".into());
                }
                let entry = match endpoint.next(&path, &mut cursor).await {
                    Ok(Some(entry)) => entry,
                    Ok(None) => break,
                    Err(_) => {
                        report.errors += 1;
                        break;
                    }
                };
                report.entries += 1;
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(_) => {
                        report.errors += 1;
                        continue;
                    }
                };
                if entry.path.len() > MAX_PATH_BYTES {
                    return Err("Path-length safety limit reached".into());
                }
                match entry.kind {
                    EntryKind::File => {
                        report.files += 1;
                        if let Some(size) = entry.size {
                            *bytes = bytes.checked_add(size).ok_or("Byte-total limit reached")?;
                        } else {
                            report.errors += 1;
                        }
                    }
                    EntryKind::Directory => {
                        report.folders += 1;
                        if depth >= MAX_DEPTH {
                            return Err("Depth limit reached (64)".into());
                        }
                        if pending.len() >= MAX_PENDING_FOLDERS {
                            return Err("Pending-folder limit reached (4,096)".into());
                        }
                        if pending_bytes + entry.path.capacity() > MAX_PENDING_BYTES {
                            return Err(
                                "Pending-folder memory limit reached (1 MiB of paths)".into()
                            );
                        }
                        pending_bytes += entry.path.capacity();
                        pending.push_back((entry.path, depth + 1));
                    }
                    EntryKind::Symlink | EntryKind::Other => report.skipped += 1,
                }
                if report.entries % 128 == 0 {
                    tokio::task::yield_now().await;
                }
            }
            Ok(())
        }
        .await;
        let closed = endpoint.close(cursor).await;
        result?;
        if closed.is_err() {
            return Err("Could not close the folder-size directory handle".into());
        }
    }
    Ok(())
}
