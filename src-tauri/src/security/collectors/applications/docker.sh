# Use only the rootful default Unix socket; never read Docker contexts, CLI plugin
# metadata, credentials or remote endpoints. curl disables user config FIRST.
# A byte cap precedes jq, including on older curl versions without an in-flight
# max-filesize bound. Only a complete nonce-bound success tail and JSON body pass;
# POSIX pipeline last-status alone cannot turn a failed transfer into evidence.
docker_projection() {
    if [ "$collection_mode" != sudo ] && [ -r /var/run ] && [ -x /var/run ]; then
        [ -e /var/run/docker.sock ] || [ -L /var/run/docker.sock ] || return 66
    fi
    command -v curl >/dev/null 2>&1 || return 127
    command -v jq >/dev/null 2>&1 || return 127
    command -v head >/dev/null 2>&1 || return 127
    {
        protected curl --disable --silent --show-error --fail --max-time 3 --max-filesize 524288 --noproxy '*' --proto '=http' --unix-socket /var/run/docker.sock --request GET http://localhost/info
        docker_curl_status=$?
        printf '\nZYNC-CURL-%s-status:%s\n' "$sudo_nonce" "$docker_curl_status"
    # Consumers wait for the bounded producer, including approved sudo entry;
    # the overall collector deadline bounds their wait and processing.
    } | head -c 524289 |
        jq --raw-input --slurp --compact-output --arg nonce "$sudo_nonce" '
        if utf8bytelength > 524288 then ("Local Engine response exceeded its limit" | halt_error(65))
        else split("\nZYNC-CURL-" + $nonce + "-status:") as $parts
        | if ($parts | length) != 2 or ($parts[1] | test("^[0-9]{1,3}\n$") | not)
          then ("Local Engine response was incomplete" | halt_error(65))
          else ($parts[1] | tonumber) as $status
          | if $status > 255 then ("Local Engine response status was invalid" | halt_error(65))
            elif $status != 0 then ("Local Engine transfer failed" | halt_error($status))
            else (try ($parts[0] | fromjson) catch null) as $body
            | if ($body | type) == "object"
              then $body | {SecurityOptions,LoggingDriver,LiveRestoreEnabled,OSType}
              else ("Local Engine response was invalid" | halt_error(65)) end
            end
          end
        end'
}
collect docker_service /usr/bin/timeout --signal=TERM --kill-after=1s 4s systemctl show docker.service --property=LoadState,ActiveState,User,NoNewPrivileges,PrivateTmp,ProtectSystem,ProtectHome,RestrictSUIDSGID,UMask --no-pager
collect docker_socket /usr/bin/timeout --signal=TERM --kill-after=1s 4s stat -Lc '%f %u %g' -- /var/run/docker.sock
collect docker_info docker_projection
