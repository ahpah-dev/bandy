// High-level user actions shared by menus, shortcuts and panels.
import { h, toast, emit, uid, download, modal, confirmDialog, promptDialog } from '../util.js';
import { S, settings, getTrack, findRegion, addTrack, addRegion, makeAudioRegion, makeMidiRegion, checkpoint, changed, selectRegions, newProject, loadProject, beatsPerBar, projectEnd, TRACK_KINDS, presetChain, selectTrack, setProjectTempo } from '../state.js';
import { engine } from '../audio/engine.js';
import { buildLoop } from '../audio/loops.js';
import * as storage from '../storage.js';
import { renderMix, exportStems, exportMidi } from '../audio/render.js';
import { encodeWav } from '../audio/dsp.js';

export function openEditorFor(regionId) { S.editRegion = regionId; S.ui.bottomOpen = true; S.ui.bottomTab = 'editor'; S.ui.bottomH = Math.max(S.ui.bottomH, Math.min(Math.round(innerHeight * 0.56), 460)); emit('layout'); emit('editor'); }

export async function importAudioFiles(files, { beat, trackId } = {}) {
  await engine.init();
  const at = beat ?? Math.max(0, S.pos);
  let n = 0; checkpoint();
  for (const f of files) {
    try {
      const ab = await f.arrayBuffer();
      const buf = await engine.ctx.decodeAudioData(ab);
      const id = uid('b'); S.buffers.set(id, buf);
      const name = f.name.replace(/\.[^.]+$/, '');
      let t = trackId ? getTrack(trackId) : null;
      if (!t || t.type !== 'audio') { t = addTrack('audio', { name }); checkpoint(); }
      const r = makeAudioRegion(id, at, buf.duration, name);
      t.regions.push(r); selectRegions([r.id]); n++;
    } catch (e) { toast(`Couldn't decode ${f.name}`, 'error'); console.error(e); }
  }
  if (n) { changed(); toast(`Imported ${n} file${n > 1 ? 's' : ''}`); }
}
export function pickAudioFiles(opts) { const i = h('input', { type: 'file', accept: 'audio/*,video/*', multiple: true }); i.onchange = () => importAudioFiles([...i.files], opts); i.click(); }

export function addLoopToProject(loop, { beat, trackId } = {}) {
  if (!loop) return;
  checkpoint();
  const p = S.project, empty = !p.tracks.some((t) => t.regions.length);
  if (empty) { p.bpm = loop.bpm; p.scale = loop.scale; }
  const isDrums = loop.type === 'Drums';
  let t = trackId ? getTrack(trackId) : null;
  if (t && !((isDrums && t.type === 'drums') || (!isDrums && t.type === 'synth'))) t = null;
  if (!t) { const sel = getTrack(S.sel.track); if (sel && !sel.regions.length && ((isDrums && sel.type === 'drums') || (!isDrums && sel.type === 'synth'))) t = sel; }
  if (!t) t = addTrack(isDrums ? 'drums' : 'synth', { name: loop.name.replace(/^.*? /, '') && loop.name, inst: loop.inst, kit: loop.kit });
  else if (isDrums) t.kit = loop.kit; else t.inst = loop.inst;
  const bpb = beatsPerBar();
  const start = beat ?? (empty ? 0 : Math.ceil(Math.max(S.pos, projectEnd() && S.pos ? S.pos : 0) / bpb - 1e-6) * bpb);
  const r = makeMidiRegion(start, loop.bars * 4, buildLoop(loop, p.key), loop.name);
  t.regions.push(r); selectRegions([r.id]); changed();
  toast(`Added “${loop.name}”`);
}

export function openNewTrackDialog() {
  const kinds = ['voice', 'synth', 'drums', 'guitar', 'bass', 'sampler'];
  const m = modal('Add a track', h('div', { class: 'kind-grid' },
    kinds.map((k) => h('button', { class: 'kind-card', onclick: () => { m.close(); const t = addTrack(k); if (t.type === 'audio' || k === 'synth' || k === 'drums') t.arm = false; changed(); } }, h('div', { class: 'kc-ic', html: iconFor(k) }), h('div', { class: 'kc-name' }, TRACK_KINDS[k].label), h('div', { class: 'kc-desc' }, TRACK_KINDS[k].desc))),
    h('button', { class: 'kind-card', onclick: () => { m.close(); pickAudioFiles(); } }, h('div', { class: 'kc-ic', html: iconFor('upload') }), h('div', { class: 'kc-name' }, 'Import audio'), h('div', { class: 'kc-desc' }, 'WAV, MP3, OGG, FLAC, M4A…')),
    h('button', { class: 'kind-card', onclick: () => { m.close(); S.ui.sideOpen = true; S.ui.sideTab = 'loops'; emit('layout'); } }, h('div', { class: 'kc-ic', html: iconFor('loops') }), h('div', { class: 'kc-name' }, 'Loops'), h('div', { class: 'kc-desc' }, 'Browse the built-in loop library')),
  ), { width: 640 });
}
import { icon } from '../icons.js';
const iconFor = (k) => icon(TRACK_KINDS[k]?.icon || k, 28);

// ---------- project lifecycle ----------
export async function saveNow(quiet = false) {
  try { await storage.saveProject(); if (!quiet) toast('Project saved'); emit('saved'); } catch (e) { console.error(e); toast('Could not save: ' + e.message, 'error'); }
}
export async function newProjectAction(template = 'blank') {
  if (S.dirty && !(await confirmDialog('Start a new project?', 'Unsaved changes in the current project will be lost.', 'Discard & continue'))) return;
  engine.pause(); loadProject(newProject()); S.buffers.clear();
  if (template === 'beat') { const { LOOP_BY_ID } = await import('../audio/loops.js'); S.project.bpm = 90; addLoopToProject(LOOP_BY_ID['hiphop-drums0'], { beat: 0 }); addLoopToProject(LOOP_BY_ID['hiphop-bass0'], { beat: 0 }); addLoopToProject(LOOP_BY_ID['hiphop-chords0'], { beat: 0 }); S.sel.regions = new Set(); S.dirty = false; }
  if (template === 'vocal') { S.project.bpm = 100; addTrack('voice'); addTrack('synth'); S.dirty = false; }
  if (template === 'band') { S.project.bpm = 110; addTrack('drums'); addTrack('bass'); addTrack('guitar'); addTrack('voice'); S.dirty = false; }
  engine.sync(); emit('load');
}
export async function openProjectById(id) {
  await engine.init(); engine.pause();
  const p = await storage.loadProjectData(id, engine.ctx);
  loadProject(p); engine.sync();
}
export async function openProjectDialog() {
  const list = await storage.listProjects();
  const body = h('div', { class: 'proj-list' });
  const m = modal('Open project', body, { width: 560, actions: [{ label: 'Import .bandy file…', action: () => { importProjectDialog(); } }, { label: 'Close' }] });
  if (!list.length) body.append(h('p', { class: 'muted' }, 'No saved projects yet. Your work is saved in this browser automatically.'));
  for (const p of list) body.append(h('div', { class: 'proj-row' },
    h('div', { class: 'proj-info', onclick: async () => { m.close(); await openProjectById(p.id); } }, h('div', { class: 'proj-name' }, p.name || 'Untitled'), h('div', { class: 'muted small' }, `${p.tracks} tracks · ${p.bpm} BPM · ${new Date(p.updated).toLocaleString()}`)),
    h('button', { class: 'icon-btn', title: 'Delete', html: icon('trash', 16), onclick: async (e) => { if (await confirmDialog('Delete project?', `“${p.name}” will be permanently deleted from this browser.`, 'Delete')) { await storage.deleteProject(p.id); e.target.closest('.proj-row').remove(); } } })));
}
export function importProjectDialog() {
  const i = h('input', { type: 'file', accept: '.bandy,.zip' });
  i.onchange = async () => { try { await engine.init(); const p = await storage.importProjectFile(i.files[0], engine.ctx); p.id = uid('p'); engine.pause(); loadProject(p); engine.sync(); toast('Project imported'); } catch (e) { toast(e.message, 'error'); } };
  i.click();
}
export async function exportProjectAction() { const blob = await storage.exportProjectFile(); download(blob, (S.project.name || 'project') + '.bandy'); }

// ---------- export ----------
export function openExportDialog() {
  const p = S.project;
  const hasLoop = p.loop.on;
  const state = { fmt: 'wav', bits: '16', range: 'all', normalize: false, sr: '44100', tail: true };
  const sel = (key, opts) => h('select', { class: 'select', onchange: (e) => (state[key] = e.target.value) }, opts.map(([v, l]) => h('option', { value: v }, l)));
  const bar = h('div', { class: 'progress', style: { display: 'none' } }, h('div'));
  const status = h('div', { class: 'muted small' });
  const body = h('div', { class: 'form' },
    h('label', null, h('span', null, 'Format'), sel('fmt', [['wav', 'WAV – mixdown'], ['stems', 'WAV stems (.zip)'], ['midi', 'MIDI file (.mid)'], ['project', 'Bandy project (.bandy)']])),
    h('label', null, h('span', null, 'Bit depth'), sel('bits', [['16', '16-bit'], ['24', '24-bit'], ['32', '32-bit float']])),
    h('label', null, h('span', null, 'Sample rate'), sel('sr', [['44100', '44.1 kHz'], ['48000', '48 kHz']])),
    h('label', null, h('span', null, 'Range'), sel('range', [['all', 'Whole project'], ...(hasLoop ? [['loop', 'Loop region only']] : [])])),
    h('label', { class: 'chk-row' }, h('input', { type: 'checkbox', onchange: (e) => (state.normalize = e.target.checked) }), h('span', null, 'Normalise to −0.2 dBFS')),
    bar, status,
    h('p', { class: 'muted small' }, 'Made something great? Share it in the ', h('a', { href: 'songs.html', target: '_blank', rel: 'noopener', style: { color: 'var(--accent2)' } }, 'Song browser'), '.'));
  const m = modal('Export', body, { width: 460, actions: [{ label: 'Cancel' }, { label: 'Export', primary: true, keepOpen: true, action: async (close) => {
    const name = (p.name || 'project').replace(/[\\/:*?"<>|]/g, '_');
    try {
      if (state.fmt === 'midi') { download(exportMidi(), name + '.mid'); close(); return; }
      if (state.fmt === 'project') { await exportProjectAction(); close(); return; }
      if (!projectEnd()) { toast('Nothing to export yet', 'warn'); return; }
      bar.style.display = ''; status.textContent = 'Rendering…'; bar.firstChild.style.width = '15%';
      await new Promise((r) => setTimeout(r, 30));
      const range = state.range === 'loop' ? { from: p.loop.start, to: p.loop.end } : {};
      const opts = { ...range, sampleRate: +state.sr, normalize: state.normalize, bits: +state.bits };
      if (state.fmt === 'wav') { const buf = await renderMix(opts); bar.firstChild.style.width = '80%'; download(encodeWav(buf, +state.bits), name + '.wav'); }
      else { const blob = await exportStems(opts, (f, n) => { bar.firstChild.style.width = 10 + f * 85 + '%'; status.textContent = 'Rendering ' + n + '…'; }); download(blob, name + ' stems.zip'); }
      toast('Export complete'); close();
    } catch (e) { console.error(e); toast('Export failed: ' + e.message, 'error'); bar.style.display = 'none'; }
    return false;
  } }] });
}

export async function bounceRegionToWav(regionId) {
  const f = findRegion(regionId); if (!f) return;
  const buf = await renderMix({ from: f.region.start, to: f.region.start + f.region.length, tracks: [f.track.id], tail: 1 });
  download(encodeWav(buf, 24), f.region.name + '.wav');
}
