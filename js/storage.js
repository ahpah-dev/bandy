// IndexedDB persistence for projects + audio, plus .bandy (zip) import/export.
import { S } from './state.js';
import { encodeWav } from './audio/dsp.js';
import { zip, unzip } from './zip.js';

const DB = 'bandy', VER = 1;
let dbp;
function db() {
  return (dbp ||= new Promise((res, rej) => {
    const rq = indexedDB.open(DB, VER);
    rq.onupgradeneeded = () => { const d = rq.result; d.createObjectStore('projects', { keyPath: 'id' }); d.createObjectStore('audio'); };
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  }));
}
const tx = async (store, mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const r = fn(t.objectStore(store)); t.oncomplete = () => res(r.result); t.onerror = () => rej(t.error); }); };

export async function saveProject() {
  const p = S.project;
  const meta = { id: p.id, name: p.name, updated: Date.now(), bpm: p.bpm, tracks: p.tracks.length, json: JSON.stringify(p) };
  await tx('projects', 'readwrite', (s) => s.put(meta));
  const used = new Set(p.tracks.flatMap((t) => [...t.regions.filter((r) => r.type === 'audio').map((r) => r.bufferId), ...(t.pads || []).map((x) => x.bufferId).filter(Boolean)]));
  for (const id of used) {
    const key = p.id + ':' + id;
    const exists = await tx('audio', 'readonly', (s) => s.count(key));
    if (exists) continue;
    const b = S.buffers.get(id); if (!b) continue;
    const channels = [...Array(b.numberOfChannels)].map((_, c) => b.getChannelData(c).slice().buffer);
    await tx('audio', 'readwrite', (s) => s.put({ sr: b.sampleRate, channels }, key));
  }
  S.dirty = false;
}
export async function listProjects() {
  const all = await tx('projects', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => b.updated - a.updated);
}
export async function deleteProject(id) {
  await tx('projects', 'readwrite', (s) => s.delete(id));
  const d = await db(); const keys = await new Promise((res) => { const r = d.transaction('audio').objectStore('audio').getAllKeys(); r.onsuccess = () => res(r.result); });
  for (const k of keys) if (String(k).startsWith(id + ':')) await tx('audio', 'readwrite', (s) => s.delete(k));
}
export async function loadProjectData(id, ctx) {
  const meta = await tx('projects', 'readonly', (s) => s.get(id)); if (!meta) throw new Error('Project not found');
  const p = JSON.parse(meta.json);
  S.buffers.clear();
  const ids = new Set(p.tracks.flatMap((t) => [...t.regions.filter((r) => r.type === 'audio').map((r) => r.bufferId), ...(t.pads || []).map((x) => x.bufferId).filter(Boolean)]));
  for (const bid of ids) {
    const rec = await tx('audio', 'readonly', (s) => s.get(p.id + ':' + bid)); if (!rec) continue;
    const b = ctx.createBuffer(rec.channels.length, rec.channels[0].byteLength / 4, rec.sr);
    rec.channels.forEach((ab, c) => b.copyToChannel(new Float32Array(ab), c));
    S.buffers.set(bid, b);
  }
  return p;
}

export async function exportProjectFile(p = S.project) {
  const files = [{ name: 'project.json', data: new TextEncoder().encode(JSON.stringify(p)) }];
  for (const [id, b] of S.buffers) {
    const used = JSON.stringify(p).includes(id); if (!used) continue;
    files.push({ name: `audio/${id}.wav`, data: new Uint8Array(await encodeWav(b, 32).arrayBuffer()) });
  }
  return new Blob([zip(files)], { type: 'application/zip' });
}
export async function importProjectFile(file, ctx) {
  const entries = await unzip(new Uint8Array(await file.arrayBuffer()));
  const pj = entries.find((e) => e.name === 'project.json'); if (!pj) throw new Error('Not a Bandy project file');
  const p = JSON.parse(new TextDecoder().decode(pj.data));
  S.buffers.clear();
  for (const e of entries) if (e.name.startsWith('audio/')) {
    const id = e.name.slice(6, -4);
    const ab = await ctx.decodeAudioData(e.data.buffer.slice(e.data.byteOffset, e.data.byteOffset + e.data.byteLength));
    S.buffers.set(id, ab);
  }
  return p;
}
