use super::{
    facts, hardening,
    jobs::{Lease, SecurityJobs},
    report::{Admission, HostIdentity, Kind, Report, Request, MAX_REPORT_BYTES},
};
use crate::commands::{shell_quote, AppState};
use std::{sync::Arc, time::Duration};
use tauri::State;
use zeroize::Zeroizing;

/// Match existing administrator-review boundaries; plugin/secondary windows cannot authorize credentials.
fn main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Security assessments are available only in the main window.".into());
    }
    Ok(())
}

/// Bind an explicit run to the current transport, not a later reconnect with the same host id.
#[tauri::command]
pub async fn security_assessment_begin(
    window: tauri::WebviewWindow,
    connection_id: String,
    expected: HostIdentity,
    state: State<'_, AppState>,
    jobs: State<'_, SecurityJobs>,
) -> Result<Admission, String> {
    main_window(&window)?;
    if connection_id == "local" {
        return Err(
            "Open Security on a Linux SSH host. Local assessments are not supported yet.".into(),
        );
    }
    let (session, identity) = {
        let connections = state.connections.lock().await;
        let connection = connections
            .get(&connection_id)
            .ok_or("Connect to this SSH host before starting an assessment.")?;
        let identity = HostIdentity {
            host: connection.config.host.clone(),
            username: connection.config.username.clone(),
            port: connection.config.port,
        };
        identity.verify_expected(&expected)?;
        (
            connection
                .session
                .clone()
                .ok_or("Connect to this SSH host before starting an assessment.")?,
            identity,
        )
    };
    Ok(Admission {
        id: jobs.begin(connection_id, session)?,
        identity,
    })
}
/// Cancellation is idempotent, including before execution claims the registration.
#[tauri::command]
pub fn security_assessment_cancel(
    window: tauri::WebviewWindow,
    id: String,
    jobs: State<'_, SecurityJobs>,
) -> Result<(), String> {
    main_window(&window)?;
    jobs.cancel(&id);
    Ok(())
}

/// Only the main UI may inspect its active assessment's authentication state; no secret is returned.
#[tauri::command]
pub fn security_assessment_needs_password(
    window: tauri::WebviewWindow,
    id: String,
    jobs: State<'_, SecurityJobs>,
) -> Result<bool, String> {
    main_window(&window)?;
    Ok(jobs.needs_password(&id))
}

/// Follow the existing administrator-review pattern: zeroizing native memory, no generic exec or logging.
#[tauri::command]
pub fn security_assessment_authenticate(
    window: tauri::WebviewWindow,
    id: String,
    password: String,
    jobs: State<'_, SecurityJobs>,
) -> Result<(), String> {
    let password = Zeroizing::new(password);
    main_window(&window)?;
    jobs.authenticate(&id, password)
}

/// Only reviewed collectors and fixed arguments can reach the SSH exec boundary.
fn command(kind: Kind, nonce: &str, elevation: bool) -> String {
    let kind = match kind {
        Kind::Hardening => "hardening",
    };
    // GNU timeout's default process group covers ordinary descendants, even if SSH is lost.
    // The empty environment avoids startup hooks, custom PATH and inherited scanner settings.
    format!("exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LC_ALL=C /usr/bin/timeout --signal=TERM --kill-after=2s {}s /bin/sh -c {} sh {} {} {}",
        if elevation { 150 } else { 45 }, shell_quote(include_str!("collect.sh")), kind, shell_quote(nonce), if elevation { "sudo" } else { "user" })
}

/// Drain a single collector channel with explicit status, byte and time bounds; no global lock is held.
async fn collect(
    lease: &Lease<'_>,
    state: &AppState,
    request: &Request,
    jobs: &SecurityJobs,
) -> Result<facts::Facts, String> {
    let mut cancel = lease.cancel.clone();
    let nonce = uuid::Uuid::new_v4().to_string();
    let mut channel = tokio::select! {
        biased;
        _ = async { let _ = cancel.wait_for(|value| *value).await; } => return Err("Assessment cancelled.".into()),
        result = tokio::time::timeout(Duration::from_secs(5), async { lease.session.lock().await.channel_open_session().await }) => {
            result.map_err(|_| "Timed out opening the assessment channel.")?.map_err(|_| "Could not open the assessment channel.")?
        }
    };
    let work = async {
        if *lease.cancel.borrow() || !current(lease, state).await {
            return Err("Assessment cancelled or SSH connection changed.".to_string());
        }
        channel
            .exec(
                true,
                command(request.kind, &nonce, request.elevation_consent),
            )
            .await
            .map_err(|_| "The SSH host refused the assessment collector.")?;
        let mut output = Output::default();
        let mut prompts = super::sudo::Prompts::new(&nonce);
        let mut access = super::access::AccessEvidence::new(&nonce);
        let mut password: Option<Zeroizing<String>> = None;
        loop {
            match channel.wait().await {
                Some(russh::ChannelMsg::Data { data }) => output.push(&data, false)?,
                Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                    output.push(&data, true)?;
                    access.feed(&data)?;
                    if prompts.feed(&data)? {
                        if !request.elevation_consent {
                            return Err(
                                "Unexpected sudo prompt in an unprivileged assessment.".into()
                            );
                        }
                        if password.is_none() {
                            let mut answer = jobs.request_password(&lease.id)?;
                            // Keep draining the owned channel while the human types. A closed/expired
                            // challenge must not receive a secret intended for an earlier sudo process.
                            let wait = async {
                                loop {
                                    tokio::select! {
                                        biased;
                                        message = channel.wait() => match message {
                                            Some(russh::ChannelMsg::Data { data }) => output.push(&data, false)?,
                                            Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                                                output.push(&data, true)?;
                                                access.feed(&data)?;
                                                if prompts.feed(&data)? || !prompts.awaiting() { return Err("Sudo authentication request ended before password submission.".to_string()); }
                                            },
                                            Some(russh::ChannelMsg::Close | russh::ChannelMsg::Eof | russh::ChannelMsg::ExitStatus { .. } | russh::ChannelMsg::ExitSignal { .. } | russh::ChannelMsg::Failure) | None => return Err("Sudo authentication channel ended. No password was sent.".into()),
                                            _ => {},
                                        },
                                        result = &mut answer => return result.map_err(|_| "Sudo password request was cancelled.".to_string()),
                                    }
                                }
                            };
                            password = Some(
                                tokio::time::timeout(Duration::from_secs(90), wait)
                                    .await
                                    .map_err(|_| {
                                        "Sudo password request expired. No password was sent."
                                    })??,
                            );
                        }
                        // Recheck ownership after the human wait, immediately before sending a secret.
                        if *lease.cancel.borrow() || !current(lease, state).await {
                            return Err("Assessment cancelled or SSH connection changed.".into());
                        }
                        let mut line =
                            Zeroizing::new(password.as_ref().unwrap().as_bytes().to_vec());
                        line.push(b'\n');
                        channel
                            .data(line.as_slice())
                            .await
                            .map_err(|_| "Sudo authentication channel closed.")?;
                    }
                }
                Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                    output.exit = Some(exit_status)
                }
                Some(russh::ChannelMsg::ExitSignal { .. } | russh::ChannelMsg::Failure) => {
                    return Err("Assessment collector terminated unexpectedly.".into())
                }
                Some(russh::ChannelMsg::Close) | None => break,
                _ => {}
            }
        }
        let mut facts = output.finish(&nonce, facts::HARDENING_KEYS)?;
        access.apply(&mut facts);
        Ok(facts)
    };
    let monitor = async {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if !current(lease, state).await {
                break;
            }
        }
    };
    let result = tokio::select! {
        biased;
        _ = async { let _ = cancel.wait_for(|value| *value).await; } => Err("Assessment cancelled.".into()),
        _ = monitor => Err("The SSH connection changed. Start a new assessment.".into()),
        result = tokio::time::timeout(Duration::from_secs(if request.elevation_consent { 160 } else { 50 }), work) => result.unwrap_or_else(|_| Err("Host collection timed out. No completed report was published. MFA/TTY-only sudo authentication is unsupported.".into())),
    };
    // Cleanup always precedes releasing admission. A remote timeout remains the independent
    // backstop; SSH signal requests are best effort, not a sandbox.
    if result.is_err() {
        let _ =
            tokio::time::timeout(Duration::from_secs(1), channel.signal(russh::Sig::TERM)).await;
        let _ = tokio::time::timeout(Duration::from_secs(4), async {
            while let Some(message) = channel.wait().await {
                if matches!(
                    message,
                    russh::ChannelMsg::Close
                        | russh::ChannelMsg::ExitStatus { .. }
                        | russh::ChannelMsg::ExitSignal { .. }
                ) {
                    break;
                }
            }
        })
        .await;
        // Do not SIGKILL the timeout supervisor itself: if a server targets only
        // that process, its independent process-group deadline would be lost.
    }
    let _ = tokio::time::timeout(Duration::from_secs(1), channel.eof()).await;
    let _ = tokio::time::timeout(Duration::from_secs(1), channel.close()).await;
    result
}

/// Fence SSH collection and hardening results when cancelled, disconnected or replaced.
#[tauri::command]
pub async fn security_assessment_run(
    window: tauri::WebviewWindow,
    id: String,
    request: Request,
    state: State<'_, AppState>,
    jobs: State<'_, SecurityJobs>,
) -> Result<Report, String> {
    main_window(&window)?;
    let lease = jobs.claim(&id)?;
    let mut cancel = lease.cancel.clone();
    let started = std::time::Instant::now();
    // Collection owns its channel cleanup; do not drop that future on user cancellation.
    let facts = collect(&lease, &state, &request, &jobs).await?;
    let work = async {
        match request.kind {
            Kind::Hardening => hardening::assess(&facts),
        }
    };
    tokio::pin!(work);
    let deadline = tokio::time::sleep(Duration::from_secs(300).saturating_sub(started.elapsed()));
    tokio::pin!(deadline);
    let mut monitor = tokio::time::interval(Duration::from_secs(1));
    loop {
        tokio::select! {
            biased;
            _ = async { let _ = cancel.wait_for(|value| *value).await; } => return Err("Assessment cancelled. No completed report was published.".into()),
            _ = &mut deadline => return Err("Assessment reached its five-minute deadline. No completed report was published.".into()),
            _ = monitor.tick() => {
                if !current(&lease, &state).await { return Err("The SSH connection changed. Start a new assessment.".into()); }
            },
            result = &mut work => {
                let still_current = current(&lease, &state).await;
                if !still_current || *cancel.borrow() { return Err("Assessment cancelled or SSH connection changed.".into()); }
                return result;
            },
        }
    }
}

/// Never accept a report produced by a replaced transport, including reconnects.
async fn current(lease: &Lease<'_>, state: &AppState) -> bool {
    state
        .connections
        .lock()
        .await
        .get(&lease.connection)
        .and_then(|connection| connection.session.as_ref())
        .is_some_and(|session| Arc::ptr_eq(session, &lease.session))
}
#[derive(Default)]
struct Output {
    bytes: Zeroizing<Vec<u8>>,
    stderr: usize,
    exit: Option<u32>,
}
impl Output {
    /// Budget stderr even though it is discarded and never forwarded as a diagnostic.
    fn push(&mut self, bytes: &[u8], stderr: bool) -> Result<(), String> {
        if self
            .bytes
            .len()
            .saturating_add(self.stderr)
            .saturating_add(bytes.len())
            > MAX_REPORT_BYTES
        {
            return Err("Assessment output exceeded its limit.".into());
        }
        if stderr {
            self.stderr += bytes.len();
        } else {
            self.bytes.extend_from_slice(bytes);
        }
        Ok(())
    }
    /// EOF alone cannot turn failed, disconnected or truncated collection into success.
    fn finish(self, nonce: &str, keys: &[&str]) -> Result<facts::Facts, String> {
        match self.exit {
            Some(0) => facts::decode(&self.bytes, nonce, keys),
            Some(65) => Err("Assessments currently support Linux SSH hosts only.".into()),
            Some(124 | 137) => Err("Host collection reached its deadline. No completed report was published.".into()),
            _ => Err("Host collection failed. Linux, /bin/sh and GNU coreutils timeout are required. No scanner or Python installation is needed.".into()),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    /// Output requires explicit successful exit and a shared stderr/stdout budget.
    #[test]
    fn bounded_output_requires_success() {
        assert!(Output::default().finish("nonce", &[]).is_err());
        let mut output = Output::default();
        output.push(&vec![0; MAX_REPORT_BYTES], true).unwrap();
        assert!(output.push(b"x", false).is_err());
        assert!(!command(Kind::Hardening, "nonce", false).contains("python"));
        assert!(command(Kind::Hardening, "nonce", false).contains("--kill-after=2s 45s"));
        assert!(command(Kind::Hardening, "nonce", false).ends_with(" user"));
        assert!(command(Kind::Hardening, "nonce", true).ends_with(" sudo"));
    }
}
