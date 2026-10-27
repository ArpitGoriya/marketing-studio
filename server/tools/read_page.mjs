// read_page: what's on a page, as text, with no screenshot: its headings, buttons and links, form fields (with slider
// ranges and current values) and how long it is, each marked with the screen it's on. Claude plans its shots and steps
// from this, then takes pictures only of the screens it will use.
import { z } from 'zod';
import { getBrowser } from '../engine/browser.mjs';
import { keepSession } from '../engine/login.mjs';
import { assertNoWrites, openPage, resolvePage, siteContext } from '../engine/site.mjs';
import { runLive } from '../engine/steps.mjs';
import { common, fail, step, text } from './common.mjs';

export function registerReadPage(server) {
  server.registerTool(
    'read_page',
    {
      title: 'Read a page (no picture)',
      description:
        "What's on a page, as text: headings, buttons, links, fields (sliders with their range and value), each with the screen it's on (screen 1 = what's visible without scrolling). Use it to plan which screens to capture and which steps to take, instead of taking screenshots to look around. Takes a page name, a path or any pasted link.",
      inputSchema: {
        site: common.site,
        page: common.page,
        device: common.device,
        logged_in: common.logged_in,
        steps: z.array(step).optional().describe('Done first (e.g. tap a tab), then the page is read.'),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      let context;
      try {
        const { site, url } = resolvePage(a.site, a.page);
        const device = a.device ?? 'phone';
        const b = await getBrowser();
        const made = await siteContext(b, site, { device, quality: 'preview', loggedIn: !!a.logged_in });
        context = made.context;
        const page = await openPage(context, site, url, { warm: true, loggedIn: !!a.logged_in });
        await runLive(page, site, a.steps ?? [], { touch: device === 'phone' });
        const info = await page.evaluate(() => {
          const H = innerHeight;
          const top = scrollY;
          const vis = (e) => {
            const r = e.getBoundingClientRect();
            const s = getComputedStyle(e);
            return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
          };
          const screen = (e) => Math.floor((e.getBoundingClientRect().top + top) / H) + 1;
          const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
          const seen = new Set();
          const uniq = (list) => list.filter((x) => x.t && !seen.has(x.t) && seen.add(x.t));
          const headings = uniq([...document.querySelectorAll('h1,h2,h3')].filter(vis).map((e) => ({ t: clean(e.innerText).slice(0, 80), s: screen(e), tag: e.tagName })));
          const actions = uniq(
            [...document.querySelectorAll('button,a[href],[role="button"],[role="tab"]')]
              .filter(vis)
              .map((e) => ({ t: clean(e.innerText || e.getAttribute('aria-label')).slice(0, 50), s: screen(e), kind: e.tagName === 'A' ? 'link' : 'button' })),
          );
          const fields = [...document.querySelectorAll('input:not([type=hidden]),select,textarea')]
            .filter((e) => vis(e) || e.type === 'range')
            .map((e) => {
              const label = clean(e.getAttribute('aria-label') || e.labels?.[0]?.innerText || e.getAttribute('placeholder') || e.name || '');
              const extra = e.type === 'range' ? ` ${e.min}-${e.max} (now ${e.value})` : e.tagName === 'SELECT' ? ` options: ${[...e.options].map((o) => o.text).slice(0, 8).join(' / ')}` : e.value ? ` (now "${e.value.slice(0, 30)}")` : '';
              return `${label || '(no label)'}: ${e.type || e.tagName.toLowerCase()}${extra} [screen ${screen(e)}]`;
            });
          return {
            title: document.title,
            screens: Math.ceil(document.documentElement.scrollHeight / H),
            headings,
            actions: actions.slice(0, 45),
            more: Math.max(0, actions.length - 45),
            fields,
            images: [...document.images].filter(vis).length,
          };
        });
        assertNoWrites(made.traffic);
        if (a.logged_in) await keepSession(page, site);
        const lines = [
          `${info.title} (${url}${site.adhoc ? ', a site that is not set up: public pages only' : ''}), ${device}: ${info.screens} screen(s) long, ${info.images} pictures.`,
          `Headings: ${info.headings.map((h) => `"${h.t}" [screen ${h.s}]`).join('; ') || 'none'}`,
          `Buttons and links: ${info.actions.map((x) => `"${x.t}"${x.kind === 'link' ? ' (link)' : ''} [${x.s}]`).join('; ') || 'none'}${info.more ? ` …and ${info.more} more` : ''}`,
          ...(info.fields.length ? [`Fields: ${info.fields.join('; ')}`] : []),
        ];
        return { content: [text(lines.join('\n'))] };
      } catch (e) {
        return fail(e);
      } finally {
        await context?.close().catch(() => {});
      }
    },
  );
}
