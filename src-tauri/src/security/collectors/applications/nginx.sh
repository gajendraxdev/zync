# Named-file projection only. nginx -t/-T can open output files and reveal secrets.
# The parser counts only unambiguous lexical declarations; it does not resolve
# includes or inheritance, and never exports an original configuration line.
nginx_projection() {
    if [ "$collection_mode" != sudo ]; then
        if [ -r /etc ] && [ -x /etc ]; then
            [ -e /etc/nginx ] || [ -L /etc/nginx ] || return 66
        fi
        if [ -r /etc/nginx ] && [ -x /etc/nginx ]; then
            [ -e /etc/nginx/nginx.conf ] || [ -L /etc/nginx/nginx.conf ] || return 66
        fi
    fi
    {
        protected head -c 524289 -- /etc/nginx/nginx.conf
        nginx_read_status=$?
        printf '\nZYNC-FILE-%s-status:%s\n' "$sudo_nonce" "$nginx_read_status"
    # The protected producer's four-second execution limit starts after sudo
    # authentication. Its bounded consumer must wait under the overall run deadline.
    } | awk -v nonce="$sudo_nonce" '
    function append(character) {
        statement=statement character
        if (length(statement) > 16384) { bad=1; exit 65 }
    }
    function declaration(line, parts, count, i, old, modern, unknown) {
        sub(/^[ \t]+/, "", line); sub(/[ \t]+$/, "", line)
        count=split(line, parts, /[ \t]+/)
        if (parts[1] == "include") includes++
        if (parts[1] == "server_tokens") {
            if (count == 2 && parts[2] == "off") tokensOff++
            else if (count == 2 && parts[2] ~ /^(on|build)$/) tokensExposed++
            else tokensUnknown++
        }
        if (parts[1] == "autoindex") {
            if (count == 2 && parts[2] == "on") autoindexOn++
            else if (count == 2 && parts[2] == "off") autoindexOff++
            else autoindexUnknown++
        }
        if (parts[1] == "ssl_protocols") {
            old=0; modern=0; unknown=0
            for (i=2; i<=count; i++) {
                if (parts[i] ~ /^(SSLv2|SSLv3|TLSv1|TLSv1.0|TLSv1.1)$/) old=1
                else if (parts[i] ~ /^(TLSv1.2|TLSv1.3)$/) modern=1
                else unknown=1
            }
            if (unknown || (!old && !modern)) tlsUnknown++
            else if (old) legacyTls++
            else modernTls++
        }
    }
    BEGIN { marker="ZYNC-FILE-" nonce "-status:"; quote=""; statement="" }
    index($0, marker) == 1 {
        status=substr($0, length(marker)+1)
        if (complete || status !~ /^[0-9]+$/ || length(status) > 3 || status+0 > 255) bad=1
        complete=1; next
    }
    complete { bad=1; next }
    { bytes += length($0) + 1; if (bytes > 524289 || NR > 100000) { bad=1; exit 65 } }
    {
        for (position=1; position<=length($0); position++) {
            character=substr($0, position, 1)
            if (escaped) { escaped=0; continue }
            if (character == "\\") { escaped=1; append("?"); continue }
            if (quote != "") { if (character == quote) quote=""; continue }
            if (character == "#") break
            if (character == "\"" || character == sprintf("%c",39)) { quote=character; append("?"); continue }
            if (character == ";") { declaration(statement); statement="" }
            else if (character == "{" || character == "}") statement=""
            else append(character)
        }
        statement=statement " "
        if (length(statement) > 16384) { bad=1; exit 65 }
    }
    END {
        if (bad || !complete || quote != "" || escaped || statement ~ /[^ \t\r]/) exit 65
        if (status+0 != 0) exit status+0
        printf "version=1\nincludes=%d\ntokensOff=%d\ntokensExposed=%d\ntokensUnknown=%d\nautoindexOn=%d\nautoindexOff=%d\nautoindexUnknown=%d\nlegacyTls=%d\nmodernTls=%d\ntlsUnknown=%d\n", includes, tokensOff, tokensExposed, tokensUnknown, autoindexOn, autoindexOff, autoindexUnknown, legacyTls, modernTls, tlsUnknown
    }'
}
collect nginx_service /usr/bin/timeout --signal=TERM --kill-after=1s 4s systemctl show nginx.service --property=LoadState,ActiveState,User,NoNewPrivileges,PrivateTmp,ProtectSystem,ProtectHome,RestrictSUIDSGID,UMask --no-pager
collect nginx_config_meta protected stat -Lc '%f %u %g' -- /etc/nginx/nginx.conf
collect nginx_dir_meta /usr/bin/timeout --signal=TERM --kill-after=1s 4s stat -Lc '%f %u %g' -- /etc/nginx
collect nginx_config nginx_projection
