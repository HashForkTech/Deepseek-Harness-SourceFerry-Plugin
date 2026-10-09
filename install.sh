#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
command -v node >/dev/null || { echo 'Install Node.js 24+ (including npm), then rerun this command.' >&2; exit 1; }
exec node scripts/install.mjs "$@"
