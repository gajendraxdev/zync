//! Reviewed first-party Linux baseline. Recommendations are not automatic remediation.
use super::{
    catalog::RuleDefinition,
    facts::Facts,
    hardening_checks::{self, Observation},
    modules::{self, ExtraResult, ModuleId},
    profile::{Applicability, Profile},
    report::{text, Finding, Kind, Report},
    wording,
};
/// Distinguish a narrow baseline decision from evidence needing workload-specific interpretation.
#[derive(Clone, Copy)]
pub(super) enum Outcome {
    Passed,
    Attention,
    Informational,
}
impl Outcome {
    /// Convert only an established baseline condition into a pass; deviations need attention.
    pub(super) fn baseline(accepted: bool) -> Self {
        if accepted {
            Self::Passed
        } else {
            Self::Attention
        }
    }
    /// Keep serialized states stable while evaluation uses a closed native decision type.
    fn status(self) -> &'static str {
        match self {
            Self::Passed => "passed",
            Self::Attention => "attention",
            Self::Informational => "informational",
        }
    }
}
/// Normalize catalog metadata and bounded evidence without inferring protection from missing data.
fn check(report: &mut Report, facts: &Facts, module: ModuleId, rule: &RuleDefinition) {
    let mut applicability = report.profile.applicability(rule.applicability);
    let mut summary = None;
    let mut unavailable_details = None;
    let observation = if matches!(applicability, Applicability::Applicable) {
        if matches!(
            rule.evaluation,
            super::catalog::Evaluation::ExtendedHost(_)
                | super::catalog::Evaluation::Application(_)
                | super::catalog::Evaluation::DockerWorkload(_)
                | super::catalog::Evaluation::Runtime(_)
                | super::catalog::Evaluation::SshPolicy(_)
        ) {
            let mut fact_key = rule.fact_key;
            let (value, outcome) = match modules::evaluate(facts, rule) {
                ExtraResult::Available {
                    value,
                    observed,
                    outcome,
                } => {
                    summary = Some(observed);
                    (Some(value), outcome)
                }
                ExtraResult::Unavailable => (None, Outcome::Informational),
                ExtraResult::UnavailableAt(key) => {
                    fact_key = key;
                    (None, Outcome::Informational)
                }
                ExtraResult::UnavailableWith { reason, next_step } => {
                    unavailable_details = Some((reason, next_step));
                    (None, Outcome::Informational)
                }
                ExtraResult::NotApplicable(reason) => {
                    applicability = Applicability::NotApplicable(reason);
                    (None, Outcome::Informational)
                }
            };
            Observation {
                fact_key,
                value,
                outcome,
            }
        } else {
            hardening_checks::evaluate(facts, rule)
        }
    } else {
        Observation {
            fact_key: rule.fact_key,
            value: None,
            outcome: Outcome::Informational,
        }
    };
    let available = observation.value.is_some();
    let (status, observed, evidence, recommendation, applicability_reason) = match applicability {
        Applicability::NotApplicable(reason) => (
            "notApplicable", reason.to_string(), reason.to_string(),
            "Review the stated scope. This result does not establish that the application is absent or call for a configuration change.".to_string(), Some(reason.to_string()),
        ),
        Applicability::Unknown(reason) => (
            "notAssessed", "Could not confirm whether this Debian/Ubuntu check applies to this operating system.".to_string(), reason.to_string(),
            "Ask the administrator whether this operating system supports the Debian/Ubuntu tool used by this check. A related operating system's name alone is not enough to decide.".to_string(), Some(reason.to_string()),
        ),
        Applicability::Applicable => (
            if available { observation.outcome.status() } else { "notAssessed" },
            observation.value.as_deref().map(|value| text(&summary.unwrap_or_else(||wording::observed(rule.evaluation, value, observation.outcome)), 200)).unwrap_or_else(|| unavailable_details.map(|(reason,_)|reason).unwrap_or_else(||facts.short_diagnostic(observation.fact_key)).into()),
            observation.value.as_deref().map(|value| text(value, 1024)).unwrap_or_else(|| unavailable_details.map(|(reason,_)|reason.to_string()).unwrap_or_else(||facts.diagnostic(observation.fact_key))),
            if available { rule.guidance.into() } else { unavailable_details.map(|(_,next)|next).unwrap_or_else(||facts.collection_next_step(observation.fact_key)).into() },
            None,
        ),
    };
    // Applicability exclusions and unknown scope must never offer elevation for unrelated facts.
    let retry_scope =
        status == "notAssessed" && applicability_reason.is_none() && unavailable_details.is_none();
    let mut finding = Finding {
        target_key: String::new(),
        evidence_key: String::new(),
        evidence_kind: None,
        priority: None,
        module_id: module.as_str().into(),
        id: rule.id.into(),
        category: rule.category.label().into(),
        title: rule.title.into(),
        target: rule.target.into(),
        needs_elevated_access: retry_scope && facts.needs_elevated_access(observation.fact_key),
        sudo_retry_eligible: retry_scope && facts.can_retry_with_sudo(observation.fact_key),
        status: status.into(),
        observed,
        evidence,
        recommendation,
        remediation: None,
        expected: rule.expected.into(),
        rationale: rule.rationale.into(),
        scope: rule.scope.into(),
        scope_summary: Some(super::context::scope_summary(rule.evaluation).into()),
        rule_version: rule.rule_version.into(),
        reviewed_at: rule.reviewed_at.into(),
        applicability_reason,
        reference: rule.reference.into(),
    };
    super::policy::annotate(
        module,
        facts,
        rule,
        report.policy.id,
        &report.profile,
        &mut finding,
    );
    super::recommendations::enhance(&mut finding, rule);
    report.push(finding);
}
/// Evaluate every compiled rule once; authored profile selection does not imply host qualification.
#[cfg(test)]
pub fn assess(facts: &Facts) -> Result<Report, String> {
    assess_selected(facts, &[ModuleId::Host])
}
/// Evaluate only approved modules; collection and reports share one canonical scope.
#[cfg(test)]
pub fn assess_selected(facts: &Facts, selected: &[ModuleId]) -> Result<Report, String> {
    assess_policy(facts, selected, super::policy::RoleId::General)
}
/// Role context is applied natively and retained with its revision for comparisons and accepted-risk annotations.
pub fn assess_policy(
    facts: &Facts,
    selected: &[ModuleId],
    role: super::policy::RoleId,
) -> Result<Report, String> {
    let (id, version) = facts.os()?;
    let os = format!("{id} {version}").trim_end().to_string();
    let profile = Profile::select(id, version, &facts.os_like());
    let mut report = Report::new(Kind::Hardening, os, profile);
    report.policy = role.metadata();
    report.modules = selected.iter().map(|id| id.definition()).collect();
    if let Some(privilege) = facts.get("privilege") {
        let mut parts = privilege.split_whitespace();
        report.collector_uid = parts.next().and_then(|value| value.parse().ok());
        report.elevation_requested = parts.next() == Some("sudo");
    }
    for module in selected {
        for rule in module.rules() {
            check(&mut report, facts, *module, rule);
        }
    }
    report.notes.extend([
        "Only the selected modules and their named targets were checked. An unselected module was not collected or evaluated. This is not a complete host, application, database, container-image or compliance audit, and it is not a penetration test.".into(),
        "Needs attention means a checked setting or maintenance signal deserves review; it is not a confirmed vulnerability. Informational results need context and have no pass/fail decision. Passed means only that the named condition met this baseline.".into(),
        "Default SSH results describe configuration defaults, not connection-specific Match rules. The optional connection-policy preview applies captured connection inputs to the current standard configuration file; it cannot prove the running daemon's arguments or already-loaded policy. Both remain contextual and never receive Passed. Unavailable information never receives Passed or Needs attention.".into(),
        "Network results describe the server's current network namespace only. Listeners and local firewall rules do not show whether the internet can reach the server; cloud firewall rules were not checked.".into(),
        if report.elevation_requested { "Sudo was allowed only for the listed protected reads. A password is requested only when this run receives a sudo prompt, and is kept in native memory only for this run. No root shell is opened and no sudoers settings are changed. The server's normal authentication cache and logs still apply. Allowing sudo does not guarantee a read will succeed.".into() } else { "Sudo was not requested. Checks used the connected SSH user's existing access, including root access if already logged in as root. Some protected information may be unavailable.".into() },
        "Zync reviews baseline rules with releases. Their version is shown above. Check that any suggested change fits this server's role and recovery needs before applying it.".into(),
    ]);
    report.notes.push("Not applicable means evidence establishes an exclusion from this check's stated scope, such as a different platform or an unloaded named service unit. It is not a pass or proof that an application is absent. Unknown applicability stays unavailable. A selected profile does not prove testing on this host or certification.".into());
    Ok(report)
}
