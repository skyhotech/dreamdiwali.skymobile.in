#!/usr/bin/env bash
# Memory ceilings and out-of-memory priorities for the 1 GB VPS. If memory
# runs out, the kernel kills the app first (systemd restarts it in 3 s) and
# MySQL last, so data stays safe. Run once with sudo; safe to re-run.
set -euo pipefail
limit() {  # unit, MemoryMax, OOMScoreAdjust
  install -d "/etc/systemd/system/$1.d"
  printf '[Service]\nMemoryMax=%s\nOOMScoreAdjust=%s\nRestart=always\nRestartSec=3\n' "$2" "$3" \
    > "/etc/systemd/system/$1.d/10-limits.conf"
}
limit caddy.service 150M -200
limit redis-server.service 64M -300
limit mysql.service 400M -800
install -d /etc/systemd/system/skymirror.service.d
printf '[Service]\nOOMScoreAdjust=300\n' > /etc/systemd/system/skymirror.service.d/10-oom.conf
systemctl daemon-reload
systemctl restart redis-server caddy
