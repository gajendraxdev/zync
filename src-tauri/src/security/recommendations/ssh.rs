//! SSH changes require both configuration validation and a tested access/recovery path.
use super::{advice, steps, Advice};
use crate::security::{modules::ssh_policy::Check, wording::SshSetting};

/// Named/default-file and connection previews share controls, never an assertion about loaded policy.
pub(super) fn recipe(setting: SshSetting) -> Option<Advice> {
    let (next, change, impact) = match setting {
        SshSetting::RootLogin => (
            "Prefer named administrator accounts and controlled elevation; test access before restricting root login.",
            "Consider restricting PermitRootLogin after a named administrator can connect and elevate. Choose the permitted root methods against recovery and automation needs.",
            "Root-based automation and recovery logins can stop working; a separate tested administrative path is essential."),
        SshSetting::Password => (
            "Review password login against required key, certificate, MFA and recovery workflows.",
            "Consider PasswordAuthentication=no only after a working alternative and the intended MFA flow have been tested. Review AuthenticationMethods, keyboard-interactive/PAM and Match rules together.",
            "Users, automation or recovery relying on passwords may be locked out. This directive alone does not disable every password or interactive authentication path."),
        SshSetting::PublicKey => (
            "Review whether key or certificate login should be enabled, then test an approved identity.",
            "If approved key or user-certificate login is required, consider PubkeyAuthentication=yes with reviewed authorized-key or CA trust policy. Keep the intended MFA requirements.",
            "Enabling the method does not authorize a particular key or certificate. Key sources, certificate principals and other required factors need separate validation."),
        SshSetting::EmptyPassword => (
            "Review empty-password permission together with local accounts and PAM policy.",
            "Consider PermitEmptyPasswords=no and investigate intended exceptions with the administrator. Review account and PAM policy separately; this check does not establish a successful empty-password login.",
            "Intentionally passwordless workflows may fail; preserve an approved alternative before tightening access."),
        SshSetting::HostBased => (
            "Keep host-based login only where the host and user trust policy is deliberately maintained.",
            "Consider HostbasedAuthentication=no where it is unused. If needed, review host keys and host/user trust files before retaining this authentication method.",
            "Host-trust-based workflows may lose access; this report does not evaluate the trust files or all authentication methods."),
        SshSetting::X11 => (
            "Disable X11 forwarding where graphical SSH workflows do not need it.",
            "Consider X11Forwarding=no for users or connection scopes that do not require graphical forwarding, while retaining documented exceptions where necessary.",
            "Remote graphical applications using SSH X11 forwarding will stop working for affected connections."),
        SshSetting::StrictModes => (
            "Review home and SSH-file ownership before enabling StrictModes checks.",
            "Consider StrictModes=yes after correcting home-directory and authentication-file ownership and permissions. Check network or managed home-directory requirements first.",
            "Existing logins can fail when files or directories do not meet ownership and mode checks. StrictModes alone does not validate all external key sources."),
        SshSetting::Attempts => return None,
    };
    Some(advice(next,
        steps(&[
            "Identify the running daemon's binary, configuration and startup options; this observation is a current-file calculation, not loaded policy.",
            "Back up the configuration and review includes and applicable Match blocks. Keep a working administrator session and console recovery available.",
            change,
        ]),
        impact,
        steps(&[
            "Validate syntax with the actual daemon's test mode (sshd -t) and its real config/startup options; preview affected connections with -T and -C inputs.",
            "Use the deployment's supported reload procedure only after validation. Keep the current session and console recovery available.",
            "Verify a separate new login and required elevation before closing the old session.",
        ]),
        "Restore the backed-up configuration, validate it using the same daemon/configuration options and reload through the supported procedure. Use the retained administrator session or console if new logins fail; do not replace policy with permissive defaults."))
}

/// A connection preview has narrower inputs but requires the same loaded-policy and access checks.
pub(super) fn preview(check: Check) -> Option<Advice> {
    recipe(match check {
        Check::RootLogin => SshSetting::RootLogin,
        Check::Password => SshSetting::Password,
        Check::PublicKey => SshSetting::PublicKey,
        Check::EmptyPassword => SshSetting::EmptyPassword,
        Check::HostBased => SshSetting::HostBased,
        Check::X11 => SshSetting::X11,
        Check::Attempts => SshSetting::Attempts,
        Check::StrictModes => SshSetting::StrictModes,
    })
}
