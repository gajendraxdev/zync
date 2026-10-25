//! Authored role context and evidence provenance; the renderer never interprets security policy.
use super::{
    catalog::{Evaluation, RuleDefinition},
    facts::Facts,
    modules::{self, ModuleDefinition, ModuleId},
    report::Finding,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RoleId {
    #[default]
    General,
    Web,
    Database,
    Ci,
    Router,
}

#[derive(Clone, Debug, Serialize)]
pub struct PolicyMetadata {
    pub id: RoleId,
    pub label: &'static str,
    pub revision: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopePreset {
    pub id: RoleId,
    pub label: &'static str,
    pub description: &'static str,
    pub module_ids: Vec<ModuleId>,
    pub revision: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub version: &'static str,
    pub modules: Vec<ModuleDefinition>,
    pub presets: Vec<ScopePreset>,
    pub default_preset_id: RoleId,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EvidenceKind {
    Runtime,
    EffectiveConfiguration,
    NamedConfiguration,
    Metadata,
    ServiceConfiguration,
    WorkloadConfiguration,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    High,
    Medium,
    Review,
}

impl RoleId {
    /// A role revision is separate from both operating-system profile selection and rule revisions.
    pub fn metadata(self) -> PolicyMetadata {
        PolicyMetadata {
            id: self,
            label: match self {
                Self::General => "General host",
                Self::Web => "Web server",
                Self::Database => "Database server",
                Self::Ci => "CI / build host",
                Self::Router => "Router",
            },
            revision: "zync-role-1",
        }
    }
    /// Presets choose useful scopes without discovering applications or starting commands.
    fn preset(self) -> ScopePreset {
        use ModuleId::*;
        let metadata = self.metadata();
        let (description, module_ids) = match self {
            Self::General => ("Core host protections", vec![Host, ExtendedHost, SshPolicy]),
            Self::Web => (
                "Host and common web-service protections",
                vec![Host, ExtendedHost, SshPolicy, Nginx, Apache],
            ),
            Self::Database => (
                "Host and named database-service protections",
                vec![Host, ExtendedHost, SshPolicy, Postgresql, Mysql, Redis],
            ),
            Self::Ci => (
                "Host, build-service and container settings",
                vec![
                    Host,
                    ExtendedHost,
                    SshPolicy,
                    Docker,
                    DockerWorkloads,
                    Jenkins,
                ],
            ),
            Self::Router => (
                "Host controls with an IPv4-forwarding expectation",
                vec![Host, ExtendedHost, SshPolicy],
            ),
        };
        ScopePreset {
            id: self,
            label: metadata.label,
            description,
            module_ids,
            revision: metadata.revision,
        }
    }
}

/// Return one native catalog so roles and module counts cannot drift into frontend policy copies.
pub fn catalog() -> Catalog {
    Catalog {
        version: "1",
        modules: modules::definitions(),
        presets: [
            RoleId::General,
            RoleId::Web,
            RoleId::Database,
            RoleId::Ci,
            RoleId::Router,
        ]
        .iter()
        .map(|role| role.preset())
        .collect(),
        default_preset_id: RoleId::General,
    }
}

/// Stable hashes bind annotations to the normalized target/evidence, without including credentials.
pub(super) fn digest(value: &str) -> String {
    hex_digest(Sha256::digest(value.as_bytes()).as_slice())
}

/// Encode a fixed digest without depending on optional hash-array formatting implementations.
pub(super) fn hex_digest(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(7 + bytes.len() * 2);
    output.push_str("sha256:");
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 15) as usize] as char);
    }
    output
}

/// Apply only explicit authored role conditions; generic contexts keep workload-dependent settings informational.
fn role_condition(role: RoleId, rule: &RuleDefinition, facts: &Facts, finding: &mut Finding) {
    if role == RoleId::Router
        && matches!(
            rule.evaluation,
            Evaluation::ExtendedHost(super::modules::system::Check::Ipv4Forward)
        )
        && matches!(
            finding.status.as_str(),
            "informational" | "passed" | "attention"
        )
    {
        if let Some(value @ ("0" | "1")) = facts.get(rule.fact_key) {
            finding.expected =
                "IPv4 forwarding is enabled for the selected Router role (value 1).".into();
            finding.status = if value == "1" { "passed" } else { "attention" }.into();
            finding.recommendation="Confirm this host should route IPv4 traffic and review its forwarding and firewall policy. IPv6 routing and external reachability need separate assessment.".into();
        }
    }
}

/// Provenance describes the source of a narrow observation, never a confidence percentage or full-host certification.
pub(super) fn evidence_kind(evaluation: Evaluation) -> EvidenceKind {
    use EvidenceKind::*;
    match evaluation {
        Evaluation::File { .. } => Metadata,
        Evaluation::Ssh { .. }
        | Evaluation::AptPolicy
        | Evaluation::Account { .. }
        | Evaluation::EmptyPasswords => NamedConfiguration,
        Evaluation::Journal | Evaluation::SshService => ServiceConfiguration,
        Evaluation::Application(super::modules::applications::Check::Service { .. }) => {
            ServiceConfiguration
        }
        Evaluation::Application(super::modules::applications::Check::Metadata { .. }) => Metadata,
        Evaluation::Application(
            super::modules::applications::Check::Nginx(_)
            | super::modules::applications::Check::Redis(_),
        ) => NamedConfiguration,
        Evaluation::DockerWorkload(_) => WorkloadConfiguration,
        Evaluation::SshPolicy(_) => EffectiveConfiguration,
        Evaluation::Runtime(
            super::runtime::Check::PgHbaErrors | super::runtime::Check::PgHbaTrust,
        ) => NamedConfiguration,
        Evaluation::ExtendedHost(
            super::modules::system::Check::GroupFile
            | super::modules::system::Check::GshadowFile
            | super::modules::system::Check::SudoersFile
            | super::modules::system::Check::CrontabFile,
        ) => Metadata,
        Evaluation::ExtendedHost(
            super::modules::system::Check::DuplicateLogins
            | super::modules::system::Check::NonshadowPasswords
            | super::modules::system::Check::DuplicateGroupNames
            | super::modules::system::Check::DuplicateGids,
        ) => NamedConfiguration,
        _ => Runtime,
    }
}

/// Review priority ranks an evidenced condition; it does not manufacture vulnerability severity for unknown checks.
fn priority(rule: &RuleDefinition, status: &str) -> Option<Priority> {
    if status != "attention" {
        return None;
    }
    Some(match rule.evaluation {
        Evaluation::EmptyPasswords | Evaluation::Account { .. } | Evaluation::File { .. } => {
            Priority::High
        }
        Evaluation::KernelRange { .. } => Priority::Medium,
        Evaluation::DockerWorkload(
            super::modules::workloads::Check::Privileged
            | super::modules::workloads::Check::SensitiveMounts
            | super::modules::workloads::Check::Devices,
        ) => Priority::High,
        Evaluation::Runtime(_) | Evaluation::DockerWorkload(_) => Priority::Medium,
        _ => Priority::Review,
    })
}

/// Attribute every result to one role, rule revision and stable checked target before publication/export.
pub(super) fn annotate(
    module: ModuleId,
    facts: &Facts,
    rule: &RuleDefinition,
    role: RoleId,
    profile: &super::profile::Profile,
    finding: &mut Finding,
) {
    role_condition(role, rule, facts, finding);
    finding.evidence_kind = Some(evidence_kind(rule.evaluation));
    finding.priority = priority(rule, &finding.status);
    let target = match module {
        ModuleId::DockerWorkloads => modules::workloads::target_key(facts).unwrap_or_default(),
        ModuleId::SshPolicy => modules::ssh_policy::target_key(facts).unwrap_or_default(),
        ModuleId::PostgresRuntime
        | ModuleId::MysqlRuntime
        | ModuleId::RedisRuntime
        | ModuleId::JenkinsRuntime => {
            super::runtime::target_key(facts, module.as_str()).unwrap_or_default()
        }
        _ => digest(&format!("{}\0{}", module.as_str(), rule.target)),
    };
    finding.target_key = if target.is_empty() {
        String::new()
    } else {
        digest(&format!(
            "zync-target-2\0{target}\0{}\0{}\0{}",
            profile.id, profile.platform_id, profile.platform_version
        ))
    };
    finding.evidence_key = if finding.target_key.is_empty() {
        String::new()
    } else {
        digest(&format!(
            "{}\0{}\0{}\0{}\0{}",
            finding.target_key, rule.id, rule.rule_version, finding.status, finding.evidence
        ))
    };
}

#[cfg(test)]
mod tests;
