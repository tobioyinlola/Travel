// WCAG 2.1 AA sweep (axe-core) over every page, signed in as an advisor and as an admin, plus the public pages. Also
// fails on any browser console message about the Content Security Policy, so the security headers cannot silently break
// a page. Usage: node scripts/a11y-sweep.cjs <workdir-with-axe/node_modules/axe-core> <session.json> <admin-email>
const { chromium } = require('playwright');
const { createHmac } = require('crypto');
const fs = require('fs');
const [WORK, SESSION, ADMIN_EMAIL] = process.argv.slice(2);
const s = JSON.parse(fs.readFileSync(SESSION, 'utf8'));
const AXE = fs.readFileSync(`${WORK}/axe/node_modules/axe-core/axe.min.js`, 'utf8');
const API = 'http://localhost:3001',
  WEB = 'http://localhost:3000';
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
const post = async (ctx, path, data) => {
  const r = await ctx.request.post(`${API}${path}`, { data });
  if (!r.ok()) throw new Error(`${path} ${r.status()}`);
  return r.json().catch(() => ({}));
};
(async () => {
  const browser = await chromium.launch();
  const adv = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await post(adv, '/v1/auth/login', {
    identifier: s.email,
    password: 'correct horse battery staple',
  });
  for (const off of [1, 2, 0]) {
    const r = await adv.request.post(`${API}/v1/auth/mfa/challenge`, {
      data: { code: totp(s.secret, off) },
    });
    if (r.ok()) break;
  }
  const adm = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await post(adm, '/v1/auth/login', {
    identifier: ADMIN_EMAIL,
    password: 'admin password long enough',
  });
  const en = await post(adm, '/v1/auth/mfa/enroll');
  await post(adm, '/v1/auth/mfa/enroll/confirm', { code: totp(en.secret) });
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const trip = `/trips/${s.lisbon}`;
  const pages = [
    ...[
      '/dashboard',
      '/trips',
      trip,
      '/trips/new',
      '/clients',
      `/clients/${s.stefan}`,
      '/insights',
      '/earnings',
      '/community',
      '/assistant',
      '/learn',
      '/application',
    ].map((p) => [adv, p, 'advisor']),
    ...[
      '/admin/applications',
      '/admin/partners',
      '/admin/moderation',
      '/admin/privacy',
      '/admin/advisors',
      '/admin/finance',
      '/admin/reports',
      '/admin/settings',
      '/admin/promo-codes',
    ].map((p) => [adm, p, 'admin']),
    ...['/login', '/signup', '/', s.lisbonUrl.replace('http://localhost:3000', '')].map((p) => [
      anon,
      p,
      'public',
    ]),
  ];
  let problems = 0;
  for (const [ctx, path, who] of pages) {
    const page = await ctx.newPage();
    const csp = [];
    page.on('console', (m) => {
      if (/content security policy|Refused to/i.test(m.text())) csp.push(m.text().slice(0, 160));
    });
    await page.goto(`${WEB}${path}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
    await page.addScriptTag({ content: AXE });
    const res = await page.evaluate(async () =>
      window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      }),
    );
    const v = res.violations;
    problems += v.length + csp.length;
    console.log(
      `${who.padEnd(8)} ${path.slice(0, 48).padEnd(48)} ${v.length ? 'VIOLATIONS' : 'ok'}${csp.length ? ' CSP!' : ''}`,
    );
    for (const x of v)
      console.log(
        `   ${x.id} (${x.impact}): ${x.nodes.length} node(s) e.g. ${x.nodes[0].html.slice(0, 120)}`,
      );
    for (const c of csp) console.log(`   CSP: ${c}`);
    await page.close();
  }
  console.log(`\n${pages.length} pages, ${problems} problem(s)`);
  await browser.close();
  process.exit(problems ? 1 : 0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
