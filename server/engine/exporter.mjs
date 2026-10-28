// Exporting Claude's own designs. Claude writes HTML/CSS (and JS for motion); this fills in the references and turns
// it into files:
//   capture:<name>           a screenshot from this project (the high-quality one when there is one)
//   clip:<name>              a screen recording: <img src="clip:<name>" data-start="2" data-speed="1"> plays it in
//                            videos, in step with the page's clock (in images it shows its first frame)
//   brand:<logo or pattern>  a brand file (e.g. brand:wordmark, brand:wordmark?color=red, brand:mandala)
//   inbox:<file>             an image someone put in the Inbox
// The brand's fonts are loaded for every page, so `font-family: Inter` (or any brand font by name) just works. Pages are served on a
// private secure origin (https://studio.local) and can't load anything from the internet.
// Video: the page's clock (Date, timers, requestAnimationFrame, performance.now) and every CSS/WAAPI animation are
// stepped together frame by frame from 0, so the result is exact however slow the laptop is.
import fs from 'node:fs';
import path from 'node:path';
import { brands, INBOX } from '../paths.mjs';
import { getBrowser } from './browser.mjs';
import { LINT_SOURCE } from './checks.mjs';
import { currentJob } from './jobs.mjs';
import { CaptureStop } from './site.mjs';

const HOST = 'https://studio.local';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2', '.woff': 'font/woff' };

export function getBrand(id) {
  const all = brands();
  if (!all.length) throw new CaptureStop('No brands are set up in Marketing Studio yet.');
  if (!id) return all[0];
  const b = all.find((x) => x.id === id || x.name?.toLowerCase() === String(id).toLowerCase());
  if (!b) throw new CaptureStop(`There's no brand called "${id}". Brands: ${all.map((x) => x.name ?? x.id).join(', ')}.`);
  return b;
}

const colorOf = (brand, c) => (brand.colors?.[c]?.hex ?? (/^#?[0-9a-f]{3,8}$/i.test(c) ? (c.startsWith('#') ? c : `#${c}`) : null));

// every reference in Claude's HTML -> a URL on the private origin; returns { html, missing, previewOnly, clips }
function resolveRefs(src, { project, brand }) {
  const missing = [];
  const previewOnly = [];
  const clips = new Set();
  // only where a file is used: in an attribute or url(...) (after a quote or a bracket), never in visible text
  const html = src.replace(/(?<=["'(])(capture|clip|brand|inbox):([A-Za-z0-9._\-]+)(\?color=[#A-Za-z0-9\-]+)?/g, (m, kind, name, q = '') => {
    if (kind === 'capture') {
      const c = project.data.captures[name];
      if (!c) return missing.push(m), m;
      if (!c.files.high) previewOnly.push(name);
      return `${HOST}/p/${encodeURI(c.files.high ?? c.files.preview).replace(/\\/g, '/')}`;
    }
    if (kind === 'clip') {
      const c = project.data.clips[name];
      if (!c) return missing.push(m), m;
      if (!c.high) previewOnly.push(name);
      clips.add(name);
      return `${HOST}/clip/${name}/0000.jpg`;
    }
    if (kind === 'brand') {
      const item = brand.logos?.[name] ?? brand.patterns?.[name];
      if (!item) return missing.push(m), m;
      return `${HOST}/b/${item.file}${q}`;
    }
    if (kind === 'inbox') {
      if (!fs.existsSync(path.join(INBOX, name))) return missing.push(m), m;
      return `${HOST}/i/${encodeURIComponent(name)}`;
    }
    return m;
  });
  return { html, missing, previewOnly, clips: [...clips] };
}

const fontFaces = (brand) =>
  (brand.fonts ?? [])
    .flatMap((f) => f.files.map((file) => `@font-face{font-family:'${f.family}';src:url('${HOST}/b/${file}');font-weight:${(f.weights ?? '400').replace('-', ' ')};font-style:${/italic/i.test(file) ? 'italic' : 'normal'};font-display:block}`))
    .join('\n');

// a full HTML document at exactly width x height, with the brand fonts and the clip player
function wrap(fragment, { width, height, brand, video }) {
  const head = `<meta charset="utf-8"><style>${fontFaces(brand)}\nhtml,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden}</style>${video ? `<script>${CLIP_PLAYER}</script>` : ''}`;
  if (/<head[\s>]/i.test(fragment)) return fragment.replace(/<head[^>]*>/i, (h) => `${h}${head}`);
  if (/<html[\s>]/i.test(fragment)) return fragment.replace(/<html[^>]*>/i, (h) => `${h}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${fragment}</body></html>`;
}

// plays clip:<name> images in step with the page clock: frame = (data-from + (time - data-start) * speed) * fps, up to data-to
const CLIP_PLAYER = `
window.ms = window.ms || {};
(() => {
  // ms.time(): seconds since the video started (use it for motion written in JS); reset when frame stepping begins
  ms.t0 = performance.now();
  ms.time = () => (performance.now() - ms.t0) / 1000;
  ms.clips = {};
  ms.updateClips = () => {
    const loads = [];
    for (const img of document.querySelectorAll('img[src*="/clip/"]')) {
      const m = img.getAttribute('src').match(/\\/clip\\/([^/]+)\\//);
      if (!m) continue;
      const info = ms.clips[m[1]];
      if (!info) continue;
      // data-from / data-to: play only that part of the recording (seconds into it), so one take makes several scenes
      const t = ms.time() - Number(img.dataset.start || 0);
      const from = Number(img.dataset.from || 0);
      const to = img.dataset.to != null ? Number(img.dataset.to) : Infinity;
      const at = Math.min(to, from + Math.max(0, t) * Number(img.dataset.speed || 1));
      const i = Math.max(0, Math.min(info.count - 1, Math.floor(at * info.fps)));
      const want = '${HOST}/clip/' + m[1] + '/' + String(i).padStart(4, '0') + '.jpg';
      if (img.src !== want) { img.src = want; loads.push(img.decode().catch(() => {})); }
    }
    return Promise.all(loads);
  };
})();
`;

const noop = () => {};

// serve one export: Claude's pages, captures, clips, brand files and inbox images, nothing from the internet
async function exportContext({ project, brand, pages, width, height, scale, video }) {
  const b = await getBrowser();
  const context = await b.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  currentJob()?.own(context);
  const blocked = new Set();
  const clipInfo = {};
  for (const [name, c] of Object.entries(project.data.clips)) {
    const q = c.high ?? c.preview;
    if (q) clipInfo[name] = { dir: path.join(project.dir, q.frames), count: q.count, fps: q.fps };
  }
  await context.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== HOST) {
      if (!u.protocol.startsWith('data') && !u.protocol.startsWith('blob')) blocked.add(u.host || u.href.slice(0, 40));
      return route.abort();
    }
    const send = (file, transform) => {
      if (!file || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      let body = fs.readFileSync(file);
      if (transform) body = transform(body);
      return route.fulfill({ status: 200, contentType: TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', body });
    };
    const p = decodeURIComponent(u.pathname);
    const inside = (root, rel) => {
      const f = path.resolve(root, rel);
      return f.startsWith(path.resolve(root) + path.sep) ? f : null;
    };
    if (p.startsWith('/page/')) return route.fulfill({ status: 200, contentType: 'text/html', body: pages[Number(p.slice(6))] ?? '' });
    if (p.startsWith('/p/')) return send(inside(project.dir, p.slice(3)));
    if (p.startsWith('/clip/')) {
      const [, , name, frame] = p.split('/');
      return send(clipInfo[name] && inside(clipInfo[name].dir, frame));
    }
    if (p.startsWith('/i/')) return send(inside(INBOX, p.slice(3)));
    if (p.startsWith('/b/')) {
      const color = colorOf(brand, u.searchParams.get('color') ?? '');
      return send(inside(brand.dir, p.slice(3)), color && /\.svg$/i.test(p) ? (buf) => Buffer.from(buf.toString('utf8').replace(/fill="(?!none)[^"]*"/gi, `fill="${color}"`)) : null);
    }
    return route.fulfill({ status: 404, body: '' });
  });
  if (video) await context.addInitScript((info) => ((window.ms = window.ms || {}), (window.__msClipInfo = info)), Object.fromEntries(Object.entries(clipInfo).map(([k, v]) => [k, { count: v.count, fps: v.fps }])));
  return { context, blocked };
}

const ready = (page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => {}))));
  });

export function prepare(project, brand, sources, { width, height, video }) {
  const out = sources.map((s) => resolveRefs(s, { project, brand }));
  const missing = [...new Set(out.flatMap((o) => o.missing))];
  if (missing.length) throw new CaptureStop(`These references aren't in the project "${project.data.title}": ${missing.join(', ')}. Capture or record them first (with this project), or check the names.`);
  return { pages: out.map((o) => wrap(o.html, { width, height, brand, video })), previewOnly: [...new Set(out.flatMap((o) => o.previewOnly))] };
}

// the layout check (checks.mjs) on the page as it is now
const lintPage = (page, lint) => (lint ? page.evaluate(`${LINT_SOURCE}(${JSON.stringify(lint)})`).catch((e) => (console.error('[marketing-studio] layout check:', e.message), [])) : []);

// slides -> PNG files; returns [{ file, buf, findings }]. outDir null: nothing is saved (a check)
export async function exportImages({ project, brand, pages, width, height, scale = 1, outDir, lint, onProgress = noop }) {
  const { context, blocked } = await exportContext({ project, brand, pages, width, height, scale });
  const files = [];
  try {
    for (let i = 0; i < pages.length; i++) {
      const page = await context.newPage();
      await page.goto(`${HOST}/page/${i}`, { waitUntil: 'load' });
      await ready(page);
      await page.waitForTimeout(150);
      const findings = await lintPage(page, lint);
      const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height }, animations: 'disabled' });
      const file = outDir && path.join(outDir, `${String(i + 1).padStart(2, '0')}.png`);
      if (file) fs.writeFileSync(file, buf);
      files.push({ file, buf, findings });
      await page.close();
      onProgress((i + 1) / pages.length);
    }
  } finally {
    await context.close().catch(() => {});
  }
  return { files, blocked: [...blocked] };
}

// one animated page -> frames (JPEG) on the stepped clock; returns the frame files and, with `lint`, the layout
// check at the middle of every second ({ t, list, file }). `times`: only those moments (seconds), for a check.
export async function exportFrames({ project, brand, page: html, width, height, scale, fps, duration, framesDir, lint, times, onProgress = noop }) {
  const { context, blocked } = await exportContext({ project, brand, pages: [html], width, height, scale, video: true });
  const n = Math.max(1, Math.round(duration * fps));
  const dt = 1000 / fps;
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  const files = [];
  const moments = [];
  const sampled = new Map();
  for (let t = 0.5; t < duration; t += 1) sampled.set(Math.round(t * fps), t);
  try {
    const page = await context.newPage();
    await page.clock.install();
    await page.goto(`${HOST}/page/0`, { waitUntil: 'load' });
    await ready(page);
    // freeze at t = 0: the clock stops, every animation is held at its start and only moves when we step
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 50);
    await page.evaluate(() => {
      ms.clips = window.__msClipInfo || {};
      ms.t0 = performance.now();
      const tracked = new Map();
      ms.__t = 0;
      ms.step = (d) => {
        ms.__t += d;
        for (const a of document.getAnimations()) {
          let s = tracked.get(a);
          if (!s) {
            s = { start: ms.__t - d };
            tracked.set(a, s);
            try { a.pause(); } catch {}
          }
          try { a.currentTime = ms.__t - s.start; } catch {}
        }
      };
      for (const a of document.getAnimations()) { try { a.pause(); a.currentTime = 0; } catch {} }
    });
    const shot = async (name) => {
      await page.evaluate(() => ms.updateClips());
      const file = path.join(framesDir, `${name}.jpg`);
      await page.screenshot({ path: file, type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width, height }, animations: 'allow', caret: 'hide' });
      return file;
    };
    if (times) {
      // a check: jump from moment to moment (animations and the clock move together, so each moment is exact)
      let now = 0;
      for (const [k, t] of [...times].sort((a, b) => a - b).entries()) {
        const d = Math.round(t * 1000 - now);
        if (d > 0) {
          await page.clock.runFor(d);
          await page.evaluate((dd) => ms.step(dd), d);
          now += d;
        }
        const file = await shot(String(k).padStart(4, '0'));
        files.push(file);
        moments.push({ t: +t.toFixed(2), list: await lintPage(page, lint), file });
        onProgress((k + 1) / times.length);
      }
    } else
      for (let i = 0; i < n; i++) {
        if (i > 0) {
          await page.clock.runFor(dt);
          await page.evaluate((d) => ms.step(d), dt);
        }
        const file = await shot(String(i).padStart(4, '0'));
        files.push(file);
        if (lint && sampled.has(i)) moments.push({ t: sampled.get(i), list: await lintPage(page, lint), file });
        if (i % 10 === 0) onProgress(i / n);
      }
  } finally {
    await context.close().catch(() => {});
  }
  return { files, moments, blocked: [...blocked] };
}
