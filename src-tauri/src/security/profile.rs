//! OS identity selects authored scope, never a claim of tested or certified host support.
use super::catalog::ApplicabilityPolicy;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Coverage {
    Targeted,
    Generic,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub label: String,
    pub platform_id: String,
    pub platform_version: String,
    pub coverage: Coverage,
    pub coverage_note: String,
}

pub(super) enum Applicability {
    Applicable,
    NotApplicable(&'static str),
    Unknown(&'static str),
}

impl Profile {
    /// Match only exact authored releases; family hints cannot establish release qualification.
    pub fn select(id: String, version: String, related: &[String]) -> Self {
        let target = match (id.as_str(), version.as_str()) {
            ("ubuntu", "22.04" | "24.04") => Some("Ubuntu"),
            ("debian", "12" | "13") => Some("Debian"),
            _ => None,
        };
        let (profile_id, label, coverage, note) = if let Some(name) = target {
            (
                format!("zync-{id}-{version}"),
                format!("Zync {name} {version}"),
                Coverage::Targeted,
                "These checks were written for this OS release. They cover only the listed settings; selection does not prove testing on this host, complete coverage or certification.".to_string(),
            )
        } else {
            (
                "zync-linux-generic".to_string(),
                "Zync Linux generic".to_string(),
                Coverage::Generic,
                format!("This OS/release uses general Linux checks with limited coverage. Debian/Ubuntu maintenance checks need a confirmed OS match. This is not a complete assessment or certification.{}", if related.is_empty() { "" } else { " A related OS name does not establish support for this release." }),
            )
        };
        Self {
            id: profile_id,
            label,
            platform_id: id,
            platform_version: version,
            coverage,
            coverage_note: note,
        }
    }

    /// Exclude only established package-family mismatches; unrecognized derivatives stay unknown.
    pub(super) fn applicability(&self, policy: ApplicabilityPolicy) -> Applicability {
        if policy == ApplicabilityPolicy::Linux {
            return Applicability::Applicable;
        }
        match self.platform_id.as_str() {
            "ubuntu" | "debian" => Applicability::Applicable,
            "fedora" | "rhel" | "centos" | "rocky" | "almalinux" | "ol" | "amzn"
            | "arch" | "alpine" | "opensuse" | "opensuse-leap" | "opensuse-tumbleweed"
            | "sles" | "sled" | "nixos" | "gentoo" => Applicability::NotApplicable(
                "This check is for Debian/Ubuntu maintenance tools. The detected operating system is a known different distribution, so the check does not apply.",
            ),
            _ => Applicability::Unknown(
                "Could not confirm whether this operating system supports the Debian/Ubuntu maintenance tools used by this check. A related operating system's name alone is not enough to decide.",
            ),
        }
    }
}
