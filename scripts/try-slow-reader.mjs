// Does the extension stay responsive when Claude Desktop is slow to read its replies? Starts the server, asks for a
// dozen big answers, then doesn't read for 8 s (as a busy or memory-starved app wouldn't). The server's freeze
// detector (engine/diagnostics.mjs) says on stderr if its own process stalled meanwhile.
//   node scripts/try-slow-reader.mjs            the way the extension writes now (a writer thread)
//   MS_DIRECT_STDIO=1 node scripts/try-slow-reader.mjs   the old direct writes, for comparison
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = spawn(process.execPath, [process.env.MS_SERVER || path.join(ROOT, 'server', 'index.mjs')], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
const logs = [];
server.stderr.on('data', (d) => logs.push(...String(d).split('\n').filter(Boolean)));
const send = (m) => server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);

let got = 0;
let buf = '';
server.stdout.on('data', (d) => {
  buf += d;
  for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) if (buf.slice(0, i).includes('"result"')) got++;
});

send({ id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'slow-reader', version: '0' } } });
await new Promise((r) => setTimeout(r, 1500));
send({ method: 'notifications/initialized' });
server.stdout.pause(); // the app is busy: nobody reads the replies
for (let i = 1; i <= 12; i++) send({ id: i, method: 'tools/call', params: { name: 'guide', arguments: { topic: 'all' } } });
await new Promise((r) => setTimeout(r, 8000));
const during = got;
server.stdout.resume();
await new Promise((r) => setTimeout(r, 3000));
const froze = logs.filter((l) => /froze for/.test(l));
console.log(`${process.env.MS_DIRECT_STDIO ? 'direct writes (old)' : 'writer thread (new)'}: ${got - during} of 12 replies arrived once reading resumed`);
console.log(froze.length ? `the extension froze: ${froze.join(' | ')}` : 'the extension never froze');
server.kill();
