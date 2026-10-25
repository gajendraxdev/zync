#!/bin/sh
# Only disposable fixture users and files are changed inside this owned test container.
set -eu
[ -n "${QUALIFIER_AUTHORIZED_KEY:-}" ] && [ -n "${QUALIFIER_PASSWORD:-}" ] || exit 64
case "$QUALIFIER_PASSWORD" in *[!0-9a-f]*|'') exit 65;; esac
for account in ordinary admin denied root; do
    home=$(getent passwd "$account" | cut -d: -f6)
    install -d -m 0700 -o "$account" -g "$account" "$home/.ssh"
    printf '%s\n' "$QUALIFIER_AUTHORIZED_KEY" > "$home/.ssh/authorized_keys"
    chown "$account:$account" "$home/.ssh/authorized_keys"
    chmod 0600 "$home/.ssh/authorized_keys"
    printf '%s:%s\n' "$account" "$QUALIFIER_PASSWORD" | chpasswd
done
unset QUALIFIER_PASSWORD QUALIFIER_AUTHORIZED_KEY
ssh-keygen -A >/dev/null 2>&1
if [ "${QUALIFIER_CUSTOM_CONFIG:-0}" = 1 ]; then
    cp /etc/ssh/sshd_config /run/zync-qualifier-sshd_config
    exec /usr/sbin/sshd -D -e -f /run/zync-qualifier-sshd_config -o PasswordAuthentication=no
fi
exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config
