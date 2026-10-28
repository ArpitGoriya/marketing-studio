// Runs inside the studio page: plays a music plan (engine/music.mjs) into stereo audio, offline and exact. Sampled
// instruments are the kit's recordings, tuned by playback speed to each note (held notes loop smoothly); bass, pad,
// pluck, kick, hat, boom and the tabla's bayan stroke (ge) are made here. A little reverb and gentle compression
// glue it together; the studio's mix then levels it and dips it under a voiceover.
(() => {
  const SR = 48000;
  const dbToGain = (db) => 10 ** (db / 20);

  // the room: a soft stereo tail, about 2 s
  function impulse(ctx) {
    const n = Math.round(2.2 * SR);
    const ir = ctx.createBuffer(2, n, SR);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        lp += 0.35 * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.exp(-i / (0.5 * SR)) * (i < 0.012 * SR ? i / (0.012 * SR) : 1);
      }
    }
    return ir;
  }
  function noise(ctx, seconds) {
    const b = ctx.createBuffer(1, Math.round(seconds * SR), SR);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  async function render(plan, urls) {
    const ctx = new OfflineAudioContext(2, Math.ceil(plan.length * SR), SR);
    const buffers = {};
    await Promise.all(
      plan.kit.files.map(async (f) => {
        buffers[f] = await ctx.decodeAudioData(await (await fetch(urls[f])).arrayBuffer());
      }),
    );
    const master = ctx.createGain();
    master.gain.value = dbToGain(plan.volume);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 8;
    comp.ratio.value = 2.5;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    // the tone: warm rounds off the highs (soft background, nothing shrill), clear a little less, bright not at all
    const cut = { warm: 4200, clear: 8000 }[plan.tone ?? 'warm'];
    if (cut) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cut;
      lp.Q.value = 0.5;
      master.connect(lp).connect(comp).connect(ctx.destination);
    } else master.connect(comp).connect(ctx.destination);
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx);
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.6;
    verb.connect(verbOut).connect(master);
    const white = noise(ctx, 2);

    // one bus per part: its level, fades and pan, and a share into the room
    const buses = plan.parts.map((p) => {
      const g = ctx.createGain();
      const lvl = dbToGain(p.gain);
      if (p.fadeIn > 0) {
        g.gain.setValueAtTime(0, p.from);
        g.gain.linearRampToValueAtTime(lvl, p.from + p.fadeIn);
      } else g.gain.setValueAtTime(lvl, 0);
      if (p.fadeOut > 0) {
        g.gain.setValueAtTime(lvl, Math.max(p.from, p.to - p.fadeOut));
        g.gain.linearRampToValueAtTime(0, p.to);
      }
      const pan = ctx.createStereoPanner();
      pan.pan.value = p.pan;
      g.connect(pan).connect(master);
      if (p.send > 0) {
        const s = ctx.createGain();
        s.gain.value = p.send;
        pan.connect(s).connect(verb);
      }
      return g;
    });

    const zoneFor = (name, m) => plan.kit.instruments[name].zones.reduce((a, z) => (Math.abs(z.midi - m) < Math.abs(a.midi - m) ? z : a));
    const rr = {};
    const next = (list, key) => list[(rr[key] = ((rr[key] ?? -1) + 1) % list.length)];
    const env = (t, v, d, { attack = 0.004, release = 0.12, held = true } = {}) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + attack);
      if (held) {
        g.gain.setValueAtTime(v, t + Math.max(attack, d));
        g.gain.setTargetAtTime(0, t + Math.max(attack, d), release / 3);
      }
      return g;
    };
    const HELD = { flute: [0.06, 0.18], strings: [0.25, 0.6], harmonium: [0.03, 0.15] };

    function sample(name, file, t, rate, v, out, { d, loop, held, glideFrom, maxLen } = {}) {
      const buf = buffers[file];
      const src = ctx.createBufferSource();
      src.buffer = buf;
      if (glideFrom) {
        src.playbackRate.setValueAtTime(glideFrom, t);
        src.playbackRate.setTargetAtTime(rate, t + 0.01, Math.min(0.05, (d ?? 0.3) / 6));
      } else src.playbackRate.value = rate;
      let g;
      if (held) {
        const [a, r] = HELD[name] ?? [0.02, 0.15];
        if (loop && d > loop[0] / rate) {
          src.loop = true;
          src.loopStart = loop[0];
          src.loopEnd = loop[1];
        }
        g = env(t, v, d, { attack: a, release: r });
        src.start(t);
        src.stop(t + d + r * 2.5);
      } else {
        g = ctx.createGain();
        g.gain.value = v;
        const len = Math.min(buf.duration / rate, maxLen ?? Infinity);
        if (maxLen && len < buf.duration / rate) {
          g.gain.setValueAtTime(v, t + len - 0.25);
          g.gain.linearRampToValueAtTime(0, t + len);
        }
        src.start(t);
        src.stop(t + len);
      }
      src.connect(g).connect(out);
    }

    function osc(type, t, f, out) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      o.connect(out);
      return o;
    }
    const hz = (m) => 440 * 2 ** ((m - 69) / 12);

    function synth(p, e, out) {
      const t = e.t;
      if (p.play === 'bass') {
        const g = env(t, e.v * 0.9, e.d, { attack: 0.008, release: 0.12 });
        const lp = ctx.createBiquadFilter();
        lp.frequency.value = 900;
        lp.connect(g).connect(out);
        for (const [type, k] of [['sine', 1], ['triangle', 0.25]]) {
          const gg = ctx.createGain();
          gg.gain.value = k;
          const o = osc(type, t, hz(e.g ?? e.m), gg);
          if (e.g) o.frequency.setTargetAtTime(hz(e.m), t + 0.01, 0.04);
          gg.connect(lp);
          o.start(t);
          o.stop(t + e.d + 0.5);
        }
      } else if (p.play === 'pad') {
        const g = env(t, e.v * 0.35, e.d, { attack: 0.6, release: 1.2 });
        const lp = ctx.createBiquadFilter();
        lp.frequency.value = 1500;
        lp.Q.value = 0.7;
        lp.connect(g).connect(out);
        for (const cents of [-8, 0, 8]) {
          const o = osc('sawtooth', t, hz(e.m), lp);
          o.detune.value = cents;
          o.start(t);
          o.stop(t + e.d + 4);
        }
      } else if (p.play === 'pluck') {
        const g = ctx.createGain();
        g.gain.setValueAtTime(e.v * 0.5, t);
        g.gain.setTargetAtTime(0, t + 0.005, 0.12);
        const lp = ctx.createBiquadFilter();
        lp.frequency.setValueAtTime(4200, t);
        lp.frequency.setTargetAtTime(600, t, 0.08);
        lp.connect(g).connect(out);
        const o = osc('sawtooth', t, hz(e.m), lp);
        o.start(t);
        o.stop(t + 0.9);
      } else if (p.play === 'keys') {
        // a soft electric piano: a sine carrier with a gentle FM bell on the attack that fades, plus a quiet octave
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(e.v * 0.55, t + 0.006);
        g.gain.setTargetAtTime(e.v * 0.2, t + 0.01, 0.8); // dies away while held, like a real piano
        g.gain.setTargetAtTime(0, t + e.d, 0.12);
        g.connect(out);
        const f = hz(e.m);
        const car = osc('sine', t, f, g);
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(f * 1.4, t);
        depth.gain.setTargetAtTime(f * 0.15, t, 0.25);
        depth.connect(car.frequency);
        const mod = osc('sine', t, f, depth);
        const oct = ctx.createGain();
        oct.gain.value = 0.12;
        oct.connect(g);
        const o2 = osc('sine', t, f * 2, oct);
        for (const o of [car, mod, o2]) {
          o.start(t);
          o.stop(t + e.d + 1.5);
        }
      } else if (p.play === 'kick') {
        const g = ctx.createGain();
        g.gain.setValueAtTime(e.v * 1.1, t);
        g.gain.setTargetAtTime(0, t + 0.01, 0.11);
        g.connect(out);
        const o = osc('sine', t, 165, g);
        o.frequency.exponentialRampToValueAtTime(50, t + 0.1);
        o.start(t);
        o.stop(t + 0.7);
      } else if (p.play === 'boom') {
        const g = ctx.createGain();
        g.gain.setValueAtTime(e.v * 1.1, t);
        g.gain.setTargetAtTime(0, t + 0.02, 0.55);
        g.connect(out);
        const o = osc('sine', t, 62, g);
        o.frequency.exponentialRampToValueAtTime(38, t + 1.6);
        o.start(t);
        o.stop(t + 3);
        const n = ctx.createBufferSource();
        n.buffer = white;
        const lp = ctx.createBiquadFilter();
        lp.frequency.value = 220;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(e.v * 0.6, t);
        ng.gain.setTargetAtTime(0, t, 0.06);
        n.connect(lp).connect(ng).connect(out);
        n.start(t);
        n.stop(t + 0.5);
      } else if (p.play === 'hat') {
        const n = ctx.createBufferSource();
        n.buffer = white;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 7000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(e.v, t);
        g.gain.setTargetAtTime(0, t + 0.002, e.b === 'o' ? 0.09 : 0.015);
        n.connect(hp).connect(g).connect(out);
        n.start(t);
        n.stop(t + (e.b === 'o' ? 0.6 : 0.15));
      }
    }

    // the tabla's bayan, open with the wrist glide up (as in the launch film)
    function ge(t, v, out) {
      const f0 = 98 * 2 ** (plan.tune / 12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v * 0.75, t + 0.002);
      g.gain.setTargetAtTime(0, t + 0.002, 0.2);
      g.connect(out);
      const o = osc('sine', t, f0 * 1.25, g);
      o.frequency.setTargetAtTime(f0, t, 0.008);
      o.frequency.setTargetAtTime(f0 * 1.35, t + 0.03, 0.12);
      o.start(t);
      o.stop(t + 1.2);
    }

    const TABLA = { dha: ['dha'], dhin: ['tin', 'ge'], dhi: ['tin', 'ge'], na: ['na'], ta: ['na'], tin: ['tin'], tun: ['tun'], te: ['te'], ti: ['te'], re: ['re'], ke: ['ke'], ka: ['ke'], kat: ['ke'], ge: ['ge'], ghe: ['ge'] };
    const DHOLAK = { ga: ['ga'], ta: ['ta'], dha: ['ga', 'ta'], x: ['ta'] };
    const tuneRate = 2 ** (plan.tune / 12);

    for (const e of plan.events) {
      const p = plan.parts[e.p];
      const out = buses[e.p];
      if (p.synth) {
        synth(p, e, out);
        continue;
      }
      const k = plan.kit.instruments[p.samples];
      if (p.kind === 'drone') {
        const z = k.zones[0];
        sample(p.play, z.file, e.t, 2 ** ((e.m - z.midi) / 12), e.v, out, { d: e.d, loop: z.loop, held: true });
      } else if (p.kind === 'drum') {
        const strokes = p.play === 'tabla' ? TABLA[e.b] : p.play === 'dholak' ? DHOLAK[e.b] : ['x'];
        for (const s of strokes) {
          if (s === 'ge') ge(e.t, e.v, out);
          else sample(p.play, next(k.bols[s], `${p.play}/${s}`), e.t, p.play === 'tabla' || p.play === 'dholak' ? (s === 'ke' ? 1 : tuneRate) : 1, e.v, out, { maxLen: 3 });
        }
      } else {
        const z = zoneFor(p.samples, e.m);
        const rate = 2 ** ((e.m - z.midi) / 12);
        const held = ['flute', 'strings', 'harmonium'].includes(p.play);
        const glideFrom = e.g != null ? 2 ** ((e.g - z.midi) / 12) : null;
        if (p.play === 'santoor') {
          // the harp's body made brighter, with a hammer's tick on top
          const shelf = ctx.createBiquadFilter();
          shelf.type = 'highshelf';
          shelf.frequency.value = 2800;
          shelf.gain.value = 3;
          shelf.connect(out);
          sample(p.play, z.file, e.t, rate, e.v, shelf, { maxLen: 2.6 });
          const n = ctx.createBufferSource();
          n.buffer = white;
          const hp = ctx.createBiquadFilter();
          hp.type = 'highpass';
          hp.frequency.value = 3000;
          const g = ctx.createGain();
          g.gain.setValueAtTime(e.v * 0.25, e.t);
          g.gain.setTargetAtTime(0, e.t, 0.004);
          n.connect(hp).connect(g).connect(out);
          n.start(e.t);
          n.stop(e.t + 0.05);
        } else sample(p.play, z.file, e.t, rate, e.v, out, { d: e.d, loop: z.loop, held, glideFrom, maxLen: p.play === 'sitar' ? 2.4 : p.play === 'harp' ? 3.6 : undefined });
      }
    }
    // no click at the very end
    const tail = Math.min(0.3, plan.length / 10);
    master.gain.setValueAtTime(dbToGain(plan.volume), plan.length - tail);
    master.gain.linearRampToValueAtTime(0, plan.length);
    const out = await ctx.startRendering();
    return [out.getChannelData(0), out.getChannelData(1)];
  }

  window.studioMusic = { render };
})();
