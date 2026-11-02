// One headless browser for the whole session, shared by captures, recordings and exports, closed after a few idle
// minutes. It uses the laptop's own Chrome or Edge when there is one (nothing to download); otherwise it downloads
// Chromium once into the tool's data folder.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { D, ROOT } from '../paths.mjs';

let shared = null;
let launching = null;
let idle = null;
let how = null; // 'chrome' | 'msedge' | 'downloaded'
// closed after 2 idle minutes, so its memory goes back to the laptop between jobs
const IDLE_MS = 2 * 60 * 1000;
// lighter on memory: nothing running in the background, no translate or casting
const ARGS = ['--disable-background-networking', '--disable-component-update', '--disable-extensions', '--disable-default-apps', '--disable-features=Translate,MediaRouter,OptimizationHints'];
// when the laptop is low on memory (under ~1.2 GB free): a single page process and a cap on each page's JavaScript
// memory. Slower, but it fits. The choice is made at each launch, and the browser is relaunched after each job
// while memory is low (memory.mjs), so it follows the laptop.
const args = () => {
  const free = os.freemem() / 1048576;
  lean = free < 1200;
  return lean ? [...ARGS, '--renderer-process-limit=1', '--js-flags=--max-old-space-size=512'] : [...ARGS, '--renderer-process-limit=3'];
};
let lean = false;
export const isLean = () => lean;

const playwright = () => import('playwright-core');

const bump = () => {
  clearTimeout(idle);
  idle = setTimeout(() => shared?.close().catch(() => {}), IDLE_MS);
  idle.unref?.();
};

const downloaded = () => fs.existsSync(D.browsers) && fs.readdirSync(D.browsers).some((d) => d.startsWith('chromium'));

// download Chromium's headless shell with Playwright's own installer (from Playwright's official CDN)
export async function downloadBrowser(log = () => {}) {
  log('Downloading the capture browser (about 100 MB, only once)…');
  const cli = path.join(ROOT, 'node_modules', 'playwright-core', 'cli.js');
  await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [cli, 'install', 'chromium-headless-shell'], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: D.browsers }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let err = '';
    p.stdout.on('data', () => {});
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`The browser download failed. ${err.split('\n').slice(-3).join(' ')}`))));
  });
}

async function launch() {
  const { chromium } = await playwright();
  const attempts = [];
  if (downloaded()) attempts.push(['downloaded', {}]);
  attempts.push(['chrome', { channel: 'chrome' }], ['msedge', { channel: 'msedge' }]);
  for (const [name, opts] of attempts) {
    try {
      const b = await chromium.launch({ headless: true, args: args(), ...opts });
      how = name;
      console.error(`[marketing-studio] browser started (${name}${lean ? ', lean: the laptop is low on memory' : ''}, ${Math.round(os.freemem() / 1048576)} MB free)`);
      return b;
    } catch {
      /* not on this laptop; try the next */
    }
  }
  await downloadBrowser();
  const b = await chromium.launch({ headless: true, args: args() });
  how = 'downloaded';
  return b;
}

export async function getBrowser() {
  if (shared?.isConnected()) {
    bump();
    return shared;
  }
  launching ??= launch().then(
    (b) => {
      shared = b;
      launching = null;
      b.on('disconnected', () => (shared = null));
      bump();
      return b;
    },
    (e) => {
      launching = null;
      throw e;
    },
  );
  return launching;
}

// a visible browser window, for signing in by hand (it keeps its own profile per site)
export async function headedPersistent(profileDir, opts = {}) {
  const { chromium } = await playwright();
  for (const channel of [undefined, 'chrome', 'msedge']) {
    if (channel === undefined && !downloaded()) continue;
    try {
      return await chromium.launchPersistentContext(profileDir, { headless: false, ...(channel ? { channel } : {}), ...opts });
    } catch {
      /* try the next */
    }
  }
  await downloadBrowser();
  return chromium.launchPersistentContext(profileDir, { headless: false, ...opts });
}

export const browserKind = () => how;
export const closeBrowser = () => shared?.close().catch(() => {});

// reset: let go of the browser (even a stuck one: it gets 5 s to close) so the next call starts a fresh one
export async function resetBrowser() {
  const b = shared;
  shared = null;
  launching = null;
  if (b) await Promise.race([b.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
  return !!b;
}
