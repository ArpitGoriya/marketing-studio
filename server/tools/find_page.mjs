// find_page: where is the page someone means? Searches the site's live list of pages (its sitemap, plus the account
// menu for pages behind the login), so new pages are found without updating anything. People can also just paste a
// link; capture, record and read_page take links directly.
import { z } from 'zod';
import { accountPages, publicPages, searchPages } from '../engine/pages.mjs';
import { sessionStatus } from '../engine/login.mjs';
import { getSite } from '../engine/site.mjs';
import { fail, text } from './common.mjs';

export function registerFindPage(server) {
  server.registerTool(
    'find_page',
    {
      title: 'Find a page',
      description:
        'Find the page someone means (e.g. "mehndi booking tracker", "rent vs buy", "red bridal lehenga", "my products") in the site\'s live list of pages, so new pages are found by themselves. Leave `search` out for an overview. Use the address it gives in capture, record or read_page. If the person pasted a link, use that directly instead.',
      inputSchema: {
        search: z.string().optional().describe('What the page is about, in plain words.'),
        site: z.string().optional(),
        logged_in: z.boolean().optional().describe('Also look at pages behind the login (the account menu).'),
        refresh: z.boolean().optional().describe('Read the site again now instead of today\'s list.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ search, site: siteId, logged_in, refresh }) => {
      try {
        const site = getSite(siteId);
        const named = Object.entries(site.pages ?? {}).map(([k, v]) => ({ url: new URL(v, site.url).href, group: 'named', text: k }));
        const pub = await publicPages(site, { refresh });
        // the account menu needs the browser: given 30 s at most, so a slow sign-in never holds up the search
        const acct = logged_in || sessionStatus(site).signedIn ? await Promise.race([accountPages(site, { refresh }), new Promise((r) => setTimeout(() => r([]), 30000))]) : [];
        // one entry per page: /user/wishlist and /user/wishlist/ are the same (named pages win)
        const seen = new Set();
        const all = [...named, ...acct, ...pub].filter((p) => {
          const k = p.url.replace(/\/+(?=$|[?#])/, '');
          return !seen.has(k) && seen.add(k);
        });
        if (!search) {
          const groups = {};
          for (const p of pub) groups[p.group] = (groups[p.group] ?? 0) + 1;
          const main = pub.filter((p) => p.group === 'main pages').map((p) => new URL(p.url).pathname);
          return {
            content: [
              text(
                [
                  `${site.name ?? site.id} has ${pub.length} public pages: ${Object.entries(groups).map(([g, n]) => `${n} ${g}`).join(', ')}.`,
                  main.length ? `Main pages: ${main.join(', ')}` : '',
                  acct.length ? `Behind the login: ${acct.map((p) => `${p.text} (${new URL(p.url).pathname})`).join(', ')}` : 'Pages behind the login: search with logged_in: true to list them.',
                  'Search with words to find a specific page, product, shop or vendor.',
                ]
                  .filter(Boolean)
                  .join('\n'),
              ),
            ],
          };
        }
        const hits = searchPages(all, search);
        if (!hits.length) return { content: [text(`No page matched "${search}". Try other words, ask the person to paste the link, or refresh: true if the page is brand new.`)] };
        return {
          content: [text(`Pages matching "${search}":\n${hits.map((p) => `- ${p.url}${p.text ? ` (${p.text})` : ''} [${p.group}]`).join('\n')}`)],
        };
      } catch (e) {
        return fail(e);
      }
    },
  );
}
