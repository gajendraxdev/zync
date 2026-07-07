use crate::commands::{get_data_dir, AppState};
use super::{remote_forward_map_key, tunnel_runtime_id};
use crate::types::{SavedTunnel, SavedTunnelsData};
use serde::Serialize;
use std::collections::HashSet;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Serialize, Clone)]
pub struct TunnelStatusChange {
    pub id: String,
    pub status: String,
    pub error: Option<String>,
}

pub(crate) async fn stop_tunnels_for_connections(
    app: &AppHandle,
    state: &AppState,
    connection_ids: &[String],
) -> Result<(), String> {
    if connection_ids.is_empty() {
        return Ok(());
    }

    let data_dir = get_data_dir(app);
    let file_path = data_dir.join("tunnels.json");
    if !file_path.exists() {
        return Ok(());
    }

    let data = std::fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    let saved_data: SavedTunnelsData = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    let connection_id_set: HashSet<&str> = connection_ids.iter().map(String::as_str).collect();
    let tunnels = saved_data
        .tunnels
        .into_iter()
        .filter(|t| connection_id_set.contains(t.connection_id.as_str()))
        .collect::<Vec<_>>();

    for tunnel in tunnels {
        let session = {
            let connections = state.connections.lock().await;
            connections
                .get(&tunnel.connection_id)
                .and_then(|c| c.session.clone())
        };
        let result = state
            .tunnel_manager
            .stop_tunnel(session, &tunnel)
            .await;

        let (status, error) = match result {
            Ok(()) => ("stopped".to_string(), None),
            Err(error) => ("error".to_string(), Some(error.to_string())),
        };
        let _ = app.emit(
            "tunnel:status-change",
            TunnelStatusChange {
                id: tunnel.id,
                status,
                error,
            },
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn tunnel_start_local(
    connection_id: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    bind_address: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let session = {
        let connections = state.connections.lock().await;
        connections
            .get(&connection_id)
            .and_then(|c| c.session.clone())
            .ok_or_else(|| format!("Connection {} not found", connection_id))?
    };

    let bind_addr = bind_address.unwrap_or_else(|| "127.0.0.1".to_string());
    let runtime_id = format!(
        "local:{}:{}:{}:{}",
        connection_id,
        local_port,
        remote_host.replace(':', "_"),
        remote_port
    );

    let res: anyhow::Result<String> = state
        .tunnel_manager
        .start_local_forwarding(
            session,
            runtime_id,
            bind_addr,
            local_port,
            remote_host,
            remote_port,
        )
        .await;
    res.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn tunnel_start_remote(
    connection_id: String,
    remote_port: u16,
    local_host: String,
    local_port: u16,
    bind_address: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let session = {
        let connections = state.connections.lock().await;
        connections
            .get(&connection_id)
            .and_then(|c| c.session.clone())
            .ok_or_else(|| format!("Connection {} not found", connection_id))?
    };

    let bind_addr = bind_address.unwrap_or_else(|| "0.0.0.0".to_string());
    let runtime_id = format!(
        "remote:{}:{}:{}:{}",
        connection_id,
        remote_port,
        local_host.replace(':', "_"),
        local_port
    );

    let res: anyhow::Result<String> = state
        .tunnel_manager
        .start_remote_forwarding(
            session,
            connection_id,
            runtime_id,
            bind_addr,
            remote_port,
            local_host,
            local_port,
        )
        .await;
    res.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn tunnel_stop(
    app: AppHandle,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let data_dir = get_data_dir(&app);
    let file_path = data_dir.join("tunnels.json");
    if !file_path.exists() {
        return Ok(());
    }
    let data = std::fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    let saved_data: SavedTunnelsData = serde_json::from_str(&data).map_err(|e| e.to_string())?;

    let tunnel = saved_data
        .tunnels
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| "Tunnel key not found".to_string())?;

    let session = {
        let connections = state.connections.lock().await;
        connections
            .get(&tunnel.connection_id)
            .and_then(|c| c.session.clone())
    };

    println!(
        "[TUNNEL CMD] Stopping tunnel: runtime_id={}",
        tunnel_runtime_id(&tunnel)
    );
    let res = state
        .tunnel_manager
        .stop_tunnel(session, &tunnel)
        .await;

    if let Err(ref e) = res {
        let _ = app.emit(
            "tunnel:status-change",
            TunnelStatusChange {
                id: id.clone(),
                status: "error".to_string(),
                error: Some(e.to_string()),
            },
        );
    } else {
        let _ = app.emit(
            "tunnel:status-change",
            TunnelStatusChange {
                id: id.clone(),
                status: "stopped".to_string(),
                error: None,
            },
        );
    }

    res.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn tunnel_list(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<SavedTunnel>, String> {
    let data_dir = get_data_dir(&app);
    let file_path = data_dir.join("tunnels.json");

    if !file_path.exists() {
        return Ok(vec![]);
    }

    let data = std::fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    let saved_data: SavedTunnelsData = serde_json::from_str(&data).map_err(|e| e.to_string())?;

    let mut tunnels: Vec<SavedTunnel> = saved_data
        .tunnels
        .into_iter()
        .filter(|t| t.connection_id == connection_id)
        .collect();

    let local_listeners = state.tunnel_manager.local_listeners.lock().await;
    let remote_forwards = state.tunnel_manager.remote_forwards.lock().await;

    for t in &mut tunnels {
        let is_active = if t.tunnel_type == "local" {
            let id = tunnel_runtime_id(t);
            local_listeners.contains_key(&id)
        } else {
            let key = remote_forward_map_key(&t.connection_id, t.remote_port);
            remote_forwards.contains_key(&key)
        };

        if is_active {
            t.status = Some("active".to_string());
        } else {
            t.status = Some("stopped".to_string());
        }
    }

    Ok(tunnels)
}

#[tauri::command]
pub async fn tunnel_save(app: AppHandle, tunnel_val: serde_json::Value) -> Result<(), String> {
    let mut tunnel: SavedTunnel = serde_json::from_value(tunnel_val).map_err(|e| e.to_string())?;
    let data_dir = get_data_dir(&app);
    if !data_dir.exists() {
        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    }
    let file_path = data_dir.join("tunnels.json");

    let _guard = crate::sync::domain_tunnels::TUNNELS_MUTATION_LOCK
        .lock()
        .map_err(|error| error.to_string())?;
    let mut saved = crate::sync::domain_tunnels::load_saved_tunnels(&file_path)
        .map_err(|error| error.to_string())?;

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    if let Some(idx) = saved.tunnels.iter().position(|t| t.id == tunnel.id) {
        tunnel.created_at = saved.tunnels[idx]
            .created_at
            .or(tunnel.created_at)
            .or(Some(now_ms));
        tunnel.updated_at = Some(now_ms);
        saved.tunnels[idx] = tunnel;
    } else {
        tunnel.created_at = tunnel.created_at.or(Some(now_ms));
        tunnel.updated_at = Some(now_ms);
        saved.tunnels.push(tunnel);
    }

    crate::sync::domain_tunnels::write_saved_tunnels_atomic(&file_path, &saved)
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn tunnel_delete(app: AppHandle, id: String) -> Result<(), String> {
    let data_dir = get_data_dir(&app);
    let file_path = data_dir.join("tunnels.json");

    if !file_path.exists() {
        return Ok(());
    }

    let _guard = crate::sync::domain_tunnels::TUNNELS_MUTATION_LOCK
        .lock()
        .map_err(|error| error.to_string())?;
    let mut saved = crate::sync::domain_tunnels::load_saved_tunnels(&file_path)
        .map_err(|error| error.to_string())?;

    saved.tunnels.retain(|t| t.id != id);

    crate::sync::domain_tunnels::write_saved_tunnels_atomic(&file_path, &saved)
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn tunnel_start(
    app: AppHandle,
    id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let data_dir = get_data_dir(&app);
    let file_path = data_dir.join("tunnels.json");
    if !file_path.exists() {
        return Err("Tunnels file not found".to_string());
    }
    let data = std::fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    let saved_data: SavedTunnelsData = serde_json::from_str(&data).map_err(|e| e.to_string())?;

    let tunnel = saved_data
        .tunnels
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| "Tunnel not found".to_string())?;

    let session = {
        let connections = state.connections.lock().await;
        connections
            .get(&tunnel.connection_id)
            .and_then(|c| c.session.clone())
            .ok_or_else(|| {
                format!(
                    "Connection {} not found or session closed",
                    tunnel.connection_id
                )
            })?
    };

    let runtime_id = tunnel_runtime_id(&tunnel);
    let res = if tunnel.tunnel_type == "local" {
        let bind_addr = tunnel
            .bind_address
            .clone()
            .unwrap_or_else(|| "127.0.0.1".to_string());
        state
            .tunnel_manager
            .start_local_forwarding(
                session,
                runtime_id,
                bind_addr,
                tunnel.local_port,
                tunnel.remote_host.clone(),
                tunnel.remote_port,
            )
            .await
    } else {
        let bind_addr = tunnel
            .bind_address
            .clone()
            .unwrap_or_else(|| "0.0.0.0".to_string());
        state
            .tunnel_manager
            .start_remote_forwarding(
                session,
                tunnel.connection_id.clone(),
                runtime_id,
                bind_addr,
                tunnel.remote_port,
                tunnel.remote_host.clone(),
                tunnel.local_port,
            )
            .await
    };

    if let Err(ref e) = res {
        let _ = app.emit(
            "tunnel:status-change",
            TunnelStatusChange {
                id: id.clone(),
                status: "error".to_string(),
                error: Some(e.to_string()),
            },
        );
    } else {
        let _ = app.emit(
            "tunnel:status-change",
            TunnelStatusChange {
                id: id.clone(),
                status: "active".to_string(),
                error: None,
            },
        );
    }

    res.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn tunnel_get_all(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<SavedTunnel>, String> {
    let data_dir = get_data_dir(&app);
    let file_path = data_dir.join("tunnels.json");

    if !file_path.exists() {
        return Ok(vec![]);
    }

    let data = std::fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    let saved_data: SavedTunnelsData = serde_json::from_str(&data).map_err(|e| e.to_string())?;

    let mut tunnels = saved_data.tunnels;

    let local_listeners = state.tunnel_manager.local_listeners.lock().await;
    let remote_forwards = state.tunnel_manager.remote_forwards.lock().await;

    for t in &mut tunnels {
        let is_active = if t.tunnel_type == "local" {
            local_listeners.contains_key(&tunnel_runtime_id(t))
        } else {
            let key = remote_forward_map_key(&t.connection_id, t.remote_port);
            remote_forwards.contains_key(&key)
        };

        if is_active {
            t.status = Some("active".to_string());
        } else {
            t.status = Some("stopped".to_string());
        }
    }

    Ok(tunnels)
}