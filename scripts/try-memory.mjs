// How much memory a page costs: opens a page the way captures do and reports the headless Chrome's total memory
// (all its processes) before, while open and after closing, with what the page loaded.
//   node scripts/try-memory.mjs [page] [preview|high]
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { getBrowser, resetBrowser } from '../server/engine/browser.mjs';
import { openPage, resolvePage, siteContext } from '../server/engine/site.mjs';

const page = process.argv[2] ?? '/';
const quality = process.argv[3] ?? 'preview';

// every headless Chrome process's memory, in MB (Windows)
const chromeMb = () => {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' or Name='msedge.exe' or Name='chrome-headless-shell.exe'\" | Where-Object { $_.CommandLine -match 'headless' } | Measure-Object WorkingSetSize -Sum).Sum"], { encoding: 'utf8' });
    return Math.round(Number(out.trim() || 0) / 1048576);
  } catch {
    return -1;
  }
};
const free = () => Math.round(os.freemem() / 1048576);

const b = await getBrowser();
await new Promise((r) => setTimeout(r, 1500));
console.log(`browser started: Chrome ${chromeMb()} MB, laptop ${free()} MB free`);
const { site, url } = resolvePage(undefined, page);
const made = await siteContext(b, site, { device: 'phone', quality });
const types = {};
let bytes = 0;
made.context.on('response', async (r) => {
  const t = r.request().resourceType();
  types[t] = (types[t] ?? 0) + 1;
  bytes += Number(r.headers()['content-length'] ?? 0);
});
const t0 = Date.now();
const p = await openPage(made.context, site, url, { warm: 6 });
console.log(`opened ${url} (${quality}) in ${((Date.now() - t0) / 1000).toFixed(1)} s: Chrome ${chromeMb()} MB, laptop ${free()} MB free`);
console.log(`requests: ${Object.entries(types).map(([k, v]) => `${k} ${v}`).join(', ')}; about ${Math.round(bytes / 1048576)} MB listed`);
console.log(`blocked: ${made.traffic.trackersBlocked} tracker call(s), ${made.traffic.writesBlocked} write(s)`);
const heap = await p.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
console.log(`the page's own JavaScript memory: ${heap} MB; images on it: ${await p.evaluate(() => document.images.length)}; videos: ${await p.evaluate(() => document.querySelectorAll('video').length)}; iframes: ${await p.evaluate(() => document.querySelectorAll('iframe').length)}`);
await made.context.close();
await new Promise((r) => setTimeout(r, 2000));
console.log(`page closed: Chrome ${chromeMb()} MB, laptop ${free()} MB free`);
await resetBrowser();
await new Promise((r) => setTimeout(r, 1500));
console.log(`browser closed: Chrome ${chromeMb()} MB, laptop ${free()} MB free`);
