// Finding things on a page the way a person would describe them: the text on a button or link ('Calculate'),
// { text, near: 'top' | 'bottom' }, { label } (an accessible name or placeholder), { href: '/vendors' } (a link by its
// address), { x, y } (a point on the screen, in CSS px), or { css } for anything else. A text that no visible text
// matches also finds a button or link drawn as a picture by its picture's name, its address or its label (the header's
// "VENDORS" is an image of vendors.svg linking to /vendors).
// Returns a box in CSS pixels relative to the viewport, or null.
export const describe = (t) =>
  typeof t === 'string'
    ? `"${t}"`
    : t?.text
      ? `"${t.text}"`
      : t?.label
        ? `the "${t.label}" field`
        : t?.href
          ? `the link to ${t.href}`
          : t?.x != null
            ? `the point (${t.x}, ${t.y})`
            : t?.css
              ? `"${t.css}"`
              : 'that';

// container: grow a text match to the card or panel around it (for crops: "Suggested Rent" means the result card)
export const locate = (page, target, { clickable = true, container = false } = {}) =>
  page.evaluate(
    ({ tg, clickable, container }) => {
      const H = innerHeight;
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
      };
      const up = (el) => (clickable ? el.closest('a,button,[role="button"],[role="tab"],label,input,select,textarea,summary') || el : el);
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const t = typeof tg === 'string' ? { text: tg } : tg;
      const named = (e) => (e?.closest?.('a,button,[role="button"]') ?? e);
      const label = (e) => (e ? (e.innerText || e.getAttribute('aria-label') || e.getAttribute('title') || e.querySelector?.('img[alt]')?.alt || '').replace(/\s+/g, ' ').trim().slice(0, 80) : '');
      // a point: whatever is there (the tap lands exactly on it)
      if (t.x != null && t.y != null) {
        const e = named(document.elementFromPoint(Number(t.x), Number(t.y)));
        return { x: Number(t.x) - 1, y: Number(t.y) - 1, width: 2, height: 2, text: label(e) };
      }
      const path = (u) => {
        try {
          return new URL(u, location.href).pathname.replace(/\/+$/, '') || '/';
        } catch {
          return '';
        }
      };
      let cands = [];
      if (t.href) {
        const want = path(t.href);
        const links = [...document.querySelectorAll('a[href]')];
        cands = links.filter((a) => path(a.getAttribute('href')) === want);
        if (!cands.length) cands = links.filter((a) => a.href.includes(t.href));
      } else if (t.css) cands = [...document.querySelectorAll(t.css)];
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
        const outer = (list) => list.filter((e) => !list.some((o) => o !== e && e.contains(o))).map(up);
        // first the exact text, then a picture button of that name, and only then text that merely contains it
        cands = outer(all.filter((e) => norm(e.innerText) === want || norm(e.getAttribute('aria-label')) === want));
        if (clickable) {
          // a link or button whose picture has these words (alt text) counts too, and something you can press beats
          // plain text with the same words (a tile's name under its picture link)
          const pics = [...document.querySelectorAll('a,button,[role="button"]')].filter((e) => [...e.querySelectorAll('img[alt]')].some((i) => norm(i.alt) === want));
          const all2 = [...cands, ...pics];
          const pressable = all2.filter((e) => e.matches('a,button,[role="button"],[role="tab"],label,input,select,textarea,summary'));
          cands = pressable.filter(vis).length ? pressable : all2;
        }
        if (!cands.filter(vis).length && clickable) {
          const key = want.replace(/[^a-z0-9]+/g, '');
          const base = (u) => (u || '').split(/[?#]/)[0].split('/').pop().replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
          const urlsIn = (e) => {
            const out = [];
            for (const x of [e, ...e.querySelectorAll('*')].slice(0, 30)) {
              if (x.tagName === 'IMG') out.push(x.getAttribute('src'), x.getAttribute('alt'));
              const s = getComputedStyle(x);
              for (const v of [s.maskImage, s.webkitMaskImage, s.backgroundImage]) for (const m of String(v || '').matchAll(/url\(["']?([^"')]+)/g)) out.push(m[1]);
            }
            return out;
          };
          cands = [...document.querySelectorAll('a,button,[role="button"],[role="tab"]')].filter((e) => {
            const names = [e.getAttribute('aria-label'), e.getAttribute('title'), e.tagName === 'A' ? e.getAttribute('href') : null, ...urlsIn(e)];
            return names.some((n) => n && base(n) === key);
          });
        }
        if (!cands.filter(vis).length) cands = outer(all.filter((e) => e.childElementCount === 0 && norm(e.innerText).includes(want)));
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
      let el = cands[0];
      if (!el) return null;
      if (container && !t.css) {
        // the nearest ancestor that looks like a card: its own background, border or shadow, and not the whole page
        const looksLikeCard = (e) => {
          const s = getComputedStyle(e);
          const bg = s.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor);
          return bg || parseFloat(s.borderTopWidth) > 0 || (s.boxShadow && s.boxShadow !== 'none');
        };
        const base = el.getBoundingClientRect();
        for (let a = el.parentElement, i = 0; a && a !== document.body && i < 6; a = a.parentElement, i++) {
          const r = a.getBoundingClientRect();
          if (r.height > innerHeight * 0.8 || r.width > innerWidth * 0.999) break;
          if (looksLikeCard(a) && r.height > base.height * 1.5) {
            el = a;
            break;
          }
        }
      }
      const r = el.getBoundingClientRect();
      const link = el.closest('a[href]');
      return { x: r.x, y: r.y, width: r.width, height: r.height, text: label(el) || (el.getAttribute('placeholder') || '').trim().slice(0, 80), ...(link ? { href: path(link.getAttribute('href')) } : {}) };
    },
    { tg: target, clickable, container },
  );

// the text an element would be pressed by, checked against the site's "never press" list
export function refusePress(site, target, box) {
  const words = (site.never_press ?? []).map((w) => w.toLowerCase());
  const said = `${typeof target === 'string' ? target : target?.text ?? target?.label ?? ''} ${box?.text ?? ''}`.toLowerCase();
  const hit = words.find((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(said));
  return hit ? `Not pressing ${describe(target)}: "${hit}" buttons are never pressed (they could change something on the site).` : null;
}
