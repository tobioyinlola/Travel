// Builds frontend/lib/demo/samples.generated.json: one sample response per API operation the frontend calls, derived
// from the backend's OpenAPI contract, so demo mode (no backend) always matches the real response shapes.
// Run: pnpm --filter @atp/web demo:generate   (after the API contract changes)
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const spec = JSON.parse(readFileSync(join(root, '..', 'backend', 'openapi.json'), 'utf8'));

// ---- Which operations does the frontend call? ----
const used = new Set();
function scan(dir) {
  for (const f of readdirSync(dir)) {
    if (['node_modules', '.next', 'scripts'].includes(f)) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) scan(p);
    else if (/\.(ts|tsx)$/.test(f))
      for (const m of readFileSync(p, 'utf8').matchAll(
        /api\.(GET|POST|PUT|PATCH|DELETE)\(\s*'([^']+)'/g,
      ))
        used.add(`${m[1].toLowerCase()} ${m[2]}`);
  }
}
scan(join(root, 'app'));
scan(join(root, 'components'));
scan(join(root, 'lib'));
// Server-rendered pages fetch these directly.
used.add('get /v1/proposal-links/{token}');
used.add('get /v1/checkout/{token}');
used.add('post /v1/proposal-links/{token}/attachments');

// ---- Deterministic sample values ----
const h = (s) => parseInt(createHash('sha1').update(s).digest('hex').slice(0, 8), 16);
const uuid = (seed) => {
  const x = createHash('sha1').update(seed).digest('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-7${x.slice(13, 16)}-8${x.slice(17, 20)}-${x.slice(20, 32)}`;
};
const PEOPLE = [
  'Amara Eze',
  'Stefan Muller',
  'Tunde Bakare',
  'Grace Hopper',
  'Lena Okoro',
  'Mateo Silva',
];
const FIRST = ['Amara', 'Stefan', 'Tunde', 'Grace', 'Lena', 'Mateo'];
const LAST = ['Eze', 'Muller', 'Bakare', 'Hopper', 'Okoro', 'Silva'];
const HOTELS = [
  'Hotel Avenida Palace',
  'Casa do Largo Boutique',
  'Villa Serena Amalfi',
  'Mara River Lodge',
  'Ryokan Kikunoi',
];
const TRIPS = [
  'Lisbon long weekend',
  'Amalfi honeymoon',
  'Kenya family safari',
  'Kyoto in spring',
  'Marrakech retreat',
];
const CITIES = ['Lisbon', 'Amalfi', 'Nairobi', 'Kyoto', 'Marrakech'];
const COURSES = [
  'Essentials: selling hotels',
  'Partner programs 101',
  'Pricing and commission',
  'Client care',
];
const SENTENCES = [
  'Quiet beachside boutique hotels with a pool and a spa.',
  'Prefers a relaxed pace, vegetarian meals and late check-out.',
  'Please confirm breakfast is included for both travelers.',
  'Celebrating an anniversary, so a room with a view would be lovely.',
];
const SUPPLIERS = ['hotelbeds-demo', 'travelport-demo'];
const FUTURE = ['2027-03-01T12:00:00.000Z'];
const PREFER = [
  'active',
  'confirmed',
  'approved',
  'published',
  'paid',
  'passed',
  'signed',
  'open',
  'completed',
  'captured',
  'payable',
  'pending',
  'matched',
  'draft',
];
const pick = (arr, i) => arr[i % arr.length];

const KEY_STRINGS = [
  [/time$/i, () => '15:00'],
  [/file.?name/i, () => 'passport-scan.pdf'],
  [/^label$/i, (i) => pick(HOTELS, i)],
  [/(At|Until|Since|Date)$/, (i) => new Date(Date.UTC(2026, 10, 1 + i, 9)).toISOString()],
  [/email/i, (i) => `${pick(FIRST, i).toLowerCase()}@example.com`],
  [/phone/i, () => '+2348012345678'],
  [/first.?name/i, (i) => pick(FIRST, i)],
  [/last.?name/i, (i) => pick(LAST, i)],
  [
    /(client|advisor|legal|display|sender|decided.?by|requester|traveler|author|lead|assignee).*name|^name$/i,
    (i) => pick(PEOPLE, i),
  ],
  [/property.?name|hotel.?name|roomname|^property$/i, (i) => pick(HOTELS, i)],
  [/room.?name/i, () => 'Deluxe Double, sea view'],
  [/trip.?title|^title$|program.?name/i, (i) => pick(TRIPS, i)],
  [/city|destination|home.?city/i, (i) => pick(CITIES, i)],
  [/country|residency/i, () => 'PT'],
  [/currency/i, () => 'USD'],
  [/supplier/i, (i) => pick(SUPPLIERS, i)],
  [/confirmation.?code/i, (i) => `CNF-${48213 + i}`],
  [/reference|ref$|envelope/i, (i) => `REF-${1042 + i}`],
  [/token|secret/i, () => 'x'.repeat(43)],
  [/url|link|href/i, () => 'https://example.com/demo'],
  [
    /slug/i,
    (i) =>
      pick(COURSES, i)
        .toLowerCase()
        .replace(/[^a-z]+/g, '-'),
  ],
  [/niche/i, () => 'Family and honeymoon travel'],
  [/address|line1/i, () => '12 Admiralty Way'],
  [
    /note|body|text|description|detail|summary|reason|instruction|prompt|question|answer|policy|snippet/i,
    (i) => pick(SENTENCES, i),
  ],
  [/code$|^code/i, (i) => pick(['ANNUAL', 'QUARTERLY', 'PILOT100'], i)],
  [/kind|type/i, null],
  [/board/i, () => 'breakfast'],
  [/model/i, () => 'demo-model'],
];

const KEEP =
  /confirmation|traveler|photo|name|email|phone|clientToken|paymentMode|kyc|agreement|freeCancellationUntil|startTime|amount|total|rate|dueNow|selected|lastRun|tier|reference|address|logo/i;

function resolve(schema) {
  let s = schema;
  while (s && s.$ref)
    s = s.$ref
      .split('/')
      .slice(1)
      .reduce((o, k) => o[k], spec);
  return s;
}

function gen(schema, key, idx, path, depth = 0) {
  const s = resolve(schema);
  if (!s || depth > 7) return null;
  // Optional (nullable) fields are left empty unless a screen reads them, so nothing shows a bogus error or badge.
  const nullable = s.nullable === true || (Array.isArray(s.type) && s.type.includes('null'));
  if (nullable && !KEEP.test(key)) return null;
  if (key === 'attachments') return [];
  if (s.allOf) return Object.assign({}, ...s.allOf.map((x) => gen(x, key, idx, path, depth + 1)));
  if (s.oneOf || s.anyOf) {
    const opts = (s.oneOf || s.anyOf).filter((o) => resolve(o)?.type !== 'null');
    return gen(opts[0], key, idx, path, depth + 1);
  }
  if (s.enum) return PREFER.find((p) => s.enum.includes(p)) ?? s.enum[0];
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type;
  if (type === 'object' || s.properties) {
    const props = s.properties ?? {};
    if (props.amountMinor && props.currency)
      return {
        amountMinor: /refund|penalty|discount|outstanding|variance|fees|taxes|reversed|fee$/i.test(
          key,
        )
          ? '0'
          : String(125000 + 35000 * (idx % 4)),
        currency: 'USD',
      };
    const out = {};
    for (const [k, v] of Object.entries(props)) out[k] = gen(v, k, idx, `${path}.${k}`, depth + 1);
    return out;
  }
  if (type === 'array') {
    const n = Math.max(
      s.minItems ?? 0,
      /ages|codes|tags|photos|amenities|perks|rateCodes|paymentModes|flags|sources/i.test(key)
        ? 2
        : 3,
    );
    return Array.from({ length: n }, (_, i) => gen(s.items, key, i, `${path}[${i}]`, depth + 1));
  }
  if (type === 'boolean')
    return !/failed|refused|expired|erased|cancelling|modifying|changing|dismissed|deleted|archived/i.test(
      key,
    );
  if (type === 'integer' || type === 'number') {
    if (/bps/i.test(key)) return 7500;
    if (/percent/i.test(key)) return 18;
    if (/adults/i.test(key)) return 2;
    if (/nights/i.test(key)) return 3;
    if (/star/i.test(key)) return 4;
    if (/attempts/i.test(key)) return 1;
    if (/position/i.test(key)) return idx + 1;
    if (/version/i.test(key)) return 1;
    if (/unread|failed|cancelled|refus/i.test(key)) return 0;
    return 3 + idx;
  }
  // strings
  if (s.format === 'uuid') return uuid(`${path}#${idx}`);
  if (s.format === 'date-time') {
    if (/expire|until|due|ends?At|renew|next/i.test(key)) return FUTURE[0];
    const d = new Date(Date.UTC(2026, 10, 1 + idx, 9, 0, 0));
    return d.toISOString();
  }
  if (s.format === 'date') return /out|end|to$/i.test(key) ? '2027-03-13' : '2027-03-10';
  if (s.format === 'email') return `${pick(FIRST, idx).toLowerCase()}@example.com`;
  for (const [re, fn] of KEY_STRINGS) if (re.test(key)) return fn ? fn(idx) : `${key}-${idx + 1}`;
  return `${key || 'value'} ${idx + 1}`;
}

// ---- Hand-tuned corrections where the generic value would mislead the UI ----
const OVERRIDES = {
  'get /v1/auth/me': (v) => ({ ...v, next: null, mfaEnabled: true, mfaVerified: true }),
  'post /v1/auth/login': (v) => ({ ...v, next: null, mfaEnabled: true, mfaVerified: true }),
  'post /v1/auth/mfa/challenge': (v) => ({ ...v, next: null, mfaEnabled: true, mfaVerified: true }),
  'get /v1/checkout/{token}': (v) => ({ ...v, status: 'draft' }),
  'get /v1/proposal-links/{token}': (v) => ({
    ...v,
    status: 'published',
    ratesExpired: false,
    decidedAt: null,
    decidedByName: null,
    decisionNote: null,
  }),
  'get /v1/advisor-application': (v) => ({ ...v, status: 'active', infoRequestNote: null }),
  'get /v1/learning/courses': (v) =>
    v.map((c, i) => ({ ...c, title: COURSES[i % COURSES.length] })),
  'get /v1/trips/messages/unread': () => ({ unread: 2 }),
};

const out = {};
for (const key of [...used].sort()) {
  const [method, path] = key.split(' ');
  const op = spec.paths[path]?.[method];
  if (!op) continue;
  const code = Object.keys(op.responses).find((c) => c.startsWith('2')) ?? '200';
  const schema = op.responses[code]?.content?.['application/json']?.schema;
  let body = schema ? gen(schema, '', 0, key) : null;
  if (OVERRIDES[key]) body = OVERRIDES[key](body);
  out[key] = { status: Number(code), body };
}
writeFileSync(
  join(root, 'lib', 'demo', 'samples.generated.json'),
  JSON.stringify(out, null, 1) + '\n',
);
console.log(`${Object.keys(out).length} operations written`);
