import { FX_LIST, FX_PRESETS, MASTER_PRESETS, createFx } from '../js/audio/effects.js';
import { INSTRUMENTS, KITS, DRUM_MAP, startVoice, playDrum } from '../js/audio/synth.js';
import { loadWorklets } from '../js/audio/engine.js';
import { LOOPS, buildLoop } from '../js/audio/loops.js';
import { stretchBuffer, encodeWav } from '../js/audio/dsp.js';
import { zip, unzip } from '../js/zip.js';

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
{ const z = zip([{ name: 'a.txt', data: new TextEncoder().encode('hello') }]); const e = await unzip(new Uint8Array(await z.arrayBuffer())); log(e.length === 1 && new TextDecoder().decode(e[0].data) === 'hello', 'zip round-trip'); }

out.innerHTML += `\n\n<b class="${fails ? 'bad' : 'ok'}">${total - fails}/${total} passed</b>`;
document.title = fails ? 'FAIL' : 'PASS';
