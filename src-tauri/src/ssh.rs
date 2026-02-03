use anyhow::{anyhow, Result};
use russh::*;
use russh_keys::*; // Re-adding this for key loading
use std::sync::Arc;

use crate::tunnel::TunnelManager;
use crate::types::{ConnectionConfig, AuthMethod};
use tokio::net::TcpStream;
use russh::client::Msg;

#[derive(Clone)]
pub struct Client {
    pub tunnel_manager: Arc<TunnelManager>,
    // Keep alive session for jump hosts to prevent dropping the underlying tunnel
    pub kept_alive_session: Option<Arc<Box<client::Handle<Client>>>>,
}

impl std::fmt::Debug for Client {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Client")
         .field("tunnel_manager", &"TunnelManager")
         .field("kept_alive_session", &self.kept_alive_session.is_some())
         .finish()
    }
}

#[async_trait::async_trait]
impl client::Handler for Client {
    type Error = russh::Error;

    // ... (existing trait impl) ...
    async fn check_server_key(
        &mut self,
        _server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        println!("[SSH] Accepting server key (auto-trust enabled)");
        Ok(true)
    }

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<Msg>,
        connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        // ... (existing implementation) ...
        println!("[TUNNEL] Incoming forwarded connection on {}:{}", connected_address, connected_port);
        
        let target = {
            let map: tokio::sync::MutexGuard<'_, std::collections::HashMap<u16, (String, u16, String)>> = self.tunnel_manager.remote_forwards.lock().await;
            map.get(&(connected_port as u16)).cloned()
        };

        if let Some((target_host, target_port, _bind_addr)) = target {
             println!("[TUNNEL] Forwarding to {}:{}", target_host, target_port);
             
             let target_addr = format!("{}:{}", target_host, target_port);
             
             tokio::spawn(async move {
                 match TcpStream::connect(&target_addr).await {
                     Ok(mut local_stream) => {
                         let mut channel_stream = channel.into_stream();
                         if let Err(_e) = tokio::io::copy_bidirectional(&mut channel_stream, &mut local_stream).await {
                             // log error
                         }
                     },
                     Err(e) => eprintln!("[TUNNEL] Failed to connect to local target {}: {}", target_addr, e),
                 }
             });
             
             Ok(())
        } else {
             eprintln!("[TUNNEL] No tunnel found for port {}", connected_port);
             Ok(())
        }
    }
}

// ... SshManager ...
pub struct SshManager {
    // Manager state
}

impl SshManager {
    pub fn new() -> Self {
        Self {}
    }

    pub async fn connect(
        &self,
        config: ConnectionConfig,
        tunnel_manager: Arc<crate::tunnel::TunnelManager>,
    ) -> Result<client::Handle<Client>> {
        let client_config = client::Config::default();
        let client_config = Arc::new(client_config);
        
        // Recursive Jump Host Logic
        if let Some(ref jump_host_config) = config.jump_host {
            println!("[SSH] Connecting via Jump Host: {} -> {}", jump_host_config.host, config.host);
            
            // 1. Connect to Jump Host (Recursive)
            let jump_session = Box::pin(self.connect((**jump_host_config).clone(), tunnel_manager.clone())).await
                .map_err(|e| anyhow!("Failed to connect to jump host: {}", e))?;

            println!("[SSH] Jump Host Connected. Opening tunnel to target...");

            // 2. Open Direct TCP/IP Channel through Jump Host
            let channel = jump_session.channel_open_direct_tcpip(
                config.host.clone(),
                config.port as u32,
                "0.0.0.0", // Originator IP (dummy)
                0,         // Originator port (dummy)
            ).await
            .map_err(|e| anyhow!("Failed to open direct-tcpip channel on jump host: {}", e))?;

            // 3. Establish SSH Session over the Channel
            println!("[SSH] Tunnel established. Handshaking with target...");
            let stream = channel.into_stream();
            
            // 4. Create handler HOLDING the jump session to keep it alive
            let client_handler = Client {
                tunnel_manager: tunnel_manager.clone(),
                kept_alive_session: Some(Arc::new(Box::new(jump_session))),
            };

            // russh::client::connect_stream takes stream and handler
            let mut session = russh::client::connect_stream(client_config, stream, client_handler).await?;
            
            // 5. Authenticate (Target)
            return self.authenticate_session(&mut session, &config).await.map(|_| session);
        }

        // Direct Connection Logic
        let client_handler = Client {
            tunnel_manager: tunnel_manager.clone(),
            kept_alive_session: None,
        };

        println!("[SSH] Connecting directly to {}:{}...", config.host, config.port);
        let mut session = client::connect(client_config, (config.host.as_str(), config.port), client_handler).await?;
        
        self.authenticate_session(&mut session, &config).await.map(|_| session)
    }

    async fn authenticate_session(
        &self,
        session: &mut client::Handle<Client>,
        config: &ConnectionConfig,
    ) -> Result<()> {
        println!("[SSH] Connected, authenticating as {}...", config.username);
        
        let (pwd, pk, passphrase) = match &config.auth_method {
            AuthMethod::Password { password } => (Some(password.clone()), None, None),
            AuthMethod::PrivateKey { key_path, passphrase } => (None, Some(key_path.clone()), passphrase.clone()),
        };

        let auth_res = if let Some(pk_path) = pk {
             let mut expanded_path = pk_path.clone();
             if expanded_path.starts_with("~") {
                 if let Some(home) = dirs::home_dir() {
                     expanded_path = expanded_path.replacen("~", &home.to_string_lossy(), 1);
                 }
             }
             println!("[SSH] Loading private key from: {}", expanded_path);
             let key_data = std::fs::read_to_string(&expanded_path)
                 .map_err(|e| anyhow!("Failed to read private key file: {}", e))?;
             
             let key = decode_secret_key(&key_data, passphrase.as_deref())
                 .map_err(|e| anyhow!("Failed to decode private key: {}", e))?;
             
             let key = Arc::new(key);
             session.authenticate_publickey(&config.username, key).await?
        } else if let Some(pwd) = pwd {
             session.authenticate_password(&config.username, pwd).await?
        } else {
             false
        };

        if !auth_res {
             return Err(anyhow!("Authentication failed"));
        }

        println!("[SSH] Authentication successful!");
        Ok(())
    }
}
