# Additional fixed host observations. Only aggregate counts and named metadata leave the host.
ext_lsm() {
    # Read only active framework names; do not let an unelevated stat preflight block approved access.
    protected head -c 4097 -- /sys/kernel/security/lsm
}
ext_shadow_group() {
    [ -e /etc/group ] || [ -L /etc/group ] || return 66
    [ -r /etc/group ] || return 77
    /usr/bin/timeout --signal=TERM --kill-after=1s 4s awk -F: '
        length($0) > 16384 || NR > 100000 { bad=1; exit 65 }
        $1 == "shadow" { if (NF != 4 || $3 !~ /^[0-9]+$/) bad=1; gid=$3; found++ }
        END { if (bad || found > 1) exit 65; if (found) print gid; else print "absent" }
    ' /etc/group
}
ext_account_counts() {
    [ -e /etc/passwd ] || [ -L /etc/passwd ] || return 66
    [ -r /etc/passwd ] || return 77
    /usr/bin/timeout --signal=TERM --kill-after=1s 4s awk -F: '
        length($0) > 16384 || NR > 100000 { bad=1; exit 65 }
        NF != 7 || $1 == "" || length($1) > 256 || $3 !~ /^[0-9]+$/ || length($3) > 10 || $3+0 > 4294967295 || $4 !~ /^[0-9]+$/ || length($4) > 10 || $4+0 > 4294967295 { bad=1 }
        { total++; names[$1]++; if ($2 != "x" && $2 !~ /^[!*]/) nonshadow++ }
        END { if (bad || !total) exit 65; for (name in names) if (names[name] > 1) duplicate++; printf "%d %d\n", duplicate, nonshadow }
    ' /etc/passwd
}
ext_group_counts() {
    [ -e /etc/group ] || [ -L /etc/group ] || return 66
    [ -r /etc/group ] || return 77
    /usr/bin/timeout --signal=TERM --kill-after=1s 4s awk -F: '
        length($0) > 16384 || NR > 100000 { bad=1; exit 65 }
        NF != 4 || $1 == "" || length($1) > 256 || $3 !~ /^[0-9]+$/ || length($3) > 10 || $3+0 > 4294967295 { bad=1 }
        { total++; names[$1]++; gids[$3+0]++ }
        END { if (bad || !total) exit 65; for (name in names) if (names[name] > 1) duplicate_name++; for (gid in gids) if (gids[gid] > 1) duplicate_gid++; printf "%d %d\n", duplicate_name, duplicate_gid }
    ' /etc/group
}
ext_apparmor() {
    protected awk '
        length($0) > 16384 || NR > 100000 { bad=1; exit 65 }
        { total++; if ($0 ~ / \(enforce\)$/) enforce++; else if ($0 ~ / \(complain\)$/) complain++; else if ($0 ~ / \([a-z-]+\)$/) other++; else bad=1 }
        END { if (bad) exit 65; printf "%d %d %d %d\n", total, enforce, complain, other }
    ' /sys/kernel/security/apparmor/profiles
}
collect ext_fifos /usr/bin/timeout --signal=TERM --kill-after=1s 4s sysctl -n fs.protected_fifos
collect ext_regular /usr/bin/timeout --signal=TERM --kill-after=1s 4s sysctl -n fs.protected_regular
collect ext_perf /usr/bin/timeout --signal=TERM --kill-after=1s 4s sysctl -n kernel.perf_event_paranoid
collect ext_kexec /usr/bin/timeout --signal=TERM --kill-after=1s 4s sysctl -n kernel.kexec_load_disabled
collect ext_modules /usr/bin/timeout --signal=TERM --kill-after=1s 4s sysctl -n kernel.modules_disabled
collect ext_sysrq /usr/bin/timeout --signal=TERM --kill-after=1s 4s sysctl -n kernel.sysrq
collect ext_uring /usr/bin/timeout --signal=TERM --kill-after=1s 4s sysctl -n kernel.io_uring_disabled
collect ext_syncookies /usr/bin/timeout --signal=TERM --kill-after=1s 4s sysctl -n net.ipv4.tcp_syncookies
collect ext_broadcast_icmp /usr/bin/timeout --signal=TERM --kill-after=1s 4s sysctl -n net.ipv4.icmp_echo_ignore_broadcasts
collect ext_bogus_icmp /usr/bin/timeout --signal=TERM --kill-after=1s 4s sysctl -n net.ipv4.icmp_ignore_bogus_error_responses
collect ext_ipv4_forward /usr/bin/timeout --signal=TERM --kill-after=1s 4s sysctl -n net.ipv4.ip_forward
collect ext_ipv6_forward /usr/bin/timeout --signal=TERM --kill-after=1s 4s sysctl -n net.ipv6.conf.all.forwarding
collect ext_group_file /usr/bin/timeout --signal=TERM --kill-after=1s 4s stat -Lc '%f %u %g' -- /etc/group
collect ext_gshadow_file /usr/bin/timeout --signal=TERM --kill-after=1s 4s stat -Lc '%f %u %g' -- /etc/gshadow
collect ext_sudoers_file /usr/bin/timeout --signal=TERM --kill-after=1s 4s stat -Lc '%f %u %g' -- /etc/sudoers
collect ext_crontab_file /usr/bin/timeout --signal=TERM --kill-after=1s 4s stat -Lc '%f %u %g' -- /etc/crontab
collect ext_shadow_group ext_shadow_group
collect ext_account_counts ext_account_counts
collect ext_group_counts ext_group_counts
collect ext_lsm ext_lsm
collect ext_selinux /usr/bin/timeout --signal=TERM --kill-after=1s 4s getenforce
collect ext_apparmor ext_apparmor
collect ext_audit protected auditctl -s
collect ext_time_sync /usr/bin/timeout --signal=TERM --kill-after=1s 4s timedatectl show --property=NTPSynchronized --no-pager
