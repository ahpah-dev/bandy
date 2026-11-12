// Built-in instruments: polyphonic synth voices, synthesised drum kits and metronome.
import { midiToFreq } from '../util.js';

// osc layers: [type, detuneCents, gain, octaveOffset]
export const INSTRUMENTS = [
  { id: 'grand', name: 'Grand Piano', cat: 'Keys', osc: [['triangle', 0, 0.8, 0], ['sine', 2, 0.5, 1], ['sine', 0, 0.18, 2]], env: [0.003, 1.6, 0, 0.35], filter: { type: 'lowpass', freq: 3800, q: 0.5, track: 1.2, amt: 2600, decay: 0.5 }, gain: 0.85 },
  { id: 'epiano', name: 'Electric Piano', cat: 'Keys', osc: [['sine', 0, 0.9, 0], ['sine', 3, 0.3, 2], ['triangle', -3, 0.3, 0]], env: [0.004, 1.4, 0.05, 0.4], filter: { type: 'lowpass', freq: 3000, q: 0.6, amt: 1500, decay: 0.3 }, gain: 0.9, trem: [4.5, 0.12] },
  { id: 'organ', name: 'Drawbar Organ', cat: 'Keys', osc: [['sine', 0, 0.7, 0], ['sine', 0, 0.55, 1], ['sine', 0, 0.35, 1.585], ['sine', 0, 0.3, 2]], env: [0.01, 0.05, 1, 0.08], filter: { type: 'lowpass', freq: 6000, q: 0.4 }, gain: 0.6, trem: [6, 0.08] },
  { id: 'clav', name: 'Funk Clav', cat: 'Keys', osc: [['square', 0, 0.5, 0], ['sawtooth', 5, 0.4, 0]], env: [0.002, 0.25, 0, 0.08], filter: { type: 'bandpass', freq: 2200, q: 1.5, amt: 2000, decay: 0.12 }, gain: 0.8 },
  { id: 'bell', name: 'Glass Bell', cat: 'Keys', osc: [['sine', 0, 0.7, 0], ['sine', 0, 0.35, 2.76], ['sine', 0, 0.2, 5.4]], env: [0.002, 2.2, 0, 0.8], filter: { type: 'lowpass', freq: 9000, q: 0.3 }, gain: 0.8 },
  { id: 'marimba', name: 'Marimba', cat: 'Keys', osc: [['sine', 0, 0.9, 0], ['sine', 0, 0.25, 3.9]], env: [0.002, 0.45, 0, 0.12], filter: { type: 'lowpass', freq: 4000, q: 0.5 }, gain: 1 },
  { id: 'pad', name: 'Warm Pad', cat: 'Pads', osc: [['sawtooth', -9, 0.35, 0], ['sawtooth', 9, 0.35, 0], ['triangle', 0, 0.4, -1]], env: [0.7, 0.5, 0.8, 1.2], filter: { type: 'lowpass', freq: 1400, q: 0.7 }, gain: 0.55 },
  { id: 'strings', name: 'String Ensemble', cat: 'Pads', osc: [['sawtooth', -12, 0.3, 0], ['sawtooth', 0, 0.3, 0], ['sawtooth', 12, 0.3, 0]], env: [0.35, 0.3, 0.85, 0.5], filter: { type: 'lowpass', freq: 2600, q: 0.5 }, gain: 0.5, vib: [5.2, 6] },
  { id: 'choir', name: 'Choir Ahh', cat: 'Pads', osc: [['sawtooth', -6, 0.3, 0], ['triangle', 6, 0.4, 0], ['sine', 0, 0.3, 1]], env: [0.5, 0.4, 0.8, 0.9], filter: { type: 'bandpass', freq: 900, q: 0.9 }, gain: 0.9, vib: [5, 8] },
  { id: 'glass', name: 'Glass Pad', cat: 'Pads', osc: [['sine', 0, 0.5, 0], ['sine', 7, 0.35, 1], ['triangle', -7, 0.25, 2]], env: [1.0, 0.5, 0.8, 1.6], filter: { type: 'lowpass', freq: 5000, q: 0.5 }, gain: 0.7, vib: [3.5, 4] },
  { id: 'saw', name: 'Saw Lead', cat: 'Leads', osc: [['sawtooth', -6, 0.5, 0], ['sawtooth', 6, 0.5, 0]], env: [0.01, 0.2, 0.7, 0.2], filter: { type: 'lowpass', freq: 2600, q: 2, amt: 2500, decay: 0.25 }, gain: 0.6, vib: [5.5, 5] },
  { id: 'square', name: 'Square Lead', cat: 'Leads', osc: [['square', 0, 0.5, 0], ['square', 7, 0.3, 1]], env: [0.005, 0.1, 0.75, 0.15], filter: { type: 'lowpass', freq: 3500, q: 1.2 }, gain: 0.5, vib: [5.5, 6] },
  { id: 'super', name: 'Super Saw', cat: 'Leads', osc: [['sawtooth', -22, 0.22, 0], ['sawtooth', -11, 0.22, 0], ['sawtooth', 0, 0.22, 0], ['sawtooth', 11, 0.22, 0], ['sawtooth', 22, 0.22, 0]], env: [0.01, 0.3, 0.7, 0.25], filter: { type: 'lowpass', freq: 5200, q: 0.8 }, gain: 0.6 },
  { id: 'chip', name: 'Chiptune', cat: 'Leads', osc: [['square', 0, 0.6, 0]], env: [0.001, 0.05, 0.8, 0.04], filter: { type: 'lowpass', freq: 9000, q: 0.1 }, gain: 0.4, vib: [6, 10] },
  { id: 'pluck', name: 'Synth Pluck', cat: 'Leads', osc: [['sawtooth', -5, 0.5, 0], ['square', 5, 0.3, 0]], env: [0.002, 0.28, 0, 0.12], filter: { type: 'lowpass', freq: 600, q: 3, amt: 5000, decay: 0.18 }, gain: 0.7 },
  { id: 'brass', name: 'Brass Section', cat: 'Leads', osc: [['sawtooth', -4, 0.5, 0], ['sawtooth', 4, 0.5, 0]], env: [0.06, 0.2, 0.75, 0.15], filter: { type: 'lowpass', freq: 800, q: 1, amt: 3500, decay: 0.25 }, gain: 0.6 },
  { id: 'flute', name: 'Soft Flute', cat: 'Leads', osc: [['sine', 0, 0.8, 0], ['triangle', 0, 0.2, 1]], env: [0.08, 0.1, 0.85, 0.15], filter: { type: 'lowpass', freq: 5000, q: 0.3 }, gain: 0.85, vib: [5, 9], breath: 0.03 },
  { id: 'synbass', name: 'Synth Bass', cat: 'Bass', osc: [['sawtooth', 0, 0.55, 0], ['square', 0, 0.35, -1]], env: [0.004, 0.2, 0.55, 0.1], filter: { type: 'lowpass', freq: 500, q: 3, amt: 1800, decay: 0.18 }, gain: 0.7 },
  { id: 'sub', name: 'Sub Bass', cat: 'Bass', osc: [['sine', 0, 1, 0], ['triangle', 0, 0.15, 1]], env: [0.01, 0.1, 0.9, 0.1], filter: { type: 'lowpass', freq: 400, q: 0.3 }, gain: 1 },
  { id: 'b808', name: '808 Bass', cat: 'Bass', osc: [['sine', 0, 1, 0]], env: [0.003, 1.4, 0.0, 0.25], filter: { type: 'lowpass', freq: 700, q: 0.3 }, gain: 1.2, glide: 0.06, drive: 2.2 },
  { id: 'acid', name: 'Acid Bass', cat: 'Bass', osc: [['sawtooth', 0, 0.8, 0]], env: [0.002, 0.18, 0.3, 0.06], filter: { type: 'lowpass', freq: 300, q: 12, amt: 3200, decay: 0.2 }, gain: 0.55 },
  { id: 'upright', name: 'Upright Bass', cat: 'Bass', osc: [['triangle', 0, 0.8, 0], ['sine', 0, 0.5, 1]], env: [0.01, 0.5, 0.12, 0.15], filter: { type: 'lowpass', freq: 900, q: 0.6, amt: 700, decay: 0.2 }, gain: 1 },
];
export const INST_BY_ID = Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i]));

// ---- Drum kits ----
export const DRUM_MAP = [
  { note: 36, name: 'Kick', key: 'kick' }, { note: 38, name: 'Snare', key: 'snare' }, { note: 39, name: 'Clap', key: 'clap' }, { note: 37, name: 'Rim', key: 'rim' },
  { note: 42, name: 'Closed Hat', key: 'chh' }, { note: 46, name: 'Open Hat', key: 'ohh' }, { note: 41, name: 'Low Tom', key: 'tomL' }, { note: 45, name: 'Mid Tom', key: 'tomM' },
  { note: 48, name: 'High Tom', key: 'tomH' }, { note: 49, name: 'Crash', key: 'crash' }, { note: 51, name: 'Ride', key: 'ride' }, { note: 56, name: 'Cowbell', key: 'cow' }, { note: 70, name: 'Shaker', key: 'shk' },
];
const NOTE_TO_KEY = Object.fromEntries(DRUM_MAP.map((d) => [d.note, d.key]));
export const KITS = [
  { id: '808', name: '808 Classic', kick: { f0: 160, f1: 42, d: 0.9, click: 0.2, drive: 0.4 }, snare: { f: 190, tone: 0.5, noise: 0.8, d: 0.22, hp: 1500 }, hat: { hp: 7500, d: 0.05, od: 0.35 }, clap: { d: 0.25 }, tom: 1, crash: 1.2 },
  { id: 'acoustic', name: 'Studio Acoustic', kick: { f0: 130, f1: 55, d: 0.32, click: 0.6, drive: 0.15 }, snare: { f: 220, tone: 0.55, noise: 1, d: 0.2, hp: 1800 }, hat: { hp: 8000, d: 0.04, od: 0.28 }, clap: { d: 0.18 }, tom: 1.4, crash: 1.6 },
  { id: 'trap', name: 'Trap Kit', kick: { f0: 190, f1: 38, d: 1.4, click: 0.1, drive: 0.7 }, snare: { f: 200, tone: 0.2, noise: 0.9, d: 0.16, hp: 2500 }, hat: { hp: 9500, d: 0.03, od: 0.2 }, clap: { d: 0.2 }, tom: 0.8, crash: 0.9 },
  { id: 'lofi', name: 'Lo-Fi Dust', kick: { f0: 120, f1: 50, d: 0.4, click: 0.1, drive: 0.5 }, snare: { f: 180, tone: 0.6, noise: 0.6, d: 0.19, hp: 1200 }, hat: { hp: 6000, d: 0.045, od: 0.25 }, clap: { d: 0.2 }, tom: 1, crash: 1, lp: 6500 },
  { id: 'house', name: 'House Machine', kick: { f0: 170, f1: 48, d: 0.45, click: 0.5, drive: 0.5 }, snare: { f: 210, tone: 0.3, noise: 1, d: 0.2, hp: 2200 }, hat: { hp: 8500, d: 0.045, od: 0.4 }, clap: { d: 0.3 }, tom: 1.2, crash: 1.4 },
];
export const KIT_BY_ID = Object.fromEntries(KITS.map((k) => [k.id, k]));

const noiseCache = new WeakMap();
export function noiseBuf(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) { b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; noiseCache.set(ctx, b); }
  return b;
}
function noise(ctx, out, t, dur, { hp = 0, lp = 0, bp = 0, q = 1, gain = 1, a = 0.001, shape = 3 } = {}) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf(ctx); s.loop = true;
  const g = ctx.createGain(); let node = s;
  const chain = [];
  if (hp) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; chain.push(f); }
  if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; chain.push(f); }
  if (bp) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = bp; f.Q.value = q; chain.push(f); }
  for (const f of chain) { node.connect(f); node = f; }
  node.connect(g); g.connect(out);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + a);
  g.gain.setTargetAtTime(0, t + a, dur / shape);
  s.start(t, Math.random()); s.stop(t + dur * 1.6 + 0.05);
}
function tone(ctx, out, t, f0, f1, dur, gain, type = 'sine', drive = 0) {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + Math.min(dur * 0.35, 0.12));
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.002); g.gain.setTargetAtTime(0, t + 0.002, dur / 4);
  let node = o;
  if (drive) { const ws = ctx.createWaveShaper(); const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = (i / 511.5) - 1; c[i] = Math.tanh(x * (1 + drive * 3)); } ws.curve = c; o.connect(ws); node = ws; }
  node.connect(g); g.connect(out); o.start(t); o.stop(t + dur * 1.6 + 0.05);
}

export function playDrum(ctx, out, kitId, note, t, vel = 100) {
  const k = KIT_BY_ID[kitId] || KITS[0], key = NOTE_TO_KEY[note] || nearestKey(note), v = Math.pow(vel / 127, 1.3);
  let dst = out;
  if (k.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = k.lp; f.connect(out); dst = f; setTimeout(() => f.disconnect(), 2500); }
  switch (key) {
    case 'kick': { const c = k.kick; tone(ctx, dst, t, c.f0, c.f1, c.d, 1.0 * v, 'sine', c.drive); noise(ctx, dst, t, 0.02, { hp: 1800, gain: c.click * v * 0.8, shape: 4 }); break; }
    case 'snare': { const c = k.snare; tone(ctx, dst, t, c.f * 1.3, c.f * 0.9, c.d * 0.6, c.tone * v * 0.8, 'triangle'); noise(ctx, dst, t, c.d, { hp: c.hp, gain: c.noise * v * 0.9, a: 0.001 }); break; }
    case 'clap': { for (let i = 0; i < 4; i++) noise(ctx, dst, t + i * 0.011, i === 3 ? k.clap.d : 0.03, { bp: 1500, q: 0.9, gain: 0.7 * v, shape: 3 }); break; }
    case 'rim': tone(ctx, dst, t, 520, 480, 0.05, 0.6 * v, 'square'); noise(ctx, dst, t, 0.03, { hp: 3000, gain: 0.5 * v }); break;
    case 'chh': noise(ctx, dst, t, k.hat.d, { hp: k.hat.hp, gain: k.hat.od * v, shape: 4 }); break;
    case 'ohh': noise(ctx, dst, t, k.hat.d * 6, { hp: k.hat.hp * 0.9, gain: k.hat.od * v * 0.9, shape: 3 }); break;
    case 'tomL': tone(ctx, dst, t, 150 * k.tom, 90, 0.4, 0.9 * v, 'sine', 0.2); break;
    case 'tomM': tone(ctx, dst, t, 210 * k.tom, 130, 0.35, 0.9 * v, 'sine', 0.2); break;
    case 'tomH': tone(ctx, dst, t, 290 * k.tom, 190, 0.3, 0.9 * v, 'sine', 0.2); break;
    case 'crash': noise(ctx, dst, t, 1.4 * k.crash, { hp: 4500, gain: 0.5 * v, shape: 3, a: 0.003 }); break;
    case 'ride': noise(ctx, dst, t, 0.9, { hp: 7000, gain: 0.25 * v, shape: 3 }); tone(ctx, dst, t, 5200, 5200, 0.5, 0.06 * v, 'square'); break;
    case 'cow': tone(ctx, dst, t, 800, 780, 0.18, 0.4 * v, 'square'); tone(ctx, dst, t, 540, 530, 0.2, 0.4 * v, 'square'); break;
    case 'shk': noise(ctx, dst, t, 0.07, { hp: 6500, gain: 0.35 * v, a: 0.02, shape: 3 }); break;
  }
}
function nearestKey(note) { let best = DRUM_MAP[0], bd = 99; for (const d of DRUM_MAP) if (Math.abs(d.note - note) < bd) { bd = Math.abs(d.note - note); best = d; } return best.key; }

// ---- Synth voice ----
// Returns { release(time) } and schedules everything on the audio clock.
export function startVoice(ctx, out, inst, t, note, vel = 100) {
  const f0 = midiToFreq(note), peak = Math.pow(vel / 127, 1.15) * inst.gain * 0.5;
  const [a, d, s, r] = inst.env;
  const env = ctx.createGain(); env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + Math.max(0.001, a));
  if (s < 1) env.gain.setTargetAtTime(peak * s, t + a, Math.max(0.01, d) / 3);
  let tail = env;
  const nodes = [];
  if (inst.filter) {
    const f = ctx.createBiquadFilter(); f.type = inst.filter.type; f.Q.value = inst.filter.q || 0.7;
    const base = inst.filter.freq * (inst.filter.track ? Math.pow(2, (note - 60) / 12 * inst.filter.track * 0.5) : 1);
    if (inst.filter.amt) { f.frequency.setValueAtTime(Math.min(18000, base + inst.filter.amt), t); f.frequency.setTargetAtTime(base, t, (inst.filter.decay || 0.2) / 3); } else f.frequency.value = Math.min(18000, base);
    env.connect(f); tail = f; nodes.push(f);
  }
  if (inst.drive) { const ws = ctx.createWaveShaper(), c = new Float32Array(1024); for (let i = 0; i < 1024; i++) c[i] = Math.tanh(((i / 511.5) - 1) * inst.drive); ws.curve = c; tail.connect(ws); tail = ws; nodes.push(ws); }
  tail.connect(out);
  const oscs = [];
  let lfo = null, lfoG = null;
  if (inst.vib) { lfo = ctx.createOscillator(); lfo.frequency.value = inst.vib[0]; lfoG = ctx.createGain(); lfoG.gain.setValueAtTime(0, t); lfoG.gain.linearRampToValueAtTime(inst.vib[1], t + 0.4); lfo.connect(lfoG); lfo.start(t); }
  if (inst.trem) { const tl = ctx.createOscillator(), tg = ctx.createGain(); tl.frequency.value = inst.trem[0]; tg.gain.value = inst.trem[1] * peak; tl.connect(tg); tg.connect(env.gain); tl.start(t); oscs.push(tl); }
  for (const [type, det, g, oct] of inst.osc) {
    const o = ctx.createOscillator(); o.type = type;
    const freq = f0 * Math.pow(2, oct);
    if (inst.glide) { o.frequency.setValueAtTime(freq * 1.5, t); o.frequency.exponentialRampToValueAtTime(freq, t + inst.glide); } else o.frequency.value = freq;
    o.detune.value = det + (Math.random() - 0.5) * 3;
    if (lfoG) lfoG.connect(o.detune);
    const og = ctx.createGain(); og.gain.value = g; o.connect(og); og.connect(env); o.start(t); oscs.push(o);
  }
  if (inst.breath) noise(ctx, env, t, 0.4, { bp: f0 * 2, q: 2, gain: inst.breath, shape: 1 });
  let released = false;
  return {
    release(when) {
      if (released) return; released = true;
      const end = Math.max(when, t + 0.01), dt = end - t;
      const lvl = dt < a ? peak * (dt / Math.max(a, 1e-4)) : peak * (s + (1 - s) * Math.exp(-(dt - a) / (Math.max(0.01, d) / 3)));
      env.gain.cancelScheduledValues(end);
      env.gain.setValueAtTime(lvl, end);
      env.gain.setTargetAtTime(0, end, Math.max(0.01, r) / 4);
      const stopAt = end + Math.max(0.05, r) * 1.3 + 0.1;
      for (const o of oscs) o.stop(stopAt);
      if (lfo) lfo.stop(stopAt);
      setTimeout(() => { try { env.disconnect(); nodes.forEach((n) => n.disconnect()); } catch {} }, (stopAt - ctx.currentTime + 0.3) * 1000);
    },
  };
}

export function clickSound(ctx, out, t, accent, vol = 0.5) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'square'; o.frequency.value = accent ? 1760 : 1175;
  g.gain.setValueAtTime(vol * (accent ? 0.5 : 0.32), t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.05);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.06);
}
