use super::*;

fn parse_manifest(json: &str) -> Manifest {
    serde_json::from_str(json).expect("test manifest should parse")
}

#[test]
fn repository_manifest_v2_example_stays_installable() {
    let manifest = parse_manifest(include_str!(
        "../../../../examples/plugins/manifest-v2-demo/manifest.json"
    ));

    manifest
        .validate()
        .expect("the repository example must remain a valid manifest v2 plugin");
    assert_eq!(manifest.runtime_entry(), Some("worker.js"));
}

#[test]
fn legacy_manifest_remains_valid() {
    let manifest = parse_manifest(
        r#"{
            "id":"com.zync.legacy",
            "name":"Legacy plugin",
            "version":"1",
            "main":"worker.js"
        }"#,
    );
    assert_eq!(manifest.manifest_version(), 1);
    manifest
        .validate()
        .expect("legacy manifest should remain compatible");
}

#[test]
fn validates_manifest_v2_permissions_and_contributions() {
    let manifest = parse_manifest(
        r#"{
            "manifestVersion":2,
            "id":"dev.example.monitor",
            "name":"Monitor",
            "version":"2.0.0",
            "publisher":"dev.example",
            "engines":{"zync":">=3 <4","pluginApi":"^2"},
            "runtime":{"entry":"dist/worker.js"},
            "contributes":{"paneKinds":[{"id":"monitor.main","title":"Monitor","entry":"ui/index.html","allowMultiple":true}]},
            "permissions":{"required":[{"id":"ui.pane.register","reason":"Show the monitor."}]}
        }"#,
    );
    assert_eq!(manifest.runtime_entry(), Some("dist/worker.js"));
    manifest.validate().expect("manifest v2 should validate");
}

#[test]
fn rejects_unknown_required_permissions() {
    let manifest = parse_manifest(
        r#"{
            "manifestVersion":2,
            "id":"dev.example.monitor",
            "name":"Monitor",
            "version":"2.0.0",
            "publisher":"dev.example",
            "engines":{"zync":">=3 <4","pluginApi":"^2"},
            "permissions":{"required":[{"id":"vault.secret.read","reason":"Read everything."}]}
        }"#,
    );
    let error = manifest
        .validate()
        .expect_err("unknown permission must fail");
    assert!(error.to_string().contains("Unknown required permission"));
}

#[test]
fn rejects_duplicate_permission_declarations() {
    let manifest = parse_manifest(
        r#"{
            "manifestVersion":2,
            "id":"dev.example.monitor",
            "name":"Monitor",
            "version":"2.0.0",
            "publisher":"dev.example",
            "engines":{"zync":">=3 <4","pluginApi":"^2"},
            "permissions":{
                "required":[{"id":"ui.pane.register","reason":"Show a pane."}],
                "optional":[{"id":"ui.pane.register","reason":"Show another pane."}]
            }
        }"#,
    );
    let error = manifest.validate().expect_err("duplicates must fail");
    assert!(error.to_string().contains("declared more than once"));
}

#[test]
fn rejects_package_escape_paths() {
    let manifest = parse_manifest(
        r#"{
            "manifestVersion":2,
            "id":"dev.example.monitor",
            "name":"Monitor",
            "version":"2.0.0",
            "publisher":"dev.example",
            "engines":{"zync":">=3 <4","pluginApi":"^2"},
            "runtime":{"entry":"../outside.js"}
        }"#,
    );
    let error = manifest.validate().expect_err("escaping entry must fail");
    assert!(error.to_string().contains("inside the plugin package"));
}

#[test]
fn requires_contribution_permissions() {
    let manifest = parse_manifest(
        r#"{
            "manifestVersion":2,
            "id":"dev.example.monitor",
            "name":"Monitor",
            "version":"2.0.0",
            "publisher":"dev.example",
            "engines":{"zync":">=3 <4","pluginApi":"^2"},
            "contributes":{"commands":[{"id":"monitor.refresh","title":"Refresh"}]}
        }"#,
    );
    let error = manifest
        .validate()
        .expect_err("contributions without their permission must fail");
    assert!(error.to_string().contains("ui.commands.register"));
}

#[test]
fn requires_publisher_namespace() {
    let manifest = parse_manifest(
        r#"{
            "manifestVersion":2,
            "id":"someone.else.monitor",
            "name":"Monitor",
            "version":"2.0.0",
            "publisher":"dev.example",
            "engines":{"zync":">=3 <4","pluginApi":"^2"}
        }"#,
    );
    let error = manifest
        .validate()
        .expect_err("publisher must own the plugin namespace");
    assert!(error.to_string().contains("namespaced to publisher"));
}
