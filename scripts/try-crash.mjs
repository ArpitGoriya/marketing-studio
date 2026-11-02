// Does a job survive the browser dying under it (as Chrome does when the laptop runs out of memory)? Starts a
// recording, kills the capture browser halfway, and checks the job tries again by itself and finishes. Also starts
// two jobs at once to check they take turns.
//   node scripts/try-crash.mjs
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logs = [];
const transport = new StdioClientTransport({ command: process.execPath, args: [process.env.MS_SERVER || path.join(ROOT, 'server', 'index.mjs')], env: { ...process.env, MS_JOB_WAIT: '3' }, stderr: 'pipe' });
transport.stderr.on('data', (d) => logs.push(...String(d).split('\n').filter((l) => /trying again|failed|browser started|stopped/.test(l))));
const client = new Client({ name: 'try-crash', version: '0' });
await client.connect(transport);
const text = (r) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ').replace(/\s+/g, ' ');
const call = (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: 300000 });
const until = async (job) => {
  for (;;) {
    const r = await call('wait', { job, seconds: 25 });
    if (!/Still working/.test(text(r))) return r;
  }
};

// 1. the browser dies halfway through a recording
const first = text(await call('record', { project: 'crash test', page: '/calculators', name: 'crash-take', steps: [{ wait: 1 }, { scroll: 600, seconds: 2 }, { wait: 6 }] }));
const job = /job "([^"]+)"/.exec(first)?.[1];
await new Promise((r) => setTimeout(r, 12000));
const killed = execFileSync('powershell.exe', ['-NoProfile', '-Command', "$p = Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' or Name='msedge.exe' or Name='chrome-headless-shell.exe'\" | Where-Object { $_.CommandLine -match 'headless' }; $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; $p.Count"], { encoding: 'utf8' }).trim();
console.log(`killed ${killed} headless browser process(es) 12 s into the recording`);
const done = await until(job);
console.log(`the recording ${done.isError ? 'FAILED' : 'finished'}: ${text(done).slice(0, 160)}`);

// 2. two jobs at once take turns
const [a, b] = await Promise.all([call('read_page', { page: '/calculators' }), call('read_page', { page: '/shops' })]);
console.log(`two at once: first "${text(a).slice(0, 70)}" / second "${text(b).slice(0, 90)}"`);
for (const r of [a, b]) {
  const j = /job "([^"]+)"/.exec(text(r))?.[1];
  if (j) {
    const end = await until(j);
    console.log(`  ${j} ${end.isError ? 'FAILED' : 'finished'}: ${text(end).slice(0, 80)}`);
  }
}
console.log(`log: ${logs.join(' | ')}`);
await client.close();
