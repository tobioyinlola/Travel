# Backup and restore drill

Targets (ARCH): RPO 5 minutes, RTO 1 hour. In production the database runs with continuous archiving (WAL) and daily
base backups held in a different region from the primary; Redis holds only sessions and caches and is not restored.

`scripts/restore-drill.sh` proves a backup can be restored and is complete: it takes a dump of the live database,
restores it into a scratch database, compares row counts per table and the ledger totals, runs the ledger balance
check on the copy, and reports how long it took. Run it monthly and after any migration that changes the schema.

Steps in a real incident are the same, against the base backup plus WAL to the chosen point in time:

1. Stop the web and worker processes (so nothing writes).
2. Restore to a new database; replay WAL to just before the incident.
3. Run the drill's checks against it (counts, ledger balanced, `GET /v1/finance/reconciliation`).
4. Point the application at it and start the worker last.
5. Replay anything lost: webhooks from providers' dashboards, and re-import supplier statements (they are
   de-duplicated by content).
