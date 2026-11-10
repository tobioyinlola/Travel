#!/usr/bin/env bash
# Restore drill: dump the live database, restore it into a scratch database, and prove the copy is complete.
# Usage: SRC_URL=postgres://postgres:pw@host:5432/atp ./scripts/restore-drill.sh
# Needs pg_dump, psql, createdb, dropdb on PATH. Prints PASS or exits non-zero.
set -euo pipefail

SRC_URL="${SRC_URL:-postgres://postgres:postgres@localhost:5432/atp}"
SCRATCH="atp_restore_drill_$$"
DUMP="$(mktemp -t atp-drill-XXXXXX.dump)"
SERVER_URL="${SRC_URL%/*}/postgres"
SCRATCH_URL="${SRC_URL%/*}/${SCRATCH}"

cleanup() { psql "$SERVER_URL" -qc "DROP DATABASE IF EXISTS ${SCRATCH}" >/dev/null 2>&1 || true; rm -f "$DUMP"; }
trap cleanup EXIT

start=$(date +%s)
echo "1/4 dumping $(basename "$SRC_URL")"
pg_dump --format=custom --no-owner "$SRC_URL" -f "$DUMP"
echo "    dump size: $(du -h "$DUMP" | cut -f1)"

echo "2/4 restoring into ${SCRATCH}"
psql "$SERVER_URL" -qc "CREATE DATABASE ${SCRATCH}"
pg_restore --no-owner --exit-on-error -d "$SCRATCH_URL" "$DUMP"

echo "3/4 comparing row counts per table"
counts() {
  psql "$1" -At -F' ' -c "
    SELECT format('%I.%I', schemaname, relname) AS t, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', schemaname, relname), false, true, '')))[1]::text
      FROM pg_stat_user_tables
     WHERE schemaname NOT IN ('graphile_worker', 'pg_catalog', 'information_schema')
     ORDER BY 1"
}
diff <(counts "$SRC_URL") <(counts "$SCRATCH_URL") >/dev/null || {
  echo "FAIL: row counts differ between the live database and the restore" >&2
  diff <(counts "$SRC_URL") <(counts "$SCRATCH_URL") >&2 || true
  exit 1
}
echo "    $(counts "$SCRATCH_URL" | wc -l | tr -d ' ') tables match"

echo "4/4 checking the ledger on the restored copy"
if psql "$SCRATCH_URL" -Atc "SELECT to_regclass('commission.ledger_entries') IS NOT NULL" | grep -q t; then
  read -r debit credit < <(psql "$SCRATCH_URL" -At -F' ' -c "
    SELECT coalesce(sum(amount_minor) FILTER (WHERE direction = 'debit'), 0),
           coalesce(sum(amount_minor) FILTER (WHERE direction = 'credit'), 0) FROM commission.ledger_entries")
  [ "$debit" = "$credit" ] || { echo "FAIL: restored ledger is unbalanced ($debit vs $credit)" >&2; exit 1; }
  echo "    ledger balanced: ${debit} debits = ${credit} credits"
fi

echo "PASS: restored and verified in $(( $(date +%s) - start )) s (target: RTO 1 h)"
