#!/usr/bin/env bash
# Run as root on Web01 and Web02, from the project directory:  sudo ./deploy/setup-web.sh
set -euo pipefail

APP_DIR=/opt/ea-stocks
SVC_USER=eastocks
CACHE_DIR=/var/cache/ea-stocks

command -v node >/dev/null || { echo "Node.js 18+ is required (e.g. apt install -y nodejs)"; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ] || { echo "Node 18+ required"; exit 1; }

# 1. Unprivileged service account (no login shell)
id -u "$SVC_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$SVC_USER"

# 2. Application files (owned by root, read-only for the service)
mkdir -p "$APP_DIR"
cp -r server.js index.js fetch-data.js package.json lib "$APP_DIR/"
chmod 755 "$APP_DIR/index.js" "$APP_DIR/server.js" "$APP_DIR/fetch-data.js"

# 3. Cache directory (writable only by the fetcher). Spec path /var/cache/ea-stocks.json is a symlink into it.
install -d -m 755 -o "$SVC_USER" -g "$SVC_USER" "$CACHE_DIR"
ln -sf "$CACHE_DIR/ea-stocks.json" /var/cache/ea-stocks.json
touch /var/log/ea-stocks-fetch.log && chown "$SVC_USER" /var/log/ea-stocks-fetch.log

# 4. API key file, readable only by the service account. Never committed to git.
if [ ! -f /etc/ea-stocks.env ]; then
  read -r -s -p "Mansa API key (input hidden): " KEY; echo
  printf 'MANSA_API_KEY=%s\nEA_CACHE=%s/ea-stocks.json\n' "$KEY" "$CACHE_DIR" > /etc/ea-stocks.env
  chown root:"$SVC_USER" /etc/ea-stocks.env && chmod 640 /etc/ea-stocks.env
fi

# 5. Web service + cron
cp deploy/ea-stocks-web.service /etc/systemd/system/ea-stocks-web.service
cp deploy/ea-stocks.cron /etc/cron.d/ea-stocks && chmod 644 /etc/cron.d/ea-stocks
systemctl daemon-reload
systemctl enable --now ea-stocks-web

# 6. First data load (4 API requests)
sudo -u "$SVC_USER" env EA_CACHE="$CACHE_DIR/ea-stocks.json" node "$APP_DIR/fetch-data.js" || echo "Initial fetch failed; check the key and /var/log/ea-stocks-fetch.log"

echo "Done. Check:  curl -s localhost:3000/health"
