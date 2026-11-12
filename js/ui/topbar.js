// Top bar: menu, project name, transport, tempo / key / time signature, history and export.
import { h, on, emit, menuBelow, showMenu, closeMenu, fmtTime, clamp, KEYS, SCALES, toast, confirmDialog } from '../util.js';
import { icon, LOGO } from '../icons.js';
import { S, settings, saveSettings, beatsPerBar, undo, redo, canUndo, canRedo, setProjectTempo, checkpoint, changed } from '../state.js';
import { engine } from '../audio/engine.js';
import { startRecording, stopRecording } from '../audio/record.js';
import { saveNow, newProjectAction, openProjectDialog, openExportDialog, importProjectDialog, pickAudioFiles, exportProjectAction, openNewTrackDialog } from './actions.js';
import { openSettings, openShortcuts, openTuner, openAbout, openTemplates } from './dialogs.js';
import { download } from '../util.js';
import { exportMidi } from '../audio/render.js';

const els = {};
export function initTopbar(root) {
  const btn = (id, ic, title, fn, cls = '') => (els[id] = h('button', { class: 'tbtn ' + cls, title, html: icon(ic, 20), onclick: fn }));

  // left
  els.menu = h('button', { class: 'logo-btn', title: 'Menu', onclick: (e) => fileMenu(e.currentTarget) }, h('span', { html: LOGO }), h('span', { class: 'brand' }, 'Bandy'), h('span', { html: icon('chevron', 14), class: 'caret' }));
  els.name = h('input', { class: 'proj-name-input', spellcheck: 'false', title: 'Project name', onchange: (e) => { S.project.name = e.target.value.trim() || 'Untitled'; e.target.value = S.project.name; changed(); }, onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); e.stopPropagation(); } });
  els.save = h('div', { class: 'save-state' });
  const left = h('div', { class: 'tb-left' }, els.menu, h('div', { class: 'proj-box' }, els.name, els.save));

  // transport
  btn('rew', 'rewind', 'Return to start (Home)', () => engine.seek(S.project.loop.on ? S.project.loop.start : 0), 'sm');
  btn('play', 'play', 'Play / Pause (Space)', () => engine.toggle(), 'play');
  btn('rec', 'rec', 'Record (R)', () => toggleRecord(), 'rec');
  btn('loop', 'loop', 'Loop (L)', () => { checkpoint(); S.project.loop.on = !S.project.loop.on; if (S.project.loop.on && S.project.loop.end <= S.project.loop.start) S.project.loop.end = S.project.loop.start + beatsPerBar() * 4; changed(); }, 'sm');
  btn('metro', 'metro', 'Metronome (K)', () => { S.ui.metronome = !S.ui.metronome; sync(); }, 'sm');
  els.count = h('button', { class: 'tbtn sm count', title: 'Count-in before recording', onclick: () => { settings.countIn = !settings.countIn; saveSettings(); sync(); } }, '1 2 3');
  els.time = h('div', { class: 'time-disp', title: 'Click to toggle bars / time', onclick: () => { settings.barsMode = !settings.barsMode; saveSettings(); } }, h('div', { class: 'td-main' }), h('div', { class: 'td-sub' }));

  // tempo / key / sig
  els.bpm = h('input', { class: 'bpm-input', type: 'number', min: 30, max: 300, step: 1, title: 'Tempo (BPM)', onchange: (e) => setProjectTempo(+e.target.value || S.project.bpm), onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); e.stopPropagation(); } });
  els.tap = h('button', { class: 'pill-btn', title: 'Tap tempo', onclick: tapTempo }, 'TAP');
  els.key = h('button', { class: 'pill', title: 'Project key & scale', onclick: (e) => keyMenu(e.currentTarget) });
  els.sig = h('button', { class: 'pill', title: 'Time signature', onclick: (e) => menuBelow(e.currentTarget, [[4, 4], [3, 4], [2, 4], [5, 4], [6, 8], [7, 8], [12, 8]].map(([a, b]) => ({ label: `${a}/${b}`, checked: S.project.sig[0] === a && S.project.sig[1] === b, action: () => { checkpoint(); S.project.sig = [a, b]; changed(true); } }))) });
  els.swing = h('button', { class: 'pill', title: 'Swing – delay the off-beats for a shuffled groove', onclick: (e) => swingMenu(e.currentTarget) });
  const center = h('div', { class: 'tb-center' },
    h('div', { class: 'transport' }, els.rew, els.play, els.rec, els.loop, els.metro, els.count), els.time,
    h('div', { class: 'meta-pills' }, h('div', { class: 'pill bpm-pill' }, els.bpm, h('span', null, 'BPM'), els.tap), els.key, els.sig, els.swing));

  // right
  btn('undo', 'undo', 'Undo (Ctrl+Z)', undo, 'sm'); btn('redo', 'redo', 'Redo (Ctrl+Shift+Z)', redo, 'sm');
  btn('mixer', 'mixer', 'Mixer', () => { if (S.ui.bottomTab === 'mixer' && S.ui.bottomOpen) S.ui.bottomOpen = false; else { S.ui.bottomTab = 'mixer'; S.ui.bottomOpen = true; } emit('layout'); sync(); }, 'sm');
  btn('side', 'loops', 'Sounds & effects panel', () => { S.ui.sideOpen = !S.ui.sideOpen; emit('layout'); sync(); }, 'sm');
  btn('settings', 'gear', 'Settings', openSettings, 'sm');
  els.export = h('button', { class: 'btn primary export-btn', onclick: openExportDialog, html: icon('download', 16) + '<span>Export</span>' });
  const right = h('div', { class: 'tb-right' }, els.undo, els.redo, h('div', { class: 'vsep' }), els.mixer, els.side, els.settings, els.export);
  root.append(left, center, right);

  on('history', sync); on('project', sync); on('settings', sync); on('transport', sync); on('load', sync); on('saved', () => { savedAt = Date.now(); sync(); });
  sync(); requestAnimationFrame(loop);
}

let savedAt = Date.now(), taps = [];
function tapTempo() {
  const now = performance.now(); if (taps.length && now - taps[taps.length - 1] > 2000) taps = []; taps.push(now);
  if (taps.length > 1) { const iv = []; for (let i = 1; i < taps.length; i++) iv.push(taps[i] - taps[i - 1]); const avg = iv.reduce((a, b) => a + b, 0) / iv.length; setProjectTempo(Math.round(60000 / avg)); }
}
async function toggleRecord() { if (engine.recording) await stopRecording(); else await startRecording(); sync(); }
export { toggleRecord };

function keyMenu(anchor) {
  const p = S.project;
  const m = showMenu(anchor.getBoundingClientRect().left, anchor.getBoundingClientRect().bottom + 4, [{ header: 'Key' }]);
  const grid = h('div', { class: 'key-grid' }, KEYS.map((k, i) => h('button', { class: 'key-cell' + (p.key === i ? ' on' : ''), onclick: () => { checkpoint(); p.key = i; changed(true); grid.querySelectorAll('.key-cell').forEach((c, j) => c.classList.toggle('on', j === i)); } }, k)));
  const sc = h('div', { class: 'scale-list' }, Object.keys(SCALES).map((s) => h('button', { class: 'scale-cell' + (p.scale === s ? ' on' : ''), onclick: () => { checkpoint(); p.scale = s; changed(true); sc.querySelectorAll('.scale-cell').forEach((c) => c.classList.toggle('on', c.textContent === s)); } }, s)));
  m.append(grid, h('div', { class: 'menu-header' }, 'Scale'), sc);
}

// Swing is shown MPC-style: 50% is straight, 67% a triplet shuffle, 75% the maximum.
const swingPct = (a) => Math.round(50 + 25 * a);
function swingMenu(anchor) {
  const p = S.project, sw = (p.swing ||= { amount: 0, grid: 0.25 });
  const r = anchor.getBoundingClientRect();
  const m = showMenu(r.left, r.bottom + 4, [{ header: 'Swing' }]);
  m.classList.add('swing-pop');
  const val = h('div', { class: 'sw-val' }), note = h('p', { class: 'muted small sw-note' }, 'Delays every second note of the grid when playing and exporting. Applies to MIDI, drum and sampler regions; audio clips are not affected.');
  const slider = h('input', { type: 'range', class: 'slider sw-slider', min: 0, max: 100, step: 1, value: Math.round(sw.amount * 100), 'aria-label': 'Swing amount' });
  const show = () => { val.textContent = sw.amount > 0 ? swingPct(sw.amount) + '%' : 'Straight'; slider.value = Math.round(sw.amount * 100); gridBtns.forEach((b) => b.classList.toggle('on', +b.dataset.g === sw.grid)); presets.forEach((b) => b.classList.toggle('on', Math.abs(+b.dataset.a - sw.amount) < 0.02)); };
  let cp = false;
  const set = (a) => { if (!cp) { checkpoint(); cp = true; setTimeout(() => (cp = false), 700); } sw.amount = Math.max(0, Math.min(1, a)); changed(); show(); };
  slider.addEventListener('input', () => set(+slider.value / 100));
  slider.addEventListener('dblclick', () => set(0));
  const gridBtns = [['1/8', 0.5], ['1/16', 0.25]].map(([l, g]) => h('button', { class: 'chip', dataset: { g }, onclick: () => { checkpoint(); sw.grid = g; changed(); show(); } }, l));
  const presets = [['Off', 0], ['Light', 0.33], ['Shuffle', 0.67], ['Hard', 1]].map(([l, a]) => h('button', { class: 'chip', dataset: { a }, onclick: () => set(a) }, l));
  m.append(h('div', { class: 'sw-body' }, h('div', { class: 'sw-top' }, h('span', { class: 'muted small' }, 'Amount'), val), slider, h('div', { class: 'chips' }, presets), h('div', { class: 'sw-grid' }, h('span', { class: 'muted small' }, 'Swing note'), h('div', { class: 'chips' }, gridBtns)), note));
  show();
}

function fileMenu(anchor) {
  menuBelow(anchor, [
    { label: 'New project', action: () => openTemplates() },
    { label: 'Open project…', shortcut: 'Ctrl+O', action: openProjectDialog },
    { label: 'Save', shortcut: 'Ctrl+S', action: () => saveNow() },
    { sep: true },
    { label: 'Import audio…', shortcut: 'Ctrl+I', action: () => pickAudioFiles() },
    { label: 'Import project file…', action: importProjectDialog },
    { label: 'Add track…', shortcut: 'T', action: openNewTrackDialog },
    { sep: true },
    { label: 'Export mixdown / stems…', shortcut: 'Ctrl+E', action: openExportDialog },
    { label: 'Export MIDI', action: () => download(exportMidi(), (S.project.name || 'project') + '.mid') },
    { label: 'Download project file (.bandy)', action: exportProjectAction },
    { sep: true },
    { label: 'Lyrics & notes', action: () => { S.ui.sideOpen = true; S.ui.sideTab = 'notes'; emit('layout'); } },
    { label: 'Tuner', action: openTuner },
    { label: 'Settings', action: openSettings },
    { label: 'Keyboard shortcuts', shortcut: '?', action: openShortcuts },
    { label: 'About Bandy', action: openAbout },
  ]);
}

function sync() {
  const p = S.project; if (!p) return;
  if (document.activeElement !== els.name) els.name.value = p.name;
  if (document.activeElement !== els.bpm) els.bpm.value = p.bpm;
  els.key.textContent = `${KEYS[p.key]} ${p.scale === 'major' ? 'maj' : p.scale === 'minor' ? 'min' : p.scale}`;
  els.sig.textContent = `${p.sig[0]}/${p.sig[1]}`;
  const swa = p.swing?.amount || 0; els.swing.textContent = swa > 0 ? `Swing ${swingPct(swa)}%` : 'Swing'; els.swing.classList.toggle('active', swa > 0);
  els.undo.disabled = !canUndo(); els.redo.disabled = !canRedo();
  els.loop.classList.toggle('on', p.loop.on); els.metro.classList.toggle('on', S.ui.metronome); els.count.classList.toggle('on', settings.countIn);
  els.play.innerHTML = icon(engine.playing ? 'pause' : 'play', 20); els.play.classList.toggle('on', engine.playing);
  els.rec.classList.toggle('on', engine.recording);
  els.mixer.classList.toggle('on', S.ui.bottomOpen && S.ui.bottomTab === 'mixer'); els.side.classList.toggle('on', S.ui.sideOpen);
  els.save.textContent = S.dirty ? 'Unsaved changes' : 'All changes saved';
  els.save.classList.toggle('dirty', S.dirty);
  els.save.dataset.state = S.dirty ? 'dirty' : 'ok';
}

function loop() {
  requestAnimationFrame(loop);
  if (!S.project) return;
  const beat = engine.playing ? engine.displayPos() : S.pos, p = S.project, spb = 60 / p.bpm;
  const main = els.time.firstChild, sub = els.time.lastChild;
  const bpb = beatsPerBar(), bar = Math.floor(beat / bpb), inBar = beat - bar * bpb, unit = 4 / p.sig[1];
  const t = fmtTime(beat * spb), bars = `${bar + 1}.${Math.floor(inBar / unit) + 1}.${Math.floor(((inBar / unit) % 1) * 4) + 1}`;
  const a = settings.barsMode ? bars : t, b = settings.barsMode ? t : bars;
  if (main.textContent !== a) main.textContent = a; if (sub.textContent !== b) sub.textContent = b;
  if (engine.countingIn) main.textContent = '1 2 3 4'.split(' ')[Math.min(3, Math.floor(((engine.pos() - (engine.startBeat - bpb)) / unit)))] || '·';
}
