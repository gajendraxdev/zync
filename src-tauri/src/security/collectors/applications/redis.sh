# Fixed named-file projection. No Redis connection, password, ACL user or hash leaves
# the host. Authentication declarations are counted without parsing their contents.
redis_projection() {
    if [ "$collection_mode" != sudo ]; then
        if [ -r /etc ] && [ -x /etc ]; then
            [ -e /etc/redis ] || [ -L /etc/redis ] || return 66
        fi
        if [ -r /etc/redis ] && [ -x /etc/redis ]; then
            [ -e /etc/redis/redis.conf ] || [ -L /etc/redis/redis.conf ] || return 66
        fi
    fi
    {
        protected head -c 524289 -- /etc/redis/redis.conf
        redis_read_status=$?
        printf '\nZYNC-FILE-%s-status:%s\n' "$sudo_nonce" "$redis_read_status"
    # Waiting for approved sudo authentication is governed by the overall run
    # deadline; only the protected producer has a four-second execution deadline.
    } | awk -v nonce="$sudo_nonce" '
    function ipv4(address, parts, count, i) {
        count=split(address, parts, /\./); if (count != 4) return -1
        for (i=1; i<=4; i++) if (parts[i] !~ /^[0-9]+$/ || length(parts[i]) > 3 || parts[i]+0 > 255) return -1
        return parts[1]+0 == 127 ? 1 : 0
    }
    BEGIN { marker="ZYNC-FILE-" nonce "-status:" }
    index($0, marker) == 1 {
        status=substr($0, length(marker)+1)
        if (complete || status !~ /^[0-9]+$/ || length(status) > 3 || status+0 > 255) bad=1
        complete=1; next
    }
    complete { bad=1; next }
    { bytes += length($0) + 1; if (bytes > 524289 || NR > 100000) { bad=1; exit 65 } }
    /^[ \t]*#/ { next }
    {
        if ($1 == "include") includes++
        if ($1 == "protected-mode") {
            if (NF == 2 && $2 == "yes") protectedYes++
            else if (NF == 2 && $2 == "no") protectedNo++
            else protectedUnknown++
        }
        if ($1 == "bind") {
            if (NF < 2) bindUnknown++
            for (i=2; i<=NF; i++) {
                address=$i; sub(/^-/, "", address)
                if (address == "::1") bindLoopback++
                else if (address == "::") bindOther++
                else {
                    kind=ipv4(address)
                    if (kind == 1) bindLoopback++
                    else if (kind == 0) bindOther++
                    else bindUnknown++
                }
            }
        }
        if ($1 == "port" || $1 == "tls-port") {
            valid=(NF == 2 && $2 ~ /^[0-9]+$/ && length($2) <= 5 && $2+0 <= 65535)
            if ($1 == "port") { if (!valid) plainUnknown++; else if ($2+0 == 0) plainDisabled++; else plainEnabled++ }
            else { if (!valid) tlsUnknown++; else if ($2+0 == 0) tlsDisabled++; else tlsEnabled++ }
        }
        if ($1 == "aclfile") aclFile++
        if ($1 == "user") aclUsers++
        if ($1 == "requirepass") legacyPassword++
    }
    END {
        if (bad || !complete) exit 65
        if (status+0 != 0) exit status+0
        printf "version=1\nincludes=%d\nprotectedYes=%d\nprotectedNo=%d\nprotectedUnknown=%d\nbindLoopback=%d\nbindOther=%d\nbindUnknown=%d\nplainEnabled=%d\nplainDisabled=%d\nplainUnknown=%d\ntlsEnabled=%d\ntlsDisabled=%d\ntlsUnknown=%d\naclFile=%d\naclUsers=%d\nlegacyPassword=%d\n", includes, protectedYes, protectedNo, protectedUnknown, bindLoopback, bindOther, bindUnknown, plainEnabled, plainDisabled, plainUnknown, tlsEnabled, tlsDisabled, tlsUnknown, aclFile, aclUsers, legacyPassword
    }'
}
collect redis_service /usr/bin/timeout --signal=TERM --kill-after=1s 4s systemctl show redis-server.service --property=LoadState,ActiveState,User,NoNewPrivileges,PrivateTmp,ProtectSystem,ProtectHome,RestrictSUIDSGID,UMask --no-pager
collect redis_config_meta protected stat -Lc '%f %u %g' -- /etc/redis/redis.conf
collect redis_config redis_projection
