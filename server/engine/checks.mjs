// The layout check: looks at Claude's rendered design the way a viewer on a phone will, and lists what to fix before
// the person sees it. Runs on every slide (and on a moment every second of a video) in the export page itself:
//   - headlines that wrap into more lines than written, or leave one word alone on the last line
//   - text running off the frame, or cut off inside its box
//   - text too small to read on a phone
//   - app screens (capture:, clip:) shown too small to read: zoom in on the part that matters
//   - 9:16: text under the Reels/Stories buttons and caption
//   - big empty bands (measured on the picture, in imaging.mjs)
// These are hints for Claude, never blocks: it decides what is on purpose.
import { DEVICES } from './site.mjs';

// how big things look on a phone: a frame W px wide fills a screen about 390 pt wide
const PHONE_PT = 390;
// app text is about 14 px on the phone it was captured on; below ~10 pt it can't be read
const APP_TEXT = 14;

// thresholds at a frame W px wide (scaled from 1080)
export function limits({ width, height, video }) {
  const k = width / 1080;
  const story = height / width > 1.6;
  return {
    minText: Math.round((video ? 34 : 26) * k),
    minZoom: +((video ? 1.6 : 1.3) * k).toFixed(2),
    goodZoom: +((video ? 2.5 : 2) * k).toFixed(1),
    headline: Math.round(40 * k),
    // the Reels/Stories buttons and caption (brand.safe_zones overrides, at 1080x1920)
    zones: story ? { top: 270, bottom: 350, right: 150, scale: height / 1920 } : null,
  };
}

// natural px per CSS px of every capture and clip the page can show, by its URL path on the export origin
export function sourceScales(project) {
  const out = {};
  for (const [name, c] of Object.entries(project.data.captures)) {
    const f = c.files.high ?? c.files.preview;
    if (f) out[`/p/${encodeURI(f).replace(/\\/g, '/')}`] = { ref: `capture:${name}`, scale: c.files.high ? highScale(c) : c.scale };
  }
  for (const [name, c] of Object.entries(project.data.clips)) {
    const q = c.high ?? c.preview;
    const css = DEVICES[c.device]?.viewport.width ?? DEVICES.phone.viewport.width;
    if (q?.width) out[`/clip/${name}/`] = { ref: `clip:${name}`, scale: q.width / css };
  }
  return out;
}

// a capture's scale is recorded for the quality it was taken in last; a high one was taken at the device's high scale
function highScale(c) {
  const dev = DEVICES[c.device] ?? DEVICES.phone;
  return c.files.high && c.scale === dev.scale.preview ? dev.scale.high : c.scale;
}

// runs inside the export page; returns raw findings for one slide or one moment
export const LINT = (o) => {
  const W = o.width;
  const H = o.height;
  const found = [];
  const short = (s) => {
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length > 48 ? `${t.slice(0, 45)}…` : t;
  };
  const shown = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false;
    }
    return true;
  };
  const blockOf = (el) => {
    let e = el;
    while (e.parentElement && e !== document.body && getComputedStyle(e).display === 'inline') e = e.parentElement;
    return e;
  };

  // text: words grouped by the block they sit in
  const blocks = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode()); ) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName) || !shown(el)) continue;
    const b = blockOf(el);
    if (!blocks.has(b)) blocks.set(b, []);
    const re = /\S+/g;
    for (let m; (m = re.exec(n.textContent)); ) {
      const r = document.createRange();
      r.setStart(n, m.index);
      r.setEnd(n, m.index + m[0].length);
      const box = r.getBoundingClientRect();
      if (box.width && box.height) blocks.get(b).push({ word: m[0], box, el });
    }
  }
  let words = 0;
  for (const [b, list] of blocks) {
    if (!list.length) continue;
    words += list.length;
    const text = short(list.map((w) => w.word).join(' '));
    const el = list[0].el;
    const own = parseFloat(getComputedStyle(el).fontSize) || 16;
    // the size it really shows at, transforms (zooms, scales) included
    const size = Math.max(...list.map((w) => w.box.height)) / 1.2;
    const eff = Math.min(size, own * 3) || own;
    const u = list.reduce((a, { box }) => ({ l: Math.min(a.l, box.left), t: Math.min(a.t, box.top), r: Math.max(a.r, box.right), b: Math.max(a.b, box.bottom) }), { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity });

    if (u.r < 0 || u.l > W || u.b < 0 || u.t > H) continue; // fully outside: moving in or out
    if (u.l < -2 || u.r > W + 2 || u.t < -2 || u.b > H + 2) found.push({ kind: 'edge', text, side: u.l < -2 ? 'left' : u.r > W + 2 ? 'right' : u.t < -2 ? 'top' : 'bottom' });
    // cut off by its own box or one around it (the page edge itself is the check above)
    for (let a = b, depth = 0; a && a !== document.body && a !== document.documentElement && depth < 7; a = a.parentElement, depth++) {
      const s = getComputedStyle(a);
      if (s.overflow === 'visible' && s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const r = a.getBoundingClientRect();
      if (u.l < r.left - 2 || u.r > r.right + 2 || u.t < r.top - 2 || u.b > r.bottom + 2) {
        found.push({ kind: 'clipped', text });
        break;
      }
    }
    // lines: words whose tops line up
    const lines = [];
    for (const w of [...list].sort((x, y) => x.box.top - y.box.top || x.box.left - y.box.left)) {
      const line = lines.find((l) => Math.abs(l.top - w.box.top) < eff * 0.45);
      if (line) line.words.push(w);
      else lines.push({ top: w.box.top, words: [w] });
    }
    if (eff >= o.headline && list.length >= 3) {
      const written = b.querySelectorAll('br').length + 1;
      const last = lines[lines.length - 1];
      // a word alone on the last line only counts when the browser put it there (a written break is on purpose)
      const alone = lines.length > written && last.words.length === 1 && list.length >= 3;
      if (lines.length > written || alone) found.push({ kind: 'wrap', text, lines: lines.length, written, alone: alone ? last.words[0].word : null });
    }
    if (eff < o.minText) found.push({ kind: 'small', text, px: Math.round(eff) });
    if (o.zones) {
      const z = o.zones;
      const top = z.top * z.scale;
      const bottom = H - z.bottom * z.scale;
      const right = W - z.right * z.scale;
      const h = u.b - u.t;
      const inTop = Math.max(0, Math.min(u.b, top) - u.t);
      const inBottom = Math.max(0, u.b - Math.max(u.t, bottom));
      if (inTop > h * 0.3) found.push({ kind: 'zone', text, where: 'top' });
      else if (inBottom > h * 0.3) found.push({ kind: 'zone', text, where: 'bottom' });
      else if (u.r > right + 4 && u.b > H * 0.45) found.push({ kind: 'zone', text, where: 'right' });
    }
  }
  if (words > o.maxWords) found.push({ kind: 'words', count: words });

  // app screens: how much bigger than on the phone they show
  for (const img of document.images) {
    const src = new URL(img.currentSrc || img.src, location.href).pathname;
    const key = Object.keys(o.sources).find((k) => (k.endsWith('/') ? src.startsWith(k) : decodeURI(src) === decodeURI(k)));
    if (!key || !img.naturalWidth || !shown(img)) continue;
    const r = img.getBoundingClientRect();
    const visible = Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0));
    if (visible < W * H * 0.04) continue;
    const fit = getComputedStyle(img).objectFit;
    const kx = r.width / img.naturalWidth;
    const ky = r.height / img.naturalHeight;
    const k = fit === 'cover' ? Math.max(kx, ky) : fit === 'contain' || fit === 'scale-down' ? Math.min(kx, ky) : kx;
    const zoom = k * o.sources[key].scale;
    if (zoom < o.minZoom) found.push({ kind: 'zoom', ref: o.sources[key].ref, zoom: +zoom.toFixed(2), pt: +((APP_TEXT_JS * zoom * PHONE_PT_JS) / W).toFixed(1) });
  }
  return found;
};

// the in-page function as a string, with the constants it needs (page.evaluate can't see this module's scope)
export const LINT_SOURCE = `(${LINT.toString().replace(/APP_TEXT_JS/g, APP_TEXT).replace(/PHONE_PT_JS/g, PHONE_PT)})`;

export const lintOptions = (project, { width, height, video, brand }) => {
  const l = limits({ width, height, video });
  const z = brand?.safe_zones;
  return { width, height, sources: sourceScales(project), maxWords: video ? 400 : 40, ...l, zones: l.zones && z ? { ...l.zones, ...z } : l.zones };
};

// one line per problem for Claude; `where` names the slide or the moments it was seen
const SAY = {
  wrap: (f) => `the headline "${f.text}" ${f.lines > f.written ? `wraps into ${f.lines} lines (written as ${f.written})` : `takes ${f.lines} lines`}${f.alone ? ` and leaves "${f.alone}" alone on the last line` : ''}. Shorten it, size it down a little, or set the line breaks`,
  edge: (f) => `"${f.text}" runs off the ${f.side} edge`,
  clipped: (f) => `"${f.text}" is cut off inside its box`,
  small: (f, o) => `small text: ${f.px} px "${f.text}" (aim for ${o.minText} px or more at this size, so it reads on a phone)`,
  zone: (f) => `"${f.text}" sits ${f.where === 'top' ? 'in the top band' : f.where === 'bottom' ? 'in the bottom band' : 'by the right edge'}, under the Reels/Stories ${f.where === 'right' ? 'buttons' : f.where === 'top' ? 'header' : 'caption and buttons'}. Move it towards the middle`,
  words: (f) => `${f.count} words; a slide reads best under about 30`,
  zoom: (f, o) => `${f.ref} shows at ${f.zoom}x its size on the phone, so its normal text reads like ${f.pt} pt (too small). Show it bigger or zoom into the part that matters (${o.goodZoom}x or more)`,
  empty: (f) => `${f.what}. Fill it (bigger type or screen, tighter layout) unless it's on purpose`,
};

// findings per slide -> lines
export function describeSlides(perSlide, o) {
  const lines = [];
  perSlide.forEach((list, i) => {
    for (const f of dedupe(list)) lines.push(`- Slide ${i + 1}: ${SAY[f.kind](f, o)}.`);
  });
  return lines;
}

// findings per moment ([{ t, list }]) -> lines with the times each problem was seen
export function describeMoments(moments, o) {
  const seen = new Map();
  for (const { t, list } of moments)
    for (const f of dedupe(list)) {
      const k = `${f.kind}|${f.text ?? f.ref ?? f.what ?? ''}`;
      if (!seen.has(k)) seen.set(k, { f, times: [] });
      seen.get(k).times.push(t);
    }
  // seen at a single moment, an empty frame or text at the edge is usually something moving in or out
  const moving = new Set(['empty', 'edge', 'zone', 'clipped']);
  return [...seen.values()].filter(({ f, times }) => !(moving.has(f.kind) && times.length < 2)).map(({ f, times }) => `- ${spans(times)}: ${SAY[f.kind](f, o)}.`);
}

const dedupe = (list) => {
  const k = new Set();
  return list.filter((f) => {
    const key = JSON.stringify(f);
    return !k.has(key) && k.add(key);
  });
};

// [0.5, 1.5, 2.5, 6.5] -> "0.5-2.5 s, 6.5 s"
function spans(times) {
  const out = [];
  for (const t of times) {
    const last = out[out.length - 1];
    if (last && t - last[1] <= 1.01) last[1] = t;
    else out.push([t, t]);
  }
  return out.map(([a, b]) => (a === b ? `${a} s` : `${a}-${b} s`)).join(', ');
}

// empty bands from imaging.emptyBands -> a finding (or none)
export function emptyFinding(b) {
  if (!b) return null;
  if (b.band >= 0.28) return { kind: 'empty', what: `an empty band covers ${Math.round(b.band * 100)}% of the height (from ${Math.round(b.from * 100)}% to ${Math.round(b.to * 100)}% down)` };
  if (b.left >= 0.18 && b.right >= 0.18) return { kind: 'empty', what: `everything sits in the middle ${Math.round((1 - b.left - b.right) * 100)}% of the width, the sides are empty` };
  return null;
}
