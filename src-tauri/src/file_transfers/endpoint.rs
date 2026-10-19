//! Ordinary-account local/SFTP adapters. Path checks are preconditions, not a
//! confinement boundary against another process replacing directory entries.

use async_trait::async_trait;
use russh_sftp::{
    client::SftpSession,
    protocol::{FileAttributes, OpenFlags, StatusCode},
};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Arc};
use tokio::io::{AsyncRead, AsyncWriteExt};

pub type Reader = Box<dyn AsyncRead + Unpin + Send>;

fn validate_leaf(leaf: &str) -> Result<(), String> {
    if leaf.is_empty() || leaf == "." || leaf == ".." || leaf.contains('/') || leaf.contains('\0') {
        return Err("Invalid folder entry name".into());
    }
    Ok(())
}

/// Join a remote POSIX leaf without interpreting it as a Windows path.
pub(crate) fn posix_child(parent: &str, leaf: &str) -> Result<String, String> {
    validate_leaf(leaf)?;
    Ok(format!("{}/{leaf}", parent.trim_end_matches('/')))
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub kind: EntryKind,
    pub size: u64,
    pub modified: Option<u128>,
    pub mode: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum EntryKind {
    File,
    Directory,
    Symlink,
    Other,
}

#[async_trait]
pub trait StageWriter: Send {
    async fn write(&mut self, bytes: &[u8]) -> Result<(), String>;
    /// Close acknowledgement is mandatory; it is not a remote fsync guarantee.
    async fn finish(&mut self) -> Result<(), String>;
}

#[async_trait]
pub trait FileEndpoint: Send + Sync {
    async fn stat(&self, path: &str) -> Result<Option<Snapshot>, String>;
    async fn canonicalize(&self, path: &str) -> Result<String, String>;
    async fn reader(&self, path: &str) -> Result<Reader, String>;
    async fn create_stage(&self, path: &str) -> Result<Box<dyn StageWriter>, String>;
    async fn set_mode(&self, path: &str, mode: Option<u32>) -> Result<(), String>;
    /// Fail before publication intent if the destination cannot support no-clobber publication.
    async fn prepare_publish(&self, _target: &str, _overwrite: bool) -> Result<(), String> {
        Ok(())
    }
    /// Called only after rechecking the target. Local replacement uses platform
    /// primitives; SFTP replacement is explicitly a non-atomic two-rename fallback.
    async fn publish(&self, stage: &str, target: &str, overwrite: bool) -> Result<(), String>;
    async fn rename_absent(&self, from: &str, to: &str) -> Result<(), String>;
    async fn remove(&self, path: &str) -> Result<(), String>;
    /// Directory operations default to unsupported for file-only adapters.
    async fn children(&self, _path: &str) -> Result<Vec<(String, Option<Snapshot>)>, String> {
        Err("This endpoint does not support folder transfers".into())
    }
    async fn create_directory(&self, _path: &str) -> Result<(), String> {
        Err("This endpoint does not support folder transfers".into())
    }
    async fn remove_directory(&self, _path: &str) -> Result<(), String> {
        Err("This endpoint does not support folder cleanup".into())
    }
    async fn read_link(&self, _path: &str) -> Result<String, String> {
        Err("This endpoint does not support symbolic links".into())
    }
    async fn link_is_directory(&self, _path: &str) -> bool {
        false
    }
    async fn create_link(
        &self,
        _path: &str,
        _target: &str,
        _directory: bool,
    ) -> Result<(), String> {
        Err("This endpoint does not support symbolic links".into())
    }
    async fn prepare_directory_publish(&self, _target: &str) -> Result<(), String> {
        Ok(())
    }
    /// Validate one leaf without interpreting remote POSIX names as local paths.
    fn child(&self, parent: &str, leaf: &str) -> Result<String, String> {
        posix_child(parent, leaf)
    }
    fn requires_backup(&self) -> bool;
    fn sibling(&self, target: &str, name: &str) -> Result<String, String>;
    fn filename(&self, target: &str) -> Result<String, String>;
    fn reservation_key(&self, parent: &str, leaf: &str) -> String {
        format!("{parent}/{leaf}")
    }
    /// Preflight name equivalence only; never persist this as destination identity.
    /// Endpoints without a separate collision policy retain their reservation key.
    fn collision_key(&self, parent: &str, leaf: &str) -> String {
        self.reservation_key(parent, leaf)
    }
}

pub enum Endpoint {
    Local,
    Remote(Arc<SftpSession>),
}

enum Writer {
    Local(tokio::fs::File),
    Remote(russh_sftp::client::fs::File),
}

#[async_trait]
impl StageWriter for Writer {
    async fn write(&mut self, bytes: &[u8]) -> Result<(), String> {
        match self {
            Self::Local(file) => file.write_all(bytes).await,
            Self::Remote(file) => file.write_all(bytes).await,
        }
        .map_err(|e| format!("Destination write failed (space, quota or connection): {e}"))
    }

    async fn finish(&mut self) -> Result<(), String> {
        match self {
            Self::Local(file) => {
                file.flush().await.map_err(|e| e.to_string())?;
                file.sync_all()
                    .await
                    .map_err(|e| format!("Destination flush failed: {e}"))?;
                file.shutdown().await
            }
            Self::Remote(file) => file.shutdown().await,
        }
        .map_err(|e| format!("Destination close was not confirmed: {e}"))
    }
}

#[async_trait]
impl FileEndpoint for Endpoint {
    async fn stat(&self, path: &str) -> Result<Option<Snapshot>, String> {
        match self {
            Self::Local => match tokio::fs::symlink_metadata(path).await {
                Ok(metadata) => Ok(Some(local_snapshot(&metadata))),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(e) => Err(format!("Could not inspect {path}: {e}")),
            },
            Self::Remote(sftp) => match sftp.symlink_metadata(path).await {
                Ok(metadata) => Ok(Some(remote_snapshot(&metadata))),
                Err(russh_sftp::client::error::Error::Status(status))
                    if status.status_code == StatusCode::NoSuchFile =>
                {
                    Ok(None)
                }
                Err(e) => Err(format!("Could not inspect {path}: {e}")),
            },
        }
    }

    async fn canonicalize(&self, path: &str) -> Result<String, String> {
        match self {
            Self::Local => tokio::fs::canonicalize(path)
                .await
                .map(|p| p.to_string_lossy().into_owned())
                .map_err(|e| e.to_string()),
            Self::Remote(sftp) => sftp.canonicalize(path).await.map_err(|e| e.to_string()),
        }
    }

    async fn reader(&self, path: &str) -> Result<Reader, String> {
        match self {
            Self::Local => Ok(Box::new(
                tokio::fs::File::open(path)
                    .await
                    .map_err(|e| e.to_string())?,
            )),
            Self::Remote(sftp) => Ok(Box::new(sftp.open(path).await.map_err(|e| e.to_string())?)),
        }
    }

    async fn create_stage(&self, path: &str) -> Result<Box<dyn StageWriter>, String> {
        match self {
            Self::Local => {
                let mut options = tokio::fs::OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                options.mode(0o600);
                Ok(Box::new(Writer::Local(options.open(path).await.map_err(
                    |e| format!("Could not create staging file: {e}"),
                )?)))
            }
            Self::Remote(sftp) => {
                let mut attributes = FileAttributes::empty();
                attributes.permissions = Some(0o600);
                Ok(Box::new(Writer::Remote(
                    sftp.open_with_flags_and_attributes(
                        path,
                        OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::EXCLUDE,
                        attributes,
                    )
                    .await
                    .map_err(|e| format!("Could not exclusively create staging file: {e}"))?,
                )))
            }
        }
    }

    async fn set_mode(&self, path: &str, mode: Option<u32>) -> Result<(), String> {
        // Do not copy setuid/setgid bits onto newly created content.
        let Some(mode) = mode.map(|value| value & 0o777) else {
            return Ok(());
        };
        match self {
            Self::Local => {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
                        .await
                        .map_err(|e| e.to_string())?;
                }
                Ok(())
            }
            Self::Remote(sftp) => {
                let mut attributes = FileAttributes::empty();
                attributes.permissions = Some(mode);
                sftp.set_metadata(path, attributes)
                    .await
                    .map_err(|e| e.to_string())
            }
        }
    }

    async fn prepare_publish(&self, target: &str, overwrite: bool) -> Result<(), String> {
        #[cfg(not(windows))]
        if matches!(self, Self::Local) && !overwrite {
            let target = target.to_owned();
            return tokio::task::spawn_blocking(move || prepare_local_publication(&target))
                .await
                .map_err(|error| error.to_string())?;
        }
        let _ = (target, overwrite);
        Ok(())
    }

    async fn publish(&self, stage: &str, target: &str, overwrite: bool) -> Result<(), String> {
        match self {
            Self::Remote(sftp) => sftp
                .rename(stage, target)
                .await
                .map_err(|e| format!("Publish acknowledgement uncertain: {e}")),
            Self::Local => {
                let stage = stage.to_owned();
                let target = target.to_owned();
                tokio::task::spawn_blocking(move || publish_local(&stage, &target, overwrite))
                    .await
                    .map_err(|e| e.to_string())?
            }
        }
    }

    async fn rename_absent(&self, from: &str, to: &str) -> Result<(), String> {
        if self.stat(to).await?.is_some() {
            return Err("Recovery backup path already exists".into());
        }
        self.publish(from, to, false).await
    }

    async fn remove(&self, path: &str) -> Result<(), String> {
        match self {
            Self::Local => {
                #[cfg(windows)]
                {
                    use std::os::windows::fs::FileTypeExt;
                    if tokio::fs::symlink_metadata(path)
                        .await
                        .map_err(|e| e.to_string())?
                        .file_type()
                        .is_symlink_dir()
                    {
                        // Unlink the directory link itself; never its target.
                        return tokio::fs::remove_dir(path).await.map_err(|e| e.to_string());
                    }
                }
                tokio::fs::remove_file(path)
                    .await
                    .map_err(|e| e.to_string())
            }
            Self::Remote(sftp) => sftp.remove_file(path).await.map_err(|e| e.to_string()),
        }
    }

    async fn children(&self, path: &str) -> Result<Vec<(String, Option<Snapshot>)>, String> {
        let mut names = Vec::new();
        match self {
            Self::Local => {
                let mut directory = tokio::fs::read_dir(path).await.map_err(|e| e.to_string())?;
                while let Some(entry) = directory.next_entry().await.map_err(|e| e.to_string())? {
                    names.push((
                        entry
                            .file_name()
                            .into_string()
                            .map_err(|_| "Folder contains a non-UTF-8 name")?,
                        None,
                    ));
                    if names.len() > super::tree::MAX_ENTRIES {
                        return Err("Folder entry limit exceeded".into());
                    }
                }
            }
            Self::Remote(sftp) => {
                // russh-sftp materializes one directory response. Do not retain
                // unbounded directory lists across the tree or open parallel walks.
                for entry in sftp.read_dir(path).await.map_err(|e| e.to_string())? {
                    let name = entry.file_name();
                    if name == "." || name == ".." {
                        continue;
                    }
                    let metadata = entry.metadata();
                    // Reuse complete READDIR attributes instead of an extra
                    // network LSTAT for every entry on every verification walk.
                    let snapshot = if metadata.permissions.is_some()
                        && metadata.mtime.is_some()
                        && metadata.size.is_some()
                    {
                        Some(remote_snapshot(&metadata))
                    } else {
                        None
                    };
                    names.push((name, snapshot));
                    if names.len() > super::tree::MAX_ENTRIES {
                        return Err("Folder entry limit exceeded".into());
                    }
                }
            }
        }
        names.sort_by(|a, b| a.0.cmp(&b.0));
        if names.windows(2).any(|pair| pair[0].0 == pair[1].0) {
            return Err("Duplicate folder entry name".into());
        }
        Ok(names)
    }

    async fn create_directory(&self, path: &str) -> Result<(), String> {
        match self {
            Self::Local => {
                #[allow(unused_mut)]
                let mut builder = tokio::fs::DirBuilder::new();
                #[cfg(unix)]
                builder.mode(0o700);
                builder.create(path).await.map_err(|e| e.to_string())
            }
            Self::Remote(sftp) => {
                sftp.create_dir(path).await.map_err(|e| e.to_string())?;
                self.set_mode(path, Some(0o700)).await
            }
        }
    }

    async fn remove_directory(&self, path: &str) -> Result<(), String> {
        match self {
            Self::Local => tokio::fs::remove_dir(path).await.map_err(|e| e.to_string()),
            Self::Remote(sftp) => sftp.remove_dir(path).await.map_err(|e| e.to_string()),
        }
    }

    async fn read_link(&self, path: &str) -> Result<String, String> {
        match self {
            Self::Local => tokio::fs::read_link(path)
                .await
                .map_err(|e| e.to_string())?
                .into_os_string()
                .into_string()
                .map_err(|_| "Non-UTF-8 symbolic link target".into()),
            Self::Remote(sftp) => sftp.read_link(path).await.map_err(|e| e.to_string()),
        }
    }

    async fn link_is_directory(&self, path: &str) -> bool {
        match self {
            Self::Local => {
                #[cfg(windows)]
                {
                    use std::os::windows::fs::FileTypeExt;
                    // Preserve Windows directory-link type even if dangling.
                    tokio::fs::symlink_metadata(path)
                        .await
                        .is_ok_and(|entry| entry.file_type().is_symlink_dir())
                }
                #[cfg(not(windows))]
                {
                    tokio::fs::metadata(path)
                        .await
                        .is_ok_and(|entry| entry.is_dir())
                }
            }
            Self::Remote(sftp) => sftp
                .metadata(path)
                .await
                .is_ok_and(|entry| entry.file_type().is_dir()),
        }
    }

    async fn create_link(&self, path: &str, target: &str, directory: bool) -> Result<(), String> {
        let _ = directory;
        match self {
            // russh-sftp writes these arguments in wire order. OpenSSH
            // expects the target first, then the new link path (as in the
            // library's client example), despite the API parameter names.
            // Never retry this mutation with swapped arguments on failure.
            Self::Remote(sftp) => sftp.symlink(target, path).await.map_err(|e| e.to_string()),
            Self::Local => {
                #[cfg(unix)]
                {
                    tokio::fs::symlink(target, path)
                        .await
                        .map_err(|e| e.to_string())
                }
                #[cfg(windows)]
                {
                    if directory { tokio::fs::symlink_dir(target, path).await } else { tokio::fs::symlink_file(target, path).await }
                    .map_err(|e| format!("Could not preserve symbolic link (Windows may require Developer Mode or symlink permission): {e}"))
                }
                #[cfg(not(any(unix, windows)))]
                {
                    let _ = (path, target);
                    Err("Symbolic links are unsupported on this platform".into())
                }
            }
        }
    }

    async fn prepare_directory_publish(&self, target: &str) -> Result<(), String> {
        if matches!(self, Self::Local) {
            let target = target.to_owned();
            tokio::task::spawn_blocking(move || prepare_local_directory_publication(&target))
                .await
                .map_err(|e| e.to_string())??;
        }
        Ok(())
    }

    fn child(&self, parent: &str, leaf: &str) -> Result<String, String> {
        match self {
            Self::Local => {
                validate_leaf(leaf)?;
                // Windows names must not become drive paths, alternate streams,
                // device aliases or separator traversal when importing from SSH.
                #[cfg(windows)]
                if leaf.contains(['\\', ':', '*', '?', '"', '<', '>', '|'])
                    || leaf.chars().any(|character| character < ' ')
                    || leaf.ends_with(['.', ' '])
                    || matches!(
                        leaf.split('.')
                            .next()
                            .unwrap_or("")
                            .to_ascii_uppercase()
                            .as_str(),
                        "CON"
                            | "PRN"
                            | "AUX"
                            | "NUL"
                            | "COM1"
                            | "COM2"
                            | "COM3"
                            | "COM4"
                            | "COM5"
                            | "COM6"
                            | "COM7"
                            | "COM8"
                            | "COM9"
                            | "COM¹"
                            | "COM²"
                            | "COM³"
                            | "LPT1"
                            | "LPT2"
                            | "LPT3"
                            | "LPT4"
                            | "LPT5"
                            | "LPT6"
                            | "LPT7"
                            | "LPT8"
                            | "LPT9"
                            | "LPT¹"
                            | "LPT²"
                            | "LPT³"
                    )
                {
                    return Err(format!(
                        "Folder entry cannot be represented safely on Windows: {leaf}"
                    ));
                }
                Ok(Path::new(parent).join(leaf).to_string_lossy().into_owned())
            }
            Self::Remote(_) => posix_child(parent, leaf),
        }
    }

    fn requires_backup(&self) -> bool {
        matches!(self, Self::Remote(_))
    }

    fn sibling(&self, target: &str, name: &str) -> Result<String, String> {
        match self {
            Self::Local => Path::new(target)
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .map(|parent| parent.join(name).to_string_lossy().into_owned())
                .ok_or_else(|| "A destination parent directory is required".into()),
            Self::Remote(_) => target
                .rsplit_once('/')
                .filter(|(_, leaf)| !leaf.is_empty())
                .map(|(parent, _)| format!("{parent}/{name}"))
                .ok_or_else(|| "An absolute remote destination path is required".into()),
        }
    }

    fn filename(&self, target: &str) -> Result<String, String> {
        match self {
            Self::Local => Path::new(target)
                .file_name()
                .and_then(|s| s.to_str())
                .map(str::to_owned),
            Self::Remote(_) => target.rsplit_once('/').map(|(_, leaf)| leaf.to_owned()),
        }
        .filter(|leaf| !leaf.is_empty() && leaf != "." && leaf != "..")
        .ok_or_else(|| "A destination filename is required".into())
    }

    fn reservation_key(&self, parent: &str, leaf: &str) -> String {
        let key = format!("{parent}/{leaf}");
        // Conservatively serialize case aliases on Windows, including volumes
        // that opt into case-sensitive directories. Remote POSIX names stay exact.
        if cfg!(windows) && matches!(self, Self::Local) {
            key.replace('\\', "/").to_lowercase()
        } else {
            key
        }
    }

    fn collision_key(&self, parent: &str, leaf: &str) -> String {
        let key = self.reservation_key(parent, leaf);
        // Conservatively reject case aliases even on case-sensitive macOS
        // volumes, without changing journal keys or remote POSIX path bytes.
        if cfg!(target_os = "macos") && matches!(self, Self::Local) {
            key.to_lowercase()
        } else {
            key
        }
    }
}

/// One no-follow metadata result, shared by transfers and selected-item inspection.
pub(crate) fn local_snapshot(metadata: &std::fs::Metadata) -> Snapshot {
    #[cfg(unix)]
    let mode = {
        use std::os::unix::fs::PermissionsExt;
        Some(metadata.permissions().mode())
    };
    #[cfg(not(unix))]
    let mode = None;
    Snapshot {
        kind: if metadata.file_type().is_symlink() {
            EntryKind::Symlink
        } else if metadata.is_file() {
            EntryKind::File
        } else if metadata.is_dir() {
            EntryKind::Directory
        } else {
            EntryKind::Other
        },
        size: metadata.len(),
        modified: metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|t| t.as_nanos()),
        mode,
    }
}

pub(crate) fn remote_snapshot(metadata: &FileAttributes) -> Snapshot {
    Snapshot {
        kind: if metadata.file_type().is_symlink() {
            EntryKind::Symlink
        } else if metadata.file_type().is_file() {
            EntryKind::File
        } else if metadata.file_type().is_dir() {
            EntryKind::Directory
        } else {
            EntryKind::Other
        },
        size: metadata.size.unwrap_or(0),
        modified: metadata.mtime.map(u128::from),
        mode: metadata.permissions,
    }
}

/// Probe directory-specific no-clobber rename before moving an original tree.
/// File hard-link fallback is not sufficient evidence for directory publication.
fn prepare_local_directory_publication(target: &str) -> Result<(), String> {
    let parent = Path::new(target)
        .parent()
        .ok_or("Destination parent is required")?;
    let mut source = tempfile::Builder::new()
        .prefix(".zync-publish-probe-")
        .tempdir_in(parent)
        .map_err(|e| e.to_string())?;
    let destination = source.path().with_extension("published-probe");
    publish_local(
        source.path().to_str().ok_or("Invalid probe path")?,
        destination.to_str().ok_or("Invalid probe path")?,
        false,
    )
    .map_err(|e| format!("Destination does not support safe folder publication: {e}"))?;
    // The renamed source is no longer ours at its old path. In particular, do
    // not let TempDir's recursive destructor act on a subsequently reused name.
    source.disable_cleanup(true);
    std::fs::remove_dir(&destination)
        .map_err(|e| format!("Could not clean directory publication probe: {e}"))
}

#[cfg(windows)]
fn publish_local(stage: &str, target: &str, overwrite: bool) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, ReplaceFileW};
    let wide = |s: &str| {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>()
    };
    let stage = wide(stage);
    let target = wide(target);
    let success = unsafe {
        if overwrite {
            ReplaceFileW(
                target.as_ptr(),
                stage.as_ptr(),
                std::ptr::null(),
                0,
                std::ptr::null(),
                std::ptr::null(),
            )
        } else {
            MoveFileExW(stage.as_ptr(), target.as_ptr(), 0)
        }
    };
    if success == 0 {
        Err(format!(
            "Publish was not confirmed; inspect recovery state: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn publish_local(stage: &str, target: &str, overwrite: bool) -> Result<(), String> {
    if overwrite {
        std::fs::rename(stage, target).map_err(|e| e.to_string())
    } else {
        // Reuse tempfile's Linux/macOS exclusive rename and hard-link fallback,
        // as session recovery already does. Never auto-delete the real stage on error.
        let mut path = tempfile::TempPath::from_path(stage);
        path.disable_cleanup(true);
        path.persist_noclobber(target)
            .map_err(|error| error.error.to_string())?;
        match std::fs::remove_file(stage) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!(
                "Published, but staging cleanup is unconfirmed: {error}"
            )),
        }
    }
}

#[cfg(any(not(windows), test))]
pub(super) fn prepare_local_publication(target: &str) -> Result<(), String> {
    let parent = Path::new(target)
        .parent()
        .ok_or("Destination parent is required")?;
    let source = tempfile::Builder::new()
        .prefix(".zync-publish-probe-")
        .tempfile_in(parent)
        .map(|file| file.into_temp_path())
        .map_err(|error| error.to_string())?;
    let destination = source.with_extension("published-probe");
    // Do not own/drop an absent destination: a no-clobber failure must never
    // delete another process's file if it won this random probe name.
    publish_local(
        source.to_str().ok_or("Invalid probe path")?,
        destination.to_str().ok_or("Invalid probe path")?,
        false,
    )
    .map_err(|error| {
        format!("Destination does not support safe no-overwrite publication: {error}")
    })?;
    std::fs::remove_file(&destination)
        .map_err(|error| format!("Could not clean publication probe: {error}"))
}
