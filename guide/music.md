# Music for videos

## When

- **Only when the person asks for music.** If they put music or a voiceover in the Inbox, use that (inbox tool).
  Otherwise the video is silent.
- You write the music as a short score; the extension plays it with real instruments and mixes it under any
  voiceover. It's in the preview too, so the person hears it before the final.

## Keep it simple

Short videos need one groove, not a song:

- a clear start on the first frame (no long intro),
- one lift at the key moment (the result, the reveal),
- a ring-out on the key note at the end card (drums stop a bar before the end; drone and chords ring).

Under a voiceover: drone + light percussion + soft bass, no busy melody while the voice speaks.

## Tempo, beats and cuts

- Calm and premium 72-88 bpm, warm explainer 90-104, upbeat 110-128.
- A beat is 60/tempo seconds, a bar is 4 beats (check and export tell you both). Put scene cuts on bar lines and big
  moments on beat 1 of a bar; start parts on those times (`from`).

## Notes and chords (key D, the default; Sa = D)

- D minor with a raised 7th, the warm Indian colour: D E F G A Bb C#. Chords: Dm (D F A), Bb (Bb D F), F (F A C),
  A (A C# E), Gm (G Bb D).
- D major, bright: D E F# G A B C#. Chords: D (D F# A), G (G B D), A (A C# E), Bm (B D F#).
- Melodies: short motifs that repeat, mostly steps, ending on D or A. C4 is middle C; santoor and sitar sit around
  D4-D6, bass around D1-D3.

## Palettes

- **Warm Indian:** tanpura + tabla + santoor or sitar phrases + bass.
- **Modern fusion:** kick on every beat + clap on beats 2 and 4 + shaker in sixteenths + tabla + bass + pad + a
  sitar or pluck hook.
- **Calm and premium:** tanpura + harp arpeggios + strings chords + a flute line, a bell on the reveal.
- **Festive:** dholak + ghungroo + manjira + harmonium chords + santoor.

## Tabla patterns (one stroke per step)

- Keherwa, 4 beats (steps 2): `dha ge na ti | na ke dhi na`
- Dadra, 2 beats (steps 3): `dha dhi na | dha ti na`
- Teentaal, 8 beats (steps 2): `dha dhin dhin dha | dha dhin dhin dha | dha tin tin ta | ta dhin dhin dha`
- A fill into a lift (steps 4, repeat false): `te re ke te dha! . . .`
- Dholak, 4 beats (steps 2): `ga . ta ta | ga ta . ta`

## The score

```json
{ "tempo": 100, "key": "D", "parts": [
  { "play": "tanpura", "from": 0, "to": 15 },
  { "play": "tabla", "from": 0, "to": 12, "pattern": "dha ge na ti | na ke dhi na" },
  { "play": "bass", "from": 0, "to": 12, "steps": 1, "pattern": "D2 - - - | Bb1 - - - | F2 - - - | A1 - - -" },
  { "play": "santoor", "from": 2.4, "to": 12, "pattern": "D5 . F5 A5 | G5 - F5 E5 | D5 - - - | . . . ." },
  { "play": "boom", "at": [12] },
  { "play": "bell", "at": [12] },
  { "play": "harp", "from": 12, "steps": 4, "repeat": false, "pattern": "D4 F4 A4 D5 F5 A5 D6" }
]}
```

- `pattern`: one token per step (`steps` per beat, default 2), repeated from `from` to `to`. `.` rest, `-` hold the
  last note, `D5` a note, `D3+A3+D4` a chord, `C5>D5` a slide (sitar, flute, bass), `dha!` loud, `na?` soft. `|`
  is only for reading.
- `at`: single hits at those seconds (`note` for a pitched one): booms, bells, a chord on the logo.
- `volume` (dB), `fade_in`/`fade_out` (s), `pan` (-1..1), `swing` (0.1-0.25 for a lilt), `repeat: false`.
- Held instruments (flute, strings, harmonium, pad, bass) need `-` holds to sound long: `D4+F4+A4 - - -`.
- The whole music: `volume` on the score, or `music_volume_db` on the export.
- check reads the score and reports its timing, so mistakes show before the long render.
