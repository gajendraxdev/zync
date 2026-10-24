# Fixed read-only collectors. No downloaded code, filesystem traversal or temporary files.
# Run under an empty environment, a fixed system PATH and GNU timeout's process group.
set -f
umask 077
[ "$(uname -s)" = Linux ] || exit 65
[ "$1" = hardening ] || exit 64
printf 'ZYNC_FACTS_V2\000%s\000' "$2"
collector_uid=$(id -u) || exit 69
case "$collector_uid" in ''|*[!0-9]*) exit 69;; esac
collection_mode=${3:-user}
sudo_nonce=$2
exec 3>&2
case "$collection_mode" in user|sudo) ;; *) exit 65;; esac

# NUL-delimited output and explicit command status distinguish denied/missing from empty.
collect() {
    label=$1
    shift
    printf '%s\000' "$label"
    case "$label" in hardlinks|symlinks|ssh_defaults|shadow_empty|nft|iptables|ip6tables)
        printf 'ZYNC-ACCESS-%s-begin-%s:' "$sudo_nonce" "$label" >&3
        "$@" 2>&3
        result=$?
        printf 'ZYNC-ACCESS-%s-end-%s:' "$sudo_nonce" "$label" >&3
        ;;
    *)
        "$@" 2>/dev/null
        result=$?
        ;;
    esac
    printf '\000%s\000' "$result"
}
# Only fixed callers may request elevation. Sudo owns stdin and emits a nonce-bound
# prompt on stderr; the native owner sends a password only after that exact prompt.
# No PTY/echo, password shell variable, root shell or evaluated config text is used.
protected() {
    protected_tool=$(command -v "$1") || return 127
    shift
    if [ "$collection_mode" = sudo ] && [ "$collector_uid" != 0 ]; then
        command -v sudo >/dev/null 2>&1 || return 127
        sudo -S -u root -p "ZYNC-SUDO-$sudo_nonce-$label:" -- /usr/bin/timeout --signal=TERM --kill-after=1s 4s "$protected_tool" "$@" 2>&3
        sudo_status=$?
        # Same stderr descriptor preserves ordering before any following password challenge.
        printf 'ZYNC-SUDO-%s-end-%s-%s:' "$sudo_nonce" "$label" "$sudo_status" >&3
        return "$sudo_status"
    else
        /usr/bin/timeout --signal=TERM --kill-after=1s 4s "$protected_tool" "$@" </dev/null
    fi
}
# Policy collection does not need private-host-key validation. Probe parsing-only
# support with an empty config; only the real read may use the approved sudo path.
# Older OpenSSH retains -T. Never treat its ambiguous host-key error as access denial.
ssh_defaults() {
    ssh_tool=$(command -v sshd) || return 127
    /usr/bin/timeout --signal=TERM --kill-after=1s 4s "$ssh_tool" -G -f /dev/null >/dev/null 2>/dev/null
    ssh_probe_status=$?
    case "$ssh_probe_status" in
        0) protected sshd -G -e ;;
        124|126|127|137) return "$ssh_probe_status" ;;
        *) protected sshd -T -e ;;
    esac
}
# Report counts only: passwords, hashes, usernames and GECOS never leave the host.
account_counts() {
    [ -r /etc/passwd ] || return 77
    awk -F: 'NF != 7 || $3 !~ /^[0-9]+$/ {bad=1} {total++; if ($3 == 0) root++; seen[$3]++} END {if (bad || !total) exit 65; for (uid in seen) if (seen[uid] > 1) duplicate++; printf "%d %d\n", root, duplicate}' /etc/passwd
}
shadow_counts() {
    if [ "$collection_mode" != sudo ] && [ ! -r /etc/shadow ]; then return 77; fi
    protected awk -F: 'NF != 9 {bad=1} {total++; if ($2 == "") empty++} END {if (bad || !total) exit 65; printf "%d\n", empty}' /etc/shadow
}
# Resolve only the local shadow group's numeric ID; never emit membership or use network NSS.
shadow_group() {
    [ -r /etc/group ] || return 77
    awk -F: '$1 == "shadow" {if (NF != 4 || $3 !~ /^[0-9]+$/) bad=1; gid=$3; found++} END {if (bad || found > 1) exit 65; if (found) print gid; else print "absent"}' /etc/group
}
reboot_state() {
    # This marker has meaning only on qualified dpkg distributions; no absence-to-safe inference.
    if [ -e /run/reboot-required ]; then printf 'present\n'; else printf 'absent\n'; fi
}
privilege() { printf '%s %s\n' "$collector_uid" "$collection_mode"; }
# Use one vendor identity file, with /etc precedence; never merge or source shell text.
os_identity() {
    if [ -e /etc/os-release ] || [ -L /etc/os-release ]; then
        sed -n '/^ID=/p; /^VERSION_ID=/p; /^ID_LIKE=/p' /etc/os-release
    elif [ -r /etc ] && [ -x /etc ]; then
        sed -n '/^ID=/p; /^VERSION_ID=/p; /^ID_LIKE=/p' /usr/lib/os-release
    else
        # An inaccessible parent cannot establish that the identity entry is absent.
        return 77
    fi
}
collect os os_identity
collect privilege privilege
collect aslr sysctl -n kernel.randomize_va_space
collect ptrace sysctl -n kernel.yama.ptrace_scope
collect kptr sysctl -n kernel.kptr_restrict
collect dmesg sysctl -n kernel.dmesg_restrict
collect hardlinks protected sysctl -n fs.protected_hardlinks
collect symlinks protected sysctl -n fs.protected_symlinks
collect bpf sysctl -n kernel.unprivileged_bpf_disabled
collect redirects sysctl -n net.ipv4.conf.all.accept_redirects
collect send_redirects sysctl -n net.ipv4.conf.all.send_redirects
collect source_route sysctl -n net.ipv4.conf.all.accept_source_route
collect rp_filter sysctl -n net.ipv4.conf.all.rp_filter
collect ipv6_redirects sysctl -n net.ipv6.conf.all.accept_redirects
collect dumps sysctl -n fs.suid_dumpable
collect passwd stat -Lc '%f %u %g' -- /etc/passwd
collect shadow stat -Lc '%f %u %g' -- /etc/shadow
collect shadow_group shadow_group
collect ssh_config stat -Lc '%f %u %g' -- /etc/ssh/sshd_config
collect ssh_defaults ssh_defaults
collect accounts account_counts
collect shadow_empty shadow_counts
collect listeners ss -H -lntu
collect nft protected nft -j -n -s -t list ruleset
collect iptables protected iptables-save
collect ip6tables protected ip6tables-save
collect tmp_mount findmnt --noheadings --raw --output TARGET,OPTIONS --target /tmp
collect shm_mount findmnt --noheadings --raw --output TARGET,OPTIONS --target /dev/shm
collect apt_policy apt-config shell Periodic APT::Periodic::Update-Package-Lists/i Upgrade APT::Periodic::Unattended-Upgrade/i
collect package_health dpkg --audit
collect reboot reboot_state
collect journal systemctl show systemd-journald.service --property=LoadState,ActiveState --no-pager
collect ssh_service systemctl show ssh.service sshd.service --property=Id,LoadState,ActiveState,NoNewPrivileges,ProtectSystem,PrivateTmp --no-pager
printf 'complete\000'
