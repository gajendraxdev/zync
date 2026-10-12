//! First-use recovery snapshots: publish complete original bytes without replacing
//! a previous copy. Kept separate from session codecs and the live-session writer.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;

/// Secure one manual recovery copy before migration. Callers supply a fixed upgrade
/// filename, never a persisted or user-provided path. Blocking filesystem work runs
/// off the async executor; cancellation cannot leave a partially published copy.
pub(super) async fn secure_session_backup(
    dir: &Path,
    original: &str,
    backup_name: &str,
) -> Result<(), String> {
    let dir = dir.to_owned();
    let original = original.to_owned();
    let backup_name = backup_name.to_owned();
    tokio::task::spawn_blocking(move || secure_copy(&dir, &original, &backup_name))
        .await
        .map_err(io::Error::other)
        .and_then(|result| result)
        .map_err(|error| format!("SESSION_BACKUP_FAILED: Could not secure the workspace recovery copy; the existing session was not changed: {error}"))
}

/// Require a regular JSON object. Invalid or unreadable destinations are preserved
/// and stop migration; a symlink is not a recovery copy owned by this directory.
fn has_valid_copy(path: &Path) -> io::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => {
            if serde_json::from_slice::<serde_json::Value>(&fs::read(path)?)
                .is_ok_and(|value| value.is_object())
            {
                Ok(true)
            } else {
                Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "existing recovery copy is not a valid JSON snapshot",
                ))
            }
        }
        Ok(_) => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "existing recovery copy is not a regular file",
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn secure_copy(dir: &Path, original: &str, backup_name: &str) -> io::Result<()> {
    let backup = dir.join(backup_name);
    if !has_valid_copy(&backup)? {
        stage_and_publish(dir, &backup, |file| file.write_all(original.as_bytes()))?;
    }
    // Repeat the directory sync on retries, including when a previous publication
    // succeeded but its acknowledgement/directory sync failed. Never replace it.
    #[cfg(unix)]
    File::open(dir)?.sync_all()?;
    Ok(())
}

/// Stage and sync in the destination directory, then publish without clobbering.
/// tempfile uses exclusive rename on Windows and supported Linux/macOS filesystems,
/// falling back to hard links where appropriate. It never overwrites the target;
/// if neither operation works, fail closed instead of copying into the final name.
/// The write callback keeps partial-write failure tests on this production path.
fn stage_and_publish(
    dir: &Path,
    backup: &Path,
    write_snapshot: impl FnOnce(&mut File) -> io::Result<()>,
) -> io::Result<()> {
    let mut stage = tempfile::Builder::new()
        .prefix(".zync-session-recovery-")
        .suffix(".tmp")
        .tempfile_in(dir)?;
    write_snapshot(stage.as_file_mut())?;
    stage.as_file().sync_all()?;
    let stage_path = stage.path().to_owned();
    match stage.persist_noclobber(backup) {
        Ok(_) => {
            // The exclusive-rename path removes this name. A hard-link fallback
            // can leave it behind if its unlink failed; surface that failure too.
            match fs::remove_file(stage_path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(error),
            }
        }
        Err(error) => {
            let tempfile::PersistError { error, file } = error;
            // Cleanup owns only our stage, not the winner. Report failures rather
            // than calling the migration successful with a known orphaned stage.
            file.close()?;
            if error.kind() != io::ErrorKind::AlreadyExists {
                return Err(error);
            }
            // A competing publisher may have won after the initial check.
            if has_valid_copy(backup)? {
                Ok(())
            } else {
                Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    "recovery copy disappeared before publication",
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BACKUP_NAME: &str = "session.pre-test.json";
    const ORIGINAL: &str = "{ \"version\":1, \"activeTabId\":\"first\" }\r\n";

    #[test]
    fn publication_preserves_exact_bytes_and_the_first_copy() {
        let dir = tempfile::tempdir().unwrap();
        secure_copy(dir.path(), ORIGINAL, BACKUP_NAME).unwrap();
        secure_copy(
            dir.path(),
            r#"{"version":1,"activeTabId":"later"}"#,
            BACKUP_NAME,
        )
        .unwrap();
        assert_eq!(
            fs::read(dir.path().join(BACKUP_NAME)).unwrap(),
            ORIGINAL.as_bytes()
        );
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn failed_partial_write_leaves_no_published_or_staged_file() {
        let dir = tempfile::tempdir().unwrap();
        let error = stage_and_publish(dir.path(), &dir.path().join(BACKUP_NAME), |file| {
            file.write_all(b"{\"version\":")?;
            Err(io::Error::new(
                io::ErrorKind::WriteZero,
                "injected full disk",
            ))
        })
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::WriteZero);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn collision_after_staging_keeps_the_complete_first_winner() {
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join(BACKUP_NAME);
        stage_and_publish(dir.path(), &backup, |file| {
            file.write_all(b"{\"version\":0}")?;
            // Model a winner arriving between the read and publication.
            secure_copy(dir.path(), ORIGINAL, BACKUP_NAME)
        })
        .unwrap();
        assert_eq!(fs::read(backup).unwrap(), ORIGINAL.as_bytes());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn invalid_collision_after_staging_fails_without_removing_the_destination() {
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join(BACKUP_NAME);
        let error = stage_and_publish(dir.path(), &backup, |file| {
            file.write_all(ORIGINAL.as_bytes())?;
            fs::write(&backup, "not-json")
        })
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert_eq!(fs::read_to_string(backup).unwrap(), "not-json");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn failed_publication_removes_only_its_stage() {
        let dir = tempfile::tempdir().unwrap();
        let sentinel = dir.path().join("unrelated.tmp");
        fs::write(&sentinel, "keep").unwrap();
        let error = stage_and_publish(
            dir.path(),
            &dir.path().join("missing/backup.json"),
            |file| file.write_all(ORIGINAL.as_bytes()),
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
        assert_eq!(fs::read_to_string(sentinel).unwrap(), "keep");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn invalid_existing_copies_are_preserved() {
        for content in ["not-json", "null", "[]", "", "{} trailing"] {
            let dir = tempfile::tempdir().unwrap();
            let backup = dir.path().join(BACKUP_NAME);
            fs::write(&backup, content).unwrap();
            assert_eq!(
                secure_copy(dir.path(), ORIGINAL, BACKUP_NAME)
                    .unwrap_err()
                    .kind(),
                io::ErrorKind::InvalidData
            );
            assert_eq!(fs::read_to_string(backup).unwrap(), content);
            assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
        }
    }

    #[cfg(unix)]
    #[test]
    fn existing_symlink_is_not_followed_or_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("unrelated.json");
        fs::write(&target, ORIGINAL).unwrap();
        std::os::unix::fs::symlink(&target, dir.path().join(BACKUP_NAME)).unwrap();
        assert_eq!(
            secure_copy(dir.path(), ORIGINAL, BACKUP_NAME)
                .unwrap_err()
                .kind(),
            io::ErrorKind::InvalidData
        );
        assert_eq!(fs::read_to_string(target).unwrap(), ORIGINAL);
        assert!(fs::symlink_metadata(dir.path().join(BACKUP_NAME))
            .unwrap()
            .file_type()
            .is_symlink());
    }
}
