//! Jenkins reads a fixed HTTP API over the captured SSH stream; no redirects or script console.
use super::{
    transport::{self, Driver, MAX_BYTES},
    RuntimeCredential,
};
use crate::security::jobs::Lease;
use base64::Engine;
use bytes::Bytes;
use http_body_util::{BodyExt, Empty};
use hyper::{
    header::{HeaderValue, AUTHORIZATION},
    Request, StatusCode,
};
use hyper_util::rt::TokioIo;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::{future::Future, time::Duration};
use tokio::io::{AsyncRead, AsyncWrite};
use zeroize::Zeroizing;

const IDENTITY: &str = "/whoAmI/api/json?tree=authenticated,anonymous";
const SETTINGS: &str = "/api/json?tree=useSecurity,useCrumbs,numExecutors,mode";

#[derive(Deserialize)]
struct Identity {
    authenticated: bool,
    anonymous: bool,
}
impl Identity {
    /// Spring may mark an anonymous authentication token authenticated; both fields are required.
    fn is_authenticated(&self) -> bool {
        self.authenticated && !self.anonymous
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    use_security: Option<bool>,
    use_crumbs: Option<bool>,
    num_executors: Option<u32>,
}
impl Settings {
    /// A successful response with no selected fields cannot establish Jenkins metadata coverage.
    fn has_fields(&self) -> bool {
        self.use_security.is_some() || self.use_crumbs.is_some() || self.num_executors.is_some()
    }
    /// Export only the selected typed fields, with the observer identity qualified separately.
    fn values(self, authenticated: bool) -> Map<String, Value> {
        let mut values = Map::new();
        values.insert("observer_authenticated".into(), authenticated.into());
        if let Some(value) = self.use_security {
            values.insert("use_security".into(), value.into());
        }
        if let Some(value) = self.use_crumbs {
            values.insert("use_crumbs".into(), value.into());
        }
        if let Some(value) = self.num_executors {
            values.insert("controller_executors".into(), value.into());
        }
        values
    }
}

/// Distinguish token-authenticated evidence from an explicitly qualified public-metadata observation.
pub(super) async fn collect(
    lease: &Lease<'_>,
    credential: &RuntimeCredential,
) -> Result<Map<String, Value>, &'static str> {
    collect_with(|path, authenticated| get(lease, credential, path, authenticated)).await
}

/// Public metadata is a separately scoped probe, never a fallback authentication identity.
async fn collect_with<G, F>(mut get: G) -> Result<Map<String, Value>, &'static str>
where
    G: FnMut(&'static str, bool) -> F,
    F: Future<Output = Result<(StatusCode, Zeroizing<Vec<u8>>), &'static str>>,
{
    let authenticated = match get(IDENTITY, true).await {
        Ok((StatusCode::OK, body)) => serde_json::from_slice::<Identity>(&body)
            .is_ok_and(|identity| identity.is_authenticated()),
        _ => false,
    };
    if !authenticated {
        let (status, body) = get(SETTINGS, false).await?;
        if status != StatusCode::OK {
            return Err("authentication_failed");
        }
        let settings: Settings = serde_json::from_slice(&body).map_err(|_| "invalid_response")?;
        if !settings.has_fields() {
            return Err("authentication_failed");
        }
        let mut values = settings.values(false);
        values.insert("anonymous_metadata".into(), true.into());
        return Ok(values);
    }
    let (status, body) = get(SETTINGS, true).await?;
    if status != StatusCode::OK {
        return Err("authentication_failed");
    }
    let settings: Settings = serde_json::from_slice(&body).map_err(|_| "invalid_response")?;
    let mut values = settings.values(true);
    if let Ok((status, body)) = get(SETTINGS, false).await {
        if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
            values.insert("anonymous_metadata".into(), false.into());
        } else if status == StatusCode::OK {
            if let Ok(settings) = serde_json::from_slice::<Settings>(&body) {
                if settings.has_fields() {
                    values.insert("anonymous_metadata".into(), true.into());
                }
            }
        }
    }
    Ok(values)
}

/// Each fixed GET owns one direct channel; headers/bodies are never logged or forwarded as errors.
async fn get(
    lease: &Lease<'_>,
    credential: &RuntimeCredential,
    path: &'static str,
    authenticated: bool,
) -> Result<(StatusCode, Zeroizing<Vec<u8>>), &'static str> {
    let stream = transport::connect(lease, credential.port).await?;
    request(stream, credential, path, authenticated).await
}

/// A stream-only adapter also permits synthetic HTTP peers without opening local listeners.
async fn request<S>(
    stream: S,
    credential: &RuntimeCredential,
    path: &'static str,
    authenticated: bool,
) -> Result<(StatusCode, Zeroizing<Vec<u8>>), &'static str>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    if !matches!(path, IDENTITY | SETTINGS) {
        return Err("invalid_request");
    }
    let (mut sender, connection) = tokio::time::timeout(
        Duration::from_secs(4),
        hyper::client::conn::http1::Builder::new()
            .max_buf_size(32 * 1024)
            .handshake::<_, Empty<Bytes>>(TokioIo::new(stream)),
    )
    .await
    .map_err(|_| "timeout")?
    .map_err(|_| "connection_failed")?;
    let _driver = Driver::spawn(async move {
        let _ = connection.await;
    });
    let mut request = Request::builder()
        .method("GET")
        .uri(path)
        .header("Host", "localhost")
        .header("Accept", "application/json")
        .header("Connection", "close")
        .body(Empty::new())
        .map_err(|_| "invalid_request")?;
    if authenticated {
        let pair = Zeroizing::new(format!("{}:{}", credential.username, credential.secret));
        let encoded =
            Zeroizing::new(base64::engine::general_purpose::STANDARD.encode(pair.as_bytes()));
        let authorization = Zeroizing::new(format!("Basic {}", encoded.as_str()));
        let mut header =
            HeaderValue::from_bytes(authorization.as_bytes()).map_err(|_| "invalid_request")?;
        header.set_sensitive(true);
        request.headers_mut().insert(AUTHORIZATION, header);
    }
    let response = tokio::time::timeout(Duration::from_secs(5), sender.send_request(request))
        .await
        .map_err(|_| "timeout")?
        .map_err(|_| "connection_failed")?;
    let status = response.status();
    if status != StatusCode::OK {
        return Ok((status, Zeroizing::new(vec![])));
    }
    let work = async {
        let mut body = response.into_body();
        let mut output = Zeroizing::new(Vec::new());
        while let Some(frame) = body.frame().await {
            let frame = frame.map_err(|_| "invalid_response")?;
            if let Ok(data) = frame.into_data() {
                if output.len().saturating_add(data.len()) > MAX_BYTES {
                    return Err("invalid_response");
                }
                output.extend_from_slice(&data);
            }
        }
        Ok((status, output))
    };
    tokio::time::timeout(Duration::from_secs(5), work)
        .await
        .map_err(|_| "timeout")?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// Fixed in-memory peers expose no socket and retain request headers only inside this test.
    async fn exchange(
        status: &str,
        body: Vec<u8>,
        authenticated: bool,
    ) -> (
        Result<(StatusCode, Zeroizing<Vec<u8>>), &'static str>,
        String,
    ) {
        let (client, mut server) = tokio::io::duplex(8192);
        let header = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nLocation: http://external.invalid/\r\nConnection: close\r\n\r\n", body.len());
        let peer = tokio::spawn(async move {
            let mut incoming = Vec::new();
            while !incoming.ends_with(b"\r\n\r\n") {
                let byte = server.read_u8().await.unwrap();
                incoming.push(byte);
                assert!(incoming.len() < 8192);
            }
            let _ = server.write_all(header.as_bytes()).await;
            let _ = server.write_all(&body).await;
            String::from_utf8(incoming).unwrap()
        });
        let credential = serde_json::from_value(serde_json::json!({
            "kind":"jenkins", "port":8080, "username":"observer", "secret":"fixture-token"
        }))
        .unwrap();
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            request(
                transport::Bounded::new(client),
                &credential,
                SETTINGS,
                authenticated,
            ),
        )
        .await
        .unwrap();
        (result, peer.await.unwrap())
    }

    #[tokio::test]
    async fn jenkins_requests_are_fixed_authenticated_and_do_not_follow_redirects() {
        let (result, request) = exchange(
            "200 OK",
            br#"{"useSecurity":true,"numExecutors":0}"#.to_vec(),
            true,
        )
        .await;
        assert_eq!(result.unwrap().0, StatusCode::OK);
        assert!(request.starts_with(&format!("GET {SETTINGS} HTTP/1.1\r\n")));
        let expected = format!(
            "authorization: Basic {}\r\n",
            base64::engine::general_purpose::STANDARD.encode("observer:fixture-token")
        );
        assert!(request
            .to_ascii_lowercase()
            .contains(&expected.to_ascii_lowercase()));
        assert!(!request.contains("fixture-token"));
        let (result, request) = exchange("302 Found", Vec::new(), false).await;
        assert_eq!(result.unwrap().0, StatusCode::FOUND);
        assert!(!request.to_ascii_lowercase().contains("authorization:"));
    }

    #[tokio::test]
    async fn jenkins_transport_bounds_bodies_and_requires_real_nonanonymous_identity() {
        assert!(exchange("200 OK", vec![b'a'; MAX_BYTES + 1], true)
            .await
            .0
            .is_err());
        let anonymous: Identity =
            serde_json::from_str(r#"{"authenticated":true,"anonymous":true}"#).unwrap();
        assert!(!anonymous.is_authenticated());
        assert!(serde_json::from_str::<Identity>(r#"{"authenticated":true}"#).is_err());
        assert!(serde_json::from_str::<Settings>(r#"{"numExecutors":-1}"#).is_err());
        assert!(
            serde_json::from_str::<Settings>(r#"{"useSecurity":true,"useSecurity":false}"#)
                .is_err()
        );
    }

    #[tokio::test]
    async fn jenkins_public_metadata_survives_unverified_credentials_without_claiming_authentication(
    ) {
        let mut responses = std::collections::VecDeque::from([
            (
                IDENTITY,
                true,
                br#"{"authenticated":true,"anonymous":true}"#.as_slice(),
            ),
            (
                SETTINGS,
                false,
                br#"{"useSecurity":false,"numExecutors":2}"#.as_slice(),
            ),
        ]);
        let values = collect_with(|path, authenticated| {
            let (expected_path, expected_auth, body) = responses.pop_front().unwrap();
            assert_eq!((path, authenticated), (expected_path, expected_auth));
            std::future::ready(Ok((StatusCode::OK, Zeroizing::new(body.to_vec()))))
        })
        .await
        .unwrap();
        assert!(responses.is_empty());
        assert_eq!(values["observer_authenticated"], false);
        assert_eq!(values["anonymous_metadata"], true);
        assert_eq!(values["use_security"], false);
        let credential = serde_json::from_value(serde_json::json!({"kind":"jenkins","port":8080,"username":"observer","secret":"fixture-token"})).unwrap();
        let facts = crate::security::facts::Facts(std::collections::BTreeMap::from([(
            "jenkins_runtime".into(),
            crate::security::facts::Fact {
                output: super::super::envelope(&credential, Ok(values)),
                status: 0,
            },
        )]));
        let result = super::super::evaluate(&facts, super::super::Check::JenkinsSecurity);
        assert!(
            matches!(result,crate::security::modules::ExtraResult::Available {outcome:crate::security::hardening::Outcome::Attention,ref observed,..} if observed.contains("token was not verified"))
        );
    }
}
