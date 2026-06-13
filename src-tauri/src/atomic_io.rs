//! Durable atomic file replacement: temp write + fsync, rename, optional backup rollback.

use std::fs::{self, OpenOptions};
use std::io::{self, ErrorKind, Write};
use std::path::Path;

const TEMP_EXTENSION: &str = "tmp";
const BACKUP_EXTENSION: &str = "bak";

/// Replace `path` with `content` using a durable temp-write + rename flow.
///
/// - Writes to `path.with_extension("tmp")`, flushes with `sync_all`
/// - Renames into place; on `AlreadyExists`, stages `path` to `.bak` and retries
/// - Removes a stale `.bak` before staging when needed
/// - Flushes the final file and parent directory metadata (parent sync skipped on Windows)
pub fn durable_replace(path: &Path, content: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(ErrorKind::InvalidInput, "invalid file path"))?;
    fs::create_dir_all(parent)?;

    let temp_path = path.with_extension(TEMP_EXTENSION);
    write_temp_durable(&temp_path, content)?;

    // Windows may replace an existing destination on rename without staging; clear stale backups first.
    let backup_path = path.with_extension(BACKUP_EXTENSION);
    remove_stale_backup_file(&backup_path)?;

    match fs::rename(&temp_path, path) {
        Ok(()) => finalize_durable(path),
        Err(rename_err) if rename_err.kind() == ErrorKind::AlreadyExists && path.exists() => {
            replace_with_backup(path, &temp_path, rename_err)
        }
        Err(rename_err) => {
            let _ = fs::remove_file(&temp_path);
            Err(rename_err)
        }
    }
}

fn write_temp_durable(temp_path: &Path, content: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(temp_path)?;
    file.write_all(content)?;
    file.sync_all()?;
    Ok(())
}

fn replace_with_backup(path: &Path, temp_path: &Path, _initial_rename_err: io::Error) -> io::Result<()> {
    let backup_path = path.with_extension(BACKUP_EXTENSION);
    remove_stale_backup(&backup_path, temp_path)?;

    if let Err(stage_err) = fs::rename(path, &backup_path) {
        let _ = fs::remove_file(temp_path);
        return Err(stage_err);
    }

    match fs::rename(temp_path, path) {
        Ok(()) => {
            let _ = fs::remove_file(&backup_path);
            finalize_durable(path)
        }
        Err(retry_err) => {
            if let Err(restore_err) = fs::rename(&backup_path, path) {
                return Err(io::Error::other(format!(
                    "failed to finalize durable replace ({retry_err}); failed to restore backup: {restore_err}"
                )));
            }
            if let Err(remove_err) = fs::remove_file(temp_path) {
                return Err(io::Error::other(format!(
                    "failed to finalize durable replace ({retry_err}); failed to remove temp file: {remove_err}"
                )));
            }
            Err(retry_err)
        }
    }
}

fn remove_stale_backup_file(backup_path: &Path) -> io::Result<()> {
    if backup_path.exists() {
        fs::remove_file(backup_path)?;
    }
    Ok(())
}

fn remove_stale_backup(backup_path: &Path, temp_path: &Path) -> io::Result<()> {
    remove_stale_backup_file(backup_path).map_err(|error| {
        let _ = fs::remove_file(temp_path);
        error
    })
}

fn finalize_durable(path: &Path) -> io::Result<()> {
    sync_file(path)?;
    sync_parent_dir(path)
}

fn sync_file(path: &Path) -> io::Result<()> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(target_os = "windows")]
    {
        // Windows may reject sync_all on read-only handles.
        options.write(true);
    }
    options.open(path).and_then(|file| file.sync_all())
}

#[cfg(not(target_os = "windows"))]
fn sync_parent_dir(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        OpenOptions::new()
            .read(true)
            .open(parent)
            .and_then(|file| file.sync_all())?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn sync_parent_dir(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("zync-atomic-io-{prefix}-{nanos}"))
    }

    #[test]
    fn durable_replace_writes_and_replaces_file() {
        let dir = temp_dir("write-replace");
        fs::create_dir_all(&dir).expect("create dir");
        let path = dir.join("data.json");

        durable_replace(&path, br#"{"version":1}"#).expect("initial write");
        let first = fs::read_to_string(&path).expect("read first");
        assert_eq!(first, r#"{"version":1}"#);

        durable_replace(&path, br#"{"version":2}"#).expect("replace write");
        let second = fs::read_to_string(&path).expect("read second");
        assert_eq!(second, r#"{"version":2}"#);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn durable_replace_recovers_when_stale_backup_exists() {
        let dir = temp_dir("stale-backup");
        fs::create_dir_all(&dir).expect("create dir");
        let path = dir.join("data.json");
        let backup_path = path.with_extension(BACKUP_EXTENSION);

        fs::write(&path, r#"{"version":1}"#).expect("seed primary");
        fs::write(&backup_path, r#"{"version":"backup"}"#).expect("seed stale backup");

        durable_replace(&path, br#"{"version":2}"#).expect("replace with stale backup present");
        let updated = fs::read_to_string(&path).expect("read updated");
        assert_eq!(updated, r#"{"version":2}"#);
        assert!(!backup_path.exists());

        let _ = fs::remove_dir_all(&dir);
    }
}