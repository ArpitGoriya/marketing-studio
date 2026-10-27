// projects: earlier pieces of work, so a new chat can pick up where another stopped: what was captured and recorded,
// what was exported, and the HTML of an exported design to revise.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { openFolder } from '../engine/open.mjs';
import { listProjects } from '../engine/project.mjs';
import { CaptureStop } from '../engine/site.mjs';
import { OUTPUT, slug } from '../paths.mjs';
import { fail, text } from './common.mjs';

export function registerProjects(server) {
  server.registerTool(
    'projects',
    {
      title: 'Projects',
      description:
        'Earlier work. "list" (default): recent projects. "show": what a project has (captures, recordings, exports). "source": the HTML of an exported design (`export_name`), to revise it and export again. "open": open the project folder on the screen.',
      inputSchema: {
        action: z.enum(['list', 'show', 'source', 'open']).optional(),
        project: z.string().optional(),
        export_name: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ action = 'list', project, export_name }) => {
      try {
        const all = listProjects().filter((p) => !p.id.startsWith('_'));
        if (action === 'list') {
          if (!all.length) return { content: [text(`No projects yet. They are saved in ${OUTPUT}.`)] };
          return {
            content: [text(all.slice(0, 20).map((p) => `"${p.title}" (updated ${String(p.updated ?? p.created).slice(0, 10)}): ${Object.keys(p.captures ?? {}).length} capture(s), ${Object.keys(p.clips ?? {}).length} recording(s), exports: ${Object.keys(p.exports ?? {}).join(', ') || 'none'}`).join('\n'))],
          };
        }
        const p = all.find((x) => x.id === slug(project ?? '') || x.title?.toLowerCase() === String(project ?? '').toLowerCase());
        if (!p) throw new CaptureStop(`There's no project "${project ?? ''}". Projects: ${all.map((x) => `"${x.title}"`).join(', ') || 'none'}.`);
        if (action === 'open') {
          openFolder(p.dir);
          return { content: [text(`The folder is open: ${p.dir}`)] };
        }
        if (action === 'show') {
          const lines = [
            `"${p.title}" in ${p.dir}`,
            `Captures: ${Object.entries(p.captures ?? {}).map(([n, c]) => `capture:${n} (${c.page}, ${c.device}${c.logged_in ? ', logged in' : ''}, ${c.files.high ? 'high' : 'preview only'})`).join('; ') || 'none'}`,
            `Recordings: ${Object.entries(p.clips ?? {}).map(([n, c]) => `clip:${n} (${(c.high ?? c.preview)?.seconds} s, ${c.high ? 'high' : 'preview only'})`).join('; ') || 'none'}`,
            `Exports: ${Object.entries(p.exports ?? {}).map(([n, e]) => `${n} (${e.kind}, ${e.width}x${e.height}${e.kind === 'video' ? `, ${e.duration} s, ${e.final ? 'final' : 'preview only'}` : `, ${e.files?.length} slide(s)`})`).join('; ') || 'none'}`,
          ];
          return { content: [text(lines.join('\n'))] };
        }
        const src = path.join(p.dir, 'exports', slug(export_name ?? ''), 'source');
        if (!fs.existsSync(src)) throw new CaptureStop(`"${export_name ?? ''}" hasn't been exported in "${p.title}". Exports: ${Object.keys(p.exports ?? {}).join(', ') || 'none'}.`);
        const files = fs.readdirSync(src).sort();
        return { content: files.map((f) => text(`--- ${f} ---\n${fs.readFileSync(path.join(src, f), 'utf8')}`)) };
      } catch (e) {
        return fail(e);
      }
    },
  );
}
