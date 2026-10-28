// guide: the how-to and best practices for making pieces that work (guide/: the same files as the Claude skill that
// the build packs as dist/marketing-studio-skill.zip). Claude reads the page for the piece before designing it.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ROOT } from '../paths.mjs';
import { text } from './common.mjs';

const DIR = path.join(ROOT, 'guide');
const TOPICS = { start: 'SKILL.md', carousel: 'carousel.md', reel: 'reel.md', screens: 'screens.md', music: 'music.md', caption: 'caption.md' };
const read = (topic) => fs.readFileSync(path.join(DIR, TOPICS[topic]), 'utf8').replace(/^---[\s\S]*?---\s*/, '');

export function registerGuide(server) {
  server.registerTool(
    'guide',
    {
      title: 'How to make it work',
      description:
        'Best practices for this kind of piece, and how to use these tools for it. Read the page for the piece before you design it (once per chat): carousel (carousels and posts), reel (Reels, Stories, Shorts), screens (showing app screens big enough: zooms, frames, no gaps), music (when and how to write it), caption (the post caption); start is the overview, all is everything.',
      inputSchema: { topic: z.enum(['start', 'carousel', 'reel', 'screens', 'music', 'caption', 'all']).optional().describe('Default: start.') },
      annotations: { readOnlyHint: true },
    },
    async ({ topic = 'start' }) => ({ content: [text(topic === 'all' ? Object.keys(TOPICS).map(read).join('\n\n---\n\n') : read(topic))] }),
  );
}
