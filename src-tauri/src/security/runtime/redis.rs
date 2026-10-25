//! Redis observations use fixed non-secret CONFIG GET keys and non-executing ACL simulations.
use super::{
    transport::{self, Driver},
    RuntimeCredential,
};
use crate::security::jobs::Lease;
use serde_json::{Map, Value};
use std::{net::IpAddr, time::Duration};
use tokio::io::{AsyncRead, AsyncWrite};

const PARAMETERS: &[&str] = &[
    "protected-mode",
    "bind",
    "port",
    "tls-port",
    "appendonly",
    "maxmemory-policy",
];

/// Read no stored keys, ACL listings, passwords or hashes; denied fields stay independently unavailable.
pub(super) async fn collect(
    lease: &Lease<'_>,
    credential: &RuntimeCredential,
) -> Result<Map<String, Value>, &'static str> {
    let stream = transport::connect(lease, credential.port).await?;
    collect_stream(stream, credential).await
}

/// The protocol adapter accepts only an owned bounded stream, including in synthetic transport tests.
async fn collect_stream<S>(
    stream: S,
    credential: &RuntimeCredential,
) -> Result<Map<String, Value>, &'static str>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    // Authenticate explicitly below: the library's compatibility setup can retry AUTH
    // without the requested username, which would change this observer's identity.
    let info = ::redis::RedisConnectionInfo::default();
    let options =
        ::redis::AsyncConnectionConfig::new().set_response_timeout(Duration::from_secs(4));
    let (mut connection, driver) = tokio::time::timeout(
        Duration::from_secs(5),
        ::redis::aio::MultiplexedConnection::new_with_config(&info, stream, options),
    )
    .await
    .map_err(|_| "timeout")?
    .map_err(|_| "authentication_failed")?;
    let _driver = Driver::spawn(driver);
    if !credential.username.is_empty() || !credential.secret.is_empty() {
        let mut authenticate = ::redis::cmd("AUTH");
        if !credential.username.is_empty() {
            authenticate.arg(&credential.username);
        }
        let response: String = authenticate
            .arg(&credential.secret)
            .query_async(&mut connection)
            .await
            .map_err(|_| "authentication_failed")?;
        if response != "OK" {
            return Err("authentication_failed");
        }
    }
    let mut values = Map::new();
    for parameter in PARAMETERS {
        let response: Result<Vec<String>, _> = ::redis::cmd("CONFIG")
            .arg("GET")
            .arg(parameter)
            .query_async(&mut connection)
            .await;
        if let Ok(response) = response {
            if response.len() != 2 || response[0] != *parameter || response[1].len() > 1024 {
                continue;
            }
            project_parameter(&mut values, parameter, &response[1]);
        }
    }
    let mut allowed = 0u64;
    let mut complete = true;
    for command in [
        vec!["CONFIG", "SET", "protected-mode", "no"],
        vec!["FLUSHALL"],
    ] {
        let response: Result<String, _> = ::redis::cmd("ACL")
            .arg("DRYRUN")
            .arg("default")
            .arg(command)
            .query_async(&mut connection)
            .await;
        match response {
            Ok(value) if value == "OK" => allowed += 1,
            Ok(value)
                if value.starts_with("This user has no permissions")
                    || value.starts_with("User ") => {}
            _ => complete = false,
        }
    }
    if complete {
        values.insert("default_dangerous_allowed".into(), allowed.into());
    }
    Ok(values)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

    /// A tiny synthetic RESP peer verifies command scope without a Redis process or live endpoint.
    async fn read_command(stream: &mut BufReader<tokio::io::DuplexStream>) -> Vec<String> {
        let mut line = String::new();
        stream.read_line(&mut line).await.unwrap();
        let count = line
            .strip_prefix('*')
            .unwrap()
            .trim()
            .parse::<usize>()
            .unwrap();
        let mut command = Vec::new();
        for _ in 0..count {
            line.clear();
            stream.read_line(&mut line).await.unwrap();
            let size = line
                .strip_prefix('$')
                .unwrap()
                .trim()
                .parse::<usize>()
                .unwrap();
            let mut value = vec![0; size + 2];
            stream.read_exact(&mut value).await.unwrap();
            assert_eq!(&value[size..], b"\r\n");
            command.push(String::from_utf8(value[..size].to_vec()).unwrap());
        }
        command
    }

    #[tokio::test]
    async fn redis_observer_sends_only_fixed_reads_and_acl_simulations() {
        let (client, server) = tokio::io::duplex(8192);
        let peer = tokio::spawn(async move {
            let mut server = BufReader::new(server);
            assert_eq!(
                read_command(&mut server).await,
                ["AUTH", "observer", "fixture-secret"]
            );
            server.get_mut().write_all(b"+OK\r\n").await.unwrap();
            for (key, value) in
                PARAMETERS
                    .iter()
                    .zip(["yes", "127.0.0.1 ::1", "6379", "0", "no", "noeviction"])
            {
                assert_eq!(read_command(&mut server).await, ["CONFIG", "GET", *key]);
                let response = format!(
                    "*2\r\n${}\r\n{}\r\n${}\r\n{}\r\n",
                    key.len(),
                    key,
                    value.len(),
                    value
                );
                server
                    .get_mut()
                    .write_all(response.as_bytes())
                    .await
                    .unwrap();
            }
            assert_eq!(
                read_command(&mut server).await,
                [
                    "ACL",
                    "DRYRUN",
                    "default",
                    "CONFIG",
                    "SET",
                    "protected-mode",
                    "no"
                ]
            );
            server
                .get_mut()
                .write_all(b"+This user has no permissions to run the 'config|set' command\r\n")
                .await
                .unwrap();
            assert_eq!(
                read_command(&mut server).await,
                ["ACL", "DRYRUN", "default", "FLUSHALL"]
            );
            server.get_mut().write_all(b"+OK\r\n").await.unwrap();
        });
        let credential: RuntimeCredential = serde_json::from_value(serde_json::json!({
            "kind":"redis", "port":6379, "username":"observer", "secret":"fixture-secret"
        }))
        .unwrap();
        let values = tokio::time::timeout(
            Duration::from_secs(2),
            collect_stream(transport::Bounded::new(client), &credential),
        )
        .await
        .unwrap()
        .unwrap();
        peer.await.unwrap();
        assert_eq!(values["protected_mode"], true);
        assert_eq!(values["bind_scope"], "loopback-only");
        assert_eq!(values["default_dangerous_allowed"], 1);
        assert!(!serde_json::to_string(&values)
            .unwrap()
            .contains("fixture-secret"));
    }

    #[tokio::test]
    async fn redis_explicit_anonymous_observer_does_not_send_auth_or_trust_truncated_lengths() {
        let (client, server) = tokio::io::duplex(8192);
        let peer = tokio::spawn(async move {
            let mut server = BufReader::new(server);
            assert_eq!(
                read_command(&mut server).await,
                ["CONFIG", "GET", "protected-mode"]
            );
            server
                .get_mut()
                .write_all(b"$2147483647\r\n")
                .await
                .unwrap();
            server.get_mut().shutdown().await.unwrap();
        });
        let credential: RuntimeCredential = serde_json::from_value(serde_json::json!({
            "kind":"redis", "port":6379, "username":"", "secret":""
        }))
        .unwrap();
        let values = tokio::time::timeout(
            Duration::from_secs(2),
            collect_stream(transport::Bounded::new(client), &credential),
        )
        .await
        .unwrap()
        .unwrap();
        peer.await.unwrap();
        assert!(values.is_empty());
    }

    #[tokio::test]
    async fn redis_named_authentication_never_retries_as_the_default_account() {
        let (client, server) = tokio::io::duplex(8192);
        let peer = tokio::spawn(async move {
            let mut server = BufReader::new(server);
            assert_eq!(
                read_command(&mut server).await,
                ["AUTH", "observer", "fixture-secret"]
            );
            server
                .get_mut()
                .write_all(b"-ERR wrong number of arguments for 'auth' command\r\n")
                .await
                .unwrap();
            let mut remainder = Vec::new();
            server.read_to_end(&mut remainder).await.unwrap();
            assert!(remainder.is_empty());
        });
        let credential: RuntimeCredential = serde_json::from_value(serde_json::json!({
            "kind":"redis", "port":6379, "username":"observer", "secret":"fixture-secret"
        }))
        .unwrap();
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            collect_stream(transport::Bounded::new(client), &credential),
        )
        .await
        .unwrap();
        assert_eq!(result.unwrap_err(), "authentication_failed");
        tokio::time::timeout(Duration::from_secs(2), peer)
            .await
            .unwrap()
            .unwrap();
    }

    #[test]
    fn redis_address_scope_does_not_claim_reachability() {
        assert_eq!(binding("127.0.0.1 -::1 ::ffff:127.0.0.1"), "loopback-only");
        assert_eq!(binding("0.0.0.0 ::"), "includes-non-loopback");
        assert_eq!(binding("localhost"), "unrecognized");
    }
}

/// Normalize only the allowlisted parameters without exposing paths or arbitrary configuration values.
fn project_parameter(values: &mut Map<String, Value>, parameter: &str, value: &str) {
    match parameter {
        "protected-mode" | "appendonly" => {
            if let Some(value) = match value {
                "yes" => Some(true),
                "no" => Some(false),
                _ => None,
            } {
                values.insert(
                    if parameter == "protected-mode" {
                        "protected_mode"
                    } else {
                        "appendonly"
                    }
                    .into(),
                    value.into(),
                );
            }
        }
        "bind" => {
            values.insert("bind_scope".into(), binding(value).into());
        }
        "port" | "tls-port" => {
            if let Ok(value) = value.parse::<u16>() {
                values.insert(
                    if parameter == "port" {
                        "plain_port"
                    } else {
                        "tls_port"
                    }
                    .into(),
                    value.into(),
                );
            }
        }
        "maxmemory-policy" => {
            if value.len() <= 64
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte == b'-')
            {
                values.insert("maxmemory_policy".into(), value.into());
            }
        }
        _ => {}
    }
}

/// Bind scope describes configured numeric addresses only, never firewall or internet reachability.
fn binding(value: &str) -> &'static str {
    if value.is_empty() {
        return "unspecified";
    }
    let mut beyond = false;
    let mut count = 0;
    for address in value.split_whitespace() {
        count += 1;
        if count > 32 {
            return "unrecognized";
        }
        let Some(address) = address
            .strip_prefix('-')
            .unwrap_or(address)
            .parse::<IpAddr>()
            .ok()
        else {
            return "unrecognized";
        };
        let loopback = match address {
            IpAddr::V4(value) => value.is_loopback(),
            IpAddr::V6(value) => value
                .to_ipv4_mapped()
                .map_or_else(|| value.is_loopback(), |value| value.is_loopback()),
        };
        if !loopback {
            beyond = true;
        }
    }
    if beyond {
        "includes-non-loopback"
    } else {
        "loopback-only"
    }
}
