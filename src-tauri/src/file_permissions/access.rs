//! Read-only local access evidence and explicit SSH Copy preflight. These checks
//! never authorize a later operation, read file contents or change a DACL/mode.
//! Unsupported local access evidence remains unknown, not denied.

use serde::Serialize;
use std::path::Path;

/// Probe one explicitly selected SSH source. No READ/READDIR or mutations;
/// link entries use READLINK and special/unknown kinds are not opened. As with
/// transfers, SFTP v3 path checks cannot prevent concurrent entry replacement.
/// The caller owns a disposable raw session, including cleanup on interruption.
pub async fn check_remote_copy(
    session: &russh_sftp::client::RawSftpSession,
    path: &str,
) -> Result<(), String> {
    use crate::file_transfers::endpoint::{remote_snapshot, EntryKind};
    use russh_sftp::protocol::{FileAttributes, OpenFlags};
    super::validate_path(path)?;
    let check = async {
        let metadata = session.lstat(path).await?;
        let handle = match remote_snapshot(&metadata.attrs).kind {
            EntryKind::File => {
                session
                    .open(path, OpenFlags::READ, FileAttributes::empty())
                    .await?
                    .handle
            }
            EntryKind::Directory => session.opendir(path).await?.handle,
            EntryKind::Symlink => {
                session.readlink(path).await?;
                return Ok(());
            }
            EntryKind::Other => {
                return Err(russh_sftp::client::error::Error::UnexpectedBehavior(
                    "Copy access cannot be checked for this entry type".into(),
                ))
            }
        };
        session.close(handle).await?;
        Ok::<(), russh_sftp::client::error::Error>(())
    };
    check
        .await
        .map_err(|error| format!("Cannot check Copy source {path:?}: {error}"))
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryAccess {
    pub create_file: Option<bool>,
    pub create_folder: Option<bool>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetAccess {
    pub read: Option<bool>,
    pub write: Option<bool>,
    pub rename: Option<bool>,
    pub delete: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub directory: String,
    pub target: Option<String>,
    pub directory_access: DirectoryAccess,
    pub target_access: TargetAccess,
}

/// At most one directory and one immediate child; never enumerate a selection.
/// Failed inspection remains attemptable. Actual filesystem calls still enforce
/// ancestor traversal, share locks, mounts and any policy not represented here.
pub fn inspect(directory: String, target: Option<String>) -> Result<Evidence, String> {
    super::validate_path(&directory)?;
    if !Path::new(&directory).is_absolute() {
        return Err("Access inspection requires an absolute directory".into());
    }
    if let Some(target) = &target {
        super::validate_path(target)?;
        if Path::new(target).parent() != Some(Path::new(&directory)) {
            return Err("Access inspection accepts only an immediate child".into());
        }
    }
    let result = Evidence {
        directory,
        target,
        directory_access: DirectoryAccess::default(),
        target_access: TargetAccess::default(),
    };
    // Never use a followed link's metadata as evidence about the displayed item.
    let directory_is_plain = std::fs::symlink_metadata(&result.directory)
        .is_ok_and(|metadata| metadata.is_dir() && plain(&metadata));
    if !directory_is_plain {
        return Ok(result);
    }
    #[cfg(windows)]
    {
        let mut result = result;
        windows::inspect(&mut result);
        Ok(result)
    }
    #[cfg(target_os = "linux")]
    {
        let mut result = result;
        if let Ok(parent) = super::local::Target::open(Path::new(&result.directory)) {
            let create = parent.access(false, true, true);
            result.directory_access = DirectoryAccess {
                create_file: create,
                create_folder: create,
            };
            if let Some(path) = &result.target {
                if let Ok(target) = super::local::Target::open(Path::new(path)) {
                    let is_directory = target.metadata().is_ok_and(|metadata| metadata.is_dir());
                    result.target_access.read = target.access(true, false, is_directory);
                    if !is_directory {
                        result.target_access.write = target.access(false, true, false);
                    }
                    // Parent denial is sufficient; a positive parent check does
                    // not prove sticky-bit, immutable, mount or rename policy.
                    if create == Some(false) {
                        result.target_access.delete = Some(false);
                        result.target_access.rename = Some(false);
                    }
                }
            }
        }
        Ok(result)
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    Ok(result)
}

fn plain(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Includes junctions and other reparse types, not only symbolic links.
        if metadata.file_attributes()
            & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
            != 0
        {
            return false;
        }
    }
    true
}

/// Only qualified local regular objects may open an OS permission editor. Reuse
/// the same reparse/network boundary as advisory access checks; no shell URI or
/// remote SFTP path may become a Windows Shell object through this capability.
pub(super) fn supports_system_editor(path: &str) -> bool {
    #[cfg(windows)]
    {
        Path::new(path).is_absolute()
            && windows::security_volume(path)
            && std::fs::symlink_metadata(path)
                .is_ok_and(|metadata| plain(&metadata) && (metadata.is_file() || metadata.is_dir()))
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        false
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::{mem::size_of, os::windows::ffi::OsStrExt, ptr::null_mut};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, LocalFree, ERROR_NO_TOKEN, HANDLE},
        Security::{
            AccessCheck,
            Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT},
            DuplicateToken, SecurityImpersonation, DACL_SECURITY_INFORMATION, GENERIC_MAPPING,
            GROUP_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION, PRIVILEGE_SET, TOKEN_DUPLICATE,
            TOKEN_QUERY,
        },
        Storage::FileSystem::{
            GetDriveTypeW, GetVolumeInformationW, GetVolumePathNameW, DELETE, FILE_ADD_FILE,
            FILE_ADD_SUBDIRECTORY, FILE_ALL_ACCESS, FILE_DELETE_CHILD, FILE_GENERIC_EXECUTE,
            FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_READ_DATA, FILE_WRITE_DATA,
        },
        System::{
            SystemServices::FILE_PERSISTENT_ACLS,
            Threading::{GetCurrentProcess, GetCurrentThread, OpenProcessToken, OpenThreadToken},
            WindowsProgramming::{DRIVE_CDROM, DRIVE_FIXED, DRIVE_RAMDISK, DRIVE_REMOVABLE},
        },
    };

    fn disk_root(path: &Path) -> Option<[u16; 4]> {
        use std::path::{Component, Prefix};
        match path.components().next()? {
            Component::Prefix(prefix) => match prefix.kind() {
                Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
                    Some([letter as u16, b':' as u16, b'\\' as u16, 0])
                }
                _ => None,
            },
            _ => None,
        }
    }

    /// SMB may use credentials different from this process token. Resolve local
    /// aliases first; never turn a local-token check on a UNC/mapped share into
    /// a false account denial. Unknown volumes stay attemptable.
    pub(super) fn local_volume(path: &str) -> bool {
        let Some(original_root) = disk_root(Path::new(path)) else {
            return false;
        };
        if !matches!(
            unsafe { GetDriveTypeW(original_root.as_ptr()) },
            DRIVE_FIXED | DRIVE_REMOVABLE | DRIVE_CDROM | DRIVE_RAMDISK
        ) {
            return false;
        }
        let Ok(canonical) = std::fs::canonicalize(path) else {
            return false;
        };
        let Some(root) = disk_root(&canonical) else {
            return false;
        };
        matches!(
            unsafe { GetDriveTypeW(root.as_ptr()) },
            DRIVE_FIXED | DRIVE_REMOVABLE | DRIVE_CDROM | DRIVE_RAMDISK
        )
    }

    /// A fixed/removable volume need not support ACLs (for example FAT/exFAT).
    /// Inspect the actual mount root, not merely its drive-letter ancestor.
    pub(super) fn security_volume(path: &str) -> bool {
        if !local_volume(path) {
            return false;
        }
        let path: Vec<u16> = std::ffi::OsStr::new(path)
            .encode_wide()
            .chain(Some(0))
            .collect();
        let mut root = vec![0u16; 32_768];
        let mut flags = 0;
        unsafe {
            GetVolumePathNameW(path.as_ptr(), root.as_mut_ptr(), root.len() as u32) != 0
                && matches!(
                    GetDriveTypeW(root.as_ptr()),
                    DRIVE_FIXED | DRIVE_REMOVABLE | DRIVE_CDROM | DRIVE_RAMDISK
                )
                && GetVolumeInformationW(
                    root.as_ptr(),
                    null_mut(),
                    0,
                    null_mut(),
                    null_mut(),
                    &mut flags,
                    null_mut(),
                    0,
                ) != 0
                && flags & FILE_PERSISTENT_ACLS != 0
        }
    }

    struct Token(HANDLE);
    impl Drop for Token {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    struct Descriptor(*mut core::ffi::c_void);
    impl Drop for Descriptor {
        fn drop(&mut self) {
            unsafe {
                LocalFree(self.0);
            }
        }
    }

    /// Respect an impersonating thread. Fall back to the process token only when
    /// there is no thread token, not when access to that token was denied.
    fn token() -> Option<Token> {
        unsafe {
            let mut handle = null_mut();
            if OpenThreadToken(
                GetCurrentThread(),
                TOKEN_QUERY | TOKEN_DUPLICATE,
                1,
                &mut handle,
            ) == 0
            {
                if GetLastError() != ERROR_NO_TOKEN
                    || OpenProcessToken(
                        GetCurrentProcess(),
                        TOKEN_QUERY | TOKEN_DUPLICATE,
                        &mut handle,
                    ) == 0
                {
                    return None;
                }
            }
            let original = Token(handle);
            let mut duplicate = null_mut();
            if DuplicateToken(original.0, SecurityImpersonation, &mut duplicate) == 0 {
                return None;
            }
            Some(Token(duplicate))
        }
    }

    fn descriptor(path: &str) -> Option<Descriptor> {
        let wide: Vec<u16> = std::ffi::OsStr::new(path)
            .encode_wide()
            .chain(Some(0))
            .collect();
        let mut descriptor = null_mut();
        let status = unsafe {
            GetNamedSecurityInfoW(
                wide.as_ptr(),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                null_mut(),
                null_mut(),
                &mut descriptor,
            )
        };
        if status != 0 || descriptor.is_null() {
            if !descriptor.is_null() {
                drop(Descriptor(descriptor));
            }
            return None;
        }
        Some(Descriptor(descriptor))
    }

    /// API success and access granted are separate outputs. Fixed, aligned space
    /// for the one privilege applicable to these ordinary file rights; larger or
    /// unsupported privilege requirements produce unknown rather than a denial.
    fn check(descriptor: &Descriptor, token: &Token, rights: u32) -> Option<bool> {
        let mapping = GENERIC_MAPPING {
            GenericRead: FILE_GENERIC_READ,
            GenericWrite: FILE_GENERIC_WRITE,
            GenericExecute: FILE_GENERIC_EXECUTE,
            GenericAll: FILE_ALL_ACCESS,
        };
        let mut privileges: PRIVILEGE_SET = unsafe { std::mem::zeroed() };
        let mut length = size_of::<PRIVILEGE_SET>() as u32;
        let mut granted = 0;
        let mut allowed = 0;
        let success = unsafe {
            AccessCheck(
                descriptor.0,
                token.0,
                rights,
                &mapping,
                &mut privileges,
                &mut length,
                &mut granted,
                &mut allowed,
            )
        };
        (success != 0).then_some(allowed != 0)
    }

    fn either(first: Option<bool>, second: Option<bool>) -> Option<bool> {
        match (first, second) {
            (Some(true), _) | (_, Some(true)) => Some(true),
            (Some(false), Some(false)) => Some(false),
            _ => None,
        }
    }

    pub(super) fn inspect(result: &mut Evidence) {
        if !local_volume(&result.directory) {
            return;
        }
        let Some(token) = token() else {
            return;
        };
        let Some(parent) = descriptor(&result.directory) else {
            return;
        };
        let file_create = check(&parent, &token, FILE_ADD_FILE);
        let folder_create = check(&parent, &token, FILE_ADD_SUBDIRECTORY);
        result.directory_access = DirectoryAccess {
            create_file: file_create,
            create_folder: folder_create,
        };
        let Some(path) = &result.target else {
            return;
        };
        let Ok(metadata) = std::fs::symlink_metadata(path) else {
            return;
        };
        if !plain(&metadata) || !(metadata.is_file() || metadata.is_dir()) {
            return;
        }
        let Some(target) = descriptor(path) else {
            return;
        };
        let remove = either(
            check(&target, &token, DELETE),
            check(&parent, &token, FILE_DELETE_CHILD),
        );
        let add = if metadata.is_dir() {
            folder_create
        } else {
            file_create
        };
        // A positive DACL result does not promise rename/delete success: handles,
        // traversal and filesystem policies still apply. Deny only a required
        // right, considering both target DELETE and parent DELETE_CHILD.
        let rename = match (remove, add) {
            (Some(false), _) | (_, Some(false)) => Some(false),
            (Some(true), Some(true)) => Some(true),
            _ => None,
        };
        result.target_access = TargetAccess {
            rename,
            delete: remove,
            ..Default::default()
        };
        if metadata.is_file() {
            result.target_access.read = check(&target, &token, FILE_READ_DATA);
            result.target_access.write = if metadata.permissions().readonly() {
                Some(false)
            } else {
                check(&target, &token, FILE_WRITE_DATA)
            };
            // Do not deny deletion from readonly alone: the existing Rust
            // remove_file implementation can remove readonly Windows files.
        }
    }

    #[test]
    fn network_and_device_prefixes_are_not_local_token_evidence() {
        assert_eq!(
            disk_root(Path::new(r"C:\folder")),
            Some([b'C' as u16, b':' as u16, b'\\' as u16, 0])
        );
        assert_eq!(
            disk_root(Path::new(r"\\?\C:\folder")),
            Some([b'C' as u16, b':' as u16, b'\\' as u16, 0])
        );
        assert_eq!(disk_root(Path::new(r"\\server\share\folder")), None);
        assert_eq!(disk_root(Path::new(r"\\?\UNC\server\share\folder")), None);
        assert_eq!(disk_root(Path::new(r"\\.\pipe\name")), None);
    }

    #[test]
    fn delete_right_alternatives_do_not_turn_unknown_into_denied() {
        assert_eq!(either(Some(false), None), None);
        assert_eq!(either(Some(false), Some(true)), Some(true));
        assert_eq!(either(Some(false), Some(false)), Some(false));
    }

    #[test]
    fn real_access_check_distinguishes_api_success_from_denied_rights() {
        use windows_sys::Win32::Security::Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW;
        let sddl: Vec<u16> = "O:SYG:SYD:(D;;0x2;;;WD)"
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let mut raw = null_mut();
        assert_ne!(
            unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    sddl.as_ptr(),
                    1,
                    &mut raw,
                    null_mut(),
                )
            },
            0
        );
        let descriptor = Descriptor(raw);
        let token = token().expect("test account token");
        assert_eq!(check(&descriptor, &token, FILE_WRITE_DATA), Some(false));
        // A restricted test runner's token may require its restricting SID as
        // well as Everyone in an allow DACL. A NULL DACL is unambiguously open
        // to both checks; do not assume an unrestricted development account.
        let sddl: Vec<u16> = "O:SYG:SYD:NO_ACCESS_CONTROL"
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let mut raw = null_mut();
        assert_ne!(
            unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    sddl.as_ptr(),
                    1,
                    &mut raw,
                    null_mut(),
                )
            },
            0
        );
        let descriptor = Descriptor(raw);
        assert_eq!(check(&descriptor, &token, FILE_READ_DATA), Some(true));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_paths_and_immediate_child_only() {
        assert!(inspect("relative".into(), None).is_err());
        assert!(inspect(String::new(), None).is_err());
        let temp = tempfile::tempdir().unwrap();
        let directory = temp.path().to_string_lossy().into_owned();
        assert!(inspect(
            directory.clone(),
            Some(
                temp.path()
                    .join("child/nested")
                    .to_string_lossy()
                    .into_owned()
            )
        )
        .is_err());
        assert!(inspect(directory, None).is_ok());
    }

    #[test]
    fn missing_directory_produces_unknown_not_denied() {
        let temp = tempfile::tempdir().unwrap();
        let evidence = inspect(
            temp.path().join("missing").to_string_lossy().into_owned(),
            None,
        )
        .unwrap();
        assert_eq!(evidence.directory_access.create_file, None);
        assert_eq!(evidence.target_access.delete, None);
    }

    #[cfg(windows)]
    #[test]
    fn readonly_file_is_readable_and_removable_but_not_writable() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("readonly.txt");
        std::fs::write(&path, b"unchanged").unwrap();
        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&path, permissions.clone()).unwrap();
        let evidence = inspect(
            temp.path().to_string_lossy().into_owned(),
            Some(path.to_string_lossy().into_owned()),
        );
        permissions.set_readonly(false);
        std::fs::set_permissions(&path, permissions).unwrap();
        let evidence = evidence.unwrap();
        assert_eq!(evidence.target_access.read, Some(true));
        assert_eq!(evidence.target_access.write, Some(false));
        assert_eq!(evidence.target_access.delete, Some(true));
        assert_eq!(std::fs::read(&path).unwrap(), b"unchanged");
        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&path, permissions).unwrap();
        std::fs::remove_file(&path)
            .expect("match the existing local delete operation, including readonly files");
    }
}
