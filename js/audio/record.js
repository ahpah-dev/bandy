// Recording (microphone audio + MIDI notes) and live playing.
import { S, settings, getTrack, makeAudioRegion, makeMidiRegion, beatsPerBar, changed, checkpoint } from '../state.js';
import { engine } from './engine.js';
import { uid, toast, emit } from '../util.js';

let stream = null, micSrc = null, recNode = null, chunks = [], silent = null;
const rec = { audioTrack: null, midi: new Map(), startBeat: 0, active: new Map(), t0: 0 };
export const recState = rec;

export async function ensureMic() {
  const id = settings.inputDeviceId || undefined;
  if (stream && stream.getAudioTracks()[0]?.readyState === 'live' && (!id || stream.getAudioTracks()[0].getSettings().deviceId === id)) return stream;
  stream?.getTracks().forEach((t) => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
  micSrc = null;
  return stream;
}
export async function listInputs() {
  try { const d = await navigator.mediaDevices.enumerateDevices(); return d.filter((x) => x.kind === 'audioinput'); } catch { return []; }
}
export function getMicSource() {
  if (!micSrc || micSrc.context !== engine.ctx) micSrc = engine.ctx.createMediaStreamSource(stream);
  return micSrc;
}

export function recordTargets() {
  const armed = S.project.tracks.filter((t) => t.arm);
  if (armed.length) return armed;
  const sel = getTrack(S.sel.track);
  return sel && sel.type !== 'sampler' ? [sel] : sel ? [sel] : [];
}

export async function startRecording() {
  if (engine.recording) return;
  const targets = recordTargets();
  if (!targets.length) { toast('Add or arm a track first, then press record', 'warn'); return; }
  await engine.init();
  const audioT = targets.find((t) => t.type === 'audio');
  try { if (audioT) await ensureMic(); } catch (e) { toast('Microphone unavailable: ' + (e.message || e.name), 'error'); return; }
  checkpoint();
  const p = S.project, bpb = beatsPerBar(), start = S.pos;
  rec.startBeat = start; rec.audioTrack = audioT || null; rec.midi = new Map(); rec.active = new Map(); chunks = [];
  for (const t of targets.filter((t) => t.type !== 'audio')) {
    const r = makeMidiRegion(start, bpb, [], t.name + ' rec'); t.regions.push(r); rec.midi.set(t.id, r);
  }
  if (audioT) {
    const ctx = engine.ctx;
    if (!engine.worklets) { toast('AudioWorklet is required for audio recording', 'error'); return; }
    recNode = new AudioWorkletNode(ctx, 'bandy-recorder', { numberOfInputs: 1, numberOfOutputs: 1 });
    recNode.port.onmessage = (e) => chunks.push(e.data);
    silent = ctx.createGain(); silent.gain.value = 0; recNode.connect(silent); silent.connect(ctx.destination);
    getMicSource().connect(recNode);
    if (audioT.monitor || settings.monitor) { const n = engine.graph.tracks.get(audioT.id); if (n) getMicSource().connect(n.input); }
  }
  engine.recording = true; engine.recordingBusy = true;
  const countIn = settings.countIn ? bpb : 0;
  changed();
  await engine.play({ from: start, countIn });
  const spb = 60 / p.bpm; rec.t0 = engine.anchor.time + countIn * spb;
  emit('transport');
}

export async function stopRecording() {
  if (!engine.recording) return;
  const endBeat = Math.max(engine.pos(), rec.startBeat);
  const p = S.project, bpb = beatsPerBar();
  engine.recording = false;
  engine.pause();
  engine.recordingBusy = false;
  for (const [tid, r] of rec.midi) {
    for (const [, a] of rec.active) if (a.region === r) a.note.l = Math.max(0.05, endBeat - r.start - a.note.s);
    const len = Math.max(bpb, Math.ceil((endBeat - r.start) / bpb - 1e-6) * bpb);
    r.length = len; r.loopLen = len;
    if (!r.notes.length) { const t = getTrack(tid); t.regions = t.regions.filter((x) => x !== r); }
  }
  rec.active.clear();
  if (recNode) {
    recNode.port.postMessage('stop');
    try { getMicSource().disconnect(recNode); } catch {}
    await new Promise((r) => setTimeout(r, 120));
    const sr = engine.ctx.sampleRate, startFrame = Math.round(rec.t0 * sr);
    let endFrame = 0; for (const c of chunks) endFrame = Math.max(endFrame, c.frame + c.data.length);
    const n = endFrame - startFrame;
    if (n > sr * 0.05) {
      const buf = engine.ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
      for (const c of chunks) { const off = c.frame - startFrame; for (let i = 0; i < c.data.length; i++) { const j = off + i; if (j >= 0 && j < n) d[j] = c.data[i]; } }
      const id = uid('b'); S.buffers.set(id, buf);
      const t = rec.audioTrack, r = makeAudioRegion(id, rec.startBeat, buf.duration, t.name + ' take');
      const lat = Math.min(buf.duration * 0.5, (settings.latencyMs > 0 ? settings.latencyMs : ((engine.ctx.baseLatency || 0) + (engine.ctx.outputLatency || 0)) * 1000) / 1000);
      r.srcOffset = lat; r.srcLen = buf.duration - lat; r.length = r.srcLen * (p.bpm / 60);
      t.regions.push(r); S.sel.regions = new Set([r.id]);
    }
    try { recNode.disconnect(); silent.disconnect(); } catch {}
    recNode = null;
  }
  changed(true); emit('transport');
}

// ---- live playing (computer keyboard, on-screen keys, Web MIDI) ----
export function liveTarget() {
  const armed = S.project.tracks.find((t) => t.arm && t.type !== 'audio');
  if (armed) return armed;
  const sel = getTrack(S.sel.track);
  if (sel && sel.type !== 'audio') return sel;
  return S.project.tracks.find((t) => t.type !== 'audio') || null;
}
export async function liveNote(note, vel, down, trackId) {
  const t = trackId ? getTrack(trackId) : liveTarget(); if (!t) return;
  if (down) {
    await engine.noteOn(t.id, note, vel);
    emit('liveNote', { note, on: true, track: t.id });
    if (engine.recording) {
      const r = rec.midi.get(t.id);
      if (r && !engine.countingIn) {
        const s = Math.max(0, engine.pos() - r.start), n = { id: uid('n'), p: note, s, l: 0.25, v: vel };
        r.notes.push(n); rec.active.set(t.id + ':' + note, { note: n, region: r });
        if (s > r.length - 0.01) { r.length = r.loopLen = Math.ceil((s + 0.5) / beatsPerBar()) * beatsPerBar(); }
      }
    }
  } else {
    engine.noteOff(t.id, note);
    emit('liveNote', { note, on: false, track: t.id });
    const a = rec.active.get(t.id + ':' + note);
    if (a) { a.note.l = Math.max(0.05, engine.pos() - a.region.start - a.note.s); rec.active.delete(t.id + ':' + note); }
  }
}

let midiAccess = null;
export async function initMidi() {
  if (!navigator.requestMIDIAccess || midiAccess) return midiAccess;
  try {
    midiAccess = await navigator.requestMIDIAccess();
    const hook = () => midiAccess.inputs.forEach((inp) => { inp.onmidimessage = (e) => { const [st, n, v] = e.data, cmd = st & 0xf0; if (cmd === 0x90 && v > 0) liveNote(n, v, true); else if (cmd === 0x80 || (cmd === 0x90 && v === 0)) liveNote(n, 0, false); }; });
    hook(); midiAccess.onstatechange = () => { hook(); emit('midi'); };
  } catch (e) { console.warn('MIDI unavailable', e); }
  return midiAccess;
}
export const midiInputNames = () => (midiAccess ? [...midiAccess.inputs.values()].map((i) => i.name) : []);

// Capture a short sample from the microphone (used by the sampler pads and quick takes).
export async function captureMic() {
  await engine.init(); await ensureMic();
  if (!engine.worklets) throw new Error('AudioWorklet is required for recording');
  const ctx = engine.ctx, node = new AudioWorkletNode(ctx, 'bandy-recorder', { numberOfInputs: 1, numberOfOutputs: 1 }), sil = ctx.createGain(), got = [];
  sil.gain.value = 0; node.connect(sil); sil.connect(ctx.destination); node.port.onmessage = (e) => got.push(e.data);
  const src = getMicSource(); src.connect(node);
  return {
    async stop() {
      node.port.postMessage('stop'); await new Promise((r) => setTimeout(r, 120));
      try { src.disconnect(node); node.disconnect(); sil.disconnect(); } catch {}
      const total = got.reduce((a, c) => a + c.data.length, 0); if (total < 256) return null;
      const buf = ctx.createBuffer(1, total, ctx.sampleRate), d = buf.getChannelData(0); let o = 0;
      for (const c of got) { d.set(c.data, o); o += c.data.length; }
      return buf;
    },
  };
}
