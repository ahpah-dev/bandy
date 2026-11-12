// AudioWorklet processors: recorder, pitch shifter / auto-pitch, noise gate.

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.n = 0; this.on = true; this.port.onmessage = (e) => { if (e.data === 'stop') { this.flush(); this.on = false; } }; }
  flush() { if (!this.n) return; const out = new Float32Array(this.n); let o = 0; for (const b of this.buf) { out.set(b, o); o += b.length; } this.port.postMessage({ frame: this.startFrame, data: out }, [out.buffer]); this.buf = []; this.n = 0; }
  process(inputs) {
    if (!this.on) return false;
    const ch = inputs[0]?.[0];
    if (ch) {
      if (!this.n) this.startFrame = currentFrame;
      this.buf.push(ch.slice()); this.n += ch.length;
      if (this.n >= 4096) this.flush();
    }
    return true;
  }
}
registerProcessor('bandy-recorder', RecorderProcessor);

class PitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }]; }
  constructor(opts) {
    super();
    this.cfg = Object.assign({ auto: false, mask: [0, 2, 4, 5, 7, 9, 11], root: 0, speed: 0.5, amount: 1 }, opts.processorOptions || {});
    this.size = Math.round(sampleRate * 0.06);
    this.len = this.size * 4;
    this.bufs = [new Float32Array(this.len), new Float32Array(this.len)];
    this.w = 0; this.phase = 0;
    this.smooth = 1;
    // detector
    this.dsr = sampleRate / 4; this.dn = 640; this.dring = new Float32Array(this.dn); this.dw = 0; this.dc = 0; this.acc = 0; this.ac = 0;
    this.minLag = Math.floor(this.dsr / 900); this.maxLag = Math.floor(this.dsr / 70);
    this.targetRatio = 1;
    this.port.onmessage = (e) => Object.assign(this.cfg, e.data);
  }
  detect() {
    const n = this.dn, r = this.dring, w = this.dw;
    const x = new Float32Array(n); let e0 = 0;
    for (let i = 0; i < n; i++) { x[i] = r[(w + i) % n]; e0 += x[i] * x[i]; }
    if (e0 / n < 1e-5) return 0;
    const maxLag = Math.min(this.maxLag, n >> 1);
    let best = 0, bestLag = 0, prevC = 1, falling = true;
    const cs = new Float32Array(maxLag + 2);
    for (let lag = this.minLag; lag <= maxLag; lag++) {
      let s = 0, e1 = 0;
      for (let i = 0; i < n - lag; i += 1) { s += x[i] * x[i + lag]; e1 += x[i + lag] * x[i + lag]; }
      cs[lag] = s / (Math.sqrt(e0 * e1) + 1e-9);
    }
    for (let lag = this.minLag + 1; lag < maxLag; lag++) {
      if (cs[lag] > cs[lag - 1] && cs[lag] >= cs[lag + 1] && cs[lag] > 0.6 && cs[lag] > best * 0.97) { if (cs[lag] > best) { best = cs[lag]; bestLag = lag; } if (best > 0.9) break; }
    }
    if (!bestLag) return 0;
    const a = cs[bestLag - 1], b = cs[bestLag], c = cs[bestLag + 1], d = a - 2 * b + c;
    const lagf = d ? bestLag + (0.5 * (a - c)) / d : bestLag;
    return this.dsr / lagf;
  }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!inp.length) return true;
    const nch = Math.min(out.length, 2, inp.length) || 1;
    const frames = out[0].length;
    let ratio = params.ratio[0];
    if (this.cfg.auto) {
      const x = inp[0];
      for (let i = 0; i < frames; i++) {
        this.acc += x[i]; this.ac++;
        if (this.ac === 4) { this.dring[this.dw] = this.acc / 4; this.dw = (this.dw + 1) % this.dn; this.acc = 0; this.ac = 0; this.dc++; }
      }
      if (this.dc >= 128) {
        this.dc = 0;
        const f = this.detect();
        if (f > 0) {
          const m = 69 + 12 * Math.log2(f / 440);
          let bestN = m, bd = 99;
          const base = Math.floor(m / 12) * 12;
          for (let o = -12; o <= 12; o += 12) for (const p of this.cfg.mask) { const cand = base + o + ((p + this.cfg.root) % 12); if (Math.abs(cand - m) < bd) { bd = Math.abs(cand - m); bestN = cand; } }
          this.targetRatio = Math.pow(2, ((bestN - m) * this.cfg.amount) / 12);
        } else this.targetRatio += (1 - this.targetRatio) * 0.2;
      }
      const k = 1 - Math.pow(0.5, frames / (sampleRate * (0.002 + this.cfg.speed * 0.06)));
      this.smooth += (this.targetRatio - this.smooth) * Math.max(0.02, k);
      ratio = this.smooth;
    }
    const inc = (1 - ratio) / this.size;
    for (let c = 0; c < nch; c++) {
      const x = inp[Math.min(c, inp.length - 1)], y = out[c], buf = this.bufs[c];
      let w = this.w, ph = this.phase;
      for (let i = 0; i < frames; i++) {
        buf[w] = x[i];
        let acc = 0;
        for (let t = 0; t < 2; t++) {
          let p = ph + t * 0.5; if (p >= 1) p -= 1;
          const g = 0.5 - 0.5 * Math.cos(2 * Math.PI * p);
          let rp = w - p * this.size; if (rp < 0) rp += this.len;
          const i0 = Math.floor(rp), fr = rp - i0, i1 = i0 + 1 >= this.len ? 0 : i0 + 1;
          acc += g * (buf[i0] * (1 - fr) + buf[i1] * fr);
        }
        y[i] = acc;
        w++; if (w >= this.len) w = 0;
        ph += inc; if (ph >= 1) ph -= 1; else if (ph < 0) ph += 1;
      }
      if (c === nch - 1) { this.w = w; this.phase = ph; }
    }
    for (let c = nch; c < out.length; c++) out[c].set(out[0]);
    return true;
  }
}
registerProcessor('bandy-pitch', PitchProcessor);

class GateProcessor extends AudioWorkletProcessor {
  constructor(opts) { super(); this.cfg = Object.assign({ threshold: -45, attack: 0.005, release: 0.12, floor: -60 }, opts.processorOptions || {}); this.env = 0; this.g = 0; this.port.onmessage = (e) => Object.assign(this.cfg, e.data); }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!inp.length) return true;
    const th = Math.pow(10, this.cfg.threshold / 20), fl = Math.pow(10, this.cfg.floor / 20);
    const a = Math.exp(-1 / (sampleRate * Math.max(0.0005, this.cfg.attack))), r = Math.exp(-1 / (sampleRate * Math.max(0.005, this.cfg.release)));
    const n = out[0].length;
    for (let i = 0; i < n; i++) {
      let lvl = 0; for (let c = 0; c < inp.length; c++) lvl = Math.max(lvl, Math.abs(inp[c][i]));
      this.env = lvl > this.env ? lvl : this.env * 0.9995;
      const target = this.env > th ? 1 : fl;
      this.g = target > this.g ? target + (this.g - target) * a : target + (this.g - target) * r;
      for (let c = 0; c < out.length; c++) out[c][i] = inp[Math.min(c, inp.length - 1)][i] * this.g;
    }
    return true;
  }
}
registerProcessor('bandy-gate', GateProcessor);
