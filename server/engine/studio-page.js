// Runs inside the studio page (https://studio.local, a secure page in the shared headless browser). Video is
// encoded with WebCodecs (H.264) into MP4 with mp4-muxer; audio is decoded by the browser, measured (BS.1770
// loudness, speech pauses), mixed (voice over music, music ducked under the voice) and encoded as AAC.
(() => {
  const SR = 48000;

  async function decode(url) {
    const buf = await (await fetch(url)).arrayBuffer();
    const ctx = new OfflineAudioContext(2, SR, SR);
    const ab = await ctx.decodeAudioData(buf);
    const L = ab.getChannelData(0);
    const R = ab.numberOfChannels > 1 ? ab.getChannelData(1) : L;
    return [new Float32Array(L), new Float32Array(R)];
  }

  // BS.1770-4 integrated loudness at 48 kHz
  function biquad(x, b, a) {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }
  function lufs(ch) {
    const k = ch.map((x) => biquad(biquad(x, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]), [1, -2, 1], [1, -1.99004745483398, 0.99007225036621]));
    const blk = 0.4 * SR, hop = 0.1 * SR, ms = [];
    for (let i = 0; i + blk < k[0].length; i += hop) {
      let s = 0;
      for (const c of k) for (let j = i; j < i + blk; j++) s += c[j] * c[j];
      ms.push(s / blk + 1e-15);
    }
    const loud = (m) => -0.691 + 10 * Math.log10(m);
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const g = ms.filter((m) => loud(m) > -70);
    if (!g.length) return -Infinity;
    const rel = loud(mean(g)) - 10;
    return loud(mean(g.filter((m) => loud(m) > rel)));
  }
  const peakDb = (ch) => {
    let p = 0;
    for (const c of ch) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]));
    return 20 * Math.log10(p + 1e-12);
  };

  // speech pauses: 20 ms loudness frames below a threshold for at least `minPause` seconds
  function pauses(ch, minPause = 0.3) {
    const w = 0.02 * SR, n = Math.floor(ch[0].length / w), db = new Float32Array(n);
    for (let f = 0; f < n; f++) {
      let s = 0;
      for (let i = f * w; i < (f + 1) * w; i++) { const v = (ch[0][i] + ch[1][i]) / 2; s += v * v; }
      db[f] = 10 * Math.log10(s / w + 1e-12);
    }
    const sorted = [...db].sort((a, b) => a - b);
    const loudish = sorted[Math.floor(sorted.length * 0.9)];
    const thr = Math.max(-55, loudish - 30);
    const out = [];
    let start = -1;
    for (let f = 0; f <= n; f++) {
      const quiet = f < n && db[f] < thr;
      if (quiet && start < 0) start = f;
      if (!quiet && start >= 0) {
        if ((f - start) * 0.02 >= minPause) out.push({ from: +(start * 0.02).toFixed(2), to: +(f * 0.02).toFixed(2) });
        start = -1;
      }
    }
    return out;
  }

  window.studio = {
    async analyse(url) {
      const ch = await decode(url);
      const duration = ch[0].length / SR;
      const ps = pauses(ch);
      // the spoken parts between pauses (leading/trailing silence trimmed)
      const segs = [];
      let t = 0;
      for (const p of ps) {
        if (p.from - t > 0.15) segs.push({ from: +t.toFixed(2), to: p.from });
        t = p.to;
      }
      if (duration - t > 0.15) segs.push({ from: +t.toFixed(2), to: +duration.toFixed(2) });
      return { duration: +duration.toFixed(2), lufs: +lufs(ch).toFixed(1), peak: +peakDb(ch).toFixed(1), pauses: ps, speech: segs };
    },

    // voice and/or music cut to `duration`, music ducked under the voice, loudness to `target` LUFS, peaks <= -1 dBFS
    async mix({ voice, music, duration, target = -14 }) {
      const n = Math.round(duration * SR);
      const out = [new Float32Array(n), new Float32Array(n)];
      const gainTo = (ch, want) => { const l = lufs(ch); const g = Number.isFinite(l) ? 10 ** ((want - l) / 20) : 1; return ch.map((c) => c.map((v) => v * g)); };
      let vEnv = null;
      if (voice) {
        const v = gainTo(await decode(voice.url), -16);
        const o = Math.round((voice.start ?? 0) * SR);
        for (let c = 0; c < 2; c++) for (let i = 0; i < v[c].length && i + o < n; i++) if (i + o >= 0) out[c][i + o] += v[c][i];
        // a smooth "voice is speaking" curve for ducking the music
        const win = 0.05 * SR; vEnv = new Float32Array(n); let acc = 0;
        for (let i = 0; i < n; i++) { const a = (out[0][i] + out[1][i]) / 2; acc += a * a; if (i >= win) { const b = (out[0][i - win] + out[1][i - win]) / 2; acc -= b * b; } vEnv[i] = Math.sqrt(Math.max(0, acc) / win); }
      }
      if (music) {
        const m = gainTo(await decode(music.url), voice ? -26 + (music.volume_db ?? 0) : -16 + (music.volume_db ?? 0));
        const from = Math.round((music.start ?? 0) * SR);
        const fade = Math.round(1.5 * SR);
        const thr = 10 ** (-42 / 20), low = 10 ** (-(music.duck_db ?? 6) / 20), down = Math.exp(-1 / (0.06 * SR)), up = Math.exp(-1 / (0.4 * SR));
        let cur = 1;
        for (let i = 0; i < n; i++) {
          const j = i + from;
          if (j >= m[0].length) break;
          let g = 1;
          if (vEnv) { const want = vEnv[i] > thr ? low : 1; cur = want + (cur - want) * (want < cur ? down : up); g = cur; }
          if (m[0].length - from > n && i > n - fade) g *= ((n - i) / fade) ** 1.5;
          out[0][i] += m[0][j] * g; out[1][i] += m[1][j] * g;
        }
      }
      // loudness, then a simple look-ahead limiter so peaks stay at or below -1 dBFS
      let mixed = gainTo(out, target);
      const ceil = 10 ** (-1 / 20), look = Math.round(0.005 * SR), rel = Math.exp(-1 / (0.1 * SR));
      const g = new Float32Array(n).fill(1);
      for (let i = 0; i < n; i++) { const p = Math.max(Math.abs(mixed[0][i]), Math.abs(mixed[1][i])); if (p > ceil) { const need = ceil / p; for (let j = Math.max(0, i - look); j <= i; j++) g[j] = Math.min(g[j], need); } }
      let gg = 1;
      for (let i = 0; i < n; i++) { gg = g[i] < gg ? g[i] : g[i] + (gg - g[i]) * rel; mixed[0][i] *= gg; mixed[1][i] *= gg; }
      return { ch: mixed, lufs: +lufs(mixed).toFixed(1), peak: +peakDb(mixed).toFixed(1) };
    },

    // frames (image URLs) -> MP4 (H.264, + AAC when `audio` is given); posts the file to `out` and returns stats
    async encode({ frames, fps, width, height, bitrate, audio, out, onProgress }) {
      width -= width % 2; height -= height % 2;
      const codecs = ['avc1.640034', 'avc1.640033', 'avc1.64002a', 'avc1.640028', 'avc1.4d0034', 'avc1.42e034'];
      let vcfg = null;
      for (const codec of codecs) {
        const c = { codec, width, height, bitrate, framerate: fps, avc: { format: 'avc' } };
        if ((await VideoEncoder.isConfigSupported(c)).supported) { vcfg = c; break; }
      }
      if (!vcfg) throw new Error(`This browser can't make ${width}x${height} H.264 video.`);
      let mixInfo = null, pcm = null;
      if (audio) { const m = await this.mix({ ...audio, duration: frames.length / fps }); pcm = m.ch; mixInfo = { lufs: m.lufs, peak: m.peak }; }
      const muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: { codec: 'avc', width, height, frameRate: fps },
        ...(pcm ? { audio: { codec: 'aac', numberOfChannels: 2, sampleRate: SR } } : {}),
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
      });
      let failed = null;
      const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (failed = e) });
      venc.configure(vcfg);
      const canvas = new OffscreenCanvas(width, height);
      const g = canvas.getContext('2d');
      const dur = 1e6 / fps;
      for (let i = 0; i < frames.length; i++) {
        if (failed) throw failed;
        const bmp = await createImageBitmap(await (await fetch(frames[i])).blob());
        // fill the frame: scale to cover, centred (recordings are cropped by at most a pixel to make even sizes)
        const k = Math.max(width / bmp.width, height / bmp.height);
        const w = bmp.width * k, h = bmp.height * k;
        g.drawImage(bmp, (width - w) / 2, (height - h) / 2, w, h);
        bmp.close();
        const vf = new VideoFrame(canvas, { timestamp: Math.round(i * dur), duration: Math.round(dur) });
        venc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
        vf.close();
        while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 5));
        if (i % 15 === 0) window.__progress?.((i + 1) / frames.length);
      }
      await venc.flush();
      if (pcm) {
        const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (failed = e) });
        aenc.configure({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate: 192000 });
        const block = 1024;
        for (let i = 0; i < pcm[0].length; i += block) {
          const len = Math.min(block, pcm[0].length - i);
          const data = new Float32Array(len * 2);
          data.set(pcm[0].subarray(i, i + len), 0);
          data.set(pcm[1].subarray(i, i + len), len);
          const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: len, numberOfChannels: 2, timestamp: Math.round((i / SR) * 1e6), data });
          aenc.encode(ad);
          ad.close();
        }
        await aenc.flush();
      }
      if (failed) throw failed;
      muxer.finalize();
      const buf = muxer.target.buffer;
      await fetch(out, { method: 'POST', body: buf });
      return { bytes: buf.byteLength, width, height, fps, frames: frames.length, codec: vcfg.codec, audio: mixInfo };
    },
  };
})();
