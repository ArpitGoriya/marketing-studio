// Where things live on this laptop.
//   output: the person's work, one folder per project (default Documents/Marketing Studio)
//   data:   the tool's own downloads and sessions (browser, video encoder, logins); never synced, never shared
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

// MS_OUTPUT_DIR comes from the extension's settings ("Where to save your work"); unset or unfilled = Documents
const chosen = process.env.MS_OUTPUT_DIR && !process.env.MS_OUTPUT_DIR.includes('${') ? process.env.MS_OUTPUT_DIR : path.join(os.homedir(), 'Documents');
export const OUTPUT = path.basename(chosen) === 'Marketing Studio' ? chosen : path.join(chosen, 'Marketing Studio');
export const DATA = process.env.MS_DATA_DIR || path.join(os.homedir(), '.marketing-studio');

export const ensureDirs = () => {
  for (const d of [OUTPUT, path.join(OUTPUT, 'Inbox'), DATA]) fs.mkdirSync(d, { recursive: true });
};

// what this tool knows about: site profiles (how to reach and sign in to a site) and brand packs (look and voice)
export const sites = () => listJson(path.join(ROOT, 'sites'));
export const brands = () => {
  const dir = path.join(ROOT, 'brands');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'brand.json')))
    .map((d) => ({ id: d.name, ...JSON.parse(fs.readFileSync(path.join(dir, d.name, 'brand.json'), 'utf8')) }));
};

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ id: f.replace(/\.json$/, ''), ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
}
