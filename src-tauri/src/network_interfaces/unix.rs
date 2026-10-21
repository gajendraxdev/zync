//! Borrow Tokio sockets for native interface binding; never change routes or elevate the app.

use anyhow::{Context, Result};
use socket2::SockRef;

/// Linux uses the longstanding device-name option; macOS uses family-specific bound indices.
pub(super) fn set_outgoing_interface(
    socket: &tokio::net::TcpSocket,
    ipv4: bool,
    index: u32,
    name: &str,
) -> Result<()> {
    let socket = SockRef::from(socket);
    #[cfg(target_os = "linux")]
    {
        let _ = (ipv4, index);
        socket.bind_device(Some(name.as_bytes()))
            .context("Cannot bind the selected network interface. Check OS permissions and adapter availability; system routing was not used")?;
    }
    #[cfg(target_os = "macos")]
    {
        let _ = name;
        let index = std::num::NonZeroU32::new(index).context("Invalid network interface index")?;
        if ipv4 {
            socket.bind_device_by_index_v4(Some(index))
        } else {
            socket.bind_device_by_index_v6(Some(index))
        }
        .context("Cannot bind the selected network interface; system routing was not used")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn missing_device_binding_fails_without_connecting() {
        let socket = tokio::net::TcpSocket::new_v4().unwrap();
        assert!(set_outgoing_interface(&socket, true, u32::MAX, "zync-missing0").is_err());
    }
}

/// Read the installed socket policy in regression tests without probing a host.
#[cfg(test)]
pub(super) fn outgoing_interface(socket: &tokio::net::TcpStream, ipv4: bool) -> Result<String> {
    let socket = SockRef::from(socket);
    #[cfg(target_os = "linux")]
    {
        let _ = ipv4;
        let name = socket
            .device()?
            .context("Socket has no interface binding")?;
        Ok(String::from_utf8(name)?)
    }
    #[cfg(target_os = "macos")]
    {
        let index = if ipv4 {
            socket.device_index_v4()?
        } else {
            socket.device_index_v6()?
        };
        Ok(index
            .context("Socket has no interface binding")?
            .to_string())
    }
}
