//! Docker findings describe a bounded sample, so a recipe never invents a specific offending container.
use super::{advice, steps, Advice};
use crate::security::modules::workloads::Check;

/// Deployment changes belong in the actual workload source and require recreation plus health checks.
pub(super) fn recipe(check: Check) -> Option<Advice> {
    let (next, change, impact) = match check {
        Check::Privileged => (
            "Review sampled privileged workloads and replace broad access with required permissions.",
            "For workloads confirmed to use privileged mode, consider removing privileged mode and granting only required capabilities and device access.",
            "Hardware, networking or nested-container operations may fail. Required permissions must come from workload needs, not a blanket substitute capability."),
        Check::AddedCapabilities => (
            "Review each sampled workload's added capabilities and remove unnecessary grants.",
            "For workloads confirmed to add capabilities, remove unused additions and consider a tested minimal capability set.",
            "Networking, ownership changes or other privileged operations can fail. Removing additions does not establish that the engine's default set is minimal."),
        Check::PidNamespace => (
            "Review whether sampled workloads really need another workload's or the host's PID namespace.",
            "Remove unnecessary host/peer PID-namespace sharing from the affected deployment; use the workload's separate process namespace where compatible.",
            "Monitoring or process-control tools may lose visibility or access. Dependencies on another container's process namespace must be migrated."),
        Check::IpcNamespace => (
            "Review whether sampled workloads need shared host or peer-container IPC.",
            "Remove unnecessary host/peer IPC-namespace sharing from the affected deployment, using isolated IPC where compatible.",
            "Applications sharing memory or IPC objects across workloads may fail and need an explicit replacement communication path."),
        Check::SecurityOverrides => (
            "Review sampled unconfined overrides and restore appropriate confinement where compatible.",
            "Review explicit seccomp/AppArmor unconfined or disabled-label overrides. Remove unnecessary exceptions or replace them with a supported, tested workload-specific policy.",
            "Required system calls or file access may be denied. Removing an override does not prove daemon support, profile quality or effective process confinement."),
        Check::SensitiveMounts => (
            "Review sampled sensitive host-path binds and remove unnecessary host access.",
            "Inspect actual bind sources and resolved targets locally. Remove unnecessary system-path or Docker-socket binds, or replace broad binds with narrowly scoped application data access.",
            "Applications may lose required configuration or host integration. Read-only socket mounts can still allow daemon control; a read-only bind is not a sufficient socket-access boundary."),
        Check::Coverage | Check::NetworkNamespace | Check::RootFilesystem | Check::StartupIdentity
        | Check::NoNewPrivileges | Check::Devices | Check::Memory | Check::Pids | Check::Cpu
        | Check::UserNamespace => return None,
    };
    Some(advice(next,
        steps(&[
            "Use matching container IDs in Technical details, where available, to review affected workloads locally; only the first eight matches are listed.",
            "Record their managed deployment configuration and data-recovery plan before making changes.",
            change,
            "Edit the actual deployment source; the bounded sample does not cover every container or engine.",
        ]),
        impact,
        steps(&[
            "Test the revised deployment, then recreate affected workloads through their normal deployment system.",
            "Check application health, required integrations and the resulting settings, then rerun this area.",
            "Review sampling, missing inspections and runtime enforcement separately.",
        ]),
        "Restore the recorded deployment revision and recreate only affected workloads through the normal deployment system. Preserve persistent data and unrelated security controls; rolling back a configuration does not undo application data changes."))
}
