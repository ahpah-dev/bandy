import { FX_LIST, FX_PRESETS, MASTER_PRESETS, createFx } from '../js/audio/effects.js';
import { INSTRUMENTS, KITS, DRUM_MAP, startVoice, playDrum, sanitizeInstrument, registerInstrument, unregisterInstrument, listCustomInstruments, getInstrument } from '../js/audio/synth.js';
import { loadWorklets } from '../js/audio/engine.js';
import { LOOPS, buildLoop } from '../js/audio/loops.js';
import { stretchBuffer, encodeWav } from '../js/audio/dsp.js';
import { zip, unzip } from '../js/zip.js';
import { swingDelay } from '../js/audio/engine.js';

const out = document.getElementById('out');
let fails = 0, total = 0;
const log = (ok, msg) => { total++; if (!ok) fails++; out.innerHTML += `\n<span class="${ok ? 'ok' : 'bad'}">${ok ? 'PASS' : 'FAIL'}</span> ${msg}`; };
out.textContent = '';

const stats = (buf) => { const d = buf.getChannelData(0); let pk = 0, bad = 0; for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (!Number.isFinite(a)) bad++; else if (a > pk) pk = a; } return { pk, bad }; };

async function chain(spec) {
  const off = new OfflineAudioContext(2, 44100, 44100), worklets = await loadWorklets(off);
  const osc = off.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 220; osc.start();
  const g = off.createGain(); g.gain.value = 0.3; osc.connect(g);
  let last = g;
  for (const c of spec) { const fx = createFx(off, c.type, c.params, { worklets, getKey: () => 0 }); fx.tempo?.(100); last.connect(fx.input); last = fx.output; }
  last.connect(off.destination);
  return stats(await off.startRendering());
}
const voice = async (fn) => { const off = new OfflineAudioContext(2, 66150, 44100), o = off.createGain(); o.connect(off.destination); fn(off, o); return stats(await off.startRendering()); };

for (const t of FX_LIST) { const s = await chain([{ type: t, params: {} }]); log(!s.bad && s.pk > 0.001, `effect ${t} (peak ${s.pk.toFixed(2)})`); }
for (const [, name, c] of FX_PRESETS) { const s = await chain(c); log(!s.bad && s.pk > 0.001, `preset ${name}`); }
for (const [name, c] of Object.entries(MASTER_PRESETS)) if (c) { const s = await chain(c); log(!s.bad && s.pk > 0.001, `mastering ${name}`); }
for (const i of INSTRUMENTS) { const s = await voice((o, out) => startVoice(o, out, i, 0, i.cat === 'Bass' ? 40 : 60, 100).release(0.6)); log(!s.bad && s.pk > 0.01, `instrument ${i.name}`); }
for (const k of KITS) for (const d of DRUM_MAP) { const s = await voice((o, out) => playDrum(o, out, k.id, d.note, 0, 100)); log(!s.bad && s.pk > 0.01, `drum ${k.id}/${d.name}`); }
for (const l of LOOPS) { const n = buildLoop(l, 3); log(n.length > 0 && n.every((x) => Number.isFinite(x.p) && x.s >= 0 && x.l > 0), `loop ${l.name}`); }

{ const ctx = new OfflineAudioContext(1, 1, 44100), b = ctx.createBuffer(1, 44100, 44100), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.sin(i * 0.05);
  const s = stretchBuffer(ctx, b, 1.5); log(Math.abs(s.length / b.length - 1.5) < 0.02, 'WSOLA stretch ratio'); }
{ const b = new OfflineAudioContext(1, 1, 44100).createBuffer(1, 100, 44100), w = encodeWav(b, 16); log(w.size === 44 + 200, 'WAV encoder size'); }

// ---- custom instruments ----
{
  const finite = (x) => typeof x === 'number' && Number.isFinite(x);
  const TYPES = ['sine', 'square', 'sawtooth', 'triangle'];
  const messy = {
    id: 'bad id!', name: 42, cat: null,
    osc: [['wobble', NaN, 9, 'x'], ['sine', 0, 0.8, 0], ['square', 7, 0.2, 1], ['sawtooth', -500, 3, 99], ['triangle', 0, 0.2, 0], ['sine', 0, 1, 0]],
    env: [NaN, -1, 99, 'x'], gain: 99, filter: { type: 'nope', freq: 1e9, q: NaN, amt: Infinity },
    vib: [NaN, 500], trem: [5, 'x'], drive: -3, glide: 1e9, fm: { ratio: NaN, index: 2 }, unison: { voices: 99, spread: 1e9, type: 'bogus' },
  };
  const clean = sanitizeInstrument(messy);
  const okOsc = clean.osc.length >= 1 && clean.osc.length <= 4 && clean.osc.every(([t, d, g, o]) => TYPES.includes(t) && finite(d) && finite(g) && g >= 0 && g <= 1.5 && finite(o));
  log(clean.id.startsWith('u_') && okOsc && clean.env.every((v) => finite(v) && v >= 0 && v <= 8) && finite(clean.gain) && clean.gain <= 1.5, 'sanitize clamps a messy synth definition');
  log(clean.name === 'Custom sound' && clean.cat === 'My instruments' && clean.filter.type === 'lowpass' && !('vib' in clean) && !('trem' in clean) && !('drive' in clean), 'sanitize falls back to defaults and drops invalid features');
  log(clean.unison?.voices === 5 && clean.unison.type === undefined && clean.fm?.ratio === 1 && clean.fm.index === 2, 'sanitize clamps unison voices, drops a bad osc type and resets NaN fm ratio');
  log(sanitizeInstrument({ osc: [['sine', 0, 0.5, 0]], fm: { index: 0 }, attackNoise: { gain: 0 } }).fm === undefined, 'sanitize drops fm and attack noise when they are off');
  const nanDef = sanitizeInstrument({ id: 'u_nan1', osc: [['sine', 0, 0.8, 0]], gain: NaN, env: [NaN, NaN, NaN, NaN] });
  log(nanDef.id === 'u_nan1' && finite(nanDef.gain) && nanDef.gain === 0.8 && nanDef.env.every(finite), 'sanitize rejects NaN (uses defaults)');
  log(sanitizeInstrument(null) === null && sanitizeInstrument('nope') === null && sanitizeInstrument([]) === null, 'sanitize rejects non-objects');
  const s1 = await voice((o, out) => startVoice(o, out, clean, 0, 60, 100).release(0.6));
  log(!s1.bad && s1.pk > 0.01, `custom synth renders (peak ${s1.pk.toFixed(2)})`);
  const fx = sanitizeInstrument({ osc: [['square', 0, 0.5, 0]], env: [0.01, 0.2, 0.7, 0.2], fm: { ratio: 2, index: 1.5, decay: 0.3, end: 0.2 }, attackNoise: { gain: 0.4, decay: 0.02, type: 'hp', freq: 3000 }, lfoFilter: [3, 600], filter: { type: 'bandpass', freq: 1500, q: 2, amt: 1000, decay: 0.2 }, unison: { voices: 3, spread: 10 } });
  const s2 = await voice((o, out) => startVoice(o, out, fx, 0, 48, 100).release(0.5));
  log(!s2.bad && s2.pk > 0.01, `custom synth with FM, noise, LFO and unison (peak ${s2.pk.toFixed(2)})`);

  const reg = registerInstrument(clean);
  log(reg && listCustomInstruments().some((d) => d.id === reg.id) && getInstrument(reg.id).id === reg.id, 'register custom instrument');
  unregisterInstrument(reg.id);
  log(getInstrument(reg.id).id === 'grand' && !listCustomInstruments().some((d) => d.id === reg.id), 'unregister falls back to Grand Piano');
  log(getInstrument('nope_missing').id === 'grand' && getInstrument('constructor').id === 'grand' && getInstrument('saw').id === 'saw', 'registry falls back to built-ins, then grand');

  // sample voice on a generated sine buffer: 22050 samples at 22050 Hz, played one octave up with a loop
  const sampleDef = sanitizeInstrument({ type: 'sample', name: 'Test sample', bufferId: 'b_test', rootNote: 60, attack: 0.005, release: 0.2, gain: 1, loopStart: 0.1, loopEnd: 0.5 });
  log(sampleDef.type === 'sample' && sampleDef.loopEnd === 0.5 && sanitizeInstrument({ type: 'sample', loopStart: 0.5, loopEnd: 0.1 }).loopEnd === undefined, 'sanitize sample instrument and loop bounds');
  const mkBuf = (o) => { const b = o.createBuffer(1, 22050, 22050), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.sin(i * 0.1) * 0.8; return b; };
  const s3 = await voice((o, out) => startVoice(o, out, sampleDef, 0, 72, 100, mkBuf(o)).release(0.5));
  log(!s3.bad && s3.pk > 0.01, `sample instrument renders (peak ${s3.pk.toFixed(2)})`);
  const s4 = await voice((o, out) => startVoice(o, out, sampleDef, 0, 60, 100, null).release(0.3));
  log(!s4.bad && s4.pk === 0, 'sample instrument with missing buffer is silent, not broken');
}
{ const z = zip([{ name: 'a.txt', data: new TextEncoder().encode('hello') }]); const e = await unzip(new Uint8Array(await z.arrayBuffer())); log(e.length === 1 && new TextDecoder().decode(e[0].data) === 'hello', 'zip round-trip'); }

{ const sw = { amount: 1, grid: 0.25 };
  log(swingDelay(0, sw) === 0 && swingDelay(0.5, sw) === 0, 'swing leaves on-beat 16ths untouched');
  log(Math.abs(swingDelay(0.25, sw) - 0.125) < 1e-9 && Math.abs(swingDelay(0.75, sw) - 0.125) < 1e-9, 'swing delays off-beat 16ths by half a step at 100%');
  log(Math.abs(swingDelay(0.5, { amount: 0.67, grid: 0.5 }) - 0.1675) < 1e-9, 'swing 67% on 1/8 grid');
  log(swingDelay(0.25, { amount: 0, grid: 0.25 }) === 0 && swingDelay(0.25, undefined) === 0, 'no swing when off or missing');
  log(swingDelay(0.37, sw) === 0, 'swing ignores notes far from the grid'); }

out.innerHTML += `\n\n<b class="${fails ? 'bad' : 'ok'}">${total - fails}/${total} passed</b>`;
document.title = fails ? 'FAIL' : 'PASS';
