mod utils;
mod commands;
mod types;
mod pty;
mod fs;
mod ssh;
mod ssh_config;
pub mod tunnel;
mod snippets;
pub mod plugins;
mod ssh_parser;
mod ai;

use commands::AppState;
use tauri::{Manager, Emitter, http::{Response, HeaderValue}};
use std::io::BufReader;
use std::fs::File;
use std::io::Read;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Explicitly set a menu to override potential default conflicts
            // We use the default menu structure but this ensures we have control
            #[cfg(target_os = "macos")]
            {
                let menu = tauri::menu::Menu::default(app.handle())?;
                app.set_menu(menu)?;
            }

            let default_dir = app.path().app_data_dir().unwrap();
            let settings_path = default_dir.join("settings.json");
            
            // On Windows, auto-configure using installation directory
            #[cfg(target_os = "windows")]
            {
                if let Ok(exe_path) = std::env::current_exe() {
                    if let Some(exe_dir) = exe_path.parent() {
                        let exe_dir_str = exe_dir.to_string_lossy().to_string();
                        
                        // Read existing settings to preserve user preferences
                        let mut settings: serde_json::Value = if settings_path.exists() {
                            std::fs::read_to_string(&settings_path)
                                .ok()
                                .and_then(|data| serde_json::from_str(&data).ok())
                                .unwrap_or_else(|| serde_json::json!({}))
                        } else {
                            serde_json::json!({})
                        };
                        
                        // Always set dataPath to exe directory on Windows
                        if let Some(obj) = settings.as_object_mut() {
                            obj.insert("dataPath".to_string(), serde_json::json!(exe_dir_str));
                            obj.insert("logPath".to_string(), serde_json::json!(format!("{}\\logs", exe_dir_str)));
                            obj.insert("isConfigured".to_string(), serde_json::json!(true));
                            if !obj.contains_key("theme") {
                                obj.insert("theme".to_string(), serde_json::json!("dark"));
                            }
                        }
                        
                        // Write to bootstrap location
                        if !default_dir.exists() {
                            let _ = std::fs::create_dir_all(&default_dir);
                        }
                        let json = serde_json::to_string_pretty(&settings).unwrap_or_default();
                        let _ = std::fs::write(&settings_path, &json);
                        
                        // Also write to exe directory
                        if !exe_dir.exists() {
                            let _ = std::fs::create_dir_all(exe_dir);
                        }
                        let _ = std::fs::write(exe_dir.join("settings.json"), &json);
                    }
                }
            }
            
            // Now read the final data directory (will pick up the configured dataPath)
            let data_dir = if settings_path.exists() {
                if let Ok(data) = std::fs::read_to_string(&settings_path) {
                    if let Ok(settings) = serde_json::from_str::<serde_json::Value>(&data) {
                        if let Some(data_path) = settings.get("dataPath").and_then(|v| v.as_str()) {
                            if !data_path.is_empty() {
                                let custom_dir = std::path::PathBuf::from(data_path);
                                if !custom_dir.exists() {
                                    let _ = std::fs::create_dir_all(&custom_dir);
                                }
                                custom_dir
                            } else {
                                default_dir.clone()
                            }
                        } else {
                            default_dir.clone()
                        }
                    } else {
                        default_dir.clone()
                    }
                } else {
                    default_dir.clone()
                }
            } else {
                default_dir.clone()
            };
            
            let app_state = AppState::new(data_dir);
            app.manage(app_state);
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let _ = webview.window().show();
            }
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // Only handle graceful shutdown for the main window
                    if window.label() == "main" {
                        api.prevent_close();
                        let _ = window.emit("app:request-close", ());
                    }
                }
                tauri::WindowEvent::DragDrop(drag_event) => {
                    match drag_event {
                        tauri::DragDropEvent::Enter { paths, .. } => {
                            let path_strings: Vec<String> = paths.iter()
                                .map(|p| p.to_string_lossy().to_string())
                                .collect();
                            let _ = window.emit("zync://drag-enter", path_strings);
                        }
                        tauri::DragDropEvent::Drop { paths, .. } => {
                            let path_strings: Vec<String> = paths.iter()
                                .map(|p| p.to_string_lossy().to_string())
                                .collect();
                            let _ = window.emit("zync://file-drop", path_strings);
                        }
                        tauri::DragDropEvent::Leave => {
                            let _ = window.emit("zync://drag-leave", ());
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::ssh_connect,
            commands::ssh_test_connection,
            commands::ssh_extract_pem,
            commands::ssh_migrate_all_keys,
            commands::ssh_disconnect,
            commands::terminal_write,
            commands::terminal_navigate,
            commands::terminal_resize,
            commands::terminal_create,
            commands::terminal_close,
            commands::connections_get,
            commands::connections_save,
            commands::fs_list,
            commands::fs_read_file,
            commands::fs_write_file,
            commands::fs_cwd,
            commands::fs_touch,
            commands::fs_mkdir,
            commands::fs_rename,
            commands::fs_rename_batch,
            commands::fs_delete,
            commands::fs_copy,
            commands::fs_copy_batch,
            commands::fs_exists,
            commands::tunnel_get_all,
            commands::tunnel_start_local,
            commands::tunnel_start_remote,
            commands::tunnel_stop,
            commands::tunnel_list,
            commands::tunnel_save,
            commands::tunnel_delete,
            commands::tunnel_start,
            commands::window_is_maximized,
            commands::window_maximize,
            commands::window_minimize,
            commands::window_close,
            commands::ssh_exec,
            commands::ssh_import_config,
            commands::ssh_internalize_connections,
            commands::snippets_list,
            commands::snippets_save,
            commands::snippets_delete,
            commands::settings_get,
            commands::settings_set,
            commands::sftp_put,
            commands::sftp_get,
            commands::sftp_copy_to_server,
            commands::sftp_cancel_transfer,
            commands::sftp_download_as_zip,
            commands::shell_open,
            commands::app_get_exe_dir,
            commands::app_exit,
            commands::plugins_load,
            commands::plugins_toggle,
            commands::plugins_install,
            commands::plugins_uninstall,
            commands::plugin_fs_read,
            commands::plugin_fs_write,
            commands::plugin_fs_list,
            commands::plugin_fs_exists,
            commands::plugin_fs_create_dir,
            commands::plugin_window_create,
            commands::config_select_folder,
            commands::system_install_cli,
            commands::ssh_parse_command,
            commands::ai_translate,
            commands::ai_translate_stream,
            commands::ai_check_ollama,
            commands::ai_get_ollama_models,
            commands::ai_get_provider_models,
        ])
        .register_uri_scheme_protocol("plugin", move |app_handle, request| {
            let uri = request.uri();
            
            // Extract plugin ID (host) and file path
            let plugin_id = match uri.host() {
                Some(id) if !id.is_empty() => id,
                _ => {
                    return Response::builder()
                        .status(400)
                        .body(Vec::new())
                        .unwrap();
                }
            };
            let path = uri.path().trim_start_matches('/');
            
            // Handle virtual Zync API script injection without hitting the filesystem
            if path == "__zync_api.js" {
                let shim = r#"
window.zync = {
    terminal: {
        send: function(text) {
            window.parent.postMessage({ type: 'zync:terminal:send', payload: { text } }, '*');
        },
        newTab: function(opts) {
            window.parent.postMessage({ type: 'zync:terminal:opentab', payload: opts }, '*');
        }
    },
    statusBar: {
        set: function(id, text) {
            window.parent.postMessage({ type: 'zync:statusbar:set', payload: { id, text } }, '*');
        }
    },
    ui: {
        notify: function(opts) {
            window.parent.postMessage({ type: 'zync:ui:notify', payload: opts }, '*');
        },
        confirm: function(opts) {
            return new Promise((resolve, reject) => {
                const reqId = Math.random().toString(36).slice(2, 11);
                let settled = false;
                const listener = (event) => {
                    const { type, payload } = event.data || {};
                    if (type === 'zync:ui:confirm:response' && payload.requestId === reqId) {
                        settled = true;
                        window.removeEventListener('message', listener);
                        if (payload.error) reject(new Error(payload.error));
                        else resolve(payload.confirmed);
                    }
                };
                window.addEventListener('message', listener);
                setTimeout(() => {
                    if (!settled) {
                        window.removeEventListener('message', listener);
                        reject(new Error('ui:confirm request timed out (30s)'));
                    }
                }, 30000);
                window.parent.postMessage({ type: 'zync:ui:confirm', payload: { ...opts, requestId: reqId } }, '*');
            });
        }
    },
    ssh: {
        exec: function(command) {
            return new Promise((resolve, reject) => {
                const reqId = Math.random().toString(36).slice(2, 11);
                let settled = false;
                const listener = (event) => {
                    const { type, payload } = event.data || {};
                    if (type === 'zync:ssh:exec:response' && payload.requestId === reqId) {
                        settled = true;
                        window.removeEventListener('message', listener);
                        if (payload.error) reject(new Error(payload.error));
                        else resolve(payload.result);
                    }
                };
                window.addEventListener('message', listener);
                setTimeout(() => {
                    if (!settled) {
                        window.removeEventListener('message', listener);
                        reject(new Error('ssh:exec request timed out (30s)'));
                    }
                }, 30000);
                window.parent.postMessage({ type: 'zync:ssh:exec', payload: { command, requestId: reqId } }, '*');
            });
        }
    },
    fs: {
        readTextFile: function(path) {
            return new Promise((resolve, reject) => {
                const reqId = Math.random().toString(36).slice(2, 11);
                let settled = false;
                const listener = (event) => {
                    const { type, payload } = event.data || {};
                    if (type === 'zync:fs:readTextFile:response' && payload.requestId === reqId) {
                        settled = true;
                        window.removeEventListener('message', listener);
                        if (payload.error) reject(new Error(payload.error));
                        else resolve(payload.result);
                    }
                };
                window.addEventListener('message', listener);
                setTimeout(() => {
                    if (!settled) {
                        window.removeEventListener('message', listener);
                        reject(new Error('fs:readTextFile request timed out (30s)'));
                    }
                }, 30000);
                window.parent.postMessage({ type: 'zync:fs:readTextFile', payload: { path, requestId: reqId } }, '*');
            });
        },
        writeTextFile: function(path, contents) {
            return new Promise((resolve, reject) => {
                const reqId = Math.random().toString(36).slice(2, 11);
                let settled = false;
                const listener = (event) => {
                    const { type, payload } = event.data || {};
                    if (type === 'zync:fs:writeTextFile:response' && payload.requestId === reqId) {
                        settled = true;
                        window.removeEventListener('message', listener);
                        if (payload.error) reject(new Error(payload.error));
                        else resolve(payload.result);
                    }
                };
                window.addEventListener('message', listener);
                setTimeout(() => {
                    if (!settled) {
                        window.removeEventListener('message', listener);
                        reject(new Error('fs:writeTextFile request timed out (30s)'));
                    }
                }, 30000);
                window.parent.postMessage({ type: 'zync:fs:writeTextFile', payload: { path, contents, requestId: reqId } }, '*');
            });
        },
        readDir: function(path) {
            return new Promise((resolve, reject) => {
                const reqId = Math.random().toString(36).slice(2, 11);
                let settled = false;
                const listener = (event) => {
                    const { type, payload } = event.data || {};
                    if (type === 'zync:fs:readDir:response' && payload.requestId === reqId) {
                        settled = true;
                        window.removeEventListener('message', listener);
                        if (payload.error) reject(new Error(payload.error));
                        else resolve(payload.result);
                    }
                };
                window.addEventListener('message', listener);
                setTimeout(() => {
                    if (!settled) {
                        window.removeEventListener('message', listener);
                        reject(new Error('fs:readDir request timed out (30s)'));
                    }
                }, 30000);
                window.parent.postMessage({ type: 'zync:fs:readDir', payload: { path, requestId: reqId } }, '*');
            });
        }
    }
};
"#;
                return Response::builder()
                    .header("Content-Type", "application/javascript")
                    .header("Access-Control-Allow-Origin", "*")
                    .body(shim.as_bytes().to_vec())
                    .unwrap();
            }

            // Resolve physical path in app_config_dir/plugins/<id>/<path>
            let config_dir = app_handle.path().app_config_dir().unwrap_or_default();
            let mut file_path = config_dir.join("plugins").join(plugin_id);
            
            if path.is_empty() {
                file_path.push("index.html");
            } else {
                file_path.push(path);
            }

            // Security: Prevent path traversal (extra check)
            let plugin_root = config_dir.join("plugins").join(plugin_id);
            
            // Build the absolute path and check if it's within plugin_root
            // We use canonicalize() to resolve all . and .. components
            // If the file doesn't exist, we return 404 BEFORE checking starts_with
            if !file_path.exists() {
                return Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap();
            }

            let canonical_root = match plugin_root.canonicalize() {
                Ok(p) => p,
                Err(_) => {
                    return Response::builder()
                        .status(404)
                        .body(Vec::new())
                        .unwrap();
                }
            };

            let canonical_path = match file_path.canonicalize() {
                Ok(p) => p,
                Err(_) => {
                    return Response::builder()
                        .status(404)
                        .body(Vec::new())
                        .unwrap();
                }
            };

            if !canonical_path.starts_with(canonical_root) {
                return Response::builder()
                    .status(403)
                    .body(Vec::new())
                    .unwrap();
            }

            match fs::read(&canonical_path) {
                Ok(mut content) => {
                    let mime = match canonical_path.extension().and_then(|ext| ext.to_str()) {
                        Some("html") => "text/html",
                        Some("js") => "application/javascript",
                        Some("css") => "text/css",
                        Some("svg") => "image/svg+xml",
                        Some("png") => "image/png",
                        Some("jpg") | Some("jpeg") => "image/jpeg",
                        Some("json") => "application/json",
                        _ => "application/octet-stream",
                    };

                    // Auto-inject the zync API shim into HTML files
                    if mime == "text/html" {
                        if let Ok(html_str) = String::from_utf8(content.clone()) {
                            let script_tag = format!(r#"<script src="plugin://{}/__zync_api.js"></script>"#, plugin_id);
                            
                            // Case-insensitive ASCII search preserving byte positions
                            fn find_tag_ci(haystack: &str, tag: &str) -> Option<usize> {
                                haystack.as_bytes()
                                    .windows(tag.len())
                                    .position(|w| w.eq_ignore_ascii_case(tag.as_bytes()))
                            }

                            let injected = if let Some(pos) = find_tag_ci(&html_str, "<head>") {
                                let end = pos + 6; // length of "<head>"
                                format!("{}{}{}", &html_str[..end], script_tag, &html_str[end..])
                            } else if let Some(pos) = find_tag_ci(&html_str, "<body>") {
                                let end = pos + 6;
                                format!("{}{}{}", &html_str[..end], script_tag, &html_str[end..])
                            } else {
                                format!("{}{}", script_tag, html_str)
                            };
                            
                            content = injected.into_bytes();
                        }
                    }

                    Response::builder()
                        .header("Content-Type", mime)
                        .header("Access-Control-Allow-Origin", "*")
                        .body(content)
                        .unwrap()
                }
                Err(_) => {
                    Response::builder()
                        .status(404)
                        .body(Vec::new())
                        .unwrap()
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

