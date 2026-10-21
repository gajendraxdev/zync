//! Device-local SSH egress preferences and bounded interface-aware TCP dialing.
//! This does not change routes, connect VPNs, or redirect DNS queries.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path, sync::Mutex};
use tokio::net::TcpStream;

#[cfg(any(target_os = "linux", target_os = "macos"))]
mod unix;
#[cfg(windows)]
mod windows;

static PREFERENCE_LOCK: Mutex<()> = Mutex::new(());
const MAX_PREFERENCES_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "mode", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Preference {
    #[default]
    Default,
    Ask,
    Interface {
        id: String,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkInterface {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub addresses: Vec<String>,
    pub available: bool,
    pub kind: &'static str,
    #[serde(skip)]
    pub ipv4_index: u32,
    #[serde(skip)]
    pub ipv6_index: u32,
}

/// Enumerate only on demand. Indices are resolved again before each selected-interface dial.
pub(crate) fn list() -> Result<Vec<NetworkInterface>> {
    #[cfg(windows)]
    let indices = windows::family_indices()?;
    let mut interfaces = normalize(netdev::get_interfaces())?;
    #[cfg(windows)]
    enrich_windows_indices(&mut interfaces, &indices);
    interfaces.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
    Ok(interfaces)
}

/// A hot-plug race disables only the unmatched adapter; it must not reuse netdev's single index.
#[cfg(windows)]
fn enrich_windows_indices(
    interfaces: &mut [NetworkInterface],
    indices: &BTreeMap<String, (u32, u32)>,
) {
    for interface in interfaces {
        if let Some(&(v4, v6)) = indices.get(&interface.id.to_ascii_lowercase()) {
            interface.ipv4_index = v4;
            interface.ipv6_index = v6;
        } else {
            interface.available = false;
            interface.ipv4_index = 0;
            interface.ipv6_index = 0;
        }
    }
}

/// Bound only picker output, prioritizing available adapters without limiting dial-time lookup.
pub(crate) fn picker_snapshot(mut interfaces: Vec<NetworkInterface>) -> Vec<NetworkInterface> {
    interfaces.sort_by(|a, b| {
        b.available
            .cmp(&a.available)
            .then(a.name.cmp(&b.name))
            .then(a.id.cmp(&b.id))
    });
    interfaces.truncate(256);
    interfaces
}

/// Preserve native identities and bound per-adapter metadata without rejecting large inventories.
fn normalize(interfaces: Vec<netdev::Interface>) -> Result<Vec<NetworkInterface>> {
    use netdev::{interface::state::OperState, interface::types::InterfaceType};
    if interfaces.is_empty() {
        bail!("No network interfaces were discovered. Enumeration may have failed; refresh and try again");
    }
    interfaces
        .into_iter()
        .map(|item| {
            if item.name.is_empty()
                || item.name.len() > 256
                || item.name.chars().any(char::is_control)
            {
                bail!("Invalid network interface identity");
            }
            let available =
                item.is_up() && matches!(item.oper_state, OperState::Up | OperState::Unknown);
            let kind = match item.if_type {
                InterfaceType::Wireless80211 => "wifi",
                InterfaceType::Ethernet
                | InterfaceType::FastEthernetT
                | InterfaceType::FastEthernetFx
                | InterfaceType::GigabitEthernet => "ethernet",
                InterfaceType::Loopback => "loopback",
                InterfaceType::Tunnel | InterfaceType::Ppp => "tunnel",
                _ => "other",
            };
            let addresses = item
                .ipv4
                .iter()
                .map(|ip| ip.addr().to_string())
                .chain(item.ipv6.iter().map(|ip| ip.addr().to_string()))
                .take(32)
                .collect();
            Ok(NetworkInterface {
                name: item
                    .friendly_name
                    .filter(|name| !name.trim().is_empty())
                    .unwrap_or_else(|| item.name.clone())
                    .chars()
                    .take(256)
                    .collect(),
                description: item
                    .description
                    .filter(|text| !text.trim().is_empty())
                    .map(|text| text.chars().take(256).collect()),
                id: item.name,
                addresses,
                available,
                kind,
                ipv4_index: if item.ipv4.is_empty() { 0 } else { item.index },
                ipv6_index: if item.ipv6.is_empty() { 0 } else { item.index },
            })
        })
        .collect()
}

/// Resolve a stable adapter identity; never substitute another interface or its reused index.
fn selected<'a>(interfaces: &'a [NetworkInterface], id: &str) -> Result<&'a NetworkInterface> {
    interfaces.iter().find(|item| identity_matches(&item.id, id) && item.available)
        .context("Selected network interface is unavailable. Reconnect the adapter or change the host's Network interface setting.")
}

/// Windows GUIDs ignore case; Unix device names must retain their native case-sensitive identity.
fn identity_matches(left: &str, right: &str) -> bool {
    if cfg!(windows) {
        left.eq_ignore_ascii_case(right)
    } else {
        left == right
    }
}

/// Reuse Tokio's normal dial for default routing; selected routing fails closed with a total deadline.
pub(crate) async fn connect(
    host: &str,
    port: u16,
    interface_id: Option<&str>,
) -> Result<TcpStream> {
    let Some(id) = interface_id else {
        return Ok(TcpStream::connect((host, port)).await?);
    };
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = id;
        bail!("SSH network interface selection is not supported on this platform");
    }
    #[cfg(any(windows, target_os = "linux", target_os = "macos"))]
    {
        tokio::time::timeout(std::time::Duration::from_secs(15), async {
            let interfaces = tokio::task::spawn_blocking(list).await??;
            let interface = selected(&interfaces, id)?;
            let addresses = tokio::net::lookup_host((host, port)).await?;
            let mut last_error = None;
            for address in addresses.take(16) {
                let index = if address.is_ipv4() {
                    interface.ipv4_index
                } else {
                    interface.ipv6_index
                };
                if index == 0 {
                    continue;
                }
                let socket = if address.is_ipv4() {
                    tokio::net::TcpSocket::new_v4()?
                } else {
                    tokio::net::TcpSocket::new_v6()?
                };
                #[cfg(windows)]
                let binding = windows::set_outgoing_interface(&socket, address.is_ipv4(), index);
                #[cfg(any(target_os = "linux", target_os = "macos"))]
                let binding =
                    unix::set_outgoing_interface(&socket, address.is_ipv4(), index, &interface.id);
                if let Err(error) = binding {
                    last_error = Some(error);
                    continue;
                }
                match socket.connect(address).await {
                    Ok(stream) => return Ok(stream),
                    Err(error) => last_error = Some(error.into()),
                }
            }
            Err(last_error.unwrap_or_else(|| {
                anyhow::anyhow!("Selected interface has no usable address family for this host")
            }))
        })
        .await
        .context("Connection through selected network interface timed out")?
    }
}

/// Read one device-only preference without adding adapter identifiers to host sync/export.
pub(crate) fn get_preference(data_dir: &Path, connection_id: &str) -> Result<Preference> {
    let _guard = PREFERENCE_LOCK
        .lock()
        .map_err(|_| anyhow::anyhow!("Network preferences lock failed"))?;
    Ok(read_preferences(data_dir)?
        .remove(connection_id)
        .unwrap_or_default())
}

/// Serialize updates and reuse the application's durable replacement implementation.
pub(crate) fn set_preference(
    data_dir: &Path,
    connection_id: &str,
    preference: Preference,
) -> Result<()> {
    if connection_id.is_empty() || connection_id.len() > 256 {
        bail!("Invalid connection identity");
    }
    if let Preference::Interface { id } = &preference {
        if id.is_empty() || id.len() > 256 || id.chars().any(char::is_control) {
            bail!("Invalid network interface identity");
        }
    }
    let _guard = PREFERENCE_LOCK
        .lock()
        .map_err(|_| anyhow::anyhow!("Network preferences lock failed"))?;
    let mut preferences = read_preferences(data_dir)?;
    if preference == Preference::Default {
        preferences.remove(connection_id);
    } else {
        preferences.insert(connection_id.to_owned(), preference);
    }
    if preferences.len() > 4096 {
        bail!("Too many device network preferences");
    }
    let bytes = serde_json::to_vec_pretty(&preferences)?;
    if bytes.len() as u64 > MAX_PREFERENCES_BYTES {
        bail!("Network preferences exceed size limit");
    }
    crate::atomic_io::durable_replace(&data_dir.join("ssh-network-preferences.json"), &bytes)?;
    Ok(())
}

/// Corrupt or unknown preferences are errors, not permission to fall back to system routing.
fn read_preferences(data_dir: &Path) -> Result<BTreeMap<String, Preference>> {
    use std::io::Read;
    let file = match std::fs::File::open(data_dir.join("ssh-network-preferences.json")) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Err(error) => return Err(error.into()),
    };
    let mut bytes = Vec::new();
    file.take(MAX_PREFERENCES_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_PREFERENCES_BYTES {
        bail!("Network preferences exceed size limit");
    }
    serde_json::from_slice(&bytes).context("Cannot read device network preferences")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// OS-free snapshot exercises both families without inspecting the developer's adapters.
    fn fixture_interface() -> netdev::Interface {
        let mut interface = netdev::Interface::dummy();
        interface.name = "fixture0".into();
        interface.index = 9;
        interface.flags = netdev::interface::flags::IFF_UP as u32;
        interface.if_type = netdev::interface::types::InterfaceType::Ethernet;
        interface.ipv4 = vec!["192.0.2.5/24".parse().unwrap()];
        interface.ipv6 = vec!["fe80::12/64".parse().unwrap()];
        interface
    }

    #[test]
    fn discovery_preserves_identity_families_and_os_metadata() {
        let mut fixture = fixture_interface();
        fixture.friendly_name = Some("Ethernet 3".into());
        fixture.description = Some("Virtual VPN driver".into());
        let result = normalize(vec![fixture]).unwrap();
        let item = &result[0];
        assert_eq!(item.id, "fixture0");
        assert_eq!(item.name, "Ethernet 3");
        assert_eq!(item.description.as_deref(), Some("Virtual VPN driver"));
        assert_eq!(item.kind, "ethernet"); // A VPN-like name is not proof of interface type.
        assert_eq!(item.addresses, ["192.0.2.5", "fe80::12"]);
        assert!(item.available);
        assert_eq!((item.ipv4_index, item.ipv6_index), (9, 9));
        let mut down = fixture_interface();
        down.oper_state = netdev::interface::state::OperState::Down;
        assert!(!normalize(vec![down]).unwrap()[0].available);
        let mut v6 = fixture_interface();
        v6.ipv4.clear();
        v6.friendly_name = Some(String::new());
        let v6 = normalize(vec![v6]).unwrap().remove(0);
        assert_eq!(v6.name, "fixture0");
        assert_eq!((v6.ipv4_index, v6.ipv6_index), (0, 9));
    }

    #[test]
    fn discovery_bounds_snapshots_and_does_not_hide_empty_or_invalid_results() {
        assert!(normalize(vec![]).is_err());
        let mut invalid = fixture_interface();
        invalid.name = "bad\0name".into();
        assert!(normalize(vec![invalid]).is_err());
        let mut large = fixture_interface();
        large.ipv4 = vec!["192.0.2.1/24".parse().unwrap(); 100];
        large.description = Some("a".repeat(1000));
        let large = normalize(vec![large]).unwrap().remove(0);
        assert_eq!(large.addresses.len(), 32);
        assert_eq!(large.description.unwrap().len(), 256);
    }

    #[test]
    fn picker_limit_does_not_limit_selected_adapter_lookup() {
        let fixtures = (0..300)
            .map(|index| {
                let mut item = fixture_interface();
                item.name = format!("fixture-{index:03}");
                item
            })
            .collect();
        let mut full = normalize(fixtures).unwrap();
        assert_eq!(full.len(), 300);
        let snapshot = picker_snapshot(full.clone());
        assert_eq!(snapshot.len(), 256);
        assert!(!snapshot.iter().any(|item| item.id == "fixture-299"));
        assert!(selected(&full, "fixture-299").is_ok());
        for (index, item) in full.iter_mut().enumerate() {
            item.available = index >= 280;
        }
        let snapshot = picker_snapshot(full);
        assert_eq!(snapshot.len(), 256);
        assert!(snapshot[..20].iter().all(|item| item.available));
        assert!(snapshot[20..].iter().all(|item| !item.available));
        assert_eq!(snapshot[0].id, "fixture-280");
        assert_eq!(snapshot[20].id, "fixture-000");
    }

    #[cfg(windows)]
    #[test]
    fn missing_windows_enrichment_disables_only_the_unmatched_adapter() {
        let mut interfaces = normalize(vec![fixture_interface()]).unwrap();
        interfaces.push(NetworkInterface {
            id: "gone".into(),
            ..interfaces[0].clone()
        });
        enrich_windows_indices(
            &mut interfaces,
            &BTreeMap::from([("fixture0".into(), (7, 9))]),
        );
        assert!(selected(&interfaces, "fixture0").is_ok());
        assert_eq!((interfaces[0].ipv4_index, interfaces[0].ipv6_index), (7, 9));
        assert!(!interfaces[1].available);
        assert_eq!((interfaces[1].ipv4_index, interfaces[1].ipv6_index), (0, 0));
        assert!(selected(&interfaces, "gone").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn discovery_retains_windows_family_specific_indices() {
        let indices = windows::family_indices().unwrap();
        for item in list().unwrap() {
            assert_eq!(
                (item.ipv4_index, item.ipv6_index),
                indices[&item.id.to_ascii_lowercase()]
            );
        }
    }

    #[test]
    fn preferences_round_trip_locally_and_do_not_hide_corrupt_data() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            get_preference(dir.path(), "host").unwrap(),
            Preference::Default
        );
        set_preference(
            dir.path(),
            "host",
            Preference::Interface {
                id: "stable-guid".into(),
            },
        )
        .unwrap();
        set_preference(dir.path(), "other", Preference::Ask).unwrap();
        assert_eq!(
            get_preference(dir.path(), "host").unwrap(),
            Preference::Interface {
                id: "stable-guid".into()
            }
        );
        set_preference(dir.path(), "host", Preference::Default).unwrap();
        assert_eq!(
            get_preference(dir.path(), "other").unwrap(),
            Preference::Ask
        );
        std::fs::write(dir.path().join("ssh-network-preferences.json"), "corrupt").unwrap();
        assert!(get_preference(dir.path(), "host").is_err());
    }

    #[test]
    fn stable_identity_does_not_fall_back_to_another_adapter() {
        let interfaces = [NetworkInterface {
            id: "new-guid".into(),
            name: "VPN".into(),
            description: None,
            addresses: vec![],
            available: true,
            kind: "other",
            ipv4_index: 7,
            ipv6_index: 9,
        }];
        assert!(selected(&interfaces, "old-guid").is_err());
        assert_eq!(selected(&interfaces, "NEW-GUID").is_ok(), cfg!(windows));
        let down = [NetworkInterface {
            available: false,
            ..interfaces[0].clone()
        }];
        assert!(selected(&down, "new-guid").is_err());
    }

    #[tokio::test]
    async fn default_dial_uses_existing_tcp_path() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let stream = connect("127.0.0.1", address.port(), None).await.unwrap();
        assert_eq!(stream.peer_addr().unwrap(), address);
    }

    #[cfg(any(windows, target_os = "linux", target_os = "macos"))]
    #[tokio::test]
    async fn selected_loopback_retains_interface_on_connected_socket() {
        let interfaces = list().unwrap();
        let loopback = interfaces
            .iter()
            .find(|item| item.available && item.kind == "loopback" && item.ipv4_index != 0)
            .expect("IPv4 loopback adapter");
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let stream = connect("127.0.0.1", address.port(), Some(&loopback.id))
            .await
            .unwrap();
        #[cfg(windows)]
        assert_eq!(
            windows::outgoing_interface_index(&stream, true).unwrap(),
            loopback.ipv4_index
        );
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        assert_eq!(
            unix::outgoing_interface(&stream, true).unwrap(),
            if cfg!(target_os = "linux") {
                loopback.id.clone()
            } else {
                loopback.ipv4_index.to_string()
            }
        );
        assert!(stream.local_addr().unwrap().ip().is_loopback());
        assert_eq!(stream.peer_addr().unwrap(), address);
    }

    #[cfg(any(windows, target_os = "linux", target_os = "macos"))]
    #[tokio::test]
    async fn unavailable_selected_adapter_never_uses_default_route() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        assert!(connect(
            "127.0.0.1",
            listener.local_addr().unwrap().port(),
            Some("nonexistent-zync-fixture-adapter")
        )
        .await
        .is_err());
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(25), listener.accept())
                .await
                .is_err()
        );
    }
}
