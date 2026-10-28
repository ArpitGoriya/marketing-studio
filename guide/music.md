# Music for videos

## When

- **Only when the person asks for music.** If they put music or a voiceover in the Inbox, use that (inbox tool).
  Otherwise the video is silent.
- Agree the feel in the storyboard: "calm modern", "warm Indian", "modern with a little tabla", "upbeat". If they
  just say "add music", ask which feel, with those options.
- You write the music as a short score; the extension plays it with real instruments and mixes it under any
  voiceover. It's in the preview too, so the person hears it before the final.

## Background music sits back

It supports the video; nobody should notice it first. Smooth and simple beats clever:

- **3-4 parts at most.** A bed of held chords, a soft bass, light rhythm. A melody is optional; if there is one, it's
  a few notes, repeated.
- **Long, held chords**: one chord a bar (`D4+F#4+A4 - - -`), changing smoothly. Keys, pad, strings or harmonium.
- **Soft rhythm**: a kick on beats 1 and 3 (or only 1), soft hits (`x?`), a light shaker. No busy fills.
- **Low and middle notes only.** Melodies between D4 and A5, nothing higher; chords around D3-A4; bass D1-D3. High
  notes and bright instruments (bells, manjira, high santoor or harp runs) are what make music sound shrill: use them
  once at most (the reveal), or not at all.
- **`"tone": "warm"`** (the default) rounds off the highs for a soft, smooth sound. Use "clear" or "bright" only for a
  lively piece the person asked for.
- **Quiet**: `"volume": -3` to `-6` for pure background; under a voiceover it dips by itself.
- **One groove throughout**, a 1 s fade in, and at most one lift (the reveal); end with held chords ringing out on
  the end card.

## Tempo, beats and cuts

- Calm and premium 72-88 bpm, modern explainer 88-100, warm Indian 90-104, upbeat 110-124.
- A beat is 60/tempo seconds, a bar is 4 beats (check and export tell you both). Put scene cuts on bar lines and big
  moments on beat 1 of a bar; start parts on those times (`from`).

## Notes and chords (key D, the default; Sa = D)

- D major, open and modern: D E F# G A B C#. Chords: D (D F# A), G (G B D), A (A C# E), Bm (B D F#), Em (E G B).
  The classic modern loop: **D - A - Bm - G** (one chord a bar).
- D minor, warm and a little Indian: D E F G A Bb C (C# for the raised 7th). Chords: Dm (D F A), Bb (Bb D F),
  F (F A C), C (C E G), A (A C# E). Loops: **Dm - Bb - F - C**, **Dm - Bb - C - A**.
- Melodies: short motifs that repeat, mostly steps, ending on D or A. C4 is middle C.

## Palettes

Modern:
- **Calm modern (the safe default for app explainers):** keys chords + pad + soft bass + kick on 1 and 3 + a light
  shaker, tone warm.
- **Lo-fi warm:** keys chords with `swing: 0.15`, soft kick and clap, soft hats (`x? x? x? x?`), bass.
- **Upbeat modern:** kick every beat, clap on 2 and 4, hats in eighths, bass in eighths, a short pluck hook.

Indian:
- **Warm Indian:** tanpura + tabla (keherwa) + bass + a few santoor or sitar notes.
- **Calm and premium:** tanpura + strings chords + harp arpeggios in the middle register + a short flute line.
- **Festive:** dholak + ghungroo + harmonium chords + santoor.
- **Modern with an Indian touch:** the calm modern bed plus soft tabla (`na? . na? te?`) and one sitar phrase.

## Patterns (one token per step)

- Keys or pad chords, a bar each (steps 1): `D4+F#4+A4 - - - | A3+C#4+E4 - - - | B3+D4+F#4 - - - | G3+B3+D4 - - -`
- Soft kick (steps 1): `x . x? .`; clap on 2 and 4 (steps 1): `. x? . x?`; soft hats (steps 2): `x? x? x? x?`
- Tabla keherwa, 4 beats (steps 2): `dha ge na ti | na ke dhi na`; softer: `dha? . na? ti? | na? ke? dhi? na?`
- Dadra, 2 beats (steps 3): `dha dhi na | dha ti na`
- Dholak, 4 beats (steps 2): `ga . ta ta | ga ta . ta`

## Example: calm modern background (15 s)

```json
{ "tempo": 92, "key": "D", "tone": "warm", "volume": -3, "parts": [
  { "play": "keys", "from": 0, "to": 15, "steps": 1, "fade_in": 1,
    "pattern": "D4+F#4+A4 - - - | A3+C#4+E4 - - - | B3+D4+F#4 - - - | G3+B3+D4 - - -" },
  { "play": "pad", "from": 0, "to": 15, "steps": 1, "volume": -3,
    "pattern": "D3+A3 - - - | A2+E3 - - - | B2+F#3 - - - | G2+D3 - - -" },
  { "play": "bass", "from": 2.6, "to": 13, "steps": 1, "pattern": "D2 - - - | A1 - - - | B1 - - - | G1 - - -" },
  { "play": "kick", "from": 2.6, "to": 13, "steps": 1, "pattern": "x . x? ." },
  { "play": "shaker", "from": 5.2, "to": 13, "pattern": "x? x? x? x?", "volume": -4 }
]}
```

## Example: warm Indian (15 s)

```json
{ "tempo": 96, "key": "D", "tone": "warm", "parts": [
  { "play": "tanpura", "from": 0, "to": 15 },
  { "play": "tabla", "from": 2.5, "to": 12.5, "pattern": "dha? ge na? ti? | na? ke dhi na?" },
  { "play": "bass", "from": 2.5, "to": 12.5, "steps": 1, "pattern": "D2 - - - | Bb1 - - - | F2 - - - | C2 - - -" },
  { "play": "santoor", "from": 5, "to": 12.5, "pattern": "D5 . F5 A4 | G4 - F4 E4 | D4 - - - | . . . ." },
  { "play": "strings", "from": 12.5, "to": 15, "steps": 1, "pattern": "D3+A3+F4 - - -" }
]}
```

## The score, in short

- `pattern`: one token per step (`steps` per beat, default 2), repeated from `from` to `to`. `.` rest, `-` hold the
  last note, `D5` a note, `D3+A3+D4` a chord, `C5>D5` a slide (sitar, flute, bass), `dha!` loud, `na?` soft. `|`
  is only for reading.
- `at`: single hits at those seconds (`note` for a pitched one): a boom or a chord on the logo.
- `volume` (dB), `fade_in`/`fade_out` (s), `pan` (-1..1), `swing` (0.1-0.25 for a lilt), `repeat: false`.
- Held instruments (keys, pad, strings, harmonium, flute, bass) need `-` holds to sound long.
- The whole music: `volume` and `tone` on the score, or `music_volume_db` on the export.
- check reads the score and reports its timing, so mistakes show before the long render.
