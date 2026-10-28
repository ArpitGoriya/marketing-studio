// Try recovering from a stuck job without restarting Claude: start a long recording, see it in status as busy,
// reset, and check the job is stopped and the next call works with a fresh browser.
//   node scripts/try-reset.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = new Client({ name: 'try-reset', version: '0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [process.env.MS_SERVER || path.join(ROOT, 'server', 'index.mjs')], env: { ...process.env, MS_JOB_WAIT: '3' }, stderr: 'ignore' }));
const call = async (name, args = {}) => {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  const words = r.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ');
  console.log(`${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)${r.isError ? ' ERROR' : ''}: ${words.replace(/\s+/g, ' ').slice(0, 260)}`);
  return words;
};

const first = await call('record', { project: 'reset test', page: '/', name: 'long', steps: [{ wait: 90 }] });
const job = /job "([^"]+)"/.exec(first)?.[1];
await new Promise((r) => setTimeout(r, 4000));
const busy = await call('status');
console.log(`status shows it busy: ${busy.includes(job)}`);
await call('reset');
await call('wait', { job, seconds: 3 });
const after = await call('status');
console.log(`busy after reset: ${/Busy:/.test(after)}; browser back: ${/Browser: ready/.test(after)}`);
await call('read_page', { page: '/calculators' });
await client.close();
