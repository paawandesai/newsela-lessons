#!/bin/bash
# Pulls the deployed branch and rebuilds when it changed. Run every two minutes
# by lesson-studio-update.timer; a lock stops runs from overlapping.
set -euo pipefail
exec 9>/run/lesson-studio-update.lock
flock -n 9 || exit 0
cd /opt/lesson-studio
git fetch -q "$(cat /root/lesson-studio/repo-url)" "$(cat /root/lesson-studio/branch)"
[ "$(git rev-parse HEAD)" = "$(git rev-parse FETCH_HEAD)" ] && exit 0
echo "updating $(git rev-parse --short HEAD) -> $(git rev-parse --short FETCH_HEAD)"
git reset -q --hard FETCH_HEAD
docker compose build
docker compose up -d
