# ADR-10: Native ES modules and toolchain versions

- Status: Accepted (Sprint 0)

## Context

NestJS 12, graphile-worker 0.18 and uuid 14 are published as ES modules only.

## Decision

- All workspace packages use `"type": "module"`; server packages compile with `module: nodenext`, so
  relative imports carry `.js` extensions.
- TypeScript is pinned to 6.0.x: typescript-eslint supports `<6.1`, and TypeScript 7 (native compiler) is
  not yet supported by the lint toolchain. Revisit when typescript-eslint supports 7.
- Node 22 LTS (>= 22.18, required by graphile-worker 0.18).
- Tests use Vitest with SWC so NestJS decorator metadata is emitted.
