use crate::ghost::token::{
    get_command_name, get_last_arg, has_path_separator, is_directory_command,
    is_file_aware_command, line_for_suggestion_parsing,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedSuffix {
    pub suffix: String,
    pub spacing_reason: &'static str,
}

/// Normalize ghost suffix spacing against the full typed line.
/// When the line does not end with whitespace, word completions need a leading
/// space; when it already ends with whitespace, strip duplicate leading space.
pub fn normalize_suggestion_suffix(line: &str, suffix: &str) -> String {
    normalize_suggestion_suffix_with_reason(line, suffix).suffix
}

pub fn normalize_suggestion_suffix_with_reason(line: &str, suffix: &str) -> NormalizedSuffix {
    if suffix.is_empty() {
        return NormalizedSuffix {
            suffix: String::new(),
            spacing_reason: "empty_suffix",
        };
    }

    let ends_with_space = line.ends_with(' ') || line.ends_with('\t');
    if ends_with_space {
        return NormalizedSuffix {
            suffix: suffix.trim_start_matches([' ', '\t']).to_string(),
            spacing_reason: "strip_duplicate_leading_space",
        };
    }

    if should_glue_suffix(line, suffix) {
        return NormalizedSuffix {
            suffix: suffix.trim_start_matches([' ', '\t']).to_string(),
            spacing_reason: "glue_mid_token",
        };
    }

    let starts_with_space = suffix.starts_with(' ') || suffix.starts_with('\t');
    if starts_with_space {
        return NormalizedSuffix {
            suffix: suffix.to_string(),
            spacing_reason: "keep_history_leading_space",
        };
    }

    if suffix_glues_as_path_fragment(line, suffix) {
        return NormalizedSuffix {
            suffix: suffix.to_string(),
            spacing_reason: "glue_path_fragment",
        };
    }

    NormalizedSuffix {
        suffix: format!(" {suffix}"),
        spacing_reason: "add_leading_space",
    }
}

fn suffix_glues_as_path_fragment(line: &str, suffix: &str) -> bool {
    let first = suffix.trim_start().chars().next().unwrap_or('\0');
    if !matches!(first, '/' | '\\' | '~' | '.') {
        return false;
    }
    // Absolute/home/dot paths after a bare command need a leading space.
    let parse_line = line_for_suggestion_parsing(line);
    parse_line.trim_end().split_whitespace().count() >= 2
}

fn should_glue_suffix(line: &str, suffix: &str) -> bool {
    let parse_line = line_for_suggestion_parsing(line);
    let trimmed = parse_line.trim_end();
    let command = get_command_name(trimmed);
    let token_count = trimmed.split_whitespace().count();

    if token_count >= 2 {
        if suffix.starts_with(' ') || suffix.starts_with('\t') {
            let last = get_last_arg(trimmed);
            if has_path_separator(&last) || last.starts_with('.') {
                return true;
            }
            return false;
        }
        return true;
    }

    if is_directory_command(&command) || is_file_aware_command(&command) {
        return false;
    }

    let suffix_trimmed = suffix.trim_start();
    if suffix_trimmed.contains(char::is_whitespace) {
        return false;
    }

    // Partial command-name completion (c→lear, cle→ar).
    true
}

#[cfg(test)]
mod tests {
    use super::normalize_suggestion_suffix;
    use crate::ghost::token::line_for_suggestion_parsing;

    #[test]
    fn pipeline_active_segment_is_tail_command_only() {
        assert_eq!(line_for_suggestion_parsing("echo hi && git"), "git");
    }

    #[test]
    fn adds_leading_space_for_word_completion() {
        assert_eq!(
            normalize_suggestion_suffix("echo hi && git", " checkout staging"),
            " checkout staging"
        );
        assert_eq!(
            normalize_suggestion_suffix("echo hi && git", "checkout staging"),
            " checkout staging"
        );
    }

    #[test]
    fn strips_leading_space_when_line_ends_with_space() {
        assert_eq!(
            normalize_suggestion_suffix("echo hi && git ", "checkout staging"),
            "checkout staging"
        );
    }

    #[test]
    fn path_suffixes_glue_directly() {
        assert_eq!(
            normalize_suggestion_suffix("cd /usr/l", "ocal/"),
            "ocal/"
        );
    }

    #[test]
    fn bare_command_gets_space_before_zero_partial_word_completion() {
        assert_eq!(
            normalize_suggestion_suffix("cd", "Documents"),
            " Documents"
        );
        assert_eq!(
            normalize_suggestion_suffix("cd", "Documents/"),
            " Documents/"
        );
    }

    #[test]
    fn bare_cd_gets_space_before_absolute_path_argument() {
        assert_eq!(normalize_suggestion_suffix("cd", "/usr"), " /usr");
        assert_eq!(normalize_suggestion_suffix("cd", "~/src"), " ~/src");
    }

    #[test]
    fn bare_cd_gets_space_before_dot_path_argument() {
        assert_eq!(
            normalize_suggestion_suffix("cd", ".acme.sh/"),
            " .acme.sh/"
        );
        assert_eq!(
            normalize_suggestion_suffix("cd", "./src"),
            " ./src"
        );
    }

    #[test]
    fn mid_token_dot_path_glues_without_space() {
        assert_eq!(
            normalize_suggestion_suffix("cd .acme", "sh/"),
            "sh/"
        );
        assert_eq!(
            normalize_suggestion_suffix("cd .", "acme.sh/"),
            "acme.sh/"
        );
    }

    #[test]
    fn partial_command_name_glues_without_space() {
        assert_eq!(normalize_suggestion_suffix("c", "lear"), "lear");
        assert_eq!(normalize_suggestion_suffix("c", " lear"), "lear");
        assert_eq!(normalize_suggestion_suffix("cle", "ar"), "ar");
    }

    #[test]
    fn mid_token_path_fragment_glues_without_space() {
        assert_eq!(
            normalize_suggestion_suffix("cd Doc", "uments/"),
            "uments/"
        );
        assert_eq!(
            normalize_suggestion_suffix("git che", "ckout staging"),
            "ckout staging"
        );
        assert_eq!(
            normalize_suggestion_suffix("cd .acme.sh/", "dnsapi/"),
            "dnsapi/"
        );
    }

    #[test]
    fn multi_token_new_word_keeps_leading_space() {
        assert_eq!(
            normalize_suggestion_suffix("git status", " modified"),
            " modified"
        );
    }
}