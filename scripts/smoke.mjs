// Quick check without Claude: start the server the way Claude Desktop does (stdio), list its tools and call each
// one that needs no input. Prints what Claude would get back. Usage: npm run check
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = new Client({ name: 'smoke', version: '0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'server', 'index.mjs')], env: { ...process.env, MS_OUTPUT_DIR: process.env.MS_OUTPUT_DIR ?? '' } }));

const instructions = client.getInstructions();
console.log(`instructions: ${instructions ? `${instructions.split('\n')[0].slice(0, 80)}… (${instructions.length} chars)` : 'none'}`);
const { tools } = await client.listTools();
console.log(`tools: ${tools.map((t) => t.name).join(', ')}`);
const r = await client.callTool({ name: 'status', arguments: {} });
for (const c of r.content) console.log(c.type === 'text' ? c.text : `[${c.type} ${c.mimeType}, ${Math.round((c.data.length * 3) / 4 / 1024)} KB]`);
await client.close();
