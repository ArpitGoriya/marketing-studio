// capture: a screenshot of a page, prepared the way Claude asks (scrolled, fields filled, a tab tapped), as a quick
// preview to look at or in high quality for the final design. Returns the picture, its name for designs
// (capture:<name>) and where named things sit on it (for zooms and callouts).
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getBrowser } from '../engine/browser.mjs';
import { imageItem, shrink } from '../engine/imaging.mjs';
import { locate } from '../engine/locate.mjs';
import { keepSession } from '../engine/login.mjs';
import { freeName, openProject } from '../engine/project.mjs';
import { REDACT } from '../engine/redact.mjs';
import { assertNoWrites, CaptureStop, getSite, openPage, pageUrl, siteContext, trafficLine } from '../engine/site.mjs';
import { runLive } from '../engine/steps.mjs';
import { common, fail, step, target, text } from './common.mjs';

export function registerCapture(server) {
  server.registerTool(
    'capture',
    {
      title: 'Capture a screenshot',
      description:
        'Take a screenshot of a page of the site, on a phone (default) or desktop, after optional steps (scroll, fill a field, tap a tab). Start with quality "preview" to look and adjust, then take "high" for the final design. ' +
        'Returns the picture, a name to use in designs (capture:<name>), and the positions of anything listed in `find`. Nothing on the site is ever changed.',
      inputSchema: {
        ...common,
        steps: z.array(step).optional().describe('Done in order before the screenshot.'),
        full_page: z.boolean().optional().describe('The whole page top to bottom instead of one screen.'),
        crop: target.optional().describe('Only this element (e.g. "Calculate", {"css": ".result-card"}).'),
        find: z.array(target).optional().describe('Things whose position on the picture you want, for zooms and callouts.'),
        redact: z.boolean().optional().describe('Hide phone numbers and email addresses (on by default for logged-in pages).'),
      },
    },
    async (a) => {
      let context;
      try {
        const site = getSite(a.site);
        const url = pageUrl(site, a.page);
        const device = a.device ?? 'phone';
        const quality = a.quality ?? 'preview';
        const b = await getBrowser();
        const made = await siteContext(b, site, { device, quality, loggedIn: !!a.logged_in });
        context = made.context;
        const scale = made.dev.scale[quality];
        if (a.redact ?? (a.logged_in && site.redact_when_logged_in)) await context.addInitScript(REDACT);
        const page = await openPage(context, site, url, { warm: !!a.full_page, loggedIn: !!a.logged_in });
        await runLive(page, site, a.steps ?? [], { touch: device === 'phone' });

        const scrollY = a.full_page ? 0 : await page.evaluate(() => scrollY);
        let clip;
        if (a.crop) {
          const box = await locate(page, a.crop, { clickable: false });
          if (!box) throw new CaptureStop(`Couldn't find ${JSON.stringify(a.crop)} to crop to.`);
          const pad = 8;
          clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 };
        }
        const found = [];
        for (const t of a.find ?? []) {
          const box = await locate(page, t, { clickable: false });
          if (!box) {
            found.push({ target: t, found: false });
            continue;
          }
          const y = a.full_page ? box.y + scrollY : box.y;
          const ox = clip?.x ?? 0;
          const oy = clip?.y ?? 0;
          found.push({ target: t, text: box.text, x: Math.round((box.x - ox) * scale), y: Math.round((y - oy) * scale), width: Math.round(box.width * scale), height: Math.round(box.height * scale) });
        }
        const buf = await page.screenshot({ type: quality === 'high' ? 'png' : 'jpeg', ...(quality === 'high' ? {} : { quality: 72 }), fullPage: !!a.full_page, ...(clip ? { clip } : {}), animations: 'disabled', caret: 'hide' });
        assertNoWrites(made.traffic);
        if (a.logged_in) await keepSession(page, site);

        const p = openProject(a.project);
        const name = freeName(p, 'captures', a.name, a.page);
        const file = p.file('captures', quality === 'high' ? `${name}.png` : `${name}.preview.jpg`);
        fs.writeFileSync(file, buf);
        const shown = await shrink(buf, { mime: quality === 'high' ? 'image/png' : 'image/jpeg', max: 1100 });
        const dims = await page.evaluate(() => ({ w: document.documentElement.clientWidth }));
        const width = Math.round((clip?.width ?? dims.w) * scale);
        const prev = p.data.captures[name];
        p.data.captures[name] = {
          site: site.id,
          page: url,
          device,
          logged_in: !!a.logged_in,
          steps: a.steps ?? [],
          full_page: !!a.full_page,
          crop: a.crop ?? null,
          scale,
          width,
          files: { ...(prev?.files ?? {}), [quality]: path.relative(p.dir, file) },
          found,
          at: new Date().toISOString(),
        };
        p.save();
        const lines = [
          `${quality === 'high' ? 'High-quality' : 'Preview'} capture "${name}" of ${url} (${device}${a.logged_in ? ', logged in' : ''}), ${width} px wide${quality === 'high' ? '' : ' (preview size)'}.`,
          `Use it in designs as capture:${name}${quality === 'preview' ? ' (take it again with quality "high" before the final export)' : ''}.`,
          ...(found.length ? [`Positions on the ${quality === 'high' ? 'full-size' : 'preview'} picture (px): ${found.map((f) => (f.found === false ? `${JSON.stringify(f.target)} not found` : `${JSON.stringify(f.target)} at x ${f.x}, y ${f.y}, ${f.width}x${f.height}`)).join('; ')}`] : []),
          trafficLine(made.traffic),
          `Saved: ${file}`,
        ];
        return { content: [text(lines.join('\n')), imageItem(shown.buf)] };
      } catch (e) {
        return fail(e);
      } finally {
        await context?.close().catch(() => {});
      }
    },
  );
}
