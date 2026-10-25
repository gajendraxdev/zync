# Host baseline; shared functions and OS/access records precede this fragment.
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
