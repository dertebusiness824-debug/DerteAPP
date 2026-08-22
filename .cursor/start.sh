#!/usr/bin/env bash
# Keep Postgres up and launch the Node watch server (Cloud Agent terminal).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! pg_isready -q 2>/dev/null; then
  sudo pg_ctlcluster 16 main start 2>/dev/null \
    || sudo pg_ctlcluster "$(ls /etc/postgresql | head -1)" main start
fi

# Re-apply migrations cheaply (no-op when already applied).
npm run migrate >/dev/null

exec npm run dev
