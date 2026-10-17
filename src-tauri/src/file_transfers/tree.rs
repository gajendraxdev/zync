//! Bounded tree inventories for staged folder copies. Only compact metadata
//! fingerprints enter the existing journal; file contents use the shared stream.

use super::{
    endpoint::{EntryKind, FileEndpoint, Snapshot},
    Receipt, Service, StageCopy,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::{atomic::AtomicBool, Arc};

pub(super) const MAX_ENTRIES: usize = 100_000;
const MAX_PATH_BYTES: usize = 8 * 1024 * 1024;
const MAX_DEPTH: usize = 128;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Fingerprint {
    pub digest: String,
    pub entries: usize,
    pub bytes: u64,
}

impl Fingerprint {
    pub(super) fn valid(&self) -> bool {
        self.entries > 0
            && self.entries <= MAX_ENTRIES
            && self.digest.len() == 64
            && self.digest.bytes().all(|byte| byte.is_ascii_hexdigit())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct Entry {
    relative: String,
    snapshot: Snapshot,
    link: Option<String>,
}

pub(super) struct Inventory {
    entries: Vec<Entry>,
    pub fingerprint: Fingerprint,
}

/// Join validated relative components through the destination's platform policy.
fn at(endpoint: &dyn FileEndpoint, root: &str, relative: &str) -> Result<String, String> {
    relative
        .split('/')
        .filter(|part| !part.is_empty())
        .try_fold(root.to_owned(), |path, leaf| endpoint.child(&path, leaf))
}

impl Inventory {
    /// Validate destination names/case aliases before creating a temporary tree.
    pub fn validate_destination(
        &self,
        endpoint: &dyn FileEndpoint,
        root: &str,
    ) -> Result<(), String> {
        let mut names = std::collections::HashSet::new();
        for entry in &self.entries {
            let path = at(endpoint, root, &entry.relative)?;
            if !names.insert(endpoint.collision_key(&path, "")) {
                return Err("Folder names collide on the destination filesystem".into());
            }
        }
        Ok(())
    }
    /// Bounded metadata only, never follow links or open special files. This is
    /// a change detector, not a filesystem snapshot or a content checksum.
    pub async fn capture(
        endpoint: &dyn FileEndpoint,
        root: &str,
        token: &Arc<AtomicBool>,
    ) -> Result<Self, String> {
        let mut entries = Vec::new();
        let mut pending = vec![(String::new(), 0, None)];
        let mut path_bytes = 0usize;
        let mut bytes = 0u64;
        while let Some((relative, depth, listed)) = pending.pop() {
            crate::transfers::check_cancelled(token)?;
            let path = at(endpoint, root, &relative)?;
            let snapshot = match listed {
                Some(snapshot) => snapshot,
                None => endpoint
                    .stat(&path)
                    .await?
                    .ok_or_else(|| format!("Folder entry disappeared: {path}"))?,
            };
            let link = match snapshot.kind {
                EntryKind::Directory => {
                    if depth >= MAX_DEPTH {
                        return Err("Folder nesting limit exceeded".into());
                    }
                    let names = endpoint.children(&path).await?;
                    if entries.len() + pending.len() + names.len() + 1 > MAX_ENTRIES {
                        return Err("Folder entry limit exceeded".into());
                    }
                    for (name, snapshot) in names.into_iter().rev() {
                        endpoint.child(&path, &name)?;
                        let child = if relative.is_empty() {
                            name
                        } else {
                            format!("{relative}/{name}")
                        };
                        path_bytes = path_bytes
                            .checked_add(child.len())
                            .ok_or("Folder path budget exceeded")?;
                        if path_bytes > MAX_PATH_BYTES {
                            return Err("Folder path budget exceeded".into());
                        }
                        pending.push((child, depth + 1, snapshot));
                    }
                    None
                }
                EntryKind::File => {
                    bytes = bytes
                        .checked_add(snapshot.size)
                        .ok_or("Folder size exceeds transfer limits")?;
                    None
                }
                EntryKind::Symlink => {
                    let target = endpoint.read_link(&path).await?;
                    if target.len() > 4096 || target.contains('\0') {
                        return Err("Invalid symbolic link target".into());
                    }
                    path_bytes += target.len();
                    if path_bytes > MAX_PATH_BYTES {
                        return Err("Folder path budget exceeded".into());
                    }
                    Some(target)
                }
                EntryKind::Other => {
                    return Err(format!(
                        "Folder contains an unsupported special entry: {path}"
                    ))
                }
            };
            entries.push(Entry {
                relative,
                snapshot,
                link,
            });
        }
        entries.sort_by(|a, b| a.relative.cmp(&b.relative));
        let mut digest = Sha256::new();
        for entry in &entries {
            let encoded = serde_json::to_vec(entry).map_err(|e| e.to_string())?;
            digest.update((encoded.len() as u64).to_le_bytes());
            digest.update(encoded);
        }
        let digest = digest
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        Ok(Self {
            fingerprint: Fingerprint {
                digest,
                entries: entries.len(),
                bytes,
            },
            entries,
        })
    }

    /// Directories change their own mtime while we add children. All leaf
    /// snapshots and link targets must still match acknowledged creations.
    fn matches_owned(&self, owned: &[Entry]) -> bool {
        self.entries.len() == owned.len()
            && self.entries.iter().zip(owned).all(|(current, expected)| {
                current.relative == expected.relative
                    && current.snapshot.kind == expected.snapshot.kind
                    && (current.snapshot.kind == EntryKind::Directory || current == expected)
            })
    }
}

/// Verify the complete recorded tree before removing any entry, then unlink
/// leaves and empty directories only. No recursive delete primitive follows links.
pub(super) async fn remove_verified_tree(
    endpoint: &dyn FileEndpoint,
    root: &str,
    expected: &Fingerprint,
) -> Result<(), String> {
    let current = Inventory::capture(endpoint, root, &Arc::new(AtomicBool::new(false))).await?;
    if &current.fingerprint != expected {
        return Err("Folder contents changed; cleanup was refused".into());
    }
    for entry in current.entries.iter().rev() {
        let path = at(endpoint, root, &entry.relative)?;
        let snapshot = endpoint
            .stat(&path)
            .await?
            .ok_or("Cleanup entry disappeared")?;
        if snapshot.kind == EntryKind::Directory && entry.snapshot.kind == EntryKind::Directory {
            // rmdir refuses unexpected newly added children.
            endpoint.remove_directory(&path).await?;
        } else {
            if snapshot != entry.snapshot
                || entry.link.is_some()
                    && endpoint.read_link(&path).await?.as_str() != entry.link.as_deref().unwrap()
            {
                return Err("Folder entry changed during cleanup; it was retained".into());
            }
            endpoint.remove(&path).await?;
        }
    }
    Ok(())
}

impl Service {
    /// One folder job owns the existing admission, receipt and destination lease.
    /// Nested files reuse the bounded stream/close protocol, not nested jobs.
    pub(super) async fn write_tree(
        &self,
        receipt: &mut Receipt,
        source: &dyn FileEndpoint,
        destination: &dyn FileEndpoint,
        plan: &Inventory,
        acceleration: Option<&dyn StageCopy>,
        token: &Arc<AtomicBool>,
        progress: &(impl Fn(u64, u64) + Send + Sync),
    ) -> Result<(), String> {
        let mut owned = Vec::new();
        let mut cleanup_safe = true;
        let copy = async {
            for entry in &plan.entries {
                crate::transfers::check_cancelled(token)?;
                let from = at(source, &receipt.source_path, &entry.relative)?;
                let to = at(destination, &receipt.stage_path, &entry.relative)?;
                if source.stat(&from).await?.as_ref() != Some(&entry.snapshot) {
                    return Err(
                        "Source folder changed during copying; replacement was not published"
                            .into(),
                    );
                }
                // Until create/close is acknowledged, a failed mutation could
                // still be writing. Do not infer cleanup authority from its error.
                cleanup_safe = false;
                match entry.snapshot.kind {
                    EntryKind::Directory => destination.create_directory(&to).await?,
                    EntryKind::Symlink => {
                        destination
                            .create_link(
                                &to,
                                entry.link.as_deref().ok_or("Missing link target")?,
                                source.link_is_directory(&from).await,
                            )
                            .await?
                    }
                    EntryKind::File => {
                        let (result, closed) = self
                            .copy_file_data(
                                receipt,
                                &from,
                                &to,
                                entry.snapshot.size,
                                source,
                                destination,
                                acceleration,
                                token,
                                progress,
                            )
                            .await;
                        cleanup_safe = closed;
                        if closed {
                            owned.push(Entry {
                                relative: entry.relative.clone(),
                                snapshot: destination
                                    .stat(&to)
                                    .await?
                                    .ok_or("Temporary file disappeared")?,
                                link: None,
                            });
                        }
                        result?;
                        let saved = owned.last().ok_or("Missing closed file")?;
                        if saved.snapshot.kind != EntryKind::File
                            || saved.snapshot.size != entry.snapshot.size
                        {
                            return Err("Temporary file size could not be verified".into());
                        }
                        destination
                            .set_mode(&to, entry.snapshot.mode.or(Some(0o644)))
                            .await?;
                        owned.last_mut().unwrap().snapshot = destination
                            .stat(&to)
                            .await?
                            .ok_or("Temporary file disappeared")?;
                        continue;
                    }
                    EntryKind::Other => return Err("Unsupported folder entry".into()),
                }
                owned.push(Entry {
                    relative: entry.relative.clone(),
                    snapshot: destination
                        .stat(&to)
                        .await?
                        .ok_or("Temporary entry disappeared")?,
                    link: entry.link.clone(),
                });
                cleanup_safe = true;
            }
            crate::transfers::check_cancelled(token)?;
            if Inventory::capture(source, &receipt.source_path, token)
                .await?
                .fingerprint
                != plan.fingerprint
            {
                return Err(
                    "Source folder changed during copying; replacement was not published".into(),
                );
            }
            // Apply directory modes last so restrictive source permissions cannot
            // prevent creation of their own children. Never copy setuid/setgid.
            for entry in plan
                .entries
                .iter()
                .rev()
                .filter(|entry| entry.snapshot.kind == EntryKind::Directory)
            {
                crate::transfers::check_cancelled(token)?;
                let mode = if entry.relative.is_empty() {
                    receipt
                        .original
                        .as_ref()
                        .and_then(|snapshot| snapshot.mode)
                        .or(entry.snapshot.mode)
                } else {
                    entry.snapshot.mode
                };
                destination
                    .set_mode(
                        &at(destination, &receipt.stage_path, &entry.relative)?,
                        mode.or(Some(0o755)),
                    )
                    .await?;
            }
            Ok(())
        }
        .await;
        if cleanup_safe && !owned.is_empty() {
            let record_closed_tree = async {
                // Inspection itself ignores cancellation once all writers are closed.
                let inventory = Inventory::capture(
                    destination,
                    &receipt.stage_path,
                    &Arc::new(AtomicBool::new(false)),
                )
                .await?;
                if !inventory.matches_owned(&owned) {
                    return Err("Temporary folder changed; it was retained for inspection".into());
                }
                receipt.staged = Some(inventory.entries[0].snapshot.clone());
                receipt.staged_tree = Some(inventory.fingerprint);
                self.journal.save(receipt).await?;
                Ok::<(), String>(())
            }
            .await;
            if let Err(error) = record_closed_tree {
                receipt.warning = Some(format!(
                    "Temporary folder could not be verified for cleanup: {error}"
                ));
                // Keep the original copy failure/cancellation rather than hide
                // it behind a later inspection or journal error.
                return copy.and(Err(error));
            }
        }
        if copy.as_ref().is_err_and(|error| error == "Cancelled") && cleanup_safe {
            // The service's terminal outcome boundary owns directory cleanup
            // exactly once, including cancellation during Ready verification.
            if owned.is_empty() && matches!(destination.stat(&receipt.stage_path).await, Ok(None)) {
                receipt.stage_cleaned = true;
            }
        }
        copy
    }
}
