// What Claude can ask the browser to do on a page, in plain terms. Two ways to run the same steps:
//  - live: for a screenshot (real time; the page is just prepared)
//  - recorded: for a screen recording (each step takes frames on the fake clock)
// Step kinds (one key each):
//   { scroll_to: <target> }                     bring something into view (live), or glide to it (recorded)
//   { scroll: <pixels> | 'bottom' | 'top', seconds? }
//   { scroll_in: { css, to, seconds?, axis? } } scroll inside a list or carousel
//   { tap: <target>, after? }                   press a button, link or tab (never "delete/pay/contact…")
//   { fill: { field, value, seconds? } }        type into a field found by its label or placeholder
//   { set: { field, value, seconds? } }         move a slider or number field to a value (glides in recordings)
//   { press: 'Enter' | 'Tab' | 'Escape' }
//   { wait: <seconds> }                         live: wait; recorded: hold on the screen
//   { wait_for: { text | url, max? } }          until the page shows it
//   { mark: <name> }                            recorded only: remember this moment by name
// Targets: 'Button text', { text, near: 'top' | 'bottom' }, { label: 'Field name' }, { css: 'selector' }.
import { describe, locate, refusePress } from './locate.mjs';
import { CaptureStop, settle } from './site.mjs';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const KEYS = new Set(['Enter', 'Tab', 'Escape']);

async function find(page, target, where, opts) {
  const box = await locate(page, target, opts);
  if (!box) throw new CaptureStop(`Couldn't find ${describe(target)} on ${where()}. The page may look different from what you expect: take a preview capture to check.`);
  return box;
}

// a form control found the way a person names it: its label, aria-label, placeholder or name, ignoring punctuation
// ("Purchase Price (MRP)" finds aria-label "Purchase Price MRP"), or the control right after that text on the page
const FIELD = `(name) => {
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const want = norm(name);
  const all = [...document.querySelectorAll('input:not([type=hidden]),select,textarea,[role=slider]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 || e.type === 'range'; });
  const names = (e) => [e.getAttribute('aria-label'), e.getAttribute('placeholder'), e.getAttribute('name'), e.id, e.labels && [...e.labels].map((l) => l.innerText).join(' ')].map(norm);
  let el = all.find((e) => names(e).some((n) => n && n === want)) || all.find((e) => names(e).some((n) => n && (n.startsWith(want) || want.startsWith(n) && n.length > 3)));
  if (!el) {
    const text = [...document.querySelectorAll('body *')].find((e) => e.childElementCount === 0 && norm(e.innerText).startsWith(want));
    if (text) el = all.find((e) => text.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING);
  }
  return el || null;
}`;

async function field(page, name, where) {
  const h = await page.evaluateHandle(`(${FIELD})(${JSON.stringify(String(name))})`);
  const el = h.asElement();
  if (!el) throw new CaptureStop(`Couldn't find a field called "${name}" on ${where()}.`);
  return el;
}

// set an input's value the way the page's own code notices (React and friends listen for input/change events)
const SET_VALUE = (el, v) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

const fieldInfo = (el) => el.evaluate((e) => ({ type: e.type, tag: e.tagName, value: e.value, min: Number(e.min || 0), max: Number(e.max || 0), step: Number(e.step) || 0 }));

const kind = (s) => Object.keys(s).find((k) => k !== 'after' && k !== 'seconds');

export async function runLive(page, site, steps = [], { touch }) {
  const where = () => new URL(page.url()).pathname;
  for (const s of steps) {
    const k = kind(s);
    const v = s[k];
    if (k === 'scroll_to') {
      const box = await find(page, v, where);
      await page.evaluate((y) => window.scrollBy(0, y - innerHeight * 0.3), box.y);
      await page.waitForTimeout(400);
    } else if (k === 'scroll') {
      await page.evaluate((v) => (v === 'bottom' ? window.scrollTo(0, document.documentElement.scrollHeight) : v === 'top' ? window.scrollTo(0, 0) : window.scrollBy(0, Number(v) || 0)), v);
      await page.waitForTimeout(500);
    } else if (k === 'scroll_in') {
      await page.evaluate(({ css, to, axis }) => document.querySelector(css)?.scrollTo({ [axis === 'x' ? 'left' : 'top']: to, behavior: 'instant' }), { css: v.css, to: v.to, axis: v.axis });
      await page.waitForTimeout(400);
    } else if (k === 'tap') {
      const box = await find(page, v, where);
      const no = refusePress(site, v, box);
      if (no) throw new CaptureStop(no);
      if (touch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await settle(page, 900);
    } else if (k === 'fill') {
      const el = await field(page, v.field, where);
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({ force: true });
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(String(v.value), { delay: 20 });
      await page.waitForTimeout(500);
    } else if (k === 'set') {
      const el = await field(page, v.field, where);
      await el.evaluate(SET_VALUE, v.value);
      await page.waitForTimeout(500);
    } else if (k === 'press') {
      if (!KEYS.has(v)) throw new CaptureStop(`Only Enter, Tab and Escape can be pressed (not "${v}").`);
      await page.keyboard.press(v);
      await settle(page, 700);
    } else if (k === 'wait') {
      await page.waitForTimeout(Math.min(15, Number(v) || 1) * 1000);
    } else if (k === 'wait_for') {
      await waitFor(page, v, (v.max ?? 10) * 1000);
    } else if (k === 'mark') {
      /* only meaningful in recordings */
    } else throw new CaptureStop(`Unknown step "${k}". Steps: scroll_to, scroll, scroll_in, tap, fill, set, press, wait, wait_for, mark.`);
  }
}

async function waitFor(page, cond, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const ok = await page
      .evaluate((c) => (!c.url || location.pathname.includes(c.url) || location.href.includes(c.url)) && (!c.text || document.body.innerText.includes(c.text)), cond)
      .catch(() => false);
    if (ok) return;
    await page.waitForTimeout(250);
  }
  throw new CaptureStop(`The page never showed ${cond.text ? `"${cond.text}"` : cond.url}.`);
}

export async function runRecorded(rec, site, steps = [], { touch, showTaps = true }) {
  const page = rec.page;
  const where = () => new URL(page.url()).pathname;
  for (const s of steps) {
    const k = kind(s);
    const v = s[k];
    if (k === 'wait') await rec.hold(rec.frames(Number(v) || 1));
    else if (k === 'mark') rec.mark(String(v));
    else if (k === 'scroll' || k === 'scroll_to') {
      const from = await page.evaluate(() => scrollY);
      let to;
      if (k === 'scroll_to') to = from + (await find(page, v, where)).y - (await page.evaluate(() => innerHeight * 0.3));
      else if (v === 'bottom' || v?.to === 'bottom') to = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      else if (v === 'top' || v?.to === 'top') to = 0;
      else to = from + Number(typeof v === 'object' ? v.to : v);
      const n = rec.frames(s.seconds ?? v?.seconds ?? 2);
      for (let i = 1; i <= n; i++) {
        const y = from + (to - from) * ease(i / n);
        await rec.frame(() => page.evaluate((yy) => window.scrollTo({ top: yy, behavior: 'instant' }), y));
      }
    } else if (k === 'scroll_in') {
      const from = await page.evaluate(({ css, axis }) => document.querySelector(css)?.[axis === 'x' ? 'scrollLeft' : 'scrollTop'], { css: v.css, axis: v.axis });
      if (from === undefined || from === null) throw new CaptureStop(`Couldn't find ${v.css} to scroll on ${where()}.`);
      const n = rec.frames(v.seconds ?? 2);
      for (let i = 1; i <= n; i++) {
        const val = from + (v.to - from) * ease(i / n);
        await rec.frame(() => page.evaluate(({ css, val, axis }) => document.querySelector(css)?.scrollTo({ [axis === 'x' ? 'left' : 'top']: val, behavior: 'instant' }), { css: v.css, val, axis: v.axis }));
      }
    } else if (k === 'tap') {
      const box = await find(page, v, where);
      const no = refusePress(site, v, box);
      if (no) throw new CaptureStop(no);
      await rec.press(box.text || (typeof v === 'string' ? v : JSON.stringify(v)), box, { touch, showTaps, holdFrames: rec.frames(0.12), afterFrames: rec.frames(s.after ?? 0.5) });
    } else if (k === 'set') {
      // a slider or number glides to its new value over `seconds`
      const el = await field(page, v.field, where);
      const f = await fieldInfo(el);
      const from = Number(f.value) || 0;
      const to = Number(v.value);
      if (!Number.isFinite(to) || !/range|number/.test(f.type)) {
        await rec.frame(() => el.evaluate(SET_VALUE, v.value));
      } else {
        const n = rec.frames(v.seconds ?? 1.2);
        for (let i = 1; i <= n; i++) {
          let x = from + (to - from) * ease(i / n);
          if (f.step) x = Math.round(x / f.step) * f.step;
          await rec.frame(() => el.evaluate(SET_VALUE, i === n ? to : x));
        }
      }
      await rec.hold(rec.frames(0.3));
    } else if (k === 'fill') {
      const el = await field(page, v.field, where);
      const box = await el.boundingBox();
      if (!box) throw new CaptureStop(`The field "${v.field}" isn't on screen; scroll to it first.`);
      await rec.frame(() => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2));
      await rec.frame(async () => {
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
      });
      const text = String(v.value);
      const per = Math.max(1, Math.floor(rec.frames(v.seconds ?? Math.min(2, 0.12 * text.length)) / Math.max(1, text.length)));
      for (const ch of text) {
        await rec.frame(() => page.keyboard.type(ch));
        await rec.hold(per - 1);
      }
      await rec.hold(rec.frames(0.3));
    } else if (k === 'press') {
      if (!KEYS.has(v)) throw new CaptureStop(`Only Enter, Tab and Escape can be pressed (not "${v}").`);
      await rec.frame(() => page.keyboard.press(v));
      await rec.hold(rec.frames(0.4));
    } else if (k === 'wait_for') {
      // keep filming while the app loads for real, until it shows what we wait for
      const max = rec.frames(v.max ?? 4);
      for (let i = 0; i < max; i++) {
        await rec.frame();
        if (i < 15) await new Promise((r) => setTimeout(r, 60)); // let real network time pass
        const ok = await page
          .evaluate((c) => (!c.url || location.href.includes(c.url)) && (!c.text || document.body.innerText.includes(c.text)), v)
          .catch(() => false);
        if (ok && i >= rec.frames(0.3)) break;
      }
    } else throw new CaptureStop(`Unknown step "${k}". Steps: scroll_to, scroll, scroll_in, tap, fill, set, press, wait, wait_for, mark.`);
  }
}
