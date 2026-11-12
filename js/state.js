// Project model, selection, undo/redo and editing operations.
import { uid, clamp, emit, on, toast, TRACK_COLORS } from './util.js';
import { INSTRUMENTS, KITS, sanitizeInstrument, setCustomInstruments, getCustomInstrument, isBuiltinInstrument } from './audio/synth.js';
import { FX_PRESETS, defaultParams } from './audio/effects.js';

export const SETTINGS_KEY = 'bandy.settings.v1';
const defaultSettings = { theme: 'dark', latencyMs: 0, inputDeviceId: '', metroVol: 0.6, follow: true, countIn: true, autoSave: true, monitor: false, trackHeight: 96 };
export const settings = Object.assign({}, defaultSettings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
export function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); emit('settings'); }

export const S = {
  project: null,
  sel: { track: null, regions: new Set() },
  ui: { ppb: 56, snap: 0.25, sideTab: 'loops', sideOpen: true, bottomTab: 'mixer', bottomOpen: true, bottomH: 300, automation: null, metronome: false, tool: 'select', scrollX: 0 },
  buffers: new Map(),
  clipboard: null,
  pos: 0, // transport position in beats (when stopped)
  dirty: false,
};

// ---- custom instruments ----
// Two sources feed the registry: the user's library (localStorage, synth sounds only) and the open project's
// `customInstruments` map (synth sounds used by its tracks, plus every sample instrument of the project).
export const INST_LIB_KEY = 'bandy.instruments';
let library = [];
export const getLibrary = () => library;
export function loadInstrumentLibrary() {
  let raw = [];
  try { raw = JSON.parse(localStorage.getItem(INST_LIB_KEY) || '[]'); } catch { raw = []; }
  library = (Array.isArray(raw) ? raw : []).map((d) => sanitizeInstrument(d)).filter((d) => d && d.type !== 'sample');
  refreshInstrumentRegistry();
  return library;
}
export function saveLibrary(defs) {
  library = defs.filter((d) => d && d.type !== 'sample');
  refreshInstrumentRegistry();
  try { localStorage.setItem(INST_LIB_KEY, JSON.stringify(library)); return true; } catch (e) { toast('Could not save the instrument library: ' + e.message, 'error'); return false; }
}
export function refreshInstrumentRegistry(p = S.project) {
  const byId = new Map();
  for (const d of library) byId.set(d.id, d);
  for (const d of Object.values(p?.customInstruments || {})) if (d && !byId.has(d.id)) byId.set(d.id, d);
  setCustomInstruments([...byId.values()]);
}
// Sanitizes the project's embedded definitions in place (they come from JSON files and may be hand-edited).
export function cleanEmbeddedInstruments(p) {
  const out = {};
  for (const [id, d] of Object.entries(p.customInstruments || {})) {
    if (!d || typeof d !== 'object') continue;
    const c = sanitizeInstrument({ ...d, id });
    if (c && c.id === id) out[id] = c;
  }
  if (Object.keys(out).length) p.customInstruments = out; else delete p.customInstruments;
}
// Embeds the definitions the project needs: every sample instrument, and each custom synth sound a track uses.
export function syncProjectInstruments(p = S.project) {
  if (!p) return;
  const prev = p.customInstruments || {}, next = {};
  for (const [id, d] of Object.entries(prev)) if (d?.type === 'sample') next[id] = d;
  for (const t of p.tracks) {
    if (t.type !== 'synth' || !t.inst || isBuiltinInstrument(t.inst)) continue;
    const d = getCustomInstrument(t.inst) || prev[t.inst];
    if (d) next[t.inst] = d;
  }
  if (Object.keys(next).length) p.customInstruments = next; else delete p.customInstruments;
  refreshInstrumentRegistry(p);
}

export const beatsPerBar = (p = S.project) => (p.sig[0] * 4) / p.sig[1];
export const getTrack = (id) => S.project.tracks.find((t) => t.id === id);
export function findRegion(id) { for (const t of S.project.tracks) { const r = t.regions.find((x) => x.id === id); if (r) return { track: t, region: r }; } return null; }
export const selectedRegions = () => [...S.sel.regions].map(findRegion).filter(Boolean);
export const projectEnd = () => Math.max(0, ...S.project.tracks.flatMap((t) => t.regions.map((r) => r.start + r.length)));
export const contentBeats = (r, p = S.project) => (r.type === 'midi' ? r.loopLen : (r.srcLen / (r.speed || 1)) * (p.bpm / 60));

export function newProject(name = 'Untitled') {
  return { v: 1, id: uid('p'), name, bpm: 100, sig: [4, 4], key: 0, scale: 'major', loop: { on: false, start: 0, end: 16 }, master: { vol: 0, mastering: 'Off' }, tracks: [], lyrics: '', created: Date.now(), bufMeta: {} };
}

export function fxFromChain(chain) { return chain.map((c) => ({ id: uid('fx'), type: c.type, params: { ...defaultParams(c.type), ...c.params }, bypass: false })); }
export const presetChain = (name) => { const p = FX_PRESETS.find((x) => x[1] === name); return p ? fxFromChain(p[2]) : []; };

export const TRACK_KINDS = {
  voice: { label: 'Voice / Mic', type: 'audio', icon: 'mic', fx: 'Clean Vocal', desc: 'Record vocals or any microphone input' },
  guitar: { label: 'Guitar', type: 'audio', icon: 'guitar', fx: 'Crunch', desc: 'Plug in a guitar with amp simulation' },
  bass: { label: 'Bass', type: 'audio', icon: 'bass', fx: 'Clean DI', desc: 'Record bass with a DI chain' },
  synth: { label: 'Instrument', type: 'synth', icon: 'piano', desc: 'Play 20+ built-in synths with your keyboard or MIDI' },
  drums: { label: 'Drums', type: 'drums', icon: 'drum', desc: 'Program beats on a synthesised drum kit' },
  sampler: { label: 'Sampler', type: 'sampler', icon: 'pads', desc: '16 pads – load samples or record your own' },
  audio: { label: 'Audio', type: 'audio', icon: 'wave', desc: 'Imported audio files' },
};

export function makeTrack(kind = 'synth', opts = {}) {
  const k = TRACK_KINDS[kind];
  const idx = S.project.tracks.length;
  const t = {
    id: uid('t'), name: opts.name || k.label, kind, type: k.type, color: opts.color || TRACK_COLORS[idx % TRACK_COLORS.length],
    vol: 0, pan: 0, mute: false, solo: false, arm: false, monitor: false, height: settings.trackHeight, fx: opts.fx || (k.fx ? presetChain(k.fx) : []), regions: [], auto: { volume: [], pan: [] },
    inst: opts.inst || (k.type === 'synth' ? 'grand' : null), kit: opts.kit || (k.type === 'drums' || k.type === 'sampler' ? 'acoustic' : null),
  };
  if (k.type === 'sampler') t.pads = [...Array(16)].map((_, i) => ({ note: 36 + i, name: '', bufferId: null, vol: 0, pitch: 0 }));
  return t;
}
export function addTrack(kind = 'synth', opts = {}) {
  checkpoint();
  const t = makeTrack(kind, opts);
  S.project.tracks.push(t);
  S.sel.track = t.id;
  changed();
  return t;
}
export function removeTrack(id) {
  checkpoint();
  const p = S.project, i = p.tracks.findIndex((t) => t.id === id);
  if (i < 0) return;
  p.tracks.splice(i, 1);
  S.sel.regions = new Set([...S.sel.regions].filter((rid) => findRegion(rid)));
  if (S.sel.track === id) S.sel.track = p.tracks[Math.min(i, p.tracks.length - 1)]?.id ?? null;
  changed();
}
export function duplicateTrack(id) {
  checkpoint();
  const t = getTrack(id), c = JSON.parse(JSON.stringify(t));
  c.id = uid('t'); c.name = t.name + ' copy'; c.regions.forEach((r) => (r.id = uid('r'))); c.fx.forEach((f) => (f.id = uid('fx')));
  S.project.tracks.splice(S.project.tracks.indexOf(t) + 1, 0, c);
  S.sel.track = c.id; changed();
}
export function moveTrack(id, dir) {
  const a = S.project.tracks, i = a.findIndex((t) => t.id === id), j = i + dir;
  if (j < 0 || j >= a.length) return;
  checkpoint(); [a[i], a[j]] = [a[j], a[i]]; changed();
}

export function makeMidiRegion(start, length, notes = [], name = 'Region') {
  return { id: uid('r'), type: 'midi', name, start, length, loopLen: length, notes, muted: false };
}
export function makeAudioRegion(bufferId, start, bufferDur, name = 'Audio') {
  const p = S.project;
  return { id: uid('r'), type: 'audio', name, start, length: bufferDur * (p.bpm / 60), bufferId, srcOffset: 0, srcLen: bufferDur, speed: 1, pitch: 0, reverse: false, gain: 0, fadeIn: 0, fadeOut: 0, muted: false };
}
export function addRegion(trackId, region) { const t = getTrack(trackId); t.regions.push(region); changed(); return region; }

// ---- selection ----
export function selectRegions(ids, additive = false) {
  if (!additive) S.sel.regions = new Set();
  for (const id of ids) additive && S.sel.regions.has(id) ? S.sel.regions.delete(id) : S.sel.regions.add(id);
  const f = findRegion([...S.sel.regions][0]);
  if (f) S.sel.track = f.track.id;
  emit('selection');
}
export function selectTrack(id) { S.sel.track = id; emit('selection'); }

// ---- history ----
const undoStack = [], redoStack = [];
const snap = () => JSON.stringify(S.project);
export function checkpoint() { undoStack.push(snap()); if (undoStack.length > 120) undoStack.shift(); redoStack.length = 0; emit('history'); }
function restore(s) {
  S.project = JSON.parse(s);
  cleanEmbeddedInstruments(S.project);
  S.sel.regions = new Set([...S.sel.regions].filter((id) => findRegion(id)));
  if (!getTrack(S.sel.track)) S.sel.track = S.project.tracks[0]?.id ?? null;
  changed(true);
}
export function undo() { if (!undoStack.length) return; redoStack.push(snap()); restore(undoStack.pop()); emit('history'); }
export function redo() { if (!redoStack.length) return; undoStack.push(snap()); restore(redoStack.pop()); emit('history'); }
export const canUndo = () => undoStack.length > 0, canRedo = () => redoStack.length > 0;
export function resetHistory() { undoStack.length = 0; redoStack.length = 0; emit('history'); }

export function changed(full = false) { syncProjectInstruments(); S.dirty = true; emit('project', { full }); }
export function loadProject(p) { cleanEmbeddedInstruments(p); S.project = p; refreshInstrumentRegistry(p); S.sel = { track: p.tracks[0]?.id ?? null, regions: new Set() }; S.pos = 0; resetHistory(); S.dirty = false; emit('project', { full: true }); emit('selection'); emit('load'); }

// ---- snapping ----
export function snapBeat(b, force = false, ppb = S.ui.ppb) { const g = S.ui.snap; if (!g) return b; return Math.round(b / g) * g; }

// ---- region editing ----
export function deleteRegions(ids) {
  if (!ids.length) return; checkpoint();
  for (const t of S.project.tracks) t.regions = t.regions.filter((r) => !ids.includes(r.id));
  S.sel.regions = new Set(); changed();
}
function cloneRegion(r, dStart = 0) { const c = JSON.parse(JSON.stringify(r)); c.id = uid('r'); c.start += dStart; if (c.notes) c.notes.forEach((n) => (n.id = uid('n'))); return c; }
export function duplicateRegions(ids, offsetBeats) {
  checkpoint();
  const out = [];
  for (const id of ids) { const f = findRegion(id); if (!f) continue; const c = cloneRegion(f.region, offsetBeats ?? f.region.length); f.track.regions.push(c); out.push(c.id); }
  S.sel.regions = new Set(out); changed(); return out;
}
export function copyRegions(ids) {
  const items = ids.map(findRegion).filter(Boolean); if (!items.length) return;
  const min = Math.min(...items.map((x) => x.region.start));
  S.clipboard = items.map((x) => ({ trackId: x.track.id, region: JSON.parse(JSON.stringify(x.region)), rel: x.region.start - min }));
}
export function pasteRegions(at) {
  if (!S.clipboard?.length) return;
  checkpoint();
  const out = [];
  const selT = getTrack(S.sel.track);
  S.clipboard.forEach((c, i) => {
    let t = getTrack(c.trackId);
    if (S.clipboard.length === 1 && selT && compatible(selT, c.region)) t = selT;
    if (!t) t = selT; if (!t) return;
    const r = cloneRegion(c.region, 0); r.start = at + c.rel; t.regions.push(r); out.push(r.id);
  });
  S.sel.regions = new Set(out); changed();
}
export const compatible = (track, region) => (region.type === 'audio' ? track.type === 'audio' : track.type !== 'audio');

function unroll(track, r) {
  const C = contentBeats(r);
  if (r.length <= C + 1e-6) return [r];
  const pieces = []; let pos = 0;
  while (pos < r.length - 1e-6) { const c = cloneRegion(r, pos); c.length = Math.min(C, r.length - pos); if (c.type === 'midi') c.loopLen = C; pieces.push(c); pos += C; }
  const i = track.regions.indexOf(r); track.regions.splice(i, 1, ...pieces);
  return pieces;
}
export function splitRegionAt(id, beat) {
  const f = findRegion(id); if (!f) return false;
  let { track, region } = f;
  if (beat <= region.start + 1e-4 || beat >= region.start + region.length - 1e-4) return false;
  checkpoint();
  const pieces = unroll(track, region);
  region = pieces.find((x) => beat > x.start - 1e-6 && beat < x.start + x.length - 1e-6 + 1e-6 && beat >= x.start) || pieces[0];
  if (beat <= region.start + 1e-4 || beat >= region.start + region.length - 1e-4) { changed(); return true; }
  const k = beat - region.start, right = cloneRegion(region, k);
  right.length = region.length - k;
  if (region.type === 'midi') {
    const L = region.notes.filter((n) => n.s < k - 1e-6).map((n) => ({ ...n, l: Math.min(n.l, k - n.s) }));
    right.notes = region.notes.filter((n) => n.s >= k - 1e-6).map((n) => ({ ...n, id: uid('n'), s: n.s - k }));
    region.notes = L; region.loopLen = k; right.loopLen = right.length;
  } else {
    const secs = (k * 60 / S.project.bpm) * region.speed;
    right.srcOffset = region.srcOffset + secs; right.srcLen = region.srcLen - secs; region.srcLen = secs;
    right.fadeIn = 0; region.fadeOut = 0;
  }
  region.length = k;
  track.regions.push(right);
  S.sel.regions = new Set([region.id, right.id]);
  changed(); return true;
}
export function splitSelectedAt(beat) {
  const ids = [...S.sel.regions].filter((id) => { const f = findRegion(id); return f && beat > f.region.start && beat < f.region.start + f.region.length; });
  if (!ids.length) { // split everything under playhead
    for (const t of S.project.tracks) for (const r of [...t.regions]) if (beat > r.start && beat < r.start + r.length) ids.push(r.id);
  }
  let any = false; for (const id of ids) any = splitRegionAt(id, beat) || any; return any;
}
export function mergeRegionsMidi(ids) {
  const rs = ids.map(findRegion).filter((x) => x?.region.type === 'midi'); if (rs.length < 2) return;
  checkpoint();
  const t = rs[0].track, min = Math.min(...rs.map((x) => x.region.start)), max = Math.max(...rs.map((x) => x.region.start + x.region.length));
  const notes = [];
  for (const { region: r } of rs) for (let k = 0; k * r.loopLen < r.length - 1e-6; k++) for (const n of r.notes) { const s = r.start - min + k * r.loopLen + n.s; if (n.s + k * r.loopLen < r.length) notes.push({ ...n, id: uid('n'), s }); }
  for (const x of rs) x.track.regions = x.track.regions.filter((r) => r !== x.region);
  const m = makeMidiRegion(min, max - min, notes, rs[0].region.name); t.regions.push(m);
  S.sel.regions = new Set([m.id]); changed();
}

// Time-stretch / pitch helpers adjust region length to keep content duration consistent.
export function setRegionSpeed(r, speed) { const old = r.speed || 1; r.length *= old / speed; r.speed = speed; }

export function quantizeNotes(notes, grid, strength = 1) { for (const n of notes) { const q = Math.round(n.s / grid) * grid; n.s += (q - n.s) * strength; } }
export function humanizeNotes(notes) { for (const n of notes) { n.s = Math.max(0, n.s + (Math.random() - 0.5) * 0.06); n.v = clamp(Math.round(n.v + (Math.random() - 0.5) * 22), 20, 127); } }

export function setProjectTempo(bpm) {
  bpm = clamp(Math.round(bpm * 10) / 10, 30, 300);
  const p = S.project, ratio = bpm / p.bpm; if (ratio === 1) return;
  checkpoint();
  // keep audio regions the same length in time
  for (const t of p.tracks) for (const r of t.regions) if (r.type === 'audio') r.length *= ratio;
  p.bpm = bpm; changed();
}

export { INSTRUMENTS, KITS };
