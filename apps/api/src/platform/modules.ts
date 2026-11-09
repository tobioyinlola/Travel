import registry from '../module-registry.json' with { type: 'json' };

export interface ModuleDescriptor {
  name: string;
  layer: number;
  schemas: string[];
}

export const MODULES: readonly ModuleDescriptor[] = registry.modules;

/** Pseudo-module for platform-owned tables (outbox, idempotency keys, migrations). */
export const PLATFORM = 'platform';

export type ModuleName = string;

export function moduleRole(name: string): string {
  return `atp_mod_${name.replace(/-/g, '_')}`;
}

export function getModule(name: string): ModuleDescriptor {
  const m = MODULES.find((x) => x.name === name);
  if (!m) throw new Error(`Unknown module: ${name}`);
  return m;
}

export function isKnownModuleOrPlatform(name: string): boolean {
  return name === PLATFORM || MODULES.some((m) => m.name === name);
}
