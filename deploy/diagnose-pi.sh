#!/usr/bin/env bash
set -euo pipefail
task_pin="$(cat /opt/plot-it/.nvmrc)"
task_node="/var/lib/plot-it/.nvm/versions/node/v$task_pin/bin/node"
"$task_node" -p 'JSON.stringify({version:process.version,lts:process.release.lts,executable:process.execPath,arch:process.arch})'
"$task_node" --input-type=module -e 'import {SerialPort} from "/opt/plot-it/node_modules/serialport/dist/index.js"; console.log(await SerialPort.list())'
id plot-it
systemctl --no-pager status plot-it-api plot-it-runner || true
journalctl --no-pager -n 30 -u plot-it-api -u plot-it-runner
curl --fail --silent http://127.0.0.1:8787/api/v1/status
