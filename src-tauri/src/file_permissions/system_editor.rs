//! Explicit OS-owned permission editing. Opening a native property sheet is not
//! a write acknowledgement: Windows owns ACL/inheritance/account/UAC interaction.
//! Never accept a verb, executable, parameters, remote path or password from UI.

use super::{Binding, Metadata, Model};
use crate::file_transfers::endpoint::Endpoint;

pub fn supported(path: &str) -> bool {
    super::access::supports_system_editor(path)
}

/// Read current native evidence under existing destination admission before a
/// Windows handoff. This is a path-based UI launch, not immutable-object CAS or a
/// promise that Windows will let the account apply a change in its own dialog.
pub async fn prepare(
    endpoint: &Endpoint,
    binding: Binding,
    expected: &Metadata,
) -> Result<(), String> {
    if !matches!(endpoint, Endpoint::Local)
        || binding.model != Model::Windows
        || binding != expected.binding
        || !expected.system_editor
    {
        return Err("Windows permissions can only be opened for a supported local item".into());
    }
    let fresh = super::inspect(endpoint, binding, &expected.path).await?;
    if fresh != *expected || !fresh.system_editor {
        return Err(
            "The item changed. Refresh permissions before opening Windows settings.".into(),
        );
    }
    Ok(())
}

/// Call only on the host window's GUI thread, with its existing COM/message-loop
/// lifetime. Fixed `properties` is never `open` or `runas`; a document/executable
/// path remains a literal object name and is never executed as a command.
#[cfg(windows)]
pub fn open(path: &str, owner: windows_sys::Win32::Foundation::HWND) -> Result<(), String> {
    invoke(path, owner, |request| {
        if unsafe { windows_sys::Win32::UI::Shell::ShellExecuteExW(request) } == 0 {
            return Err(format!(
                "Could not open Windows Properties: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    })
}

#[cfg(windows)]
fn invoke(
    path: &str,
    owner: windows_sys::Win32::Foundation::HWND,
    show: impl FnOnce(&mut windows_sys::Win32::UI::Shell::SHELLEXECUTEINFOW) -> Result<(), String>,
) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::{
        Shell::{SEE_MASK_FLAG_NO_UI, SEE_MASK_INVOKEIDLIST, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW},
        WindowsAndMessaging::SW_SHOWNORMAL,
    };
    super::validate_path(path)?;
    if owner.is_null() || !super::access::supports_system_editor(path) {
        return Err(
            "Windows Properties requires the host window and a supported local item".into(),
        );
    }
    let path: Vec<u16> = std::ffi::OsStr::new(path)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let verb: Vec<u16> = "properties".encode_utf16().chain(Some(0)).collect();
    let mut request = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_INVOKEIDLIST | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
        hwnd: owner,
        lpVerb: verb.as_ptr(),
        lpFile: path.as_ptr(),
        nShow: SW_SHOWNORMAL,
        ..Default::default()
    };
    // No environment expansion, network-drive reconnection, custom verb or
    // command arguments. NOASYNC completes invocation, not permission editing.
    show(&mut request)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn literal_object_path_only_invokes_properties_without_parameters() {
        use std::ffi::c_void;
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("space ;$() 文件.txt");
        std::fs::write(&path, b"unchanged").unwrap();
        let path_text = path.to_str().unwrap();
        let owner = 1usize as *mut c_void; // Fake HWND never reaches a system API.
        let mut calls = 0;
        invoke(path_text, owner, |request| {
            calls += 1;
            let wide = |pointer: *const u16| unsafe {
                let mut length = 0;
                while *pointer.add(length) != 0 {
                    length += 1;
                }
                String::from_utf16(std::slice::from_raw_parts(pointer, length)).unwrap()
            };
            assert_eq!(wide(request.lpVerb), "properties");
            assert_eq!(wide(request.lpFile), path_text);
            assert!(request.lpParameters.is_null());
            assert!(request.lpDirectory.is_null());
            assert_eq!(request.hwnd, owner);
            Ok(())
        })
        .unwrap();
        assert_eq!(calls, 1);
        assert_eq!(std::fs::read(&path).unwrap(), b"unchanged");
        assert!(invoke(path_text, std::ptr::null_mut(), |_| panic!(
            "invalid owner must not invoke"
        ))
        .is_err());
        assert!(invoke("https://example.invalid/item", owner, |_| panic!(
            "URI must not invoke"
        ))
        .is_err());
        assert!(invoke(path_text, owner, |_| Err("Invocation failed".into())).is_err());
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn local_handoff_has_freshness_checks_and_cannot_become_chmod() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("file.txt");
        std::fs::write(&path, b"original").unwrap();
        let binding = Binding {
            identity: "local-test".into(),
            session: "local".into(),
            model: Model::Windows,
        };
        let expected =
            super::super::inspect(&Endpoint::Local, binding.clone(), path.to_str().unwrap())
                .await
                .unwrap();
        assert!(expected.system_editor);
        prepare(&Endpoint::Local, binding.clone(), &expected)
            .await
            .unwrap();
        assert!(super::super::apply(
            &Endpoint::Local,
            binding.clone(),
            &expected,
            0o777,
            0,
            || async { Ok(()) }
        )
        .await
        .is_err());
        std::fs::write(&path, b"changed size").unwrap();
        assert!(prepare(&Endpoint::Local, binding.clone(), &expected)
            .await
            .is_err());
        let mut wrong = expected.clone();
        wrong.binding.session = "other".into();
        assert!(prepare(&Endpoint::Local, binding, &wrong).await.is_err());
    }
}
