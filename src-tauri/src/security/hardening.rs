//! Reviewed first-party Linux baseline. Recommendations are not automatic remediation.
use super::{
    catalog::{RuleDefinition, RULES},
    facts::Facts,
    hardening_checks::{self, Observation},
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
fn check(report: &mut Report, facts: &Facts, rule: &RuleDefinition) {
    let applicability = report.profile.applicability(rule.applicability);
    let observation = if matches!(applicability, Applicability::Applicable) {
        hardening_checks::evaluate(facts, rule)
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
            "notApplicable", "This check does not apply to the detected operating system.".to_string(), reason.to_string(),
            "Use the operating system's own maintenance and security guidance. This result does not call for a configuration change.".to_string(), Some(reason.to_string()),
        ),
        Applicability::Unknown(reason) => (
            "notAssessed", "Could not confirm whether this Debian/Ubuntu check applies to this operating system.".to_string(), reason.to_string(),
            "Ask the administrator whether this operating system supports the Debian/Ubuntu tool used by this check. A related operating system's name alone is not enough to decide.".to_string(), Some(reason.to_string()),
        ),
        Applicability::Applicable => (
            if available { observation.outcome.status() } else { "notAssessed" },
            observation.value.as_deref().map(|value| text(&wording::observed(rule.evaluation, value, observation.outcome), 200)).unwrap_or_else(|| facts.short_diagnostic(observation.fact_key).into()),
            observation.value.as_deref().map(|value| text(value, 1024)).unwrap_or_else(|| facts.diagnostic(observation.fact_key)),
            if available { rule.guidance.into() } else { facts.collection_next_step(observation.fact_key).into() },
            None,
        ),
    };
    // Applicability exclusions and unknown scope must never offer elevation for unrelated facts.
    let retry_scope = status == "notAssessed" && applicability_reason.is_none();
    report.push(Finding {
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
        expected: rule.expected.into(),
        rationale: rule.rationale.into(),
        scope: rule.scope.into(),
        rule_version: rule.rule_version.into(),
        reviewed_at: rule.reviewed_at.into(),
        applicability_reason,
        reference: rule.reference.into(),
    });
}
/// Evaluate every compiled rule once; authored profile selection does not imply host qualification.
pub fn assess(facts: &Facts) -> Result<Report, String> {
    let (id, version) = facts.os()?;
    let os = format!("{id} {version}").trim_end().to_string();
    let profile = Profile::select(id, version, &facts.os_like());
    let mut report = Report::new(Kind::Hardening, os, profile);
    if let Some(privilege) = facts.get("privilege") {
        let mut parts = privilege.split_whitespace();
        report.collector_uid = parts.next().and_then(|value| value.parse().ok());
        report.elevation_requested = parts.next() == Some("sudo");
    }
    for rule in RULES {
        check(&mut report, facts, rule);
    }
    report.notes.extend([
        "This review covers selected kernel settings, three files, SSH defaults, local account counts, listeners, firewalls, two mounts, Debian/Ubuntu maintenance settings and systemd services. It does not cover every security risk, compliance requirement, application or container, and it is not a penetration test.".into(),
        "Needs attention means a checked setting or maintenance signal deserves review; it is not a confirmed vulnerability. Informational results need context and have no pass/fail decision. Passed means only that the named condition met this baseline.".into(),
        "SSH results describe configuration defaults, not verified rules for this live connection. The running server's options, host keys and connection-specific Match rules were not checked. SSH defaults never receive Passed. Unavailable information never receives Passed or Needs attention.".into(),
        "Network results describe the server's current network namespace only. Listeners and local firewall rules do not show whether the internet can reach the server; cloud firewall rules were not checked.".into(),
        if report.elevation_requested { "Sudo was allowed only for the listed protected reads. A password is requested only when this run receives a sudo prompt, and is kept in native memory only for this run. No root shell is opened and no sudoers settings are changed. The server's normal authentication cache and logs still apply. Allowing sudo does not guarantee a read will succeed.".into() } else { "Sudo was not requested. Checks used the connected SSH user's existing access, including root access if already logged in as root. Some protected information may be unavailable.".into() },
        "Zync reviews baseline rules with releases. Their version is shown above. Check that any suggested change fits this server's role and recovery needs before applying it.".into(),
    ]);
    report.notes.push("Not applicable means the detected operating system is outside this check's scope. It is not a pass. If applicability or the required information is unknown, the result stays Evidence unavailable. A selected profile identifies the intended OS/release; it does not prove testing on this host or certification.".into());
    Ok(report)
}
