//! Fixed evidence interpreters. Catalog definitions own labels, policy values and guidance.
use super::{
    catalog::{Evaluation, RuleDefinition, SshValue},
    facts::Facts,
    hardening::Outcome,
};

pub(super) struct Observation {
    pub fact_key: &'static str,
    pub value: Option<String>,
    pub outcome: Outcome,
}

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

/// Interpret named-file metadata while preserving the separate local shadow-group dependency.
fn file_observation(facts: &Facts, key: &'static str, restricted: bool) -> Observation {
    let shadow_group = facts.get("shadow_group").and_then(|value| {
        if value == "absent" {
            Some(None)
        } else {
            value.parse::<u32>().ok().map(Some)
        }
    });
    let parsed = facts.get(key).and_then(|value| {
        let mut fields = value.split_whitespace();
        let mode = u32::from_str_radix(fields.next()?, 16).ok()?;
        let uid = fields.next()?.parse::<u32>().ok()?;
        let gid = fields.next()?.parse::<u32>().ok()?;
        (fields.next().is_none() && mode <= 0xffff && mode & 0o170000 == 0o100000).then_some((
            mode & 0o7777,
            uid,
            gid,
        ))
    });
    let mode_accepted = parsed.is_some_and(|(mode, uid, _)| {
        uid == 0 && mode & 0o022 == 0 && (!restricted || mode & 0o007 == 0)
    });
    let needs_group = mode_accepted
        && restricted
        && parsed.is_some_and(|(mode, _, gid)| mode & 0o040 != 0 && gid != 0);
    let group_known = !needs_group || shadow_group.is_some();
    let accepted = mode_accepted
        && (!needs_group || parsed.is_some_and(|(_, _, gid)| shadow_group == Some(Some(gid))));
    Observation {
        fact_key: if group_known { key } else { "shadow_group" },
        value: parsed
            .filter(|_| group_known)
            .map(|(mode, uid, gid)| format!("mode={mode:04o} uid={uid} gid={gid}")),
        outcome: Outcome::baseline(accepted),
    }
}
/// Validate each SSH field independently; one successful shared command cannot validate another field.
fn ssh_value<'a>(source: &'a str, field: &str, kind: SshValue) -> Option<&'a str> {
    let prefix = format!("{field} ");
    let mut values = source.lines().filter_map(|line| line.strip_prefix(&prefix));
    let value = values.next()?;
    if values.next().is_some() {
        return None;
    }
    let valid = match kind {
        SshValue::RootLogin => matches!(
            value,
            "yes" | "no" | "prohibit-password" | "without-password" | "forced-commands-only"
        ),
        SshValue::AttemptLimit => value
            .parse::<u32>()
            .is_ok_and(|value| value > 0 && value <= 1024),
        SshValue::Boolean => matches!(value, "yes" | "no"),
    };
    valid.then_some(value)
}
/// Dispatch a compiled interpreter without duplicating rule titles, thresholds or applicability in UI code.
pub(super) fn evaluate(facts: &Facts, rule: &RuleDefinition) -> Observation {
    let key = rule.fact_key;
    let raw = facts.get(key);
    let (value, outcome) = match rule.evaluation {
        Evaluation::KernelRange { minimum, maximum, .. } => {
            let number = raw.and_then(|value| value.parse::<u32>().ok());
            (number.and(raw).map(str::to_string), Outcome::baseline(number.is_some_and(|value| (minimum..=maximum).contains(&value))))
        }
        Evaluation::KernelObservation(_) => (raw.filter(|value| value.parse::<u32>().is_ok()).map(str::to_string), Outcome::Informational),
        Evaluation::File { restricted } => return file_observation(facts, key, restricted),
        Evaluation::Ssh { field, kind, attention_value, .. } => {
            let value = raw.and_then(|source| ssh_value(source, field, kind));
            let attention = attention_value.is_some_and(|attention| value == Some(attention));
            (value.map(str::to_string), if attention { Outcome::Attention } else { Outcome::Informational })
        }
        Evaluation::Account { index, accepted, .. } => {
            let values = raw.and_then(|value| counts(value, 2));
            (values.as_ref().map(|values| values[index].to_string()), Outcome::baseline(values.as_ref().is_some_and(|values| values[index] == accepted)))
        }
        Evaluation::EmptyPasswords => {
            let values = raw.and_then(|value| counts(value, 1));
            (values.as_ref().map(|values| format!("{} local shadow entries with an empty password field. No hashes or account names were collected.", values[0])), Outcome::baseline(values.is_some_and(|values| values[0] == 0)))
        }
        Evaluation::Listeners => (raw.and_then(listeners), Outcome::Informational),
        Evaluation::Firewall => (raw.and_then(|value| firewall(key, value)), Outcome::Informational),
        Evaluation::Mount => (raw.filter(|value| {
            let parts: Vec<_> = value.split_whitespace().take(3).collect();
            parts.len() == 2 && parts[0].starts_with('/') && !parts[1].is_empty()
        }).map(str::to_string), Outcome::Informational),
        Evaluation::AptPolicy => (raw.map(|value| if value.is_empty() { "No values returned for APT periodic list updates or unattended upgrades. Other update mechanisms were not checked." } else { value }).map(str::to_string), Outcome::Informational),
        Evaluation::PackageHealth => (raw.map(|value| if value.is_empty() { "No incomplete-package problems reported by dpkg --audit. This is not a patch-freshness check." } else { value }).map(str::to_string), Outcome::baseline(raw.is_some_and(str::is_empty))),
        Evaluation::Reboot => {
            let value = raw.filter(|value| matches!(*value, "present" | "absent"));
            (value.map(str::to_string), if value == Some("present") { Outcome::Attention } else { Outcome::Informational })
        }
        Evaluation::Journal | Evaluation::SshService => (raw.and_then(loaded_service).map(str::to_string), Outcome::Informational),
    };
    Observation {
        fact_key: key,
        value,
        outcome,
    }
}
