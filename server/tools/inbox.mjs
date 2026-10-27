// inbox: the folder where people put files for Claude to use (a voiceover, a music track, an image). Chat can't take
// audio files, so they go here. For audio it reports what Claude needs to time a video: length, loudness, and the
// spoken parts between pauses (one per line of a script, usually).
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { openFolder } from '../engine/open.mjs';
import { CaptureStop } from '../engine/site.mjs';
import { withStudio } from '../engine/studio.mjs';
import { ensureDirs, INBOX } from '../paths.mjs';
import { fail, text } from './common.mjs';

const AUDIO = /\.(mp3|m4a|aac|wav|ogg|flac|opus|webm)$/i;
const IMAGE = /\.(png|jpe?g|webp|svg)$/i;

export function registerInbox(server) {
  server.registerTool(
    'inbox',
    {
      title: 'Inbox (supplied files)',
      description:
        'The folder where people put a voiceover, music or images for you to use. "open" (default) opens the folder on their screen so they can drop files in; "list" shows what is there; "info" on an audio file gives its length, loudness and the spoken parts between pauses, to time scenes to the voiceover. Refer to files as inbox:<file name>.',
      inputSchema: {
        action: z.enum(['open', 'list', 'info']).optional(),
        file: z.string().optional().describe('For "info": the file name (or inbox:<name>).'),
      },
    },
    async ({ action = 'open', file }) => {
      try {
        ensureDirs();
        const files = fs.readdirSync(INBOX).filter((f) => !f.startsWith('.') && fs.statSync(path.join(INBOX, f)).isFile());
        const listing = files.length
          ? files.map((f) => `inbox:${f} (${AUDIO.test(f) ? 'audio' : IMAGE.test(f) ? 'image' : 'file'}, ${(fs.statSync(path.join(INBOX, f)).size / 1048576).toFixed(1)} MB)`).join('\n')
          : 'The Inbox is empty.';
        if (action === 'open') {
          openFolder(INBOX);
          return { content: [text(`The Inbox folder is open on the screen: ${INBOX}\nAsk them to drop the files in, then say when done.\n${listing}`)] };
        }
        if (action === 'list') return { content: [text(listing)] };
        const name = String(file ?? '').replace(/^inbox:/, '');
        const f = path.join(INBOX, name);
        if (!name || !fs.existsSync(f)) throw new CaptureStop(`There's no "${name}" in the Inbox.\n${listing}`);
        if (!AUDIO.test(name)) return { content: [text(`inbox:${name} is ${IMAGE.test(name) ? 'an image' : 'a file'} (${(fs.statSync(f).size / 1024).toFixed(0)} KB). Use it in designs as inbox:${name}.`)] };
        const a = await withStudio([INBOX], (s) => s.analyse(f));
        const lines = [
          `inbox:${name}: ${a.duration} s, ${a.lufs} LUFS, peak ${a.peak} dB (exports level it to -14 LUFS).`,
          a.speech.length > 1
            ? `Spoken parts (time them to scenes or script lines): ${a.speech.map((s, i) => `${i + 1}) ${s.from}-${s.to} s`).join(', ')}`
            : 'No clear pauses (one continuous part, e.g. music).',
          ...(a.pauses.length ? [`Pauses: ${a.pauses.map((p) => `${p.from}-${p.to} s`).join(', ')}`] : []),
        ];
        return { content: [text(lines.join('\n'))] };
      } catch (e) {
        return fail(e);
      }
    },
  );
}
