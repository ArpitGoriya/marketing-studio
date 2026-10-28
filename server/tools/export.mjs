// export: turn Claude's own design into finished files. Claude writes the HTML/CSS (one page per slide, or one
// animated page for a video) using capture:, clip:, brand: and inbox: references; this renders it with the real
// screens and the brand fonts. Images: PNG per slide. Video: a fast preview first, then the final MP4, with the
// voiceover and music mixed in (a supplied track, or music Claude writes as a score, engine/music.mjs). Where the
// chat app can, the result shows in the chat in the viewer (viewer.mjs).
// check: the same render, privately, for Claude: small pictures and the layout check (engine/checks.mjs), nothing
// saved and nothing shown to the person, so Claude fixes its own mistakes before the one export the person sees.
import fs from 'node:fs';
import path from 'node:path';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { describeMoments, describeSlides, emptyFinding, lintOptions } from '../engine/checks.mjs';
import { exportFrames, exportImages, getBrand, prepare } from '../engine/exporter.mjs';
import { contactSheet, emptyBands, imageItem, shrink } from '../engine/imaging.mjs';
import { jobAnswer, startJob, JOB_WAIT, waitJob } from '../engine/jobs.mjs';
import { instrumentList, planScore, scoreShape } from '../engine/music.mjs';
import { openFolder } from '../engine/open.mjs';
import { openProject } from '../engine/project.mjs';
import { CaptureStop } from '../engine/site.mjs';
import { withStudio } from '../engine/studio.mjs';
import { D, INBOX, slug } from '../paths.mjs';
import { fail, text } from './common.mjs';
import { appOnly, existingProject, showsViewer, VIEW_KEY, viewData, viewerUi } from './viewer.mjs';

function sizeOf(brand, a) {
  if (a.width && a.height) return [a.width, a.height];
  const named = brand.sizes?.[a.size];
  if (named) return named;
  const m = /^(\d{3,4})\s*[x×]\s*(\d{3,4})$/.exec(a.size ?? '');
  if (m) return [Number(m[1]), Number(m[2])];
  throw new CaptureStop(`Say the size: width and height in px, or one of ${Object.keys(brand.sizes ?? {}).join(', ')}.`);
}

// our own words, checked against the brand's "never say" list (prices, number claims, …): warnings, not blocks
function copyWarnings(brand, sources) {
  const words = sources.map((s) => s.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')).join(' \n ');
  return (brand.never_say ?? []).flatMap((r) => {
    const m = words.match(new RegExp(r.pattern, r.flags ?? ''));
    return m ? [`"${m[0]}": ${r.why}`] : [];
  });
}

const inboxFile = (ref) => {
  if (!ref) return null;
  const name = String(ref).replace(/^inbox:/, '');
  const f = path.join(INBOX, name);
  if (!fs.existsSync(f)) throw new CaptureStop(`There's no "${name}" in the Inbox (${INBOX}). Use the inbox tool to see what's there.`);
  return f;
};

// the layout check's findings -> the lines Claude reads
const checkLines = (lines) => (lines.length ? ['Layout check (fix these, unless one is on purpose):', ...lines] : ['Layout check: nothing to fix.']);

async function slideFindings(files, o) {
  const bands = await emptyBands(files.map((f) => f.buf));
  return describeSlides(files.map((f, i) => [...f.findings, emptyFinding(bands[i])].filter(Boolean)), o);
}

async function momentFindings(moments, o) {
  const bands = await emptyBands(moments.map((m) => m.file));
  return describeMoments(moments.map((m, i) => ({ ...m, list: [...m.list, emptyFinding(bands[i])].filter(Boolean) })), o);
}

// music for a video: a supplied track (inbox:<file>) or a score Claude wrote; checked before any rendering
function musicFor(a, duration) {
  if (!a.music) return { music: null, lines: [] };
  if (typeof a.music === 'string') return { music: { file: inboxFile(a.music), start: a.music_start ?? 0, volume_db: a.music_volume_db ?? 0 }, lines: [] };
  const { plan, lines } = planScore(a.music, { duration });
  return { music: { plan, volume_db: a.music_volume_db ?? 0 }, lines };
}

async function doImages(a, brand, update) {
  const [width, height] = sizeOf(brand, a);
  if (!a.pages?.length) throw new CaptureStop('Give the slides as `pages`: one HTML page per slide.');
  const p = openProject(a.project);
  const name = slug(a.name, 'post');
  const { pages, previewOnly } = prepare(p, brand, a.pages, { width, height });
  const outDir = p.file('exports', name);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'source'), { recursive: true });
  a.pages.forEach((h, i) => fs.writeFileSync(path.join(outDir, 'source', `page-${String(i + 1).padStart(2, '0')}.html`), h));
  const lint = lintOptions(p, { width, height, brand });
  const { files, blocked } = await exportImages({ project: p, brand, pages, width, height, scale: a.scale ?? 1, outDir, lint, onProgress: (f) => update(f * 0.85, 'rendering slides') });
  update(0.9, 'checking the layout');
  const found = await slideFindings(files, lint);
  p.data.exports[name] = { kind: 'images', width, height, files: files.map((f) => path.relative(p.dir, f.file)), caption: a.caption ?? null, at: new Date().toISOString() };
  // what Claude checks (small) and what the viewer in the chat shows (sharper, still light)
  const previews = [];
  const views = [];
  for (const [i, f] of files.entries()) {
    if (i < 10) previews.push(imageItem((await shrink(f.buf, { max: 720, quality: 72 })).buf, 'image/jpeg', { forClaude: true }));
    const v = path.join(outDir, 'source', `view-${String(i + 1).padStart(2, '0')}.jpg`);
    fs.writeFileSync(v, (await shrink(f.buf, { max: 1080, quality: 85 })).buf);
    views.push(path.relative(p.dir, v));
  }
  p.data.exports[name].views = views;
  p.save();
  const warn = copyWarnings(brand, a.pages);
  const lines = [
    `Exported ${files.length} slide(s) "${name}" at ${width}x${height} px: ${outDir}`,
    ...(previewOnly.length ? [`Note: ${previewOnly.join(', ')} used preview-quality captures. For the final files, capture them again with quality "high" and export again.`] : []),
    ...(warn.length ? [`Brand copy check: ${warn.join('; ')}`] : []),
    ...(blocked.length ? [`Blocked from the internet (the design must use brand fonts and project files): ${blocked.join(', ')}`] : []),
    ...checkLines(found),
    a.viewer
      ? 'The slides are showing in the chat, where the person can swipe through them and copy them. Every export adds another copy to the chat, so export again only for a change the person asks for (mention anything the check found; next time fix it with check before exporting).'
      : a.open === false
        ? ''
        : 'The folder is open.',
  ].filter(Boolean);
  if (a.open ?? !a.viewer) openFolder(outDir);
  return { content: [text(lines.join('\n')), ...previews], _meta: { [VIEW_KEY]: viewData(p, name) } };
}

async function doVideo(a, brand, update) {
  const [width, height] = sizeOf(brand, a);
  if (!a.html) throw new CaptureStop('Give the video as `html`: one page whose animation runs from 0 to `duration` seconds.');
  if (!(a.duration > 0)) throw new CaptureStop('Say how long the video is: `duration` in seconds.');
  if (a.duration > 180) throw new CaptureStop('Videos up to 3 minutes only.');
  const final = a.quality === 'final';
  const fps = final ? (a.fps ?? 30) : 15;
  const scale = final ? 1 : 0.5;
  const p = openProject(a.project);
  const name = slug(a.name, 'video');
  const { pages, previewOnly } = prepare(p, brand, [a.html], { width, height, video: true });
  const voice = inboxFile(a.voiceover);
  const { music, lines: musicLines } = musicFor(a, a.duration);
  const outDir = p.file('exports', name);
  fs.mkdirSync(path.join(outDir, 'source'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'source', 'video.html'), a.html);
  const framesDir = path.join(D.tmp, `${p.id}-${name}-${final ? 'final' : 'preview'}`);
  const lint = lintOptions(p, { width, height, video: true, brand });
  update(0.02, 'rendering frames');
  const { files, moments, blocked } = await exportFrames({ project: p, brand, page: pages[0], width, height, scale, fps, duration: a.duration, framesDir, lint, onProgress: (f) => update(0.02 + 0.76 * f, `rendering frame ${Math.round(f * a.duration * fps)} of ${Math.round(a.duration * fps)}`) });
  update(0.8, music?.plan ? 'playing the music and encoding the video' : 'encoding the video');
  const out = path.join(outDir, `${name}${final ? '' : '.preview'}.mp4`);
  const view = final ? path.join(outDir, 'source', 'view.mp4') : null;
  const stats = await withStudio([framesDir, INBOX], async (s) => {
    const audio = voice || music ? { voice: voice && { file: voice, start: a.voiceover_start ?? 0 }, music, target: -14 } : null;
    const made = await s.encode({
      frames: files,
      fps,
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      bitrate: final ? (width * height > 2e6 ? 12e6 : 8e6) : 2e6,
      audio,
      outFile: out,
    });
    if (view) {
      update(0.9, 'making a light copy for the chat');
      await s.encode({ frames: files, fps, width: Math.round(width / 2), height: Math.round(height / 2), bitrate: 2.5e6, audio, outFile: view });
    }
    return made;
  });
  update(0.95, 'checking the layout');
  const found = await momentFindings(moments, lint);
  const times = files.map((_, i) => `${(i / fps).toFixed(1)} s`);
  const sheet = await contactSheet(files, { title: `${name}: ${a.duration} s, ${stats.width}x${stats.height}, ${fps} fps${final ? '' : ' (preview)'}`, times, cell: width > height ? 220 : 150, cols: width > height ? 4 : 6 });
  fs.rmSync(framesDir, { recursive: true, force: true });
  // everything but the page itself, so the viewer's "HD version" button can make the final from a preview
  const settings = Object.fromEntries(Object.entries(a).filter(([k]) => !['html', 'project', 'name', 'quality', 'viewer', 'open', 'kind'].includes(k)));
  p.data.exports[name] = {
    ...(p.data.exports[name] ?? {}),
    kind: 'video',
    width,
    height,
    duration: a.duration,
    [final ? 'final' : 'preview']: path.relative(p.dir, out),
    latest: final ? 'final' : 'preview',
    ...(view ? { view_final: path.relative(p.dir, view) } : {}),
    settings,
    caption: a.caption ?? null,
    preview_captures: previewOnly,
    at: new Date().toISOString(),
  };
  p.save();
  const warn = copyWarnings(brand, [a.html]);
  const lines = [
    `${final ? 'Final video' : 'Preview video'} "${name}": ${a.duration} s, ${stats.width}x${stats.height}, ${fps} fps, ${(stats.bytes / 1048576).toFixed(1)} MB${stats.audio ? `, sound at ${stats.audio.lufs} LUFS (peak ${stats.audio.peak} dB)` : ', no sound'}.`,
    `Saved: ${out}`,
    ...musicLines,
    ...(final
      ? []
      : [
          a.viewer
            ? 'This is a quick preview (half size). The viewer has an "HD version" button that makes the final from it; export again with quality "final" only if the person asks you in the chat.'
            : 'This is a quick preview (half size). When it looks right, export again with quality "final".',
        ]),
    ...(previewOnly.length ? [`Note: ${previewOnly.join(', ')} used preview-quality captures or recordings. Take them again in high quality before the final.`] : []),
    ...(warn.length ? [`Brand copy check: ${warn.join('; ')}`] : []),
    ...(blocked.length ? [`Blocked from the internet (the design must use brand fonts and project files): ${blocked.join(', ')}`] : []),
    ...checkLines(found),
    'The picture shows 12 moments from it (for you to check).',
    ...(a.viewer ? ['The video is playing in the chat, where the person can watch and copy it. Every export adds another copy to the chat, so export again only for a change the person asks for.'] : []),
  ];
  if (a.open ?? !a.viewer) openFolder(outDir);
  return { content: [text(lines.join('\n')), imageItem(sheet, 'image/jpeg', { forClaude: true })], _meta: { [VIEW_KEY]: viewData(p, name) } };
}

// check: render privately and report (nothing saved, nothing shown to the person)
async function doCheck(a, brand, update) {
  const [width, height] = sizeOf(brand, a);
  const p = openProject(a.project);
  if (a.kind === 'images') {
    if (!a.pages?.length) throw new CaptureStop('Give the slides as `pages`: one HTML page per slide.');
    const { pages, previewOnly } = prepare(p, brand, a.pages, { width, height });
    const lint = lintOptions(p, { width, height, brand });
    const { files, blocked } = await exportImages({ project: p, brand, pages, width, height, scale: 1, outDir: null, lint, onProgress: (f) => update(f * 0.8, 'rendering slides') });
    const found = await slideFindings(files, lint);
    const pics = [];
    for (const f of files.slice(0, 10)) pics.push(imageItem((await shrink(f.buf, { max: 560, quality: 70 })).buf, 'image/jpeg', { forClaude: true }));
    const warn = copyWarnings(brand, a.pages);
    const lines = [
      `Checked ${files.length} slide(s) at ${width}x${height} px (nothing saved; the person doesn't see this).`,
      ...(previewOnly.length ? [`Preview-quality captures: ${previewOnly.join(', ')} (take them in "high" before you export).`] : []),
      ...(warn.length ? [`Brand copy check: ${warn.join('; ')}`] : []),
      ...(blocked.length ? [`Blocked from the internet: ${blocked.join(', ')}`] : []),
      ...checkLines(found),
      found.length ? 'Fix what needs fixing and check again, then export once.' : 'Ready to export.',
    ];
    return { content: [text(lines.join('\n')), ...pics] };
  }
  if (!a.html) throw new CaptureStop('Give the video as `html`.');
  if (!(a.duration > 0)) throw new CaptureStop('Say how long the video is: `duration` in seconds.');
  const { pages, previewOnly } = prepare(p, brand, [a.html], { width, height, video: true });
  if (a.voiceover) inboxFile(a.voiceover);
  const { lines: musicLines } = musicFor(a, a.duration);
  const n = Math.min(12, Math.max(4, Math.ceil(a.duration)));
  const even = Array.from({ length: n }, (_, i) => +(((i + 0.5) * a.duration) / n).toFixed(2));
  const times = [...new Set([...even, ...(a.at ?? []).filter((t) => t >= 0 && t < a.duration).slice(0, 6)])].sort((x, y) => x - y);
  const framesDir = path.join(D.tmp, `${p.id}-check-${Date.now()}`);
  const lint = lintOptions(p, { width, height, video: true, brand });
  try {
    const { moments, blocked } = await exportFrames({ project: p, brand, page: pages[0], width, height, scale: 0.5, fps: 30, duration: a.duration, framesDir, lint, times, onProgress: (f) => update(f * 0.85, 'rendering moments') });
    const found = await momentFindings(moments, lint);
    const sheet = await contactSheet(
      moments.map((m) => m.file),
      { title: `check: ${moments.length} moments of ${a.duration} s`, times: moments.map((m) => `${m.t} s`), cell: width > height ? 220 : 150, cols: width > height ? 4 : 6 },
    );
    const warn = copyWarnings(brand, [a.html]);
    const lines = [
      `Checked ${moments.length} moments of the video (${times.join(', ')} s); nothing saved, the person doesn't see this.`,
      ...musicLines,
      ...(previewOnly.length ? [`Preview-quality captures or recordings: ${previewOnly.join(', ')} (take them in "high" before the final).`] : []),
      ...(warn.length ? [`Brand copy check: ${warn.join('; ')}`] : []),
      ...(blocked.length ? [`Blocked from the internet: ${blocked.join(', ')}`] : []),
      ...checkLines(found),
      found.length ? 'Fix what needs fixing and check again, then export the preview once.' : 'Ready to export the preview.',
    ];
    return { content: [text(lines.join('\n')), imageItem(sheet, 'image/jpeg', { forClaude: true })] };
  } finally {
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
}

const designShape = {
  project: z.string().describe('The same project name used for the captures.'),
  kind: z.enum(['images', 'video']),
  size: z.string().optional().describe('A brand size name (see the brand tool), or "1080x1350".'),
  width: z.number().int().min(100).max(4000).optional(),
  height: z.number().int().min(100).max(4000).optional(),
  pages: z.array(z.string()).optional().describe('images: one HTML page (or body fragment) per slide.'),
  html: z.string().optional().describe('video: one HTML page whose animation runs from 0 to `duration`.'),
  duration: z.number().optional().describe('video: length in seconds.'),
  voiceover: z.string().optional().describe('video: inbox:<file> of a voiceover.'),
  music: z.union([z.string(), scoreShape]).optional().describe('video: inbox:<file> of a track the person supplied, or music you write as a score (only when they ask for music).'),
  brand: z.string().optional(),
};

const REFS =
  'In your HTML use capture:<name> for screenshots, <img src="clip:<name>" data-start="<seconds>"> for recordings (they play in step with the video), brand:<logo or pattern> (e.g. brand:wordmark?color=red) and inbox:<file> for supplied images. The brand fonts are loaded already (use them by name, e.g. font-family: Inter). Nothing loads from the internet. ';

export function registerExport(server) {
  server.registerTool(
    'check',
    {
      title: 'Check a design (private)',
      description:
        'Render a design privately, for you only, before exporting it: small pictures of every slide (or of moments across a video) and a layout check: headlines wrapping badly or leaving one word alone, text running off the edge or cut off, text too small for a phone, app screens shown too small to read (zoom in), big empty bands, and in 9:16 text under the Reels/Stories buttons. Also reads a music score. Nothing is saved or shown to the person. ' +
        'Check, fix and check again until it is right, then export once: each export appears in the chat for the person. Same inputs as export. ' +
        REFS,
      inputSchema: { ...designShape, at: z.array(z.number()).optional().describe('video: extra moments (seconds) to look at closely.') },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      try {
        const brand = getBrand(a.brand);
        const job = startJob('check', (update) => doCheck(a, brand, update));
        await waitJob(job, JOB_WAIT);
        return jobAnswer(job, fail);
      } catch (e) {
        return fail(e);
      }
    },
  );

  registerAppTool(
    server,
    'export',
    {
      title: 'Export a design',
      description:
        'Turn your own design into finished files, shown to the person in the chat. Check it first (check), so you export once: every export appears in the chat. kind "images": `pages` is one HTML page per slide (any size, e.g. size "instagram-portrait" = 1080x1350); each becomes a PNG. kind "video": `html` is one page whose CSS animations (and JS using ms.time()) run from 0 to `duration` seconds; export a "preview" first (fast, half size); the viewer has a button for the final. ' +
        REFS +
        'Sound, for videos: a voiceover and/or music. Use a track the person put in the Inbox (inbox:<file>). Write music yourself only when they ask for music: a score { tempo, key, parts: [{ play, from, to, pattern | at, steps, volume }] } played with real instruments (the guide tool, topic "music", has how). With neither, the video is silent. The mix is levelled to -14 LUFS and music dips under the voice. ' +
        `Instruments: ${instrumentList()}. ` +
        'caption: the post caption (a hook line, a few short lines, a call to action, 3-5 hashtags), shown under the result with a Copy caption button.',
      inputSchema: {
        ...designShape,
        name: z.string().describe('A name for this piece, e.g. "calculator-carousel" or "explainer".'),
        quality: z.enum(['preview', 'final']).optional().describe('video: preview (default) or final.'),
        fps: z.number().int().min(24).max(60).optional().describe('video final: 30 (default) or 60 for extra smooth.'),
        voiceover_start: z.number().optional().describe('seconds into the video where the voiceover starts (default 0).'),
        music_start: z.number().optional().describe('supplied music: seconds into the track to start from (default 0).'),
        music_volume_db: z.number().optional().describe('music louder (+) or quieter (-) than normal, in dB.'),
        caption: z.string().max(2200).optional().describe('The post caption, shown under the result with a Copy caption button.'),
        scale: z.number().min(1).max(3).optional().describe('images: pixel density (1 default; 2 for extra sharp).'),
        open: z.boolean().optional().describe('Open the folder afterwards (default: only when the chat cannot show the result itself).'),
      },
      _meta: viewerUi,
    },
    async (a) => {
      try {
        const brand = getBrand(a.brand);
        const opts = { ...a, viewer: showsViewer(server) };
        const job = startJob(a.kind === 'video' ? 'video' : 'images', (update) => (a.kind === 'video' ? doVideo(opts, brand, update) : doImages(opts, brand, update)));
        await waitJob(job, JOB_WAIT);
        const r = jobAnswer(job, fail);
        return job.state === 'running' ? { ...r, _meta: { [VIEW_KEY]: { job: job.id, project: a.project, name: a.name, kind: a.kind } } } : r;
      } catch (e) {
        return fail(e);
      }
    },
  );

  // the viewer's "HD version" button: the final video from a preview, with the same design and sound
  registerAppTool(server, 'viewer_final', { description: "For the viewer's HD version button.", inputSchema: { project: z.string(), name: z.string() }, _meta: appOnly }, async ({ project, name }) => {
    try {
      const p = existingProject(project);
      const e = p.data.exports[name];
      const html = path.join(p.dir, 'exports', name, 'source', 'video.html');
      if (e?.kind !== 'video' || !e.settings || !fs.existsSync(html)) throw new CaptureStop('This preview was made by an older version, so ask Claude in the chat for the final video.');
      const brand = getBrand(e.settings.brand);
      const job = startJob('video', (update) => doVideo({ ...e.settings, project: p.data.title, name, kind: 'video', html: fs.readFileSync(html, 'utf8'), quality: 'final', viewer: true, open: false }, brand, update));
      return { content: [text(`Making the final video (job "${job.id}").`)], structuredContent: { job: job.id } };
    } catch (err) {
      return fail(err);
    }
  });
}
