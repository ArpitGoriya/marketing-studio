"""
Builds the music kit (music/kit/: small OGG files + kit.json) that videos' music is played with. The instruments
are a few real recordings, all CC0 (public domain): VSCO-2 Community Edition, the Versilian Community Sample Library
and provenance-checked Freesound sounds, as picked for the AR 2.0 launch film's score. Each is trimmed, tuned (tabla,
dholak and tanpura to D, as in the film), levelled to the same peak and, for held notes, given a smooth loop.
Synth parts (bass, pad, kick...) need no files: the studio page makes them.

    python scripts/music-kit/build_kit.py <ar2-launch-film>/music/samples-src
(any Python with numpy, scipy and soundfile; the videos studio's local/python/env has them)
"""
import json
import os
import sys

import numpy as np
import soundfile as sf
from scipy import signal

SR = 48000
SRC = sys.argv[1] if len(sys.argv) > 1 else None
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'music', 'kit')
if not SRC or not os.path.isdir(SRC):
    sys.exit(__doc__)
IDX = json.load(open(os.path.join(SRC, 'index.json'), encoding='utf-8'))
FREESOUND = {s['file'].replace('\\', '/'): s for s in json.load(open(os.path.join(SRC, 'freesound-manifest.json'), encoding='utf-8'))}


def load(rel, stereo=False):
    x, sr = sf.read(os.path.join(SRC, rel), dtype='float32', always_2d=True)
    x = x if stereo and x.shape[1] > 1 else x.mean(axis=1, keepdims=True)
    if stereo and x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    if sr != SR:
        x = signal.resample_poly(x, SR, sr, axis=0).astype(np.float32)
    return x


def shift(x, semis):
    """Play x higher by `semis` (and shorter), band-limited (the film's fft_rate)."""
    if abs(semis) < 1e-3:
        return x
    ratio = 2 ** (semis / 12)
    n = x.shape[0]
    pad = int(0.08 * n) + 256
    xp = np.concatenate([x, np.zeros((pad, x.shape[1]), np.float32)])
    y = signal.resample(xp, int(round(xp.shape[0] / ratio)), axis=0)
    return y[: int(round(n / ratio))].astype(np.float32)


def trim(x, length=None, skip=0.0, fade=0.3):
    """From the first sound (3 ms before it), at most `length` s, faded out at the end."""
    x = x[int(skip * SR):]
    env = np.abs(x).max(axis=1)
    start = max(0, int(np.argmax(env > env.max() * 0.02)) - int(0.003 * SR))
    x = x[start:]
    if length:
        x = x[: int(length * SR)]
    n = min(len(x), int(fade * SR))
    if n:
        x[-n:] *= np.linspace(1, 0, n)[:, None] ** 2
    return x


def loop(x, start, end, cross=0.25):
    """Bake a crossfade so playing start..end on repeat is seamless; returns (x, [start_s, end_s])."""
    a, b, c = int(start * SR), int(end * SR), int(cross * SR)
    c = min(c, a, b - a)
    t = np.linspace(0, np.pi / 2, c)[:, None]
    x = x.copy()
    x[b - c:b] = x[b - c:b] * np.cos(t) + x[a - c:a] * np.sin(t)
    return x[: b + int(0.05 * SR)], [round(start, 4), round(end, 4)]


def save(name, x):
    path = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    y = x / max(np.abs(x).max(), 1e-6) * 0.89
    # in blocks: libsndfile's Vorbis writer overflows the stack on long writes (Windows)
    with sf.SoundFile(path, 'w', SR, y.shape[1], format='OGG', subtype='VORBIS', compression_level=0.6) as f:
        for i in range(0, len(y), 8192):
            f.write(np.ascontiguousarray(y[i:i + 8192]))
    return name


def zone(group, midi, pred=None):
    zs = [z for z in IDX[group] if z.get('midi') is not None and (pred is None or pred(z))]
    return min(zs, key=lambda z: abs(z['midi'] - midi))


used = []


def src(rel):
    used.append(rel)
    return rel


kit = {'rate': SR, 'instruments': {}}
I = kit['instruments']


def pitched(name, group, midis, length, stereo=False, hold=None, pred=None, fade=0.3, semis=0.0):
    zs = []
    for m in midis:
        z = zone(group, m, pred)
        x = trim(load(src(z['file']), stereo), length, fade=fade)
        if semis:
            x = shift(x, semis)
        entry = {'midi': round(z['midi'] + semis, 3)}
        if hold:
            x, entry['loop'] = loop(x, *hold)
        entry['file'] = save(f'{name}/{round(z["midi"])}.ogg', x)
        zs.append(entry)
    I[name] = {'kind': 'pitched', 'zones': zs}


# melodic
pitched('harp', 'harp', [31, 38, 45, 52, 59, 65, 72, 79, 86, 93], 4.0, pred=lambda z: z['vel'] == 'mf', fade=0.8)
pitched('flute', 'flute_vib', [60, 64, 69, 72, 76, 81, 84, 88, 93], 3.4, hold=(1.0, 3.1), pred=lambda z: z['rr'] == 1)
pitched('harmonium', 'harmonium', [43, 48, 51, 56, 63, 67], 4.2, hold=(1.1, 3.9))
pitched('pizz', 'vln_pizz', [55, 62, 69, 76, 83], 1.4, pred=lambda z: z['rr'] == 1)
strings = []
for group, m in [('vc_sus', 36), ('vc_sus', 43), ('vc_sus', 50), ('vla_sus', 55), ('vla_sus', 62), ('vln_sus', 66), ('vln_sus', 72), ('vln_sus', 79), ('vln_sus', 86)]:
    z = zone(group, m, lambda z: z['rr'] == 1)
    x, lp = loop(trim(load(src(z['file']), stereo=True), 4.4), 1.3, 4.1, 0.35)
    strings.append({'midi': round(z['midi'], 3), 'loop': lp, 'file': save(f'strings/{round(z["midi"])}.ogg', x)})
I['strings'] = {'kind': 'pitched', 'zones': strings}
sit = [z for z in IDX['sitar_shot'] if 'sitar j' in z.get('title', '')][0]
x = trim(load(src(sit['file'])), 4.3, fade=0.5)
x = signal.sosfilt(signal.butter(2, 90, 'hp', fs=SR, output='sos'), x, axis=0).astype(np.float32)
I['sitar'] = {'kind': 'pitched', 'zones': [{'midi': round(sit['midi'], 3), 'file': save('sitar/48.ogg', x)}]}

# the drone: Kaczinski's tambura (Eb) a semitone down to D, 24 s with a smooth loop
tan = [z for z in IDX['tanpura_src'] if 'Tambura_Eb' in z.get('title', '')][0]
x = load(src(tan['file']), stereo=True)[int(8 * SR):int(36 * SR)]
x = shift(x, 38 - tan['midi'])
x, lp = loop(x[: int(24.5 * SR)], 2.0, 24.0, 2.0)
n = int(0.02 * SR)
x[:n] *= np.linspace(0, 1, n)[:, None]
I['tanpura'] = {'kind': 'drone', 'midi': 38, 'zones': [{'midi': 38, 'loop': lp, 'file': save('tanpura/d.ogg', x)}]}

# tabla: mmiron's bols with the dayan tuned to D4, CompMusic's 'dha', as in the film
T = {z['title'].replace('.wav', ''): z for z in IDX['tabla']}
DAYAN = 62.0 - 61.3
DHA = 62.0 - 59.34
bols = {}
for bol, key, length in [('na', 'na_sharp', 0.6), ('tin', 'tas_2', 1.0), ('tun', 'tun_2', 1.2), ('te', 'te', 0.2), ('re', 're', 0.22), ('naopen', 'na-open', 0.9)]:
    bols[bol] = [save(f'tabla/{bol}.ogg', trim(shift(load(src(T[key]['file'])), DAYAN), length, fade=0.04))]
bols['ke'] = [save(f'tabla/ke-{k}.ogg', trim(load(src(T[f'ke_{k}']['file'])), 0.2, fade=0.01)) for k in (2, 3)]
dhas = sorted([z for z in IDX['tabla'] if z['title'].startswith('Da_Test') and z['peak'] > 0.4], key=lambda z: z['title'])[:3]
bols['dha'] = [save(f'tabla/dha-{k + 1}.ogg', trim(shift(load(src(z['file'])), DHA), 0.6, fade=0.05)) for k, z in enumerate(dhas)]
I['tabla'] = {'kind': 'drum', 'tuned': 62, 'bols': bols}
dh = {z['title']: z for z in IDX['dholak']}
I['dholak'] = {'kind': 'drum', 'tuned': 62, 'bols': {
    'ga': [save('dholak/ga.ogg', trim(shift(load(src(dh['DHOLAK (BASS SKIN)']['file'])), -1.22), 0.7, fade=0.05))],
    'ta': [save('dholak/ta.ogg', trim(shift(load(src(dh['DHOLAK (TREBLE SKIN)']['file'])), -1.09), 0.4, fade=0.05))],
}}


def hits(name, files, length, fade=0.05):
    I[name] = {'kind': 'drum', 'bols': {'x': [save(f'{name}/{k + 1}.ogg', trim(load(src(f)), length, fade=fade)) for k, f in enumerate(files)]}}


hits('shaker', [z['file'] for z in IDX['shaker']], 0.6)
hits('clap', [z['file'] for z in IDX['claps'] if z['file'].endswith(('Clap_rr1.wav', 'Clap_rr2.wav', 'Clap_rr3.wav'))], 0.6)
gh = sorted([z for z in IDX['ghungroo'] if 0.12 < z['len'] < 0.9 and z['peak'] > 0.05], key=lambda z: -z['peak'])[:6]
hits('ghungroo', [z['file'] for z in gh], 0.4)
hits('bell', [z['file'] for z in IDX['hand_bells'][:2]], 2.0, fade=0.6)
hits('manjira', [IDX['finger_cym'][0]['file']], 3.0, fade=1.0)
hits('daf', [z['file'] for z in IDX['frame_drum'] if 'HDrumL_Hit_v3' in z['file']], 0.9, fade=0.2)
for z in [z for z in IDX['ghungroo'] if z['file'] in [g['file'] for g in gh]]:
    used.append(z['src'])

# where every sound came from (all CC0)
credits = []
for rel in sorted(set(used)):
    fs_ = FREESOUND.get(rel)
    if fs_:
        credits.append(f"- {rel}: Freesound #{fs_['id']} \"{fs_['title']}\" by {fs_['user']}, {fs_['license']} ({fs_['url']})")
    elif rel.startswith('VSCO-2-CE'):
        credits.append(f'- {rel}: VSCO-2 Community Edition (CC0), Versilian Studios')
    elif rel.startswith('VCSL'):
        credits.append(f'- {rel}: Versilian Community Sample Library (CC0), Versilian Studios')
    elif rel.startswith('slices/'):
        continue
    else:
        sys.exit(f'No licence record for {rel}: every sound in the kit must be CC0 with its source known.')
bad = [r for r in used if FREESOUND.get(r) and 'publicdomain/zero' not in FREESOUND[r]['license']]
if bad:
    sys.exit(f'Not CC0: {bad}')
json.dump(kit, open(os.path.join(OUT, 'kit.json'), 'w', encoding='utf-8'), indent=1)
with open(os.path.join(OUT, 'CREDITS.md'), 'w', encoding='utf-8', newline='\n') as f:
    f.write('# Music kit sources\n\nEvery sound is CC0 (public domain): free to use, change and share, no credit needed. '
            'Kept here for provenance. Built by scripts/music-kit/build_kit.py.\n\n' + '\n'.join(credits) + '\n')
size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs)
print(f'{sum(len(i.get("zones", [])) + sum(len(v) for v in i.get("bols", {}).values()) for i in I.values())} sounds, {size / 1e6:.2f} MB in {os.path.abspath(OUT)}')
