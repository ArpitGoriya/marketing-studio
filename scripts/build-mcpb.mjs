// Build the installable extension: dist/marketing-studio-<version>.mcpb (one file for Windows and Mac).
// Stages only what the extension needs, installs just the runtime packages there, validates the manifest and packs.
// Heavy parts (the capture browser) are not inside: the extension uses the laptop's Chrome or Edge, or downloads one.
// Also packs the guide as a Claude skill, dist/marketing-studio-skill.zip, for anyone who wants it outside the extension.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = path.join(ROOT, 'build', 'stage');
const DIST = path.join(ROOT, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
if (manifest.version !== pkg.version) throw new Error(`manifest.json version ${manifest.version} != package.json ${pkg.version}`);

// npm is a .cmd script on Windows and needs the shell; everything else runs directly (paths may contain spaces)
const run = (cmd, args, cwd = ROOT) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
};

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
for (const f of ['manifest.json', 'icon.png', 'package.json', 'package-lock.json', 'server', 'assets', 'sites', 'brands', 'guide', 'music']) {
  const src = path.join(ROOT, f);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(STAGE, f), { recursive: true });
}
run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'], STAGE);

const mcpb = path.join(ROOT, 'node_modules', '@anthropic-ai', 'mcpb', 'dist', 'cli', 'cli.js');
run(process.execPath, [mcpb, 'validate', path.join(STAGE, 'manifest.json')]);
fs.mkdirSync(DIST, { recursive: true });
const out = path.join(DIST, `marketing-studio-${pkg.version}.mcpb`);
run(process.execPath, [mcpb, 'pack', STAGE, out]);
console.log(`\nBuilt ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);

// the skill: a folder with SKILL.md at its top, zipped (Claude: Settings > Capabilities > Skills > Upload)
const guide = path.join(ROOT, 'guide');
const skill = Object.fromEntries(fs.readdirSync(guide).map((f) => [`marketing-studio/${f}`, fs.readFileSync(path.join(guide, f))]));
const skillOut = path.join(DIST, 'marketing-studio-skill.zip');
fs.writeFileSync(skillOut, zipSync(skill, { level: 9 }));
console.log(`Built ${path.relative(ROOT, skillOut)} (${Object.keys(skill).length} files)`);
