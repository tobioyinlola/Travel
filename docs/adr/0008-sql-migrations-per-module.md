# ADR-08: SQL migrations per module, run as the module's database role

- Status: Accepted (Sprint 0)
- Extends: ADR-02 (one PostgreSQL cluster, schema per module)

## Context

ARCH requires each module to own its schema and its migrations, with database roles enforcing ownership.
The implementation plan proposed Drizzle with drizzle-kit. Drizzle's generator works from one schema
definition and one migrations folder per config; running it per module needs 13 configs and does not by
itself stop a migration from touching another schema.

## Decision

- Each module keeps plain SQL files in `src/modules/<module>/migrations/NNNN_name.sql`.
- A small runner (`src/platform/migrations/runner.ts`) applies them in module-registry order and runs each
  file inside a transaction **as that module's role** (`SET LOCAL ROLE atp_mod_<module>`). A migration that
  tries to create or alter objects in another schema fails with `permission denied`.
- Applied files are recorded in `platform.schema_migrations` with a SHA-256 checksum; editing an applied
  file fails the next run.
- Migrations must be backward compatible with the previous release (ARCH deployment: rollback never needs a
  data restore).
- A query builder (Drizzle or Kysely) may still be adopted for typed queries inside a module; it would read
  the schema these migrations create rather than generate it. Decide in Sprint 1 with the first real tables.

## Consequences

- Schema ownership is enforced by Postgres, not by review.
- Developers write SQL by hand (no generated diffs). We accept this: money tables need deliberate DDL.
