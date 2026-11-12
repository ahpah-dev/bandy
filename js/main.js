// Bandy – application bootstrap, layout and keyboard shortcuts.
import { h, on, emit, toast, debounce, closeMenu } from './util.js';
import { S, settings, newProject, loadProject, loadInstrumentLibrary, undo, redo, selectRegions, getTrack, checkpoint, changed, deleteRegions, copyRegions, pasteRegions, duplicateRegions, splitSelectedAt, beatsPerBar, projectEnd, snapBeat, findRegion } from './state.js';
import { engine } from './audio/engine.js';
import { startRecording, stopRecording, liveNote, initMidi } from './audio/record.js';
import { initTopbar, toggleRecord } from './ui/topbar.js';
import { initTimeline, zoomBy, zoomToFit } from './ui/timeline.js';
import { initSidebar } from './ui/sidebar.js';
import { initBottom } from './ui/bottom.js';
import { typingKey } from './ui/editors.js';
import { applyTheme, openShortcuts, openTemplates } from './ui/dialogs.js';
import { saveNow, openExportDialog, pickAudioFiles, openNewTrackDialog, openProjectDialog, openEditorFor, importAudioFiles } from './ui/actions.js';
import * as storage from './storage.js';

async function boot() {
  applyTheme();
  loadInstrumentLibrary(); // user's custom synth sounds, registered before any project is loaded
  S.ui.bottomH = Math.max(280, Math.min(420, Math.round(innerHeight * 0.44)));
  loadProject(newProject());
  const app = document.getElementById('app');
  app.replaceChildren();
  const top = h('header', { id: 'topbar' }), studio = h('section', { id: 'studio' }), tl = h('div', { id: 'timeline' }), bottom = h('div', { id: 'bottom' }), side = h('aside', { id: 'sidebar' });
  studio.append(tl, bottom);
  app.append(top, h('main', { id: 'workspace' }, studio, side));
  initTopbar(top); initTimeline(tl); initBottom(bottom); initSidebar(side);
  applyLayout(); on('layout', applyLayout);

  // engine sync
  on('project', () => engine.sync());
  on('load', () => { engine.sync(); applyLayout(); });
  on('settings', applyTheme);

  // auto-save
  const autosave = debounce(() => { if (settings.autoSave && S.dirty) saveNow(true); }, 1800);
  on('project', autosave);
  window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

  // restore last project
  try {
    const list = await storage.listProjects();
    const last = localStorage.getItem('bandy.last');
    const hit = list.find((p) => p.id === last);
    if (hit && JSON.parse(hit.json).tracks.length) {
      const AC = window.AudioContext; // decoding needs a context; use an offline helper so we don't need a user gesture
      const tmp = new OfflineAudioContext(2, 1, 44100);
      const p = await storage.loadProjectData(hit.id, tmp);
      loadProject(p); engine.sync();
    }
  } catch (e) { console.warn('restore failed', e); }
  on('project', () => localStorage.setItem('bandy.last', S.project.id));
  on('load', () => localStorage.setItem('bandy.last', S.project.id));
  if (!localStorage.getItem('bandy.welcomed')) { localStorage.setItem('bandy.welcomed', '1'); if (!S.project.tracks.length) openTemplates(); }

  // drag & drop files anywhere
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); const f = [...e.dataTransfer.files]; if (f.length && !e.defaultPrevented) { if (e.target.closest?.('.tl-scroll')) return; importAudioFiles(f); } });
  initMidi();
  window.bandy = { S, engine }; // handy for debugging in devtools
}

function applyLayout() {
  document.getElementById('sidebar')?.classList.toggle('closed', !S.ui.sideOpen);
  document.getElementById('workspace')?.classList.toggle('side-closed', !S.ui.sideOpen);
}

// ---------- keyboard shortcuts ----------
const isEditable = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
window.addEventListener('keyup', (e) => { if (!isEditable(e.target)) typingKey(e, false); });
window.addEventListener('keydown', (e) => {
  if (isEditable(e.target)) { if (e.key === 'Escape') e.target.blur(); return; }
  if (document.querySelector('.modal-back')) return;
  if (e.target.closest?.('.pr') && ['Delete', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !e.defaultPrevented) { /* piano roll handles */ }
  if (e.defaultPrevented) return;
  if (typingKey(e, true)) { e.preventDefault(); return; }
  const k = e.key, ctrl = e.ctrlKey || e.metaKey, lk = k.toLowerCase();
  const sel = [...S.sel.regions];
  const T = () => getTrack(S.sel.track);
  if (e.target.closest?.('.pr') && (ctrl || ['Delete', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'd', 'e', 's'].includes(lk))) return; // piano roll owns these
  if (k === ' ') { e.preventDefault(); engine.recording ? stopRecording() : engine.toggle(); }
  else if (ctrl && lk === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (ctrl && lk === 'y') { e.preventDefault(); redo(); }
  else if (ctrl && lk === 's') { e.preventDefault(); saveNow(); }
  else if (ctrl && lk === 'e') { e.preventDefault(); openExportDialog(); }
  else if (ctrl && lk === 'o') { e.preventDefault(); openProjectDialog(); }
  else if (ctrl && lk === 'i') { e.preventDefault(); pickAudioFiles(); }
  else if (ctrl && lk === 'c') { copyRegions(sel); }
  else if (ctrl && lk === 'x') { copyRegions(sel); deleteRegions(sel); }
  else if (ctrl && lk === 'v') { pasteRegions(engine.pos()); }
  else if (ctrl && lk === 'd') { e.preventDefault(); duplicateRegions(sel); }
  else if (ctrl && lk === 'a') { e.preventDefault(); selectRegions(S.project.tracks.flatMap((t) => t.regions.map((r) => r.id))); }
  else if (k === 'Delete' || k === 'Backspace') { deleteRegions(sel); }
  else if (k === 'Enter' && sel.length) { openEditorFor(sel[0]); }
  else if (k === 'Home') { engine.seek(S.project.loop.on ? S.project.loop.start : 0); }
  else if (k === 'ArrowLeft') { engine.seek(Math.max(0, Math.floor((engine.pos() - 0.01) / beatsPerBar()) * beatsPerBar())); }
  else if (k === 'ArrowRight') { engine.seek((Math.floor(engine.pos() / beatsPerBar() + 1e-6) + 1) * beatsPerBar()); }
  else if (ctrl) return;
  else if (lk === 'r') { toggleRecord(); }
  else if (lk === 'l') { checkpoint(); S.project.loop.on = !S.project.loop.on; changed(); }
  else if (lk === 'k') { S.ui.metronome = !S.ui.metronome; emit('settings'); document.querySelector('.tbtn[title^="Metronome"]')?.classList.toggle('on', S.ui.metronome); }
  else if (lk === 's') { if (e.shiftKey) { const t = T(); if (t) { checkpoint(); t.solo = !t.solo; changed(); } } else splitSelectedAt(engine.pos()); }
  else if (lk === 'm') { const t = T(); if (t) { checkpoint(); t.mute = !t.mute; changed(); } }
  else if (lk === 'a') { const t = T(); if (t) { checkpoint(); t.arm = !t.arm; changed(); } }
  else if (lk === 't') { openNewTrackDialog(); }
  else if (lk === 'f') { zoomToFit(); }
  else if (lk === 'v') { S.ui.tool = 'select'; document.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === 'select')); document.getElementById('timeline').classList.remove('tool-split'); }
  else if (lk === 'c') { S.ui.tool = 'split'; document.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === 'split')); document.getElementById('timeline').classList.add('tool-split'); }
  else if (k === '+' || k === '=') zoomBy(1.3);
  else if (k === '-' || k === '_') zoomBy(1 / 1.3);
  else if (k === '?') openShortcuts();
  else if (k === 'Escape') { closeMenu(); selectRegions([]); }
  else return;
});

boot();
