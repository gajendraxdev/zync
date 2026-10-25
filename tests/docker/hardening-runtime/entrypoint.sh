#!/bin/bash
set -euo pipefail

# Passwords are generated fixture-only files mounted read-only by qualify.ts.
printf 'observer:%s\n' "$(cat /fixture/ssh-password)" | chpasswd
ssh-keygen -A
cat > /run/zync-fixture-sshd.conf <<'EOF'
Port 22
ListenAddress 0.0.0.0
HostKey /etc/ssh/ssh_host_ed25519_key
PasswordAuthentication yes
KbdInteractiveAuthentication no
PubkeyAuthentication no
PermitRootLogin no
AllowUsers observer
UsePAM no
AllowTcpForwarding local
PermitOpen 127.0.0.1:5432 127.0.0.1:6379 127.0.0.1:3306
X11Forwarding no
AllowAgentForwarding no
PrintMotd no
LogLevel ERROR
EOF

cp /fixture/mysql-init.sql /docker-entrypoint-initdb.d/observer.sql
chmod 0644 /docker-entrypoint-initdb.d/observer.sql
/usr/sbin/sshd -D -e -f /run/zync-fixture-sshd.conf &
ssh_pid=$!
/usr/local/bin/docker-entrypoint.sh mysqld --bind-address=127.0.0.1 --mysqlx=0 --skip-name-resolve --local-infile=OFF --innodb-buffer-pool-size=64M --performance-schema=OFF --max-connections=12 &
mysql_pid=$!
trap 'kill "$ssh_pid" "$mysql_pid" 2>/dev/null || true' EXIT TERM INT
wait -n "$ssh_pid" "$mysql_pid"
