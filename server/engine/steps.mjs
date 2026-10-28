// What Claude can ask the browser to do on a page, in plain terms. Two ways to run the same steps:
//  - live: for a screenshot, a page reading or a dry run (real time; the page is just prepared)
//  - recorded: for a screen recording (each step takes frames on the fake clock)
// Every step has a time limit. A step that fails or runs out of time stops the run, saying which step it was and why,
// with a picture of the screen at that moment. Taps and typing report what they did ("went to /vendors", "nothing
// changed", "the field shows ..."), so a site problem shows at once instead of in the finished video.
// Step kinds (one key each):
//   { scroll_to: <target> }                     bring something into view (live), or glide to it (recorded)
//   { scroll: <pixels> | 'bottom' | 'top', seconds? }
//   { scroll_in: { css, to, seconds?, axis? } } scroll inside a list or carousel
//   { tap: <target>, after? }                   press a button, link or tab (never "delete/pay/contact…")
//   { fill: { field, value, seconds? } }        type into a field found by its label or placeholder, key by key
//   { set: { field, value, seconds? } }         move a slider or number field to a value (glides in recordings)
//   { press: 'Enter' | 'Tab' | 'Escape' }
//   { wait: <seconds> }                         live: wait; recorded: hold on the screen
//   { wait_for: { text | url, max? } }          until the page shows the text or goes to the address (fails after max s)
//   { mark: <name> }                            recorded only: remember this moment by name
// Targets: 'Button text', { text, near: 'top' | 'bottom' }, { label: 'Field name' }, { href: '/vendors' },
// { x, y } (a point on the screen, CSS px), { css: 'selector' }.
import { describe, locate, refusePress } from './locate.mjs';
import { CaptureStop, settle } from './site.mjs';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const KEYS = new Set(['Enter', 'Tab', 'Escape']);
const STEPS = 'scroll_to, scroll, scroll_in, tap, fill, set, press, wait, wait_for, mark';

const kind = (s) => Object.keys(s).find((k) => k !== 'after' && k !== 'seconds');
const summary = (s) => {
  const j = JSON.stringify(s);
  return j.length > 90 ? `${j.slice(0, 87)}…` : j;
};

// a step that takes too long is given up on (the job closes its page)
async function timed(work, ms, what) {
  let t;
  try {
    return await Promise.race([work(), new Promise((_, no) => (t = setTimeout(() => no(new CaptureStop(`${what} didn't finish within ${Math.round(ms / 1000)} s`)), ms)))]);
  } finally {
    clearTimeout(t);
  }
}

// the error for a failed step: which one, why, and a picture of the screen right then
async function stepFailed(page, e, i, steps, notes) {
  const why = e instanceof CaptureStop ? e.message : String(e?.message ?? e).split('\n')[0];
  const err = new CaptureStop(`Step ${i + 1} of ${steps.length} (${summary(steps[i])}) failed: ${why}${notes.length ? `\nBefore that: ${notes.join('; ')}.` : ''}\nThe picture shows the screen at that moment.`);
  err.shot = await page.screenshot({ type: 'jpeg', quality: 55, scale: 'css', timeout: 5000, animations: 'disabled', caret: 'hide' }).catch(() => null);
  err.notes = notes;
  return err;
}

async function find(page, target, where, opts) {
  const box = await locate(page, target, opts);
  if (!box)
    throw new CaptureStop(
      `Couldn't find ${describe(target)} on ${where()}. If it's a picture or an icon, tap it by its link ({"href": "/vendors"}) or its position on the screen ({"x": 317, "y": 30}); read_page lists both, and a capture with numbers: true shows them.`,
    );
  return box;
}

// what the page looks like now (address and a rough fingerprint), and what lies under a point
const look = (page) => page.evaluate(() => ({ url: location.href, sig: `${document.body?.innerText.length ?? 0}:${document.getElementsByTagName('*').length}` })).catch(() => null);
const under = (page, x, y) =>
  page
    .evaluate(
      ({ x, y }) => {
        const e = document.elementFromPoint(x, y);
        if (!e) return null;
        const n = e.closest('a,button,[role="button"],[role="tab"],input,label') || e;
        let fixed = false;
        for (let p = n; p && p !== document.body; p = p.parentElement) if (/fixed|sticky/.test(getComputedStyle(p).position)) fixed = true;
        const text = (n.innerText || n.getAttribute('aria-label') || n.getAttribute('title') || n.querySelector?.('img[alt]')?.alt || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        return { tag: n.tagName.toLowerCase(), text, href: n.closest('a[href]')?.getAttribute('href') ?? null, fixed };
      },
      { x, y },
    )
    .catch(() => null);
// a target in plain words, for reports
const plainOf = (v) => (typeof v === 'string' ? v : v?.text ?? v?.label ?? v?.href ?? (v?.x != null ? `the point (${v.x}, ${v.y})` : v?.css ?? 'it'));
const pathOf = (u) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};
function outcome(label, before, after, hit) {
  if (before && after && before.url !== after.url) return `tap "${label}": went to ${pathOf(after.url)}`;
  if (before && after && before.sig !== after.sig) return `tap "${label}": the page changed (same address)`;
  const what = hit ? `${hit.tag}${hit.text ? ` "${hit.text}"` : ''}${hit.href ? ` linking to ${hit.href}` : ''}${hit.fixed ? ', part of a fixed bar or floating button' : ''}` : 'nothing';
  return `tap "${label}": nothing changed (under the finger: ${what})`;
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

// typing, key by key, the way a person types. Some pages swap the field after the first key (a search that opens its
// own screen): then the typing carries on in the field that's there now, with what was typed so far put back. At the
// end, what the field shows is checked against what was typed.
const FOCUS = () => {
  const a = document.activeElement;
  const ok = !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
  return { ok, same: ok && a.dataset.msTyping === '1', value: ok ? (a.value ?? a.innerText) : null };
};
const MARK = () => {
  const a = document.activeElement;
  if (a?.dataset) a.dataset.msTyping = '1';
};
const REFIND = ({ typed }) => {
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  };
  const boxes = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]),textarea,[contenteditable="true"]')].filter(vis);
  const el = boxes.find((e) => (e.value ?? e.innerText) === typed) || boxes[0];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};
async function typeInto(page, v, where, act) {
  const el = await field(page, v.field, where);
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const box = await el.boundingBox();
  if (!box) throw new CaptureStop(`The field "${v.field}" isn't on screen; scroll to it first.`);
  await act.click(box.x + box.width / 2, box.y + box.height / 2);
  await act.clear();
  await page.evaluate(MARK);
  const text = String(v.value);
  let typed = '';
  let swaps = 0;
  for (const ch of text) {
    const f = await page.evaluate(FOCUS).catch(() => ({ ok: false }));
    if (!f.same && swaps < 2) {
      swaps++;
      if (!f.ok) {
        const at = await page.evaluate(REFIND, { typed }).catch(() => null);
        if (at) await act.click(at.x, at.y);
      }
      await page.evaluate(MARK).catch(() => {});
      const now = await page.evaluate(FOCUS).catch(() => ({}));
      if (now.value !== typed) {
        await act.clear();
        for (const c of typed) await act.key(c);
      }
    }
    await act.key(ch);
    typed += ch;
  }
  await act.settle?.();
  const shows = (await page.evaluate(FOCUS).catch(() => ({}))).value;
  const swapped = swaps ? ' (the page swapped the field while typing; it carried on in the new one, which a real user may not)' : '';
  if (shows == null) return `typed "${text}" into "${v.field}"; afterwards the page closed or cleared the field (it may have applied the search: check the picture)${swapped}`;
  return shows === text ? `typed "${text}" into "${v.field}"${swapped}` : `typed "${text}" into "${v.field}", but the field shows "${String(shows).slice(0, 40)}"${swapped}`;
}

// bring a target onto the screen before pressing it (a tap off screen lands on nothing)
async function onScreen(page, target, box, where, glide) {
  if (target?.x != null) return box;
  const H = await page.evaluate(() => innerHeight);
  const cy = box.y + box.height / 2;
  if (cy > 8 && cy < H - 8) return box;
  const by = cy - H * 0.4;
  if (glide) await glide(by);
  else {
    await page.evaluate((d) => window.scrollBy(0, d), by);
    await page.waitForTimeout(350);
  }
  return find(page, target, where);
}

// live: quick (a dry run) keeps waits short but still checks every target, every tap's effect and every wait_for.
// Returns notes on what the taps and typing did.
export async function runLive(page, site, steps = [], { touch, quick = false, onStep } = {}) {
  const where = () => new URL(page.url()).pathname;
  const notes = [];
  for (const [i, s] of steps.entries()) {
    const k = kind(s);
    const v = s[k];
    onStep?.(`step ${i + 1} of ${steps.length}: ${summary(s)}`);
    const limit = k === 'wait' ? (Math.min(15, Number(v) || 1) + 5) * 1000 : k === 'wait_for' ? ((v?.max ?? 10) + 5) * 1000 : k === 'fill' ? 15000 + String(v?.value ?? '').length * 300 : k === 'tap' ? 30000 : 20000;
    try {
      await timed(
        async () => {
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
            let box = await find(page, v, where);
            const no = refusePress(site, v, box);
            if (no) throw new CaptureStop(no);
            box = await onScreen(page, v, box, where);
            const x = box.x + box.width / 2;
            const y = box.y + box.height / 2;
            const hit = await under(page, x, y);
            const before = await look(page);
            if (touch) await page.touchscreen.tap(x, y);
            else await page.mouse.click(x, y);
            // an app page may change its address a moment after the tap: give it up to 2.5 s before saying what happened
            for (let t = 0; t < 2500; t += 250) {
              const now = await look(page);
              if (before && now && now.url !== before.url) break;
              await page.waitForTimeout(250);
            }
            await settle(page, quick ? 500 : 900);
            notes.push(outcome(box.text || plainOf(v), before, await look(page), hit));
          } else if (k === 'fill') {
            notes.push(
              await typeInto(page, v, where, {
                click: (x, y) => page.mouse.click(x, y),
                clear: async () => {
                  await page.keyboard.press('Control+A');
                  await page.keyboard.press('Backspace');
                },
                key: async (c) => {
                  await page.keyboard.type(c);
                  await page.waitForTimeout(quick ? 15 : 40);
                },
                settle: () => page.waitForTimeout(quick ? 300 : 500),
              }),
            );
          } else if (k === 'set') {
            const el = await field(page, v.field, where);
            await el.evaluate(SET_VALUE, v.value);
            await page.waitForTimeout(500);
          } else if (k === 'press') {
            if (!KEYS.has(v)) throw new CaptureStop(`Only Enter, Tab and Escape can be pressed (not "${v}").`);
            const before = await look(page);
            await page.keyboard.press(v);
            await settle(page, quick ? 400 : 700);
            const after = await look(page);
            if (before && after && before.url !== after.url) notes.push(`press ${v}: went to ${pathOf(after.url)}`);
          } else if (k === 'wait') {
            await page.waitForTimeout((quick ? Math.min(0.3, Number(v) || 1) : Math.min(15, Number(v) || 1)) * 1000);
          } else if (k === 'wait_for') {
            await waitFor(page, v, (v.max ?? 10) * 1000);
          } else if (k === 'mark') {
            /* only meaningful in recordings */
          } else throw new CaptureStop(`Unknown step "${k}". Steps: ${STEPS}.`);
        },
        limit,
        `This step`,
      );
    } catch (e) {
      throw await stepFailed(page, e, i, steps, notes);
    }
  }
  return notes;
}

const reached = (c) => (!c.url || location.pathname.includes(c.url) || location.href.includes(c.url)) && (!c.text || document.body.innerText.includes(c.text));
const never = (c, s, at) => new CaptureStop(`The page never ${c.url ? `went to ${c.url}` : `showed "${c.text}"`} within ${s} s (it's on ${at}).`);

async function waitFor(page, cond, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await page.evaluate(reached, cond).catch(() => false)) return;
    await page.waitForTimeout(250);
  }
  throw never(cond, Math.round(ms / 1000), new URL(page.url()).pathname);
}

// roughly how many frames a recorded step takes, for its time limit
function framesOf(rec, s, k, v) {
  if (k === 'wait') return rec.frames(Number(v) || 1);
  if (k === 'scroll' || k === 'scroll_to') return rec.frames(s.seconds ?? v?.seconds ?? 2);
  if (k === 'scroll_in' || k === 'set') return rec.frames(v?.seconds ?? 2);
  if (k === 'tap') return rec.frames(0.5 + (s.after ?? 0.5));
  if (k === 'fill') return rec.frames(1 + (v?.seconds ?? 0.15 * String(v?.value ?? '').length));
  if (k === 'wait_for') return rec.frames(v?.max ?? 4);
  return rec.frames(1);
}

export async function runRecorded(rec, site, steps = [], { touch, showTaps = true, onStep }) {
  const page = rec.page;
  const where = () => new URL(page.url()).pathname;
  const notes = [];
  const glide = async (by, seconds = 0.5) => {
    const from = await page.evaluate(() => scrollY);
    const n = rec.frames(seconds);
    for (let i = 1; i <= n; i++) await rec.frame(() => page.evaluate((yy) => window.scrollTo({ top: yy, behavior: 'instant' }), from + by * ease(i / n)));
  };
  for (const [i, s] of steps.entries()) {
    const k = kind(s);
    const v = s[k];
    onStep?.(`step ${i + 1} of ${steps.length}: ${summary(s)}`);
    try {
      await timed(() => recordStep(rec, site, s, k, v, { touch, showTaps, where, notes, glide }), 20000 + framesOf(rec, s, k, v) * 1000, 'This step');
    } catch (e) {
      throw await stepFailed(page, e, i, steps, notes);
    }
  }
  return notes;
}

async function recordStep(rec, site, s, k, v, { touch, showTaps, where, notes, glide }) {
  const page = rec.page;
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
    let box = await find(page, v, where);
    const no = refusePress(site, v, box);
    if (no) throw new CaptureStop(no);
    box = await onScreen(page, v, box, where, glide);
    const hit = await under(page, box.x + box.width / 2, box.y + box.height / 2);
    const before = await look(page);
    const label = box.text || plainOf(v);
    await rec.press(label, box, { touch, showTaps, holdFrames: rec.frames(0.12), afterFrames: rec.frames(s.after ?? 0.5) });
    const note = outcome(label, before, await look(page), hit);
    notes.push(note);
    rec.taps[rec.taps.length - 1].result = note.replace(/^tap "[^"]*": /, '');
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
    const text = String(v.value);
    const per = Math.max(1, Math.floor(rec.frames(v.seconds ?? Math.min(2, 0.12 * text.length)) / Math.max(1, text.length)));
    notes.push(
      await typeInto(page, v, where, {
        click: (x, y) => rec.frame(() => page.mouse.click(x, y)),
        clear: () =>
          rec.frame(async () => {
            await page.keyboard.press('Control+A');
            await page.keyboard.press('Backspace');
          }),
        key: async (c) => {
          await rec.frame(() => page.keyboard.type(c));
          await rec.hold(per - 1);
        },
        settle: () => rec.hold(rec.frames(0.3)),
      }),
    );
  } else if (k === 'press') {
    if (!KEYS.has(v)) throw new CaptureStop(`Only Enter, Tab and Escape can be pressed (not "${v}").`);
    await rec.frame(() => page.keyboard.press(v));
    await rec.hold(rec.frames(0.4));
  } else if (k === 'wait_for') {
    // keep filming while the app loads for real, until it shows what we wait for (or give up after max)
    const max = rec.frames(v.max ?? 4);
    let ok = false;
    for (let i = 0; i < max; i++) {
      await rec.frame();
      if (i < 15) await new Promise((r) => setTimeout(r, 60)); // let real network time pass
      ok = await page.evaluate(reached, v).catch(() => false);
      if (ok && i >= rec.frames(0.3)) break;
    }
    if (!ok) throw never(v, v.max ?? 4, where());
  } else throw new CaptureStop(`Unknown step "${k}". Steps: ${STEPS}.`);
}
