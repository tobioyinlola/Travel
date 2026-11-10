// Clicks through every page of a demo build as each role and fails on page errors or any call to a real API.
// Usage: pnpm build:demo && pnpm start (port 3000), then DEMO_URL=http://localhost:3000 node scripts/demo-tour.cjs
const { chromium } = require('playwright');
const ROLE_PAGES = {
  advisor: [
    '/dashboard',
    '/trips',
    '/trips/new',
    '/trips/b315f3ac-5785-772f-8592-84f62cfd6269',
    '/clients',
    '/clients/ba5178dc-7cdf-7d09-8cd8-4f2fff12c6da',
    '/insights',
    '/earnings',
    '/community',
    '/assistant',
    '/learn',
    '/application',
  ],
  admin: [
    '/admin/applications',
    '/admin/partners',
    '/admin/moderation',
    '/admin/privacy',
    '/admin/advisors',
    '/admin/finance',
    '/admin/reports',
    '/admin/settings',
    '/admin/promo-codes',
  ],
  finance: ['/admin/finance', '/admin/reports'],
  support: ['/admin/support', '/admin/privacy'],
};
const PUBLIC = [
  '/',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password?token=abc',
  '/privacy',
  '/terms',
  '/p/demo-token',
];
(async () => {
  const b = await chromium.launch();
  let bad = 0;
  const check = async (page, path, who) => {
    const errs = [],
      net = [];
    page.removeAllListeners('pageerror');
    page.removeAllListeners('request');
    page.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
    page.on('request', (r) => /localhost:3001/.test(r.url()) && net.push(r.url()));
    await page.goto((process.env.DEMO_URL || 'http://localhost:3100') + path, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(500);
    const txt = await page.locator('body').innerText();
    const flags = [];
    if (
      /Application error|Something went wrong|unreachable|You do not have access|Loading…\s*$/i.test(
        txt,
      )
    )
      flags.push(
        'TEXT:' +
          (txt.match(
            /Application error|Something went wrong|unreachable|You do not have access|Loading…/i,
          ) || [''])[0],
      );
    if (errs.length) flags.push('JS:' + errs[0]);
    if (net.length) flags.push('NET:' + net[0]);
    if (!page.url().includes(path.split('?')[0]) && !path.startsWith('/p/'))
      flags.push(
        'REDIRECT→' + page.url().replace(process.env.DEMO_URL || 'http://localhost:3100', ''),
      );
    console.log(
      (flags.length ? 'FAIL ' : 'ok   ') +
        who.padEnd(8) +
        path +
        (flags.length ? '  ' + flags.join(' | ') : ''),
    );
    if (flags.length) bad++;
    return txt;
  };
  for (const [role, pages] of Object.entries(ROLE_PAGES)) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('http://localhost:3100/login', { waitUntil: 'networkidle' });
    await page
      .getByRole('button', {
        name: new RegExp(
          { advisor: 'Travel advisor', admin: '^Admin', finance: '^Finance', support: '^Support' }[
            role
          ],
        ),
      })
      .click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 8000 });
    for (const p of pages) await check(page, p, role);
    if (role === 'advisor') await page.screenshot({ path: '/tmp/demo-advisor-trip.png' });
    await ctx.close();
  }
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  for (const p of PUBLIC) await check(page, p, 'public');
  console.log(bad ? `\n${bad} page(s) with problems` : '\nall pages ok');
  await b.close();
  process.exit(bad ? 1 : 0);
})();
