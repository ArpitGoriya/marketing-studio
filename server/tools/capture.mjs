// capture: screenshots of a page, prepared the way Claude asks (scrolled, fields filled, a slider moved, a tab
// tapped), as a quick preview to check or in high quality for the final design. Several shots of the same page come
// from one page load (`shots`). Returns the pictures, their names for designs (capture:<name>) and where named things
// sit on them (for zooms and callouts).
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getBrowser } from '../engine/browser.mjs';
import { imageItem, shrink } from '../engine/imaging.mjs';
import { locate } from '../engine/locate.mjs';
import { keepSession } from '../engine/login.mjs';
import { freeName, openProject } from '../engine/project.mjs';
import { REDACT } from '../engine/redact.mjs';
import { assertNoWrites, CaptureStop, openPage, resolvePage, siteContext, trafficLine } from '../engine/site.mjs';
import { runLive } from '../engine/steps.mjs';
import { common, fail, step, target, text } from './common.mjs';

const shotShape = z.object({
  name: z.string().optional(),
  steps: z.array(step).optional().describe('Done before this shot (after the shots before it).'),
  crop: target.optional(),
  find: z.array(target).optional(),
  full_page: z.boolean().optional(),
});

// one screenshot of the page as it is now; returns what was saved and shown
async function shoot(page, shot, { quality, scale, p, url, site, device, loggedIn, notch, baseSteps, fallbackName }) {
  let clip;
  let hidden = 0;
  if (shot.crop) {
    let box = await locate(page, shot.crop, { clickable: false, container: true });
    if (!box) throw new CaptureStop(`Couldn't find ${JSON.stringify(shot.crop)} to crop to.`);
    // bring it fully on screen, then hide fixed bars and floating buttons lying over it (put back after the shot)
    await page.evaluate((b) => window.scrollBy(0, b.y - Math.max(16, (innerHeight - b.height) / 2)), box);
    await page.waitForTimeout(350);
    box = await locate(page, shot.crop, { clickable: false, container: true });
    const pad = 8;
    clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 };
    hidden = await page.evaluate((c) => {
      let n = 0;
      for (const e of document.querySelectorAll('body *')) {
        const s = getComputedStyle(e);
        if (s.position !== 'fixed' && s.position !== 'sticky') continue;
        const r = e.getBoundingClientRect();
        if (r.right > c.x && r.left < c.x + c.width && r.bottom > c.y && r.top < c.y + c.height) {
          e.dataset.msHidden = e.style.visibility || '-';
          e.style.visibility = 'hidden';
          n++;
        }
      }
      return n;
    }, clip);
  }
  const scrollY = shot.full_page ? 0 : await page.evaluate(() => scrollY);
  const found = [];
  for (const t of shot.find ?? []) {
    const box = await locate(page, t, { clickable: false });
    if (!box) {
      found.push({ target: t, found: false });
      continue;
    }
    const y = shot.full_page ? box.y + scrollY : box.y;
    found.push({ target: t, text: box.text, x: Math.round((box.x - (clip?.x ?? 0)) * scale), y: Math.round((y - (clip?.y ?? 0)) * scale), width: Math.round(box.width * scale), height: Math.round(box.height * scale) });
  }
  const buf = await page.screenshot({ type: quality === 'high' ? 'png' : 'jpeg', ...(quality === 'high' ? {} : { quality: 72 }), fullPage: !!shot.full_page, ...(clip ? { clip } : {}), animations: 'disabled', caret: 'hide' });
  if (hidden)
    await page.evaluate(() => {
      for (const e of document.querySelectorAll('[data-ms-hidden]')) {
        e.style.visibility = e.dataset.msHidden === '-' ? '' : e.dataset.msHidden;
        delete e.dataset.msHidden;
      }
    });
  const name = freeName(p, 'captures', shot.name, fallbackName);
  const file = p.file('captures', quality === 'high' ? `${name}.png` : `${name}.preview.jpg`);
  fs.writeFileSync(file, buf);
  // previews are for looking, so they come back at a readable size; a high-quality shot only needs a small check
  const shown = await shrink(buf, { mime: quality === 'high' ? 'image/png' : 'image/jpeg', max: quality === 'high' ? 520 : 1100, quality: quality === 'high' ? 60 : 70 });
  const width = Math.round((clip?.width ?? (await page.evaluate(() => document.documentElement.clientWidth))) * scale);
  const prev = p.data.captures[name];
  p.data.captures[name] = {
    site: site.id,
    page: url,
    device,
    logged_in: loggedIn,
    notch,
    steps: [...baseSteps, ...(shot.steps ?? [])],
    full_page: !!shot.full_page,
    crop: shot.crop ?? null,
    scale,
    width,
    files: { ...(prev?.files ?? {}), [quality]: path.relative(p.dir, file) },
    found,
    at: new Date().toISOString(),
  };
  const line = [
    `${quality === 'high' ? 'High-quality' : 'Preview'} capture:${name}, ${width} px wide${quality === 'high' ? ' (saved full size; the picture here is a small check)' : ' (preview size; take it in "high" before the final export)'}.`,
    ...(found.length ? [`  Positions on the ${quality === 'high' ? 'full-size' : 'preview'} picture (px): ${found.map((f) => (f.found === false ? `${JSON.stringify(f.target)} not found` : `${JSON.stringify(f.target)} at x ${f.x}, y ${f.y}, ${f.width}x${f.height}`)).join('; ')}`] : []),
  ].join('\n');
  return { line, image: imageItem(shown.buf) };
}

export function registerCapture(server) {
  server.registerTool(
    'capture',
    {
      title: 'Capture screenshots',
      description:
        'Screenshots of a page (a page name, a path, or any link the person pasted), on a phone (default) or desktop, after optional steps (scroll, set a slider, fill a field, tap a tab). ' +
        'Only capture the screens your design will use (use read_page, not screenshots, to look around). "preview" to check a screen, then "high" for the final; skip the preview when read_page already told you the screen is right. ' +
        'Several shots of the same page in one call with `shots` (each with its own steps, crop or find). Returns the pictures, names for designs (capture:<name>) and positions of anything in `find`. Nothing on the site is ever changed.',
      inputSchema: {
        ...common,
        steps: z.array(step).optional().describe('Done in order before the screenshot (before all shots).'),
        full_page: z.boolean().optional().describe('The whole page top to bottom instead of one screen.'),
        crop: target.optional().describe('Only this element (e.g. "Calculate", {"css": ".result-card"}).'),
        find: z.array(target).optional().describe('Things whose position on the picture you want, for zooms and callouts.'),
        shots: z.array(shotShape).max(8).optional().describe('Several screenshots of this page in one go. They run in order on the same page, so each starts where the last left it (add {"scroll":"top"} to go back). E.g. [{"name":"top"}, {"name":"result","steps":[{"scroll_to":"Suggested Rent"}],"crop":{"css":".result"}}].'),
        redact: z.boolean().optional().describe('Hide phone numbers and email addresses (on by default for logged-in pages).'),
      },
    },
    async (a) => {
      let context;
      try {
        const { site, url } = resolvePage(a.site, a.page);
        if (a.logged_in && site.adhoc) throw new CaptureStop(`${site.name} isn't set up in Marketing Studio, so only its public pages can be captured (logged_in needs a set-up site).`);
        const device = a.device ?? 'phone';
        const quality = a.quality ?? 'preview';
        const b = await getBrowser();
        const made = await siteContext(b, site, { device, quality, loggedIn: !!a.logged_in, notch: !!a.notch });
        context = made.context;
        const scale = made.dev.scale[quality];
        if (a.redact ?? (a.logged_in && site.redact_when_logged_in)) await context.addInitScript(REDACT);
        const shots = a.shots?.length ? a.shots : [{ name: a.name, crop: a.crop, find: a.find, full_page: a.full_page }];
        const page = await openPage(context, site, url, { warm: shots.some((s) => s.full_page), loggedIn: !!a.logged_in });
        await runLive(page, site, a.steps ?? [], { touch: device === 'phone' });
        const p = openProject(a.project);
        const results = [];
        for (const shot of shots) {
          await runLive(page, site, shot.steps ?? [], { touch: device === 'phone' });
          results.push(await shoot(page, shot, { quality, scale, p, url, site, device, loggedIn: !!a.logged_in, notch: !!a.notch, baseSteps: a.steps ?? [], fallbackName: a.name ?? a.page }));
        }
        assertNoWrites(made.traffic);
        if (a.logged_in) await keepSession(page, site);
        p.save();
        const head = `${shots.length} ${quality} capture(s) of ${url} (${device}${a.logged_in ? ', logged in' : ''}${site.adhoc ? ', a site that is not set up' : ''}), saved in project "${p.data.title}".`;
        return { content: [text([head, ...results.map((r) => r.line), trafficLine(made.traffic)].join('\n')), ...results.map((r) => r.image)] };
      } catch (e) {
        return fail(e);
      } finally {
        await context?.close().catch(() => {});
      }
    },
  );
}
