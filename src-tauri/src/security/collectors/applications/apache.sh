# Fixed Debian-layout service unit only; no configuration dump or HTTP request.
collect apache_service /usr/bin/timeout --signal=TERM --kill-after=1s 4s systemctl show apache2.service --property=LoadState,ActiveState,User,NoNewPrivileges,PrivateTmp,ProtectSystem,ProtectHome,RestrictSUIDSGID,UMask --no-pager
