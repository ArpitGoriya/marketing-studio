// status: is Marketing Studio ready on this laptop, and where does the work go?
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { brands, ensureDirs, OUTPUT, ROOT, sites, VERSION } from '../paths.mjs';

export function registerStatus(server) {
  server.registerTool(
    'status',
    {
      title: 'Marketing Studio status',
      description:
        'Check that Marketing Studio is ready on this laptop: where work is saved, which sites and brands it knows, and what still needs setting up. Call this first in a session.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      ensureDirs();
      const s = sites();
      const b = brands();
      const lines = [
        `Marketing Studio ${VERSION} is running (Node ${process.versions.node}, ${os.platform()} ${os.arch()}).`,
        `Work is saved in: ${OUTPUT}`,
        `Supplied files (voiceovers, music, images) go in: ${path.join(OUTPUT, 'Inbox')}`,
        `Sites it can capture: ${s.length ? s.map((x) => `${x.name ?? x.id} (${x.url})`).join(', ') : 'none set up yet'}.`,
        `Brands: ${b.length ? b.map((x) => x.name ?? x.id).join(', ') : 'none set up yet'}.`,
        'Not built yet: capturing screens, recordings and exporting (coming in the next phases).',
      ];
      const hello = fs.readFileSync(path.join(ROOT, 'assets', 'hello.png')).toString('base64');
      return {
        content: [
          { type: 'text', text: lines.join('\n') },
          { type: 'image', data: hello, mimeType: 'image/png' },
        ],
      };
    },
  );
}
