//! Versioned, data-only icon packs. Every referenced resource is package-local static SVG.
use anyhow::{anyhow, Context, Result};
use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::Read,
    path::Path,
};

const MAX_ICONS: usize = 512;
const MAX_ASSOCIATIONS: usize = 2048;
const MAX_ICON_BYTES: u64 = 128 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IconDefinition {
    pub icon_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IconTheme {
    pub version: u32,
    pub icon_definitions: BTreeMap<String, IconDefinition>,
    pub file: String,
    pub folder: String,
    #[serde(default)]
    pub file_names: BTreeMap<String, String>,
    #[serde(default)]
    pub file_extensions: BTreeMap<String, String>,
    #[serde(default)]
    pub folder_names: BTreeMap<String, String>,
}

impl IconTheme {
    pub fn validate(&self) -> Result<()> {
        if self.version != 1
            || self.icon_definitions.is_empty()
            || self.icon_definitions.len() > MAX_ICONS
        {
            return Err(anyhow!(
                "iconTheme v1 requires between 1 and {MAX_ICONS} icon definitions"
            ));
        }
        for (id, definition) in &self.icon_definitions {
            super::validation::validate_identifier(id, "icon id")?;
            super::validation::validate_optional_asset(Some(&definition.icon_path), "iconPath")?;
            if !definition.icon_path.ends_with(".svg")
                || definition.icon_path.contains(['%', '?', '#', ':', '\\'])
                || definition
                    .icon_path
                    .split('/')
                    .any(|part| part.is_empty() || part == "." || part == "..")
            {
                return Err(anyhow!("iconPath must reference a package-local .svg without URL encoding, query or fragment"));
            }
        }
        let reference = |id: &str| -> Result<()> {
            if !self.icon_definitions.contains_key(id) {
                return Err(anyhow!("Unknown icon id: {id}"));
            }
            Ok(())
        };
        reference(&self.file)?;
        reference(&self.folder)?;
        let mut total = 0;
        for mapping in [&self.file_names, &self.file_extensions, &self.folder_names] {
            total += mapping.len();
            let mut names = HashSet::new();
            for (name, id) in mapping {
                if name.is_empty()
                    || name.chars().count() > 255
                    || name.contains(['/', '\\'])
                    || name.chars().any(char::is_control)
                    || !names.insert(name.to_lowercase())
                {
                    return Err(anyhow!("Icon associations require unique case-insensitive leaf names of at most 255 characters"));
                }
                reference(id)?;
            }
        }
        if total > MAX_ASSOCIATIONS {
            return Err(anyhow!("iconTheme exceeds {MAX_ASSOCIATIONS} associations"));
        }
        Ok(())
    }

    pub fn validate_assets(&self, root: &Path) -> Result<()> {
        self.validate()?;
        let root = fs::canonicalize(root)?;
        let mut checked = HashSet::new();
        for definition in self.icon_definitions.values() {
            if !checked.insert(&definition.icon_path) {
                continue;
            }
            let mut path = root.clone();
            for segment in definition.icon_path.split('/') {
                path.push(segment);
                if fs::symlink_metadata(&path)?.file_type().is_symlink() {
                    return Err(anyhow!("Icon resources cannot use symbolic links"));
                }
            }
            let path = fs::canonicalize(path)?;
            let metadata = fs::metadata(&path)?;
            if !path.starts_with(&root) || !metadata.is_file() || metadata.len() > MAX_ICON_BYTES {
                return Err(anyhow!(
                    "Icon resources must be regular package-local files of at most 128 KiB"
                ));
            }
            let mut source = String::new();
            fs::File::open(path)?
                .take(MAX_ICON_BYTES + 1)
                .read_to_string(&mut source)?;
            if source.len() as u64 > MAX_ICON_BYTES {
                return Err(anyhow!("Icon exceeds 128 KiB"));
            }
            validate_svg(&source)
                .with_context(|| format!("Invalid icon {}", definition.icon_path))?;
        }
        Ok(())
    }
}

/// A deliberately small SVG vocabulary: no scripts, CSS, network references, animation or entities.
pub(crate) fn validate_svg(source: &str) -> Result<()> {
    if source.contains('&') {
        return Err(anyhow!("SVG entities are unsupported"));
    }
    let mut reader = Reader::from_str(source);
    let mut depth = 0usize;
    let mut roots = 0;
    let mut elements = 0;
    loop {
        let event = reader.read_event()?;
        let empty = matches!(&event, Event::Empty(_));
        match event {
            Event::Start(node) | Event::Empty(node) => {
                let name_bytes = node.name();
                let name = std::str::from_utf8(name_bytes.as_ref())?;
                if depth == 0 {
                    roots += 1;
                    if name != "svg" || roots != 1 {
                        return Err(anyhow!("Expected one SVG root"));
                    }
                }
                if !matches!(
                    name,
                    "svg"
                        | "g"
                        | "path"
                        | "rect"
                        | "circle"
                        | "ellipse"
                        | "line"
                        | "polyline"
                        | "polygon"
                        | "defs"
                        | "linearGradient"
                        | "radialGradient"
                        | "stop"
                        | "clipPath"
                        | "title"
                        | "desc"
                ) {
                    return Err(anyhow!("Unsupported SVG element: {name}"));
                }
                elements += 1;
                if elements > 4096 || depth >= 64 {
                    return Err(anyhow!("SVG structure exceeds limits"));
                }
                for attribute in node.attributes() {
                    let attribute = attribute?;
                    let key = std::str::from_utf8(attribute.key.as_ref())?;
                    if !matches!(
                        key,
                        "xmlns"
                            | "xmlns:xlink"
                            | "version"
                            | "viewBox"
                            | "width"
                            | "height"
                            | "preserveAspectRatio"
                            | "id"
                            | "d"
                            | "x"
                            | "y"
                            | "x1"
                            | "y1"
                            | "x2"
                            | "y2"
                            | "cx"
                            | "cy"
                            | "r"
                            | "rx"
                            | "ry"
                            | "points"
                            | "fill"
                            | "fill-rule"
                            | "fill-opacity"
                            | "stroke"
                            | "stroke-width"
                            | "stroke-linecap"
                            | "stroke-linejoin"
                            | "stroke-opacity"
                            | "stroke-miterlimit"
                            | "stroke-dasharray"
                            | "stroke-dashoffset"
                            | "opacity"
                            | "transform"
                            | "clip-path"
                            | "clip-rule"
                            | "gradientUnits"
                            | "gradientTransform"
                            | "offset"
                            | "stop-color"
                            | "stop-opacity"
                            | "color"
                            | "image-rendering"
                            | "shape-rendering"
                            | "text-rendering"
                    ) && !key.starts_with("data-")
                    {
                        return Err(anyhow!("Unsupported SVG attribute: {key}"));
                    }
                    let value = attribute.decode_and_unescape_value(reader.decoder())?;
                    let value = value.trim();
                    if key == "xmlns" && value != "http://www.w3.org/2000/svg"
                        || key == "xmlns:xlink" && value != "http://www.w3.org/1999/xlink"
                        || value.contains('\\')
                        || value.contains("/*")
                        || value.contains("*/")
                    {
                        return Err(anyhow!("Unsupported SVG reference"));
                    }
                    if matches!(
                        key,
                        "fill" | "stroke" | "clip-path" | "stop-color" | "color"
                    ) && value.to_ascii_lowercase().contains("url(")
                    {
                        let fragment = value
                            .strip_prefix("url(")
                            .and_then(|s| s.strip_suffix(')'))
                            .unwrap_or("");
                        if !valid_fragment(fragment) {
                            return Err(anyhow!("Only local SVG paint references are supported"));
                        }
                    }
                }
                if !empty {
                    depth += 1;
                }
            }
            Event::End(_) => {
                depth = depth
                    .checked_sub(1)
                    .ok_or_else(|| anyhow!("Unbalanced SVG"))?;
            }
            Event::DocType(_) | Event::Decl(_) | Event::PI(_) | Event::GeneralRef(_) => {
                return Err(anyhow!(
                    "SVG entities and processing instructions are unsupported"
                ))
            }
            Event::CData(_) if depth == 0 => return Err(anyhow!("CDATA outside SVG root")),
            Event::Eof => break,
            Event::Text(text) if depth == 0 && !text.iter().all(u8::is_ascii_whitespace) => {
                return Err(anyhow!("Text outside SVG root"))
            }
            _ => {}
        }
    }
    if roots != 1 || depth != 0 {
        return Err(anyhow!("Incomplete SVG"));
    }
    Ok(())
}

fn valid_fragment(value: &str) -> bool {
    value.strip_prefix('#').is_some_and(|id| {
        !id.is_empty()
            && id.len() <= 128
            && id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::Manifest;

    fn sample() -> Manifest {
        serde_json::from_str(include_str!(
            "../../../../tests/fixtures/plugins/icon-theme/manifest.json"
        ))
        .unwrap()
    }

    #[test]
    fn authored_pack_has_no_runtime_and_validates_its_assets() {
        let manifest = sample();
        manifest.validate().unwrap();
        manifest.validate_host_compatibility().unwrap();
        assert_eq!(manifest.runtime_entry(), None);
        manifest
            .validate_package_assets(
                &Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/plugins/icon-theme"),
            )
            .unwrap();
    }

    #[test]
    fn builtin_catalog_uses_the_same_contract_and_all_shipped_svg_assets_pass() {
        let plugins = crate::plugins::builtins::builtin_icon_themes();
        assert_eq!(plugins.len(), 3);
        assert_eq!(plugins[0].manifest.id, "vscode-icons");
        for plugin in plugins {
            plugin.manifest.validate().unwrap();
            assert!(plugin.script.is_none());
            if let Some(theme) = plugin.manifest.extensions.icon_theme {
                assert_eq!(theme.icon_definitions.len(), 65);
                for definition in theme.icon_definitions.values() {
                    let filename = definition.icon_path.strip_prefix("icons/").unwrap();
                    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
                        .join("../src/assets/material-icons")
                        .join(filename);
                    validate_svg(&fs::read_to_string(path).unwrap()).unwrap();
                }
            }
        }
    }

    #[test]
    fn rejects_executable_entries_permissions_and_older_api_ranges() {
        let base = serde_json::to_value(sample()).unwrap();
        for (field, value) in [
            ("main", serde_json::json!("worker.js")),
            ("runtime", serde_json::json!({"entry":"worker.js"})),
            ("style", serde_json::json!("theme.css")),
            ("iconsPath", serde_json::json!("icons")),
            (
                "permissions",
                serde_json::json!({"required":[{"id":"network.fetch","reason":"test","hosts":["example.com"]}]}),
            ),
        ] {
            let mut value_copy = base.clone();
            value_copy[field] = value;
            let manifest: Manifest = serde_json::from_value(value_copy).unwrap();
            assert!(manifest.validate().is_err(), "{field}");
        }
        for range in ["^2.0.0", ">=2.1.1", "*", ">=2.0.0, <3.0.0"] {
            let mut manifest = sample();
            manifest.extensions.engines.as_mut().unwrap().plugin_api = Some(range.into());
            assert!(manifest.validate().is_err(), "{range}");
        }
    }

    #[test]
    fn external_packages_cannot_replace_builtin_icon_identities() {
        let root = tempfile::tempdir().unwrap();
        let mut legacy = sample();
        legacy.extensions.manifest_version = None;
        assert!(legacy
            .validate_package_assets(root.path())
            .unwrap_err()
            .to_string()
            .contains("Manifest v2"));
        for builtin in crate::plugins::builtins::builtin_icon_themes() {
            let mut manifest = sample();
            manifest.id = builtin.manifest.id;
            assert!(manifest
                .validate_package_assets(root.path())
                .unwrap_err()
                .to_string()
                .contains("identities"));
        }
    }

    #[test]
    fn rejects_mapping_errors_paths_versions_and_case_collisions() {
        let original = sample().extensions.icon_theme.unwrap();
        for path in [
            "../file.svg",
            "/file.svg",
            "C:/file.svg",
            "icons\\file.svg",
            "icons/%2e.svg",
            "icons//file.svg",
            "icons/./file.svg",
            "icons/file.svg?q=1",
            "icons/file.png",
        ] {
            let mut theme = original.clone();
            theme.icon_definitions.get_mut("file").unwrap().icon_path = path.into();
            assert!(theme.validate().is_err(), "{path}");
        }
        let mut theme = original.clone();
        theme.version = 2;
        assert!(theme.validate().is_err());
        let mut theme = original.clone();
        theme.file = "missing".into();
        assert!(theme.validate().is_err());
        let mut theme = original;
        theme
            .file_names
            .insert("PACKAGE.JSON".into(), "file".into());
        assert!(theme.validate().is_err());
    }

    #[test]
    fn rejects_active_remote_or_malformed_svg() {
        for source in [
            "",
            "<svg>",
            "<svg/><svg/>",
            "<html/>",
            "<svg><script/></svg>",
            "<svg onload='alert(1)'/>",
            "<svg><foreignObject/></svg>",
            "<svg><image href='https://example.com'/></svg>",
            "<svg><style/></svg>",
            "<svg><animate/></svg>",
            "<svg><use href='#loop'/></svg>",
            "<svg fill='url(https://example.com)'/>",
            "<svg fill='u\\72l(https://example.com)'/>",
            "<!DOCTYPE svg><svg/>",
            "<?xml-stylesheet href='https://example.com'?><svg/>",
            "<svg><title>&amp;</title></svg>",
        ] {
            assert!(validate_svg(source).is_err(), "{source}");
        }
        assert!(validate_svg("<svg xmlns='http://www.w3.org/2000/svg'><defs><linearGradient id='a'><stop offset='0' stop-color='#fff'/></linearGradient></defs><path fill='url(#a)' d='M0 0'/></svg>").is_ok());
    }

    #[test]
    fn rejects_missing_and_oversized_resources_before_activation() {
        let root = tempfile::tempdir().unwrap();
        let theme = sample().extensions.icon_theme.unwrap();
        assert!(theme.validate_assets(root.path()).is_err());
        fs::create_dir(root.path().join("icons")).unwrap();
        for name in ["file", "folder", "source"] {
            fs::write(root.path().join(format!("icons/{name}.svg")), "<svg/>").unwrap();
        }
        theme.validate_assets(root.path()).unwrap();
        fs::write(
            root.path().join("icons/file.svg"),
            vec![b'x'; MAX_ICON_BYTES as usize + 1],
        )
        .unwrap();
        assert!(theme.validate_assets(root.path()).is_err());
    }
}
