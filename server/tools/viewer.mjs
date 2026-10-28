// The viewer in the chat (an MCP App): export and show answer with the finished slides or video right in the
// conversation, with Copy, Copy all, Copy caption and Show-in-folder buttons (and, for a preview video, one that makes
// the HD version in place), so nobody opens a folder to review. Claude still designs everything; the viewer only shows
// the files. Chat apps without MCP Apps get the plain answer as before. The viewer fetches files through the
// msfile:// resource and works its buttons through the app-only tools here (and viewer_final in export.mjs).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getUiCapability, registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { copyFiles, copyText, revealFile } from '../engine/clipboard.mjs';
import { getJob } from '../engine/jobs.mjs';
import { openFolder } from '../engine/open.mjs';
import { openProject } from '../engine/project.mjs';
import { CaptureStop } from '../engine/site.mjs';
import { OUTPUT, ROOT, slug } from '../paths.mjs';
import { fail, text } from './common.mjs';

export const VIEW_KEY = 'marketing-studio/view';
const VIEWER_URI = 'ui://marketing-studio/viewer.html';
export const viewerUi = { ui: { resourceUri: VIEWER_URI } };
export const appOnly = { ui: { resourceUri: VIEWER_URI, visibility: ['app'] } };

// does this chat app show MCP Apps? Then export leaves the folder closed: the viewer has a button for it.
export const showsViewer = (server) => !!getUiCapability(server.server.getClientCapabilities())?.mimeTypes?.includes(RESOURCE_MIME_TYPE);

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4' };
const posix = (rel) => rel.split(path.sep).join('/');
const fileUri = (project, rel) => `msfile://${encodeURIComponent(project)}/${encodeURIComponent(posix(rel))}`;

// a finished file of a project, by its path inside the project; nothing outside the project folder
function projectFile(project, rel) {
  const base = path.join(OUTPUT, String(project));
  const f = path.resolve(base, String(rel));
  if (!/^[a-z0-9-]+$/.test(project) || !f.startsWith(base + path.sep) || !MIME[path.extname(f).toLowerCase()] || !fs.existsSync(f)) throw new CaptureStop("That file isn't in the project any more. Export it again.");
  return f;
}

export function existingProject(name) {
  const id = slug(name);
  if (!fs.existsSync(path.join(OUTPUT, id, 'project.json'))) throw new CaptureStop(`There's no project "${name}". The projects tool lists them.`);
  return openProject(id);
}

// what the viewer shows for one export of a project
export function viewData(p, name) {
  const e = p.data.exports[name];
  if (!e) return null;
  const base = { project: p.id, title: p.data.title, name, kind: e.kind, width: e.width, height: e.height, caption: e.caption ?? null, at: e.at };
  if (e.kind === 'images') return { ...base, items: e.files.map((f, i) => ({ label: `Slide ${i + 1}`, file: posix(f), name: `${name}-${path.basename(f)}`, view: fileUri(p.id, e.views?.[i] ?? f) })) };
  const quality = e.latest ?? (e.final ? 'final' : 'preview');
  const file = e[quality];
  const canFinal = quality === 'preview' && !!e.settings;
  return { ...base, video: { quality, canFinal, duration: e.duration, file: posix(file), name: path.basename(file), view: fileUri(p.id, (quality === 'final' && e.view_final) || file) } };
}

// the page itself, with the MCP Apps client inlined (the viewer loads nothing from the internet)
let page;
function viewerHtml() {
  if (page) return page;
  const sdk = fs.readFileSync(createRequire(import.meta.url).resolve('@modelcontextprotocol/ext-apps/app-with-deps'), 'utf8');
  const at = sdk.lastIndexOf('export{');
  const names = sdk
    .slice(at + 7, sdk.indexOf('}', at))
    .split(',')
    .map((s) => s.trim().split(/\s+as\s+/))
    .map(([local, exported]) => `${exported ?? local}:${local}`);
  const lib = `${sdk.slice(0, at)}window.McpExtApps={${names.join(',')}};`.replace(/<\/script/gi, '<\\/script');
  page = fs.readFileSync(path.join(ROOT, 'server', 'viewer', 'viewer.html'), 'utf8').replace('<!--SDK-->', () => `<script type="module">${lib}</script>`);
  return page;
}

const answer = (structuredContent, words) => ({ content: [text(words)], structuredContent });

export function registerViewer(server) {
  registerAppResource(server, 'Marketing Studio viewer', VIEWER_URI, { description: 'Shows finished slides and videos in the chat.' }, async () => ({
    contents: [{ uri: VIEWER_URI, mimeType: RESOURCE_MIME_TYPE, text: viewerHtml(), _meta: { ui: { prefersBorder: true } } }],
  }));

  server.registerResource('project-file', new ResourceTemplate('msfile://{project}/{file}', { list: undefined }), { title: 'A finished file', description: 'A slide or video of a project, for the viewer.' }, async (uri, vars) => {
    const f = projectFile(decodeURIComponent(vars.project), decodeURIComponent(vars.file));
    return { contents: [{ uri: uri.href, mimeType: MIME[path.extname(f).toLowerCase()], blob: fs.readFileSync(f).toString('base64') }] };
  });

  registerAppTool(
    server,
    'show',
    {
      title: 'Show a finished design',
      description: "Show an exported design again in the chat (slides to swipe through, or the video), with Copy and Show-in-folder buttons. Only when the person asks to see an earlier piece; a new export shows itself. Defaults to the project's latest export.",
      inputSchema: { project: z.string(), name: z.string().optional().describe('The export name; leave out for the latest.') },
      _meta: viewerUi,
    },
    async (a) => {
      try {
        const p = existingProject(a.project);
        const name = a.name ?? Object.entries(p.data.exports).sort(([, x], [, y]) => String(y.at).localeCompare(String(x.at)))[0]?.[0];
        const view = name && viewData(p, name);
        if (!view) throw new CaptureStop(`Nothing exported${a.name ? ` as "${a.name}"` : ''} in "${p.data.title}" yet.`);
        const what = view.kind === 'images' ? `${view.items.length} slide(s)` : `the ${view.video.quality} video`;
        const dir = path.join(p.dir, 'exports', name);
        if (!showsViewer(server)) openFolder(dir);
        const where = showsViewer(server) ? 'in the chat' : "in its folder (this chat app can't show it inline)";
        return { content: [text(`Showing "${name}" (${what}) from "${p.data.title}" ${where}. Files: ${dir}`)], _meta: { [VIEW_KEY]: view } };
      } catch (e) {
        return fail(e);
      }
    },
  );

  // the viewer's own calls (the model never sees these)
  registerAppTool(server, 'viewer_job', { description: 'For the viewer: how a long export is going.', inputSchema: { job: z.string() }, _meta: appOnly }, async ({ job }) => {
    const j = getJob(job);
    if (!j) return answer({ state: 'gone' }, 'That job is no longer running.');
    const error = j.state === 'failed' ? String(j.error?.message ?? j.error) : null;
    const info = j.info ?? { kind: j.kind === 'video' ? 'video' : j.kind === 'images' ? 'images' : undefined };
    return answer({ state: j.state, progress: j.progress, message: j.message, info, view: j.result?._meta?.[VIEW_KEY] ?? null, error }, j.state);
  });

  registerAppTool(server, 'viewer_latest', { description: "For the viewer: a project's export to show.", inputSchema: { project: z.string(), name: z.string().optional() }, _meta: appOnly }, async (a) => {
    try {
      const p = existingProject(a.project);
      const name = a.name && p.data.exports[slug(a.name)] ? slug(a.name) : Object.entries(p.data.exports).sort(([, x], [, y]) => String(y.at).localeCompare(String(x.at)))[0]?.[0];
      const view = name && viewData(p, name);
      if (!view) throw new CaptureStop('Nothing exported in this project yet.');
      return answer({ view }, name);
    } catch (e) {
      return fail(e);
    }
  });

  // Copy (one file), Copy all (every slide) and Copy caption (the export's caption text)
  registerAppTool(
    server,
    'viewer_copy',
    { description: "For the viewer's Copy buttons.", inputSchema: { project: z.string(), files: z.array(z.string()).min(1).max(20).optional(), file: z.string().optional(), caption: z.string().optional().describe('An export name: copy its caption.') }, _meta: appOnly },
    async (a) => {
      try {
        if (a.caption) {
          const text = existingProject(a.project).data.exports[a.caption]?.caption;
          if (!text) throw new CaptureStop('There is no caption for this one. Ask Claude to write one.');
          await copyText(text);
          return answer({ copied: 'caption' }, 'Copied the caption.');
        }
        const list = a.files ?? (a.file ? [a.file] : []);
        if (!list.length) throw new CaptureStop('Nothing to copy.');
        const kind = await copyFiles(list.map((f) => projectFile(a.project, f)));
        return answer({ copied: kind, count: list.length }, `Copied ${list.length > 1 ? `${list.length} files` : `the ${kind}`}.`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  registerAppTool(server, 'viewer_folder', { description: "For the viewer's Show-in-folder button.", inputSchema: { project: z.string(), file: z.string() }, _meta: appOnly }, async (a) => {
    try {
      revealFile(projectFile(a.project, a.file));
      return answer({ opened: true }, 'Opened the folder.');
    } catch (e) {
      return fail(e);
    }
  });

  // only when the chat app can't fetch resources for the viewer: a file in pieces small enough for any tool answer
  registerAppTool(server, 'viewer_file', { description: 'For the viewer: part of a file.', inputSchema: { uri: z.string(), offset: z.number().int().min(0).optional() }, _meta: appOnly }, async ({ uri, offset = 0 }) => {
    try {
      const m = /^msfile:\/\/([^/]+)\/(.+)$/.exec(uri);
      if (!m) throw new CaptureStop('Not a project file.');
      const f = projectFile(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
      const size = fs.statSync(f).size;
      const piece = Buffer.alloc(Math.min(96 * 1024, Math.max(0, size - offset)));
      const fd = fs.openSync(f, 'r');
      try {
        fs.readSync(fd, piece, 0, piece.length, offset);
      } finally {
        fs.closeSync(fd);
      }
      return answer({ mime: MIME[path.extname(f).toLowerCase()], size, offset, data: piece.toString('base64') }, `${piece.length} bytes`);
    } catch (e) {
      return fail(e);
    }
  });
}
