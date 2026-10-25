//! Bounded per-workload projections from the fixed local Docker Engine socket.
//! Rules describe at most twenty containers captured by one running-inventory query.
use super::ExtraResult;
use crate::security::{
    catalog::{ApplicabilityPolicy, Category, Evaluation, RuleDefinition},
    facts::Facts,
    hardening::Outcome,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

const TARGET_LIMIT: usize = 20;
const RUN: &str = "https://docs.docker.com/engine/containers/run/";
const SECURITY: &str = "https://docs.docker.com/engine/security/";
const RESOURCES: &str = "https://docs.docker.com/engine/containers/resource_constraints/";
const SCOPE: &str = "At most 20 running containers from the default local Engine socket; only projected configuration, not image contents, process identity, all engines or external reachability. Results are not an atomic snapshot.";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::security) enum Check {
    Coverage,
    Privileged,
    AddedCapabilities,
    PidNamespace,
    IpcNamespace,
    NetworkNamespace,
    RootFilesystem,
    StartupIdentity,
    NoNewPrivileges,
    SecurityOverrides,
    SensitiveMounts,
    Devices,
    Memory,
    Pids,
    Cpu,
    UserNamespace,
}

pub(super) const KEYS: &[&str] = &[
    "docker_workload_list",
    "docker_workload_00",
    "docker_workload_01",
    "docker_workload_02",
    "docker_workload_03",
    "docker_workload_04",
    "docker_workload_05",
    "docker_workload_06",
    "docker_workload_07",
    "docker_workload_08",
    "docker_workload_09",
    "docker_workload_10",
    "docker_workload_11",
    "docker_workload_12",
    "docker_workload_13",
    "docker_workload_14",
    "docker_workload_15",
    "docker_workload_16",
    "docker_workload_17",
    "docker_workload_18",
    "docker_workload_19",
];
pub(super) const SCRIPT: &str = include_str!("../collectors/docker-workloads.sh");

/// Shared definitions retain explicit conditions instead of interpreting every deviation as a vulnerability.
const fn rule(
    check: Check,
    id: &'static str,
    title: &'static str,
    expected: &'static str,
    rationale: &'static str,
    guidance: &'static str,
    reference: &'static str,
) -> RuleDefinition {
    RuleDefinition {
        id,
        fact_key: "docker_workload_list",
        category: Category::Services,
        title,
        target: "Default local Docker Engine: bounded running-container sample",
        expected,
        rationale,
        scope: SCOPE,
        guidance,
        reference,
        rule_version: "2",
        reviewed_at: "2026-10-25",
        applicability: ApplicabilityPolicy::Linux,
        evaluation: Evaluation::DockerWorkload(check),
    }
}

pub(super) const RULES: &[RuleDefinition] = &[
    rule(Check::Coverage,"WORKLOAD-coverage","Docker workload coverage","Review the sampled inventory and any unavailable or omitted containers.",
        "A bounded sample must not be mistaken for complete fleet coverage.",
        "Review limited or failed inspections separately. Containers may start or stop between the inventory and individual reads.",SECURITY),
    rule(Check::Privileged,"WORKLOAD-privileged","Privileged containers","No sampled container explicitly requests privileged mode.",
        "Privileged mode grants broad access to host devices and capabilities.",
        "Review privileged workloads and prefer specific required permissions. Test compatibility before changing deployment settings.",RUN),
    rule(Check::AddedCapabilities,"WORKLOAD-added-capabilities","Added container capabilities","No sampled container explicitly adds capabilities beyond its engine defaults.",
        "Additional capabilities can expand what a compromised workload can do.",
        "Review each added capability against the workload. An empty added list does not prove that the default capability set is minimal.",RUN),
    rule(Check::PidNamespace,"WORKLOAD-pid-namespace","Shared container PID namespaces","No sampled container joins the host or another container PID namespace.",
        "Sharing a process namespace can reveal or affect processes outside the workload.",
        "Keep deliberate process-namespace sharing only where required. Transitive namespace relationships were not resolved.",RUN),
    rule(Check::IpcNamespace,"WORKLOAD-ipc-namespace","Shared container IPC namespaces","No sampled container joins the host or another container IPC namespace.",
        "Shared IPC can expose communication resources outside the workload.",
        "Review the need for shared IPC and its associated trust boundary before changing it.",RUN),
    rule(Check::NetworkNamespace,"WORKLOAD-network-namespace","Container network namespaces","Review host or peer-container network sharing against the deployment role.",
        "Shared networking changes isolation, but some monitoring and infrastructure workloads require it.",
        "Review network sharing and published access separately. A bridge, custom network or host mode does not establish internet exposure.",RUN),
    rule(Check::RootFilesystem,"WORKLOAD-root-filesystem","Container root filesystems","Review whether a read-only container root filesystem fits each workload.",
        "A read-only root can limit persistent changes after compromise, while some applications need writable paths.",
        "Consider a read-only root plus specific writable volumes or temporary mounts. Writable roots are contextual, not a confirmed vulnerability.",RUN),
    rule(Check::StartupIdentity,"WORKLOAD-startup-user","Container startup identities","Review configured root/default, numeric and named startup identities.",
        "A non-root startup identity can reduce privileges; entrypoints may also change identity later.",
        "Review startup and actual worker privileges. This check does not resolve named users, inspect running process UIDs or prove user-namespace mappings.",RUN),
    rule(Check::NoNewPrivileges,"WORKLOAD-no-new-privileges","Container privilege-gain restrictions","Review the explicit no-new-privileges security option.",
        "The option can prevent container processes from gaining privileges through executable transitions.",
        "Consider no-new-privileges where compatible. Process runtime state and privilege transitions were not tested.","https://docs.docker.com/reference/cli/docker/container/run/"),
    rule(Check::SecurityOverrides,"WORKLOAD-security-overrides","Unconfined container overrides","Review explicit seccomp/AppArmor unconfined or disabled-label overrides.",
        "Disabling a confinement mechanism can remove a useful layer of protection.",
        "Review intentional unconfined overrides. No explicit override does not prove daemon support, custom-profile quality or effective enforcement.","https://docs.docker.com/engine/security/seccomp/"),
    rule(Check::SensitiveMounts,"WORKLOAD-sensitive-mounts","Sensitive host bind mounts","No sampled bind-source path matches the listed sensitive system paths or a Docker socket.",
        "Host-system binds can expose configuration, credentials or daemon control, even when a socket mount is read-only.",
        "Review source-path matches for /, /etc, /proc, /sys, /dev, /run, /var/run, /var/lib/docker, /root and docker.sock. Symlink targets, other sensitive paths and volume contents were not inspected.",SECURITY),
    rule(Check::Devices,"WORKLOAD-devices","Container device mappings","Review explicit device mappings against workload needs.",
        "Direct device access can broaden host interaction, while GPU or other device workloads may need it.",
        "Keep device access limited to required hardware. This count excludes device requests, effective permissions and the extra access granted by privileged mode.",RUN),
    rule(Check::Memory,"WORKLOAD-memory-limits","Container memory limits","Review explicit per-container memory limits and external resource policy.",
        "Unbounded resource use can affect availability; parent cgroups may supply separate limits.",
        "Review workload memory limits with capacity and recovery needs. This check does not measure pressure or verify parent cgroup enforcement.",RESOURCES),
    rule(Check::Pids,"WORKLOAD-process-limits","Container process limits","Review explicit per-container process limits and external resource policy.",
        "A process limit can reduce the impact of uncontrolled process creation.",
        "Choose suitable limits for the workload. An unset limit may be managed by a parent cgroup; process use and enforcement were not tested.",RESOURCES),
    rule(Check::Cpu,"WORKLOAD-cpu-limits","Container CPU limits","Review explicit CPU quota/NanoCPUs constraints and external resource policy.",
        "CPU constraints can reduce contention, while some hosts intentionally share unrestricted CPU capacity.",
        "Review CPU allocation with the deployment role. CPU shares, cpusets, live contention and parent cgroup policy were not evaluated.",RESOURCES),
    rule(Check::UserNamespace,"WORKLOAD-user-namespace","Container user-namespace choices","Review explicit host/private/engine-default user-namespace configuration.",
        "User namespaces can reduce the host privileges associated with container identities.",
        "Review the container choice with the daemon rootless/remapping policy. These values alone do not prove effective host UID mappings.","https://docs.docker.com/engine/security/rootless/"),
];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    schema: u8,
    ids: Vec<String>,
    limited: bool,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Network {
    Host,
    Container,
    Other,
}
#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Startup {
    DefaultRoot,
    ExplicitRoot,
    Numeric,
    Named,
}
#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum UserNamespace {
    EngineDefault,
    Host,
    Private,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Workload {
    schema: u8,
    id: String,
    running: Option<bool>,
    privileged: Option<bool>,
    added_capabilities: Option<u32>,
    pid_shared: Option<bool>,
    ipc_shared: Option<bool>,
    network_mode: Option<Network>,
    read_only_rootfs: Option<bool>,
    startup_user: Option<Startup>,
    no_new_privileges: Option<bool>,
    unconfined_security: Option<bool>,
    sensitive_bind_mounts: Option<u32>,
    device_mappings: Option<u32>,
    memory_limited: Option<bool>,
    pids_limited: Option<bool>,
    cpu_limited: Option<bool>,
    user_namespace: Option<UserNamespace>,
}

/// Full lowercase Engine IDs are the only response values allowed to identify an inspection target.
fn identifier(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Parse a bounded inventory without treating server-side limit truncation as full fleet coverage.
fn manifest(facts: &Facts) -> Option<Manifest> {
    let source = facts.get(KEYS[0]).filter(|source| source.len() <= 4096)?;
    let manifest: Manifest = serde_json::from_str(source).ok()?;
    (manifest.schema == 1
        && manifest.ids.len() <= TARGET_LIMIT
        && (!manifest.limited || manifest.ids.len() == TARGET_LIMIT)
        && manifest.ids.iter().all(|id| identifier(id))
        && manifest.ids.iter().collect::<BTreeSet<_>>().len() == manifest.ids.len())
    .then_some(manifest)
}

/// Comparisons bind to the exact sorted inventory and limit state, independently of inspection success.
pub(in crate::security) fn target_key(facts: &Facts) -> Option<String> {
    let mut manifest = manifest(facts)?;
    manifest.ids.sort();
    let mut hash = Sha256::new();
    hash.update(b"zync-docker-workload-target-v1\0");
    hash.update(if manifest.limited {
        b"limited=1\0"
    } else {
        b"limited=0\0"
    });
    for id in manifest.ids {
        hash.update(id.as_bytes());
        hash.update(b"\0");
    }
    Some(
        hash.finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    )
}

/// Identity and running-state races invalidate that sample item, never a different container's policy.
fn workload(facts: &Facts, index: usize, id: &str) -> Option<Workload> {
    let source = facts
        .get(KEYS[index + 1])
        .filter(|source| source.len() <= 8192)?;
    let item: Workload = serde_json::from_str(source).ok()?;
    (item.schema == 1
        && item.id == id
        && item.running == Some(true)
        && [
            item.added_capabilities,
            item.sensitive_bind_mounts,
            item.device_mappings,
        ]
        .iter()
        .all(|count| count.is_none_or(|count| count <= 256)))
    .then_some(item)
}

/// One control returns a scalar review condition, while contextual checks retain informational outcomes.
fn condition(check: Check, item: &Workload) -> Option<bool> {
    match check {
        Check::Coverage => Some(false),
        Check::Privileged => item.privileged,
        Check::AddedCapabilities => item.added_capabilities.map(|value| value > 0),
        Check::PidNamespace => item.pid_shared,
        Check::IpcNamespace => item.ipc_shared,
        Check::NetworkNamespace => item
            .network_mode
            .map(|value| matches!(value, Network::Host | Network::Container)),
        Check::RootFilesystem => item.read_only_rootfs.map(|value| !value),
        Check::StartupIdentity => item
            .startup_user
            .map(|value| matches!(value, Startup::DefaultRoot | Startup::ExplicitRoot)),
        Check::NoNewPrivileges => item.no_new_privileges.map(|value| !value),
        Check::SecurityOverrides => item.unconfined_security,
        Check::SensitiveMounts => item.sensitive_bind_mounts.map(|value| value > 0),
        Check::Devices => item.device_mappings.map(|value| value > 0),
        Check::Memory => item.memory_limited.map(|value| !value),
        Check::Pids => item.pids_limited.map(|value| !value),
        Check::Cpu => item.cpu_limited.map(|value| !value),
        Check::UserNamespace => item
            .user_namespace
            .map(|value| matches!(value, UserNamespace::Host)),
    }
}

/// Retain the exact projected scalar for this check; unrelated settings must not invalidate its acceptance.
fn evidence_value(check: Check, item: &Workload) -> serde_json::Value {
    match check {
        Check::Coverage => serde_json::json!(true),
        Check::Privileged => serde_json::json!(item.privileged),
        Check::AddedCapabilities => serde_json::json!(item.added_capabilities),
        Check::PidNamespace => serde_json::json!(item.pid_shared),
        Check::IpcNamespace => serde_json::json!(item.ipc_shared),
        Check::NetworkNamespace => serde_json::json!(item.network_mode),
        Check::RootFilesystem => serde_json::json!(item.read_only_rootfs),
        Check::StartupIdentity => serde_json::json!(item.startup_user),
        Check::NoNewPrivileges => serde_json::json!(item.no_new_privileges),
        Check::SecurityOverrides => serde_json::json!(item.unconfined_security),
        Check::SensitiveMounts => serde_json::json!(item.sensitive_bind_mounts),
        Check::Devices => serde_json::json!(item.device_mappings),
        Check::Memory => serde_json::json!(item.memory_limited),
        Check::Pids => serde_json::json!(item.pids_limited),
        Check::Cpu => serde_json::json!(item.cpu_limited),
        Check::UserNamespace => serde_json::json!(item.user_namespace),
    }
}

/// Bind every sampled ID to this check's normalized value or unknown state before display truncation.
fn evidence_digest(check: Check, manifest: &Manifest, items: &[Option<Workload>]) -> String {
    let mut observations: Vec<_> = manifest
        .ids
        .iter()
        .zip(items)
        .map(|(id, item)| {
            (
                id.as_str(),
                item.as_ref()
                    .map_or(serde_json::Value::Null, |item| evidence_value(check, item)),
            )
        })
        .collect();
    observations.sort_unstable_by(|left, right| left.0.cmp(right.0));
    let mut hash = Sha256::new();
    hash.update(b"zync-docker-workload-evidence-v2\0");
    hash.update(
        serde_json::to_vec(&observations).expect("Typed workload scalars are serializable"),
    );
    crate::security::policy::hex_digest(&hash.finalize())
}

/// Contextual deployment choices do not become universal failures merely because a flag is absent.
fn baseline(check: Check) -> bool {
    matches!(
        check,
        Check::Privileged
            | Check::AddedCapabilities
            | Check::PidNamespace
            | Check::IpcNamespace
            | Check::SensitiveMounts
    )
}

/// Summaries translate the exact scalar counted by each rule without inventing runtime enforcement.
fn description(check: Check) -> &'static str {
    match check {
        Check::Coverage => "could be inspected",
        Check::Privileged => "request privileged mode",
        Check::AddedCapabilities => "explicitly add capabilities",
        Check::PidNamespace => "join host or peer PID namespaces",
        Check::IpcNamespace => "join host or peer IPC namespaces",
        Check::NetworkNamespace => "share host or peer networking",
        Check::RootFilesystem => "have writable root filesystems",
        Check::StartupIdentity => "use root/default startup identities",
        Check::NoNewPrivileges => "do not explicitly request no-new-privileges",
        Check::SecurityOverrides => "explicitly disable a checked confinement mechanism",
        Check::SensitiveMounts => "bind a checked sensitive host path or Docker socket",
        Check::Devices => "explicitly map host devices",
        Check::Memory => "have no explicit container memory limit",
        Check::Pids => "have no explicit container process limit",
        Check::Cpu => "have no explicit quota/NanoCPUs constraint",
        Check::UserNamespace => "explicitly select host user-namespace mode",
    }
}

/// Aggregate only the approved bounded sample; missing inspections never contribute to a pass.
pub(super) fn evaluate(facts: &Facts, check: Check) -> ExtraResult {
    let Some(manifest) = manifest(facts) else {
        return ExtraResult::Unavailable;
    };
    let total = manifest.ids.len();
    let items: Vec<_> = manifest
        .ids
        .iter()
        .enumerate()
        .map(|(index, id)| workload(facts, index, id))
        .collect();
    let inspected = items.iter().filter(|item| item.is_some()).count();
    let limited = if manifest.limited {
        " Inventory limit reached; additional running containers were not checked."
    } else {
        ""
    };
    if check == Check::Coverage {
        if let Some(index) = items.iter().position(Option::is_none) {
            return ExtraResult::UnavailableAt(KEYS[index + 1]);
        }
        return ExtraResult::Available {value:format!("selected={total} inspected={inspected} unavailable={} limit={TARGET_LIMIT} limited={}",total-inspected,manifest.limited),
            observed:format!("{inspected} of {total} selected running containers could be inspected.{limited}"),outcome:Outcome::Informational};
    }
    if total == 0 {
        return ExtraResult::NotApplicable("The checked local Engine returned no running containers in this bounded inventory. Other engines and later changes were not checked.");
    }
    let mut matching = vec![];
    let mut unknown = vec![];
    for (index, item) in items.iter().enumerate() {
        match item.as_ref().and_then(|item| condition(check, item)) {
            Some(true) => matching.push(manifest.ids[index].as_str()),
            Some(false) => {}
            None => unknown.push(index),
        }
    }
    let known = total - unknown.len();
    if known == 0 || (baseline(check) && matching.is_empty() && !unknown.is_empty()) {
        return ExtraResult::UnavailableAt(KEYS[unknown[0] + 1]);
    }
    let outcome = if baseline(check) {
        if matching.is_empty() {
            Outcome::Passed
        } else {
            Outcome::Attention
        }
    } else if check == Check::SecurityOverrides && !matching.is_empty() {
        Outcome::Attention
    } else {
        Outcome::Informational
    };
    let unknown_note = if unknown.is_empty() {
        String::new()
    } else {
        format!(" {} unavailable.", unknown.len())
    };
    // Both the digest and bounded display are canonical when inventory order changes.
    matching.sort_unstable();
    let digest = evidence_digest(check, &manifest, &items);
    let value=format!("selected={total} known={known} matching={} unavailable={} limited={}; sample digest={digest}; matching container IDs (first 8): {}; additional matches={}",matching.len(),unknown.len(),manifest.limited,
        if matching.is_empty(){"none".to_string()}else{matching.iter().take(8).copied().collect::<Vec<_>>().join(", ")},matching.len().saturating_sub(8));
    ExtraResult::Available {
        value,
        observed: format!(
            "{} of {total} sampled containers {}.{unknown_note}{limited}",
            matching.len(),
            description(check)
        ),
        outcome,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::facts::Fact;
    use std::collections::BTreeMap;

    /// Synthetic security projections contain no daemon access, image contents or user credentials.
    fn fixture(count: usize) -> Facts {
        let ids: Vec<_> = (0..count).map(|index| format!("{index:064x}")).collect();
        let mut values = BTreeMap::from([
            (
                "os".into(),
                Fact {
                    output: "ID=ubuntu\nVERSION_ID=24.04".into(),
                    status: 0,
                },
            ),
            (
                KEYS[0].into(),
                Fact {
                    output: serde_json::json!({"schema":1,"ids":ids,"limited":false}).to_string(),
                    status: 0,
                },
            ),
        ]);
        for (index, id) in ids.iter().enumerate() {
            values.insert(KEYS[index+1].into(),Fact{output:serde_json::json!({"schema":1,"id":id,"running":true,"privileged":false,"addedCapabilities":0,"pidShared":false,"ipcShared":false,"networkMode":"other","readOnlyRootfs":true,"startupUser":"numeric","noNewPrivileges":true,"unconfinedSecurity":false,"sensitiveBindMounts":0,"deviceMappings":0,"memoryLimited":true,"pidsLimited":true,"cpuLimited":true,"userNamespace":"engine-default"}).to_string(),status:0});
        }
        Facts(values)
    }

    /// Modify a controlled projection without changing its identity or the producer's validation shape.
    fn patch(facts: &mut Facts, index: usize, field: &str, value: serde_json::Value) {
        let record = facts.0.get_mut(KEYS[index + 1]).unwrap();
        let mut item: serde_json::Value = serde_json::from_str(&record.output).unwrap();
        item[field] = value;
        record.output = item.to_string();
    }

    /// Exercise the real rule dispatcher and identity annotation without contacting an Engine or SSH host.
    fn assessed(facts: &Facts, rule_id: &str) -> crate::security::report::Finding {
        crate::security::hardening::assess_selected(
            facts,
            &[crate::security::modules::ModuleId::DockerWorkloads],
        )
        .unwrap()
        .findings
        .into_iter()
        .find(|finding| finding.id == rule_id)
        .unwrap()
    }

    /// Each field is independent, and known bad evidence survives a failed peer inspection.
    #[test]
    fn sampled_fields_preserve_known_risks_and_unknowns() {
        let mut facts = fixture(2);
        assert!(matches!(
            evaluate(&facts, Check::Privileged),
            ExtraResult::Available {
                outcome: Outcome::Passed,
                ..
            }
        ));
        facts.0.get_mut(KEYS[2]).unwrap().status = 77;
        assert!(matches!(
            evaluate(&facts, Check::Coverage),
            ExtraResult::UnavailableAt("docker_workload_01")
        ));
        assert!(matches!(
            evaluate(&facts, Check::Privileged),
            ExtraResult::UnavailableAt("docker_workload_01")
        ));
        let mut value: serde_json::Value = serde_json::from_str(&facts.0[KEYS[1]].output).unwrap();
        value["privileged"] = serde_json::Value::Bool(true);
        value["addedCapabilities"] = serde_json::Value::Null;
        facts.0.get_mut(KEYS[1]).unwrap().output = value.to_string();
        let ExtraResult::Available {
            outcome: Outcome::Attention,
            value,
            observed,
        } = evaluate(&facts, Check::Privileged)
        else {
            panic!("Known unsafe evidence was lost");
        };
        assert!(value.contains("unavailable=1") && observed.contains("1 unavailable"));
        assert!(matches!(
            evaluate(&facts, Check::AddedCapabilities),
            ExtraResult::UnavailableAt(_)
        ));
    }

    /// Complete inventory, exact IDs and running state are required before a sample can pass.
    #[test]
    fn inventory_and_inspection_identity_fail_closed() {
        for invalid in [
            r#"{"schema":1,"ids":["../../x"],"limited":false}"#,
            r#"{"schema":2,"ids":[],"limited":false}"#,
            r#"{"schema":1,"ids":[],"limited":true}"#,
        ] {
            let mut facts = fixture(1);
            facts.0.get_mut(KEYS[0]).unwrap().output = invalid.into();
            assert!(matches!(
                evaluate(&facts, Check::Privileged),
                ExtraResult::Unavailable
            ));
        }
        let mut facts = fixture(1);
        for patch in [
            serde_json::json!({"id":"a".repeat(64)}),
            serde_json::json!({"running":false}),
            serde_json::json!({"schema":2}),
            serde_json::json!({"privateEnvironment":"must-not-be-accepted"}),
        ] {
            let original = facts.0[KEYS[1]].output.clone();
            let mut value: serde_json::Value = serde_json::from_str(&original).unwrap();
            for (key, value_patch) in patch.as_object().unwrap() {
                value[key] = value_patch.clone();
            }
            facts.0.get_mut(KEYS[1]).unwrap().output = value.to_string();
            assert!(matches!(
                evaluate(&facts, Check::Privileged),
                ExtraResult::UnavailableAt(_)
            ));
            facts.0.get_mut(KEYS[1]).unwrap().output = original;
        }
    }

    /// Limits remain visible, empty inventories are scoped exclusions, and context is not failure.
    #[test]
    fn bounded_coverage_and_context_are_explicit() {
        assert!(matches!(
            evaluate(&fixture(0), Check::Privileged),
            ExtraResult::NotApplicable(_)
        ));
        for check in [
            Check::RootFilesystem,
            Check::StartupIdentity,
            Check::NoNewPrivileges,
            Check::Memory,
            Check::Pids,
            Check::Cpu,
            Check::UserNamespace,
        ] {
            assert!(matches!(
                evaluate(&fixture(1), check),
                ExtraResult::Available {
                    outcome: Outcome::Informational,
                    ..
                }
            ));
        }
        let mut facts = fixture(TARGET_LIMIT);
        let mut value: serde_json::Value = serde_json::from_str(&facts.0[KEYS[0]].output).unwrap();
        value["limited"] = true.into();
        facts.0.get_mut(KEYS[0]).unwrap().output = value.to_string();
        let ExtraResult::Available { observed, .. } = evaluate(&facts, Check::Coverage) else {
            panic!("Missing bounded coverage");
        };
        assert!(observed.contains("Inventory limit reached"));
        facts.0.get_mut(KEYS[1]).unwrap().output = "x".repeat(8193);
        assert!(matches!(
            evaluate(&facts, Check::Privileged),
            ExtraResult::UnavailableAt(_)
        ));
    }

    /// Every fixed slot is distinct so repeated policy prompts need no relaxation of replay protection.
    #[test]
    fn workload_catalog_matches_fixed_slots_without_cli_execution() {
        assert_eq!(RULES.len(), 16);
        assert_eq!(KEYS.len(), 21);
        assert_eq!(
            KEYS.iter().copied().collect::<BTreeSet<_>>().len(),
            KEYS.len()
        );
        let keys: Vec<_> = SCRIPT
            .lines()
            .filter_map(|line| {
                line.strip_prefix("collect ")
                    .and_then(|line| line.split_whitespace().next())
            })
            .collect();
        assert_eq!(keys, KEYS);
        assert!(
            !SCRIPT.contains("docker inspect")
                && !SCRIPT.contains("docker container")
                && !SCRIPT.contains("Config.Env")
        );
        for rule in RULES {
            assert_eq!(rule.fact_key, KEYS[0]);
            assert!(matches!(rule.evaluation, Evaluation::DockerWorkload(_)));
        }
    }

    /// Changed container membership or truncation cannot silently compare as the same target.
    #[test]
    fn inventory_target_keys_are_canonical_and_scope_bound() {
        let mut facts = fixture(2);
        let initial = target_key(&facts).unwrap();
        let mut value: serde_json::Value = serde_json::from_str(&facts.0[KEYS[0]].output).unwrap();
        value["ids"].as_array_mut().unwrap().reverse();
        facts.0.get_mut(KEYS[0]).unwrap().output = value.to_string();
        assert_eq!(target_key(&facts).unwrap(), initial);
        value["ids"][0] = "b".repeat(64).into();
        facts.0.get_mut(KEYS[0]).unwrap().output = value.to_string();
        assert_ne!(target_key(&facts).unwrap(), initial);
        facts.0.get_mut(KEYS[0]).unwrap().status = 77;
        assert!(target_key(&facts).is_none());
        let mut full = fixture(TARGET_LIMIT);
        let initial = target_key(&full).unwrap();
        let mut value: serde_json::Value = serde_json::from_str(&full.0[KEYS[0]].output).unwrap();
        value["limited"] = true.into();
        full.0.get_mut(KEYS[0]).unwrap().output = value.to_string();
        assert_ne!(target_key(&full).unwrap(), initial);
    }

    /// A newly observed ninth risk cannot inherit an acceptance when the bounded display and totals are unchanged.
    #[test]
    fn complete_workload_evidence_binds_unlisted_matches_and_unknown_ids() {
        let mut facts = fixture(TARGET_LIMIT);
        for index in 0..10 {
            patch(&mut facts, index, "privileged", true.into());
        }
        facts.0.get_mut(KEYS[10]).unwrap().status = 124;
        let before = assessed(&facts, "WORKLOAD-privileged");
        facts.0.get_mut(KEYS[9]).unwrap().status = 124;
        facts.0.get_mut(KEYS[10]).unwrap().status = 0;
        let after = assessed(&facts, "WORKLOAD-privileged");

        assert_eq!(before.status, "attention");
        assert_eq!(before.status, after.status);
        assert_eq!(before.observed, after.observed);
        assert_eq!(before.target_key, after.target_key);
        assert_eq!(before.rule_version, "2");
        assert_eq!(before.rule_version, after.rule_version);
        for finding in [&before, &after] {
            assert!(finding
                .evidence
                .starts_with("selected=20 known=19 matching=9 unavailable=1 limited=false;"));
        }
        let displayed_ids = |evidence: &str| {
            evidence
                .split_once("; matching container IDs (first 8):")
                .unwrap()
                .1
                .to_string()
        };
        assert_eq!(
            displayed_ids(&before.evidence),
            displayed_ids(&after.evidence)
        );
        assert_ne!(before.evidence_key, after.evidence_key);
    }

    /// Canonical values and displays stay stable when inventory slots move together with their inspections.
    #[test]
    fn workload_evidence_is_stable_across_inventory_order() {
        let mut facts = fixture(12);
        for index in [0, 3, 6, 9] {
            patch(&mut facts, index, "privileged", true.into());
        }
        facts.0.get_mut(KEYS[12]).unwrap().status = 77;
        let before = assessed(&facts, "WORKLOAD-privileged");
        let records: Vec<_> = KEYS[1..=12]
            .iter()
            .map(|key| {
                let record = &facts.0[*key];
                Fact {
                    output: record.output.clone(),
                    status: record.status,
                }
            })
            .collect();
        let mut manifest: serde_json::Value =
            serde_json::from_str(&facts.0[KEYS[0]].output).unwrap();
        manifest["ids"].as_array_mut().unwrap().reverse();
        facts.0.get_mut(KEYS[0]).unwrap().output = manifest.to_string();
        for (index, record) in records.into_iter().rev().enumerate() {
            facts.0.insert(KEYS[index + 1].into(), record);
        }
        let after = assessed(&facts, "WORKLOAD-privileged");
        assert_eq!(before.status, after.status);
        assert_eq!(before.target_key, after.target_key);
        assert_eq!(before.evidence, after.evidence);
        assert_eq!(before.evidence_key, after.evidence_key);
    }

    /// Scalar changes remain evidence changes even when both values meet the same condition, without unrelated churn.
    #[test]
    fn workload_evidence_contains_only_the_checked_projection() {
        let mut facts = fixture(2);
        patch(&mut facts, 0, "addedCapabilities", 2.into());
        let privileged_before = assessed(&facts, "WORKLOAD-privileged");
        let capabilities_before = assessed(&facts, "WORKLOAD-added-capabilities");
        patch(&mut facts, 0, "addedCapabilities", 3.into());
        let privileged_after = assessed(&facts, "WORKLOAD-privileged");
        let capabilities_after = assessed(&facts, "WORKLOAD-added-capabilities");
        assert_eq!(
            privileged_before.evidence_key,
            privileged_after.evidence_key
        );
        assert_eq!(capabilities_before.status, capabilities_after.status);
        assert_eq!(capabilities_before.observed, capabilities_after.observed);
        assert_eq!(
            capabilities_before.target_key,
            capabilities_after.target_key
        );
        assert_ne!(
            capabilities_before.evidence_key,
            capabilities_after.evidence_key
        );
    }

    /// The complete identity and maximum displayed ID sample survive the shared report evidence cap intact.
    #[test]
    fn workload_digest_and_display_fit_the_report_evidence_bound() {
        let mut facts = fixture(TARGET_LIMIT);
        for index in 0..TARGET_LIMIT {
            patch(&mut facts, index, "privileged", true.into());
        }
        let ExtraResult::Available { value, .. } = evaluate(&facts, Check::Privileged) else {
            panic!("Expected a complete attention observation");
        };
        assert!(value.is_ascii() && value.len() < 1024);
        assert!(value.contains("sample digest=sha256:"));
        assert!(value.ends_with("additional matches=12"));
        let finding = assessed(&facts, "WORKLOAD-privileged");
        assert_eq!(finding.evidence, value);
    }

    /// Production projection tests replace only the HTTP producer; no daemon or network is contacted.
    #[cfg(target_os = "linux")]
    fn project(
        kind: &str,
        body: &serde_json::Value,
        status: u8,
        delay: bool,
    ) -> std::process::Output {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("body.json");
        std::fs::write(&file, body.to_string()).unwrap();
        let source = SCRIPT
            .split("\ncollect docker_workload_list ")
            .next()
            .unwrap();
        let code=format!("protected() {{ if [ \"$WORKLOAD_DELAY\" = 1 ]; then sleep 5; fi; cat \"$WORKLOAD_TEST_FILE\"; return \"$WORKLOAD_STATUS\"; }}\nsudo_nonce=fixture-nonce\nlabel=docker_workload_00\n{source}\ndocker_workload_request \"$WORKLOAD_KIND\" http://fixture.invalid\n");
        std::process::Command::new("/usr/bin/timeout")
            .args([
                "--signal=TERM",
                "--kill-after=1s",
                "10s",
                "/bin/sh",
                "-c",
                &code,
            ])
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("LC_ALL", "C")
            .env("WORKLOAD_TEST_FILE", file)
            .env("WORKLOAD_STATUS", status.to_string())
            .env("WORKLOAD_KIND", kind)
            .env("WORKLOAD_DELAY", if delay { "1" } else { "0" })
            .output()
            .unwrap()
    }

    /// Engine responses contain sensitive fields, so fixtures deliberately include secret sentinels.
    #[cfg(target_os = "linux")]
    fn inspection() -> serde_json::Value {
        serde_json::json!({"Id":"a".repeat(64),"State":{"Running":true},
            "Config":{"User":"1000","Env":["PASSWORD=private-environment-secret"],"Cmd":["private-command-secret"],"Labels":{"token":"private-label-secret"}},
            "HostConfig":{"Privileged":false,"CapAdd":null,"SecurityOpt":["no-new-privileges","seccomp=private-profile-path"],"PidMode":"","IpcMode":"private","NetworkMode":"bridge","ReadonlyRootfs":true,"UsernsMode":"","Memory":1048576,"PidsLimit":100,"NanoCpus":0,"CpuQuota":-1,"Devices":null},
            "Mounts":[{"Type":"bind","Source":"/root/private-mount-secret","RW":false}]})
    }

    /// Fixed projection strips environments/commands/labels/paths while retaining useful security fields.
    #[cfg(target_os = "linux")]
    #[test]
    fn workload_projection_redacts_sensitive_inspection_and_inventory_fields() {
        let body = inspection();
        let result = project("item", &body, 0, false);
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let output = String::from_utf8(result.stdout).unwrap();
        assert!(
            !output.contains("private")
                && !output.contains("Env")
                && !output.contains("Cmd")
                && !output.contains("Labels")
        );
        let item: Workload = serde_json::from_str(&output).unwrap();
        assert_eq!(item.sensitive_bind_mounts, Some(1));
        assert_eq!(item.no_new_privileges, Some(true));
        let mut body = body;
        body["HostConfig"]["CapAdd"] = "invalid".into();
        let result = project("item", &body, 0, false);
        assert!(result.status.success());
        let item: Workload = serde_json::from_slice(&result.stdout).unwrap();
        assert_eq!(item.added_capabilities, None);
        assert_eq!(item.privileged, Some(false));
        body["HostConfig"]["CapAdd"] = serde_json::json!(["sys_admin"]);
        for options in [
            serde_json::json!(["no-new-privileges:true", "seccomp:unconfined"]),
            serde_json::json!(["no-new-privileges=TRUE", "apparmor=unconfined"]),
        ] {
            body["HostConfig"]["SecurityOpt"] = options;
            let result = project("item", &body, 0, false);
            assert!(result.status.success());
            let item: Workload = serde_json::from_slice(&result.stdout).unwrap();
            assert_eq!(item.added_capabilities, Some(1));
            assert_eq!(item.no_new_privileges, Some(true));
            assert_eq!(item.unconfined_security, Some(true));
        }
        body["HostConfig"]["SecurityOpt"] = serde_json::json!([
            "no-new-privileges=true",
            "no-new-privileges:false",
            "seccomp=unconfined",
            "seccomp=custom-profile"
        ]);
        let result = project("item", &body, 0, false);
        assert!(result.status.success());
        let item: Workload = serde_json::from_slice(&result.stdout).unwrap();
        assert_eq!(item.no_new_privileges, Some(false));
        assert_eq!(item.unconfined_security, Some(false));
        let list = serde_json::json!([{"Id":"a".repeat(64),"State":"running","Command":"private-command-secret","Labels":{"token":"private-label-secret"}}]);
        let result = project("list", &list, 0, false);
        assert!(result.status.success());
        assert!(!String::from_utf8_lossy(&result.stdout).contains("private"));
        let manifest: Manifest = serde_json::from_slice(&result.stdout).unwrap();
        assert_eq!(manifest.ids.len(), 1);
        let many: Vec<_> = (0..21)
            .map(|index| serde_json::json!({"Id":format!("{index:064x}"),"State":"running"}))
            .collect();
        let result = project("list", &serde_json::json!(many), 0, false);
        assert!(result.status.success());
        let manifest: Manifest = serde_json::from_slice(&result.stdout).unwrap();
        assert_eq!(manifest.ids.len(), 20);
        assert!(manifest.limited);
        let result = project(
            "list",
            &serde_json::json!([{"Id":"../../not-an-id","State":"running"}]),
            0,
            false,
        );
        assert_eq!(result.status.code(), Some(65));
        assert!(result.stdout.is_empty());
    }

    /// Valid JSON cannot mask failed transfers or byte-budget exhaustion, and waiting consumers survive approval.
    #[cfg(target_os = "linux")]
    #[test]
    fn workload_transfer_failures_bounds_and_delayed_approval_remain_distinct() {
        let body = inspection();
        for status in [7, 22, 28, 77, 124, 137] {
            let result = project("item", &body, status, false);
            assert_eq!(result.status.code(), Some(i32::from(status)));
            assert!(result.stdout.is_empty());
        }
        let oversized =
            serde_json::json!({"Id":"a".repeat(64),"privatePayload":"x".repeat(600_000)});
        let result = project("item", &oversized, 0, false);
        assert_eq!(result.status.code(), Some(65));
        assert!(result.stdout.is_empty());
        let result = project("item", &body, 0, true);
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let item: Workload = serde_json::from_slice(&result.stdout).unwrap();
        assert_eq!(item.privileged, Some(false));
    }

    /// An invalid/empty inventory cannot cause speculative requests, and unused slots do no work.
    #[cfg(target_os = "linux")]
    #[test]
    fn fixed_slots_inspect_only_verified_selected_ids() {
        let folder = tempfile::tempdir().unwrap();
        let list = folder.path().join("list.json");
        let item = folder.path().join("item.json");
        let log = folder.path().join("calls.log");
        std::fs::write(
            &list,
            serde_json::json!([{"Id":"a".repeat(64),"State":"running"}]).to_string(),
        )
        .unwrap();
        std::fs::write(&item, inspection().to_string()).unwrap();
        let code=format!("protected() {{ for argument do endpoint=$argument; done; printf '%s\\n' \"$endpoint\" >> \"$WORKLOAD_LOG\"; case \"$endpoint\" in *'/containers/json?'*) cat \"$WORKLOAD_LIST\"; return \"$WORKLOAD_LIST_STATUS\";; *'/containers/'*'/json') cat \"$WORKLOAD_ITEM\";; *) return 99;; esac; }}\ncollect() {{ label=$1; shift; \"$@\"; }}\nsudo_nonce=fixture-nonce\n{SCRIPT}");
        let run = |status: &str| {
            std::process::Command::new("/usr/bin/timeout")
                .args([
                    "--signal=TERM",
                    "--kill-after=1s",
                    "10s",
                    "/bin/sh",
                    "-c",
                    &code,
                ])
                .env_clear()
                .env("PATH", "/usr/bin:/bin")
                .env("LC_ALL", "C")
                .env("WORKLOAD_LOG", &log)
                .env("WORKLOAD_LIST", &list)
                .env("WORKLOAD_ITEM", &item)
                .env("WORKLOAD_LIST_STATUS", status)
                .output()
                .unwrap()
        };
        let result = run("0");
        assert!(result.status.success());
        let calls = std::fs::read_to_string(&log).unwrap();
        assert_eq!(calls.lines().count(), 2);
        assert!(calls
            .lines()
            .last()
            .unwrap()
            .ends_with(&format!("/containers/{}/json", "a".repeat(64))));
        assert_eq!(
            String::from_utf8(result.stdout)
                .unwrap()
                .lines()
                .filter(|line| *line == "unused")
                .count(),
            19
        );
        std::fs::write(&log, "").unwrap();
        let result = run("22");
        assert!(result.status.success());
        assert_eq!(std::fs::read_to_string(&log).unwrap().lines().count(), 1);
        assert_eq!(
            String::from_utf8(result.stdout)
                .unwrap()
                .lines()
                .filter(|line| *line == "unused")
                .count(),
            20
        );
        std::fs::write(
            &list,
            serde_json::json!([{"Id":"../not-an-id","State":"running"}]).to_string(),
        )
        .unwrap();
        std::fs::write(&log, "").unwrap();
        let result = run("0");
        assert!(result.status.success());
        assert_eq!(std::fs::read_to_string(&log).unwrap().lines().count(), 1);
    }
}
