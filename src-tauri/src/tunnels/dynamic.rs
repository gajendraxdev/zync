//! Dynamic (SOCKS5) port forwarding — local proxy through an SSH session.

use crate::ssh::Client;
use crate::tunnels::socks5::{
    self, connect_success_reply, error_reply, method_selection_reply, parse_connect_request,
    socks5_error_to_reply, Socks5Error, ATYP_DOMAIN, ATYP_IPV4, ATYP_IPV6, CMD_CONNECT, VERSION,
};
use anyhow::Result;
use russh::client::Handle;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{broadcast, Mutex};

pub async fn handle_socks5_client(
    mut client: TcpStream,
    session: Arc<Mutex<Handle<Client>>>,
    mut cancel: broadcast::Receiver<()>,
) {
    if let Err(error) = run_socks5_client(&mut client, session, &mut cancel).await {
        eprintln!("[TUNNEL][SOCKS] client handler error: {error}");
    }
}

async fn run_socks5_client(
    client: &mut TcpStream,
    session: Arc<Mutex<Handle<Client>>>,
    cancel: &mut broadcast::Receiver<()>,
) -> Result<()> {
    let mut greeting = [0u8; 2];
    tokio::select! {
        result = client.read_exact(&mut greeting) => result?,
        _ = cancel.recv() => return Ok(()),
    };

    let nmethods = greeting[1] as usize;
    let mut methods = vec![0u8; nmethods];
    client.read_exact(&mut methods).await?;

    let mut full_greeting = greeting.to_vec();
    full_greeting.extend_from_slice(&methods);
    socks5::validate_client_greeting(&full_greeting)?;

    client.write_all(&method_selection_reply()).await?;

    let target = match read_connect_target(client).await {
        Ok(target) => target,
        Err(error) => {
            let _ = client
                .write_all(&error_reply(socks5_error_to_reply(&error)))
                .await;
            return Err(anyhow::Error::new(error));
        }
    };

    let channel = {
        let session_guard = session.lock().await;
        session_guard
            .channel_open_direct_tcpip(target.host.clone(), target.port as u32, "127.0.0.1", 0)
            .await
    };

    let channel = match channel {
        Ok(channel) => channel,
        Err(error) => {
            let _ = client
                .write_all(&error_reply(socks5::REP_GENERAL_FAILURE))
                .await;
            return Err(error.into());
        }
    };

    client.write_all(&connect_success_reply()).await?;

    let mut stream = channel.into_stream();
    tokio::select! {
        result = tokio::io::copy_bidirectional(client, &mut stream) => {
            if let Err(error) = result {
                eprintln!(
                    "[TUNNEL][SOCKS] relay error to {}:{} — {error}",
                    target.host,
                    target.port
                );
            }
        }
        _ = cancel.recv() => {}
    }

    Ok(())
}

async fn read_connect_target(client: &mut TcpStream) -> Result<socks5::ConnectTarget, Socks5Error> {
    let mut header = [0u8; 4];
    client
        .read_exact(&mut header)
        .await
        .map_err(|_| Socks5Error::InvalidMessage("connect header"))?;

    if header[0] != VERSION {
        return Err(Socks5Error::UnsupportedVersion(header[0]));
    }
    if header[1] != CMD_CONNECT {
        return Err(Socks5Error::UnsupportedCommand(header[1]));
    }

    let body = match header[3] {
        ATYP_IPV4 => {
            let mut bytes = [0u8; 6];
            client
                .read_exact(&mut bytes)
                .await
                .map_err(|_| Socks5Error::InvalidMessage("ipv4 target"))?;
            bytes.to_vec()
        }
        ATYP_DOMAIN => {
            let mut len_buf = [0u8; 1];
            client
                .read_exact(&mut len_buf)
                .await
                .map_err(|_| Socks5Error::InvalidMessage("domain length"))?;
            let len = len_buf[0] as usize;
            let mut tail = vec![0u8; len + 2];
            client
                .read_exact(&mut tail)
                .await
                .map_err(|_| Socks5Error::InvalidMessage("domain target"))?;
            let mut out = len_buf.to_vec();
            out.extend_from_slice(&tail);
            out
        }
        ATYP_IPV6 => {
            let mut bytes = [0u8; 18];
            client
                .read_exact(&mut bytes)
                .await
                .map_err(|_| Socks5Error::InvalidMessage("ipv6 target"))?;
            bytes.to_vec()
        }
        other => return Err(Socks5Error::UnsupportedAddressType(other)),
    };

    let mut request = header.to_vec();
    request.extend_from_slice(&body);
    parse_connect_request(&request)
}