// Try the in-chat viewer without Claude Desktop: exports a small test design, then shows the viewer in a stand-in
// chat host (a browser page speaking the MCP Apps messages, with a strict sandbox policy) and presses its buttons:
// Next, Copy all, Copy, Copy caption and, for a video (with written music), HD version.
// Screenshots go to build/try-viewer/. Copy really copies (the clipboard ends up with the test caption).
//   node scripts/try-viewer.mjs [images|video|final]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'build', 'try-viewer');
fs.mkdirSync(OUT, { recursive: true });
const kind = ['video', 'final'].includes(process.argv[2]) ? 'video' : 'images';

const client = new Client({ name: 'try-viewer', version: '0' }, { capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } } });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [process.env.MS_SERVER || path.join(ROOT, 'server', 'index.mjs')], env: { ...process.env, MS_NO_OPEN: '1' }, stderr: 'inherit' }));

const slide = (n, bg) => `<div style="width:1080px;height:1350px;background:${bg};color:#fff;font:700 140px Inter;display:grid;place-items:center">Slide ${n}</div>`;
const caption = 'Still tracking bookings in a diary?\n\nAll in one place, free.\n\n#mehndiartist #anokhireet';
const args =
  kind === 'images'
    ? { project: 'viewer test', name: 'test-carousel', kind, size: '1080x1350', caption, pages: [slide(1, '#7a1f2b'), slide(2, '#1f4d3a'), slide(3, '#2b3a7a')] }
    : {
        project: 'viewer test',
        name: 'test-video',
        kind,
        size: '1080x1920',
        duration: 9,
        quality: process.argv[2] === 'final' ? 'final' : 'preview',
        caption,
        html: '<style>body{margin:0;background:#7a1f2b}.dot{position:absolute;top:860px;left:0;width:200px;height:200px;border-radius:50%;background:#f3e6d0;animation:go 9s linear forwards}@keyframes go{to{left:880px}}h1{font:700 110px Inter;color:#fff;text-align:center;margin-top:300px}</style><h1>Test video</h1><div class="dot"></div>',
        music: { tempo: 100, key: 'D', parts: [{ play: 'tanpura', from: 0, to: 9 }, { play: 'tabla', from: 0, to: 7.2, pattern: 'dha ge na ti | na ke dhi na' }, { play: 'santoor', from: 2.4, to: 7.2, pattern: 'D5 . F5 A5 | G5 - F5 E5' }, { play: 'bell', at: [7.2] }] },
      };
// what the laptop's clipboard holds now (Windows): the files on it, or its text
const clipboard = async () => {
  if (process.platform !== 'win32') return 'not checked on this system';
  const { execFileSync } = await import('node:child_process');
  return execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; $f = [System.Windows.Forms.Clipboard]::GetFileDropList(); if ($f.Count) { "files: " + (($f | ForEach-Object { Split-Path $_ -Leaf }) -join ", ") } else { "text: " + [System.Windows.Forms.Clipboard]::GetText() }'], { encoding: 'utf8' }).trim().replace(/\r?\n/g, ' / ');
};

const t0 = Date.now();
const result = await client.callTool({ name: 'export', arguments: args }, undefined, { timeout: 600000 });
console.log(`export answered in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${result.content[0].text.split('\n')[0]}`);
console.log(`viewer data in the answer: ${JSON.stringify(result._meta?.['marketing-studio/view'] ?? null).slice(0, 160)}`);

const html = (await client.readResource({ uri: 'ui://marketing-studio/viewer.html' })).contents[0].text;
console.log(`viewer page: ${Math.round(html.length / 1024)} KB`);
// roughly what a chat app's sandbox allows: inline code, and pictures and video from blob: and data: only
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:";
const doc = html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${CSP}">`);

const HOST = `<!doctype html><html><body style="margin:0;background:#faf9f5;font-family:system-ui">
<div style="max-width:720px;margin:24px auto"><iframe id="v" style="width:100%;height:200px;border:1px solid rgba(0,0,0,.15);border-radius:12px;background:#fff"></iframe></div>
<script>
  const f = document.getElementById('v');
  const send = (m) => f.contentWindow.postMessage(m, '*');
  window.seen = [];
  window.addEventListener('message', async (e) => {
    if (e.source !== f.contentWindow) return;
    const m = e.data;
    if (!m || m.jsonrpc !== '2.0') return;
    window.seen.push(m.method ?? 'answer');
    if (m.method === 'ui/notifications/size-changed') return void (f.style.height = Math.ceil(m.params.height) + 'px');
    if (m.method === 'ui/notifications/initialized') {
      // MS_NO_INPUT=1: like a chat app that sends the result without the tool's arguments first
      if (window.TOOL_ARGS) send({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: window.TOOL_ARGS } });
      send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: window.TOOL_RESULT });
      return;
    }
    if (m.id === undefined) return;
    try {
      let result = {};
      if (m.method === 'ui/initialize')
        result = { protocolVersion: m.params.protocolVersion, hostInfo: { name: 'stand-in', version: '0' }, hostCapabilities: { serverTools: {}, serverResources: {}, downloadFile: {}, updateModelContext: { text: {} } }, hostContext: { theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'], platform: 'desktop' } };
      else if (m.method === 'tools/call' || m.method === 'resources/read') result = await window.mcp(m.method, m.params);
      else if (m.method === 'ui/download-file') window.downloads = m.params.contents.map((c) => ({ name: c.resource.uri, kb: Math.round((c.resource.blob.length * 3) / 4 / 1024) }));
      else if (m.method === 'ui/update-model-context') window.told = m.params.content?.[0]?.text;
      else if (m.method === 'ui/request-display-mode') result = { mode: m.params.mode };
      send({ jsonrpc: '2.0', id: m.id, result });
    } catch (err) {
      send({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: String(err.message || err) } });
    }
  });
</script></body></html>`;

let browser;
for (const channel of ['chrome', 'msedge']) {
  browser = await chromium.launch({ channel }).catch(() => null);
  if (browser) break;
}
const page = await browser.newPage({ viewport: { width: 768, height: 1100 } });
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(e.message));
await page.exposeFunction('mcp', (method, params) => (method === 'tools/call' ? client.callTool(params, undefined, { timeout: 600000 }) : client.readResource(params)));
await page.setContent(HOST);
await page.evaluate(({ doc, args, result }) => {
  window.TOOL_ARGS = args; // null with MS_NO_INPUT=1
  window.TOOL_RESULT = result;
  document.getElementById('v').srcdoc = doc;
}, { doc, args: process.env.MS_NO_INPUT ? null : args, result });
await page.waitForTimeout(500);
const view = page.frames().find((f) => f !== page.mainFrame());
const status = () => view.locator('#status').textContent();

if (kind === 'images') {
  await view.waitForFunction(() => document.querySelectorAll('.slide img, .slide canvas').length === 3, null, { timeout: 120000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '1-slides.png') });
  console.log(`slides shown as: ${await view.evaluate(() => [...document.querySelectorAll('.slide > *')].map((e) => e.tagName.toLowerCase()).join(', '))}; counter "${await view.locator('#count').textContent()}"`);
  await view.locator('#next').click();
  await page.waitForTimeout(1200);
  console.log(`after Next: counter "${await view.locator('#count').textContent()}", Claude was told: ${await page.evaluate(() => window.told ?? 'nothing')}`);
  await page.screenshot({ path: path.join(OUT, '2-next.png') });
  console.log(`buttons: ${await view.evaluate(() => [...document.querySelectorAll('.actions button:not([hidden])')].map((b) => b.textContent.trim() || b.getAttribute('aria-label')).join(' | '))}`);
  await view.locator('#copyAll').click();
  await view.waitForFunction(() => /Copied|Couldn/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
  console.log(`Copy all: "${await status()}"; clipboard ${await clipboard()}`);
} else {
  if (result._meta?.['marketing-studio/view']?.job) {
    await view.waitForFunction(() => /%/.test(document.querySelector('#meta').textContent), null, { timeout: 60000 });
    await page.screenshot({ path: path.join(OUT, '0-waiting.png') });
    console.log(`while it works: "${await view.locator('#title').textContent()}", ${await view.locator('#meta').textContent()}, "${await status()}"`);
    // Snake while it waits: start, steer, crash into the wall, play again
    const game = () => view.evaluate(() => JSON.stringify(window.msSnake.info()));
    await view.locator('#play').click();
    console.log(`Snake started: ${await game()}`);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(400);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, '0-snake.png') });
    console.log(`after Up, Right: ${await game()}`);
    await view.waitForFunction(() => window.msSnake.info()?.state === 'over', null, { timeout: 20000 }).catch(() => {});
    await page.screenshot({ path: path.join(OUT, '0-snake-over.png') });
    console.log(`into the wall: ${await game()}`);
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    console.log(`Space: ${await game()}`);
  }
  await view.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, { timeout: 300000, polling: 1000 });
  console.log(`video: ${await view.evaluate(() => { const v = document.querySelector('video'); return `${v.videoWidth}x${v.videoHeight}, ${v.duration.toFixed(1)} s`; })}; header "${await view.locator('#meta').textContent()}"`);
  console.log(`Snake when the video came: ${await view.evaluate(() => JSON.stringify(window.msSnake.info()))}, game on: ${await view.evaluate(() => window.msSnake.on())}; status "${await status()}"`);
  await view.evaluate(() => { const v = document.querySelector('video'); v.currentTime = 4; });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, '1-video.png') });
  console.log(`buttons: ${await view.evaluate(() => [...document.querySelectorAll('.actions button:not([hidden])')].map((b) => b.textContent.trim() || b.getAttribute('aria-label')).join(' | '))}`);
  console.log(`export said: ${result.content[0].text.split('\n').filter((l) => /sound|Music|Parts/.test(l)).join(' / ')}`);
  // the HD version, made in place from the preview
  if (await view.locator('#final').isVisible()) {
    const t1 = Date.now();
    await view.locator('#final').click();
    await view.waitForFunction(() => /HD version/.test(document.querySelector('#title').textContent), null, { timeout: 30000 });
    console.log(`HD version pressed: "${await view.locator('#title').textContent()}" ${await view.locator('#meta').textContent()}`);
    await view.waitForFunction(() => /^Final/.test(document.querySelector('#meta').textContent) && document.querySelector('video')?.readyState >= 1, null, { timeout: 600000, polling: 1000 });
    console.log(`after ${((Date.now() - t1) / 1000).toFixed(0)} s: "${await view.locator('#meta').textContent()}", HD button ${(await view.locator('#final').isVisible()) ? 'still there' : 'gone'}; Claude was told: ${await page.evaluate(() => window.told ?? 'nothing')}`);
    await page.screenshot({ path: path.join(OUT, '2-final.png') });
  }
}
await view.locator('#copy').click();
await view.waitForFunction(() => /Copied|Couldn/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
console.log(`Copy: "${await status()}"; clipboard ${await clipboard()}`);
await view.locator('#copyCaption').click();
await view.waitForFunction(() => /caption|Couldn/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
console.log(`Copy caption: "${await status()}"; clipboard ${await clipboard()}`);
console.log(`messages from the viewer: ${[...new Set(await page.evaluate(() => window.seen))].join(', ')}`);
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no errors in the page');
console.log(`screenshots: ${OUT}`);
await browser.close();
await client.close();
