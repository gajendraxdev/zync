//! Internal host-only terminal commands. The SDK never receives input, output,
//! approval tokens or native session IDs. Public worker routing is a later layer.
mod engine;
mod policy;
mod registry;

use super::broker::PluginBrokerState;
use crate::commands::AppState;
use policy::{Launch, Size};
pub use registry::PluginTerminals;
use registry::{Controls, DocumentRegistration, Owner};
use std::sync::{atomic::AtomicBool, Arc};
use std::time::{Duration, Instant};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    AppHandle, Manager, State, WebviewWindow,
};
use tokio::sync::{mpsc, oneshot, watch};

fn host(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Terminal controls are restricted to the main host".into());
    }
    Ok(())
}

/// Package/grant disk work runs off the main thread and outside registry locks.
async fn validate(
    app: &AppHandle,
    state: &AppState,
    owner: &Arc<Owner>,
    charge: bool,
) -> Result<(), String> {
    if !owner.connected(state).await {
        return Err("Terminal server or document changed".into());
    }
    let app = app.clone();
    let runtime = owner.runtime.clone();
    tokio::task::spawn_blocking(move || {
        app.state::<PluginBrokerState>()
            .authorize_terminal(&app, &runtime, charge)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Terminal authorization task failed".to_string())??;
    if !owner.connected(state).await {
        return Err("Terminal server or document changed".into());
    }
    Ok(())
}

/// Sweep abandoned offers and pane leases without requiring iframe cooperation.
pub fn initialize(app: &AppHandle) {
    let registry = app.state::<PluginTerminals>().inner().clone();
    tauri::async_runtime::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_millis(250));
        loop {
            timer.tick().await;
            let _ = registry.with(|registry| {
                registry.sweep(Instant::now());
                Ok(())
            });
        }
    });
}

pub fn clear_all(app: &AppHandle) {
    if let Some(registry) = app.try_state::<PluginTerminals>() {
        registry.reset();
    }
}

/// A new document replaces the previous native owner for the same pane. Call
/// once per iframe generation; IDs are native random capabilities, not UI IDs.
#[tauri::command]
pub async fn plugins_terminal_document_register(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    registry: State<'_, PluginTerminals>,
    runtime_instance_id: String,
    pane_instance_id: String,
) -> Result<serde_json::Value, String> {
    host(&window)?;
    let registration = DocumentRegistration::reserve(
        registry.inner().clone(),
        &runtime_instance_id,
        &pane_instance_id,
    )?;
    let binding_app = app.clone();
    let runtime = runtime_instance_id.clone();
    let pane = pane_instance_id.clone();
    let (connection, binding, active) = tokio::task::spawn_blocking(move || {
        binding_app
            .state::<PluginBrokerState>()
            .terminal_binding(&binding_app, &runtime, &pane)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Terminal binding task failed".to_string())??;
    if connection == "local" {
        return Err("Plugin terminals currently require an SSH workspace".into());
    }
    let (session, generation) = {
        let connections = state.connections.lock().await;
        let connection = connections
            .get(&connection)
            .ok_or("The server is disconnected")?;
        (
            connection
                .session
                .clone()
                .ok_or("The server is disconnected")?,
            connection.reconnect_generation,
        )
    };
    let token = format!("{binding}:{generation}");
    let owner = Arc::new(Owner {
        runtime: runtime_instance_id,
        pane: pane_instance_id,
        connection,
        token: token.clone(),
        generation,
        session: Arc::downgrade(&session),
        binding_active: active,
        document_active: Arc::new(AtomicBool::new(true)),
    });
    let document = registration.complete(owner)?;
    Ok(serde_json::json!({"documentId":document,"connectionToken":token}))
}

#[tauri::command]
pub fn plugins_terminal_document_dispose(
    window: WebviewWindow,
    registry: State<'_, PluginTerminals>,
    document_id: String,
) -> Result<(), String> {
    host(&window)?;
    registry.with(|registry| {
        registry.dispose_document(&document_id);
        Ok(())
    })
}

/// Prepare freezes exact argv before the host confirmation dialog opens.
#[tauri::command]
pub async fn plugins_terminal_prepare(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    registry: State<'_, PluginTerminals>,
    document_id: String,
    request: Launch,
) -> Result<String, String> {
    host(&window)?;
    request.command_line()?;
    let owner = registry.with(|registry| registry.document(&document_id))?;
    validate(&app, &state, &owner, true).await?;
    registry.with(|registry| registry.offer(&document_id, request, Instant::now()))
}

/// Host must invoke only after a Zync-owned foreground confirmation. This is NOT
/// a worker RPC, and a plugin boolean can never substitute for this approval.
#[tauri::command]
pub async fn plugins_terminal_approve(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    registry: State<'_, PluginTerminals>,
    document_id: String,
    offer_id: String,
) -> Result<String, String> {
    host(&window)?;
    let owner = registry.with(|registry| registry.document(&document_id))?;
    validate(&app, &state, &owner, false).await?;
    registry.with(|registry| registry.approve(&document_id, &offer_id, Instant::now()))
}

#[tauri::command]
pub async fn plugins_terminal_start(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    registry: State<'_, PluginTerminals>,
    document_id: String,
    offer_id: String,
    approval_token: String,
    size: Size,
    output: Channel<InvokeResponseBody>,
    events: Channel<serde_json::Value>,
) -> Result<(), String> {
    host(&window)?;
    let size = size.validate()?;
    let (input_tx, input_rx) = mpsc::channel(policy::INPUT_PACKETS);
    let (size_tx, size_rx) = watch::channel(size);
    let (ack_tx, ack_rx) = mpsc::channel(policy::OUTPUT_FRAMES);
    let (cancel_tx, cancel_rx) = watch::channel(false);
    let (done_tx, done_rx) = watch::channel(false);
    let controls = Controls {
        input: input_tx,
        size: size_tx,
        ack: ack_tx,
        cancel: cancel_tx,
        done: done_rx,
    };
    let (owner, launch) = registry.with(|registry| {
        registry.begin(
            &document_id,
            &offer_id,
            &approval_token,
            controls.clone(),
            Instant::now(),
        )
    })?;
    let (started_tx, started_rx) = oneshot::channel();
    engine::spawn(
        app,
        state.inner().clone(),
        registry.inner().clone(),
        engine::TerminalTask {
            id: offer_id,
            owner,
            launch,
            size,
            controls,
            input: input_rx,
            sizes: size_rx,
            acknowledgements: ack_rx,
            cancel: cancel_rx,
            done: done_tx,
            output,
            events,
            started: started_tx,
        },
    );
    started_rx
        .await
        .map_err(|_| "Terminal task ended before startup".to_string())?
}

#[tauri::command]
pub async fn plugins_terminal_write(
    window: WebviewWindow,
    state: State<'_, AppState>,
    registry: State<'_, PluginTerminals>,
    document_id: String,
    terminal_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    host(&window)?;
    if data.is_empty() || data.len() > policy::INPUT_BYTES {
        return Err("Terminal input must contain 1–4096 bytes".into());
    }
    let (owner, controls) =
        registry.with(|registry| registry.controls(&document_id, &terminal_id))?;
    if !owner.connected(&state).await {
        controls.cancel.send_replace(true);
        return Err("Terminal connection changed".into());
    }
    controls.input.try_send(data).map_err(|_| {
        controls.cancel.send_replace(true);
        "Terminal input queue is full or closed".into()
    })
}

#[tauri::command]
pub fn plugins_terminal_resize(
    window: WebviewWindow,
    registry: State<'_, PluginTerminals>,
    document_id: String,
    terminal_id: String,
    size: Size,
) -> Result<(), String> {
    host(&window)?;
    let size = size.validate()?;
    let (_, controls) = registry.with(|registry| registry.controls(&document_id, &terminal_id))?;
    controls.size.send_replace(size);
    Ok(())
}

#[tauri::command]
pub fn plugins_terminal_ack(
    window: WebviewWindow,
    registry: State<'_, PluginTerminals>,
    document_id: String,
    terminal_id: String,
    sequence: u32,
) -> Result<(), String> {
    host(&window)?;
    let (_, controls) = registry.with(|registry| registry.controls(&document_id, &terminal_id))?;
    controls.ack.try_send(sequence).map_err(|_| {
        controls.cancel.send_replace(true);
        "Terminal acknowledgement queue is full or closed".into()
    })
}

#[tauri::command]
pub async fn plugins_terminal_close(
    window: WebviewWindow,
    registry: State<'_, PluginTerminals>,
    document_id: String,
    terminal_id: String,
) -> Result<(), String> {
    host(&window)?;
    if let Some(mut done) = registry.with(|registry| registry.close(&document_id, &terminal_id))? {
        while !*done.borrow_and_update() {
            done.changed()
                .await
                .map_err(|_| "Terminal cleanup task ended unexpectedly")?;
        }
    }
    Ok(())
}
