// The studio page: a private, secure page (https://studio.local, answered by this extension, never the internet)
// in the shared browser, where video is encoded and audio is measured and mixed (engine/studio-page.js). It can read
// only files inside the folders it's given, and it can send results only back to this extension.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../paths.mjs';
import { getBrowser } from './browser.mjs';
import { KIT } from './music.mjs';

const HOST = 'https://studio.local';
const MUXER = path.join(ROOT, 'node_modules', 'mp4-muxer', 'build', 'mp4-muxer.js');
const PAGE_JS = path.join(ROOT, 'server', 'engine', 'studio-page.js');
const MUSIC_JS = path.join(ROOT, 'server', 'engine', 'music-page.js');
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.mp4': 'video/mp4' };

export const fileUrl = (p) => `${HOST}/f/${encodeURIComponent(path.resolve(p))}`;

export async function withStudio(roots, fn, { onProgress } = {}) {
  // the music kit is always readable: it's the extension's own sounds
  const allowed = [...roots, KIT].map((r) => path.resolve(r));
  const outputs = new Map();
  const b = await getBrowser();
  const context = await b.newContext({ viewport: { width: 400, height: 300 } });
  await context.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.origin !== HOST) return route.abort();
    if (u.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>studio</title>' });
    if (u.pathname === '/lib/mp4-muxer.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(MUXER) });
    if (u.pathname === '/lib/studio.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(PAGE_JS) });
    if (u.pathname === '/lib/music.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(MUSIC_JS) });
    if (u.pathname.startsWith('/f/')) {
      const p = path.resolve(decodeURIComponent(u.pathname.slice(3)));
      if (!allowed.some((r) => p === r || p.startsWith(r + path.sep)) || !fs.existsSync(p)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: TYPES[path.extname(p).toLowerCase()] ?? 'application/octet-stream', body: fs.readFileSync(p) });
    }
    if (u.pathname.startsWith('/out/') && req.method() === 'POST') {
      outputs.set(u.pathname.slice(5), req.postDataBuffer());
      return route.fulfill({ status: 200, body: 'ok' });
    }
    return route.abort();
  });
  const page = await context.newPage();
  try {
    await page.goto(`${HOST}/`);
    await page.addScriptTag({ url: `${HOST}/lib/mp4-muxer.js` });
    await page.addScriptTag({ url: `${HOST}/lib/studio.js` });
    await page.addScriptTag({ url: `${HOST}/lib/music.js` });
    if (onProgress) await page.exposeFunction('__progress', (f) => onProgress(f));
    const kitUrls = (plan) => Object.fromEntries(plan.kit.files.map((f) => [f, fileUrl(path.join(KIT, f))]));
    return await fn({
      // a music plan (music.mjs) played on its own: its loudness and peak, and optionally a WAV of it
      music: async (plan, wavFile) => {
        const r = await page.evaluate((o) => window.studio.music(o.plan, o.urls, o.wav), { plan, urls: kitUrls(plan), wav: wavFile ? `${HOST}/out/music` : null });
        if (wavFile) fs.writeFileSync(wavFile, outputs.get('music'));
        return r;
      },
      canEncode: () =>
        page.evaluate(async () => typeof VideoEncoder !== 'undefined' && (await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: 1080, height: 1920, bitrate: 8e6, framerate: 30 })).supported && typeof AudioEncoder !== 'undefined'),
      analyse: (file) => page.evaluate((url) => window.studio.analyse(url), fileUrl(file)),
      // frames: image files; audio: { voice: { file, start }, music: { file, start, volume_db, duck_db } or
      // { plan, volume_db } for written music }; writes `outFile`
      encode: async ({ frames, fps, width, height, bitrate, audio, outFile }) => {
        const id = `v${Date.now()}`;
        const music = audio?.music && (audio.music.plan ? { ...audio.music, urls: kitUrls(audio.music.plan) } : { ...audio.music, url: fileUrl(audio.music.file) });
        const a = audio && (audio.voice || audio.music) ? { voice: audio.voice && { ...audio.voice, url: fileUrl(audio.voice.file) }, music, target: audio.target ?? -14 } : null;
        const stats = await page.evaluate((o) => window.studio.encode(o), { frames: frames.map(fileUrl), fps, width, height, bitrate, audio: a, out: `${HOST}/out/${id}` });
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, outputs.get(id));
        return stats;
      },
    });
  } finally {
    await context.close().catch(() => {});
  }
}
