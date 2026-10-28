// Small image jobs done by the browser itself (no image library needed): shrinking a picture for the chat, and a
// contact sheet of a recording's frames.
import fs from 'node:fs';
import { getBrowser } from './browser.mjs';

const dataUri = (buf, mime) => `data:${mime};base64,${buf.toString('base64')}`;
const mimeOf = (file) => (/\.png$/i.test(file) ? 'image/png' : 'image/jpeg');

// a JPEG no wider/taller than `max` px, for showing in the chat
export async function shrink(buf, { mime = 'image/png', max = 1100, quality = 70 } = {}) {
  const b = await getBrowser();
  const page = await b.newPage({ viewport: { width: 10, height: 10 }, deviceScaleFactor: 1 });
  try {
    const out = await page.evaluate(
      async ({ src, max, quality }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        return { data: c.toDataURL('image/jpeg', quality / 100).split(',')[1], w: c.width, h: c.height };
      },
      { src: dataUri(buf, mime), max, quality },
    );
    return { buf: Buffer.from(out.data, 'base64'), width: out.w, height: out.h };
  } finally {
    await page.close();
  }
}

// up to 12 frames in a grid with their times, as one JPEG
export async function contactSheet(files, { title = '', times = [], cols = 6, cell = 170 } = {}) {
  const picks = [...new Set(Array.from({ length: Math.min(12, files.length) }, (_, i) => Math.round((i * (files.length - 1)) / Math.max(1, Math.min(12, files.length) - 1))))];
  const cells = picks
    .map((i) => `<figure><img src="${dataUri(fs.readFileSync(files[i]), mimeOf(files[i]))}"><figcaption>${times[i] ?? `frame ${i}`}</figcaption></figure>`)
    .join('');
  const b = await getBrowser();
  const width = cols * (cell + 8) + 16;
  const page = await b.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(
      `<style>body{margin:0;padding:8px;background:#f6f4f0;font:13px Arial,sans-serif;color:#444;width:${width - 16}px}
      h1{font-size:13px;font-weight:600;margin:2px 0 8px;color:#222} main{display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:8px}
      figure{margin:0} img{width:${cell}px;display:block;border-radius:4px} figcaption{margin-top:2px}</style><h1>${title}</h1><main>${cells}</main>`,
    );
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    const h = await page.evaluate(() => Math.ceil(document.querySelector('main').getBoundingClientRect().bottom + 8));
    return await page.screenshot({ type: 'jpeg', quality: 70, clip: { x: 0, y: 0, width, height: h } });
  } finally {
    await page.close();
  }
}

// how much of a picture is empty: the longest run of plain rows (no edges, so flat colour or a smooth gradient), and
// plain columns at each side. For each picture: { band, from, to, left, right } as fractions of its height/width.
export async function emptyBands(images) {
  if (!images.length) return [];
  const b = await getBrowser();
  const page = await b.newPage({ viewport: { width: 10, height: 10 }, deviceScaleFactor: 1 });
  try {
    return await page.evaluate(async (srcs) => {
      const out = [];
      for (const src of srcs) {
        const img = new Image();
        img.src = src;
        await img.decode();
        const w = 90;
        const h = Math.max(8, Math.round((w * img.naturalHeight) / img.naturalWidth));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, w, h);
        const d = g.getImageData(0, 0, w, h).data;
        const L = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) L[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
        // edge strength at each point; a row or column is plain when nothing in it stands out
        const e = (x, y) => Math.abs(L[y * w + x] - L[y * w + Math.max(0, x - 1)]) + Math.abs(L[y * w + x] - L[Math.max(0, y - 1) * w + x]);
        const LIMIT = 8;
        const rowPlain = Array.from({ length: h }, (_, y) => {
          for (let x = 1; x < w; x++) if (e(x, y) > LIMIT) return false;
          return true;
        });
        const colPlain = Array.from({ length: w }, (_, x) => {
          for (let y = 1; y < h; y++) if (e(x, y) > LIMIT) return false;
          return true;
        });
        let best = [0, 0];
        for (let y = 0, start = -1; y <= h; y++) {
          if (y < h && rowPlain[y]) start = start < 0 ? y : start;
          else if (start >= 0) {
            if (y - start > best[1] - best[0]) best = [start, y];
            start = -1;
          }
        }
        let left = 0;
        while (left < w && colPlain[left]) left++;
        let right = 0;
        while (right < w && colPlain[w - 1 - right]) right++;
        out.push({ band: (best[1] - best[0]) / h, from: best[0] / h, to: best[1] / h, left: left / w, right: right / w });
      }
      return out;
    }, images.map((buf) => (Buffer.isBuffer(buf) ? dataUri(buf, buf[0] === 0x89 ? 'image/png' : 'image/jpeg') : dataUri(fs.readFileSync(buf), mimeOf(buf)))));
  } finally {
    await page.close();
  }
}

// pictures for Claude to check (the person sees the result in the viewer instead)
export const imageItem = (buf, mimeType = 'image/jpeg', { forClaude = false } = {}) => ({ type: 'image', data: buf.toString('base64'), mimeType, ...(forClaude ? { annotations: { audience: ['assistant'] } } : {}) });
