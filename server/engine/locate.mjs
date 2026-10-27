// Finding things on a page the way a person would describe them: the text on a button or link ('Calculate'),
// { text, near: 'top' | 'bottom' }, { label } (an accessible name or placeholder), or { css } for anything else.
// Returns a box in CSS pixels relative to the viewport, or null.
export const describe = (t) => (typeof t === 'string' ? `"${t}"` : t?.text ? `"${t.text}"` : t?.label ? `the "${t.label}" field` : t?.css ? `"${t.css}"` : 'that');

export const locate = (page, target, { clickable = true } = {}) =>
  page.evaluate(
    ({ tg, clickable }) => {
      const H = innerHeight;
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
      };
      const up = (el) => (clickable ? el.closest('a,button,[role="button"],[role="tab"],label,input,select,textarea,summary') || el : el);
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const t = typeof tg === 'string' ? { text: tg } : tg;
      let cands = [];
      if (t.css) cands = [...document.querySelectorAll(t.css)];
      else if (t.label) {
        const want = norm(t.label);
        const named = (e) => [e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('placeholder'), e.getAttribute('alt'), e.getAttribute('name')].some((v) => norm(v) === want);
        cands = [...document.querySelectorAll('[aria-label],[title],[placeholder],img[alt],[name]')].filter(named);
        for (const l of document.querySelectorAll('label')) {
          if (norm(l.innerText) === want || norm(l.innerText).startsWith(want)) {
            const f = l.control || l.querySelector('input,select,textarea') || (l.htmlFor && document.getElementById(l.htmlFor));
            if (f) cands.push(f);
          }
        }
      } else if (t.text) {
        const want = norm(t.text);
        const all = [...document.querySelectorAll('body *')];
        let own = all.filter((e) => norm(e.innerText) === want || norm(e.getAttribute('aria-label')) === want);
        if (!own.length) own = all.filter((e) => e.childElementCount === 0 && norm(e.innerText).includes(want));
        cands = own.filter((e) => !own.some((o) => o !== e && e.contains(o))).map(up);
      }
      cands = [...new Set(cands)].filter(vis);
      if (t.near === 'bottom') cands = cands.filter((e) => e.getBoundingClientRect().top > H * 0.7);
      if (t.near === 'top') cands = cands.filter((e) => e.getBoundingClientRect().bottom < H * 0.3);
      // prefer what's on screen now
      cands.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const on = (r) => (r.bottom > 0 && r.top < H ? 0 : 1);
        return on(ra) - on(rb);
      });
      const el = cands[0];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 80) };
    },
    { tg: target, clickable },
  );

// the text an element would be pressed by, checked against the site's "never press" list
export function refusePress(site, target, box) {
  const words = (site.never_press ?? []).map((w) => w.toLowerCase());
  const said = `${typeof target === 'string' ? target : target?.text ?? target?.label ?? ''} ${box?.text ?? ''}`.toLowerCase();
  const hit = words.find((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(said));
  return hit ? `Not pressing ${describe(target)}: "${hit}" buttons are never pressed (they could change something on the site).` : null;
}
