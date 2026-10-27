// A site profile (sites/<id>.json) and a safe browser context for it. Nothing on the site is ever changed:
//  - every request that isn't GET/HEAD/OPTIONS is blocked, to every host, except the reads the profile allows
//    (e.g. refreshing a sign-in), so a page can't save, send, delete or pay
//  - trackers are blocked outright, service workers and websockets too (they could get round the blocking)
//  - any write that still reached the network is counted, and the capture is thrown away
//  - if the site sends us to its maintenance page, the capture stops
import { sites } from '../paths.mjs';
import { applySession } from './login.mjs';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const TRACKERS =
  /(googletagmanager|google-analytics|analytics\.google|googleadservices|doubleclick|google\.com\/(g|pagead)\/|firebaseinstallations|firebaselogging|firebase-settings|fcmregistrations|fcm\.googleapis|app-measurement|clarity\.ms|connect\.facebook|facebook\.com\/tr|hotjar|segment\.(io|com)|mixpanel|sentry\.io|hs-analytics|intercom)/i;

export class CaptureStop extends Error {} // a reason to stop, in plain words for Claude to pass on

export const DEVICES = {
  phone: {
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    scale: { preview: 1.5, high: 3 },
  },
  desktop: {
    viewport: { width: 1440, height: 900 },
    isMobile: false,
    hasTouch: false,
    userAgent: undefined,
    scale: { preview: 1, high: 2 },
  },
};

export function getSite(id) {
  const all = sites();
  if (!all.length) throw new CaptureStop('No sites are set up in Marketing Studio yet.');
  if (!id) return all[0];
  const s = all.find((x) => x.id === id || x.name?.toLowerCase() === String(id).toLowerCase() || x.url.includes(String(id)));
  if (!s) throw new CaptureStop(`There's no site called "${id}". Sites: ${all.map((x) => x.name ?? x.id).join(', ')}.`);
  return s;
}

// "rental price calculator", "/calculators", or a full URL on the site -> a URL
export function pageUrl(site, page = '/') {
  const p = String(page ?? '/').trim();
  const named = site.pages?.[p.toLowerCase()];
  const target = named ?? p;
  const base = new URL(site.url);
  const url = new URL(/^https?:\/\//.test(target) ? target : target.startsWith('/') ? target : `/${target}`, base);
  if (url.host !== base.host && !url.host.endsWith(`.${base.host.replace(/^www\./, '')}`)) {
    throw new CaptureStop(`${url.host} isn't part of ${site.name ?? site.id} (${base.host}). Only pages of a set-up site can be captured.`);
  }
  return url.href;
}

const isSite = (site, url) => {
  try {
    const h = new URL(url).host;
    const b = new URL(site.url).host.replace(/^www\./, '');
    return h === b || h.endsWith(`.${b}`);
  } catch {
    return false;
  }
};

// a fresh browser context for one capture or recording; returns { context, traffic }
export async function siteContext(browser, site, { device = 'phone', quality = 'preview', loggedIn = false } = {}) {
  const dev = DEVICES[device] ?? DEVICES.phone;
  const context = await browser.newContext({
    viewport: dev.viewport,
    deviceScaleFactor: dev.scale[quality] ?? dev.scale.preview,
    isMobile: dev.isMobile,
    hasTouch: dev.hasTouch,
    ...(dev.userAgent ? { userAgent: dev.userAgent } : {}),
    locale: site.locale ?? 'en-IN',
    timezoneId: site.timezone ?? 'Asia/Kolkata',
    colorScheme: 'light',
    serviceWorkers: 'block',
    permissions: [],
  });
  const allow = (site.allow_writes_to ?? []).map((r) => new RegExp(r, 'i'));
  const traffic = { requests: 0, writesBlocked: 0, writesAllowed: 0, trackersBlocked: 0, websocketsBlocked: 0, writesPassed: 0, passed: [] };
  const handled = new WeakSet();
  await context.route('**/*', (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    traffic.requests++;
    if (TRACKERS.test(url)) {
      traffic.trackersBlocked++;
      handled.add(req);
      return route.abort();
    }
    if (!SAFE.has(method)) {
      if (allow.some((r) => r.test(url))) {
        traffic.writesAllowed++;
        handled.add(req);
        return route.continue();
      }
      traffic.writesBlocked++;
      handled.add(req);
      // database writes get an empty success so the page carries on quietly; anything else is dropped
      if (/supabase\.(co|in)/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
      return route.abort();
    }
    if (isSite(site, url)) return route.continue({ headers: { ...req.headers(), 'x-marketing-studio': '1' } });
    return route.continue();
  });
  await context.routeWebSocket(/.*/, (ws) => {
    traffic.websocketsBlocked++;
    ws.close();
  });
  const audit = (req) => {
    if (!SAFE.has(req.method()) && !handled.has(req)) {
      traffic.writesPassed++;
      traffic.passed.push(`${req.method()} ${req.url()}`);
    }
  };
  context.on('requestfinished', audit);
  context.on('requestfailed', audit);

  // the same starting state every time (the site's remembered choices, first-visit popups seen), plus device CSS
  const ls = site.start_state?.localStorage ?? {};
  await context.addInitScript(
    ({ ls, css }) => {
      try {
        if (!sessionStorage.getItem('__ms_init')) {
          sessionStorage.setItem('__ms_init', '1');
          for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
        }
      } catch {}
      if (css)
        document.addEventListener('DOMContentLoaded', () => {
          const s = document.createElement('style');
          s.textContent = css;
          document.head.appendChild(s);
        });
    },
    { ls, css: site.device_css ?? '' },
  );
  if (loggedIn) await applySession(context, site);
  return { context, traffic, dev };
}

export const inMaintenance = (site, page) => {
  if (!site.maintenance_path) return false;
  try {
    return new URL(page.url()).pathname.startsWith(site.maintenance_path);
  } catch {
    return false;
  }
};

export const settle = async (page, ms = 1200) => {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(ms);
};

export async function waitImages(page, timeout = 15000) {
  return page
    .waitForFunction(() => [...document.images].filter((i) => i.getBoundingClientRect().top < innerHeight * 3).every((i) => i.complete), null, { timeout })
    .then(() => true)
    .catch(() => false);
}

// walk the page so lazy images and infinite lists load, then back to the top
export async function preScroll(page) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < Math.min(h, 20000); y += 600) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(200);
  }
  await settle(page, 500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
}

// open a page ready to capture: loaded, settled, images in, not in maintenance, not bounced to a login page
export async function openPage(context, site, url, { clock = false, warm = false, loggedIn = false } = {}) {
  const page = await context.newPage();
  if (clock) await page.clock.install();
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch((e) => {
    throw new CaptureStop(`Couldn't open ${url}: ${String(e.message).split('\n')[0]}`);
  });
  if (res && res.status() >= 400) throw new CaptureStop(`${url} answered with an error (${res.status()}).`);
  await settle(page);
  if (inMaintenance(site, page)) throw new CaptureStop(`${site.name ?? site.id} is in maintenance mode right now (it shows ${site.maintenance_path}), so nothing was captured.`);
  const out = site.login?.logged_out_when;
  if (loggedIn && out?.text && (await page.getByText(out.text, { exact: false }).first().isVisible().catch(() => false))) {
    throw new CaptureStop(`The page asked to sign in, so the demo account isn't signed in on this laptop. Check the demo account code in the extension's settings, or use sign_in with action "now".`);
  }
  if (warm) await preScroll(page);
  await waitImages(page);
  return page;
}

export const trafficLine = (t) =>
  `Safety: ${t.writesBlocked} write(s) and ${t.trackersBlocked} tracker call(s) blocked${t.writesAllowed ? `, ${t.writesAllowed} allowed read(s)` : ''}, ${t.writesPassed} got through.`;

export function assertNoWrites(t) {
  if (t.writesPassed) throw new CaptureStop(`${t.writesPassed} write(s) reached the site (${t.passed[0]}), so this capture was thrown away. Tell the owner.`);
}
