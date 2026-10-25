//! Application recipes distinguish exact unit properties, named declarations and authenticated runtime facts.
use super::{advice, steps, Advice};
use crate::security::{
    catalog::RuleDefinition,
    modules::applications::{Check, DockerProperty, NginxProperty, RedisProperty, ServiceProperty},
    runtime,
};

/// Apply one tested override to the checked unit without changing guessed startup users or other services.
fn service(property: ServiceProperty, rule: &RuleDefinition) -> Option<Advice> {
    let (setting, impact) = match property {
        ServiceProperty::NoNewPrivileges => ("NoNewPrivileges=yes",
            "Helpers that rely on setuid, setgid or file capabilities to gain privileges can fail. Existing privileges are not removed."),
        ServiceProperty::PrivateTmp => ("PrivateTmp=yes, or disconnected where supported and appropriate",
            "Temporary files may no longer be shared with other services. Workflows exchanging files through shared temporary directories can fail."),
        ServiceProperty::ProtectSystem => ("ProtectSystem=yes, full or strict with narrow writable-path exceptions",
            "Application writes, upgrades and recovery may fail if required paths become read-only; test state, log and runtime directories."),
        ServiceProperty::ProtectHome => ("ProtectHome=yes, read-only or tmpfs as required by the workload",
            "The service may lose access to home-directory data, keys or configuration; preserve only the specific access it needs."),
        ServiceProperty::RestrictSuid => ("RestrictSUIDSGID=yes",
            "Installers or helpers that create setuid/setgid files may fail. Existing privileged files and other privilege mechanisms are outside this setting."),
        ServiceProperty::Umask => ("a UMask that removes group and other write permissions, such as 0022; use a stricter mask for confidential files",
            "New files may no longer support intended shared-write workflows. Existing files and explicitly requested permissions need separate review."),
        ServiceProperty::State | ServiceProperty::User => return None,
    };
    Some(advice(
        "Test a small service-unit override for this protection before applying it in production.",
        steps(&[
            &format!("Record the effective configuration of {} and test the application's requirements and local systemd support.", rule.target),
            &format!("Consider {setting} in a narrowly scoped [Service] drop-in for that exact unit. Do not edit the vendor unit directly."),
        ]),
        impact,
        steps(&[
            "Validate the unit/drop-in, reload unit definitions using the host's supported procedure and plan any required service restart.",
            "Check the resolved property, application health, logs and required workflows, then rerun this area.",
            "Review running processes separately; declared properties alone do not prove every running process is confined.",
        ]),
        "Restore only the drop-in change you made, reload unit definitions and perform the planned service restart if required. Recheck application health; preserve unrelated administrator overrides.",
    ))
}

/// Static Nginx declarations require discovering the actual instance before editing or reloading it.
fn nginx(property: NginxProperty) -> Advice {
    let (next, change, impact, verify) = match property {
        NginxProperty::Tokens => (
            "Review explicit version disclosure in the active Nginx configuration.",
            "Consider server_tokens off for relevant HTTP/server/location scopes where version disclosure is unnecessary.",
            "Version hiding affects error pages and headers; it does not replace timely software updates or remove every fingerprint.",
            "Check representative responses and error pages for each relevant virtual host; included configuration and inheritance can change the outcome."),
        NginxProperty::DirectoryListing => (
            "Disable unintended directory listings after checking which content should be public.",
            "Consider autoindex off in affected locations unless publishing that listing is intentional. Review index handling and access controls.",
            "Directory browsing and intentionally published file indexes may stop working. Individual files can remain accessible through direct URLs.",
            "Test listing and direct-file access for affected virtual hosts/locations, including an unauthenticated client where appropriate."),
        NginxProperty::TlsProtocols => (
            "Remove obsolete TLS protocol declarations after checking required clients.",
            "Review explicit SSLv2/SSLv3/TLSv1/TLSv1.1 declarations. Prefer TLSv1.2 and TLSv1.3 where the deployed Nginx/OpenSSL and required clients support them, including the default TLS server context.",
            "Older clients may no longer connect. Supported protocol names depend on the installed build; certificates, cipher choices and upstream TLS require separate review.",
            "Test protocol negotiation on each relevant endpoint, including its default server and required clients. A named-file declaration alone does not prove the offered protocols."),
    };
    advice(next,
        steps(&[
            "Confirm whether the named file is used by the running instance and inspect relevant includes and virtual-host inheritance.",
            "Back up the managed configuration before changing it.",
            change,
        ]),
        impact,
        steps(&[
            "Run the actual Nginx binary's configuration test with its real configuration and startup options; use the deployment's supported reload only if validation succeeds.",
            verify,
            "Rerun this area afterwards.",
        ]),
        "Restore the backed-up managed configuration, validate it with the same binary/configuration options, and reload through the supported deployment procedure. Recheck endpoint availability.")
}

/// Dispatch exact application evidence; contextual declarations keep their original review wording.
pub(super) fn configuration(check: Check, rule: &RuleDefinition) -> Option<Advice> {
    Some(match check {
        Check::Service { property, .. } => return service(property, rule),
        Check::Metadata { directory, socket, .. } => advice(
            "Review ownership and unnecessary access on this exact application path.",
            if socket {
                steps(&[
                    "Record the named socket's metadata and the policy that recreates it.",
                    "Restore intended root ownership and remove other-user access; review the socket group and its membership separately.",
                    "Change the managing service policy rather than relying on a temporary mode change.",
                ])
            } else if directory {
                steps(&[
                    "Record metadata for the exact named directory.",
                    "Restore intended root ownership and remove unintended group/other writes while preserving required service traversal and reads; use the deployment's managed ownership policy.",
                    "Do not recursively change application data.",
                ])
            } else {
                steps(&[
                    "Record metadata for the exact named file.",
                    "Restore intended root ownership and remove unintended group/other writes while preserving required service reads; follow the deployment's managed ownership policy.",
                    "Do not recursively change nearby files.",
                ])
            },
            if socket { "Docker socket access can confer extensive host control, even through a read-only bind. Tightening it can break approved administration and automation; never make it world-accessible to resolve a connection failure." } else { "Incorrect ownership or access restrictions can prevent the application starting or reading its configuration. Symlink targets, parent directories and ACLs need separate review." },
            steps(&[
                "Recheck the same path's numeric owner and mode and required application/client access.",
                "Confirm the metadata remains correct when the managing service recreates the path; review ACLs separately and rerun this area.",
            ]),
            "Restore the recorded metadata and only the managing-policy change you made if required access breaks. Keep unnecessary users excluded and preserve unrelated overrides."),
        Check::Nginx(property) => nginx(property),
        Check::Redis(RedisProperty::ProtectedMode) => advice(
            "Review the declared disabled Redis protected mode alongside live binding and ACLs.",
            steps(&[
                "Identify the active Redis instance and configuration source, including command-line and runtime overrides.",
                "Back up the managed configuration and review intended remote clients, bind addresses and ACL authentication.",
                "Consider protected-mode yes after reviewing those requirements.",
            ]),
            "Clients relying on an unprotected default configuration may lose access. Protected mode alone neither enforces a complete ACL policy nor proves that all network clients authenticate.",
            steps(&[
                "Use the deployment's supported configuration/reload procedure, then verify required authenticated clients, listener scope and rejected unauthorized access.",
                "Rerun this area. Review live policy separately; the named-file declaration does not establish it.",
            ]),
            "Restore the managed configuration change through administrator recovery access and verify intended clients. Do not remove authentication or broaden listeners merely to restore connectivity."),
        Check::Docker(DockerProperty::Seccomp) => advice(
            "Review seccomp support in the selected Docker Engine and its host kernel.",
            steps(&[
                "Confirm the checked default socket belongs to the intended engine.",
                "Review its build, supported kernel configuration and workload security options with the administrator.",
                "Enable supported seccomp confinement through the deployment's normal maintenance process.",
            ]),
            "Engine/kernel changes may need downtime or a reboot. A seccomp profile can block required system calls; test workloads rather than switching every container to unconfined mode.",
            steps(&[
                "Confirm the intended engine reports seccomp support and verify representative workload profile settings and functionality after maintenance.",
                "Rerun this area. Review per-container enforcement separately; engine support alone does not establish it.",
            ]),
            "Use the documented engine/kernel recovery plan and the recorded workload configuration if compatibility fails. Restore only the relevant change and do not remove confinement across unrelated workloads."),
        Check::Docker(DockerProperty::Logging) => advice(
            "Review the engine's disabled default logging and choose appropriate collection and retention.",
            steps(&[
                "Confirm whether workload logs are intentionally collected elsewhere and record existing daemon and workload overrides.",
                "If logs are not collected elsewhere, select a supported logging driver with suitable rotation/retention in the intended engine's managed policy.",
                "Plan affected workload recreation; the daemon default applies only to newly created containers.",
            ]),
            "Logging can consume storage, expose sensitive output or block/drop output according to the driver's delivery mode. Changing the daemon default does not enable logs in existing containers.",
            steps(&[
                "Apply the managed engine change through a maintenance procedure, then create/recreate representative workloads.",
                "Confirm expected output reaches the intended destination within retention limits; a driver name does not verify delivery.",
                "Inspect per-container settings and rerun this area.",
            ]),
            "Restore the recorded engine and workload logging configuration through the normal deployment process. Recreate affected containers where required, preserving collected logs and persistent application data."),
        Check::Redis(RedisProperty::Binding | RedisProperty::Tls | RedisProperty::Authentication)
        | Check::Docker(DockerProperty::Isolation | DockerProperty::LiveRestore) => return None,
    })
}

/// Only runtime checks with an authored attention condition receive a configuration-change plan.
pub(super) fn runtime(check: runtime::Check) -> Option<Advice> {
    use runtime::Check::*;
    Some(match check {
        PgPassword => advice(
            "Plan a SCRAM-compatible password policy and credential migration with the DBA.",
            steps(&[
                "Confirm all required client libraries support SCRAM before changing the password policy.",
                "Consider password_encryption=scram-sha-256 in the correct managed server/role policy.",
                "Migrate existing credentials separately with controlled password rotation and reviewed authentication rules.",
            ]),
            "The default affects newly assigned passwords, not existing hashes. Older clients can lose access after rotation or authentication-policy changes.",
            steps(&[
                "Check the runtime default on the intended server and verify newly rotated representative clients through the intended authentication rules.",
                "Rerun this area. Review existing password hashes separately; this assessment does not inspect them.",
            ]),
            "Restore the recorded default/rules if necessary, preserving a tested DBA session. Reverting the default does not convert existing SCRAM hashes; credential recovery or compatible clients may still be required."),
        PgHbaErrors => advice(
            "Ask the DBA to correct the reported authentication-file parse errors before reloading.",
            steps(&[
                "Identify the intended PostgreSQL instance and its actual authentication-file path/includes.",
                "Back up the managed rules and inspect pg_hba_file_rules errors locally.",
                "Correct the specific invalid entries without introducing broad trust rules.",
            ]),
            "Reloading incorrect or reordered authentication rules can deny required clients or allow unintended access. The view reports current files, not the last loaded policy.",
            steps(&[
                "Confirm pg_hba_file_rules has no parse errors before using the instance's supported reload procedure; review its logs.",
                "Test separate new intended and denied client connections while keeping DBA recovery access.",
                "Rerun this area.",
            ]),
            "Restore the backed-up rules and reload through the correct instance's supported procedure. Use the retained DBA session or console if authentication fails; do not replace the policy with unrestricted trust."),
        JenkinsSecurity => advice(
            "Review Jenkins authentication and authorization with a tested administrator recovery path.",
            steps(&[
                "Confirm the intended controller and any proxy/container access controls.",
                "Back up its managed configuration and confirm a tested administrator recovery path.",
                "Configure an appropriate security realm and authorization strategy with an explicit administrator account and least-privilege access.",
            ]),
            "Changing access control can lock out operators and automation. A proxy may already limit access; the useSecurity flag alone does not describe every protection.",
            steps(&[
                "Keep administrator recovery available while testing a separate administrator login, intended automation and denied unauthorized actions.",
                "Rerun this area. Review the complete access policy separately; the flag becoming true alone does not validate it.",
            ]),
            "Restore the reviewed managed access configuration using the administrator recovery procedure. Do not disable Jenkins security or expose the controller to restore convenience access."),
        JenkinsExecutors => advice(
            "Move builds to isolated agents before setting built-in controller executors to zero.",
            steps(&[
                "Provision appropriate agents and migrate jobs away from the built-in controller.",
                "Verify required builds can run on those agents before setting the built-in node's executor count to 0 in its managed configuration.",
            ]),
            "Builds may queue or fail if agents, labels, credentials or workspaces are not ready. Agent-to-controller permissions and build isolation remain separate requirements.",
            steps(&[
                "Run representative jobs on the intended agents and confirm new builds do not execute on the controller.",
                "Check the controller's configured executor count, then rerun this area.",
            ]),
            "Preserve prior node and job configuration. If migration fails, pause affected work and use the reviewed recovery arrangement; restoring controller executors also restores their original risk."),
        PgSsl | PgRowSecurity | PgConnectionLogging | PgLoggingCollector | PgSuperusers | PgHbaTrust
        | MysqlTransport | MysqlLocalInfile | MysqlFileScope | MysqlDns | MysqlGeneralLog | MysqlAdmins
        | RedisProtected | RedisBind | RedisTls | RedisPersistence | RedisEviction | RedisDefaultAdmin
        | JenkinsCsrf | JenkinsAnonymous => return None,
    })
}
