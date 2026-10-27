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
export const INBOX = path.join(OUTPUT, 'Inbox');
export const DATA = process.env.MS_DATA_DIR || path.join(os.homedir(), '.marketing-studio');
export const D = {
  browsers: path.join(DATA, 'browsers'), // a downloaded browser, only if the laptop has no Chrome or Edge
  bin: path.join(DATA, 'bin'), // the video encoder
  sessions: path.join(DATA, 'sessions'), // sign-ins, one file per site
  tmp: path.join(DATA, 'tmp'),
};
// the browser driver reads this when it loads, so it is set before anything imports it
process.env.PLAYWRIGHT_BROWSERS_PATH = D.browsers;

export const ensureDirs = () => {
  for (const d of [OUTPUT, INBOX, DATA, ...Object.values(D)]) fs.mkdirSync(d, { recursive: true });
};

export const readJson = (p, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};
export const writeJson = (p, data) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
};

// what this tool knows about: site profiles (how to reach and sign in to a site) and brand packs (look and voice)
export const sites = () => listJson(path.join(ROOT, 'sites'));
export const brands = () => {
  const dir = path.join(ROOT, 'brands');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'brand.json')))
    .map((d) => ({ id: d.name, dir: path.join(dir, d.name), ...JSON.parse(fs.readFileSync(path.join(dir, d.name, 'brand.json'), 'utf8')) }));
};

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ id: f.replace(/\.json$/, ''), ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
}

// a short, safe name for files and references: "Rental price calculator!" -> "rental-price-calculator"
export const slug = (s, fallback = 'untitled') =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || fallback;
