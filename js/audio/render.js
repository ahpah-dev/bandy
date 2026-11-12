// Offline rendering (mixdown, stems) and MIDI file export.
import { S, projectEnd, beatsPerBar } from '../state.js';
import { Graph, scheduleSegment, scheduleAutomation, loadWorklets } from './engine.js';
import { normalizeBuffer, encodeWav } from './dsp.js';
import { zip } from '../zip.js';

export async function renderMix({ from = 0, to = null, tail = 2.5, sampleRate = 44100, tracks = null, normalize = false } = {}) {
  const p = S.project, spb = 60 / p.bpm;
  const end = to ?? projectEnd();
  const frames = Math.max(1, Math.ceil(((end - from) * spb + tail) * sampleRate));
  const off = new OfflineAudioContext(2, frames, sampleRate);
  const worklets = await loadWorklets(off);
  const g = new Graph(off, { worklets, getKey: () => p.key }, true);
  if (tracks) g.filter = new Set(tracks);
  g.sync(p); g.newSessions();
  scheduleSegment(g, p, from, end, 0, true);
  scheduleAutomation(g, p, from, 0);
  let buf = await off.startRendering();
  if (normalize) buf = normalizeBuffer(off, buf, 0.98);
  return buf;
}

export async function exportStems(opts, onProgress) {
  const files = []; let i = 0;
  const p = S.project;
  for (const t of p.tracks) {
    if (!t.regions.length) continue;
    onProgress?.(i++ / p.tracks.length, t.name);
    const b = await renderMix({ ...opts, tracks: [t.id] });
    files.push({ name: `${String(i).padStart(2, '0')} - ${t.name.replace(/[\\/:*?"<>|]/g, '_')}.wav`, data: new Uint8Array(await encodeWav(b, opts.bits || 16).arrayBuffer()) });
  }
  return zip(files);
}

// ---- Standard MIDI file ----
function vlq(n) { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; }
const u16 = (n) => [(n >> 8) & 255, n & 255], u32 = (n) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
export function exportMidi(p = S.project) {
  const PPQ = 480, tracks = [];
  const meta = [0, 0xff, 0x51, 3, ...[(60000000 / p.bpm >> 16) & 255, (60000000 / p.bpm >> 8) & 255, Math.round(60000000 / p.bpm) & 255], 0, 0xff, 0x58, 4, p.sig[0], Math.log2(p.sig[1]), 24, 8];
  const name = (s) => { const e = [...new TextEncoder().encode(s)]; return [0, 0xff, 0x03, ...vlq(e.length), ...e]; };
  tracks.push([...name(p.name), ...meta, 0, 0xff, 0x2f, 0]);
  p.tracks.filter((t) => t.type !== 'audio').forEach((t, i) => {
    const ch = t.type === 'drums' || t.type === 'sampler' ? 9 : i % 9 + (i % 9 >= 9 ? 1 : 0);
    const ev = [];
    for (const r of t.regions) {
      if (r.muted) continue;
      for (let k = 0; k * r.loopLen < r.length - 1e-6; k++) for (const n of r.notes) {
        if (n.s >= r.loopLen) continue;
        const s = r.start + k * r.loopLen + n.s; if (s >= r.start + r.length) continue;
        const e = Math.min(s + n.l, r.start + r.length);
        ev.push([Math.round(s * PPQ), 0x90 | ch, n.p, n.v], [Math.round(e * PPQ), 0x80 | ch, n.p, 0]);
      }
    }
    ev.sort((a, b) => a[0] - b[0] || (a[1] & 0xf0) - (b[1] & 0xf0));
    const nm = [...new TextEncoder().encode(t.name)];
    const data = [0, 0xff, 0x03, ...vlq(nm.length), ...nm]; let last = 0;
    for (const [tick, st, a, b] of ev) { data.push(...vlq(tick - last), st, a, b); last = tick; }
    data.push(0, 0xff, 0x2f, 0); tracks.push(data);
  });
  const out = [...[0x4d, 0x54, 0x68, 0x64], ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(PPQ)];
  for (const t of tracks) out.push(0x4d, 0x54, 0x72, 0x6b, ...u32(t.length), ...t);
  return new Blob([new Uint8Array(out)], { type: 'audio/midi' });
}
