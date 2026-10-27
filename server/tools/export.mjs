// export: turn Claude's own design into finished files. Claude writes the HTML/CSS (one page per slide, or one
// animated page for a video) using capture:, clip:, brand: and inbox: references; this renders it with the real
// screens and the brand fonts. Images: PNG per slide. Video: a fast preview first, then the final MP4, with the
// voiceover and music mixed in.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { exportFrames, exportImages, getBrand, prepare } from '../engine/exporter.mjs';
import { contactSheet, imageItem, shrink } from '../engine/imaging.mjs';
import { jobAnswer, startJob, waitJob } from '../engine/jobs.mjs';
import { openFolder } from '../engine/open.mjs';
import { openProject } from '../engine/project.mjs';
import { CaptureStop } from '../engine/site.mjs';
import { withStudio } from '../engine/studio.mjs';
import { D, INBOX, slug } from '../paths.mjs';
import { fail, text } from './common.mjs';

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
  const { files, blocked } = await exportImages({ project: p, brand, pages, width, height, scale: a.scale ?? 1, outDir, onProgress: (f) => update(f * 0.9, 'rendering slides') });
  p.data.exports[name] = { kind: 'images', width, height, files: files.map((f) => path.relative(p.dir, f.file)), at: new Date().toISOString() };
  p.save();
  const previews = [];
  for (const f of files.slice(0, 10)) previews.push(imageItem((await shrink(f.buf, { max: 720, quality: 72 })).buf));
  const warn = copyWarnings(brand, a.pages);
  const lines = [
    `Exported ${files.length} slide(s) "${name}" at ${width}x${height} px: ${outDir}`,
    ...(previewOnly.length ? [`Note: ${previewOnly.join(', ')} used preview-quality captures. For the final files, capture them again with quality "high" and export again.`] : []),
    ...(warn.length ? [`Brand copy check: ${warn.join('; ')}`] : []),
    ...(blocked.length ? [`Blocked from the internet (the design must use brand fonts and project files): ${blocked.join(', ')}`] : []),
    a.open === false ? '' : 'The folder is open.',
  ].filter(Boolean);
  if (a.open !== false) openFolder(outDir);
  return { content: [text(lines.join('\n')), ...previews] };
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
  const outDir = p.file('exports', name);
  fs.mkdirSync(path.join(outDir, 'source'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'source', 'video.html'), a.html);
  const framesDir = path.join(D.tmp, `${p.id}-${name}-${final ? 'final' : 'preview'}`);
  update(0.02, 'rendering frames');
  const { files, blocked } = await exportFrames({ project: p, brand, page: pages[0], width, height, scale, fps, duration: a.duration, framesDir, onProgress: (f) => update(0.02 + 0.78 * f, `rendering frame ${Math.round(f * a.duration * fps)} of ${Math.round(a.duration * fps)}`) });
  update(0.82, 'encoding the video');
  const voice = inboxFile(a.voiceover);
  const music = inboxFile(a.music);
  const out = path.join(outDir, `${name}${final ? '' : '.preview'}.mp4`);
  const roots = [framesDir, INBOX];
  const stats = await withStudio(roots, (s) =>
    s.encode({
      frames: files,
      fps,
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      bitrate: final ? (width * height > 2e6 ? 12e6 : 8e6) : 2e6,
      audio: voice || music ? { voice: voice && { file: voice, start: a.voiceover_start ?? 0 }, music: music && { file: music, start: a.music_start ?? 0, volume_db: a.music_volume_db ?? 0 }, target: -14 } : null,
      outFile: out,
    }),
  );
  update(0.95, 'making the contact sheet');
  const times = files.map((_, i) => `${(i / fps).toFixed(1)} s`);
  const sheet = await contactSheet(files, { title: `${name}: ${a.duration} s, ${stats.width}x${stats.height}, ${fps} fps${final ? '' : ' (preview)'}`, times, cell: width > height ? 220 : 150, cols: width > height ? 4 : 6 });
  fs.rmSync(framesDir, { recursive: true, force: true });
  p.data.exports[name] = { ...(p.data.exports[name] ?? {}), kind: 'video', width, height, duration: a.duration, [final ? 'final' : 'preview']: path.relative(p.dir, out), at: new Date().toISOString() };
  p.save();
  const warn = copyWarnings(brand, [a.html]);
  const lines = [
    `${final ? 'Final video' : 'Preview video'} "${name}": ${a.duration} s, ${stats.width}x${stats.height}, ${fps} fps, ${(stats.bytes / 1048576).toFixed(1)} MB${stats.audio ? `, sound at ${stats.audio.lufs} LUFS (peak ${stats.audio.peak} dB)` : ', no sound'}.`,
    `Saved: ${out}`,
    ...(final ? [] : ['This is a quick preview (half size). When it looks right, export again with quality "final".']),
    ...(previewOnly.length ? [`Note: ${previewOnly.join(', ')} used preview-quality captures or recordings. Take them again in high quality before the final.`] : []),
    ...(warn.length ? [`Brand copy check: ${warn.join('; ')}`] : []),
    ...(blocked.length ? [`Blocked from the internet (the design must use brand fonts and project files): ${blocked.join(', ')}`] : []),
    'The picture shows 12 moments from it.',
  ];
  if (a.open !== false) openFolder(outDir);
  return { content: [text(lines.join('\n')), imageItem(sheet)] };
}

export function registerExport(server) {
  server.registerTool(
    'export',
    {
      title: 'Export a design',
      description:
        'Turn your own design into finished files. kind "images": `pages` is one HTML page per slide (any size, e.g. size "instagram-portrait" = 1080x1350); each becomes a PNG. kind "video": `html` is one page whose CSS animations (and JS using ms.time()) run from 0 to `duration` seconds; export a "preview" first (fast, half size), then "final". ' +
        'In your HTML use capture:<name> for screenshots, <img src="clip:<name>" data-start="<seconds>"> for recordings (they play in step with the video), brand:<logo or pattern> (e.g. brand:wordmark?color=red) and inbox:<file> for supplied images. The brand fonts are loaded already (font-family: \'Playfair Display\'). Nothing loads from the internet. ' +
        'Add a voiceover and/or music from the Inbox to a video with voiceover/music; the mix is levelled to -14 LUFS and music dips under the voice.',
      inputSchema: {
        project: z.string().describe('The same project name used for the captures.'),
        name: z.string().describe('A name for this piece, e.g. "calculator-carousel" or "explainer".'),
        kind: z.enum(['images', 'video']),
        size: z.string().optional().describe('A brand size name (see the brand tool), or "1080x1350".'),
        width: z.number().int().min(100).max(4000).optional(),
        height: z.number().int().min(100).max(4000).optional(),
        pages: z.array(z.string()).optional().describe('images: one HTML page (or body fragment) per slide.'),
        html: z.string().optional().describe('video: one HTML page whose animation runs from 0 to `duration`.'),
        duration: z.number().optional().describe('video: length in seconds.'),
        quality: z.enum(['preview', 'final']).optional().describe('video: preview (default) or final.'),
        fps: z.number().int().min(24).max(60).optional().describe('video final: 30 (default) or 60 for extra smooth.'),
        voiceover: z.string().optional().describe('video: inbox:<file> of a voiceover.'),
        voiceover_start: z.number().optional().describe('seconds into the video where the voiceover starts (default 0).'),
        music: z.string().optional().describe('video: inbox:<file> of a music track.'),
        music_start: z.number().optional().describe('seconds into the track to start from (default 0).'),
        music_volume_db: z.number().optional().describe('music louder (+) or quieter (-) than normal, in dB.'),
        scale: z.number().min(1).max(3).optional().describe('images: pixel density (1 default; 2 for extra sharp).'),
        brand: z.string().optional(),
        open: z.boolean().optional().describe('Open the folder afterwards (default yes).'),
      },
    },
    async (a) => {
      try {
        const brand = getBrand(a.brand);
        const job = startJob(a.kind === 'video' ? 'video' : 'images', (update) => (a.kind === 'video' ? doVideo(a, brand, update) : doImages(a, brand, update)));
        await waitJob(job, 40);
        return jobAnswer(job, fail);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
