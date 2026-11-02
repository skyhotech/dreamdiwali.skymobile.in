#!/usr/bin/env bash
# Runs on the VPS (as deployer) after GitHub Actions has uploaded the new code.
# MySQL data and uploads are never touched. A deploy with migrations takes a
# backup first, and stops before restarting if they fail.
set -euo pipefail
cd /opt/skymirror/backend
VENV=/opt/skymirror/venv
manage() { sudo -u skymirror --preserve-env=PATH bash -c 'set -a; . /etc/skymirror/.env; set +a; exec /opt/skymirror/venv/bin/python manage.py "$@"' _ "$@"; }

[ -x $VENV/bin/python ] || python3 -m venv $VENV
# Packages come from the workflow (the VPS cannot reach PyPI).
$VENV/bin/pip install -q --no-index -f /opt/skymirror/wheels setuptools wheel
$VENV/bin/pip install -q --no-index -f /opt/skymirror/wheels --no-build-isolation -r requirements.txt

if ! manage migrate --check >/dev/null 2>&1; then
  sudo /usr/local/sbin/skymirror-backup
  manage migrate --noinput
fi
manage collectstatic --noinput -v0
manage check --deploy --fail-level ERROR

sudo /usr/bin/systemctl restart skymirror
for i in $(seq 1 30); do
  if curl -fs -o /dev/null -H 'Host: 87.232.72.141' -H 'X-Forwarded-Proto: https' http://127.0.0.1:8000/api/mirrors/version/; then
    echo "Backend is up."
    exit 0
  fi
  sleep 1
done
echo "Backend did not come up; recent log:" >&2
sudo /usr/bin/journalctl -u skymirror -n 40 --no-pager >&2
exit 1
