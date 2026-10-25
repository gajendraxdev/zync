# No Jenkins HTTP request, XML configuration, credentials or build data is read.
collect jenkins_service /usr/bin/timeout --signal=TERM --kill-after=1s 4s systemctl show jenkins.service --property=LoadState,ActiveState,User,NoNewPrivileges,PrivateTmp,ProtectSystem,ProtectHome,RestrictSUIDSGID,UMask --no-pager
