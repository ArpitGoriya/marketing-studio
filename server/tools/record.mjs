// record: a screen recording of the site, frame by frame (smooth whatever the laptop's speed), from steps Claude
// writes: scroll, tap, type, wait. Preview: 12 frames a second at small size, a contact sheet to look at and a small
// MP4. High: 60 frames a second, sharp, for the final video. Long ones keep running as a job (see wait).
import path from 'node:path';
import { z } from 'zod';
import { getBrowser } from '../engine/browser.mjs';
import { contactSheet, imageItem } from '../engine/imaging.mjs';
import { jobAnswer, startJob, waitJob } from '../engine/jobs.mjs';
import { keepSession } from '../engine/login.mjs';
import { freeName, openProject } from '../engine/project.mjs';
import { Recorder } from '../engine/recorder.mjs';
import { REDACT } from '../engine/redact.mjs';
import { assertNoWrites, CaptureStop, getSite, inMaintenance, openPage, pageUrl, siteContext, trafficLine } from '../engine/site.mjs';
import { runLive, runRecorded } from '../engine/steps.mjs';
import { withStudio } from '../engine/studio.mjs';
import { common, fail, step, text } from './common.mjs';

const FPS = { preview: 12, high: 60 };

async function doRecord(a, update) {
  let context;
  try {
    const site = getSite(a.site);
    const url = pageUrl(site, a.page);
    const device = a.device ?? 'phone';
    const quality = a.quality ?? 'preview';
    const fps = a.fps ?? FPS[quality];
    const b = await getBrowser();
    const made = await siteContext(b, site, { device, quality, loggedIn: !!a.logged_in });
    context = made.context;
    if (a.redact ?? (a.logged_in && site.redact_when_logged_in)) await context.addInitScript(REDACT);
    update(0.02, 'opening the page');
    const page = await openPage(context, site, url, { clock: true, warm: true });
    await runLive(page, site, a.setup ?? [], { touch: device === 'phone' });

    const p = openProject(a.project);
    const name = freeName(p, 'clips', a.name, a.page);
    const dir = p.file('clips', `${name}${quality === 'preview' ? '.preview' : ''}`);
    const rec = new Recorder(page, dir, {
      fps,
      quality: quality === 'high' ? 88 : 70,
      check: (pg) => {
        if (inMaintenance(site, pg)) throw new CaptureStop('The site went into maintenance mode during the recording, so it was stopped.');
      },
    });
    const planned = Math.max(1, estimateSeconds(a.steps ?? []) * fps);
    rec.onFrame = (n) => n % 10 === 0 && update(0.05 + 0.75 * Math.min(1, n / planned), `recording frame ${n}`);
    await runRecorded(rec, site, a.steps ?? [], { touch: device === 'phone' });
    if (!rec.n) throw new CaptureStop('Nothing was recorded: add steps like {"wait": 2} or {"scroll": "bottom", "seconds": 3}.');
    assertNoWrites(made.traffic);
    if (a.logged_in) await keepSession(page, site);
    const files = rec.files();
    const vp = page.viewportSize();
    const scale = made.dev.scale[quality];
    await context.close().catch(() => {});
    context = null;

    update(0.82, 'making the contact sheet');
    const times = files.map((_, i) => `${(i / fps).toFixed(1)} s`);
    const sheet = await contactSheet(files, { title: `${name}: ${(rec.n / fps).toFixed(1)} s at ${fps} fps, ${url}`, times });
    update(0.86, 'encoding the video');
    const mp4 = path.join(path.dirname(dir), `${name}${quality === 'preview' ? '.preview' : ''}.mp4`);
    const stats = await withStudio([dir], (s) =>
      s.encode({ frames: files, fps, width: Math.round(vp.width * scale), height: Math.round(vp.height * scale), bitrate: quality === 'high' ? 14e6 : 2.5e6, outFile: mp4 }),
    );

    const prev = p.data.clips[name];
    p.data.clips[name] = {
      ...(prev ?? {}),
      site: site.id,
      page: url,
      device,
      logged_in: !!a.logged_in,
      setup: a.setup ?? [],
      steps: a.steps ?? [],
      [quality]: { frames: path.relative(p.dir, dir), count: rec.n, fps, seconds: +(rec.n / fps).toFixed(2), width: stats.width, height: stats.height, mp4: path.relative(p.dir, mp4) },
      taps: rec.taps.map((t) => ({ label: t.label, at: +t.at.toFixed(2) })),
      marks: rec.marks.map((m) => ({ label: m.label, at: +m.at.toFixed(2) })),
      at: new Date().toISOString(),
    };
    p.save();
    const lines = [
      `${quality === 'high' ? 'High-quality' : 'Preview'} recording "${name}": ${(rec.n / fps).toFixed(1)} s at ${fps} fps, ${stats.width}x${stats.height}, of ${url} (${device}${a.logged_in ? ', logged in' : ''}).`,
      `Use it in videos as clip:${name}${quality === 'preview' ? ' (record it again with quality "high" before the final export)' : ''}.`,
      ...(rec.taps.length ? [`Taps: ${rec.taps.map((t) => `"${t.label}" at ${t.at.toFixed(2)} s`).join(', ')}`] : []),
      ...(rec.marks.length ? [`Marks: ${rec.marks.map((m) => `${m.label} at ${m.at.toFixed(2)} s`).join(', ')}`] : []),
      trafficLine(made.traffic),
      `Saved: ${mp4}`,
      'The picture below shows 12 moments from it.',
    ];
    return { content: [text(lines.join('\n')), imageItem(sheet)] };
  } finally {
    await context?.close().catch(() => {});
  }
}

function estimateSeconds(steps) {
  let s = 0;
  for (const st of steps) {
    if (st.wait) s += Number(st.wait) || 1;
    else if (st.scroll !== undefined || st.scroll_to) s += st.seconds ?? st.scroll?.seconds ?? 2;
    else if (st.scroll_in) s += st.scroll_in.seconds ?? 2;
    else if (st.tap) s += 0.15 + (st.after ?? 0.5);
    else if (st.fill) s += (st.fill.seconds ?? 1.5) + 0.4;
    else if (st.wait_for) s += st.wait_for.max ?? 2;
    else s += 0.4;
  }
  return s;
}

export function registerRecord(server) {
  server.registerTool(
    'record',
    {
      title: 'Record the screen',
      description:
        'Record a page of the site as a smooth video, on a phone (default) or desktop, from steps you write: scroll, tap, type into a field, wait. Each step takes time in the video (e.g. {"scroll": "bottom", "seconds": 3}, {"fill": {"field": "Product price", "value": "5000", "seconds": 1.5}}, {"wait": 1}). ' +
        'Start with quality "preview" (a quick look: 12 moments in one picture, plus a small video), then "high" for the final (60 frames a second). Returns clip:<name> for videos, and when each tap happened. Nothing on the site is ever changed.',
      inputSchema: {
        ...common,
        setup: z.array(step).optional().describe('Done before recording starts, not filmed (e.g. scroll to the calculator first).'),
        steps: z.array(step).describe('What happens in the recording, in order. Each step takes time.'),
        fps: z.number().int().min(10).max(60).optional().describe('Frames per second (preview 12, high 60).'),
        redact: z.boolean().optional().describe('Hide phone numbers and email addresses (on by default for logged-in pages).'),
      },
    },
    async (a) => {
      const job = startJob('record', (update) => doRecord(a, update));
      await waitJob(job, 40);
      return jobAnswer(job, fail);
    },
  );
}
