//! Qualified MySQL CLI execution owns a dedicated channel whose sole stdin reader is the password prompt.
use super::{
    transport::{ExecChannel, MAX_BYTES},
    RuntimeCredential,
};
use crate::{commands::shell_quote, security::jobs::Lease};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::time::Duration;
use zeroize::Zeroizing;

const GLOBALS:&str="SELECT /*+ MAX_EXECUTION_TIME(3000) */ JSON_OBJECT('require_secure_transport',@@global.require_secure_transport,'local_infile',@@global.local_infile,'secure_file_scope',IF(@@global.secure_file_priv IS NULL,'disabled',IF(@@global.secure_file_priv='','unrestricted','directory')),'skip_name_resolve',@@global.skip_name_resolve,'general_log',@@global.general_log)";
const ADMINS:&str="SELECT /*+ MAX_EXECUTION_TIME(3000) */ JSON_OBJECT('login_admins',COUNT(*)) FROM mysql.user WHERE Super_priv='Y' AND account_locked='N'";

/// Read only fixed globals and an optional privileged aggregate; never select authentication strings.
pub(super) async fn collect(
    lease: &Lease<'_>,
    credential: &RuntimeCredential,
) -> Result<Map<String, Value>, &'static str> {
    let version = execute(lease, version_command(), None).await?;
    if !qualified_version(&version) {
        return Err("unsupported_client");
    }
    let nonce = uuid::Uuid::new_v4().to_string();
    let body = execute(
        lease,
        query_command(credential, GLOBALS, &nonce),
        Some((&nonce, credential.secret.as_str())),
    )
    .await?;
    let mut values = project_globals(&body).ok_or("invalid_response")?;
    let nonce = uuid::Uuid::new_v4().to_string();
    if let Ok(body) = execute(
        lease,
        query_command(credential, ADMINS, &nonce),
        Some((&nonce, credential.secret.as_str())),
    )
    .await
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Administrators {
            login_admins: u64,
        }
        if let Ok(result) = serde_json::from_slice::<Administrators>(&body) {
            values.insert("login_admins".into(), result.login_admins.into());
        }
    }
    Ok(values)
}

/// Option/login files are disabled even for the non-secret qualification probe.
fn version_command() -> String {
    "exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LC_ALL=C HOME=/nonexistent /usr/bin/timeout --signal=TERM --kill-after=1s 4s /usr/bin/mysql --no-defaults --no-login-paths --version".into()
}

/// Only qualified Oracle MySQL client families have the observed password interface; MariaDB is separate.
fn qualified_version(output: &[u8]) -> bool {
    let Ok(value) = std::str::from_utf8(output) else {
        return false;
    };
    value.len() <= 4096
        && !value.to_ascii_lowercase().contains("mariadb")
        && value.contains("mysql")
        && (value.contains("Ver 8.0.")
            || value.contains("Distrib 8.0.")
            || value.contains("Ver 8.4.")
            || value.contains("Distrib 8.4."))
}

/// Fixed queries/flags exclude option files, dynamic client plugins, local-file loading and reconnects.
fn query_command(credential: &RuntimeCredential, query: &str, nonce: &str) -> String {
    debug_assert!(matches!(query, GLOBALS | ADMINS));
    let begin = shell_quote(&format!("ZYNC-APP-{nonce}-begin:"));
    let end = shell_quote(&format!("ZYNC-APP-{nonce}-end-"));
    let script=format!("printf '%s' {begin} >&2; /usr/bin/mysql --no-defaults --no-login-paths --batch --raw --skip-column-names --skip-auto-rehash --skip-reconnect --binary-mode --local-infile=0 --plugin-dir=/nonexistent/zync-disabled-plugins --max-allowed-packet=1048576 --connect-timeout=4 --protocol=TCP --ssl-mode=REQUIRED --host=127.0.0.1 --port={} --user={} --password --execute={}; result=$?; printf '%s%s:' {end} \"$result\" >&2; exit \"$result\"",credential.port,shell_quote(&credential.username),shell_quote(query));
    format!("exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LC_ALL=C HOME=/nonexistent /usr/bin/timeout --signal=TERM --kill-after=1s 7s /bin/sh -c {}",shell_quote(&script))
}

/// Inspect only the dedicated client's bounded password prompt, never arbitrary stderr as user feedback.
struct Prompt {
    begin: Vec<u8>,
    end: Vec<u8>,
    tail: Zeroizing<Vec<u8>>,
    active: bool,
    ended: bool,
    sent: bool,
    completion: Option<u8>,
}
impl Prompt {
    /// A random nonce fences begin/completion to this one app exec channel.
    fn new(nonce: &str) -> Self {
        Self {
            begin: format!("ZYNC-APP-{nonce}-begin:").into_bytes(),
            end: format!("ZYNC-APP-{nonce}-end-").into_bytes(),
            tail: Zeroizing::new(vec![]),
            active: false,
            ended: false,
            sent: false,
            completion: None,
        }
    }
    /// Process a whole stderr chunk before deciding to write, so a same-chunk completion cancels a prompt.
    fn feed(&mut self, bytes: &[u8]) -> Result<bool, &'static str> {
        let mut requested = false;
        for byte in bytes {
            self.tail.push(*byte);
            if self.tail.ends_with(&self.begin) {
                if self.active || self.ended {
                    return Err("invalid_response");
                }
                self.active = true;
                self.tail.clear();
            } else if *byte == b':' {
                if let Some(start) = self
                    .tail
                    .windows(self.end.len())
                    .position(|value| value == self.end)
                {
                    let status = std::str::from_utf8(
                        &self.tail[start + self.end.len()..self.tail.len() - 1],
                    )
                    .ok()
                    .and_then(|value| value.parse::<u8>().ok())
                    .ok_or("invalid_response")?;
                    if !self.active || self.ended {
                        return Err("invalid_response");
                    }
                    self.active = false;
                    self.ended = true;
                    self.completion = Some(status);
                    self.tail.clear();
                }
            }
            if self.tail.ends_with(b"Enter password: ") {
                if !self.active || self.sent || requested {
                    return Err("unsupported_client");
                }
                requested = true;
                self.tail.clear();
            }
            if self.tail.len() > 256 {
                self.tail.remove(0);
            }
        }
        Ok(requested && self.active && !self.ended)
    }
}

/// The exec channel has no later stdin-consuming command; cancellation closes it without replaying a secret.
async fn execute(
    lease: &Lease<'_>,
    command: String,
    authentication: Option<(&str, &str)>,
) -> Result<Zeroizing<Vec<u8>>, &'static str> {
    let channel = tokio::time::timeout(Duration::from_secs(4), async {
        lease.session.lock().await.channel_open_session().await
    })
    .await
    .map_err(|_| "timeout")?
    .map_err(|_| "connection_failed")?;
    let mut channel = ExecChannel::new(channel);
    let mut cancel = lease.cancel.clone();
    let work = async {
        channel
            .exec(true, command)
            .await
            .map_err(|_| "connection_failed")?;
        let mut output = Zeroizing::new(Vec::new());
        let mut budget = 0usize;
        let mut exit = None;
        let mut prompt = authentication.map(|(nonce, _)| Prompt::new(nonce));
        while let Some(message) = channel.wait().await {
            match message {
                russh::ChannelMsg::Data { data } => {
                    budget += data.len();
                    if budget > MAX_BYTES {
                        return Err("invalid_response");
                    }
                    output.extend_from_slice(&data);
                }
                russh::ChannelMsg::ExtendedData { data, .. } => {
                    budget += data.len();
                    if budget > MAX_BYTES {
                        return Err("invalid_response");
                    }
                    if let Some(prompt) = prompt.as_mut() {
                        if prompt.feed(&data)? {
                            if *lease.cancel.borrow() {
                                return Err("cancelled");
                            }
                            let mut password =
                                Zeroizing::new(authentication.unwrap().1.as_bytes().to_vec());
                            password.push(b'\n');
                            channel
                                .data(password.as_slice())
                                .await
                                .map_err(|_| "connection_failed")?;
                            prompt.sent = true;
                        }
                    }
                }
                russh::ChannelMsg::ExitStatus { exit_status } => exit = Some(exit_status),
                russh::ChannelMsg::ExitSignal { .. } | russh::ChannelMsg::Failure => {
                    return Err("connection_failed")
                }
                russh::ChannelMsg::Close => break,
                _ => {}
            }
        }
        if exit != Some(0) {
            return Err(if authentication.is_some() {
                "authentication_failed"
            } else {
                "unsupported_client"
            });
        }
        if prompt
            .as_ref()
            .is_some_and(|value| !value.sent || value.completion != Some(0))
        {
            return Err("unsupported_client");
        }
        Ok(output)
    };
    let result = tokio::select! {biased;
        _=async{let _=cancel.wait_for(|value|*value).await;}=>Err("cancelled"),
        result=tokio::time::timeout(Duration::from_secs(8),work)=>result.unwrap_or(Err("timeout")),
    };
    let _ = tokio::time::timeout(Duration::from_millis(500), channel.eof()).await;
    let _ = tokio::time::timeout(Duration::from_millis(500), channel.close()).await;
    result
}

/// Convert known MySQL booleans and file-operation scope without retaining arbitrary JSON fields or paths.
fn project_globals(output: &[u8]) -> Option<Map<String, Value>> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Globals {
        require_secure_transport: Value,
        local_infile: Value,
        secure_file_scope: String,
        skip_name_resolve: Value,
        general_log: Value,
    }
    let source: Globals = serde_json::from_slice(output).ok()?;
    let mut values = Map::new();
    for (name, source) in [
        ("require_secure_transport", source.require_secure_transport),
        ("local_infile", source.local_infile),
        ("skip_name_resolve", source.skip_name_resolve),
        ("general_log", source.general_log),
    ] {
        let value = match source {
            Value::Bool(value) => value,
            Value::Number(value) => match value.as_u64()? {
                0 => false,
                1 => true,
                _ => return None,
            },
            _ => return None,
        };
        values.insert(name.into(), value.into());
    }
    let scope = source.secure_file_scope;
    if !["disabled", "directory", "unrestricted"].contains(&scope.as_str()) {
        return None;
    }
    values.insert("secure_file_scope".into(), scope.into());
    Some(values)
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Split prompts and same-chunk exits never produce replay or a write after completion.
    #[test]
    fn mysql_prompt_is_run_bound_and_single_use() {
        let mut prompt = Prompt::new("nonce");
        assert!(!prompt.feed(b"ZYNC-APP-nonce-begin:Enter pass").unwrap());
        assert!(prompt.feed(b"word: ").unwrap());
        prompt.sent = true;
        assert!(prompt.feed(b"Enter password: ").is_err());
        let mut prompt = Prompt::new("nonce");
        assert!(!prompt
            .feed(b"ZYNC-APP-nonce-begin:Enter password: ZYNC-APP-nonce-end-1:")
            .unwrap());
        assert_eq!(prompt.completion, Some(1));
        assert!(Prompt::new("nonce").feed(b"Enter password: ").is_err());
    }
    /// Qualification must not silently treat incompatible clients or numeric JSON states as trustworthy.
    #[test]
    fn mysql_version_and_projection_are_qualified() {
        assert!(qualified_version(
            b"mysql  Ver 8.4.5 for Linux on x86_64 (MySQL Community Server - GPL)"
        ));
        assert!(!qualified_version(
            b"mysql Ver 15.1 Distrib 10.11.8-MariaDB"
        ));
        assert!(!qualified_version(b"mysql Ver 9.9.0"));
        let value=br#"{"require_secure_transport":1,"local_infile":0,"secure_file_scope":"directory","skip_name_resolve":1,"general_log":0}"#;
        assert_eq!(
            project_globals(value).unwrap()["require_secure_transport"],
            Value::Bool(true)
        );
        assert!(project_globals(br#"{"secret":"fixture-private"}"#).is_none());
        assert!(project_globals(br#"{"require_secure_transport":1,"require_secure_transport":0,"local_infile":0,"secure_file_scope":"directory","skip_name_resolve":1,"general_log":0}"#).is_none());
    }
}
