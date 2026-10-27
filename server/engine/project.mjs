// A project is one piece of work (a carousel, a video) and its folder in Documents/Marketing Studio/<project>/:
//   captures/<name>.png (+ .preview.jpg)   screenshots
//   clips/<name>/NNNN.jpg + <name>.mp4      screen recordings
//   exports/<name>/                         Claude's designs (its HTML) and the finished PNG/MP4 files
//   project.json                            what's in it, so a later chat can pick up where this one stopped
import fs from 'node:fs';
import path from 'node:path';
import { OUTPUT, readJson, slug, writeJson } from '../paths.mjs';

export function openProject(title) {
  const id = slug(title || 'untitled');
  const dir = path.join(OUTPUT, id);
  const jsonPath = path.join(dir, 'project.json');
  const data = readJson(jsonPath, null) ?? { title: title || 'Untitled', created: new Date().toISOString(), captures: {}, clips: {}, exports: {} };
  for (const k of ['captures', 'clips', 'exports']) fs.mkdirSync(path.join(dir, k), { recursive: true });
  return {
    id,
    dir,
    data,
    save() {
      data.updated = new Date().toISOString();
      writeJson(jsonPath, data);
    },
    file: (...p) => path.join(dir, ...p),
  };
}

export function listProjects() {
  if (!fs.existsSync(OUTPUT)) return [];
  return fs
    .readdirSync(OUTPUT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(OUTPUT, d.name, 'project.json')))
    .map((d) => ({ id: d.name, dir: path.join(OUTPUT, d.name), ...readJson(path.join(OUTPUT, d.name, 'project.json'), {}) }))
    .sort((a, b) => String(b.updated ?? b.created).localeCompare(String(a.updated ?? a.created)));
}

// a name that isn't taken yet in this project: "calculator", "calculator-2", …
export function freeName(p, kind, wanted, fallback) {
  const base = slug(wanted || fallback, 'shot');
  let n = base;
  for (let i = 2; p.data[kind][n] && !wanted; i++) n = `${base}-${i}`;
  return n;
}
