#!/usr/bin/env bash
# Arranca (o reutiliza) un PostgreSQL local para desarrollo / Cloud Agents.
# Idempotente: si el puerto 5432 ya responde, no hace nada.
set -euo pipefail

PORT="${PGPORT:-5432}"
CLUSTER_DIR="${DERTE_PG_CLUSTER:-/tmp/derteapp-dev-pg}"
DB_NAME="${POSTGRES_DB:-derteapp}"
DB_USER="${POSTGRES_USER:-derte}"
DB_PASS="${POSTGRES_PASSWORD:-derte}"

find_bin() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then command -v "$name"; return; fi
  local candidate
  candidate="$(ls -1 /usr/lib/postgresql/*/bin/"$name" 2>/dev/null | sort -V | tail -1 || true)"
  if [[ -n "$candidate" ]]; then echo "$candidate"; return; fi
  echo "No se encontró '$name'. Instala PostgreSQL (apt install postgresql)." >&2
  exit 1
}

if pg_isready -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1; then
  echo "[postgres] ya disponible en 127.0.0.1:$PORT"
  exit 0
fi

INITDB="$(find_bin initdb)"
PG_CTL="$(find_bin pg_ctl)"
PSQL="$(find_bin psql)"

mkdir -p "$CLUSTER_DIR/data"
chmod 700 "$CLUSTER_DIR/data"

if [[ ! -f "$CLUSTER_DIR/data/PG_VERSION" ]]; then
  echo "[postgres] inicializando clúster en $CLUSTER_DIR"
  "$INITDB" -D "$CLUSTER_DIR/data" -U postgres --auth=trust >/dev/null
fi

echo "[postgres] arrancando en el puerto $PORT"
"$PG_CTL" -D "$CLUSTER_DIR/data" \
  -o "-p $PORT -k $CLUSTER_DIR -c listen_addresses=127.0.0.1" \
  -l "$CLUSTER_DIR/server.log" -w start >/dev/null

# Usuario / base de la app (idempotente).
"$PSQL" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL >/dev/null
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS' SUPERUSER;
  END IF;
END
\$\$;
SELECT 'ok' FROM pg_database WHERE datname = '$DB_NAME'
UNION ALL
SELECT NULL WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$DB_NAME');
SQL

if ! "$PSQL" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  "$PSQL" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" >/dev/null
fi

echo "[postgres] listo → postgres://$DB_USER:***@127.0.0.1:$PORT/$DB_NAME"
