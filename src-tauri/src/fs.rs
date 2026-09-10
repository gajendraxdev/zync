use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::MetadataExt;
use std::time::UNIX_EPOCH;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub r#type: String, // "d" for directory, "-" for file, "l" for symlink
    pub size: u64,
    pub last_modified: u64,
    pub permissions: String,
    #[serde(default)]
    pub owner: String,
    #[serde(default)]
    pub group: String,
}

/// `/etc/passwd` and `/etc/group` lines: `name:*:id:...`
fn parse_unix_name_map(contents: &str) -> HashMap<u32, String> {
    let mut map = HashMap::new();
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.split(':');
        let name = parts.next().unwrap_or("");
        let _ = parts.next();
        let Some(id) = parts.next().and_then(|value| value.parse::<u32>().ok()) else {
            continue;
        };
        if !name.is_empty() {
            map.entry(id).or_insert_with(|| name.to_string());
        }
    }
    map
}

fn identity_label(name: Option<&str>, id: Option<u32>, map: &HashMap<u32, String>) -> String {
    if let Some(name) = name.map(str::trim).filter(|value| !value.is_empty()) {
        return name.to_string();
    }
    if let Some(id) = id {
        if let Some(mapped) = map.get(&id) {
            return mapped.clone();
        }
        return id.to_string();
    }
    String::new()
}

#[cfg(unix)]
fn load_local_name_map(path: &str) -> HashMap<u32, String> {
    fs::read_to_string(path)
        .map(|contents| parse_unix_name_map(&contents))
        .unwrap_or_default()
}

async fn load_sftp_name_map(
    sftp: &russh_sftp::client::SftpSession,
    path: &str,
) -> HashMap<u32, String> {
    match sftp.read(path).await {
        Ok(bytes) => parse_unix_name_map(&String::from_utf8_lossy(&bytes)),
        Err(_) => HashMap::new(),
    }
}

fn env_nonempty(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|value| !value.is_empty())
}

fn local_home_dir() -> String {
    #[cfg(windows)]
    {
        env_nonempty("USERPROFILE")
            .or_else(|| env_nonempty("HOME"))
            .unwrap_or_else(|| "C:\\".to_string())
    }
    #[cfg(not(windows))]
    {
        env_nonempty("HOME").unwrap_or_else(|| "/".to_string())
    }
}

pub struct FileSystem;

impl FileSystem {
    pub fn new() -> Self {
        Self
    }

    #[allow(dead_code)]
    pub async fn list_dir(&self, connection_id: &str, path: &str) -> Result<Vec<FileEntry>> {
        // Deprecated: logic moved to commands.rs for proper dispatch
        if connection_id == "local" {
            self.list_local(path)
        } else {
            Err(anyhow!(
                "Remote connection not handled in list_dir, use list_remote"
            ))
        }
    }

    pub fn list_local(&self, path: &str) -> Result<Vec<FileEntry>> {
        let path = if path.is_empty() {
            local_home_dir()
        } else {
            path.to_string()
        };

        let dir = fs::read_dir(&path).map_err(|e| anyhow!("Failed to read directory: {}", e))?;
        let mut entries = Vec::new();
        #[cfg(unix)]
        let user_map = load_local_name_map("/etc/passwd");
        #[cfg(unix)]
        let group_map = load_local_name_map("/etc/group");

        for entry in dir {
            let entry = entry.map_err(|e| anyhow!("Failed to read entry: {}", e))?;
            let metadata = fs::symlink_metadata(entry.path())
                .map_err(|e| anyhow!("Failed to read metadata: {}", e))?;
            let file_name = entry.file_name().to_string_lossy().to_string();

            let file_type = if metadata.file_type().is_symlink() {
                "l"
            } else if metadata.is_dir() {
                "d"
            } else {
                "-"
            }
            .to_string();
            let size = metadata.len();
            let last_modified = metadata.modified()?.duration_since(UNIX_EPOCH)?.as_millis() as u64;

            // Permissions handling
            #[cfg(unix)]
            let permissions = format!("{:o}", metadata.mode() & 0o777);

            #[cfg(windows)]
            let permissions = if metadata.permissions().readonly() {
                "444".to_string()
            } else {
                "666".to_string()
            };

            #[cfg(unix)]
            let owner = identity_label(None, Some(metadata.uid()), &user_map);
            #[cfg(unix)]
            let group = identity_label(None, Some(metadata.gid()), &group_map);
            #[cfg(windows)]
            let owner = String::new();
            #[cfg(windows)]
            let group = String::new();

            entries.push(FileEntry {
                name: file_name,
                path: entry.path().to_string_lossy().to_string(),
                r#type: file_type,
                size,
                last_modified,
                permissions,
                owner,
                group,
            });
        }

        // Sort directories and symlinks first, then files
        entries.sort_by(|a, b| {
            let a_dir = a.r#type == "d" || a.r#type == "l";
            let b_dir = b.r#type == "d" || b.r#type == "l";
            if a_dir && !b_dir {
                std::cmp::Ordering::Less
            } else if !a_dir && b_dir {
                std::cmp::Ordering::Greater
            } else {
                a.name.cmp(&b.name)
            }
        });

        Ok(entries)
    }

    pub async fn list_remote(
        &self,
        sftp: &russh_sftp::client::SftpSession,
        path: &str,
    ) -> Result<Vec<FileEntry>> {
        let path = if path.is_empty() { "." } else { path }; // Default to current dir if empty, usually Home

        let entries_iter = sftp
            .read_dir(path)
            .await
            .map_err(|e| anyhow!("SFTP read_dir failed: {}", e))?;
        let entries: Vec<_> = entries_iter.collect();
        let mut result = Vec::new();
        let user_map = load_sftp_name_map(sftp, "/etc/passwd").await;
        let group_map = load_sftp_name_map(sftp, "/etc/group").await;

        for entry in entries {
            let name = entry.file_name();
            // println!("[FS] Entry: {}", name); // Optional verbose log
            // Skip . and ..
            if name == "." || name == ".." {
                continue;
            }

            let attrs = entry.metadata();
            let size = attrs.size.unwrap_or(0);
            let mtime = attrs.mtime.unwrap_or(0) as u64 * 1000; // ms
            let perms = attrs.permissions.unwrap_or(0);

            // Check file-type bits: mask to 0o170000 and compare exact constants.
            // 0o120000 = symlink, 0o040000 = directory, anything else = regular file.
            let type_str = if (perms & 0o170000) == 0o120000 {
                "l"
            } else if (perms & 0o170000) == 0o040000 {
                "d"
            } else {
                "-"
            };

            // Construct path manually
            let full_path = if path == "/" {
                format!("/{}", name)
            } else if path.ends_with('/') {
                format!("{}{}", path, name)
            } else {
                format!("{}/{}", path, name)
            };

            result.push(FileEntry {
                name,
                path: full_path,
                r#type: type_str.to_string(),
                size,
                last_modified: mtime,
                permissions: format!("{:o}", perms & 0o777),
                owner: identity_label(attrs.user.as_deref(), attrs.uid, &user_map),
                group: identity_label(attrs.group.as_deref(), attrs.gid, &group_map),
            });
        }

        // Sort: directories and symlinks first, then files
        result.sort_by(|a, b| {
            let a_dir = a.r#type == "d" || a.r#type == "l";
            let b_dir = b.r#type == "d" || b.r#type == "l";
            if a_dir && !b_dir {
                std::cmp::Ordering::Less
            } else if !a_dir && b_dir {
                std::cmp::Ordering::Greater
            } else {
                a.name.cmp(&b.name)
            }
        });

        Ok(result)
    }

    pub fn get_home_dir(&self, connection_id: &str) -> Result<String> {
        if connection_id == "local" {
            Ok(local_home_dir())
        } else {
            Err(anyhow!("Remote connection not yet implemented"))
        }
    }

    pub async fn read_file(&self, _connection_id: &str, path: &str) -> Result<String> {
        let content = fs::read(path).map_err(|e| anyhow!("Failed to read file: {}", e))?;
        Ok(String::from_utf8_lossy(&content).to_string())
    }

    pub async fn write_file(&self, connection_id: &str, path: &str, content: &str) -> Result<()> {
        if connection_id == "local" {
            fs::write(path, content).map_err(|e| anyhow!("Failed to write file: {}", e))
        } else {
            Err(anyhow!("Remote connection not yet implemented"))
        }
    }
    pub async fn create_file(&self, connection_id: &str, path: &str) -> Result<()> {
        if connection_id == "local" {
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .map_err(|e| anyhow!("Failed to create file: {}", e))?;
            Ok(())
        } else {
            Err(anyhow!("Remote connection not yet implemented"))
        }
    }

    pub async fn create_dir(&self, connection_id: &str, path: &str) -> Result<()> {
        if connection_id == "local" {
            fs::create_dir_all(path).map_err(|e| anyhow!("Failed to create directory: {}", e))
        } else {
            Err(anyhow!("Remote connection not yet implemented"))
        }
    }

    pub async fn rename(&self, connection_id: &str, old_path: &str, new_path: &str) -> Result<()> {
        if connection_id == "local" {
            fs::rename(old_path, new_path).map_err(|e| anyhow!("Failed to rename: {}", e))
        } else {
            Err(anyhow!("Remote connection not yet implemented"))
        }
    }

    pub async fn delete(&self, connection_id: &str, path: &str) -> Result<()> {
        if connection_id == "local" {
            let metadata =
                fs::metadata(path).map_err(|e| anyhow!("Failed to read metadata: {}", e))?;
            if metadata.is_dir() {
                fs::remove_dir_all(path).map_err(|e| anyhow!("Failed to delete directory: {}", e))
            } else {
                fs::remove_file(path).map_err(|e| anyhow!("Failed to delete file: {}", e))
            }
        } else {
            Err(anyhow!("Remote connection not yet implemented"))
        }
    }

    pub async fn copy(&self, connection_id: &str, from: &str, to: &str) -> Result<()> {
        if connection_id == "local" {
            let metadata = fs::metadata(from).map_err(|e| anyhow!("Source not found: {}", e))?;
            if metadata.is_dir() {
                Self::copy_dir_recursive(from, to)
            } else {
                fs::copy(from, to).map_err(|e| anyhow!("Failed to copy file: {}", e))?;
                Ok(())
            }
        } else {
            Err(anyhow!("Remote connection not yet implemented"))
        }
    }

    pub async fn exists(&self, connection_id: &str, path: &str) -> Result<bool> {
        if connection_id == "local" {
            Ok(std::path::Path::new(path).exists())
        } else {
            Err(anyhow!(
                "Remote connection not yet implemented in exists() - use exists_remote"
            ))
        }
    }

    // --- Remote Operations ---

    pub async fn read_remote(
        &self,
        sftp: &russh_sftp::client::SftpSession,
        path: &str,
    ) -> Result<String> {
        let content = sftp
            .read(path)
            .await
            .map_err(|e| anyhow!("Failed to read remote file: {}", e))?;
        Ok(String::from_utf8_lossy(&content).to_string())
    }

    pub async fn write_remote(
        &self,
        sftp: &russh_sftp::client::SftpSession,
        path: &str,
        content: &[u8],
    ) -> Result<()> {
        use russh_sftp::protocol::OpenFlags;
        let mut file = sftp
            .open_with_flags(
                path,
                OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
            )
            .await
            .map_err(|e| anyhow!("Failed to open file for writing '{}': {}", path, e))?;

        use tokio::io::AsyncWriteExt;
        file.write_all(content)
            .await
            .map_err(|e| anyhow!("Failed to write content to '{}': {}", path, e))?;
        Ok(())
    }

    pub async fn create_file_remote(
        &self,
        sftp: &russh_sftp::client::SftpSession,
        path: &str,
    ) -> Result<()> {
        use russh_sftp::protocol::OpenFlags;
        let _file = sftp
            .open_with_flags(
                path,
                OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::EXCLUDE,
            )
            .await
            .map_err(|e| anyhow!("Failed to create file '{}': {}", path, e))?;
        Ok(())
    }

    pub async fn create_dir_remote(
        &self,
        sftp: &russh_sftp::client::SftpSession,
        path: &str,
    ) -> Result<()> {
        sftp.create_dir(path)
            .await
            .map_err(|e| anyhow!("Failed to create remote directory '{}': {}", path, e))
    }

    pub async fn rename_remote(
        &self,
        sftp: &russh_sftp::client::SftpSession,
        old_path: &str,
        new_path: &str,
    ) -> Result<()> {
        sftp.rename(old_path, new_path)
            .await
            .map_err(|e| anyhow!("Failed to rename remote file: {}", e))
    }

    pub async fn delete_remote(
        &self,
        sftp: &russh_sftp::client::SftpSession,
        path: &str,
    ) -> Result<()> {
        let metadata = sftp
            .metadata(path)
            .await
            .map_err(|e| anyhow!("Failed to stat file: {}", e))?;
        if metadata.is_dir() {
            self.delete_dir_recursive_remote(sftp, path).await
        } else {
            sftp.remove_file(path)
                .await
                .map_err(|e| anyhow!("Failed to remove file: {}", e))
        }
    }

    fn delete_dir_recursive_remote<'a>(
        &'a self,
        sftp: &'a russh_sftp::client::SftpSession,
        path: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let entries = sftp
                .read_dir(path)
                .await
                .map_err(|e| anyhow!("Failed to list dir '{}': {}", path, e))?;

            for entry in entries {
                let name = entry.file_name();
                if name == "." || name == ".." {
                    continue;
                }

                let full_path = if path.ends_with('/') {
                    format!("{}{}", path, name)
                } else {
                    format!("{}/{}", path, name)
                };

                // Check if directory
                let is_dir = entry.file_type().is_dir();

                if is_dir && !entry.file_type().is_symlink() {
                    self.delete_dir_recursive_remote(sftp, &full_path).await?;
                } else {
                    sftp.remove_file(&full_path)
                        .await
                        .map_err(|e| anyhow!("Failed to remove file '{}': {}", full_path, e))?;
                }
            }

            sftp.remove_dir(path)
                .await
                .map_err(|e| anyhow!("Failed to remove dir '{}': {}", path, e))?;
            Ok(())
        })
    }

    pub async fn copy_remote(
        &self,
        sftp: &russh_sftp::client::SftpSession,
        from: &str,
        to: &str,
    ) -> Result<()> {
        let metadata = sftp
            .metadata(from)
            .await
            .map_err(|e| anyhow!("Failed to stat source '{}': {}", from, e))?;

        if metadata.is_dir() {
            self.copy_dir_recursive_remote(sftp, from, to).await
        } else {
            self.copy_file_remote(sftp, from, to).await
        }
    }

    // Helper for streaming file copy
    async fn copy_file_remote(
        &self,
        sftp: &russh_sftp::client::SftpSession,
        from: &str,
        to: &str,
    ) -> Result<()> {
        use russh_sftp::protocol::OpenFlags;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        println!("[FS] Copying file from '{}' to '{}'", from, to);

        // Read
        let mut source = sftp
            .open_with_flags(from, OpenFlags::READ)
            .await
            .map_err(|e| anyhow!("Failed to open source '{}': {}", from, e))?;

        // Write
        let mut dest = sftp
            .open_with_flags(
                to,
                OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
            )
            .await
            .map_err(|e| anyhow!("Failed to open dest '{}': {}", to, e))?;

        // Manual copy loop with 4MB buffer to maximize throughput on high-latency links
        let mut buffer = vec![0u8; 4194304];
        let mut total_bytes = 0;

        loop {
            let n = source
                .read(&mut buffer)
                .await
                .map_err(|e| anyhow!("Read error at {} bytes: {}", total_bytes, e))?;

            if n == 0 {
                break;
            }

            dest.write_all(&buffer[..n])
                .await
                .map_err(|e| anyhow!("Write error at {} bytes: {}", total_bytes, e))?;

            total_bytes += n;
        }

        dest.flush()
            .await
            .map_err(|e| anyhow!("Flush error: {}", e))?;

        println!("[FS] Copied {} bytes", total_bytes);
        Ok(())
    }

    // Helper for recursive dir copy - Manually boxed for recursion
    fn copy_dir_recursive_remote<'a>(
        &'a self,
        sftp: &'a russh_sftp::client::SftpSession,
        from: &'a str,
        to: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            println!("[FS] Copying directory from '{}' to '{}'", from, to);

            // Create dest dir
            // Ignore error if it already exists (could be merging)
            let _ = sftp.create_dir(to).await;

            // List source
            let entries = sftp
                .read_dir(from)
                .await
                .map_err(|e| anyhow!("Failed to list source dir '{}': {}", from, e))?;

            for entry in entries {
                let file_name = entry.file_name();
                if file_name == "." || file_name == ".." {
                    continue;
                }

                // Robust path joining
                let source_path = if from.ends_with('/') {
                    format!("{}{}", from, file_name)
                } else {
                    format!("{}/{}", from, file_name)
                };

                let dest_path = if to.ends_with('/') {
                    format!("{}{}", to, file_name)
                } else {
                    format!("{}/{}", to, file_name)
                };

                // Recursive call
                let is_dir = entry.file_type().is_dir();

                if is_dir && !entry.file_type().is_symlink() {
                    self.copy_dir_recursive_remote(sftp, &source_path, &dest_path)
                        .await?;
                } else {
                    // If it is a symlink, treated as file (might fail read if dangling, or copy content if valid)
                    // Ideally we should recreate the symlink, but copying content (dereference) is safer than infinite recursion.
                    // Or better: Just SKIP symlinks for now or try copy. If it's a symlink to dir, we don't recurse.
                    self.copy_file_remote(sftp, &source_path, &dest_path)
                        .await?;
                }
            }

            Ok(())
        })
    }

    pub async fn exists_remote(
        &self,
        sftp: &russh_sftp::client::SftpSession,
        path: &str,
    ) -> Result<bool> {
        sftp.try_exists(path)
            .await
            .map_err(|e| anyhow!("Failed to check existence: {}", e))
    }

    pub async fn get_unique_path_remote(
        &self,
        sftp: &russh_sftp::client::SftpSession,
        path: &str,
    ) -> Result<String> {
        if !self.exists_remote(sftp, path).await? {
            return Ok(path.to_string());
        }

        let path_buf = std::path::PathBuf::from(path);
        let parent = path_buf
            .parent()
            .unwrap_or_else(|| std::path::Path::new(""));
        let file_stem = path_buf.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let extension = path_buf.extension().and_then(|s| s.to_str()).unwrap_or("");

        if file_stem.is_empty() {
            return Err(anyhow!(
                "Cannot generate unique path for root or invalid path"
            ));
        }

        let mut counter = 1;
        while counter <= 100 {
            let new_name = if extension.is_empty() {
                format!("{} ({})", file_stem, counter)
            } else {
                format!("{} ({}).{}", file_stem, counter, extension)
            };

            let new_path = parent
                .join(new_name)
                .to_string_lossy()
                .to_string()
                .replace("\\", "/");

            if !self.exists_remote(sftp, &new_path).await? {
                return Ok(new_path);
            }
            counter += 1;
        }

        Err(anyhow!("Too many duplicate files (limit 100)"))
    }

    fn copy_dir_recursive(from: &str, to: &str) -> Result<()> {
        fs::create_dir_all(to).map_err(|e| anyhow!("Failed to create destination dir: {}", e))?;
        for entry in fs::read_dir(from).map_err(|e| anyhow!("Failed to read source dir: {}", e))? {
            let entry = entry.map_err(|e| anyhow!("Failed to read entry: {}", e))?;
            let ft = entry
                .file_type()
                .map_err(|e| anyhow!("Failed to read file type: {}", e))?;
            let dest_path = std::path::Path::new(to).join(entry.file_name());
            if ft.is_dir() {
                Self::copy_dir_recursive(
                    &entry.path().to_string_lossy(),
                    &dest_path.to_string_lossy(),
                )?;
            } else {
                fs::copy(entry.path(), dest_path)
                    .map_err(|e| anyhow!("Failed to copy file: {}", e))?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_unix_name_map_reads_passwd_lines() {
        let map = parse_unix_name_map(
            "root:x:0:0:root:/root:/bin/bash\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\n",
        );
        assert_eq!(map.get(&0).map(String::as_str), Some("root"));
        assert_eq!(map.get(&65534).map(String::as_str), Some("nobody"));
    }

    #[test]
    fn identity_label_prefers_name_then_map_then_id() {
        let mut map = HashMap::new();
        map.insert(1000, "gajen".to_string());
        assert_eq!(identity_label(Some("alice"), Some(1), &map), "alice");
        assert_eq!(identity_label(None, Some(1000), &map), "gajen");
        assert_eq!(identity_label(None, Some(42), &map), "42");
        assert_eq!(identity_label(None, None, &map), "");
    }
}
