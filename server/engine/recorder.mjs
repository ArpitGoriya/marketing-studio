// Frame-by-frame recording (from the AR 2.0 launch film's capture engine): JS time runs on Playwright's fake clock
// and CSS/WAAPI animations are stepped by hand, so every frame is exactly 1/fps seconds after the one before, however
// slow the laptop is. Also used to export Claude's own animated designs.
import fs from 'node:fs';
import path from 'node:path';

export const STEPPER = `
  (() => {
    if (window.__ms) return;
    const tracked = new Map();
    window.__ms = {
      t: 0,
      armed: false,
      step(dt) {
        this.t += dt;
        const first = !this.armed;
        this.armed = true;
        for (const a of document.getAnimations()) {
          let s = tracked.get(a);
          if (!s) {
            // animations alive at freeze keep their phase; ones born after it start from 0
            s = { base: first ? a.currentTime ?? 0 : 0, start: this.t - dt };
            tracked.set(a, s);
            try { a.playbackRate = 0; } catch {}
          }
          const want = s.base + (this.t - s.start);
          let end = Infinity;
          try { end = a.effect?.getComputedTiming().endTime ?? Infinity; } catch {}
          if (Number.isFinite(end) && want >= end) {
            try { a.playbackRate = 1; a.finish(); } catch {}
            tracked.delete(a);
          } else {
            try { a.currentTime = want; } catch {}
          }
        }
      },
    };
  })();
`;

// the fingertip circle for filmed taps (in the page; it never catches touches itself)
const TAP_DOT = ({ x, y, a, s }) => {
  let d = document.getElementById('__ms_tap');
  if (!d) {
    d = document.createElement('div');
    d.id = '__ms_tap';
    d.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(30,30,30,0.22);box-shadow:0 0 0 2px rgba(255,255,255,0.7),0 2px 10px rgba(0,0,0,0.18)';
    document.documentElement.appendChild(d);
  }
  d.style.left = `${x}px`;
  d.style.top = `${y}px`;
  d.style.opacity = String(a);
  d.style.transform = `scale(${s})`;
  d.style.display = a > 0.01 ? 'block' : 'none';
};

export class Recorder {
  constructor(page, dir, { fps = 30, quality = 85, check } = {}) {
    this.page = page;
    this.dir = dir;
    this.fps = fps;
    this.dt = 1000 / fps;
    this.quality = quality;
    this.check = check; // called after each frame (e.g. stop on a maintenance page)
    this.n = 0;
    this.taps = [];
    this.marks = [];
    this.frozen = false;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  frames(seconds) {
    return Math.max(1, Math.round(seconds * this.fps));
  }
  async freeze() {
    // stop JS time where it is; from now on time only moves when we step
    const now = await this.page.evaluate(() => Date.now());
    await this.page.clock.pauseAt(now + 500);
    await this.page.evaluate(STEPPER);
    this.frozen = true;
  }
  async frame(before) {
    if (!this.frozen) await this.freeze();
    if (before) await before(this.n);
    await this.page.clock.runFor(this.dt);
    await this.page.evaluate((dt) => window.__ms?.step(dt), this.dt);
    await this.check?.(this.page);
    await this.page.screenshot({ path: path.join(this.dir, `${String(this.n).padStart(4, '0')}.jpg`), type: 'jpeg', quality: this.quality, animations: 'allow', caret: 'hide' });
    this.n++;
    this.onFrame?.(this.n);
  }
  async hold(frames) {
    for (let i = 0; i < frames; i++) await this.frame();
  }
  // a real touch on a phone (finger down, held, lifted) or a mouse click on a desktop. showTaps: a soft fingertip
  // circle is filmed where the finger lands, and fades as it lifts, so viewers see what was pressed.
  async press(label, box, { touch = true, holdFrames = 6, afterFrames = 15, showTaps = true } = {}) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const down = this.n;
    const dot = (a, s) => (showTaps ? this.page.evaluate(TAP_DOT, { x, y, a, s }).catch(() => {}) : null);
    if (touch) {
      this.cdp ??= await this.page.context().newCDPSession(this.page);
      await this.frame(async () => {
        await dot(1, 0.85);
        await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 9, radiusY: 9, force: 1 }] });
      });
      await this.hold(holdFrames - 1);
      await this.frame(() => this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }));
    } else {
      await this.frame(() => this.page.mouse.move(x, y));
      await this.frame(async () => {
        await dot(1, 0.85);
        await this.page.mouse.down();
      });
      await this.hold(holdFrames - 2);
      await this.frame(() => this.page.mouse.up());
    }
    this.taps.push({ label, at: down / this.fps, x, y, box: { x: box.x, y: box.y, width: box.width, height: box.height } });
    // the fingertip lifts: it grows a little and fades over about 0.3 s
    const fade = Math.min(afterFrames, Math.max(1, Math.round(0.3 * this.fps)));
    for (let i = 1; i <= fade; i++) await this.frame(() => dot(1 - i / fade, 0.85 + (0.35 * i) / fade));
    await this.hold(afterFrames - fade);
  }
  mark(label, box) {
    this.marks.push({ label, at: this.n / this.fps, ...(box ? { box } : {}) });
  }
  files() {
    return Array.from({ length: this.n }, (_, i) => path.join(this.dir, `${String(i).padStart(4, '0')}.jpg`));
  }
}
