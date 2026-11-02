#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu VPS, run as root from a checkout of this
# repo. Safe to re-run: it never replaces an existing .env or database.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
apt-get update -q
apt-get install -y -q python3-venv python3-dev build-essential pkg-config rsync curl \
  default-libmysqlclient-dev mysql-server redis-server caddy

id skymirror >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin skymirror
id deployer >/dev/null 2>&1 || useradd -m -s /bin/bash deployer
install -d -o deployer -g deployer /opt/skymirror /opt/skymirror/backend /opt/skymirror/web /opt/skymirror/public
install -d -o skymirror -g skymirror /var/lib/skymirror /var/lib/skymirror/media /var/log/skymirror
install -d -m 700 /etc/skymirror /var/backups/skymirror /home/deployer/.ssh
chown deployer:deployer /home/deployer/.ssh

if [ ! -f /etc/skymirror/.env ]; then
  DB=$(openssl rand -hex 24)
  mysql -e "CREATE DATABASE IF NOT EXISTS skymirror CHARACTER SET utf8mb4;
    CREATE USER IF NOT EXISTS 'skymirror'@'127.0.0.1' IDENTIFIED BY '$DB';
    GRANT ALL ON skymirror.* TO 'skymirror'@'127.0.0.1';"
  umask 077
  cat > /etc/skymirror/.env <<ENV
DJANGO_SECRET_KEY=$(openssl rand -base64 48 | tr -d '\n/+=')
DJANGO_DEBUG=0
DJANGO_ALLOWED_HOSTS=dreamdiwali.skymobile.in
CORS_ALLOWED_ORIGINS=https://dreamdiwali.skymobile.in
CSRF_TRUSTED_ORIGINS=https://dreamdiwali.skymobile.in
DJANGO_SSL_REDIRECT=0
TRUSTED_PROXIES=1
REDIS_URL=redis://127.0.0.1:6379/0
MEDIA_ROOT=/var/lib/skymirror/media
STUDIO_URL=https://dreamdiwali.skymobile.in
MYSQL_DATABASE=skymirror
MYSQL_USER=skymirror
MYSQL_PASSWORD=$DB
MYSQL_HOST=127.0.0.1
ENV
  chgrp skymirror /etc/skymirror/.env; chmod 640 /etc/skymirror/.env
  chmod 750 /etc/skymirror; chgrp skymirror /etc/skymirror
fi

install -m 755 "$HERE/skymirror-manage" /usr/local/bin/skymirror-manage
install -m 700 "$HERE/skymirror-backup.sh" /usr/local/sbin/skymirror-backup
install -m 644 "$HERE/skymirror.service" /etc/systemd/system/skymirror.service
install -m 644 "$HERE/Caddyfile" /etc/caddy/Caddyfile
echo '30 2 * * * root /usr/local/sbin/skymirror-backup' > /etc/cron.d/skymirror-backup
cat > /etc/sudoers.d/skymirror-deployer <<'SUDO'
deployer ALL=(skymirror) NOPASSWD:SETENV: ALL
deployer ALL=(root) NOPASSWD: /usr/bin/systemctl restart skymirror, /usr/bin/journalctl -u skymirror *, /usr/local/sbin/skymirror-backup
SUDO
chmod 440 /etc/sudoers.d/skymirror-deployer
install -d -m 755 /var/log/caddy; chown caddy:caddy /var/log/caddy
systemctl daemon-reload
systemctl enable skymirror
systemctl reload-or-restart caddy
echo "Done. Add the deploy public key to /home/deployer/.ssh/authorized_keys."
