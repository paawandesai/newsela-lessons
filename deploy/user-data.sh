#!/bin/bash
# First-boot script for the Lightsail instance. deploy.py fills in the
# __PLACEHOLDERS__ and passes this as user data; it runs once, as root.
mkdir -p /var/log/lesson-studio
echo "boot $(date -u)" > /var/log/lesson-studio/status.txt
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
LOG=/var/log/lesson-studio/setup.log
exec > "$LOG" 2>&1

# While setting up (and if setup fails), serve the setup log on port 80 so progress
# can be checked over HTTP without SSH. The log holds package output, never secrets.
serve_log() { (cd /var/log/lesson-studio && setsid nohup python3 -m http.server 80 </dev/null >/dev/null 2>&1 &) ; }
stop_log() { pkill -f "http.server 80" || true; }
trap 'echo "SETUP FAILED at line $LINENO"; stop_log; serve_log' ERR
serve_log

SITE_HOST="__SITE_HOST__"
REPO_URL="__REPO_URL__"
BRANCH="__BRANCH__"

# 2 GB of swap so the Next.js build fits comfortably in 4 GB of RAM.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt-get update
apt-get install -y ca-certificates curl git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

git clone --branch "$BRANCH" --depth 1 "$REPO_URL" /opt/lesson-studio
cd /opt/lesson-studio
# The clone URL holds a read-only deploy token; don't leave it in git config.
git remote set-url origin "$(echo "$REPO_URL" | sed -E 's#//[^@]+@#//#')"

cat > .env <<'ENV'
__ENV_FILE__
ENV
chmod 600 .env

docker compose build
stop_log
docker compose up -d
docker compose run --rm migrate pnpm --filter @nl/db seed
# Later pushes to the branch are picked up within a few minutes.
REPO_URL="$REPO_URL" BRANCH="$BRANCH" bash deploy/install-updater.sh
# This script carried the secrets as user data; remove the copy on disk now that .env holds them.
shred -u /root/lesson-studio/setup.sh 2>/dev/null || true
echo "lesson-studio: ready at https://$SITE_HOST"
