//! Folder combination plans only incoming publications. Destination-only data is
//! never recopied; units borrow the existing admitted job and publication path.

use super::{
    endpoint::{EntryKind, FileEndpoint, Snapshot},
    tree::{at, collision_digest, Inventory},
    DestinationLease, FolderCopyMode, Phase, Receipt, Request, Service,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{atomic::AtomicBool, Arc},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub source_root: String,
    pub destination_root: String,
    pub completed_items: usize,
    pub total_items: usize,
    pub completed_bytes: u64,
    pub total_bytes: u64,
    /// Current unit publication was acknowledged; cleanup warnings still matter.
    pub current_done: bool,
    /// A completed unit alone does not complete its containing combine job.
    pub finished: bool,
}

impl Progress {
    pub(super) fn valid(&self) -> bool {
        self.completed_items <= self.total_items
            && self.total_items <= super::tree::MAX_ENTRIES
            && self.completed_bytes <= self.total_bytes
            && self.total_bytes <= 9_007_199_254_740_991 // exact integer transport to the webview
            && [&self.source_root, &self.destination_root]
                .iter()
                .all(|path| !path.is_empty() && path.len() <= 4096 && !path.contains('\0'))
    }
}

pub(super) struct UnitContext<'a> {
    pub scope: &'a DestinationLease,
    pub progress: Progress,
    pub original: Option<Snapshot>,
    pub bytes: u64,
}

struct Unit {
    source_relative: String,
    destination_relative: String,
    source: Snapshot,
    original: Option<Snapshot>,
    bytes: u64,
}

/// Combine traverses existing parents, unlike an exclusively created staging
/// tree. Repeat no-follow kind checks before listing or publishing beneath them.
async fn check_directories(
    endpoint: &dyn FileEndpoint,
    root: &str,
    relative: &str,
) -> Result<(), String> {
    let mut path = root.to_owned();
    for component in std::iter::once("").chain(relative.split('/').filter(|part| !part.is_empty()))
    {
        if !component.is_empty() {
            path = endpoint.child(&path, component)?;
        }
        if !endpoint
            .stat(&path)
            .await?
            .is_some_and(|entry| entry.kind == EntryKind::Directory)
        {
            return Err(format!(
                "Combine destination directory changed or became a link: {path}"
            ));
        }
    }
    Ok(())
}

/// Existing directories recurse; a missing subtree remains one complete staged
/// folder publication. Known type/link conflicts fail before any live mutation.
async fn plan(
    destination: &dyn FileEndpoint,
    destination_root: &str,
    incoming: &Inventory,
    token: &Arc<AtomicBool>,
) -> Result<Vec<Unit>, String> {
    incoming.validate_destination(destination, destination_root)?;
    let mut children: HashMap<&str, Vec<&super::tree::Entry>> = HashMap::new();
    let mut sizes: HashMap<&str, u64> = HashMap::new();
    for entry in incoming
        .entries
        .iter()
        .rev()
        .filter(|entry| !entry.relative.is_empty())
    {
        let parent = entry
            .relative
            .rsplit_once('/')
            .map_or("", |(parent, _)| parent);
        let bytes = if entry.snapshot.kind == EntryKind::File {
            entry.snapshot.size
        } else {
            sizes.get(entry.relative.as_str()).copied().unwrap_or(0)
        };
        *sizes.entry(parent).or_default() += bytes;
    }
    for entry in incoming
        .entries
        .iter()
        .filter(|entry| !entry.relative.is_empty())
    {
        let parent = entry
            .relative
            .rsplit_once('/')
            .map_or("", |(parent, _)| parent);
        children.entry(parent).or_default().push(entry);
    }
    let mut pending = vec![(String::new(), String::new())];
    let mut units = Vec::new();
    while let Some((source_relative, target_relative)) = pending.pop() {
        crate::transfers::check_cancelled(token)?;
        let Some(incoming_children) = children.get(source_relative.as_str()) else {
            continue;
        };
        check_directories(destination, destination_root, &target_relative).await?;
        let target_parent = at(destination, destination_root, &target_relative)?;
        let wanted: std::collections::HashSet<_> = incoming_children
            .iter()
            .map(|entry| {
                collision_digest(
                    destination,
                    &target_parent,
                    entry.relative.rsplit('/').next().unwrap(),
                )
            })
            .collect();
        let mut targets = HashMap::new();
        // List only common directories. Do not traverse an unrelated destination
        // subtree, stat its contents, or retain its names in the plan.
        for (name, snapshot) in destination.children(&target_parent).await? {
            crate::transfers::check_cancelled(token)?;
            let key = collision_digest(destination, &target_parent, &name);
            if !wanted.contains(&key) {
                continue;
            }
            destination.child(&target_parent, &name)?;
            if targets.insert(key, (name, snapshot)).is_some() {
                return Err(
                    "Destination names are ambiguous for this combine; destination unchanged"
                        .into(),
                );
            }
        }
        for entry in incoming_children {
            crate::transfers::check_cancelled(token)?;
            let leaf = entry.relative.rsplit('/').next().unwrap();
            let found = targets.remove(&collision_digest(destination, &target_parent, leaf));
            let (leaf, listed) = found.map_or_else(|| (leaf.to_owned(), None), |found| found);
            let target = if target_relative.is_empty() {
                leaf
            } else {
                format!("{target_relative}/{leaf}")
            };
            let path = at(destination, destination_root, &target)?;
            let original = match listed {
                Some(snapshot) => Some(snapshot),
                None => destination.stat(&path).await?,
            };
            if original
                .as_ref()
                .is_some_and(|old| old.kind != entry.snapshot.kind)
            {
                return Err(format!(
                    "Cannot combine incompatible entry types at {path}; destination unchanged"
                ));
            }
            if entry.snapshot.kind == EntryKind::Directory && original.is_some() {
                pending.push((entry.relative.clone(), target));
                continue;
            }
            if !matches!(entry.snapshot.kind, EntryKind::File | EntryKind::Directory) {
                return Err(format!("Cannot combine a symbolic-link entry at {path}; use Keep Both or Replace folder instead"));
            }
            units.push(Unit {
                source_relative: entry.relative.clone(),
                destination_relative: target,
                source: entry.snapshot.clone(),
                original,
                bytes: if entry.snapshot.kind == EntryKind::File {
                    entry.snapshot.size
                } else {
                    sizes.get(entry.relative.as_str()).copied().unwrap_or(0)
                },
            });
        }
    }
    // Keep deterministic publication order without assuming a directory and all
    // descendants are contiguous in lexical order (a, a.txt, a/child).
    units.sort_by(|a, b| a.source_relative.cmp(&b.source_relative));
    Ok(units)
}

impl Service {
    /// One native owner, root lease and journal cursor. Publication is per unit:
    /// cancellation stops remaining work, not an undo of completed publications.
    pub(super) async fn combine_folders(
        &self,
        request: Request,
        source: Arc<dyn FileEndpoint>,
        destination: Arc<dyn FileEndpoint>,
        token: Arc<AtomicBool>,
        progress: impl Fn(u64, u64) + Send + Sync,
    ) -> Result<Receipt, String> {
        let (source_stat, _, key, original) = self
            .prepare_paths(&request, source.as_ref(), destination.as_ref())
            .await?;
        if !request.overwrite
            || source_stat.kind != EntryKind::Directory
            || !original
                .as_ref()
                .is_some_and(|item| item.kind == EntryKind::Directory)
        {
            return Err(
                "Combine folders requires two existing folders and an explicit collision choice"
                    .into(),
            );
        }
        let scope = self.reserve_destination(key.clone())?;
        self.check_journal_destination(&request.id, &key, false)
            .await?;
        let incoming = Inventory::capture(source.as_ref(), &request.source_path, &token).await?;
        let units = plan(
            destination.as_ref(),
            &request.destination_path,
            &incoming,
            &token,
        )
        .await?;
        let job = Progress {
            source_root: request.source_path.clone(),
            destination_root: request.destination_path.clone(),
            completed_items: 0,
            total_items: units.len(),
            completed_bytes: 0,
            total_bytes: incoming.fingerprint.bytes,
            current_done: true,
            finished: false,
        };
        let mut cursor = Self::prepare_receipt(
            &request,
            destination.as_ref(),
            key,
            original,
            None,
            0,
            false,
        )?;
        cursor.backup_expected = false;
        cursor.combine = Some(job.clone());
        cursor.validate()?;
        self.journal.save(&cursor).await?;
        if let Some(started) = &self.started {
            started(&cursor);
        }
        progress(0, job.total_bytes);
        let last_emit = std::sync::Mutex::new(std::time::Instant::now());

        let result = async {
            for unit in units {
                crate::transfers::check_cancelled(&token)?;
                let parent = unit
                    .destination_relative
                    .rsplit_once('/')
                    .map_or("", |(parent, _)| parent);
                check_directories(destination.as_ref(), &request.destination_path, parent).await?;
                let source_path = at(source.as_ref(), &request.source_path, &unit.source_relative)?;
                let destination_path = at(
                    destination.as_ref(),
                    &request.destination_path,
                    &unit.destination_relative,
                )?;
                if source.stat(&source_path).await?.as_ref() != Some(&unit.source) {
                    return Err(format!("Source changed before combining {}", source_path));
                }
                let mut job = cursor
                    .combine
                    .as_ref()
                    .ok_or("Combine cursor missing")?
                    .clone();
                job.current_done = false;
                let offset = job.completed_bytes;
                let total = job.total_bytes;
                let next = Request {
                    id: request.id.clone(),
                    source_connection_id: request.source_connection_id.clone(),
                    source_identity: request.source_identity.clone(),
                    source_path,
                    destination_connection_id: request.destination_connection_id.clone(),
                    destination_identity: request.destination_identity.clone(),
                    destination_path,
                    overwrite: unit.original.is_some(),
                    folder_mode: FolderCopyMode::Replace,
                    stage_copy: request.stage_copy.clone(),
                };
                cursor = self
                    .execute_copy(
                        next,
                        source.clone(),
                        destination.clone(),
                        token.clone(),
                        |done, _| {
                            let emit = last_emit.lock().is_ok_and(|mut last| {
                                super::progress_due(&mut last, std::time::Instant::now())
                            });
                            if emit {
                                progress(offset.saturating_add(done), total);
                            }
                        },
                        Some(UnitContext {
                            scope: &scope,
                            progress: job,
                            original: unit.original,
                            bytes: unit.bytes,
                        }),
                    )
                    .await?;
                if cursor.phase != Phase::Completed || cursor.warning.is_some() {
                    return Err(cursor.error.clone().unwrap_or_else(|| {
                        "Combine stopped because the current item requires recovery inspection"
                            .into()
                    }));
                }
            }
            // Each unit already verified its source through the shared copy
            // path. Do not repeat an uncancellable whole-tree scan after all
            // publications; a late cancel is not an undo of completed items.
            Ok(())
        }
        .await;
        let job = cursor.combine.as_mut().ok_or("Combine cursor missing")?;
        job.finished = true;
        match result {
            Ok(()) => cursor.phase = Phase::Completed,
            Err(error) => {
                // A unit's uncertain publication/recovery evidence takes priority.
                if cursor.phase == Phase::Completed
                    || job.current_done
                    || cursor.phase == Phase::Prepared
                {
                    cursor.phase = if error == "Cancelled" {
                        Phase::Cancelled
                    } else {
                        Phase::Failed
                    };
                }
                cursor.error = Some(error.chars().take(2048).collect());
            }
        }
        if let Err(error) = self.journal.save(&cursor).await {
            cursor.warning = Some(format!("Combine recovery cursor could not be saved: {error}. Inspect the current paths before retrying."));
        }
        let job = cursor.combine.as_ref().unwrap();
        progress(
            job.completed_bytes.saturating_add(if job.current_done {
                0
            } else {
                cursor.transferred
            }),
            job.total_bytes,
        );
        Ok(cursor)
    }
}
