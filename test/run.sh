#!/usr/bin/env bash
set -euo pipefail
node "$(dirname "$0")/run.js"
node "$(dirname "$0")/links.mjs"
