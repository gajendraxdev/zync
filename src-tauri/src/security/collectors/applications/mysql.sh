# No database login, option-file credentials or effective SQL server-policy claims.
collect mysql_service /usr/bin/timeout --signal=TERM --kill-after=1s 4s systemctl show mysql.service --property=LoadState,ActiveState,User,NoNewPrivileges,PrivateTmp,ProtectSystem,ProtectHome,RestrictSUIDSGID,UMask --no-pager
