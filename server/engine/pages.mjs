// Knowing where a site's pages are, kept up to date by itself:
//  - public pages from the site's own sitemap (the list it publishes for search engines), refreshed daily
//  - pages behind the login from the links in the account menu (read while signed in), refreshed daily
// plus the named pages in the site profile. Search matches the words in each page's address and link text.
import fs from 'node:fs';
import path from 'node:path';
import { D, readJson, writeJson } from '../paths.mjs';
import { getBrowser } from './browser.mjs';
import { openPage, siteContext } from './site.mjs';

const DAY = 24 * 3600 * 1000;
const cacheFile = (site, kind) => path.join(D.tmp, `pages-${site.id}-${kind}.json`);
const fresh = (f) => fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < DAY;

const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));

export async function publicPages(site, { refresh = false } = {}) {
  const f = cacheFile(site, 'public');
  if (!refresh && fresh(f)) return readJson(f, []);
  const index = new URL(site.sitemap ?? '/sitemap.xml', site.url).href;
  const get = async (u) => {
    const r = await fetch(u, { headers: { 'x-marketing-studio': '1' } }).catch(() => null);
    return r?.ok ? r.text() : '';
  };
  const top = await get(index);
  const out = [];
  const children = /<sitemapindex/i.test(top) ? locs(top) : [];
  if (!children.length) for (const u of locs(top)) out.push({ url: u, group: 'pages' });
  for (const child of children) {
    const group = (child.match(/sitemap-([a-z0-9-]+)\.xml/i)?.[1] ?? 'pages').replace(/^main$/, 'main pages');
    for (const u of locs(await get(child))) out.push({ url: u, group });
  }
  if (out.length) writeJson(f, out);
  return out.length ? out : readJson(f, []);
}

// the account menu's links, read while signed in (pages behind the login aren't in any sitemap)
export async function accountPages(site, { refresh = false } = {}) {
  const f = cacheFile(site, 'account');
  if (!refresh && fresh(f)) return readJson(f, []);
  if (!site.login) return [];
  let context;
  try {
    const b = await getBrowser();
    ({ context } = await siteContext(b, site, { device: 'phone', loggedIn: true }));
    const out = [];
    for (const p of site.account_pages ?? ['/user']) {
      const page = await openPage(context, site, new URL(p, site.url).href, { loggedIn: true });
      const links = await page.evaluate((origin) => {
        const seen = new Set();
        return [...document.querySelectorAll('a[href]')]
          .map((a) => ({ url: new URL(a.getAttribute('href'), location.href).href, text: [a.innerText, a.getAttribute('aria-label'), a.getAttribute('title')].map((t) => (t || '').replace(/\s+/g, ' ').trim()).find((t) => /[a-z]{2}/i.test(t)) || (new URL(a.href).pathname.split('/').filter(Boolean).pop() || '').replace(/-/g, ' ') }))
          .filter((l) => l.url.startsWith(origin) && l.text && !seen.has(l.url) && seen.add(l.url));
      }, new URL(site.url).origin);
      for (const l of links) if (/\/user\b|\/my-|\/vendor|\/shop\/|\/settings|\/wishlist/.test(l.url)) out.push({ url: l.url, group: 'logged in', text: l.text });
      await page.close();
    }
    if (out.length) writeJson(f, out);
    return out;
  } catch (e) {
    console.error(`[marketing-studio] account pages: ${e.message}`);
    return readJson(f, []); // not signed in, or the site is down: the last list we had
  } finally {
    await context?.close().catch(() => {});
  }
}

const words = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/https?:\/\/[^/]+/, '')
    .split(/[^a-z0-9ऀ-ॿ]+/)
    .filter(Boolean);

// best matches for what someone said ("mehndi booking", "rent vs buy", "red lehenga", "my products")
export function searchPages(all, query, limit = 15) {
  const q = words(query).filter((w) => w.length > 1);
  if (!q.length) return [];
  const scored = all
    .map((p) => {
      const w = new Set([...words(p.url), ...words(p.text), ...words(p.group)]);
      const hay = `${p.url} ${p.text ?? ''}`.toLowerCase();
      let score = 0;
      for (const t of q) score += w.has(t) ? 3 : hay.includes(t) ? 1 : 0;
      // main pages and tools first, then shorter addresses
      return { ...p, score: score ? score + (/main|logged/.test(p.group) ? 2 : 0) - p.url.length / 400 : 0 };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
