// read_page: what's on a page, as text, with no screenshot: its headings, buttons and links, form fields (with slider
// ranges and current values) and how long it is, each marked with the screen it's on. Claude plans its shots and steps
// from this, then takes pictures only of the screens it will use. Picture and icon buttons with no text are listed by
// where they go and where to tap them. Runs as a job, so the call answers within ~25 s.
import { z } from 'zod';
import { getBrowser } from '../engine/browser.mjs';
import { jobAnswer, quickJob } from '../engine/jobs.mjs';
import { keepSession } from '../engine/login.mjs';
import { assertNoWrites, openPage, resolvePage, siteContext } from '../engine/site.mjs';
import { runLive } from '../engine/steps.mjs';
import { common, fail, step, text } from './common.mjs';

// kept short: a huge answer helps nobody and can stall the chat app
const MAX = 12000;

export function registerReadPage(server) {
  server.registerTool(
    'read_page',
    {
      title: 'Read a page (no picture)',
      description:
        "What's on a page, as text: headings, buttons, links (picture and icon links too, by where they go and where to tap them), fields (sliders with their range and value), each with the screen it's on (screen 1 = what's visible without scrolling). Use it to plan which screens to capture and which steps to take, instead of taking screenshots to look around. Takes a page name, a path or any pasted link.",
      inputSchema: {
        site: common.site,
        page: common.page,
        device: common.device,
        logged_in: common.logged_in,
        steps: z.array(step).optional().describe('Done first (e.g. tap a tab), then the page is read. Each tap reports what it did.'),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      try {
        return jobAnswer(await quickJob('read', (update, job) => doRead(a, update, job), { limit: 150, label: 'page reading' }), fail);
      } catch (e) {
        return fail(e);
      }
    },
  );
}

async function doRead(a, update, job) {
  let context;
  try {
    const { site, url } = resolvePage(a.site, a.page);
    const device = a.device ?? 'phone';
    const b = await getBrowser();
    const made = await siteContext(b, site, { device, quality: 'preview', loggedIn: !!a.logged_in });
    context = job.own(made.context);
    update(0.2, 'opening the page');
    const page = await openPage(context, site, url, { warm: 6, loggedIn: !!a.logged_in });
    const notes = await runLive(page, site, a.steps ?? [], { touch: device === 'phone', onStep: (m) => update(undefined, m) });
    update(0.8, 'reading the page');
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
      const uniq = (list) => list.filter((x) => x.t && !seen.has(`${x.t}${x.x ?? ''}`) && seen.add(`${x.t}${x.x ?? ''}`));
      // a picture button's name: its image's alt or file name, or the file of a CSS mask/background (vendors.svg)
      const picture = (e) => {
        for (const x of [e, ...e.querySelectorAll('*')].slice(0, 30)) {
          if (x.tagName === 'IMG' && (x.alt || x.getAttribute('src'))) return x.alt || x.getAttribute('src');
          const s = getComputedStyle(x);
          const m = String(s.maskImage || s.webkitMaskImage || '').match(/url\(["']?([^"')]+)/) || String(s.backgroundImage || '').match(/url\(["']?([^"')]+)/);
          if (m) return m[1];
        }
        return '';
      };
      const fileName = (u) => (u || '').split(/[?#]/)[0].split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
      const headings = uniq([...document.querySelectorAll('h1,h2,h3')].filter(vis).map((e) => ({ t: clean(e.innerText).slice(0, 80), s: screen(e), tag: e.tagName })));
      const actions = uniq(
        [...document.querySelectorAll('button,a[href],[role="button"],[role="tab"]')].filter(vis).map((e) => {
          const r = e.getBoundingClientRect();
          const t = clean(e.innerText || e.getAttribute('aria-label') || e.getAttribute('title') || e.querySelector('img[alt]')?.alt).slice(0, 50);
          const href = e.tagName === 'A' ? e.getAttribute('href') : null;
          if (t) return { t, s: screen(e), kind: e.tagName === 'A' ? 'link' : 'button' };
          // a picture or icon with no text: named by its picture and where it goes, with the point to tap (page position)
          const pic = fileName(picture(e));
          return { t: `[picture ${e.tagName === 'A' ? 'link' : 'button'}${pic ? ` "${pic}"` : ''}${href ? ` to ${href}` : ''}]`, s: screen(e), kind: 'picture', x: Math.round(r.left + r.width / 2), y: Math.round(r.top + top + r.height / 2) };
        }),
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
        actions: actions.slice(0, 50),
        more: Math.max(0, actions.length - 50),
        fields,
        images: [...document.images].filter(vis).length,
      };
    });
    assertNoWrites(made.traffic);
    if (a.logged_in) await keepSession(page, site);
    const action = (x) => (x.kind === 'picture' ? `${x.t} at (${x.x}, ${x.y}) [${x.s}]` : `"${x.t}"${x.kind === 'link' ? ' (link)' : ''} [${x.s}]`);
    const lines = [
      `${info.title} (${url}${site.adhoc ? ', a site that is not set up: public pages only' : ''}), ${device}: ${info.screens} screen(s) long, ${info.images} pictures.`,
      `Headings: ${info.headings.map((h) => `"${h.t}" [screen ${h.s}]`).join('; ') || 'none'}`,
      `Buttons and links: ${info.actions.map(action).join('; ') || 'none'}${info.more ? ` …and ${info.more} more` : ''}`,
      ...(info.actions.some((x) => x.kind === 'picture') ? ['Picture buttons and links: tap them by their picture\'s name as text (e.g. "vendors"), by {"href": "<where it goes>"}, or on screen 1 by the point {"x": .., "y": ..}.'] : []),
      ...(info.fields.length ? [`Fields: ${info.fields.join('; ')}`] : []),
      ...(notes.length ? [`Steps: ${notes.join('; ')}.`] : []),
    ];
    const all = lines.join('\n');
    return { content: [text(all.length > MAX ? `${all.slice(0, MAX)}\n…(cut here; the page has more: read it after a step that narrows it)` : all)] };
  } finally {
    await context?.close().catch(() => {});
  }
}
