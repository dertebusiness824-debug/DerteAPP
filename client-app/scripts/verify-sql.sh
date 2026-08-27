#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Verifica `supabase/marketplace.sql` contra un PostgreSQL real.
#
# Levanta un clúster temporal, aplica las migraciones del panel B2B, añade el
# shim que imita a Supabase (esquema auth, roles, publicación realtime),
# instala el marketplace dos veces (idempotencia), ejecuta la prueba funcional
# y termina desinstalando para comprobar que el panel queda limpio.
#
# Requisitos: PostgreSQL >= 14 instalado (initdb/pg_ctl/psql).
# Uso:
#   client-app/scripts/verify-sql.sh
#   PGPORT=5599 client-app/scripts/verify-sql.sh
# ---------------------------------------------------------------------------
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/.." && pwd)"
PGPORT="${PGPORT:-54329}"
CLUSTER_DIR="$(mktemp -d /tmp/derte-marketplace-pg.XXXXXX)"
DB_NAME="derte_marketplace_test"

find_bin() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then command -v "$name"; return; fi
  local candidate
  candidate="$(ls -1 /usr/lib/postgresql/*/bin/"$name" 2>/dev/null | sort -V | tail -1 || true)"
  if [[ -n "$candidate" ]]; then echo "$candidate"; return; fi
  echo "No se encontró '$name'. Instala PostgreSQL (apt install postgresql)." >&2
  exit 1
}

INITDB="$(find_bin initdb)"
PG_CTL="$(find_bin pg_ctl)"
PSQL="$(find_bin psql)"

cleanup() {
  local code=$?
  if [[ $code -ne 0 ]]; then
    echo ""
    echo "✗ Falló la verificación (exit $code). Últimos registros:"
    for log in "$CLUSTER_DIR"/*.log; do
      [[ -s "$log" ]] || continue
      echo "--- $(basename "$log") ---"
      tail -25 "$log"
    done
  fi
  "$PG_CTL" -D "$CLUSTER_DIR/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$CLUSTER_DIR"
}
trap cleanup EXIT

echo "→ Clúster temporal en $CLUSTER_DIR (puerto $PGPORT)"
mkdir -p "$CLUSTER_DIR/data"
chmod 700 "$CLUSTER_DIR/data"
"$INITDB" -D "$CLUSTER_DIR/data" -U postgres --auth=trust >"$CLUSTER_DIR/initdb.log" 2>&1
"$PG_CTL" -D "$CLUSTER_DIR/data" \
  -o "-p $PGPORT -k $CLUSTER_DIR -c listen_addresses=127.0.0.1 -c wal_level=logical" \
  -l "$CLUSTER_DIR/server.log" -w start >/dev/null

export PGHOST=127.0.0.1 PGPORT PGUSER=postgres
psql_run() { "$PSQL" -v ON_ERROR_STOP=1 -q -d "$DB_NAME" "$@"; }

"$PSQL" -d postgres -q -c "CREATE DATABASE $DB_NAME;"

echo "→ Migraciones del panel B2B (server/db/migrations)"
DATABASE_URL="postgres://postgres@127.0.0.1:$PGPORT/$DB_NAME" DATABASE_SSL=disable \
  node "$REPO_ROOT/server/db/migrate.js" >"$CLUSTER_DIR/migrate.log" 2>&1

echo "→ Shim de Supabase (auth.uid, roles, publicación realtime)"
psql_run -f "$APP_DIR/supabase/tests/00_supabase_shim.sql" >/dev/null 2>&1

echo "→ Instalando marketplace.sql"
psql_run -f "$APP_DIR/supabase/marketplace.sql" >"$CLUSTER_DIR/install.log" 2>&1

echo "→ Reinstalando marketplace.sql (idempotencia)"
psql_run -f "$APP_DIR/supabase/marketplace.sql" >"$CLUSTER_DIR/install2.log" 2>&1

echo "→ Prueba funcional"
psql_run -f "$APP_DIR/supabase/tests/10_marketplace_smoke.sql" 2>&1 | sed -e 's/^psql:[^ ]* //' -e 's/^NOTICE:  //'

echo "→ Desinstalando (marketplace_uninstall.sql)"
psql_run -f "$APP_DIR/supabase/marketplace_uninstall.sql" >"$CLUSTER_DIR/uninstall.log" 2>&1
psql_run -f "$APP_DIR/supabase/tests/20_uninstall_check.sql" 2>&1 | sed -e 's/^psql:[^ ]* //' -e 's/^NOTICE:  //'

# --- Segundo escenario: proyecto Supabase creado solo con supabase/schema.sql
echo ""
echo "→ Escenario 2: Supabase recién creado (solo supabase/schema.sql)"
SB_DB="derte_marketplace_supabase"
psql_sb() { "$PSQL" -v ON_ERROR_STOP=1 -q -d "$SB_DB" "$@"; }
"$PSQL" -d postgres -q -c "CREATE DATABASE $SB_DB;"
psql_sb -f "$APP_DIR/supabase/tests/00_supabase_shim.sql" >/dev/null 2>&1
psql_sb -f "$REPO_ROOT/supabase/schema.sql" >"$CLUSTER_DIR/schema_sb.log" 2>&1
psql_sb -f "$APP_DIR/supabase/marketplace.sql" >"$CLUSTER_DIR/install_sb.log" 2>&1
psql_sb -f "$APP_DIR/supabase/tests/11_supabase_shape.sql" 2>&1 | sed -e 's/^psql:[^ ]* //' -e 's/^NOTICE:  //'

echo ""
echo "✔ marketplace.sql verificado contra PostgreSQL $("$PSQL" -d "$DB_NAME" -tAc 'show server_version')"
