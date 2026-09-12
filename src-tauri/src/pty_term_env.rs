//! Local PTY process environment for terminal-identity probes.
//!
//! Tools like fastfetch/chafa look at `TERM_PROGRAM`, `WT_SESSION`, `VSCODE_*`.
//! If Zync was launched from VS Code / Cursor, those leak into the shell and
//! the tool assumes it is still inside that IDE (no Sixel).

use portable_pty::CommandBuilder;

pub const LOCAL_PTY_TERM: &str = "xterm-256color";
pub const LOCAL_PTY_TERM_PROGRAM: &str = "zync";
pub const LOCAL_PTY_COLORTERM: &str = "truecolor";

pub fn is_foreign_terminal_identity_env(key: &str) -> bool {
    let k = key.to_ascii_uppercase();
    matches!(
        k.as_str(),
        "TERM_PROGRAM"
            | "TERM_PROGRAM_VERSION"
            | "TERM_SESSION_ID"
            | "WT_SESSION"
            | "WT_PROFILE_ID"
            | "WEZTERM_PANE"
            | "WEZTERM_UNIX_SOCKET"
            | "WEZTERM_EXECUTABLE"
            | "KITTY_WINDOW_ID"
            | "KITTY_PID"
            | "KITTY_LISTEN_ON"
            | "ITERM_SESSION_ID"
            | "ITERM_PROFILE"
            | "LC_TERMINAL"
            | "LC_TERMINAL_VERSION"
            | "ALACRITTY_SOCKET"
            | "ALACRITTY_WINDOW_ID"
            | "GHOSTTY_RESOURCES_DIR"
            | "GHOSTTY_BIN_DIR"
            | "ZED_TERM"
            | "INSIDE_EMACS"
            | "ELECTRON_RUN_AS_NODE"
            | "GIT_ASKPASS"
            | "SSH_ASKPASS"
            | "VSCODE_GIT_ASKPASS"
    ) || k.starts_with("VSCODE_")
        || k.starts_with("CURSOR_")
}

pub fn apply_local_pty_term_env(cmd: &mut CommandBuilder, app_version: &str) {
    for (key, _) in std::env::vars() {
        if is_foreign_terminal_identity_env(&key) {
            cmd.env_remove(key);
        }
    }
    cmd.env("TERM", LOCAL_PTY_TERM);
    cmd.env("COLORTERM", LOCAL_PTY_COLORTERM);
    cmd.env("TERM_PROGRAM", LOCAL_PTY_TERM_PROGRAM);
    cmd.env("TERM_PROGRAM_VERSION", app_version);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_vscode_and_windows_terminal_identity() {
        assert!(is_foreign_terminal_identity_env("TERM_PROGRAM"));
        assert!(is_foreign_terminal_identity_env("TERM_PROGRAM_VERSION"));
        assert!(is_foreign_terminal_identity_env("WT_SESSION"));
        assert!(is_foreign_terminal_identity_env("VSCODE_PID"));
        assert!(is_foreign_terminal_identity_env("vscode_ipc_hook"));
        assert!(is_foreign_terminal_identity_env("CURSOR_AGENT"));
        assert!(is_foreign_terminal_identity_env("GIT_ASKPASS"));
    }

    #[test]
    fn keeps_normal_shell_env() {
        assert!(!is_foreign_terminal_identity_env("TERM"));
        assert!(!is_foreign_terminal_identity_env("COLORTERM"));
        assert!(!is_foreign_terminal_identity_env("PATH"));
        assert!(!is_foreign_terminal_identity_env("HOME"));
        assert!(!is_foreign_terminal_identity_env("USERPROFILE"));
        assert!(!is_foreign_terminal_identity_env("SHELL"));
    }
}
