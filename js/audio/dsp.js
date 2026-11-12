// Offline DSP helpers: time-stretch (WSOLA), reverse, peaks, normalise, simple stem splitting.

export function cloneBuffer(ctx, buf, len = buf.length) {
  return ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
}

export function reverseBuffer(ctx, buf) {
  const out = cloneBuffer(ctx, buf);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const a = buf.getChannelData(c), b = out.getChannelData(c);
    for (let i = 0, n = a.length; i < n; i++) b[i] = a[n - 1 - i];
  }
  return out;
}

export function normalizeBuffer(ctx, buf, target = 0.97) {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); }
  if (peak < 1e-5) return buf;
  const g = target / peak, out = cloneBuffer(ctx, buf);
  for (let c = 0; c < buf.numberOfChannels; c++) { const a = buf.getChannelData(c), b = out.getChannelData(c); for (let i = 0; i < a.length; i++) b[i] = a[i] * g; }
  return out;
}

// Waveform-similarity overlap-add. ratio = outputDuration / inputDuration.
export function stretchBuffer(ctx, buf, ratio) {
  if (Math.abs(ratio - 1) < 1e-4) return buf;
  const sr = buf.sampleRate, n = buf.length;
  const N = Math.round(sr * 0.046 / 2) * 2, Hs = N / 2, Ha = Hs / ratio;
  const SEARCH = Math.round(sr * 0.012);
  const outLen = Math.max(1, Math.floor(n * ratio));
  const out = ctx.createBuffer(buf.numberOfChannels, outLen, sr);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  // mono decimated (x4) for the similarity search
  const D = 4, dn = Math.floor(n / D), mono = new Float32Array(dn);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < dn; i++) { let s = 0; for (let k = 0; k < D; k++) s += d[i * D + k]; mono[i] += s / D / buf.numberOfChannels; } }
  const dN = Math.floor(N / D), dS = Math.floor(SEARCH / D);
  const chans = [...Array(buf.numberOfChannels)].map((_, c) => buf.getChannelData(c));
  const outs = [...Array(buf.numberOfChannels)].map((_, c) => out.getChannelData(c));
  const norm = new Float32Array(outLen);
  let prev = 0, first = true;
  const frames = Math.ceil(outLen / Hs) + 1;
  for (let m = 0; m < frames; m++) {
    const outPos = m * Hs;
    let pos = Math.round(m * Ha);
    if (!first) {
      const natural = prev + Hs; // where the previous frame "naturally" continues
      const target = Math.round((natural) / D);
      let best = -Infinity, bestD = 0;
      const lo = Math.max(0, Math.round(pos / D) - dS), hi = Math.min(dn - dN - 1, Math.round(pos / D) + dS);
      for (let cand = lo; cand <= hi; cand += 1) {
        let s = 0;
        for (let i = 0; i < dN; i += 2) s += mono[cand + i] * mono[target + i];
        if (s > best) { best = s; bestD = cand; }
      }
      if (best > -Infinity) pos = bestD * D;
    }
    first = false;
    prev = pos;
    if (pos >= n) break;
    for (let c = 0; c < chans.length; c++) {
      const src = chans[c], dst = outs[c];
      for (let i = 0; i < N; i++) {
        const o = outPos + i, s = pos + i;
        if (o >= outLen) break;
        if (s < n) dst[o] += src[s] * win[i];
      }
    }
    for (let i = 0; i < N; i++) { const o = outPos + i; if (o < outLen) norm[o] += win[i]; }
  }
  for (let c = 0; c < outs.length; c++) { const dst = outs[c]; for (let i = 0; i < outLen; i++) if (norm[i] > 1e-3) dst[i] /= norm[i]; }
  return out;
}

// min/max peaks per `block` samples (mono mix). Returns Float32Array [min0,max0,min1,max1,...]
export function computePeaks(buf, block = 256) {
  const n = Math.ceil(buf.length / block), out = new Float32Array(n * 2);
  const chans = [...Array(buf.numberOfChannels)].map((_, c) => buf.getChannelData(c));
  for (let b = 0; b < n; b++) {
    let mn = 1, mx = -1;
    const s = b * block, e = Math.min(buf.length, s + block);
    for (const d of chans) for (let i = s; i < e; i += 2) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    out[b * 2] = mn; out[b * 2 + 1] = mx;
  }
  return out;
}

export function slicePeak(buf) { let p = 0; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i += 4) p = Math.max(p, Math.abs(d[i])); } return p; }

// Rough "stem" splitter using filters and mid/side maths (not AI - labelled experimental in the UI).
export async function splitStems(buf) {
  const sr = buf.sampleRate, len = buf.length;
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const mk = (fn) => {
    const off = new OfflineAudioContext(2, len, sr);
    const b = off.createBuffer(2, len, sr);
    fn(b.getChannelData(0), b.getChannelData(1));
    return { off, b };
  };
  const run = async (fn, nodes) => {
    const { off, b } = mk(fn);
    const src = off.createBufferSource(); src.buffer = b;
    let last = src;
    for (const mkNode of nodes) { const nd = mkNode(off); last.connect(nd); last = nd; }
    last.connect(off.destination); src.start();
    return off.startRendering();
  };
  const bq = (type, f, q = 0.707) => (off) => { const n = off.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
  const mid = (l, r) => { for (let i = 0; i < len; i++) { l[i] = r[i] = (L[i] + R[i]) * 0.5; } };
  const side = (l, r) => { for (let i = 0; i < len; i++) { const s = (L[i] - R[i]) * 0.5; l[i] = s; r[i] = -s; } };
  const all = (l, r) => { for (let i = 0; i < len; i++) { l[i] = L[i]; r[i] = R[i]; } };
  const [bass, vocals, instr, highs] = await Promise.all([
    run(all, [bq('lowpass', 180), bq('lowpass', 180)]),
    run(mid, [bq('highpass', 180), bq('highpass', 180), bq('lowpass', 5200)]),
    run(side, [bq('highpass', 160)]),
    run(all, [bq('highpass', 6500), bq('highpass', 6500)]),
  ]);
  return [
    { name: 'Bass (low end)', buffer: bass },
    { name: 'Vocals (centre)', buffer: vocals },
    { name: 'Instruments (sides)', buffer: instr },
    { name: 'Hats & air (highs)', buffer: highs },
  ];
}

export function encodeWav(buf, bits = 16) {
  const ch = buf.numberOfChannels, sr = buf.sampleRate, n = buf.length;
  const bytes = bits / 8, dataSize = n * ch * bytes;
  const ab = new ArrayBuffer(44 + dataSize), v = new DataView(ab);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * bytes, true); v.setUint16(32, ch * bytes, true); v.setUint16(34, bits, true);
  ws(36, 'data'); v.setUint32(40, dataSize, true);
  const chans = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, chans[c][i]));
    if (bits === 16) { v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
    else if (bits === 24) { const x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff); v.setUint8(o, x & 255); v.setUint8(o + 1, (x >> 8) & 255); v.setUint8(o + 2, (x >> 16) & 255); o += 3; }
    else { v.setFloat32(o, chans[c][i], true); o += 4; }
  }
  return new Blob([ab], { type: 'audio/wav' });
}
