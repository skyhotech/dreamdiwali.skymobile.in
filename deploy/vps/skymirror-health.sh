#!/usr/bin/env bash
# Installed as /usr/local/sbin/skymirror-health, run every 5 minutes by a timer.
# Restarts the API if it stops answering and logs low disk or memory.
code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' -H 'Host: 87.232.72.141' -H 'X-Forwarded-Proto: https' http://127.0.0.1:8000/api/mirrors/version/)
if [ "$code" != 200 ]; then
  echo "API unhealthy (HTTP $code); restarting"
  systemctl restart skymirror
fi
disk=$(df --output=pcent / | tail -1 | tr -dc 0-9)
[ "$disk" -ge 85 ] && echo "WARNING: disk ${disk}% full"
mem=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
[ "$mem" -le 80 ] && echo "WARNING: only ${mem} MB memory available"
exit 0
