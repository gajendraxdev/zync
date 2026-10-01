use super::broker::{PaneAssetBinding, PluginBrokerState};
use super::package::MAX_PACKAGE_FILE_BYTES;
use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

pub(crate) const SCHEME: &str = "zync-plugin-pane";
const MAX_DOCUMENT_BYTES: usize = 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 16 * MAX_DOCUMENT_BYTES;
#[cfg(any(target_os = "windows", target_os = "android"))]
const ASSET_ORIGIN: &str = "http://zync-plugin-pane.localhost";
#[cfg(not(any(target_os = "windows", target_os = "android")))]
const ASSET_ORIGIN: &str = "zync-plugin-pane:";

fn pane_csp() -> String {
    format!("default-src 'none'; script-src 'unsafe-inline' {ASSET_ORIGIN}; style-src 'unsafe-inline' {ASSET_ORIGIN}; img-src data: {ASSET_ORIGIN}; connect-src {ASSET_ORIGIN}; worker-src blob:; font-src data: {ASSET_ORIGIN}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'")
}

#[derive(Default)]
pub(crate) struct PaneDocuments {
    inner: Mutex<DocumentMap>,
}

#[derive(Default)]
struct DocumentMap {
    entries: HashMap<String, Arc<DocumentEntry>>,
    total_bytes: usize,
}

struct DocumentEntry {
    html: String,
    asset_binding: Option<PaneAssetBinding>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PaneDocumentRegistration {
    id: String,
    url: String,
}

impl PaneDocuments {
    fn register(
        &self,
        html: String,
        asset_binding: Option<PaneAssetBinding>,
    ) -> Result<PaneDocumentRegistration, String> {
        let bytes = html.len();
        if bytes == 0 || bytes > MAX_DOCUMENT_BYTES {
            return Err("Plugin pane document size is invalid".to_string());
        }
        let mut documents = self
            .inner
            .lock()
            .map_err(|_| "Plugin pane store is unavailable")?;
        if bytes > MAX_TOTAL_BYTES.saturating_sub(documents.total_bytes) {
            return Err("Too many plugin pane documents are open".to_string());
        }
        let id = Uuid::new_v4().to_string();
        let url = document_url(
            &id,
            asset_binding
                .as_ref()
                .map(|binding| binding.entry_route.as_str()),
        );
        documents.total_bytes += bytes;
        documents.entries.insert(
            id.clone(),
            Arc::new(DocumentEntry {
                html,
                asset_binding,
            }),
        );
        Ok(PaneDocumentRegistration { url, id })
    }

    fn unregister(&self, id: &str) -> Option<PaneAssetBinding> {
        if let Ok(mut documents) = self.inner.lock() {
            if let Some(entry) = documents.entries.remove(id) {
                documents.total_bytes -= entry.html.len();
                return entry.asset_binding.clone();
            }
        }
        None
    }

    fn clear(&self) -> Vec<PaneAssetBinding> {
        let Ok(mut documents) = self.inner.lock() else {
            return Vec::new();
        };
        let bindings = documents
            .entries
            .values()
            .filter_map(|entry| entry.asset_binding.clone())
            .collect();
        documents.entries.clear();
        documents.total_bytes = 0;
        bindings
    }

    /// The generated id scopes every route. Asset reads are delegated to the
    /// live broker, which rechecks the permission and package before opening.
    pub(crate) fn respond(
        &self,
        request: &Request<Vec<u8>>,
        read_asset: impl Fn(&PaneAssetBinding, &Path) -> Option<Vec<u8>>,
    ) -> Response<Vec<u8>> {
        if request.method() != tauri::http::Method::GET {
            return error_response(StatusCode::METHOD_NOT_ALLOWED);
        }
        let Some(route) = request.uri().path().strip_prefix('/') else {
            return error_response(StatusCode::NOT_FOUND);
        };
        let (id, asset) = route.split_once('/').unwrap_or((route, ""));
        if Uuid::parse_str(id).is_err() {
            return error_response(StatusCode::NOT_FOUND);
        }
        let Ok(documents) = self.inner.lock() else {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR);
        };
        let Some(entry) = documents.entries.get(id).cloned() else {
            return error_response(StatusCode::NOT_FOUND);
        };
        drop(documents);
        let document_route = entry
            .asset_binding
            .as_ref()
            .map(|binding| binding.entry_route.as_str())
            .unwrap_or("");
        let decoded_route = safe_relative_path(asset);
        let is_document = if document_route.is_empty() {
            asset.is_empty()
        } else {
            decoded_route.as_deref() == Some(Path::new(document_route))
        };
        if !is_document {
            let Some(binding) = entry.asset_binding.as_ref() else {
                return error_response(StatusCode::NOT_FOUND);
            };
            let Some((path, content_type)) = safe_asset_path(asset) else {
                return error_response(StatusCode::NOT_FOUND);
            };
            let Some(bytes) = read_asset(binding, &path) else {
                return error_response(StatusCode::NOT_FOUND);
            };
            return Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::CACHE_CONTROL, "no-store")
                .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
                .body(bytes)
                .expect("static pane response headers are valid");
        }
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header(header::CONTENT_SECURITY_POLICY, pane_csp())
            .header(header::CACHE_CONTROL, "no-store")
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            .body(entry.html.as_bytes().to_vec())
            .expect("static pane response headers are valid")
    }
}

fn safe_asset_path(raw: &str) -> Option<(PathBuf, &'static str)> {
    let path = safe_relative_path(raw)?;
    let content_type = match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        _ => return None,
    };
    Some((path, content_type))
}

fn safe_relative_path(raw: &str) -> Option<PathBuf> {
    let decoded = percent_decode_str(raw).decode_utf8().ok()?;
    if decoded
        .chars()
        .any(|character| matches!(character, '\\' | ':' | '\0' | '?' | '#'))
        || decoded
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return None;
    }
    let path = Path::new(decoded.as_ref());
    if path
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return None;
    }
    Some(path.to_path_buf())
}

fn error_response(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(Vec::new())
        .expect("static pane response headers are valid")
}

fn document_url(id: &str, entry_route: Option<&str>) -> String {
    let route = entry_route
        .map(|path| {
            path.split('/')
                .map(|segment| utf8_percent_encode(segment, NON_ALPHANUMERIC).to_string())
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_default();
    // Tauri maps custom schemes to localhost HTTP origins on Windows/Android.
    #[cfg(any(target_os = "windows", target_os = "android"))]
    {
        format!("http://{SCHEME}.localhost/{id}/{route}")
    }
    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    {
        format!("{SCHEME}://localhost/{id}/{route}")
    }
}

#[tauri::command]
pub(crate) fn plugins_pane_document_register(
    state: State<'_, PaneDocuments>,
    broker: State<'_, PluginBrokerState>,
    app: AppHandle,
    html: String,
    plugin_id: String,
    panel_id: String,
    legacy_access: bool,
) -> Result<PaneDocumentRegistration, String> {
    let asset_binding = broker
        .pane_asset_binding(&app, &plugin_id, &panel_id, legacy_access)
        .map_err(|error| error.to_string())?;
    state.register(html, asset_binding)
}

#[tauri::command]
pub(crate) async fn plugins_editor_document_register(
    app: AppHandle,
    html: String,
    plugin_id: String,
) -> Result<PaneDocumentRegistration, String> {
    let app_for_binding = app.clone();
    let asset_binding = tokio::task::spawn_blocking(move || {
        let broker = app_for_binding.state::<PluginBrokerState>();
        broker.editor_asset_binding(&app_for_binding, &plugin_id)
    })
    .await
    .map_err(|error| format!("Editor provider registration task failed: {error}"))?
    .map_err(|error| error.to_string())?;
    let state = app.state::<PaneDocuments>();
    let broker = app.state::<PluginBrokerState>();
    match state.register(html, Some(asset_binding.clone())) {
        Ok(registration) => Ok(registration),
        Err(error) => {
            broker.release_asset_binding(&asset_binding);
            Err(error)
        }
    }
}

pub(crate) fn respond_with_broker(
    app: &AppHandle,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let documents = app.state::<PaneDocuments>();
    let broker = app.state::<PluginBrokerState>();
    documents.respond(request, |binding, path| {
        broker
            .read_pane_asset(app, binding, path, MAX_PACKAGE_FILE_BYTES)
            .ok()
    })
}

/// Release documents whose browser-side unregister callbacks can no longer run.
pub(crate) fn clear_all(app: &AppHandle) {
    let Some(documents) = app.try_state::<PaneDocuments>() else {
        return;
    };
    let bindings = documents.clear();
    if let Some(broker) = app.try_state::<PluginBrokerState>() {
        for binding in bindings {
            broker.release_asset_binding(&binding);
        }
    }
}

#[tauri::command]
pub(crate) fn plugins_pane_document_unregister(
    state: State<'_, PaneDocuments>,
    broker: State<'_, PluginBrokerState>,
    id: String,
) {
    if let Some(binding) = state.unregister(&id) {
        broker.release_asset_binding(&binding);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(path: &str) -> Request<Vec<u8>> {
        Request::builder().uri(path).body(Vec::new()).unwrap()
    }

    #[test]
    fn registered_document_has_scoped_csp_and_is_removed_on_close() {
        let store = PaneDocuments::default();
        let entry = store
            .register("<style>body{color:red}</style>".to_string(), None)
            .unwrap();
        let response = store.respond(&request(&format!("/{}/", entry.id)), |_, _| None);
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CONTENT_SECURITY_POLICY],
            pane_csp()
        );
        let csp = response.headers()[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap();
        assert!(csp.contains(&format!("connect-src {ASSET_ORIGIN}")));
        assert!(csp.contains("worker-src blob:"));
        assert!(csp.contains(&format!("font-src data: {ASSET_ORIGIN}")));
        assert!(response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
        assert_eq!(response.body(), b"<style>body{color:red}</style>");
        let _ = store.unregister(&entry.id);
        assert_eq!(
            store
                .respond(&request(&format!("/{}/", entry.id)), |_, _| None)
                .status(),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn rejects_oversized_documents_and_non_document_routes() {
        let store = PaneDocuments::default();
        assert!(store
            .register("x".repeat(MAX_DOCUMENT_BYTES + 1), None)
            .is_err());
        assert_eq!(
            store.respond(&request("/../other"), |_, _| None).status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            store.respond(&request("/"), |_, _| None).status(),
            StatusCode::NOT_FOUND
        );
        let post = Request::builder()
            .method(tauri::http::Method::POST)
            .uri(format!("/{}", Uuid::new_v4()))
            .body(Vec::new())
            .unwrap();
        assert_eq!(
            store.respond(&post, |_, _| None).status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
    }

    #[test]
    fn bounds_aggregate_memory_and_releases_capacity_on_close() {
        let store = PaneDocuments::default();
        let html = "x".repeat(MAX_DOCUMENT_BYTES);
        let entries = (0..MAX_TOTAL_BYTES / MAX_DOCUMENT_BYTES)
            .map(|_| store.register(html.clone(), None).unwrap())
            .collect::<Vec<_>>();
        assert!(store.register("x".to_string(), None).is_err());
        let _ = store.unregister(&entries[0].id);
        assert!(store.register("x".to_string(), None).is_ok());
    }

    #[test]
    fn clear_removes_documents_and_returns_runtime_bindings() {
        let store = PaneDocuments::default();
        let binding = PaneAssetBinding {
            runtime_instance_id: "editor-runtime".to_string(),
            package_root: PathBuf::new(),
            entry_route: "ui/index.html".to_string(),
            owns_runtime: true,
        };
        let entry = store
            .register("<html></html>".to_string(), Some(binding))
            .unwrap();

        let bindings = store.clear();

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].runtime_instance_id, "editor-runtime");
        assert!(bindings[0].owns_runtime);
        assert_eq!(
            store
                .respond(&request(&format!("/{}/ui/index.html", entry.id)), |_, _| {
                    None
                })
                .status(),
            StatusCode::NOT_FOUND
        );
        assert!(store.register("x".repeat(MAX_DOCUMENT_BYTES), None).is_ok());
    }

    #[test]
    fn asset_routes_reject_escape_and_unlisted_types() {
        assert_eq!(
            safe_asset_path("styles/app%20dark.css").unwrap().0,
            Path::new("styles/app dark.css")
        );
        for path in [
            "../secret.css",
            "a/../secret.css",
            "a/%2e%2e/secret.css",
            "%2fsecret.css",
            "a%5cb.css",
            "a//b.css",
            "index.html",
            "file.txt",
        ] {
            assert!(safe_asset_path(path).is_none(), "accepted {path}");
        }
        let store = PaneDocuments::default();
        let entry = store.register("<html></html>".to_string(), None).unwrap();
        assert_eq!(
            store
                .respond(&request(&format!("/{}/app.css", entry.id)), |_, _| None)
                .status(),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn package_relative_asset_routes_keep_the_document_origin() {
        let store = PaneDocuments::default();
        let binding = PaneAssetBinding {
            runtime_instance_id: "test-runtime".to_string(),
            package_root: PathBuf::new(),
            entry_route: "ui/index.html".to_string(),
            owns_runtime: false,
        };
        let entry = store
            .register("<html></html>".to_string(), Some(binding))
            .unwrap();
        let document_path = url::Url::parse(&entry.url).unwrap().path().to_string();
        assert_eq!(
            store
                .respond(&request(&document_path), |_, _| None)
                .status(),
            StatusCode::OK
        );
        let asset = store.respond(
            &request(&format!("/{}/assets/app.css", entry.id)),
            |_, path| (path == Path::new("assets/app.css")).then(|| b"body{}".to_vec()),
        );
        assert_eq!(asset.status(), StatusCode::OK);
        assert_eq!(
            asset.headers()[header::CONTENT_TYPE],
            "text/css; charset=utf-8"
        );
        assert_eq!(asset.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
        assert_eq!(asset.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(asset.headers()[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        assert_eq!(asset.body(), b"body{}");
        assert_eq!(
            store
                .respond(&request(&format!("/{}/manifest.json", entry.id)), |_, _| {
                    None
                })
                .status(),
            StatusCode::NOT_FOUND
        );
    }
}
