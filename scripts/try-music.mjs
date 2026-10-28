// Try the music engine on its own: plays a sample score (or a score JSON file) into build/try-music/score.wav and
// reports its loudness, then measures every instrument alone so their levels can be balanced by the numbers.
//   node scripts/try-music.mjs [score.json] [--levels]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeBrowser } from '../server/engine/browser.mjs';
import { planScore } from '../server/engine/music.mjs';
import { withStudio } from '../server/engine/studio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'build', 'try-music');
fs.mkdirSync(OUT, { recursive: true });
const file = process.argv.slice(2).find((a) => a.endsWith('.json'));

// a 20-second warm explainer bed: drone, a keherwa groove, a santoor phrase, a lift and a ring-out
const SAMPLE = {
  tempo: 96,
  key: 'D',
  parts: [
    { play: 'tanpura', from: 0, to: 20 },
    { play: 'tabla', from: 2.5, to: 17.5, pattern: 'dha ge na ti | na ke dhi na' },
    { play: 'dholak', from: 10, to: 17.5, pattern: 'ga . ta ta | ga ta . ta', volume: -4 },
    { play: 'shaker', from: 5, to: 17.5, steps: 4, pattern: 'x x? x x?', volume: -2 },
    { play: 'bass', from: 2.5, to: 17.5, steps: 1, pattern: 'D2 - - - | Bb1 - - - | F2 - - - | A1 - - -' },
    { play: 'santoor', from: 5, to: 17.5, pattern: 'D5 . F5 A5 | G5 - F5 E5 | D5 - - . | A4 . C5 D5' },
    { play: 'strings', from: 10, to: 18, steps: 1, pattern: 'D3+A3+F4 - - - | Bb2+F3+D4 - - - | F3+C4+A4 - - - | A2+E3+C#4 - - -', volume: -2 },
    { play: 'flute', from: 12.5, to: 17.5, steps: 1, pattern: 'A5 - C6>D6 - | . . . .' },
    { play: 'bell', at: [2.5, 17.5] },
    { play: 'boom', at: [17.5] },
    { play: 'harp', from: 17.5, to: 20, steps: 4, repeat: false, pattern: 'D4 F4 A4 D5 F5 A5 D6' },
  ],
};
const score = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : SAMPLE;
const duration = score.duration ?? 20;
const { plan, lines } = planScore(score, { duration });
console.log(lines.join('\n'));

// what each instrument sounds like alone, at its normal level, with a typical part
const PARTS = {
  tanpura: {},
  tabla: { pattern: 'dha dhin dhin dha | dha dhin dhin dha | dha tin tin ta | ta dhin dhin dha' },
  dholak: { pattern: 'ga . ta ta | ga ta . ta' },
  santoor: { pattern: 'D5 . F5 A5 | G5 - F5 E5' },
  sitar: { pattern: 'D5 - F5 . | E5>F5 - D5 .' },
  harp: { steps: 4, pattern: 'D4 F4 A4 D5' },
  flute: { steps: 1, pattern: 'A5 - - - | G5 - F5 -' },
  strings: { steps: 1, pattern: 'D3+A3+F4 - - -' },
  pizz: { pattern: 'D4 A4 F4 A4' },
  harmonium: { steps: 1, pattern: 'D4+F4+A4 - - -' },
  bass: { steps: 1, pattern: 'D2 - - - | Bb1 - - -' },
  pad: { steps: 1, pattern: 'D3+A3+F4 - - -' },
  pluck: { steps: 4, pattern: 'D5 A4 F5 A4' },
  kick: { steps: 1, pattern: 'x x x x' },
  hat: { pattern: 'x x x o' },
  boom: { at: [0.2, 4] },
  clap: { steps: 1, pattern: '. x . x' },
  shaker: { steps: 4, pattern: 'x x? x x?' },
  ghungroo: { steps: 1, pattern: 'x . x .' },
  manjira: { steps: 1, pattern: 'x . . .' },
  bell: { at: [0.2, 4] },
  daf: { pattern: 'x . x x | x . x .' },
};

await withStudio([], async (s) => {
  const r = await s.music(plan, path.join(OUT, 'score.wav'));
  console.log(`score: ${r.seconds} s, ${r.lufs} LUFS, peak ${r.peak} dB -> ${path.join(OUT, 'score.wav')}`);
  if (process.argv.includes('--levels')) {
    console.log('each alone, 8 s at its normal level:');
    for (const [play, p] of Object.entries(PARTS)) {
      const one = planScore({ tempo: 96, parts: [{ play, from: 0, to: 8, ...p }] }, { duration: 8 }).plan;
      const m = await s.music(one);
      console.log(`  ${play.padEnd(10)} ${String(m.lufs).padStart(6)} LUFS  peak ${m.peak}`);
    }
  }
});
await closeBrowser();
