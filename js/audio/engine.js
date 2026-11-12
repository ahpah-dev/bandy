// Audio graph, scheduling and transport.
import { S, settings, getTrack, contentBeats, projectEnd } from '../state.js';
import { dbToGain, clamp, emit, on } from '../util.js';
import { createFx, MASTER_PRESETS } from './effects.js';
import { startVoice, playDrum, clickSound, getInstrument } from './synth.js';
import { reverseBuffer, stretchBuffer } from './dsp.js';

const WORKLET_URL = new URL('./worklets.js', import.meta.url).href;
export async function loadWorklets(ctx) { try { await ctx.audioWorklet.addModule(WORKLET_URL); return true; } catch (e) { console.warn('AudioWorklet unavailable', e); return false; } }

// ---------- processed audio cache (reverse / pitch / stretch) ----------
const procCache = new Map();
let helperCtx;
const hctx = () => (helperCtx ||= new OfflineAudioContext(2, 1, 44100));
export function audioInfo(r) {
  const base = S.buffers.get(r.bufferId); if (!base) return null;
  const rate = Math.pow(2, (r.pitch || 0) / 12), ratio = rate / (r.speed || 1);
  let buf = base;
  const key = `${r.bufferId}|${r.reverse ? 1 : 0}|${ratio.toFixed(5)}`;
  let hit = procCache.get(key);
  if (!hit) {
    let b = base;
    if (r.reverse) b = reverseBuffer(hctx(), b);
    if (Math.abs(ratio - 1) > 1e-4) b = stretchBuffer(hctx(), b, ratio);
    hit = b; procCache.set(key, hit);
    if (procCache.size > 40) procCache.delete(procCache.keys().next().value);
  }
  buf = hit;
  return { buf, rate, ratio, base };
}
export function dropProcCache(bufferId) { for (const k of [...procCache.keys()]) if (k.startsWith(bufferId + '|')) procCache.delete(k); }

// ---------- Graph ----------
class TrackNode {
  constructor(g, id) {
    const ctx = g.ctx; this.g = g; this.id = id;
    this.input = ctx.createGain(); this.vol = ctx.createGain(); this.muteG = ctx.createGain(); this.pan = ctx.createStereoPanner(); this.an = ctx.createAnalyser(); this.an.fftSize = 1024;
    this.fxNodes = []; this.sig = ''; this.session = null;
    this.vol.connect(this.muteG); this.muteG.connect(this.pan); this.pan.connect(this.an); this.pan.connect(g.masterIn);
    this.input.connect(this.vol);
    this.buf = new Float32Array(1024);
  }
  rebuild(p, track, env) {
    const sig = track.fx.filter((f) => !f.bypass).map((f) => f.id + f.type).join('|');
    if (sig !== this.sig) {
      this.input.disconnect(); this.fxNodes.forEach((n) => { try { n.fx.output.disconnect(); n.fx.destroy(); } catch {} });
      this.fxNodes = [];
      let last = this.input;
      for (const f of track.fx) {
        if (f.bypass) continue;
        const fx = createFx(this.g.ctx, f.type, f.params, env);
        last.connect(fx.input); last = fx.output; this.fxNodes.push({ id: f.id, fx });
      }
      last.connect(this.vol); this.sig = sig;
    }
    for (const f of track.fx) { if (f.bypass) continue; const n = this.fxNodes.find((x) => x.id === f.id); if (n) { n.fx.set(f.params); n.fx.tempo?.(p.bpm); } }
  }
  peak() {
    this.an.getFloatTimeDomainData(this.buf); let m = 0;
    for (let i = 0; i < this.buf.length; i++) { const v = Math.abs(this.buf[i]); if (v > m) m = v; }
    return m;
  }
}

export class Graph {
  constructor(ctx, env, offline = false) {
    this.ctx = ctx; this.env = env; this.offline = offline;
    this.masterIn = ctx.createGain(); this.masterVol = ctx.createGain(); this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.5; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.002; this.limiter.release.value = 0.1;
    this.split = ctx.createChannelSplitter(2); this.anL = ctx.createAnalyser(); this.anR = ctx.createAnalyser(); this.anL.fftSize = this.anR.fftSize = 1024;
    this.clip = ctx.createWaveShaper(); const cc = new Float32Array(2048); for (let i = 0; i < 2048; i++) { const x = (i / 1023.5) - 1, a = Math.abs(x); cc[i] = Math.sign(x) * (a < 0.9 ? a : 0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1)); } this.clip.curve = cc;
    this.masterIn.connect(this.masterVol); this.masterVol.connect(this.limiter); this.limiter.connect(this.clip); this.clip.connect(ctx.destination); this.clip.connect(this.split); this.split.connect(this.anL, 0); this.split.connect(this.anR, 1);
    this.masterFx = []; this.masterSig = ''; this.tracks = new Map(); this.bufL = new Float32Array(1024); this.bufR = new Float32Array(1024);
    this.clickBus = ctx.createGain(); this.clickBus.connect(this.masterVol);
    this.filter = null; // optional set of track ids to include (offline stems)
  }
  setNow(param, v) { if (this.offline) param.value = v; else param.setTargetAtTime(v, this.ctx.currentTime, 0.015); }
  sync(p) {
    const ids = new Set(p.tracks.map((t) => t.id));
    for (const [id, n] of this.tracks) if (!ids.has(id)) { n.input.disconnect(); n.pan.disconnect(); n.fxNodes.forEach((f) => f.fx.destroy()); this.tracks.delete(id); }
    const anySolo = p.tracks.some((t) => t.solo);
    for (const t of p.tracks) {
      let n = this.tracks.get(t.id);
      if (!n) { n = new TrackNode(this, t.id); this.tracks.set(t.id, n); }
      n.rebuild(p, t, this.env);
      const audible = this.filter ? this.filter.has(t.id) : !(t.mute || (anySolo && !t.solo));
      this.setNow(n.muteG.gain, audible ? 1 : 0);
      if (!t.auto?.volume?.length) this.setNow(n.vol.gain, dbToGain(t.vol));
      if (!t.auto?.pan?.length) this.setNow(n.pan.pan, t.pan);
    }
    // master
    const name = p.master.mastering || 'Off', chain = MASTER_PRESETS[name];
    if (name !== this.masterSig) {
      this.masterIn.disconnect(); this.masterFx.forEach((f) => { try { f.output.disconnect(); f.destroy(); } catch {} }); this.masterFx = [];
      let last = this.masterIn;
      for (const c of chain || []) { const fx = createFx(this.ctx, c.type, c.params, this.env); last.connect(fx.input); last = fx.output; this.masterFx.push(fx); }
      last.connect(this.masterVol); this.masterSig = name;
    }
    this.setNow(this.masterVol.gain, dbToGain(p.master.vol));
  }
  newSessions() {
    for (const n of this.tracks.values()) {
      if (n.session) { const old = n.session; old.gain.setTargetAtTime(0, this.ctx.currentTime, 0.008); setTimeout(() => old.disconnect(), 120); }
      n.session = this.ctx.createGain(); n.session.connect(n.input);
    }
  }
  levels() {
    this.anL.getFloatTimeDomainData(this.bufL); this.anR.getFloatTimeDomainData(this.bufR);
    let l = 0, r = 0; for (let i = 0; i < 1024; i++) { l = Math.max(l, Math.abs(this.bufL[i])); r = Math.max(r, Math.abs(this.bufR[i])); }
    return [l, r];
  }
}

// ---------- Scheduling ----------
function autoValue(pts, beat, def) {
  if (!pts.length) return def;
  if (beat <= pts[0].t) return pts[0].v;
  for (let i = 1; i < pts.length; i++) if (beat <= pts[i].t) { const a = pts[i - 1], b = pts[i]; return a.v + ((b.v - a.v) * (beat - a.t)) / Math.max(1e-6, b.t - a.t); }
  return pts[pts.length - 1].v;
}
export function scheduleAutomation(g, p, startBeat, t0, endBeat = Infinity) {
  const spb = 60 / p.bpm;
  for (const t of p.tracks) {
    const n = g.tracks.get(t.id); if (!n) continue;
    const av = t.auto?.volume || [], ap = t.auto?.pan || [];
    if (av.length) {
      const prm = n.vol.gain; prm.cancelScheduledValues(t0); prm.setValueAtTime(dbToGain(autoValue(av, startBeat, 0)), t0);
      for (const pt of av) if (pt.t > startBeat && pt.t < endBeat) prm.linearRampToValueAtTime(dbToGain(pt.v), t0 + (pt.t - startBeat) * spb);
    }
    if (ap.length) {
      const prm = n.pan.pan; prm.cancelScheduledValues(t0); prm.setValueAtTime(autoValue(ap, startBeat, 0), t0);
      for (const pt of ap) if (pt.t > startBeat && pt.t < endBeat) prm.linearRampToValueAtTime(pt.v, t0 + (pt.t - startBeat) * spb);
    }
  }
}

export function triggerNote(g, track, dest, note, when, dur, vel, live = null) {
  const ctx = g.ctx;
  if (track.type === 'synth') {
    const inst = getInstrument(track.inst);
    const v = startVoice(ctx, dest, inst, when, note, vel, inst.type === 'sample' ? S.buffers.get(inst.bufferId) || null : null);
    if (dur != null) v.release(when + dur);
    return v;
  }
  if (track.type === 'drums') { playDrum(ctx, dest, track.kit, note, when, vel); return null; }
  if (track.type === 'sampler') {
    const pad = track.pads?.[note - 36];
    if (pad?.bufferId && S.buffers.get(pad.bufferId)) {
      const s = ctx.createBufferSource(), gn = ctx.createGain();
      s.buffer = S.buffers.get(pad.bufferId); s.playbackRate.value = Math.pow(2, (pad.pitch || 0) / 12);
      gn.gain.value = dbToGain(pad.vol || 0) * Math.pow(vel / 127, 1.2); s.connect(gn); gn.connect(dest); s.start(when);
    } else if (!pad?.bufferId) playDrum(ctx, dest, track.kit, pad?.note ?? note, when, vel);
  }
  return null;
}

export function scheduleSegment(g, p, segStart, segEnd, t0, restart) {
  const ctx = g.ctx, spb = 60 / p.bpm, time = (b) => t0 + (b - segStart) * spb;
  for (const t of p.tracks) {
    const node = g.tracks.get(t.id); if (!node) continue;
    const dest = node.session || node.input;
    for (const r of t.regions) {
      if (r.muted) continue;
      const re = r.start + r.length;
      if (r.start >= segEnd || re <= segStart) continue;
      if (r.type === 'midi') {
        const L = r.loopLen || r.length; if (L <= 0) continue;
        const k0 = Math.max(0, Math.floor((segStart - r.start) / L));
        for (let k = k0; r.start + k * L < Math.min(segEnd, re); k++) for (const n of r.notes) {
          if (n.s >= L || n.s < 0) continue;
          const nb = r.start + k * L + n.s;
          if (nb < segStart - 1e-9 || nb >= segEnd || nb >= re) continue;
          const dur = Math.min(n.l, re - nb);
          triggerNote(g, t, dest, n.p, time(nb), dur * spb, n.v);
        }
      } else {
        const info = audioInfo(r); if (!info) continue;
        const C = contentBeats(r, p); if (C <= 0) continue;
        const offOrig = r.reverse ? info.base.duration - (r.srcOffset + r.srcLen) : r.srcOffset;
        for (let k = 0; r.start + k * C < re - 1e-6; k++) {
          const cs = r.start + k * C, ce = Math.min(cs + C, re);
          if (ce <= segStart || cs >= segEnd) continue;
          let sb = cs, off = 0;
          if (cs < segStart - 1e-9) { if (!restart) continue; sb = segStart; off = (segStart - cs) * spb; }
          const when = Math.max(time(sb), ctx.currentTime);
          const realDur = (ce - sb) * spb;
          const src = ctx.createBufferSource(); src.buffer = info.buf; src.playbackRate.value = info.rate;
          const gn = ctx.createGain(); src.connect(gn); gn.connect(dest);
          const base = dbToGain(r.gain || 0), fi = r.fadeIn || 0, fo = r.fadeOut || 0;
          const envAt = (b) => base * (fi > 0 ? clamp((b - r.start) / fi, 0, 1) : 1) * (fo > 0 ? clamp((re - b) / fo, 0, 1) : 1);
          gn.gain.setValueAtTime(envAt(sb), when);
          if (fi > 0 && sb < r.start + fi) gn.gain.linearRampToValueAtTime(base, time(r.start + fi));
          if (fo > 0 && ce >= re - 1e-6) { const fs = Math.max(sb, re - fo); gn.gain.setValueAtTime(envAt(fs), time(fs)); gn.gain.linearRampToValueAtTime(0, time(re)); }
          const offP = (offOrig * info.ratio) + off * info.rate;
          const maxDur = info.buf.duration - offP;
          if (maxDur <= 0) continue;
          src.start(when, Math.min(offP, info.buf.duration - 0.001), Math.min(realDur * info.rate, maxDur));
        }
      }
    }
  }
}

// ---------- Realtime engine ----------
class Engine {
  constructor() {
    this.ctx = null; this.graph = null; this.playing = false; this.wraps = []; this.worklets = false; this.sig = ''; this.auditionTimer = null; this.live = new Map(); this.countingIn = false;
  }
  get env() { return { worklets: this.worklets, getKey: () => S.project.key }; }
  async init() {
    if (this.ctx) { if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {}); return; }
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.worklets = await loadWorklets(this.ctx);
    this.graph = new Graph(this.ctx, this.env);
    this.graph.sync(S.project);
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
    emit('engine');
  }
  sync() {
    if (!this.graph) return;
    this.graph.sync(S.project);
    const sig = JSON.stringify(S.project.tracks.map((t) => [t.id, t.inst, t.kit, t.pads, t.regions, t.auto, S.project.bpm, S.project.loop]));
    if (sig !== this.sig) { this.sig = sig; if (this.playing && !this.recordingBusy) this.restartSoon(); }
  }
  restartSoon() { clearTimeout(this._rt); this._rt = setTimeout(() => { if (this.playing) this.restartAt(this.pos(), true); }, 60); }
  get spb() { return 60 / S.project.bpm; }

  async play(opts = {}) {
    await this.init();
    if (this.playing) return;
    const p = S.project, ctx = this.ctx;
    this.startBeat = opts.from ?? S.pos; this.countIn = opts.countIn || 0;
    this.begin(this.startBeat, this.countIn);
    emit('transport');
  }
  begin(startBeat, countIn = 0) {
    const ctx = this.ctx, t0 = ctx.currentTime + 0.06;
    this.graph.sync(S.project); this.graph.newSessions();
    this.playing = true; this.startBeat = startBeat; this.countIn = countIn;
    this.cursorBeat = startBeat - countIn; this.cursorTime = t0; this.restart = true; this.wraps = [];
    this.anchor = { time: t0, beat: startBeat - countIn };
    clearInterval(this.timer); this.timer = setInterval(() => this.tick(), 25); this.tick();
  }
  restartAt(beat, keep = false) {
    if (!this.playing) return;
    this.graph.sync(S.project);
    this.begin(beat, 0);
  }
  tick() {
    const ctx = this.ctx, p = S.project, spb = 60 / p.bpm, now = ctx.currentTime, horizon = now + 0.14;
    if (this.cursorTime < now - 0.05) { this.cursorTime = now + 0.01; }
    let guard = 0;
    while (this.cursorTime < horizon && guard++ < 16) {
      const segStart = this.cursorBeat;
      let segEnd = segStart + Math.max(1e-4, (horizon - this.cursorTime) / spb);
      segEnd = Math.min(segEnd, segStart + 1);
      const counting = segStart < this.startBeat - 1e-9 && this.countIn > 0;
      this.countingIn = counting;
      if (counting) segEnd = Math.min(segEnd, this.startBeat);
      const lp = p.loop, looping = lp.on && !counting && !this.recording && segStart < lp.end - 1e-9;
      if (looping && segEnd >= lp.end) segEnd = lp.end;
      if (S.ui.metronome || counting) this.clicks(segStart, segEnd, this.cursorTime);
      if (!counting) {
        scheduleSegment(this.graph, p, segStart, segEnd, this.cursorTime, this.restart);
        if (this.restart) scheduleAutomation(this.graph, p, segStart, this.cursorTime);
        this.restart = false;
      }
      this.cursorTime += (segEnd - segStart) * spb; this.cursorBeat = segEnd;
      if (counting && segEnd >= this.startBeat - 1e-9) { this.restart = true; this.countIn = 0; this.countingIn = false; }
      if (looping && segEnd >= lp.end - 1e-9) { this.wraps.push({ time: this.cursorTime, beat: lp.start }); this.cursorBeat = lp.start; this.restart = true; }
    }
    if (!p.loop.on && !this.recording && this.pos() > projectEnd() + 2 && projectEnd() > 0) { S.pos = 0; this.stopNow(); emit('transport'); }
  }
  clicks(a, b, t0) {
    const p = S.project, unit = 4 / p.sig[1], spb = 60 / p.bpm;
    const first = Math.ceil(a / unit - 1e-9);
    for (let i = first; i * unit < b - 1e-9; i++) {
      const beat = i * unit, idx = ((i % p.sig[0]) + p.sig[0]) % p.sig[0];
      clickSound(this.ctx, this.graph.clickBus, t0 + (beat - a) * spb, idx === 0, settings.metroVol);
    }
  }
  pos() {
    if (!this.playing) return S.pos;
    const now = this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
    while (this.wraps.length && this.wraps[0].time <= now) { this.anchor = { time: this.wraps[0].time, beat: this.wraps[0].beat }; this.wraps.shift(); }
    return this.anchor.beat + (now - this.anchor.time) / this.spb;
  }
  displayPos() { const p = this.pos(); return this.countingIn ? this.startBeat : p; }
  stopNow() {
    clearInterval(this.timer); this.playing = false; this.countingIn = false;
    if (this.graph) { this.graph.newSessions(); for (const n of this.graph.tracks.values()) { n.vol.gain.cancelScheduledValues(0); n.pan.pan.cancelScheduledValues(0); } this.graph.sync(S.project); }
  }
  pause() { if (!this.playing) return; S.pos = Math.max(0, this.pos()); this.stopNow(); emit('transport'); }
  async toggle() { if (this.playing) this.pause(); else await this.play(); }
  seek(beat) {
    beat = Math.max(0, beat);
    if (this.playing) { S.pos = beat; this.begin(beat, 0); } else S.pos = beat;
    emit('seek');
  }

  // ---- live / preview ----
  async noteOn(trackId, note, vel = 100) {
    await this.init();
    const t = getTrack(trackId); if (!t || t.type === 'audio') return null;
    const node = this.graph.tracks.get(t.id); if (!node) return null;
    const key = trackId + ':' + note; this.noteOff(trackId, note);
    const v = triggerNote(this.graph, t, node.input, note, this.ctx.currentTime + 0.005, null, vel);
    this.live.set(key, v); return v;
  }
  noteOff(trackId, note) { const key = trackId + ':' + note, v = this.live.get(key); if (v) { v.release(this.ctx.currentTime); this.live.delete(key); } }
  async previewNote(trackId, note, ms = 280, vel = 100) { await this.noteOn(trackId, note, vel); setTimeout(() => this.noteOff(trackId, note), ms); }

  async auditionLoop(notes, { inst, kit, bars, loopLen }) {
    await this.init(); this.stopAudition();
    const ctx = this.ctx, out = ctx.createGain(); out.gain.value = 0.9; out.connect(this.graph.masterIn);
    const fake = { type: inst ? 'synth' : 'drums', inst, kit };
    const spb = 60 / S.project.bpm, len = loopLen * spb;
    let next = ctx.currentTime + 0.08;
    const run = () => {
      while (next < ctx.currentTime + 0.3) {
        for (const n of notes) triggerNote(this.graph, fake, out, n.p, next + n.s * spb, n.l * spb, n.v);
        next += len;
      }
    };
    run(); this.auditionTimer = setInterval(run, 100); this.auditionOut = out;
    emit('audition', true);
  }
  stopAudition() {
    if (this.auditionTimer) { clearInterval(this.auditionTimer); this.auditionTimer = null; const o = this.auditionOut; o.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02); setTimeout(() => o.disconnect(), 400); emit('audition', false); }
  }
  async auditionBuffer(buf) { await this.init(); this.stopAudition(); const s = this.ctx.createBufferSource(); s.buffer = buf; s.connect(this.graph.masterIn); s.start(); }
  trackLevel(id) { const n = this.graph?.tracks.get(id); return n ? n.peak() : 0; }
  masterLevels() { return this.graph ? this.graph.levels() : [0, 0]; }
}
export const engine = new Engine();
