/**
 * Module boundary rules (ARCH "Enforcing boundaries"), generated from src/module-registry.json.
 * Exported separately so the arch test can run the exact same rules against fixtures.
 */
const { modules } = require('./src/module-registry.json');

const SK = 'shared-kernel';
const esc = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

function layerRules() {
  return modules
    .filter((m) => m.name !== SK)
    .map((m) => {
      const forbidden = modules.filter(
        (o) => o.name !== m.name && o.name !== SK && o.layer >= m.layer,
      );
      if (forbidden.length === 0) return null;
      return {
        name: `layer:${m.name}`,
        severity: 'error',
        comment:
          `${m.name} (layer ${m.layer}) may only call modules in a LOWER layer. ` +
          'Same-layer and upward communication must use domain events (ARCH module map).',
        from: { path: `^src/modules/${esc(m.name)}/` },
        to: { path: `^src/modules/(${forbidden.map((o) => esc(o.name)).join('|')})/` },
      };
    })
    .filter(Boolean);
}

const forbidden = [
  {
    name: 'no-module-internals',
    severity: 'error',
    comment:
      'Import another module only through its index.ts (its public interface), never its internals.',
    from: { path: '^src/modules/([^/]+)/' },
    to: {
      path: '^src/modules/[^/]+/',
      pathNot: ['^src/modules/$1/', '^src/modules/[^/]+/index\\.ts$'],
    },
  },
  ...layerRules(),
  {
    name: 'platform-is-below-modules',
    severity: 'error',
    comment: 'Platform plumbing must not depend on business modules (only the shared kernel).',
    from: { path: '^src/platform/' },
    to: { path: '^src/modules/', pathNot: `^src/modules/${SK}/` },
  },
  {
    name: 'shared-kernel-is-pure',
    severity: 'error',
    comment: 'The shared kernel depends on nothing else in the app.',
    from: { path: `^src/modules/${SK}/` },
    to: { path: '^src/', pathNot: `^src/modules/${SK}/` },
  },
  {
    name: 'no-circular',
    severity: 'error',
    from: {},
    to: { circular: true },
  },
];

module.exports = { forbidden };
