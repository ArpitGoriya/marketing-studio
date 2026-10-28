// Copy the official Anokhi Reet shop, vendor and tools logos from the website (the monorepo's apps/web/public) into the
// brand pack, unchanged, and point brand.json at them. Run again whenever the website's logos change.
//   node scripts/sync-logos.mjs "<path to the anokhireet monorepo>"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'brands', 'anokhireet');
const PUBLIC = path.join(process.argv[2] ?? '', 'apps', 'web', 'public');
if (!process.argv[2] || !fs.existsSync(PUBLIC)) {
  console.error('Usage: node scripts/sync-logos.mjs "<path to the anokhireet monorepo>" (it needs apps/web/public)');
  process.exit(1);
}

// brand:<name> -> the website's file, the ground it is drawn for, and when to use it
const LOGOS = {
  'lockup-maroon': ['Shops-Logo/AnokhiReet_logo_maroon.svg', 'light', 'seal + ANOKHI REET wordmark in maroon, for cream/light grounds'],
  'lockup-shops': ['Shops-Logo/Anokhireet_shop_logo.svg', 'dark', 'Anokhi Reet SHOPS lockup (beige wordmark, gold SHOPS) for maroon grounds'],
  'lockup-shops-dark': ['Shops-Logo/Anokhireet_shop_logo_dark.svg', 'light', 'Anokhi Reet SHOPS lockup in maroon, for cream/light grounds'],
  'lockup-vendors': ['Vendors-Logo/AnokhiReet_vendors_Trasparent_logo.svg', 'dark', 'Anokhi Reet VENDORS lockup (beige wordmark, gold VENDORS) for maroon grounds'],
  'lockup-vendors-dark': ['Vendors-Logo/AnokhiReet_vendors_Trasparent_logo_dark.svg', 'light', 'Anokhi Reet VENDORS lockup in maroon, for cream/light grounds'],
  'vendors-tile': ['Vendors-Logo/AnokhiReet_vendors_logo.svg', 'light', 'square maroon tile with the gold VENDORS lockup, for any ground (end cards, profile pictures)'],
  'lockup-tools': ['Tools-Logo/Tools_logo_golden.svg', 'dark', 'Anokhi Reet TOOLS lockup (beige wordmark, gold TOOLS with the seal ring as the O) for maroon grounds; the free tools'],
  'lockup-tools-dark': ['Tools-Logo/Tools_logo_maroon.svg', 'light', 'Anokhi Reet TOOLS lockup in maroon, for cream/light grounds; the free tools'],
  'tools-tile': ['Tools-Logo/Tools_logo_with_BG.svg', 'light', 'square maroon tile with the gold TOOLS lockup, for any ground'],
};

const brandFile = path.join(PACK, 'brand.json');
const brand = JSON.parse(fs.readFileSync(brandFile, 'utf8'));
const logos = {};
for (const [name, l] of Object.entries(brand.logos)) if (!LOGOS[name]) logos[name] = l;
let changed = 0;
for (const [name, [rel, ground, use]] of Object.entries(LOGOS)) {
  const from = path.join(PUBLIC, rel);
  if (!fs.existsSync(from)) throw new Error(`The website has no ${rel} any more: check apps/web/public and update this list.`);
  const file = `logos/${path.basename(rel)}`;
  const to = path.join(PACK, file);
  const old = brand.logos[name] && path.join(PACK, brand.logos[name].file);
  const same = fs.existsSync(to) && fs.readFileSync(to).equals(fs.readFileSync(from));
  if (!same) fs.copyFileSync(from, to), changed++;
  // the pack's own earlier drawing of it goes when the official file replaces it
  if (old && path.resolve(old) !== path.resolve(to) && fs.existsSync(old)) fs.rmSync(old), changed++;
  logos[name] = { file, ground, use, source: `website apps/web/public/${rel}` };
  console.log(`${same ? '  same   ' : '  updated'} brand:${name} <- ${rel}`);
}
// keep the order people read in the brand tool: the main marks first, then the families, then badges
const order = ['wordmark', 'seal', 'seal-on-maroon', 'app-icon', ...Object.keys(LOGOS)];
brand.logos = Object.fromEntries([...order.filter((k) => logos[k]).map((k) => [k, logos[k]]), ...Object.entries(logos).filter(([k]) => !order.includes(k))]);
fs.writeFileSync(brandFile, `${JSON.stringify(brand, null, 2)}\n`);
console.log(changed ? `Done: ${changed} file change(s). Check the brand tool's picture, then build.` : 'Already up to date.');
