import samples from './samples.generated.json';
import { getDemoRole, roleFromEmail, setDemoRole, DEMO_ROLES, type DemoRole } from './mode';

type Sample = { status: number; body: unknown };
const table = samples as Record<string, Sample>;

// Path templates, most specific first, so "/v1/trips/summary" wins over "/v1/trips/{id}".
const templates = Object.keys(table)
  .map((key) => {
    const [method, path] = key.split(' ') as [string, string];
    const re = new RegExp(
      '^' +
        path
          .replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '{' || c === '}' ? c : '\\' + c))
          .replace(/\{[^}]+\}/g, '[^/]+') +
        '$',
    );
    return { key, method, re, weight: path.split('{').length };
  })
  .sort((a, b) => a.weight - b.weight);

const personFor = (role: DemoRole) => DEMO_ROLES.find((r) => r.role === role)!;

function me(role: DemoRole) {
  const base = (table['get /v1/auth/me']?.body ?? {}) as Record<string, unknown>;
  const p = personFor(role);
  return {
    ...base,
    id: '00000000-0000-7000-8000-00000000d3a0',
    role,
    email: p.email,
    displayName: role === 'advisor' ? 'Sandra Okafor' : `${p.label} (demo)`,
    mfaEnabled: true,
    mfaVerified: true,
    next: null,
  };
}

/** The whole fake backend: pure, so it works in the browser and in server-rendered pages. */
export function demoRespond(
  method: string,
  pathname: string,
  body?: unknown,
): { status: number; body: unknown } {
  const m = method.toLowerCase();
  const path = pathname.replace(/\/+$/, '');

  if (path === '/v1/auth/me' && m === 'get') {
    const role = getDemoRole();
    return role
      ? { status: 200, body: me(role) }
      : { status: 401, body: { type: 'about:blank', title: 'Not signed in', status: 401 } };
  }
  if (path === '/v1/auth/login' && m === 'post') {
    const ident = String((body as { identifier?: string } | undefined)?.identifier ?? '');
    const role = roleFromEmail(ident);
    setDemoRole(role);
    return { status: 200, body: me(role) };
  }
  if (path === '/v1/auth/logout' && m === 'post') {
    setDemoRole(null);
    return { status: 204, body: null };
  }
  if (path === '/v1/auth/mfa/challenge' && m === 'post')
    return { status: 200, body: me(getDemoRole() ?? 'advisor') };

  const hit = templates.find((t) => t.method === m && t.re.test(path));
  if (hit) {
    const s = table[hit.key]!;
    return { status: s.status, body: s.body };
  }
  // Anything unknown: reads are empty, writes succeed quietly.
  if (m === 'get') return { status: 200, body: { items: [] } };
  return { status: m === 'post' ? 201 : 204, body: m === 'post' ? {} : null };
}

export function demoResponse(method: string, url: string, body?: unknown): Response {
  const { status, body: out } = demoRespond(
    method,
    new URL(url, 'http://demo.local').pathname,
    body,
  );
  return new Response(status === 204 || out === null ? null : JSON.stringify(out), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
