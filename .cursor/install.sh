#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for DerteApp.
set -euo pipefail
cd "$(dirname "$0")/.."

npm install

if ! command -v psql >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib
fi

# policy-rc.d often blocks systemd in these VMs — start the cluster directly.
if ! pg_isready -q 2>/dev/null; then
  sudo pg_ctlcluster 16 main start 2>/dev/null \
    || sudo pg_ctlcluster "$(ls /etc/postgresql | head -1)" main start
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'derte') THEN
    CREATE ROLE derte LOGIN PASSWORD 'derte';
  END IF;
END$$;
SELECT 'CREATE DATABASE derteapp OWNER derte'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'derteapp')\gexec
SELECT 'CREATE DATABASE derteapp_test OWNER derte'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'derteapp_test')\gexec
GRANT ALL PRIVILEGES ON DATABASE derteapp TO derte;
GRANT ALL PRIVILEGES ON DATABASE derteapp_test TO derte;
SQL

if [ ! -f .env ]; then
  cp .env.example .env
  sed -i 's|^DATABASE_URL=.*|DATABASE_URL=postgres://derte:derte@127.0.0.1:5432/derteapp|' .env
fi

npm run migrate
npm run seed
echo "[install] DerteApp ready (Postgres + migrations + seed)."
