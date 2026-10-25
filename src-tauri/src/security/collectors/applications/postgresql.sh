# This named umbrella unit does not establish protections of per-cluster workers.
collect postgresql_service /usr/bin/timeout --signal=TERM --kill-after=1s 4s systemctl show postgresql.service --property=LoadState,ActiveState,User,NoNewPrivileges,PrivateTmp,ProtectSystem,ProtectHome,RestrictSUIDSGID,UMask --no-pager
