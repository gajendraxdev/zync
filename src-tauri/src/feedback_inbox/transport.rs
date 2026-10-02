//! Fixed-route authenticated transport. Renderer input never selects a host or
//! supplies credentials; redirects are forbidden and all response buffers bounded.

use super::{credential, Credential};
use futures_util::StreamExt;
use rand_core::RngCore;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::Duration;
use tauri::{Emitter, Manager};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(70);
const MAX_JSON_BYTES: usize = 2 * 1024 * 1024;
const MAX_FRAME_BYTES: usize = 8192;

pub struct TransportState {
    client: reqwest::Client,
    generation: AtomicU64,
    task: Mutex<Option<tokio::task::AbortHandle>>,
}

impl Default for TransportState {
    fn default() -> Self {
        Self {
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(10))
                .build()
                .expect("inbox HTTP client"),
            generation: AtomicU64::new(0),
            task: Mutex::new(None),
        }
    }
}

/// Compile-time feature gate; no network activity when the release has not opted in.
pub(super) fn enabled() -> bool {
    option_env!("VITE_FEEDBACK_INBOX_ENABLED") == Some("true")
}

fn api_base() -> Result<reqwest::Url, String> {
    validate_base(
        option_env!("VITE_ANALYTICS_API_URL")
            .or(option_env!("VITE_SURVEY_API_URL"))
            .unwrap_or("http://127.0.0.1:8090"),
    )
}

fn validate_base(raw: &str) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(raw).map_err(|_| "Invalid analytics API URL")?;
    let local = match url.host_str() {
        Some("localhost") => true,
        Some(host) => host
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false),
        None => false,
    };
    if !(url.scheme() == "https" || url.scheme() == "http" && local)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("Analytics inbox URL must be an HTTPS origin (HTTP only on loopback)".into());
    }
    url.set_path("/");
    Ok(url)
}

fn check_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Feedback inbox is restricted to the main window".into());
    }
    if !enabled() {
        return Err("Feedback inbox is not enabled in this build".into());
    }
    Ok(())
}

async fn load(create: bool) -> Result<Option<Credential>, String> {
    tauri::async_runtime::spawn_blocking(move || credential(create))
        .await
        .map_err(|_| "Feedback credential task failed".to_string())?
}

fn uuid_path(raw: &str) -> Result<String, String> {
    let id = uuid::Uuid::parse_str(raw).map_err(|_| "Invalid conversation identifier")?;
    if id.is_nil() || id.to_string() != raw {
        return Err("Invalid conversation identifier".into());
    }
    Ok(id.to_string())
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Operation {
    FollowUp {
        thread: String,
        id: String,
        #[serde(rename = "replyTo")]
        reply_to: String,
        message: String,
    },
    Snapshot {
        #[serde(default)]
        before: i64,
    },
    Replies {
        thread: String,
        #[serde(default)]
        after: i64,
    },
    Submit {
        #[serde(rename = "submissionId")]
        submission_id: String,
        feedback: Value,
    },
    SubmitSurvey {
        #[serde(rename = "submissionId")]
        submission_id: String,
        survey: Value,
    },
    ClaimLegacySurveys {
        #[serde(rename = "installId")]
        install_id: String,
    },
    Read {
        reply: String,
    },
    Close {
        thread: String,
    },
}

/// Fixed-route request builder also rejects malformed cursors before any network call.
fn route(operation: Operation) -> Result<(&'static str, String, Option<Value>), String> {
    Ok(match operation {
        Operation::FollowUp {
            thread,
            id,
            reply_to,
            message,
        } => {
            let message = message.trim();
            if message.is_empty() || message.chars().count() > 4000 {
                return Err("Reply must contain 1–4000 characters".into());
            }
            (
                "POST",
                format!("/threads/{}/replies", uuid_path(&thread)?),
                Some(
                    json!({"id":uuid_path(&id)?,"replyTo":uuid_path(&reply_to)?,"message":message}),
                ),
            )
        }
        Operation::Snapshot { before } if before >= 0 => ("GET", format!("?before={before}"), None),
        Operation::Replies { thread, after } if after >= 0 => (
            "GET",
            format!("/threads/{}/replies?after={after}", uuid_path(&thread)?),
            None,
        ),
        Operation::Read { reply } => (
            "POST",
            format!("/replies/{}/read", uuid_path(&reply)?),
            None,
        ),
        Operation::Close { thread } => (
            "POST",
            format!("/threads/{}/close", uuid_path(&thread)?),
            None,
        ),
        Operation::Submit {
            submission_id,
            feedback,
        } => submission_route(submission_id, feedback, "/submissions", 32768)?,
        Operation::SubmitSurvey {
            submission_id,
            survey,
        } => submission_route(submission_id, survey, "/surveys", 8192)?,
        Operation::ClaimLegacySurveys { install_id } => {
            // Stored installation IDs historically allowed uppercase hex. They
            // are JSON data, not route segments; preserve their original casing.
            let parsed = uuid::Uuid::parse_str(&install_id)
                .map_err(|_| "Invalid installation identifier")?;
            if parsed.is_nil() || !parsed.to_string().eq_ignore_ascii_case(&install_id) {
                return Err("Invalid installation identifier".into());
            }
            (
                "POST",
                "/legacy-surveys".into(),
                Some(json!({"installId": install_id})),
            )
        }
        _ => return Err("Invalid inbox cursor".into()),
    })
}

/// Both submission sources use identical acknowledgement and credential rules;
/// only their fixed endpoint and existing payload size limit differ.
fn submission_route(
    id: String,
    payload: Value,
    path: &str,
    limit: usize,
) -> Result<(&'static str, String, Option<Value>), String> {
    let mut body = payload
        .as_object()
        .cloned()
        .ok_or("Submission must be an object")?;
    body.insert("submissionId".into(), Value::String(uuid_path(&id)?));
    let value = Value::Object(body);
    if serde_json::to_vec(&value)
        .map_err(|_| "Invalid submission")?
        .len()
        > limit
    {
        return Err("Submission is too large".into());
    }
    Ok(("POST", path.into(), Some(value)))
}

fn status_error(status: reqwest::StatusCode) -> String {
    match status.as_u16() {
        401 => "Inbox access was rejected. Do not reset credentials; contact support.".into(),
        404 => "Inbox or conversation unavailable. The backend may not support replies yet.".into(),
        409 => "Conversation closed or retry content changed. Refresh and try again.".into(),
        429 => "Too many inbox requests. Please try again later.".into(),
        _ => format!("Feedback inbox request failed ({})", status.as_u16()),
    }
}

#[tauri::command]
pub async fn feedback_inbox_request(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, TransportState>,
    operation: Operation,
) -> Result<Value, String> {
    check_window(&window)?;
    let create = matches!(
        &operation,
        Operation::Submit { .. }
            | Operation::SubmitSurvey { .. }
            | Operation::ClaimLegacySurveys { .. }
    );
    let snapshot = matches!(&operation, Operation::Snapshot { .. });
    let accepts_no_content = matches!(&operation, Operation::Read { .. } | Operation::Close { .. });
    let submission_id = match &operation {
        Operation::Submit { submission_id, .. } | Operation::SubmitSurvey { submission_id, .. } => {
            Some(submission_id.clone())
        }
        _ => None,
    };
    let claim = matches!(&operation, Operation::ClaimLegacySurveys { .. });
    let (method, suffix, body) = route(operation)?;
    let Some(secret) = load(create).await? else {
        return if snapshot {
            Ok(json!({"threads":[],"unread":0,"active":false,"nextBefore":0}))
        } else {
            Err("Inbox credentials are unavailable; the action was not performed".into())
        };
    };
    let url = api_base()?
        .join(&format!("api/v1/inbox/{}{}", secret.id, suffix))
        .map_err(|_| "Invalid inbox URL")?;
    let mut request = state
        .client
        .request(reqwest::Method::from_bytes(method.as_bytes()).unwrap(), url)
        .bearer_auth(&secret.token)
        .timeout(REQUEST_TIMEOUT);
    if let Some(value) = body {
        request = request.json(&value);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "Could not reach feedback inbox")?;
    if !response.status().is_success() {
        // An opt-in credential can outlive a failed first submission. Probe once
        // on startup to recover a committed submission whose acknowledgement was
        // lost, but do not start SSE for an identity the server never enrolled.
        if snapshot && !secret.registered && response.status() == reqwest::StatusCode::UNAUTHORIZED
        {
            return Ok(json!({"threads":[],"unread":0,"active":false,"nextBefore":0}));
        }
        return Err(status_error(response.status()));
    }
    if response.status() == reqwest::StatusCode::NO_CONTENT {
        return no_content_response(accepts_no_content);
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "Could not read feedback inbox")?;
        if bytes.len() + chunk.len() > MAX_JSON_BYTES {
            return Err("Inbox response exceeded its limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid feedback inbox response")?;
    if let Some(id) = submission_id {
        if value.get("id").and_then(Value::as_str) != Some(id.as_str())
            || value.get("status").and_then(Value::as_str) != Some("accepted")
        {
            return Err("Invalid feedback acknowledgement".into());
        }
    }
    if claim
        && (value.get("status").and_then(Value::as_str) != Some("accepted")
            || !value.get("claimed").is_some_and(Value::is_u64))
    {
        return Err("Invalid legacy survey claim acknowledgement".into());
    }
    if create || snapshot && !secret.registered {
        let owner = secret.id;
        tauri::async_runtime::spawn_blocking(move || super::mark_registered(&owner))
            .await
            .map_err(|_| "Could not save inbox enrollment".to_string())??;
    }
    Ok(value)
}

/// Only acknowledgement-free mutations may succeed without a response body.
fn no_content_response(accepts_no_content: bool) -> Result<Value, String> {
    if accepts_no_content {
        Ok(Value::Null)
    } else {
        Err("Unexpected empty feedback inbox response".into())
    }
}

/// Replaces/cancels the sole app-level subscription. A generation guard prevents
/// an old task from emitting after disable or an explicit restart.
#[tauri::command]
pub async fn feedback_inbox_stream(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, TransportState>,
    active: bool,
) -> Result<(), String> {
    check_window(&window)?;
    // Advance ownership and cancel under the same lock: an older concurrent
    // invocation must never abort a task installed by a newer generation.
    let generation = {
        let mut task_slot = state.task.lock().map_err(|_| "Inbox task unavailable")?;
        let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
        if let Some(task) = task_slot.take() {
            task.abort();
        }
        generation
    };
    if !active {
        return Ok(());
    }
    let Some(secret) = load(false).await? else {
        return Ok(());
    };
    if !secret.registered {
        return Ok(());
    }
    let url = api_base()?
        .join(&format!("api/v1/inbox/{}/events", secret.id))
        .map_err(|_| "Invalid inbox URL")?;
    let client = state.client.clone();
    let app = window.app_handle().clone();
    let mut task_slot = state.task.lock().map_err(|_| "Inbox task unavailable")?;
    if state.generation.load(Ordering::SeqCst) != generation {
        return Ok(());
    }
    let task = tauri::async_runtime::spawn(async move {
        stream_loop(app, client, secret.token, url, generation).await;
    });
    *task_slot = Some(task.inner().abort_handle());
    Ok(())
}

fn current(app: &tauri::AppHandle, generation: u64) -> bool {
    app.state::<TransportState>()
        .generation
        .load(Ordering::SeqCst)
        == generation
}
fn notify(app: &tauri::AppHandle, generation: u64, event: &str) {
    if current(app, generation) {
        let _ = app.emit_to("main", event, ());
    }
}

/// SSE notifications invalidate snapshots; they are never treated as durable
/// replies. Every reconnect invalidates again to recover missed commits.
async fn stream_loop(
    app: tauri::AppHandle,
    client: reqwest::Client,
    token: String,
    url: reqwest::Url,
    generation: u64,
) {
    let mut failures: u32 = 0;
    while current(&app, generation) {
        let response = tokio::time::timeout(
            REQUEST_TIMEOUT,
            client
                .get(url.clone())
                .bearer_auth(&token)
                .header("Accept", "text/event-stream")
                .send(),
        )
        .await;
        if let Ok(Ok(response)) = response {
            if matches!(response.status().as_u16(), 204 | 401 | 403 | 404) {
                notify(&app, generation, "feedback-inbox-disconnected");
                return;
            }
            if response.status().is_success()
                && response
                    .headers()
                    .get("content-type")
                    .and_then(|h| h.to_str().ok())
                    .is_some_and(|h| h.starts_with("text/event-stream"))
            {
                notify(&app, generation, "feedback-inbox-changed");
                let connected = std::time::Instant::now();
                let mut parser = SseParser::default();
                let mut chunks = response.bytes_stream();
                loop {
                    match tokio::time::timeout(STREAM_IDLE_TIMEOUT, chunks.next()).await {
                        Ok(Some(Ok(bytes))) => match parser.push(&bytes) {
                            Ok(changed) => {
                                if changed {
                                    notify(&app, generation, "feedback-inbox-changed");
                                }
                            }
                            Err(_) => break,
                        },
                        _ => break,
                    }
                }
                if connected.elapsed() > Duration::from_secs(60) {
                    failures = 0;
                }
            }
        }
        failures = failures.saturating_add(1);
        let seconds = 2u64.saturating_pow(failures.min(6)).min(60);
        let mut random = [0u8; 4];
        let _ = rand_core::OsRng.try_fill_bytes(&mut random);
        let jitter = u32::from_le_bytes(random) as u64 % 1000;
        tokio::time::sleep(Duration::from_millis(seconds * 1000 + jitter)).await;
    }
}

#[derive(Default)]
struct SseParser {
    pending: Vec<u8>,
    event: String,
}
impl SseParser {
    fn push(&mut self, bytes: &[u8]) -> Result<bool, ()> {
        let mut changed = false;
        for byte in bytes {
            if *byte == b'\n' {
                let line = std::str::from_utf8(&self.pending)
                    .map_err(|_| ())?
                    .trim_end_matches('\r');
                if line.is_empty() {
                    changed |= self.event == "changed";
                    self.event.clear();
                } else if let Some(event) = line.strip_prefix("event:") {
                    self.event = event.trim().to_string();
                }
                self.pending.clear();
            } else {
                if self.pending.len() >= MAX_FRAME_BYTES {
                    return Err(());
                }
                self.pending.push(*byte);
            }
        }
        Ok(changed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn followup_route_validates_turn_and_message() {
        let id = "11111111-1111-4111-8111-111111111111";
        let make = |message: String| Operation::FollowUp {
            thread: id.into(),
            id: id.into(),
            reply_to: id.into(),
            message,
        };
        let (method, path, body) = route(make(" Thanks ".into())).unwrap();
        assert_eq!(method, "POST");
        assert_eq!(path, format!("/threads/{id}/replies"));
        assert_eq!(body.unwrap()["message"], "Thanks");
        assert!(route(make(" ".into())).is_err());
        assert!(route(make("x".repeat(4001))).is_err());
        assert!(route(Operation::FollowUp {
            thread: id.into(),
            id: id.into(),
            reply_to: "../other".into(),
            message: "Hello".into()
        })
        .is_err());
    }
    #[test]
    fn empty_responses_are_not_submission_or_snapshot_acknowledgements() {
        assert_eq!(no_content_response(true).unwrap(), Value::Null);
        assert!(no_content_response(false).is_err());
    }

    #[test]
    fn survey_submission_is_bounded_and_uses_its_fixed_route() {
        let id = "11111111-1111-4111-8111-111111111111";
        let (method, path, body) = route(Operation::SubmitSurvey {
            submission_id: id.into(),
            survey: json!({"surveyId":"install"}),
        })
        .unwrap();
        assert_eq!(method, "POST");
        assert_eq!(path, "/surveys");
        assert_eq!(body.unwrap()["submissionId"], id);
        assert!(route(Operation::SubmitSurvey {
            submission_id: id.into(),
            survey: json!({"experienceDetails":"x".repeat(8192)}),
        })
        .is_err());
    }
    #[test]
    fn legacy_claim_preserves_installation_casing_on_its_fixed_route() {
        for id in [
            "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
        ] {
            let (method, path, body) = route(Operation::ClaimLegacySurveys {
                install_id: id.into(),
            })
            .unwrap();
            assert_eq!(method, "POST");
            assert_eq!(path, "/legacy-surveys");
            assert_eq!(body.unwrap()["installId"], id);
        }
        for invalid in [
            "../other",
            "00000000-0000-0000-0000-000000000000",
            "aaaaaaaabbbb4ccc8dddeeeeeeeeeeee",
        ] {
            assert!(route(Operation::ClaimLegacySurveys {
                install_id: invalid.into(),
            })
            .is_err());
        }
    }
    #[test]
    fn origins_and_routes_reject_secret_forwarding() {
        for raw in [
            "http://example.com",
            "https://user:secret@example.com",
            "https://example.com/path",
            "https://example.com/?token=x",
        ] {
            assert!(validate_base(raw).is_err());
        }
        assert!(validate_base("http://127.0.0.1:8090").is_ok());
        assert!(route(Operation::Replies {
            thread: "../other".into(),
            after: 0
        })
        .is_err());
        assert!(route(Operation::Snapshot { before: -1 }).is_err());
    }
    #[test]
    fn parser_handles_chunks_heartbeats_and_bounds() {
        let mut parser = SseParser::default();
        assert!(!parser.push(b"event: chan").unwrap());
        assert!(parser.push(b"ged\r\ndata: {}\r\n\r\n").unwrap());
        assert!(!parser.push(b": keepalive\n\n").unwrap());
        assert!(parser.push(&vec![b'x'; MAX_FRAME_BYTES + 1]).is_err());
    }
}
