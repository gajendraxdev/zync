# Current standard-file policy preview, not the already-loaded live daemon policy.
# Match inputs come only from the preserved original SSH_CONNECTION and actual user.
ssh_preview_context() {
    ssh_preview_ready=
    case "${ZYNC_SSH_CONNECTION:-}" in ''|*[!0-9a-fA-F:.\ ]*) return 65;; esac
    set -- $ZYNC_SSH_CONNECTION
    [ "$#" = 4 ] || return 65
    ssh_preview_addr=$1; ssh_preview_client_port=$2; ssh_preview_local=$3; ssh_preview_port=$4
    case "$ssh_preview_addr:$ssh_preview_local" in *[!0-9a-fA-F:.]*) return 65;; esac
    for ssh_preview_address in "$ssh_preview_addr" "$ssh_preview_local"; do
        [ "${#ssh_preview_address}" -le 45 ] || return 65
        case "$ssh_preview_address" in *.*|*:*) :;; *) return 65;; esac
    done
    for ssh_preview_number in "$ssh_preview_client_port" "$ssh_preview_port"; do
        case "$ssh_preview_number" in ''|*[!0-9]*) return 65;; esac
        [ "${#ssh_preview_number}" -le 5 ] && [ "$ssh_preview_number" -ge 1 ] && [ "$ssh_preview_number" -le 65535 ] || return 65
    done
    ssh_preview_user=$(/usr/bin/timeout --signal=TERM --kill-after=1s 4s id -un) || return $?
    case "$ssh_preview_user" in ''|*[!A-Za-z0-9_.@\$-]*) return 65;; esac
    [ "${#ssh_preview_user}" -le 64 ] || return 65
    command -v sha256sum >/dev/null 2>&1 || return 127
    ssh_preview_user_hash=$(printf '%s' "$ssh_preview_user" | sha256sum) || return $?
    ssh_preview_user_hash=${ssh_preview_user_hash%% *}
    case "$ssh_preview_user_hash" in *[!0-9a-f]*) return 65;; esac
    [ "${#ssh_preview_user_hash}" = 64 ] || return 65
    ssh_preview_ready=1
    printf 'schema=1\nclient=%s\nclientPort=%s\nlocal=%s\nlocalPort=%s\nuserHash=%s\n' "$ssh_preview_addr" "$ssh_preview_client_port" "$ssh_preview_local" "$ssh_preview_port" "$ssh_preview_user_hash"
}

ssh_preview_probe() {
    ssh_preview_mode=
    [ "${ssh_preview_ready:-}" = 1 ] || return 66
    ssh_preview_tool=$(command -v sshd) || return 127
    /usr/bin/timeout --signal=TERM --kill-after=1s 4s "$ssh_preview_tool" -G -T -f /dev/null >/dev/null 2>/dev/null
    ssh_preview_probe_status=$?
    case "$ssh_preview_probe_status" in
        0) ssh_preview_mode=G;;
        124|126|127|137) return "$ssh_preview_probe_status";;
        *) ssh_preview_mode=T;;
    esac
    printf 'mode=%s\n' "$ssh_preview_mode"
}

ssh_preview_read() {
    ssh_preview_projection=$1; shift
    # OpenSSH 9.x accepts -C only with -T; combining -G -T still skips host-key loading.
    # Older versions without -G use -T and may need elevated access to validate host keys.
    case "$ssh_preview_mode" in
        G) set -- -G -T -e -f /etc/ssh/sshd_config "$@";;
        T) set -- -T -e -f /etc/ssh/sshd_config "$@";;
        *) return 65;;
    esac
    {
        protected "$ssh_preview_tool" "$@"
        ssh_preview_read_status=$?
        printf '\nZYNC-SSH-PREVIEW-%s-%s-status:%s\n' "$sudo_nonce" "$label" "$ssh_preview_read_status"
    } | head -c 524289 | awk -v nonce="$sudo_nonce" -v key="$label" -v projection="$ssh_preview_projection" '
    BEGIN { marker="ZYNC-SSH-PREVIEW-" nonce "-" key "-status:" }
    index($0, marker) == 1 {
        result=substr($0,length(marker)+1)
        if (complete || result !~ /^[0-9]+$/ || length(result)>3 || result+0>255) bad=1
        complete=1; next
    }
    complete {bad=1; next}
    {bytes+=length($0)+1; if (bytes>524289 || NR>100000) {bad=1; exit 65}}
    $1 == "usedns" || (projection == "policy" && ($1 == "permitrootlogin" || $1 == "passwordauthentication" || $1 == "pubkeyauthentication" || $1 == "permitemptypasswords" || $1 == "hostbasedauthentication" || $1 == "x11forwarding" || $1 == "maxauthtries" || $1 == "strictmodes")) {
        if (length($0)>256 || ++counts[$1]>1) {bad=1; exit 65}
        rows[++count]=$0
    }
    END {
        if (bad || !complete) exit 65
        if (result+0 != 0) exit result+0
        for (i=1;i<=count;i++) print rows[i]
    }'
}

ssh_preview_base() {
    ssh_preview_dns_ready=
    [ "${ssh_preview_ready:-}" = 1 ] && [ -n "${ssh_preview_mode:-}" ] || return 66
    # Resolve global UseDNS using only known Match inputs; do not guess a source hostname.
    # Some versions require LocalPort/Address context even when projecting a global directive.
    ssh_preview_known_spec="user=$ssh_preview_user,addr=$ssh_preview_addr,laddr=$ssh_preview_local,lport=$ssh_preview_port"
    ssh_preview_base_value=$(ssh_preview_read base -C "$ssh_preview_known_spec")
    ssh_preview_base_status=$?
    [ "$ssh_preview_base_status" = 0 ] || return "$ssh_preview_base_status"
    [ "$ssh_preview_base_value" = 'usedns no' ] && ssh_preview_dns_ready=1
    printf '%s\n' "$ssh_preview_base_value"
}

ssh_preview_policy() {
    [ "${ssh_preview_ready:-}" = 1 ] && [ "${ssh_preview_dns_ready:-}" = 1 ] || return 66
    # UseDNS=no makes numeric Host input appropriate; no reverse-DNS assumption is made.
    ssh_preview_spec="user=$ssh_preview_user,addr=$ssh_preview_addr,host=$ssh_preview_addr,laddr=$ssh_preview_local,lport=$ssh_preview_port"
    ssh_preview_read policy -C "$ssh_preview_spec"
}

collect ssh_preview_context ssh_preview_context
collect ssh_preview_probe ssh_preview_probe
collect ssh_preview_base ssh_preview_base
collect ssh_preview_policy ssh_preview_policy
