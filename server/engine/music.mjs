// Music for videos, written by Claude as a short score and played with the music kit (music/kit: real recordings of
// tanpura, tabla, dholak, santoor, sitar, harp, flute, strings, harmonium, bells...) plus a few synth parts (bass, pad,
// pluck, kick, hat, boom). Claude composes; this only reads the score into timed notes (with plain errors before any
// rendering starts) and the studio page plays them (engine/music-page.js).
//
// A score: { tempo: 96, key: "D", parts: [ { play: "tanpura", from: 0, to: 30 },
//   { play: "tabla", from: 2.5, pattern: "dha dhin dhin dha | dha dhin dhin dha | dha tin tin ta | ta dhin dhin dha" },
//   { play: "santoor", from: 5, steps: 2, pattern: "D5 - F5 A5 | G5 - F5 E5 | D5 - - - | . . . ." },
//   { play: "boom", at: [5, 20] } ] }
// pattern: one token per step (steps per beat, default 2), repeated from `from` to `to`; "|" is only for reading.
//   .  rest     -  hold the last note     D5 F#4 Bb3  a note     D3+A3+D4  a chord     C5>D5  slide up into D5
//   drums: their strokes (tabla dha, dhin, na, tin...), x for one hit     !  loud     ?  soft (e.g. "dha!", "na?")
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ROOT } from '../paths.mjs';
import { CaptureStop } from './site.mjs';

export const KIT = path.join(ROOT, 'music', 'kit');
let kitData;
const kit = () => (kitData ??= JSON.parse(fs.readFileSync(path.join(KIT, 'kit.json'), 'utf8')));

// what each instrument is and how it sits in the mix: level (dB, balanced with scripts/try-music.mjs --levels so a
// typical part alone is about: melody -16 LUFS, drums -17, bass -19, chords -20, drone -23, light percussion -24),
// reverb send, and for some their range
const VOICES = {
  tanpura: { kind: 'drone', gain: -11, send: 0.15, about: 'the drone, on the key note (plays from `from` to `to`)' },
  tabla: { kind: 'drum', gain: -4.5, send: 0.08, bols: ['dha', 'dhin', 'dhi', 'na', 'ta', 'tin', 'tun', 'te', 'ti', 're', 'ke', 'ka', 'kat', 'ge', 'ghe'], about: 'tabla strokes, tuned to the key' },
  dholak: { kind: 'drum', gain: -2, send: 0.08, bols: ['ga', 'ta', 'dha', 'x'], about: 'dholak: ga (bass), ta (treble), dha (both)' },
  santoor: { kind: 'pitched', samples: 'harp', gain: -3.5, send: 0.3, about: 'bright hammered strings, for melodies and arpeggios' },
  sitar: { kind: 'pitched', gain: -9.5, send: 0.25, range: [50, 84], about: 'sitar notes; C5>D5 slides (meend)' },
  harp: { kind: 'pitched', gain: -10.5, send: 0.3, about: 'soft plucked strings, arpeggios' },
  flute: { kind: 'pitched', gain: -9.5, send: 0.3, held: true, about: 'held flute notes (hold with -), slides' },
  strings: { kind: 'pitched', gain: -14, send: 0.35, held: true, about: 'string section, held chords (D3+A3+D4 - - -)' },
  pizz: { kind: 'pitched', gain: -5, send: 0.2, about: 'plucked strings, short and light' },
  harmonium: { kind: 'pitched', gain: -16, send: 0.2, held: true, about: 'held harmonium notes and chords' },
  bass: { kind: 'pitched', synth: true, gain: -15, send: 0, range: [26, 62], held: true, about: 'a soft round bass (synth)' },
  pad: { kind: 'pitched', synth: true, gain: -16, send: 0.3, range: [36, 88], held: true, about: 'a warm held pad (synth), chords' },
  pluck: { kind: 'pitched', synth: true, gain: -2.5, send: 0.25, range: [45, 96], about: 'a short modern pluck (synth)' },
  kick: { kind: 'drum', synth: true, gain: -4, send: 0, bols: ['x'], about: 'a soft modern kick (synth)' },
  hat: { kind: 'drum', synth: true, gain: -12.5, send: 0.05, bols: ['x', 'o'], about: 'hi-hat (synth): x closed, o open' },
  boom: { kind: 'drum', synth: true, gain: -6.5, send: 0.2, bols: ['x'], about: 'a deep low hit for a big moment (logo, reveal)' },
  clap: { kind: 'drum', gain: -2.5, send: 0.15, bols: ['x'], about: 'hand claps' },
  shaker: { kind: 'drum', gain: -11.5, send: 0.08, bols: ['x'], about: 'shaker' },
  ghungroo: { kind: 'drum', gain: -10, send: 0.15, bols: ['x'], about: 'ankle bells' },
  manjira: { kind: 'drum', gain: -1.5, send: 0.3, bols: ['x'], about: 'small cymbals that ring' },
  bell: { kind: 'drum', gain: -7, send: 0.35, bols: ['x'], about: 'temple-style hand bell' },
  daf: { kind: 'drum', gain: -1, send: 0.1, bols: ['x'], about: 'frame drum' },
};

const NOTE = /^([A-Ga-g])(#|b)?(-?\d)$/;
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midiOf = (s) => {
  const m = NOTE.exec(s);
  return m ? 12 * (Number(m[3]) + 1) + PC[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) : null;
};
const nameOf = (m) => `${['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][m % 12]}${Math.floor(m / 12) - 1}`;

function rangeOf(name, v) {
  if (v.range) return v.range;
  const zones = kit().instruments[v.samples ?? name]?.zones ?? [];
  return [Math.round(Math.min(...zones.map((z) => z.midi))) - 5, Math.round(Math.max(...zones.map((z) => z.midi))) + 5];
}

export const instrumentList = () =>
  Object.entries(VOICES)
    .map(([k, v]) => `${k} (${v.about}${v.kind === 'pitched' ? `, ${nameOf(rangeOf(k, v)[0])}-${nameOf(rangeOf(k, v)[1])}` : ''}${v.kind === 'drum' && v.bols.length > 1 ? `: ${v.bols.join(' ')}` : ''})`)
    .join('; ');

const part = z.object({
  play: z.string().describe('An instrument (see the export description).'),
  from: z.number().min(0).optional().describe('Seconds into the video where it starts (default 0).'),
  to: z.number().optional().describe('Seconds where it stops (default: the end).'),
  pattern: z.string().optional().describe('One token per step, repeated from `from` to `to`.'),
  steps: z.number().int().min(1).max(8).optional().describe('Steps per beat (default 2: eighth notes; 4 for sixteenths, 1 for whole beats).'),
  repeat: z.boolean().optional().describe('false: play the pattern once.'),
  at: z.array(z.number()).optional().describe('Instead of a pattern: hits at these seconds (with `note` for a pitched instrument).'),
  note: z.string().optional().describe('With `at`: the note, chord or stroke to play.'),
  volume: z.number().min(-30).max(12).optional().describe('dB louder (+) or quieter (-) than normal.'),
  pan: z.number().min(-1).max(1).optional(),
  fade_in: z.number().min(0).optional().describe('seconds'),
  fade_out: z.number().min(0).optional().describe('seconds'),
  swing: z.number().min(0).max(0.5).optional().describe('Delay every second step by this share of a step (0.1-0.25 for a lilt).'),
});
export const scoreShape = z.object({
  tempo: z.number().min(50).max(200).describe('Beats per minute.'),
  key: z.string().optional().describe('The key note (Sa) for the tanpura and the tuned drums, e.g. "D" (default), "C#", "Eb".'),
  volume: z.number().min(-20).max(6).optional().describe('The whole music louder or quieter, in dB.'),
  parts: z.array(part).min(1).max(16),
});

const stop = (msg) => {
  throw new CaptureStop(`Music: ${msg}`);
};

// the score -> { plan for the studio page, lines for Claude }
export function planScore(score, { duration }) {
  const tempo = score.tempo;
  const beat = 60 / tempo;
  const keyM = /^([A-Ga-g])(#|b)?$/.exec(String(score.key ?? 'D').trim().split(/\s+/)[0]);
  if (!keyM) stop(`"${score.key}" isn't a key note. Use one like "D", "C#" or "Eb".`);
  const pc = (PC[keyM[1].toUpperCase()] + (keyM[2] === '#' ? 1 : keyM[2] === 'b' ? -1 : 0) + 12) % 12;
  const tune = ((pc - 2 + 18) % 12) - 6; // semitones from D, the kit's tuning (-6..+5)
  const parts = [];
  const events = [];
  const warnings = [];
  const said = [];
  for (const [pi, p] of score.parts.entries()) {
    const v = VOICES[p.play];
    if (!v) stop(`there's no "${p.play}". Instruments: ${Object.keys(VOICES).join(', ')}.`);
    const from = p.from ?? 0;
    const to = Math.min(p.to ?? duration, duration);
    if (from >= duration) {
      warnings.push(`${p.play} starts at ${from} s, after the video ends (${duration} s), so it's left out.`);
      continue;
    }
    if (to <= from) stop(`${p.play} stops (${to} s) before it starts (${from} s).`);
    parts.push({ play: p.play, kind: v.kind, synth: !!v.synth, samples: v.samples ?? p.play, gain: v.gain + (p.volume ?? 0), send: v.send, pan: p.pan ?? 0, from, to, fadeIn: p.fade_in ?? (v.kind === 'drone' ? 1.5 : 0), fadeOut: p.fade_out ?? 0 });
    const idx = parts.length - 1;
    const range = v.kind === 'pitched' ? rangeOf(p.play, v) : null;
    const out = [];
    const read = (tok, where) => {
      const vel = tok.endsWith('!') ? 1 : tok.endsWith('?') ? 0.5 : 0.8;
      const t = tok.replace(/[!?]$/, '');
      if (v.kind === 'drum') {
        const b = t.toLowerCase();
        if (!v.bols.includes(b)) stop(`${p.play} doesn't know "${t}"${where}. It plays: ${v.bols.join(', ')} (and . for a rest).`);
        return [{ b, v: vel }];
      }
      return t.split('+').map((n) => {
        const [a, b] = n.split('>');
        const m = midiOf(b ?? a);
        const g = b ? midiOf(a) : null;
        if (m == null || (b && g == null)) stop(`"${n}"${where} isn't a note for ${p.play}. Write notes like D5, F#4 or Bb3 (C4 is middle C), chords like D3+A3+D4, slides like C5>D5.`);
        if (m < range[0] - 12 || m > range[1] + 12) stop(`${nameOf(m)} is far outside ${p.play}'s range (${nameOf(range[0])}-${nameOf(range[1])}).`);
        if ((m < range[0] || m > range[1]) && !warnings.some((w) => w.startsWith(`${p.play}:`))) warnings.push(`${p.play}: ${nameOf(m)} is outside its natural range (${nameOf(range[0])}-${nameOf(range[1])}); it will sound stretched.`);
        return { m, g, v: vel };
      });
    };
    if (v.kind === 'drone') {
      if (p.pattern || p.at) stop('the tanpura is a drone: give it `from` and `to`, no pattern.');
      out.push({ p: idx, t: from, d: to - from, m: 38 + tune, v: 0.8 });
    } else if (p.at?.length) {
      const tok = p.note ?? (v.kind === 'drum' ? v.bols[0] : null);
      if (!tok) stop(`${p.play} with \`at\` needs \`note\` (e.g. "D5" or "D3+A3").`);
      for (const t of p.at) {
        if (t < 0 || t >= duration) continue;
        for (const e of read(String(tok), ` (at ${t} s)`)) out.push({ p: idx, t, d: beat, ...e });
      }
    } else if (p.pattern?.trim()) {
      const tokens = p.pattern.replace(/\|/g, ' ').trim().split(/\s+/);
      const step = beat / (p.steps ?? 2);
      const cycle = tokens.length * step;
      let last = [];
      for (let start = from; start < to - 1e-6; start += cycle) {
        for (const [k, tok] of tokens.entries()) {
          const t = start + k * step + (k % 2 ? (p.swing ?? 0) * step : 0);
          if (t >= to - 1e-6) break;
          if (tok === '.' || tok === '_') {
            last = [];
            continue;
          }
          if (tok === '-') {
            for (const e of last) e.d += step;
            continue;
          }
          last = read(tok, ` (step ${k + 1} of the pattern)`).map((e) => ({ p: idx, t: +t.toFixed(4), d: step, ...e }));
          out.push(...last);
        }
        if (p.repeat === false) break;
      }
    } else stop(`${p.play} needs a \`pattern\` (or \`at\` for single hits).`);
    events.push(...out);
    const count = (n) => `${n} ${v.kind === 'drum' ? 'hit' : 'note'}${n === 1 ? '' : 's'}`;
    if (p.at?.length) said.push(`${p.play} at ${[...new Set(out.map((e) => e.t))].join(', ')} s`);
    else said.push(`${p.play} ${+from.toFixed(2)}-${+to.toFixed(2)} s${v.kind === 'drone' ? '' : `, ${count(out.length)}`}`);
  }
  if (!events.length) stop('nothing to play inside the video.');
  // the kit files the page needs
  const ins = kit().instruments;
  const files = new Set();
  for (const pt of parts) {
    if (pt.synth) continue;
    const k = ins[pt.samples];
    for (const z of k?.zones ?? []) files.add(z.file);
    for (const list of Object.values(k?.bols ?? {})) for (const f of list) files.add(f);
  }
  const lines = [
    `Music: ${tempo} bpm in ${score.key ?? 'D'} (a beat every ${beat.toFixed(3)} s, a 4-beat bar every ${(beat * 4).toFixed(2)} s), ${duration} s.`,
    `Parts: ${said.join('; ')}.`,
    ...warnings,
  ];
  return { plan: { tempo, beat, length: duration, tune, volume: score.volume ?? 0, parts, events, kit: { instruments: ins, files: [...files] } }, lines };
}
