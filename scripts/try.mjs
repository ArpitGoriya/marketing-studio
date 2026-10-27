// Call tools like Claude Desktop does, for testing: node scripts/try.mjs <tool> '<json args>' [<tool> '<json>' ...]
// Prints each answer's text and saves its pictures to build/try/<n>-<tool>-<i>.jpg. Waits for jobs automatically.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'build', 'try');
fs.mkdirSync(OUT, { recursive: true });
const client = new Client({ name: 'try', version: '0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'server', 'index.mjs')], env: { ...process.env }, stderr: 'inherit' }));

const calls = process.argv.slice(2);
let n = 0;
for (let i = 0; i < calls.length; i += 2) {
  const tool = calls[i];
  const args = JSON.parse(calls[i + 1] ?? '{}');
  n++;
  const t0 = Date.now();
  let r = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 600000 });
  // follow "still working" answers like Claude would
  for (let k = 0; k < 60; k++) {
    const m = r.content.map((c) => c.text ?? '').join(' ').match(/wait tool with job "([^"]+)"/);
    if (!m) break;
    process.stdout.write(`  … ${r.content[0].text.split('(')[1]?.split(')')[0] ?? 'working'}\n`);
    r = await client.callTool({ name: 'wait', arguments: { job: m[1], seconds: 40 } }, undefined, { timeout: 600000 });
  }
  console.log(`\n=== ${tool} ${r.isError ? '(ERROR) ' : ''}in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  r.content.forEach((c, j) => {
    if (c.type === 'text') console.log(c.text);
    else if (c.type === 'image') {
      const f = path.join(OUT, `${n}-${tool}-${j}.${c.mimeType === 'image/png' ? 'png' : 'jpg'}`);
      fs.writeFileSync(f, Buffer.from(c.data, 'base64'));
      console.log(`[image ${Math.round((c.data.length * 3) / 4 / 1024)} KB -> ${path.relative(ROOT, f)}]`);
    }
  });
}
await client.close();
