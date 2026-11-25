#!/usr/bin/env bash
# Run as root on each web server AFTER setup-web.sh:  sudo ./deploy/setup-ssh.sh
set -euo pipefail

ln -sf /opt/ea-stocks/index.js /usr/local/bin/ea-stocks
chmod +x /opt/ea-stocks/index.js

# Restricted login user. It can only run the screener (ForceCommand below).
id -u stocks >/dev/null 2>&1 || useradd --create-home --shell /bin/bash stocks
if [ -n "${STOCKS_PASSWORD:-}" ]; then
  echo "stocks:${STOCKS_PASSWORD}" | chpasswd
else
  passwd stocks
fi

CONF=/etc/ssh/sshd_config
cp -n "$CONF" "$CONF.bak-ea-stocks"
if ! grep -q '^Match User stocks' "$CONF"; then
  cat deploy/sshd_config.snippet >> "$CONF"   # Match blocks must be at the end of the file
fi
sshd -t                                         # refuse to reload a broken config
systemctl reload ssh 2>/dev/null || systemctl reload sshd
echo "Test from another machine:  ssh stocks@<server-ip>"
