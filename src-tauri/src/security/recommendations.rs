//! Inert, reviewed next steps for already evaluated findings. Advice never selects policy or runs a command.
mod applications;
mod host;
mod ssh;
mod workloads;

use super::{
    catalog::{Evaluation, RuleDefinition},
    report::{Finding, RemediationGuide},
};

/// An optional replacement for the short next step plus the expandable, operator-reviewed plan.
struct Advice {
    next_step: Option<&'static str>,
    guide: RemediationGuide,
}

/// Only authored boundaries create action steps; remote prose is never split into instructions.
fn steps(items: &[&str]) -> String {
    items.join("\n")
}

/// Keep authored prose separate from remote evidence; only the typed rule chooses a recipe.
fn advice(
    next_step: &'static str,
    change: impl Into<String>,
    impact: impl Into<String>,
    verification: impl Into<String>,
    rollback: impl Into<String>,
) -> Advice {
    Advice {
        next_step: Some(next_step),
        guide: RemediationGuide {
            change: change.into(),
            impact: impact.into(),
            verification: verification.into(),
            rollback: rollback.into(),
        },
    }
}

/// Attach a plan only after final applicability, role policy and evidence provenance are established.
/// Unknown, excluded, contextual and successful results retain their original next step.
pub(super) fn enhance(finding: &mut Finding, rule: &RuleDefinition) {
    finding.remediation = None;
    if finding.status != "attention"
        || finding.applicability_reason.is_some()
        || finding.evidence_kind.is_none()
        || finding.target_key.is_empty()
        || finding.evidence_key.is_empty()
        || finding.evidence.trim().is_empty()
    {
        return;
    }
    let result = match rule.evaluation {
        Evaluation::Application(check) => applications::configuration(check, rule),
        Evaluation::Runtime(check) => applications::runtime(check),
        Evaluation::DockerWorkload(check) => workloads::recipe(check),
        Evaluation::Ssh { setting, .. } => ssh::recipe(setting),
        Evaluation::SshPolicy(check) => ssh::preview(check),
        Evaluation::ExtendedHost(check) => host::extended(check, rule),
        _ => host::baseline(rule),
    };
    if let Some(result) = result {
        if let Some(next_step) = result.next_step {
            finding.recommendation = next_step.into();
        }
        finding.remediation = Some(result.guide);
    }
}

#[cfg(test)]
mod tests;
