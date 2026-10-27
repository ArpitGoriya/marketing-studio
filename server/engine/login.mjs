// Signing in to a site for captures behind its login. A site profile's `login` says how; the sign-in is kept per
// site in the tool's data folder (one per laptop, never shared, so sites that rotate sign-in tokens never log out
// another laptop).
//  - supabase-phone: a demo account whose number is a Supabase *test phone number* with a fixed code. The code is
//    checked directly (no SMS, no CAPTCHA), and the session goes where the site's own app keeps it.
//  - manual: a visible browser window opens once, the person signs in, and the browser's sign-in state is kept.
//    Works for any site; also the fallback for supabase-phone when the settings aren't filled in.
import fs from 'node:fs';
import path from 'node:path';
import { D, readJson, writeJson } from '../paths.mjs';
import { headedPersistent } from './browser.mjs';

class LoginStop extends Error {}
export { LoginStop };

const file = (site) => path.join(D.sessions, `${site.id}.json`);
const setting = (name) => {
  const v = name ? process.env[`MS_${String(name).toUpperCase()}`] : '';
  return v && !v.includes('${') ? v.trim() : '';
};

export function sessionStatus(site) {
  if (!site.login) return { possible: false, signedIn: false, how: 'this site has no login set up' };
  const s = readJson(file(site));
  const auto = site.login.type === 'supabase-phone' && setting(site.login.phone_setting) && setting(site.login.code_setting) && site.login.anon_key;
  return {
    possible: true,
    signedIn: !!s,
    how: auto ? 'automatic (demo account)' : 'by hand, once, in a window (sign_in tool)',
    since: s?.savedAt ?? null,
  };
}

// ── supabase-phone ───────────────────────────────────────────────────────────────────────────────────────────
const sb = async (site, route, body) => {
  const l = site.login;
  const res = await fetch(`${l.supabase_url}/auth/v1/${route}`, {
    method: 'POST',
    headers: { apikey: l.anon_key, Authorization: `Bearer ${l.anon_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ msg: e.message }) }));
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new LoginStop(j.msg || j.error_description || j.message || `sign-in answered ${res.status}`);
  return j;
};

async function supabaseSession(site) {
  const saved = readJson(file(site));
  const now = Math.floor(Date.now() / 1000);
  if (saved?.session?.expires_at && saved.session.expires_at - now > 120) return saved.session;
  // without the site's public key we can't refresh here; the site's own app refreshes it in the page instead
  if (!site.login.anon_key) return saved?.session ?? null;
  if (saved?.session?.refresh_token) {
    try {
      const s = await sb(site, 'token?grant_type=refresh_token', { refresh_token: saved.session.refresh_token });
      writeJson(file(site), { kind: 'supabase', savedAt: new Date().toISOString(), session: s });
      return s;
    } catch {
      /* the refresh token ran out or was replaced: sign in again */
    }
  }
  const phone = setting(site.login.phone_setting);
  const code = setting(site.login.code_setting);
  if (!phone || !code || !site.login.anon_key) return null;
  const full = phone.startsWith('+') ? phone : `${site.login.country_code ?? '+91'}${phone.replace(/\D/g, '')}`;
  const s = await sb(site, 'verify', { type: 'sms', phone: full, token: code }).catch((e) => {
    throw new LoginStop(`The demo account couldn't sign in (${e.message}). Check the demo phone number and code in the extension's settings, and that the number is a Supabase test number.`);
  });
  writeJson(file(site), { kind: 'supabase', savedAt: new Date().toISOString(), session: s });
  return s;
}

// ── applying a sign-in to a capture's browser context ────────────────────────────────────────────────────────
export async function applySession(context, site) {
  if (!site.login) throw new LoginStop(`${site.name ?? site.id} has no login set up, so only public pages can be captured.`);
  let saved = readJson(file(site));
  if (site.login.type === 'supabase-phone') {
    const s = await supabaseSession(site);
    if (s) {
      await context.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: site.login.storage_key, value: JSON.stringify(s) });
      return;
    }
    saved = readJson(file(site));
  }
  if (saved?.kind !== 'state') throw new LoginStop(`Not signed in to ${site.name ?? site.id} on this laptop yet. Use the sign_in tool once (a window opens to sign in).`);
  const origin = new URL(site.url).origin;
  if (saved.state.cookies?.length) await context.addCookies(saved.state.cookies);
  const items = saved.state.origins?.find((o) => o.origin === origin)?.localStorage ?? [];
  if (items.length) await context.addInitScript((items) => items.forEach(({ name, value }) => localStorage.setItem(name, value)), items);
}

// after a capture: the site's own app may have refreshed its sign-in; keep the newest so the next capture works
export async function keepSession(page, site) {
  try {
    if (site.login?.type === 'supabase-phone') {
      const v = await page.evaluate((k) => localStorage.getItem(k), site.login.storage_key);
      const s = v && JSON.parse(v);
      if (s?.refresh_token && s.refresh_token !== readJson(file(site))?.session?.refresh_token) writeJson(file(site), { kind: 'supabase', savedAt: new Date().toISOString(), session: s });
    } else if (readJson(file(site))?.kind === 'state') {
      writeJson(file(site), { kind: 'state', savedAt: new Date().toISOString(), state: await page.context().storageState() });
    }
  } catch {
    /* the page went away; the saved sign-in stays as it was */
  }
}

// ── signing in by hand, once ──────────────────────────────────────────────────────────────────────────────────
const signedInNow = async (page, site) => {
  const w = site.login?.signed_in_when ?? (site.login?.storage_key ? { localStorage: site.login.storage_key } : null);
  if (!w) return false;
  if (w.localStorage) return page.evaluate((k) => !!localStorage.getItem(k), w.localStorage).catch(() => false);
  if (w.cookie) return (await page.context().cookies()).some((c) => c.name === w.cookie);
  if (w.url_contains) return page.url().includes(w.url_contains);
  return false;
};

export async function signInByHand(site, { minutes = 5, onWaiting = () => {} } = {}) {
  if (!site.login) throw new LoginStop(`${site.name ?? site.id} has no login set up.`);
  const profile = path.join(D.sessions, `${site.id}-window`);
  fs.mkdirSync(profile, { recursive: true });
  const ctx = await headedPersistent(profile, { viewport: { width: 430, height: 860 } });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(new URL(site.login.login_path ?? '/', site.url).href, { waitUntil: 'domcontentloaded', timeout: 90000 });
    onWaiting();
    const until = Date.now() + minutes * 60 * 1000;
    while (Date.now() < until) {
      if (await signedInNow(page, site)) {
        await page.waitForTimeout(1500);
        if (site.login.type === 'supabase-phone') {
          const v = await page.evaluate((k) => localStorage.getItem(k), site.login.storage_key);
          writeJson(file(site), { kind: 'supabase', savedAt: new Date().toISOString(), session: JSON.parse(v) });
        } else writeJson(file(site), { kind: 'state', savedAt: new Date().toISOString(), state: await ctx.storageState() });
        return true;
      }
      if (ctx.pages().length === 0) break; // the window was closed
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  } finally {
    await ctx.close().catch(() => {});
  }
}

export function signOut(site) {
  fs.rmSync(file(site), { force: true });
  fs.rmSync(path.join(D.sessions, `${site.id}-window`), { recursive: true, force: true });
}
