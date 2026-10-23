#!/bin/bash
# Installs the pull-based updater. Needs REPO_URL (with a read-only deploy token) and BRANCH.
set -euo pipefail
install -d -m 700 /root/lesson-studio
printf '%s' "$REPO_URL" > /root/lesson-studio/repo-url
printf '%s' "$BRANCH" > /root/lesson-studio/branch
chmod 600 /root/lesson-studio/repo-url
cat > /etc/systemd/system/lesson-studio-update.service <<'UNIT'
[Unit]
Description=Pull and rebuild Lesson Studio when its branch changes
After=docker.service network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash /opt/lesson-studio/deploy/update.sh
UNIT
cat > /etc/systemd/system/lesson-studio-update.timer <<'UNIT'
[Unit]
Description=Check for Lesson Studio updates every two minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now lesson-studio-update.timer
