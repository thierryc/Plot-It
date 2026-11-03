#!/usr/bin/env bash
# Run on the Pi from an unpacked release containing dist and dist-server.
set -euo pipefail
task_release="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "$(uname -s)" != Linux || "$(uname -m)" != aarch64 ]]; then echo 'Requires Linux ARM64 (Pi OS Lite 64-bit).' >&2; exit 1; fi
if [[ "$EUID" != 0 ]]; then echo 'Run with sudo on the Pi.' >&2; exit 1; fi
test -f "$task_release/dist/index.html"
test -f "$task_release/dist-server/main.js"
task_pin="$(cat "$task_release/.nvmrc")"
getent passwd plot-it >/dev/null || useradd --create-home --home-dir /var/lib/plot-it --shell /bin/bash plot-it
usermod -a -G dialout plot-it
install -d -o plot-it -g plot-it -m 0750 /opt/plot-it /var/lib/plot-it/jobs /etc/plot-it
cp -R "$task_release/dist" "$task_release/dist-server" /opt/plot-it/
(cd "$task_release" && tar --exclude="packages/*/node_modules" -cf - packages) | tar -xf - -C /opt/plot-it
cp "$task_release/package.json" "$task_release/package-lock.json" "$task_release/.nvmrc" /opt/plot-it/
ln -sfn dist-server/main.js /opt/plot-it/main.js
chown -R plot-it:plot-it /opt/plot-it
# Pinned NVM install; fetch and execute the script only on initial setup.
if [[ ! -s /var/lib/plot-it/.nvm/nvm.sh ]]; then
  install -d -o plot-it -g plot-it -m 0750 /var/lib/plot-it/.nvm
  task_install="$(mktemp)"
  curl -fLsS https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh -o "$task_install"
  chmod 0644 "$task_install"
  runuser -u plot-it -- env NVM_DIR=/var/lib/plot-it/.nvm PROFILE=/dev/null METHOD=script bash "$task_install"
  rm -f "$task_install"
fi
runuser -u plot-it -- bash -ec '. /var/lib/plot-it/.nvm/nvm.sh --no-use; if [[ "$(nvm version "$1")" == N/A ]]; then nvm install "$1"; fi; export PATH="$NVM_DIR/versions/node/v$1/bin:$PATH"; cd /opt/plot-it; "$NVM_DIR/versions/node/v$1/bin/node" "$NVM_DIR/versions/node/v$1/lib/node_modules/npm/bin/npm-cli.js" ci --omit=dev' -- "$task_pin"
task_node="/var/lib/plot-it/.nvm/versions/node/v$task_pin/bin/node"
"$task_node" -e 'if (!process.release.lts || process.versions.node !== process.argv[1]) process.exit(1)' "$task_pin"
[[ -f /etc/plot-it/environment ]] || install -o plot-it -g plot-it -m 0600 "$task_release/deploy/environment.example" /etc/plot-it/environment
for task_service in api runner; do
  sed "s|@NODE@|$task_node|g" "$task_release/deploy/plot-it-$task_service.service" > "/etc/systemd/system/plot-it-$task_service.service"
done
echo 'd /run/plot-it 0700 plot-it plot-it -' > /etc/tmpfiles.d/plot-it.conf
systemd-tmpfiles --create /etc/tmpfiles.d/plot-it.conf
systemctl daemon-reload
systemctl enable plot-it-api plot-it-runner
echo 'Configure /etc/plot-it/environment, install the LAN certificate/key, then start plot-it-runner and plot-it-api.'
