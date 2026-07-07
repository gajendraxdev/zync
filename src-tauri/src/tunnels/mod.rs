//! Tunnel IPC layer — Tauri commands for port forwarding.
//!
//! Runtime engine: `crate::tunnel::TunnelManager`
//! Persistence/sync: `crate::sync::domain_tunnels`

pub mod commands;

pub(crate) use commands::stop_tunnels_for_connections;