//! Win32 compatibility: preserve family-specific indices and select TCP egress.

use anyhow::{bail, Result};
use std::{collections::BTreeMap, mem::size_of, os::windows::io::AsRawSocket};
use windows_sys::Win32::{
    Foundation::{ERROR_BUFFER_OVERFLOW, ERROR_NO_DATA, NO_ERROR},
    NetworkManagement::IpHelper::*,
    Networking::WinSock::*,
};

/// Netdev lacks Ipv6IfIndex and enumeration errors; retain only this bounded compatibility lookup.
pub(super) fn family_indices() -> Result<BTreeMap<String, (u32, u32)>> {
    let mut size = 15 * 1024u32;
    for _ in 0..3 {
        if size > 1024 * 1024 {
            bail!("Network adapter list exceeds safety limit");
        }
        let mut buffer = vec![0u64; (size as usize).div_ceil(size_of::<u64>())];
        let first = buffer.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
        // SAFETY: buffer is aligned to u64 and contains at least `size` writable bytes.
        let status = unsafe {
            GetAdaptersAddresses(
                AF_UNSPEC as u32,
                GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER,
                std::ptr::null(),
                first,
                &mut size,
            )
        };
        if status == ERROR_BUFFER_OVERFLOW {
            continue;
        }
        if status == ERROR_NO_DATA {
            return Ok(BTreeMap::new());
        }
        if status != NO_ERROR {
            bail!("Cannot enumerate network adapters (Windows error {status})");
        }
        let mut result = BTreeMap::new();
        let mut current = first;
        // SAFETY: successful GetAdaptersAddresses fills valid linked structures and terminated
        // strings within `buffer`; all values are copied before that allocation is dropped.
        unsafe {
            while !current.is_null() {
                let adapter = &*current;
                let id = std::ffi::CStr::from_ptr(adapter.AdapterName.cast())
                    .to_string_lossy()
                    .into_owned();
                result.insert(
                    id.to_ascii_lowercase(),
                    (adapter.Anonymous1.Anonymous.IfIndex, adapter.Ipv6IfIndex),
                );
                current = adapter.Next;
            }
        }
        return Ok(result);
    }
    bail!("Network adapters changed while enumerating; refresh and try again")
}

/// IPv4 takes a network-order index; IPv6 takes host order. No route-table mutation occurs.
pub(super) fn set_outgoing_interface(
    socket: &tokio::net::TcpSocket,
    ipv4: bool,
    index: u32,
) -> Result<()> {
    let (level, option, value) = if ipv4 {
        (IPPROTO_IP, IP_UNICAST_IF, index.to_be())
    } else {
        (IPPROTO_IPV6, IPV6_UNICAST_IF, index)
    };
    // SAFETY: live socket, correct scalar option size, and `value` outlives the synchronous call.
    let result = unsafe {
        setsockopt(
            socket.as_raw_socket() as SOCKET,
            level,
            option,
            (&value as *const u32).cast(),
            size_of::<u32>() as i32,
        )
    };
    if result == SOCKET_ERROR {
        // SAFETY: reading the thread-local Winsock error immediately after the failed call.
        return Err(std::io::Error::from_raw_os_error(unsafe { WSAGetLastError() }).into());
    }
    Ok(())
}

/// Read back socket policy in regression tests; both getters return a host-order index.
#[cfg(test)]
pub(super) fn outgoing_interface_index(socket: &impl AsRawSocket, ipv4: bool) -> Result<u32> {
    let mut value = 0u32;
    let mut length = size_of::<u32>() as i32;
    // SAFETY: live socket and correctly sized writable scalar buffers.
    let result = unsafe {
        getsockopt(
            socket.as_raw_socket() as SOCKET,
            if ipv4 { IPPROTO_IP } else { IPPROTO_IPV6 },
            if ipv4 { IP_UNICAST_IF } else { IPV6_UNICAST_IF },
            (&mut value as *mut u32).cast(),
            &mut length,
        )
    };
    if result == SOCKET_ERROR {
        // SAFETY: retrieve the thread-local Winsock error immediately after the failed call.
        return Err(std::io::Error::from_raw_os_error(unsafe { WSAGetLastError() }).into());
    }
    if length != size_of::<u32>() as i32 {
        bail!("Unexpected outgoing-interface socket option size");
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn outgoing_interface_options_round_trip_in_each_family() {
        let interfaces = super::super::list().unwrap();
        for ipv4 in [true, false] {
            let Some(adapter) = interfaces.iter().find(|item| {
                item.available
                    && if ipv4 {
                        item.ipv4_index != 0
                    } else {
                        item.ipv6_index != 0
                    }
            }) else {
                continue;
            };
            let index = if ipv4 {
                adapter.ipv4_index
            } else {
                adapter.ipv6_index
            };
            let socket = if ipv4 {
                tokio::net::TcpSocket::new_v4()
            } else {
                tokio::net::TcpSocket::new_v6()
            }
            .unwrap();
            set_outgoing_interface(&socket, ipv4, index).unwrap();
            // Winsock's getter returns the index in host order, unlike the IPv4 setter.
            assert_eq!(outgoing_interface_index(&socket, ipv4).unwrap(), index);
        }
    }
}
