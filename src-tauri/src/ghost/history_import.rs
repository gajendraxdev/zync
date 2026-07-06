use crate::ghost::types::MIN_PREFIX_LEN;

/// Parse bash or zsh shell history file content into commands (file order, oldest first).
pub fn parse_shell_history(content: &str) -> Vec<String> {
    let mut commands = Vec::new();

    for line in assemble_continued_lines(content) {
        if let Some(cmd) = parse_history_line(&line) {
            if cmd.len() >= MIN_PREFIX_LEN {
                commands.push(cmd);
            }
        }
    }

    commands
}

fn assemble_continued_lines(content: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut current = String::new();
    let mut continue_pending = false;

    for line in content.lines() {
        if continue_pending {
            current.push_str(line);
            continue_pending = false;
        } else if current.is_empty() {
            current = line.to_string();
        } else {
            current.push('\n');
            current.push_str(line);
        }

        if current.ends_with('\\') {
            current.pop();
            continue_pending = true;
            continue;
        }

        result.push(std::mem::take(&mut current));
    }

    if !current.is_empty() {
        result.push(current);
    }

    result
}

fn parse_history_line(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Zsh extended history: `: <unix_ts>:<duration>;<command>`
    if let Some(cmd) = trimmed.strip_prefix(':') {
        return cmd
            .split_once(';')
            .map(|(_, command)| normalize_history_command(command));
    }

    // Bash timestamp or comment lines (`#1700000000`, `# comment`).
    if trimmed.starts_with('#') {
        return None;
    }

    Some(normalize_history_command(trimmed))
}

fn normalize_history_command(command: &str) -> String {
    command.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::parse_shell_history;

    #[test]
    fn parses_zsh_extended_history() {
        let content = ": 1700000000:0;cd /var/log\n: 1700000001:0;git status\n";
        assert_eq!(
            parse_shell_history(content),
            vec!["cd /var/log".to_string(), "git status".to_string()]
        );
    }

    #[test]
    fn parses_bash_plain_history() {
        let content = "cd /var/log\ngit status\n";
        assert_eq!(
            parse_shell_history(content),
            vec!["cd /var/log".to_string(), "git status".to_string()]
        );
    }

    #[test]
    fn skips_bash_timestamp_lines() {
        let content = "#1700000000\nclear\n#1700000001\ncd /tmp\n";
        assert_eq!(
            parse_shell_history(content),
            vec!["clear".to_string(), "cd /tmp".to_string()]
        );
    }

    #[test]
    fn reassembles_zsh_backslash_continued_commands() {
        let content = ": 1700000000:1;echo hello \\\nworld\n";
        assert_eq!(
            parse_shell_history(content),
            vec!["echo hello world".to_string()]
        );
    }
}