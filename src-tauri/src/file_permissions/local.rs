//! Handle-bound local mode editing. Linux uses metadata-only descriptors: chmod
//! authority must not require opening file contents. Other platforms remain
//! explicitly unsupported until their own native mechanisms are qualified.

use std::{
    fs::{File, Metadata},
    io,
    path::Path,
};

pub struct Target {
    file: File,
}

/// Distinguish effective-access refusals from unavailable or sandbox-blocked
/// syscalls. No real object is queried or modified by this cached probe.
#[cfg(target_os = "linux")]
fn faccessat2_qualified() -> bool {
    static QUALIFIED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *QUALIFIED.get_or_init(|| {
        let result = unsafe {
            libc::syscall(
                libc::SYS_faccessat2,
                -1i32,
                c"".as_ptr(),
                libc::F_OK,
                libc::AT_EMPTY_PATH | libc::AT_EACCESS,
            )
        };
        result == -1 && io::Error::last_os_error().raw_os_error() == Some(libc::EBADF)
    })
}

/// Unexpected I/O errors after dispatch are uncertain, never an invitation to
/// replay. Only definite kernel refusals may be labelled rejected.
pub fn definite_rejection(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::PermissionDenied
            | io::ErrorKind::InvalidInput
            | io::ErrorKind::Unsupported
            | io::ErrorKind::NotFound
            | io::ErrorKind::ReadOnlyFilesystem
    )
}

/// Native evidence remains an opaque string across JavaScript IPC. ctime detects
/// permission/ownership/content metadata changes; dev/inode bind the object.
pub fn identity(metadata: &Metadata) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::MetadataExt;
        Some(format!(
            "{}:{}:{}:{}",
            metadata.dev(),
            metadata.ino(),
            metadata.ctime(),
            metadata.ctime_nsec()
        ))
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = metadata;
        None
    }
}

impl Target {
    /// No contents, creation, truncation or final-link following. O_PATH does
    /// not block on a FIFO; reject links/devices/sockets before offering mutation.
    pub fn open(path: &Path) -> io::Result<Self> {
        if !path.is_absolute() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "An absolute local path is required",
            ));
        }
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::fs::OpenOptionsExt;
            let file = std::fs::OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_PATH | libc::O_NOFOLLOW | libc::O_CLOEXEC)
                .open(path)?;
            let metadata = file.metadata()?;
            if !metadata.is_file() && !metadata.is_dir() {
                return Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    "Links and special entries are not editable",
                ));
            }
            Ok(Self { file })
        }
        #[cfg(not(target_os = "linux"))]
        {
            Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "Handle-bound local editing is unavailable on this platform",
            ))
        }
    }

    pub fn metadata(&self) -> io::Result<Metadata> {
        self.file.metadata()
    }

    /// Qualify the syscall without performing a no-op chmod on any real object.
    /// A deliberately invalid FD must return EBADF with these exact flags.
    pub fn mode_edit_supported(&self) -> bool {
        #[cfg(target_os = "linux")]
        {
            if !self.local_filesystem() {
                return false;
            }
            let result = unsafe {
                libc::syscall(
                    libc::SYS_fchmodat2,
                    -1i32,
                    c"".as_ptr(),
                    0u32,
                    libc::AT_EMPTY_PATH,
                )
            };
            result == -1 && io::Error::last_os_error().raw_os_error() == Some(libc::EBADF)
        }
        #[cfg(not(target_os = "linux"))]
        {
            false
        }
    }

    /// One effective-identity-aware kernel query, never old libc mode/UID
    /// emulation. Unknown API/filesystem errors remain unknown, not denial.
    #[cfg(target_os = "linux")]
    pub fn access(&self, read: bool, write: bool, traverse: bool) -> Option<bool> {
        use std::os::fd::AsRawFd;
        if !faccessat2_qualified() || !self.local_filesystem() {
            return None;
        }
        let mode = if read { libc::R_OK } else { 0 }
            | if write { libc::W_OK } else { 0 }
            | if traverse { libc::X_OK } else { 0 };
        let result = unsafe {
            libc::syscall(
                libc::SYS_faccessat2,
                self.file.as_raw_fd(),
                c"".as_ptr(),
                mode,
                libc::AT_EMPTY_PATH | libc::AT_EACCESS,
            )
        };
        if result == 0 {
            return Some(true);
        }
        match io::Error::last_os_error().raw_os_error() {
            Some(libc::EACCES | libc::EPERM | libc::EROFS) => Some(false),
            _ => None,
        }
    }

    /// Apply once to the pinned object, after checking the captured native base.
    /// Caller still owns shared destination admission and read-back presentation.
    pub fn set_mode(
        &self,
        expected_identity: &str,
        expected_mode: u32,
        requested: u32,
    ) -> io::Result<()> {
        #[cfg(target_os = "linux")]
        {
            use std::os::{fd::AsRawFd, unix::fs::PermissionsExt};
            if requested & !0o7777 != 0 || !self.mode_edit_supported() {
                return Err(io::Error::new(io::ErrorKind::Unsupported, "Handle-bound editing requires Linux 6.6 or newer and a supported local filesystem"));
            }
            let metadata = self.metadata()?;
            if identity(&metadata).as_deref() != Some(expected_identity)
                || metadata.permissions().mode() != expected_mode
            {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "The item changed. Refresh permissions before applying",
                ));
            }
            let result = unsafe {
                libc::syscall(
                    libc::SYS_fchmodat2,
                    self.file.as_raw_fd(),
                    c"".as_ptr(),
                    requested,
                    libc::AT_EMPTY_PATH,
                )
            };
            if result == 0 {
                Ok(())
            } else {
                Err(io::Error::last_os_error())
            }
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = (expected_identity, expected_mode, requested);
            Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "Local permission editing is unavailable",
            ))
        }
    }

    #[cfg(target_os = "linux")]
    fn local_filesystem(&self) -> bool {
        use std::os::fd::AsRawFd;
        let mut info = std::mem::MaybeUninit::<libc::statfs>::uninit();
        if unsafe { libc::fstatfs(self.file.as_raw_fd(), info.as_mut_ptr()) } != 0 {
            return false;
        }
        let kind = unsafe { info.assume_init() }.f_type;
        // NFS/FUSE/9P (including Windows-mounted WSL paths) can have different
        // authority or mode semantics. Do not manufacture local-token evidence.
        matches!(
            kind,
            libc::EXT4_SUPER_MAGIC
                | libc::XFS_SUPER_MAGIC
                | libc::BTRFS_SUPER_MAGIC
                | libc::TMPFS_MAGIC
                | libc::OVERLAYFS_SUPER_MAGIC
        )
    }
}

#[cfg(all(test, target_os = "linux", feature = "permission-runtime-tests"))]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};

    #[test]
    fn sandbox_blocked_access_syscall_is_unknown_not_denied() {
        const CHILD: &str = "ZYNC_PERMISSION_SECCOMP_TEST_CHILD";
        const COMPLETE: &str = "ZYNC_SECCOMP_ACCESS_CHECK_COMPLETE";
        if std::env::var_os(CHILD).is_none() {
            // The filter affects this disposable child only, not the test runner
            // or its siblings. Probe before any successful qualification is cached.
            let module = module_path!().split_once("::").unwrap().1;
            let worker_test =
                format!("{module}::sandbox_blocked_access_syscall_is_unknown_not_denied");
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", &worker_test, "--nocapture"])
                .env(CHILD, "1")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(
                String::from_utf8_lossy(&output.stdout).contains(COMPLETE),
                "The seccomp worker must actually execute, not merely exit after zero tests"
            );
            return;
        }
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("readable");
        std::fs::write(&path, b"unchanged").unwrap();
        let target = Target::open(&path).unwrap();
        let mut filter = [
            libc::sock_filter {
                code: (libc::BPF_LD | libc::BPF_W | libc::BPF_ABS) as u16,
                jt: 0,
                jf: 0,
                k: 0,
            },
            libc::sock_filter {
                code: (libc::BPF_JMP | libc::BPF_JEQ | libc::BPF_K) as u16,
                jt: 0,
                jf: 1,
                k: libc::SYS_faccessat2 as u32,
            },
            libc::sock_filter {
                code: (libc::BPF_RET | libc::BPF_K) as u16,
                jt: 0,
                jf: 0,
                k: libc::SECCOMP_RET_ERRNO | libc::EPERM as u32,
            },
            libc::sock_filter {
                code: (libc::BPF_RET | libc::BPF_K) as u16,
                jt: 0,
                jf: 0,
                k: libc::SECCOMP_RET_ALLOW,
            },
        ];
        let program = libc::sock_fprog {
            len: filter.len() as u16,
            filter: filter.as_mut_ptr(),
        };
        assert_eq!(
            unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) },
            0
        );
        assert_eq!(
            unsafe { libc::prctl(libc::PR_SET_SECCOMP, libc::SECCOMP_MODE_FILTER, &program) },
            0
        );
        assert!(!faccessat2_qualified());
        assert_eq!(target.access(true, false, false), None);
        assert_eq!(target.access(false, true, false), None);
        assert_eq!(std::fs::read(&path).unwrap(), b"unchanged");
        println!("{COMPLETE}");
    }

    #[test]
    fn mode_zero_owner_can_edit_without_a_content_open() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("space ;$() 文件");
        std::fs::write(&path, b"unchanged").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0)).unwrap();
        let target = Target::open(&path).unwrap();
        assert!(
            target.mode_edit_supported(),
            "Test requires a qualified kernel/filesystem"
        );
        let before = target.metadata().unwrap();
        target
            .set_mode(
                &identity(&before).unwrap(),
                before.permissions().mode(),
                0o600,
            )
            .unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"unchanged");
        assert_eq!(
            target.metadata().unwrap().permissions().mode() & 0o7777,
            0o600
        );
    }

    #[test]
    fn replaced_path_and_link_cannot_redirect_a_pinned_change() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("target");
        let other = temp.path().join("other");
        std::fs::write(&path, b"original").unwrap();
        std::fs::write(&other, b"other").unwrap();
        std::fs::set_permissions(&other, std::fs::Permissions::from_mode(0o644)).unwrap();
        let target = Target::open(&path).unwrap();
        std::fs::rename(&path, temp.path().join("moved")).unwrap();
        symlink(&other, &path).unwrap();
        assert!(Target::open(&path).is_err());
        let before = target.metadata().unwrap();
        target
            .set_mode(
                &identity(&before).unwrap(),
                before.permissions().mode(),
                0o600,
            )
            .unwrap();
        assert_eq!(
            std::fs::metadata(&other).unwrap().permissions().mode() & 0o7777,
            0o644
        );
        assert_eq!(std::fs::read(&other).unwrap(), b"other");
    }

    #[test]
    fn stale_mode_and_identity_are_rejected_before_mutation() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("file");
        std::fs::write(&path, b"unchanged").unwrap();
        let target = Target::open(&path).unwrap();
        let before = target.metadata().unwrap();
        assert!(target
            .set_mode("different", before.permissions().mode(), 0o600)
            .is_err());
        assert!(target
            .set_mode(&identity(&before).unwrap(), 0, 0o600)
            .is_err());
        assert_eq!(
            target.metadata().unwrap().permissions().mode(),
            before.permissions().mode()
        );
    }

    #[test]
    fn effective_access_is_independent_of_parent_creation_and_deletion() {
        assert_ne!(
            unsafe { libc::geteuid() },
            0,
            "Run this regression without root"
        );
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("readonly");
        std::fs::write(&path, b"readable").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o400)).unwrap();
        let target = Target::open(&path).unwrap();
        assert_eq!(target.access(true, false, false), Some(true));
        assert_eq!(target.access(false, true, false), Some(false));
        assert_eq!(
            Target::open(temp.path()).unwrap().access(false, true, true),
            Some(true)
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn directory_traversal_is_not_inferred_from_listing_bits() {
        assert_ne!(
            unsafe { libc::geteuid() },
            0,
            "Run this regression without root"
        );
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("directory");
        std::fs::create_dir(&path).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o400)).unwrap();
        let target = Target::open(&path).unwrap();
        assert_eq!(target.access(true, false, false), Some(true));
        assert_eq!(target.access(true, false, true), Some(false));
        let metadata = target.metadata().unwrap();
        target
            .set_mode(
                &identity(&metadata).unwrap(),
                metadata.permissions().mode(),
                0o700,
            )
            .unwrap();
    }

    #[test]
    #[ignore = "Explicit privileged fixture worker; invoke only through the isolated root test"]
    fn unprivileged_worker_cannot_chmod_other_owner() {
        assert_eq!(unsafe { libc::geteuid() }, 65534);
        let path = std::env::var_os("ZYNC_PERMISSION_TEST_TARGET")
            .expect("Only the isolated test owns this target");
        let path = Path::new(&path);
        assert!(
            path.starts_with("/tmp")
                && path
                    .parent()
                    .unwrap()
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("zync-permissions-privileged-")
        );
        let target = Target::open(path).unwrap();
        assert_eq!(
            target.access(false, true, false),
            Some(true),
            "Content write does not authorize chmod"
        );
        let metadata = target.metadata().unwrap();
        let error = target
            .set_mode(
                &identity(&metadata).unwrap(),
                metadata.permissions().mode(),
                0o600,
            )
            .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        println!("ZYNC_NON_OWNER_PERMISSION_CHECK_COMPLETE");
    }

    #[test]
    #[ignore = "Requires explicit approval: root only changes disposable /tmp fixtures; never run with --include-ignored"]
    fn isolated_root_and_non_owner_semantics() {
        use std::os::unix::{fs::MetadataExt, process::CommandExt};
        assert_eq!(
            unsafe { libc::geteuid() },
            0,
            "This fixture requires explicit root-test approval"
        );
        let temp = tempfile::Builder::new()
            .prefix("zync-permissions-privileged-")
            .tempdir_in("/tmp")
            .unwrap();
        std::fs::set_permissions(temp.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        let path = temp.path().join("fixture");
        std::fs::write(&path, b"disposable permission fixture").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0)).unwrap();
        let target = Target::open(&path).unwrap();
        assert_eq!(target.metadata().unwrap().uid(), 0);
        assert_eq!(
            target.access(false, true, false),
            Some(true),
            "Effective root access must not be guessed from mode bits"
        );
        let before = target.metadata().unwrap();
        target
            .set_mode(
                &identity(&before).unwrap(),
                before.permissions().mode(),
                0o666,
            )
            .unwrap();
        // Root never invokes Cargo or third-party build scripts. Copy this already
        // built test executable into the owned disposable fixture for the worker.
        let worker = temp.path().join("worker");
        std::fs::copy(std::env::current_exe().unwrap(), &worker).unwrap();
        std::fs::set_permissions(&worker, std::fs::Permissions::from_mode(0o755)).unwrap();
        let module = module_path!().split_once("::").unwrap().1;
        let worker_test = format!("{module}::unprivileged_worker_cannot_chmod_other_owner");
        let output = std::process::Command::new(&worker)
            .uid(65534)
            .gid(65534)
            .args(["--ignored", "--exact", &worker_test, "--nocapture"])
            .env("ZYNC_PERMISSION_TEST_TARGET", &path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            String::from_utf8_lossy(&output.stdout)
                .contains("ZYNC_NON_OWNER_PERMISSION_CHECK_COMPLETE"),
            "The non-owner worker must actually execute, not merely exit after zero tests"
        );
        assert_eq!(
            target.metadata().unwrap().permissions().mode() & 0o7777,
            0o666
        );
        assert_eq!(
            std::fs::read(&path).unwrap(),
            b"disposable permission fixture"
        );
    }
}
