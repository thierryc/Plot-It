#!/usr/bin/env bash
set -eo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
task_pin="$(cat "$task_root/.nvmrc")"
task_nvm="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
if [[ ! -s "$task_nvm" ]]; then
  echo 'NVM is required. Install NVM for this user as documented in docs/NETWORK_PLOTTER.md.' >&2
  exit 1
fi
. "$task_nvm" --no-use
if [[ "$(nvm version "$task_pin")" == 'N/A' ]]; then nvm install "$task_pin"; fi
task_node="$(nvm which "$task_pin")"
"$task_node" "$task_root/scripts/check-runtime.mjs"
export PATH="$(dirname "$task_node"):$PATH"
if [[ "${1:-}" == '--npm' ]]; then
  shift
  exec "$task_node" "$(dirname "$task_node")/../lib/node_modules/npm/bin/npm-cli.js" "$@"
fi
exec "$task_node" "$@"
