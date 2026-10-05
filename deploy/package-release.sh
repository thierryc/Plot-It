#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
test -f dist/index.html
test -f dist-server/main.js
mkdir -p output
tar --exclude='packages/*/node_modules' -czf output/plot-it-pi.tar.gz \
  dist dist-server packages deploy docs scripts .nvmrc package.json package-lock.json \
  LICENSE THIRD_PARTY_NOTICES.md
echo 'Release: output/plot-it-pi.tar.gz'
