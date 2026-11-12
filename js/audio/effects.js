// Effects library: each effect exposes create(ctx, params, env) -> { input, output, set(params), tempo(bpm), destroy() }.
import { dbToGain, SCALES } from '../util.js';

const num = (label, min, max, def, o = {}) => ({ type: 'num', label, min, max, def, ...o });
const sel = (label, options, def) => ({ type: 'select', label, options, def });
const DIVS = { '1/2': 2, '1/4': 1, '1/4d': 1.5, '1/4t': 2 / 3, '1/8': 0.5, '1/8d': 0.75, '1/8t': 1 / 3, '1/16': 0.25 };
const T = 0.02;
const setp = (ctx, p, v) => p.setTargetAtTime(v, ctx.currentTime, T);

function wetDry(ctx) {
  const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
  input.connect(dry); dry.connect(output); wet.connect(output);
  return { input, output, dry, wet, setMix(m) { setp(ctx, dry.gain, Math.cos(m * Math.PI / 2)); setp(ctx, wet.gain, Math.sin(m * Math.PI / 2)); } };
}
function lfo(ctx, type, freq) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.start(); return o; }
function curve(fn, n = 2048) { const c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = fn((i / (n - 1)) * 2 - 1); return c; }
const kill = (nodes) => { for (const n of nodes) { try { n.stop?.(); } catch {} try { n.disconnect(); } catch {} } };

function makeIR(ctx, size, damp) {
  const sr = ctx.sampleRate, len = Math.max(1, Math.floor(sr * size));
  const ir = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c); let lp = 0;
    const k = 0.15 + (1 - damp) * 0.85;
    for (let i = 0; i < len; i++) {
      const t = i / len, n = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6);
      lp += (n - lp) * (k * (1 - 0.6 * t)); d[i] = lp * (i < 200 ? i / 200 : 1);
    }
  }
  return ir;
}

export const FX = {
  eq: {
    name: 'EQ', icon: 'sliders',
    params: { lowcut: num('Low cut', 20, 600, 20, { log: true, unit: ' Hz' }), low: num('Low', -18, 18, 0, { unit: ' dB' }), mid: num('Mid', -18, 18, 0, { unit: ' dB' }), midfreq: num('Mid Hz', 200, 6000, 1000, { log: true, unit: ' Hz' }), high: num('High', -18, 18, 0, { unit: ' dB' }) },
    create(ctx, p) {
      const hp = ctx.createBiquadFilter(), ls = ctx.createBiquadFilter(), pk = ctx.createBiquadFilter(), hs = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.Q.value = 0.7; ls.type = 'lowshelf'; ls.frequency.value = 120; pk.type = 'peaking'; pk.Q.value = 0.9; hs.type = 'highshelf'; hs.frequency.value = 7000;
      hp.connect(ls); ls.connect(pk); pk.connect(hs);
      const set = (q) => { setp(ctx, hp.frequency, q.lowcut); setp(ctx, ls.gain, q.low); setp(ctx, pk.gain, q.mid); setp(ctx, pk.frequency, q.midfreq); setp(ctx, hs.gain, q.high); };
      set(p);
      return { input: hp, output: hs, set, destroy: () => kill([hp, ls, pk, hs]) };
    },
  },
  compressor: {
    name: 'Compressor', icon: 'sliders',
    params: { threshold: num('Thresh', -60, 0, -22, { unit: ' dB' }), ratio: num('Ratio', 1, 20, 4, { unit: ':1' }), attack: num('Attack', 0.001, 0.3, 0.01, { log: true, unit: ' s' }), release: num('Release', 0.02, 1.2, 0.25, { unit: ' s' }), makeup: num('Makeup', 0, 18, 3, { unit: ' dB' }) },
    create(ctx, p) {
      const c = ctx.createDynamicsCompressor(), g = ctx.createGain(); c.knee.value = 12; c.connect(g);
      const set = (q) => { c.threshold.value = q.threshold; c.ratio.value = q.ratio; c.attack.value = q.attack; c.release.value = q.release; setp(ctx, g.gain, dbToGain(q.makeup)); };
      set(p);
      return { input: c, output: g, set, destroy: () => kill([c, g]) };
    },
  },
  reverb: {
    name: 'Reverb', icon: 'fx',
    params: { size: num('Size', 0.3, 6, 1.8, { unit: ' s' }), damp: num('Damping', 0, 1, 0.5), predelay: num('Pre-delay', 0, 0.2, 0.02, { unit: ' s' }), mix: num('Mix', 0, 1, 0.25) },
    create(ctx, p) {
      const w = wetDry(ctx), pre = ctx.createDelay(0.5), conv = ctx.createConvolver();
      w.input.connect(pre); pre.connect(conv); conv.connect(w.wet);
      let lastKey = '';
      const set = (q) => {
        setp(ctx, pre.delayTime, q.predelay); w.setMix(q.mix);
        const key = q.size.toFixed(2) + q.damp.toFixed(2);
        if (key !== lastKey) { lastKey = key; conv.buffer = makeIR(ctx, q.size, q.damp); }
      };
      set(p);
      return { input: w.input, output: w.output, set, destroy: () => kill([w.input, w.output, w.dry, w.wet, pre, conv]) };
    },
  },
  delay: {
    name: 'Delay', icon: 'fx',
    params: { time: sel('Time', Object.keys(DIVS), '1/8d'), feedback: num('Feedback', 0, 0.92, 0.38), tone: num('Tone', 400, 12000, 4500, { log: true, unit: ' Hz' }), mix: num('Mix', 0, 1, 0.3) },
    create(ctx, p) {
      const w = wetDry(ctx), d = ctx.createDelay(4), fb = ctx.createGain(), lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; w.input.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(w.wet);
      let bpm = 120, q = p;
      const apply = () => { setp(ctx, d.delayTime, Math.min(3.9, DIVS[q.time] * 60 / bpm)); setp(ctx, fb.gain, q.feedback); setp(ctx, lp.frequency, q.tone); w.setMix(q.mix); };
      apply();
      return { input: w.input, output: w.output, set(x) { q = x; apply(); }, tempo(b) { bpm = b; apply(); }, destroy: () => kill([w.input, w.output, w.dry, w.wet, d, fb, lp]) };
    },
  },
  distortion: {
    name: 'Distortion', icon: 'fx',
    params: { type: sel('Type', ['soft', 'hard', 'fuzz', 'fold'], 'soft'), drive: num('Drive', 0, 1, 0.4), tone: num('Tone', 500, 14000, 6500, { log: true, unit: ' Hz' }), level: num('Level', -24, 6, -4, { unit: ' dB' }), mix: num('Mix', 0, 1, 1) },
    create(ctx, p) {
      const w = wetDry(ctx), ws = ctx.createWaveShaper(), lp = ctx.createBiquadFilter(), out = ctx.createGain();
      ws.oversample = '4x'; lp.type = 'lowpass'; w.input.connect(ws); ws.connect(lp); lp.connect(out); out.connect(w.wet);
      let lastKey = '';
      const set = (q) => {
        const key = q.type + q.drive.toFixed(3);
        if (key !== lastKey) {
          lastKey = key; const k = 1 + q.drive * 40;
          ws.curve = curve({ soft: (x) => Math.tanh(k * x) / Math.tanh(k), hard: (x) => Math.max(-1, Math.min(1, k * x * 0.6)), fuzz: (x) => { const y = Math.tanh(k * (x + 0.15 * q.drive)); return y - Math.tanh(k * 0.15 * q.drive) * 0.7; }, fold: (x) => Math.sin(x * (1 + q.drive * 6) * 1.2) }[q.type]);
        }
        setp(ctx, lp.frequency, q.tone); setp(ctx, out.gain, dbToGain(q.level)); w.setMix(q.mix);
      };
      set(p);
      return { input: w.input, output: w.output, set, destroy: () => kill([w.input, w.output, w.dry, w.wet, ws, lp, out]) };
    },
  },
  chorus: {
    name: 'Chorus', icon: 'fx',
    params: { rate: num('Rate', 0.1, 8, 0.8, { log: true, unit: ' Hz' }), depth: num('Depth', 0, 1, 0.5), mix: num('Mix', 0, 1, 0.5) },
    create(ctx, p) {
      const w = wetDry(ctx), nodes = [];
      const o1 = lfo(ctx, 'sine', 0.8), o2 = lfo(ctx, 'sine', 1.1), g1 = ctx.createGain(), g2 = ctx.createGain(), d1 = ctx.createDelay(0.1), d2 = ctx.createDelay(0.1);
      d1.delayTime.value = 0.022; d2.delayTime.value = 0.03;
      o1.connect(g1); g1.connect(d1.delayTime); o2.connect(g2); g2.connect(d2.delayTime);
      w.input.connect(d1); w.input.connect(d2); d1.connect(w.wet); d2.connect(w.wet);
      nodes.push(o1, o2, g1, g2, d1, d2, w.input, w.output, w.dry, w.wet);
      const set = (q) => { o1.frequency.value = q.rate; o2.frequency.value = q.rate * 1.31; g1.gain.value = g2.gain.value = 0.006 * q.depth; w.setMix(q.mix); };
      set(p);
      return { input: w.input, output: w.output, set, destroy: () => kill(nodes) };
    },
  },
  flanger: {
    name: 'Flanger', icon: 'fx',
    params: { rate: num('Rate', 0.05, 5, 0.3, { log: true, unit: ' Hz' }), depth: num('Depth', 0, 1, 0.7), feedback: num('Feedback', -0.9, 0.9, 0.5), mix: num('Mix', 0, 1, 0.5) },
    create(ctx, p) {
      const w = wetDry(ctx), o = lfo(ctx, 'sine', 0.3), g = ctx.createGain(), d = ctx.createDelay(0.05), fb = ctx.createGain();
      d.delayTime.value = 0.004; o.connect(g); g.connect(d.delayTime); w.input.connect(d); d.connect(w.wet); d.connect(fb); fb.connect(d);
      const set = (q) => { o.frequency.value = q.rate; g.gain.value = 0.003 * q.depth; setp(ctx, fb.gain, q.feedback); w.setMix(q.mix); };
      set(p);
      return { input: w.input, output: w.output, set, destroy: () => kill([o, g, d, fb, w.input, w.output, w.dry, w.wet]) };
    },
  },
  phaser: {
    name: 'Phaser', icon: 'fx',
    params: { rate: num('Rate', 0.05, 6, 0.4, { log: true, unit: ' Hz' }), depth: num('Depth', 0, 1, 0.7), feedback: num('Feedback', 0, 0.85, 0.3), mix: num('Mix', 0, 1, 0.5) },
    create(ctx, p) {
      const w = wetDry(ctx), o = lfo(ctx, 'sine', 0.4), g = ctx.createGain(), fb = ctx.createGain();
      const aps = [0, 1, 2, 3].map(() => { const a = ctx.createBiquadFilter(); a.type = 'allpass'; a.frequency.value = 900; a.Q.value = 0.8; g.connect(a.detune); return a; });
      o.connect(g); w.input.connect(aps[0]); aps.reduce((a, b) => (a.connect(b), b)); aps[3].connect(w.wet); aps[3].connect(fb); fb.connect(aps[0]);
      const set = (q) => { o.frequency.value = q.rate; g.gain.value = 1800 * q.depth; setp(ctx, fb.gain, q.feedback); w.setMix(q.mix); };
      set(p);
      return { input: w.input, output: w.output, set, destroy: () => kill([o, g, fb, ...aps, w.input, w.output, w.dry, w.wet]) };
    },
  },
  filter: {
    name: 'Filter', icon: 'sliders',
    params: { type: sel('Type', ['lowpass', 'highpass', 'bandpass', 'notch'], 'lowpass'), freq: num('Cutoff', 40, 18000, 1800, { log: true, unit: ' Hz' }), q: num('Resonance', 0.1, 18, 1.5), lfoRate: num('Sweep Hz', 0, 12, 0, { unit: ' Hz' }), lfoDepth: num('Sweep', 0, 1, 0.5) },
    create(ctx, p) {
      const f = ctx.createBiquadFilter(), o = lfo(ctx, 'sine', 1), g = ctx.createGain(); o.connect(g); g.connect(f.detune);
      const set = (q) => { f.type = q.type; setp(ctx, f.frequency, q.freq); setp(ctx, f.Q, q.q); o.frequency.value = Math.max(0.01, q.lfoRate); g.gain.value = q.lfoRate > 0 ? q.lfoDepth * 2400 : 0; };
      set(p);
      return { input: f, output: f, set, destroy: () => kill([f, o, g]) };
    },
  },
  tremolo: {
    name: 'Tremolo', icon: 'fx',
    params: { rate: num('Rate', 0.5, 20, 5, { log: true, unit: ' Hz' }), depth: num('Depth', 0, 1, 0.6) },
    create(ctx, p) {
      const g = ctx.createGain(), o = lfo(ctx, 'sine', 5), d = ctx.createGain(); o.connect(d); d.connect(g.gain);
      const set = (q) => { o.frequency.value = q.rate; g.gain.value = 1 - q.depth / 2; d.gain.value = q.depth / 2; };
      set(p);
      return { input: g, output: g, set, destroy: () => kill([g, o, d]) };
    },
  },
  bitcrusher: {
    name: 'Bitcrusher', icon: 'fx',
    params: { bits: num('Bits', 2, 12, 6, { step: 1 }), mix: num('Mix', 0, 1, 1) },
    create(ctx, p) {
      const w = wetDry(ctx), ws = ctx.createWaveShaper(); w.input.connect(ws); ws.connect(w.wet);
      let last = -1;
      const set = (q) => { if (q.bits !== last) { last = q.bits; const lv = Math.pow(2, q.bits - 1); ws.curve = curve((x) => Math.round(x * lv) / lv, 8192); } w.setMix(q.mix); };
      set(p);
      return { input: w.input, output: w.output, set, destroy: () => kill([w.input, w.output, w.dry, w.wet, ws]) };
    },
  },
  amp: {
    name: 'Amp Sim', icon: 'guitar',
    params: { model: sel('Model', ['clean', 'crunch', 'lead', 'metal'], 'crunch'), gain: num('Gain', 0, 1, 0.5), bass: num('Bass', -12, 12, 0, { unit: ' dB' }), mid: num('Mid', -12, 12, 0, { unit: ' dB' }), treble: num('Treble', -12, 12, 0, { unit: ' dB' }), presence: num('Presence', 0, 1, 0.5), level: num('Level', -18, 6, -3, { unit: ' dB' }), cab: sel('Cabinet', ['on', 'off'], 'on') },
    create(ctx, p) {
      const hp = ctx.createBiquadFilter(), pre = ctx.createWaveShaper(), b = ctx.createBiquadFilter(), m = ctx.createBiquadFilter(), t = ctx.createBiquadFilter(), pr = ctx.createBiquadFilter(), cab = ctx.createBiquadFilter(), cab2 = ctx.createBiquadFilter(), out = ctx.createGain();
      hp.type = 'highpass'; b.type = 'lowshelf'; b.frequency.value = 140; m.type = 'peaking'; m.frequency.value = 800; m.Q.value = 0.8; t.type = 'highshelf'; t.frequency.value = 3200; pr.type = 'highshelf'; pr.frequency.value = 5500; cab.type = 'lowpass'; cab.Q.value = 0.6; cab2.type = 'peaking'; cab2.frequency.value = 2400; cab2.gain.value = 3; pre.oversample = '4x';
      hp.connect(pre); pre.connect(b); b.connect(m); m.connect(t); t.connect(pr); pr.connect(cab); cab.connect(cab2); cab2.connect(out);
      let last = '';
      const set = (q) => {
        const key = q.model + q.gain.toFixed(3);
        if (key !== last) { last = key; const base = { clean: 1.2, crunch: 4, lead: 9, metal: 22 }[q.model]; const k = base * (0.4 + q.gain * 1.6), asym = q.model === 'clean' ? 0 : 0.08; pre.curve = curve((x) => Math.tanh(k * (x + asym)) - Math.tanh(k * asym), 4096); }
        hp.frequency.value = q.model === 'metal' ? 140 : 70; setp(ctx, b.gain, q.bass); setp(ctx, m.gain, q.mid); setp(ctx, t.gain, q.treble); setp(ctx, pr.gain, q.presence * 10 - 4);
        cab.frequency.value = q.cab === 'on' ? 4800 : 20000; cab2.gain.value = q.cab === 'on' ? 3 : 0; setp(ctx, out.gain, dbToGain(q.level) * (q.model === 'clean' ? 1 : 0.55));
      };
      set(p);
      return { input: hp, output: out, set, destroy: () => kill([hp, pre, b, m, t, pr, cab, cab2, out]) };
    },
  },
  widener: {
    name: 'Stereo Width', icon: 'sliders',
    params: { width: num('Width', 0, 2, 1.3) },
    create(ctx, p) {
      const input = ctx.createGain(), split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
      const mid = ctx.createGain(), side = ctx.createGain(), sideNeg = ctx.createGain(), mL = ctx.createGain(), mR = ctx.createGain(), sR = ctx.createGain(), nR = ctx.createGain();
      input.channelCount = 2; input.channelCountMode = 'explicit';
      input.connect(split);
      mid.gain.value = 0.5; split.connect(mid, 0); split.connect(mid, 1);
      const sA = ctx.createGain(), sB = ctx.createGain(); sA.gain.value = 0.5; sB.gain.value = -0.5; split.connect(sA, 0); split.connect(sB, 1); sA.connect(side); sB.connect(side);
      sideNeg.gain.value = -1; side.connect(sideNeg);
      mid.connect(merge, 0, 0); mid.connect(merge, 0, 1); side.connect(merge, 0, 0); sideNeg.connect(merge, 0, 1);
      const set = (q) => { side.gain.value = q.width; sideNeg.gain.value = -q.width; };
      set(p);
      return { input, output: merge, set, destroy: () => kill([input, split, merge, mid, side, sideNeg, sA, sB, mL, mR, sR, nR]) };
    },
  },
  gate: {
    name: 'Noise Gate', icon: 'sliders', worklet: true,
    params: { threshold: num('Threshold', -80, -10, -48, { unit: ' dB' }), release: num('Release', 0.02, 1, 0.15, { unit: ' s' }) },
    create(ctx, p, env) {
      if (!env.worklets) { const g = ctx.createGain(); return { input: g, output: g, set() {}, destroy: () => kill([g]) }; }
      const n = new AudioWorkletNode(ctx, 'bandy-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      const set = (q) => n.port.postMessage({ threshold: q.threshold, release: q.release });
      set(p);
      return { input: n, output: n, set, destroy: () => kill([n]) };
    },
  },
  pitch: {
    name: 'Pitch Shift', icon: 'fx', worklet: true,
    params: { semitones: num('Semitones', -24, 24, 0, { step: 1 }), cents: num('Fine', -100, 100, 0, { step: 1, unit: ' c' }), mix: num('Mix', 0, 1, 1) },
    create(ctx, p, env) {
      const w = wetDry(ctx);
      if (!env.worklets) return { input: w.input, output: w.output, set() {}, destroy: () => kill([w.input, w.output]) };
      const n = new AudioWorkletNode(ctx, 'bandy-pitch', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      w.input.connect(n); n.connect(w.wet);
      const set = (q) => { n.parameters.get('ratio').setValueAtTime(Math.pow(2, (q.semitones + q.cents / 100) / 12), ctx.currentTime); w.setMix(q.mix); };
      set(p);
      return { input: w.input, output: w.output, set, destroy: () => kill([w.input, w.output, w.dry, w.wet, n]) };
    },
  },
  autopitch: {
    name: 'Auto-Pitch', icon: 'tuner', worklet: true,
    params: { key: sel('Key', ['project', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'], 'project'), scale: sel('Scale', ['major', 'minor', 'chromatic', 'pentatonic', 'minor pentatonic', 'blues'], 'major'), speed: num('Retune', 0, 1, 0.2), amount: num('Amount', 0, 1, 1), mix: num('Mix', 0, 1, 1) },
    create(ctx, p, env) {
      const w = wetDry(ctx);
      if (!env.worklets) return { input: w.input, output: w.output, set() {}, destroy: () => kill([w.input, w.output]) };
      const n = new AudioWorkletNode(ctx, 'bandy-pitch', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { auto: true } });
      w.input.connect(n); n.connect(w.wet);
      const set = (q) => {
        const keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const root = q.key === 'project' ? env.getKey?.() ?? 0 : keys.indexOf(q.key);
        n.port.postMessage({ auto: true, mask: SCALES[q.scale] || SCALES.major, root: root < 0 ? 0 : root, speed: 1 - q.speed, amount: q.amount });
        w.setMix(q.mix);
      };
      set(p);
      return { input: w.input, output: w.output, set, destroy: () => kill([w.input, w.output, w.dry, w.wet, n]) };
    },
  },
  limiter: {
    name: 'Limiter', icon: 'sliders',
    params: { ceiling: num('Ceiling', -12, 0, -1, { unit: ' dB' }), release: num('Release', 0.01, 0.5, 0.08, { unit: ' s' }) },
    create(ctx, p) {
      const c = ctx.createDynamicsCompressor(); c.knee.value = 0; c.ratio.value = 20; c.attack.value = 0.002;
      const set = (q) => { c.threshold.value = q.ceiling; c.release.value = q.release; };
      set(p);
      return { input: c, output: c, set, destroy: () => kill([c]) };
    },
  },
};

export const FX_LIST = ['eq', 'compressor', 'reverb', 'delay', 'distortion', 'amp', 'chorus', 'flanger', 'phaser', 'filter', 'tremolo', 'bitcrusher', 'widener', 'gate', 'pitch', 'autopitch'];

export function defaultParams(type) { const o = {}; for (const [k, d] of Object.entries(FX[type].params)) o[k] = d.def; return o; }
export function createFx(ctx, type, params, env) { return FX[type].create(ctx, { ...defaultParams(type), ...params }, env); }

// Presets: [category, name, chain]
const c = (type, params = {}) => ({ type, params });
export const FX_PRESETS = [
  // Vocals
  ['Vocal', 'Clean Vocal', [c('gate', { threshold: -52 }), c('eq', { lowcut: 90, mid: 2, high: 3, low: -2 }), c('compressor', { threshold: -20, ratio: 3, makeup: 3 }), c('reverb', { size: 1.2, mix: 0.12 })]],
  ['Vocal', 'Warm Vocal', [c('eq', { lowcut: 80, low: 3, high: -1, mid: 1 }), c('compressor', { threshold: -22, ratio: 4 }), c('reverb', { size: 1.6, damp: 0.7, mix: 0.18 })]],
  ['Vocal', 'Modern Rap', [c('gate', {}), c('eq', { lowcut: 110, mid: 1.5, midfreq: 2500, high: 4 }), c('compressor', { threshold: -26, ratio: 6, makeup: 5 }), c('delay', { time: '1/8', feedback: 0.22, mix: 0.18 }), c('reverb', { size: 0.9, mix: 0.1 })]],
  ['Vocal', 'Auto-Tune Pop', [c('autopitch', { speed: 0.9, scale: 'major' }), c('eq', { lowcut: 100, high: 3 }), c('compressor', { ratio: 4 }), c('reverb', { size: 1.5, mix: 0.2 })]],
  ['Vocal', 'Hard Tune', [c('autopitch', { speed: 1, scale: 'minor' }), c('compressor', { ratio: 5 }), c('delay', { time: '1/4d', mix: 0.18 })]],
  ['Vocal', 'Big Harmony', [c('pitch', { semitones: 4, mix: 0.45 }), c('pitch', { semitones: 7, mix: 0.35 }), c('chorus', { mix: 0.35 }), c('reverb', { size: 2.4, mix: 0.3 })]],
  ['Vocal', 'Duet', [c('pitch', { semitones: -5, cents: 6, mix: 0.5 }), c('chorus', { depth: 0.3, mix: 0.25 }), c('reverb', { size: 1.4, mix: 0.18 })]],
  ['Vocal', 'Octave Down', [c('pitch', { semitones: -12, mix: 0.6 }), c('eq', { low: 4 })]],
  ['Vocal', 'Chipmunk', [c('pitch', { semitones: 9, mix: 1 }), c('eq', { lowcut: 200, high: 3 })]],
  ['Vocal', 'Robot', [c('pitch', { semitones: -3, mix: 1 }), c('flanger', { rate: 0.1, feedback: 0.8, depth: 1, mix: 0.7 }), c('bitcrusher', { bits: 7, mix: 0.4 })]],
  ['Vocal', 'Telephone', [c('filter', { type: 'bandpass', freq: 1500, q: 1.2 }), c('distortion', { type: 'soft', drive: 0.25, level: -2 }), c('eq', { mid: 6, midfreq: 1800 })]],
  ['Vocal', 'Radio Voice', [c('eq', { lowcut: 280, high: -4, mid: 4, midfreq: 2200 }), c('compressor', { ratio: 8, threshold: -26, makeup: 6 }), c('distortion', { drive: 0.15, level: -1 })]],
  ['Vocal', 'Slapback', [c('delay', { time: '1/16', feedback: 0.1, mix: 0.3, tone: 3500 }), c('eq', { lowcut: 90 })]],
  ['Vocal', 'Dreamy', [c('chorus', { rate: 0.3, depth: 0.7, mix: 0.4 }), c('delay', { time: '1/4d', feedback: 0.5, mix: 0.3 }), c('reverb', { size: 4, damp: 0.6, mix: 0.5 })]],
  ['Vocal', 'Voice Cleaner', [c('gate', { threshold: -42 }), c('eq', { lowcut: 120, low: -2, mid: 1.5, high: 2 }), c('compressor', { ratio: 3 })]],
  // Guitar
  ['Guitar', 'Clean Amp', [c('amp', { model: 'clean', gain: 0.3, treble: 1 }), c('reverb', { size: 1.2, mix: 0.15 })]],
  ['Guitar', 'Crunch', [c('amp', { model: 'crunch', gain: 0.55 }), c('reverb', { size: 0.8, mix: 0.1 })]],
  ['Guitar', 'Blues Lead', [c('amp', { model: 'crunch', gain: 0.75, mid: 3 }), c('delay', { time: '1/8d', feedback: 0.3, mix: 0.2 }), c('reverb', { size: 1.5, mix: 0.2 })]],
  ['Guitar', 'Hard Rock', [c('amp', { model: 'lead', gain: 0.6, mid: 2 }), c('reverb', { size: 0.9, mix: 0.1 })]],
  ['Guitar', 'Metal', [c('gate', { threshold: -45 }), c('amp', { model: 'metal', gain: 0.65, bass: 2, treble: 2, mid: -3 })]],
  ['Guitar', 'Funk Chorus', [c('amp', { model: 'clean', gain: 0.4 }), c('chorus', { rate: 1.2, depth: 0.6, mix: 0.5 }), c('compressor', { ratio: 5 })]],
  ['Guitar', 'Surf Reverb', [c('amp', { model: 'clean', gain: 0.35, treble: 3 }), c('tremolo', { rate: 6, depth: 0.5 }), c('reverb', { size: 3, mix: 0.45 })]],
  ['Guitar', 'Ambient Swell', [c('amp', { model: 'clean', gain: 0.4 }), c('delay', { time: '1/4d', feedback: 0.6, mix: 0.4 }), c('reverb', { size: 5, damp: 0.5, mix: 0.55 })]],
  ['Guitar', 'Phase 90', [c('amp', { model: 'crunch', gain: 0.4 }), c('phaser', { rate: 0.5, depth: 0.8, mix: 0.6 })]],
  // Bass
  ['Bass', 'Clean DI', [c('compressor', { ratio: 4, threshold: -20 }), c('eq', { low: 2, high: 1 })]],
  ['Bass', 'Bass Boost', [c('eq', { low: 8, lowcut: 30, high: -2 }), c('compressor', { ratio: 5, makeup: 4 })]],
  ['Bass', 'Fuzz Bass', [c('distortion', { type: 'fuzz', drive: 0.7, mix: 0.7, level: -6 }), c('eq', { lowcut: 40, low: 4 })]],
  ['Bass', 'Amp Grind', [c('amp', { model: 'crunch', gain: 0.5, bass: 4, cab: 'on' }), c('compressor', { ratio: 4 })]],
  ['Bass', 'Tight Funk', [c('compressor', { ratio: 8, threshold: -26, attack: 0.02, makeup: 6 }), c('eq', { mid: 3, midfreq: 900 })]],
  // Instruments / Drums
  ['Drums', 'Punchy Drums', [c('compressor', { ratio: 5, attack: 0.025, threshold: -18, makeup: 4 }), c('eq', { low: 2, high: 2 })]],
  ['Drums', 'Lo-Fi Drums', [c('bitcrusher', { bits: 9, mix: 0.6 }), c('filter', { freq: 7000 }), c('compressor', { ratio: 4 })]],
  ['Drums', 'Room Kit', [c('compressor', { ratio: 4 }), c('reverb', { size: 1.1, damp: 0.4, mix: 0.28 })]],
  ['Drums', 'Crushed', [c('distortion', { type: 'hard', drive: 0.5, mix: 0.5 }), c('compressor', { ratio: 10, makeup: 6 })]],
  ['Synth', 'Wide Chorus', [c('chorus', { depth: 0.7, mix: 0.5 }), c('widener', { width: 1.5 })]],
  ['Synth', 'Dub Delay', [c('delay', { time: '1/4d', feedback: 0.65, mix: 0.4, tone: 2500 }), c('reverb', { size: 2.5, mix: 0.25 })]],
  ['Synth', 'Wobble Filter', [c('filter', { type: 'lowpass', freq: 900, q: 6, lfoRate: 2, lfoDepth: 0.8 })]],
  ['Synth', 'Space Pad', [c('chorus', { mix: 0.4 }), c('reverb', { size: 5, damp: 0.5, mix: 0.5 }), c('widener', { width: 1.6 })]],
  ['Synth', 'Sidechain Pump', [c('tremolo', { rate: 2, depth: 0.7 }), c('compressor', { ratio: 3 })]],
  ['Creative', 'Underwater', [c('filter', { type: 'lowpass', freq: 700, q: 2, lfoRate: 0.4, lfoDepth: 0.6 }), c('chorus', { rate: 0.5, depth: 0.9, mix: 0.6 })]],
  ['Creative', 'Vinyl Lo-Fi', [c('bitcrusher', { bits: 10, mix: 0.5 }), c('eq', { lowcut: 90, high: -8, mid: 2 }), c('chorus', { rate: 0.3, depth: 0.3, mix: 0.3 })]],
  ['Creative', 'Warm Tape', [c('distortion', { type: 'soft', drive: 0.15, level: 0, tone: 7000 }), c('eq', { low: 2, high: -3 }), c('chorus', { rate: 0.4, depth: 0.15, mix: 0.2 })]],
  ['Creative', 'Cathedral', [c('reverb', { size: 6, damp: 0.4, mix: 0.6, predelay: 0.05 })]],
  ['Creative', 'Phaser Jet', [c('phaser', { rate: 0.2, depth: 1, feedback: 0.7, mix: 0.7 }), c('flanger', { rate: 0.1, mix: 0.4 })]],
];

// Master "mastering" presets
export const MASTER_PRESETS = {
  Off: null,
  Universal: [c('eq', { low: 1.5, high: 2, lowcut: 25 }), c('compressor', { threshold: -16, ratio: 2.5, makeup: 2, attack: 0.02 }), c('limiter', { ceiling: -0.8 })],
  Tape: [c('distortion', { type: 'soft', drive: 0.12, level: 1, tone: 9000 }), c('eq', { low: 2, high: -2 }), c('compressor', { threshold: -14, ratio: 2, makeup: 2 }), c('limiter', { ceiling: -1 })],
  Punchy: [c('eq', { low: 2, mid: 1, midfreq: 3000, high: 1 }), c('compressor', { threshold: -20, ratio: 4, attack: 0.03, makeup: 4 }), c('limiter', { ceiling: -0.6 })],
  Clarity: [c('eq', { lowcut: 35, low: -1, mid: -1, midfreq: 400, high: 3.5 }), c('compressor', { threshold: -14, ratio: 2, makeup: 1.5 }), c('widener', { width: 1.15 }), c('limiter', { ceiling: -0.8 })],
  Warm: [c('eq', { low: 3, high: -2.5, lowcut: 25 }), c('distortion', { type: 'soft', drive: 0.1, level: 0.5, tone: 7000 }), c('compressor', { threshold: -15, ratio: 2.5, makeup: 2 }), c('limiter', { ceiling: -1 })],
  Loud: [c('eq', { low: 2.5, high: 2.5 }), c('compressor', { threshold: -24, ratio: 6, attack: 0.01, makeup: 7 }), c('limiter', { ceiling: -0.3, release: 0.05 })],
};
