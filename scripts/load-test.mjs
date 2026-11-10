#!/usr/bin/env node
// Load test with no dependencies: N concurrent virtual users hit a mix of endpoints for D seconds and the script
// reports throughput, error rate and p50/p95/p99 per endpoint against the NFR targets
// (search p95 < 3 s, portal p95 < 2 s). Usage:
//   API=http://localhost:3001 EMAIL=... PASSWORD=... TOTP_SECRET=... USERS=200 SECONDS=30 node scripts/load-test.mjs
import { createHmac } from 'node:crypto';

// Several API instances can be given, comma separated; requests are spread across them (the API is stateless).
const APIS = (process.env.API ?? 'http://localhost:3001').split(',');
const API = APIS[0];
let rr = 0;
const base = () => APIS[rr++ % APIS.length];
const USERS = Number(process.env.USERS ?? 100);
const SECONDS = Number(process.env.SECONDS ?? 20);
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32 = (x) => {
  let bits = 0,
    v = 0;
  const o = [];
  for (const c of x) {
    v = (v << 5) | A.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      o.push((v >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(o);
};
const totp = (secret, off = 0) => {
  const m = Buffer.alloc(8);
  m.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + off));
  const h = createHmac('sha1', b32(secret)).update(m).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
};

async function signIn() {
  const login = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: process.env.EMAIL, password: process.env.PASSWORD }),
  });
  let cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  for (const off of [1, 2, 0]) {
    const r = await fetch(`${API}/v1/auth/mfa/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ code: totp(process.env.TOTP_SECRET, off) }),
    });
    if (r.ok) {
      cookie =
        [...(r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]), '']
          .filter(Boolean)
          .join('; ') || cookie;
      return cookie;
    }
  }
  throw new Error('could not sign in');
}

const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const DESTS = ['lisbon', 'paris', 'cape-town', 'marrakech', 'bali', 'new-york'];
const cookie = process.env.EMAIL ? await signIn() : '';
const scenarios = [
  {
    name: 'search (live rates)',
    weight: 3,
    target: 3000,
    run: (i) =>
      fetch(
        `${base()}/v1/catalog/search?destination=${DESTS[i % DESTS.length]}&checkIn=${inDays(40 + (i % 50))}&checkOut=${inDays(43 + (i % 50))}&adults=2`,
        { headers: { cookie } },
      ),
  },
  {
    name: 'clients list',
    weight: 3,
    target: 2000,
    run: () => fetch(`${base()}/v1/clients?limit=50`, { headers: { cookie } }),
  },
  {
    name: 'trips list',
    weight: 3,
    target: 2000,
    run: () => fetch(`${base()}/v1/trips`, { headers: { cookie } }),
  },
  {
    name: 'dashboard summary',
    weight: 2,
    target: 2000,
    run: () => fetch(`${base()}/v1/trips/summary`, { headers: { cookie } }),
  },
  {
    name: 'advisor insights',
    weight: 1,
    target: 2000,
    run: () => fetch(`${base()}/v1/reports/advisor`, { headers: { cookie } }),
  },
  { name: 'health', weight: 1, target: 500, run: () => fetch(`${base()}/v1/health`) },
];
const bag = scenarios.flatMap((s) => Array(s.weight).fill(s));
const stats = new Map(scenarios.map((s) => [s.name, { ms: [], errors: 0 }]));
const end = Date.now() + SECONDS * 1000;

async function user(id) {
  for (let i = id; Date.now() < end; i++) {
    const s = bag[(i * 7 + id) % bag.length];
    const t0 = performance.now();
    try {
      const r = await s.run(i);
      await r.arrayBuffer();
      stats.get(s.name).ms.push(performance.now() - t0);
      if (r.status >= 500 || r.status === 429) stats.get(s.name).errors++;
    } catch {
      stats.get(s.name).errors++;
    }
  }
}
const started = Date.now();
await Promise.all(Array.from({ length: USERS }, (_, i) => user(i)));
const secs = (Date.now() - started) / 1000;
const pct = (a, p) =>
  a.length ? a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0;
let failed = false;
console.log(`\n${USERS} virtual users, ${secs.toFixed(0)} s\n`);
console.log(
  'endpoint'.padEnd(22),
  'reqs'.padStart(6),
  'rps'.padStart(6),
  'err'.padStart(5),
  'p50'.padStart(7),
  'p95'.padStart(7),
  'p99'.padStart(7),
  ' target p95',
);
for (const s of scenarios) {
  const { ms, errors } = stats.get(s.name);
  const p95 = pct(ms, 95);
  const ok = p95 <= s.target && errors === 0;
  if (!ok) failed = true;
  console.log(
    s.name.padEnd(22),
    String(ms.length).padStart(6),
    (ms.length / secs).toFixed(0).padStart(6),
    String(errors).padStart(5),
    pct(ms, 50).toFixed(0).padStart(7),
    p95.toFixed(0).padStart(7),
    pct(ms, 99).toFixed(0).padStart(7),
    ` ${s.target} ms ${ok ? 'OK' : 'MISS'}`,
  );
}
console.log(failed ? '\nRESULT: targets missed' : '\nRESULT: all targets met');
process.exit(failed ? 1 : 0);
