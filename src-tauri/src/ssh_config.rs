use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ParsedSshConnection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub username: String,
    pub port: u16,
    pub private_key_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub certificate_path: Option<String>,
    /// Import-only warning: saved hosts can represent one certificate, not an ordered candidate list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub certificate_warning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub private_key_status: Option<String>,
    pub jump_server_alias: Option<String>,
    pub jump_server_id: Option<String>,
    pub aliases: Vec<String>, // Add full alias list
}

// Helper function to strip wrapping quotes from values
fn strip_wrapping_quotes(s: &str) -> &str {
    let bytes = s.as_bytes();
    if bytes.len() >= 2 {
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return &s[1..s.len() - 1];
        }
    }
    s
}

pub fn parse_config(path: &Path) -> Result<Vec<ParsedSshConnection>> {
    if !path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(path)?;
    parse_config_text(&content)
}

/// Decode escaped quotes/backslashes in quoted paths without consuming ordinary Windows separators.
fn decode_config_path(raw: &str) -> String {
    let value = strip_wrapping_quotes(raw);
    if !raw.starts_with('"') {
        return value.to_owned();
    }
    let mut result = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '\\' && matches!(chars.peek(), Some('\\' | '"')) {
            result.push(chars.next().unwrap());
        } else {
            result.push(character);
        }
    }
    result
}

/// Import supported explicit host options, keeping user certificates separate from key identities.
pub fn parse_config_text(content: &str) -> Result<Vec<ParsedSshConnection>> {
    let mut connections = Vec::new();

    let mut current_host: Option<ParsedSshConnection> = None;
    let mut certificate_seen = false;

    for line in content.lines() {
        let line = strip_inline_comments(line).trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        let (key_str, mut value_str) =
            if let Some(idx) = line.find(|c: char| c.is_whitespace() || c == '=') {
                let k = &line[..idx];
                let mut remainder = &line[idx..];
                // consume delimiter
                remainder = remainder.trim_start_matches(|c: char| c.is_whitespace() || c == '=');
                (k, remainder.trim())
            } else {
                (line, "")
            };

        // Normalize value_str by removing wrapping quotes
        let raw_value_str = value_str;
        value_str = strip_wrapping_quotes(value_str);

        if key_str.to_lowercase() == "host" {
            // Push previous
            if let Some(mut host) = current_host.take() {
                if !host.name.contains('*') && !host.name.contains('?') {
                    // Generate ID
                    host.id = format!("ssh_{}", uuid::Uuid::new_v4());
                    connections.push(host);
                }
            }

            // Start new - handle potential multiple aliases on Host line
            let primary_alias = value_str.split_whitespace().next().unwrap_or(value_str);
            let aliases: Vec<String> = value_str
                .split_whitespace()
                .map(|s| s.to_string())
                .collect();

            certificate_seen = false;
            current_host = Some(ParsedSshConnection {
                id: String::new(),               // Will be set on push
                name: primary_alias.to_string(), // First alias
                host: primary_alias.to_string(), // Default host to alias name
                username: whoami::username(),
                port: 22,
                private_key_path: None,
                certificate_path: None,
                certificate_warning: None,
                private_key_status: None,
                jump_server_alias: None,
                jump_server_id: None,
                aliases, // Store full alias list
            });
        } else if let Some(host) = current_host.as_mut() {
            match key_str.to_lowercase().as_str() {
                "hostname" => host.host = value_str.to_string(),
                "user" => host.username = value_str.to_string(),
                "port" => {
                    if let Ok(p) = value_str.parse() {
                        host.port = p;
                    }
                }
                "identityfile" => {
                    // expansion of ~ is tricky in rust std, but crucial
                    // Strip quotes FIRST
                    let mut path = decode_config_path(raw_value_str);

                    // Then expand ~
                    if path.starts_with("~") {
                        if let Some(home) = dirs::home_dir() {
                            path = path.replacen("~", &home.to_string_lossy(), 1);
                        }
                    }
                    host.private_key_path = Some(path);
                }
                "proxyjump" => host.jump_server_alias = Some(value_str.to_string()),
                "certificatefile" => {
                    if certificate_seen {
                        host.certificate_warning = Some("Multiple CertificateFile entries: only the first is imported. Review the certificate after import.".into());
                        continue;
                    }
                    certificate_seen = true;
                    let path = decode_config_path(raw_value_str);
                    host.certificate_path = (!value_str.eq_ignore_ascii_case("none")
                        && !value_str.is_empty())
                    .then(|| {
                        if let Some(rest) =
                            path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\"))
                        {
                            dirs::home_dir()
                                .map(|home| home.join(rest).to_string_lossy().into_owned())
                                .unwrap_or_else(|| path.clone())
                        } else {
                            path
                        }
                    });
                }
                _ => {}
            }
        }
    }

    // Push last
    if let Some(mut host) = current_host.take() {
        if !host.name.contains('*') && !host.name.contains('?') {
            host.id = format!("ssh_{}", uuid::Uuid::new_v4());
            connections.push(host);
        }
    }

    // Pass 2: Resolve Jump Server Aliases to IDs
    let mut alias_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for connection in &connections {
        for alias in &connection.aliases {
            if alias_map.get(alias).is_some() {
                continue;
            }
            alias_map.insert(alias.clone(), connection.id.clone());
        }
    }

    for conn in &mut connections {
        if let Some(alias) = &conn.jump_server_alias {
            if let Some(jump_id) = alias_map.get(alias) {
                conn.jump_server_id = Some(jump_id.clone());
            }
        }
    }

    Ok(connections)
}

fn strip_inline_comments(line: &str) -> &str {
    let mut in_quotes = false;
    let mut quote_char = ' ';
    let mut escaped = false;

    for (i, c) in line.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if c == '\\' {
            escaped = true;
            continue;
        }
        if c == '"' || c == '\'' {
            if in_quotes {
                if c == quote_char {
                    in_quotes = false;
                }
            } else {
                in_quotes = true;
                quote_char = c;
            }
        }
        if c == '#' && !in_quotes {
            return &line[..i];
        }
    }
    line
}

#[cfg(test)]
mod tests {
    use super::parse_config_text;

    #[test]
    fn repeated_certificates_keep_the_first_and_warn_per_host() {
        let parsed = parse_config_text("Host first\n CertificateFile /first.pub\n CertificateFile /second.pub\n CertificateFile NONE\nHost next\n CertificateFile /next.pub\n").unwrap();
        assert_eq!(parsed[0].certificate_path.as_deref(), Some("/first.pub"));
        assert!(parsed[0]
            .certificate_warning
            .as_deref()
            .unwrap()
            .contains("only the first"));
        assert_eq!(parsed[1].certificate_path.as_deref(), Some("/next.pub"));
        assert!(parsed[1].certificate_warning.is_none());
        let serialized = serde_json::to_value(&parsed[0]).unwrap();
        assert!(serialized["certificateWarning"]
            .as_str()
            .unwrap()
            .contains("only the first"));
        let none_first = parse_config_text(
            "Host disabled\n CertificateFile NONE\n CertificateFile /later.pub\n",
        )
        .unwrap();
        assert!(none_first[0].certificate_path.is_none());
        assert!(none_first[0].certificate_warning.is_some());
    }

    #[test]
    fn imports_user_certificate_without_confusing_it_with_identity_or_host_trust() {
        let parsed = parse_config_text("Host cert-host\n IdentityFile /keys/user\n CertificateFile \"/keys/user cert.pub\"\n User test\n").unwrap();
        assert_eq!(
            parsed[0].certificate_path.as_deref(),
            Some("/keys/user cert.pub")
        );
        assert_eq!(parsed[0].private_key_path.as_deref(), Some("/keys/user"));
        let parsed = parse_config_text("Host bare-host\n CertificateFile none\n").unwrap();
        assert!(parsed[0].certificate_path.is_none());
        for sentinel in ["NONE", "None", "nOnE", "\"NONE\"", ""] {
            let parsed =
                parse_config_text(&format!("Host bare-host\n CertificateFile {sentinel}\n"))
                    .unwrap();
            assert!(parsed[0].certificate_path.is_none());
        }
    }

    #[test]
    fn parse_config_text_parses_basic_host_block() {
        let text = r#"
Host app-prod
  HostName 10.1.2.3
  User ubuntu
  Port 2222
"#;

        let parsed = parse_config_text(text).expect("should parse");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "app-prod");
        assert_eq!(parsed[0].host, "10.1.2.3");
        assert_eq!(parsed[0].username, "ubuntu");
        assert_eq!(parsed[0].port, 2222);
    }

    #[test]
    fn parse_config_text_ignores_inline_comments_outside_quotes() {
        let text = r#"
Host app
  HostName "10.0.0.5 # inside" # trailing comment
  User root
"#;

        let parsed = parse_config_text(text).expect("should parse");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].host, "10.0.0.5 # inside");
        assert_eq!(parsed[0].username, "root");
    }
}
