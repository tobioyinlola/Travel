import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { cruise } from 'dependency-cruiser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { forbidden } = require('../dependency-cruiser.rules.cjs');

/**
 * Proves the boundary rules fail the build on violations (Sprint 0 exit criterion), by cruising a
 * throwaway source tree that breaks each rule once.
 */
describe('module boundary rules', () => {
  let root: string;
  const files: Record<string, string> = {
    'src/modules/shared-kernel/index.ts': `export const money = 1;\n`,
    'src/modules/booking/index.ts': `export const booking = 1;\n`,
    'src/modules/booking/internal.ts': `export const secret = 1;\n`,
    // Core domain calling orchestration (upward): forbidden.
    'src/modules/catalog/index.ts': `import { booking } from '../booking/index';\nexport const c = booking;\n`,
    // Same layer, and reaching into internals: forbidden twice.
    'src/modules/itineraries/index.ts': `import { secret } from '../booking/internal';\nexport const i = secret;\n`,
    // Top layer calling core domain through its index: allowed.
    'src/modules/admin/index.ts': `import { c } from '../catalog/index';\nimport { money } from '../shared-kernel/index';\nexport const a = c + money;\n`,
    // Platform depending on a business module: forbidden.
    'src/platform/thing.ts': `import { booking } from '../modules/booking/index';\nexport const t = booking;\n`,
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'atp-arch-'));
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('reports every planted violation and nothing else', async () => {
    const cwd = process.cwd();
    process.chdir(root);
    try {
      const result = await cruise(['src'], {
        ruleSet: { forbidden },
        tsPreCompilationDeps: true,
        validate: true,
      });
      const output = typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
      const found = output.summary.violations
        .map(
          (v: { rule: { name: string }; from: string; to: string }) =>
            `${v.rule.name}: ${v.from} -> ${v.to}`,
        )
        .sort();
      expect(found).toEqual(
        [
          'layer:catalog: src/modules/catalog/index.ts -> src/modules/booking/index.ts',
          'layer:itineraries: src/modules/itineraries/index.ts -> src/modules/booking/internal.ts',
          'no-module-internals: src/modules/itineraries/index.ts -> src/modules/booking/internal.ts',
          'platform-is-below-modules: src/platform/thing.ts -> src/modules/booking/index.ts',
        ].sort(),
      );
    } finally {
      process.chdir(cwd);
    }
  });
});
