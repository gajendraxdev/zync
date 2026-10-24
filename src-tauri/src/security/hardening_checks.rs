//! Capability-gated host observations. Configuration presence is not proof of active protection.
use super::{
    facts::Facts,
    hardening::{check, Outcome},
    report::Report,
};
const KERNEL: &str = "https://docs.kernel.org/admin-guide/sysctl/";
const ACCOUNTS: &str = "https://man7.org/linux/man-pages/man5/passwd.5.html";
const SYSTEMD: &str = "https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html";

/// Retain base-chain policy evidence, not raw firewall addresses, comments or an invented protection score.
fn firewall(key: &str, source: &str) -> Option<String> {
    let mut policies = vec![];
    let mut rules = 0;
    if key == "nft" {
        let value: serde_json::Value = serde_json::from_str(source).ok()?;
        for entry in value.get("nftables")?.as_array()? {
            if entry.get("rule").is_some() {
                rules += 1;
            }
            if let Some(chain) = entry
                .get("chain")
                .filter(|chain| chain.get("hook").is_some())
            {
                let hook = chain.get("hook")?.as_str()?;
                let policy = chain.get("policy")?.as_str()?;
                let family = chain.get("family")?.as_str()?;
                if !matches!(policy, "accept" | "drop") {
                    return None;
                }
                if policies.len() < 12 {
                    policies.push(format!("{family}/{hook}: {policy}"));
                }
            }
        }
    } else {
        for line in source.lines() {
            if line.starts_with("-A ") {
                rules += 1;
            }
            if let Some(chain) = line.strip_prefix(':') {
                let parts: Vec<_> = chain.split_whitespace().collect();
                if parts.len() != 3 {
                    return None;
                }
                if parts[1] != "-" && policies.len() < 12 {
                    policies.push(format!("{}: {}", parts[0], parts[1]));
                }
            }
        }
        if !source.is_empty() && !source.lines().any(|line| line.starts_with('*')) {
            return None;
        }
    }
    Some(format!("{rules} rules observed. Base-chain policies (up to 12): {}. Policy ordering, other backends and cloud controls still need review; this does not establish external reachability.", if policies.is_empty() { "none returned".into() } else { policies.join("; ") }))
}

/// Parse count-only local database evidence; never accept an empty or malformed account database.
fn counts(value: &str, expected: usize) -> Option<Vec<u32>> {
    let values = value
        .split_whitespace()
        .take(expected + 1)
        .map(str::parse::<u32>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    (values.len() == expected).then_some(values)
}

/// Summarize numeric TCP/UDP endpoints without calling them internet-accessible or exporting processes.
fn listeners(source: &str) -> Option<String> {
    let mut endpoints = vec![];
    let mut count = 0;
    let mut non_loopback = 0;
    for line in source.lines() {
        let fields: Vec<_> = line.split_whitespace().take(7).collect();
        if fields.len() != 6 || !matches!(fields[0], "tcp" | "udp") {
            return None;
        }
        let (address, port) = fields[4].rsplit_once(':')?;
        port.parse::<u16>().ok()?;
        let address = address
            .split('%')
            .next()?
            .trim_start_matches('[')
            .trim_end_matches(']');
        let loopback = if address == "*" {
            false
        } else {
            address
                .parse::<std::net::IpAddr>()
                .ok()
                .map(|address| match address {
                    std::net::IpAddr::V4(address) => address.is_loopback(),
                    std::net::IpAddr::V6(address) => address
                        .to_ipv4_mapped()
                        .map_or_else(|| address.is_loopback(), |address| address.is_loopback()),
                })?
        };
        count += 1;
        if !loopback {
            non_loopback += 1;
        }
        if endpoints.len() < 12 {
            endpoints.push(format!("{} {}", fields[0], fields[4]));
        }
    }
    Some(format!("{count} listening TCP/UDP sockets; {non_loopback} bound beyond loopback. {}. Bind addresses do not prove external reachability; current namespace only.", endpoints.join("; ")))
}

/// Require explicit systemd load/active evidence; missing units and non-systemd hosts are not passes.
fn loaded_service(source: &str) -> Option<&str> {
    let loaded = |block: &&str| {
        block.lines().any(|line| line == "LoadState=loaded")
            && block.lines().any(|line| line.starts_with("ActiveState="))
    };
    source
        .split("\n\n")
        .filter(loaded)
        .find(|block| block.lines().any(|line| line == "ActiveState=active"))
        .or_else(|| source.split("\n\n").find(loaded))
}

/// Add independent rule families, each using a named evidence record and a narrow recommendation.
pub fn assess(facts: &Facts, report: &mut Report) {
    for (key, title, target, recommendation) in [
        ("redirects", "IPv4 redirect acceptance", "net.ipv4.conf.all.accept_redirects", "Review all/default/per-interface redirect policy against host/router role; the aggregate value alone is not effective policy."),
        ("send_redirects", "IPv4 redirect sending", "net.ipv4.conf.all.send_redirects", "Review all/default/per-interface redirect sending; routers and network appliances need role-specific policy."),
        ("source_route", "IPv4 source-route acceptance", "net.ipv4.conf.all.accept_source_route", "Review source-route handling for each interface, not only the all setting."),
        ("rp_filter", "IPv4 reverse-path filtering", "net.ipv4.conf.all.rp_filter", "Review strict/loose reverse-path validation against VPN, multihoming and asymmetric routing requirements."),
        ("ipv6_redirects", "IPv6 redirect acceptance", "net.ipv6.conf.all.accept_redirects", "Review IPv6 routing and each interface's redirect policy; do not disable IPv6 as a substitute for policy."),
        ("dumps", "Privileged-process core dumps", "fs.suid_dumpable", "Review privileged core-dump policy and the configured collector. Value 2 may be appropriate with a protected system core-dump handler."),
    ] {
        let observed = facts.get(key).filter(|value| value.parse::<u32>().is_ok());
        check(report, facts, key, &format!("LINUX-{key}"), title, target, observed, Outcome::Informational, recommendation, KERNEL);
    }
    let accounts = facts.get("accounts").and_then(|value| counts(value, 2));
    for (index, id, title, accepted, recommendation) in [
        (0, "uid0", "Local superuser account count", 1, "Review every UID 0 account; prefer one managed superuser identity. This checks /etc/passwd only, not LDAP/NSS or sudo privileges."),
        (1, "duplicate_uids", "Duplicate local user IDs", 0, "Review duplicated UIDs for unintended shared ownership and access. Local /etc/passwd only; intentional aliases need documented review."),
    ] {
        let observed = accounts.as_ref().map(|values| values[index].to_string());
        check(report, facts, "accounts", &format!("ACCOUNT-{id}"), title, "/etc/passwd (counts only)", observed.as_deref(), Outcome::baseline(accounts.as_ref().is_some_and(|values| values[index] == accepted)), recommendation, ACCOUNTS);
    }
    let empty = facts.get("shadow_empty").and_then(|value| counts(value, 1));
    let observed = empty.as_ref().map(|values| format!("{} local shadow entries with an empty password field. No hashes or account names were collected.", values[0]));
    check(report, facts, "shadow_empty", "ACCOUNT-empty_passwords", "Empty local password fields", "/etc/shadow (count only)", observed.as_deref(), Outcome::baseline(empty.is_some_and(|values| values[0] == 0)), "Review empty password fields and PAM/service policy. Do not lock accounts or disable access without confirming an administrative recovery path.", ACCOUNTS);

    let sockets = facts.get("listeners").and_then(listeners);
    check(report, facts, "listeners", "NETWORK-listeners", "Listening TCP/UDP sockets", "Current network namespace", sockets.as_deref(), Outcome::Informational, "Confirm each listener is required and scoped to intended addresses. Check host/cloud firewall policy separately; do not close ports blindly.", "https://man7.org/linux/man-pages/man8/ss.8.html");
    for (key, title) in [
        ("nft", "nftables ruleset observation"),
        ("iptables", "IPv4 iptables ruleset observation"),
        ("ip6tables", "IPv6 iptables ruleset observation"),
    ] {
        let observed = facts.get(key).and_then(|value| firewall(key, value));
        check(report, facts, key, &format!("NETWORK-{key}"), title, "Current namespace / named firewall backend", observed.as_deref(), Outcome::Informational, "Review required ingress/egress, IPv4/IPv6, default policies and cloud controls together. Do not flush rules or replace an active firewall.", "https://netfilter.org/projects/nftables/manpage.html");
    }
    for (key, path) in [("tmp_mount", "/tmp"), ("shm_mount", "/dev/shm")] {
        let observed = facts.get(key).filter(|value| {
            let parts: Vec<_> = value.split_whitespace().take(3).collect();
            parts.len() == 2 && parts[0].starts_with('/') && !parts[1].is_empty()
        });
        check(report, facts, key, &format!("MOUNT-{key}"), &format!("{path} containing-mount policy"), path, observed, Outcome::Informational, "Review nodev/nosuid/noexec on the containing mount against workload requirements. A separate mount is not assumed; missing flags are not automatically exploitable. Do not remount a production workload without testing.", "https://man7.org/linux/man-pages/man8/findmnt.8.html");
    }
    let dpkg_os = facts
        .os()
        .is_ok_and(|(id, _)| matches!(id.as_str(), "ubuntu" | "debian"));
    let policy = dpkg_os.then(|| facts.get("apt_policy")).flatten().map(|value| if value.is_empty() { "No values returned for APT periodic list updates or unattended upgrades. Other update mechanisms were not checked." } else { value });
    check(report, facts, "apt_policy", "UPDATE-policy", "APT automatic-update configuration", "APT::Periodic settings (not execution history)", policy, Outcome::Informational, "Review update scheduling, allowed origins and failure monitoring. Configured values do not prove recent successful updates; other management systems may own patching.", "https://manpages.debian.org/bookworm/apt/apt-config.8.en.html");
    let health = dpkg_os.then(|| facts.get("package_health")).flatten();
    check(report, facts, "package_health", "UPDATE-dpkg", "dpkg database consistency", "dpkg --audit (no downloads)", health.map(|value| if value.is_empty() { "No incomplete-package problems reported by dpkg --audit. This is not a patch-freshness check." } else { value }), Outcome::baseline(health.is_some_and(str::is_empty)), "Investigate reported package-state problems using the distribution's supported maintenance workflow. A clean database does not mean packages are current or vulnerability-free.", "https://manpages.debian.org/bookworm/dpkg/dpkg.1.en.html");
    let reboot = dpkg_os
        .then(|| facts.get("reboot"))
        .flatten()
        .filter(|value| matches!(*value, "present" | "absent"));
    let reboot_outcome = if reboot == Some("present") {
        Outcome::Attention
    } else {
        Outcome::Informational
    };
    check(report, facts, "reboot", "UPDATE-reboot", "Distribution reboot-required marker", "/run/reboot-required", reboot, reboot_outcome, "If the marker is present, plan a maintenance restart after checking workload availability. Absence does not prove the running kernel or services use all installed fixes.", "https://ubuntu.com/security/notices");
    let journal = facts.get("journal").and_then(loaded_service);
    check(report, facts, "journal", "SERVICE-journal", "System journal service state", "systemd-journald.service", journal, Outcome::Informational, "Review logging retention, persistence, access and off-host forwarding. An active journal alone does not prove useful audit coverage; other logging stacks may be used.", SYSTEMD);
    let ssh = facts.get("ssh_service").and_then(loaded_service);
    check(report, facts, "ssh_service", "SERVICE-ssh", "SSH systemd isolation properties", "ssh.service / sshd.service", ssh, Outcome::Informational, "Review NoNewPrivileges, ProtectSystem and PrivateTmp with the SSH login/session requirements. Do not apply sandbox flags blindly to an SSH daemon; these properties do not cover all services or custom launchers.", SYSTEMD);
}
