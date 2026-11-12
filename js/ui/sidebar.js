// Right-hand panel: loops library, instruments, effects and notes.
import { h, on, emit, knob, menuBelow, promptDialog, toast, uid, debounce } from '../util.js';
import { icon } from '../icons.js';
import { S, getTrack, checkpoint, changed, addTrack, fxFromChain, selectTrack, TRACK_KINDS } from '../state.js';
import { engine } from '../audio/engine.js';
import { INSTRUMENTS, KITS } from '../audio/synth.js';
import { LOOPS, LOOP_TYPES, GENRES, buildLoop } from '../audio/loops.js';
import { FX, FX_LIST, FX_PRESETS, defaultParams } from '../audio/effects.js';
import { addLoopToProject } from './actions.js';

const TABS = [['loops', 'Loops', 'loops'], ['instruments', 'Sounds', 'piano'], ['fx', 'Effects', 'fx'], ['notes', 'Notes', 'lyrics']];
let body, tabsEl, loopFilter = { q: '', type: 'All', genre: 'All' }, playingLoop = null;

export function initSidebar(root) {
  tabsEl = h('div', { class: 'sb-tabs' }, TABS.map(([id, label, ic]) => h('button', { class: 'sb-tab', dataset: { id }, onclick: () => { S.ui.sideTab = id; render(); }, html: icon(ic, 16) + `<span>${label}</span>` })));
  body = h('div', { class: 'sb-body' });
  root.append(tabsEl, body);
  on('project', (d) => { if (d?.full) render(); else if (S.ui.sideTab === 'instruments') markActive(); });
  on('selection', () => { if (S.ui.sideTab === 'fx' || S.ui.sideTab === 'instruments') render(); });
  on('layout', render); on('load', render);
  on('audition', (on_) => { if (!on_) { playingLoop = null; document.querySelectorAll('.loop-play.on').forEach((b) => b.classList.remove('on')); } });
  render();
}
let softTimer;
function softRefresh() { clearTimeout(softTimer); softTimer = setTimeout(() => { if (S.ui.sideTab === 'instruments') markActive(); else if (S.ui.sideTab === 'fx' && !fxBusy) render(); }, 80); }
let fxBusy = false;

function render() {
  if (!body) return;
  for (const b of tabsEl.children) b.classList.toggle('on', b.dataset.id === S.ui.sideTab);
  const keepScroll = body.scrollTop, same = body.dataset.tab === S.ui.sideTab;
  body.replaceChildren(); body.dataset.tab = S.ui.sideTab;
  ({ loops: renderLoops, instruments: renderInstruments, fx: renderFx, notes: renderNotes })[S.ui.sideTab]();
  if (same) body.scrollTop = keepScroll;
}

// ---------------- Loops ----------------
function renderLoops() {
  const search = h('input', { class: 'search', placeholder: 'Search loops…', value: loopFilter.q, oninput: (e) => { loopFilter.q = e.target.value; list(); } });
  const chips = h('div', { class: 'chips' }, ['All', ...LOOP_TYPES].map((t) => h('button', { class: 'chip' + (loopFilter.type === t ? ' on' : ''), onclick: () => { loopFilter.type = t; render(); } }, t)));
  const genre = h('select', { class: 'select', onchange: (e) => { loopFilter.genre = e.target.value; list(); } }, ['All', ...GENRES.map((g) => g.name)].map((g) => h('option', { value: g, selected: g === loopFilter.genre }, g === 'All' ? 'All genres' : g)));
  const listEl = h('div', { class: 'loop-list' });
  const list = () => {
    listEl.replaceChildren();
    const q = loopFilter.q.toLowerCase();
    const items = LOOPS.filter((l) => (loopFilter.type === 'All' || l.type === loopFilter.type) && (loopFilter.genre === 'All' || l.genre === loopFilter.genre) && (!q || (l.name + l.genre + l.mood + l.type).toLowerCase().includes(q)));
    if (!items.length) listEl.append(h('div', { class: 'muted pad' }, 'No loops match your search.'));
    for (const l of items) {
      const btn = h('button', { class: 'loop-play' + (playingLoop === l.id ? ' on' : ''), title: 'Preview', html: icon('play', 14) + icon('stop', 14), onclick: async (e) => {
        if (playingLoop === l.id) { engine.stopAudition(); return; }
        playingLoop = l.id; document.querySelectorAll('.loop-play.on').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on');
        await engine.auditionLoop(buildLoop(l, S.project.key), { inst: l.inst, kit: l.kit, loopLen: l.bars * 4 });
      } });
      const row = h('div', { class: 'loop-row', draggable: 'true', ondragstart: (e) => { e.dataTransfer.setData('application/x-bandy-loop', l.id); e.dataTransfer.effectAllowed = 'copy'; } },
        btn, h('div', { class: 'loop-info' }, h('div', { class: 'loop-name' }, l.name), h('div', { class: 'loop-meta' }, [l.type, l.bars + ' bars', l.bpm + ' BPM', l.mood].join(' · '))),
        h('button', { class: 'icon-btn add', title: 'Add to project', html: icon('plus', 16), onclick: () => addLoopToProject(l) }));
      listEl.append(row);
    }
  };
  body.append(h('div', { class: 'sb-head' }, h('div', { class: 'sb-title' }, 'Loops & beats'), h('p', { class: 'muted small' }, 'Original, royalty-free loops that follow your project’s key. Preview, drag onto the timeline, or press +.'), search, chips, genre), listEl);
  list();
}

// ---------------- Instruments ----------------
let instFilter = { q: '', cat: 'All' };
function renderInstruments() {
  const t = getTrack(S.sel.track);
  const listEl = h('div', { class: 'inst-wrap inst-list' });
  // Search and chips only refresh the list container, so the input keeps focus while typing.
  const fillList = () => {
    listEl.replaceChildren();
    const q = instFilter.q.trim().toLowerCase(), cat = instFilter.cat;
    const hit = (name, tag) => !q || (name + ' ' + tag).toLowerCase().includes(q);
    const groups = {};
    for (const i of INSTRUMENTS) if ((cat === 'All' || cat === i.cat) && hit(i.name, i.cat)) (groups[i.cat] ||= []).push(i);
    for (const [g, items] of Object.entries(groups)) {
      listEl.append(h('div', { class: 'grp-label' }, g), h('div', { class: 'inst-grid' }, items.map((i) => h('button', { class: 'inst-btn', title: i.name, dataset: { inst: i.id }, onclick: () => pickInstrument(i) }, h('span', null, i.name)))));
    }
    const kits = (cat === 'All' || cat === 'Drum kits') ? KITS.filter((k) => hit(k.name, 'drum kit')) : [];
    if (kits.length) listEl.append(h('div', { class: 'grp-label' }, 'Drum kits'), h('div', { class: 'inst-grid' }, kits.map((k) => h('button', { class: 'inst-btn', title: k.name, dataset: { kit: k.id }, onclick: () => pickKit(k) }, h('span', null, k.name)))));
    if (!listEl.childElementCount) listEl.append(h('div', { class: 'muted pad' }, 'No sounds match your search.'));
    markActive();
  };
  const chipNames = ['All', ...new Set(INSTRUMENTS.map((i) => i.cat)), 'Drum kits'];
  const chips = h('div', { class: 'chips scroll' }, chipNames.map((c) => h('button', { class: 'chip' + (instFilter.cat === c ? ' on' : ''), dataset: { cat: c }, onclick: () => { instFilter.cat = c; for (const b of chips.children) b.classList.toggle('on', b.dataset.cat === c); fillList(); } }, c)));
  const search = h('input', { class: 'search', placeholder: 'Search sounds and kits…', value: instFilter.q, oninput: (e) => { instFilter.q = e.target.value; fillList(); } });
  body.append(h('div', { class: 'sb-head' }, h('div', { class: 'sb-title' }, 'Sounds'), h('p', { class: 'muted small' }, t && t.type !== 'audio' ? `Choose a sound for “${t.name}”` : 'Click a sound to create a new instrument track.'), search, chips), listEl);
  fillList();
}
function markActive() {
  const t = getTrack(S.sel.track);
  document.querySelectorAll('.inst-btn').forEach((b) => b.classList.toggle('on', !!t && ((t.type === 'synth' && b.dataset.inst === t.inst) || ((t.type === 'drums' || t.type === 'sampler') && b.dataset.kit === t.kit))));
}
function pickInstrument(i) {
  let t = getTrack(S.sel.track);
  if (!t || t.type !== 'synth') t = addTrack('synth', { inst: i.id, name: i.name });
  else { checkpoint(); t.inst = i.id; if (/^(Instrument|.* region)$/.test(t.name) || INSTRUMENTS.some((x) => x.name === t.name)) t.name = i.name; changed(); }
  const chord = i.cat === 'Bass' ? [36] : [60, 64, 67];
  chord.forEach((n) => engine.previewNote(t.id, n, 700));
  markActive();
}
function pickKit(k) {
  let t = getTrack(S.sel.track);
  if (!t || (t.type !== 'drums' && t.type !== 'sampler')) t = addTrack('drums', { kit: k.id, name: 'Drums' });
  else { checkpoint(); t.kit = k.id; changed(); }
  [36, 42, 38, 42].forEach((n, i) => setTimeout(() => engine.previewNote(t.id, n, 200), i * 160));
  markActive();
}

// ---------------- FX ----------------
const lastCp = { t: 0 };
const cpOnce = () => { if (Date.now() - lastCp.t > 900) checkpoint(); lastCp.t = Date.now(); };
const userPresets = () => JSON.parse(localStorage.getItem('bandy.fxpresets') || '[]');
let fxCat = 'All';
function renderFx() {
  const t = getTrack(S.sel.track);
  if (!t) { body.append(h('div', { class: 'muted pad' }, 'Select a track to edit its effects.')); return; }
  const presets = [...FX_PRESETS, ...userPresets().map((p) => ['My presets', p.name, p.chain])];
  const cats = ['All', ...new Set(presets.map((p) => p[0]))];
  const head = h('div', { class: 'sb-head' },
    h('div', { class: 'sb-title' }, 'Effects', h('span', { class: 'muted small trk' }, ' · ' + t.name)),
    h('div', { class: 'chips' }, cats.map((c) => h('button', { class: 'chip' + (fxCat === c ? ' on' : ''), onclick: () => { fxCat = c; render(); } }, c))));
  const pl = h('div', { class: 'preset-list' }, presets.filter((p) => fxCat === 'All' || p[0] === fxCat).map((p) => h('button', { class: 'preset', onclick: () => { checkpoint(); t.fx = fxFromChain(p[2]); changed(); render(); } }, h('span', null, p[1]), h('small', null, p[0]))));
  const chain = h('div', { class: 'fx-chain' });
  const addBtn = h('button', { class: 'btn', onclick: (e) => menuBelow(e.currentTarget, FX_LIST.map((id) => ({ label: FX[id].name, action: () => { checkpoint(); t.fx.push({ id: uid('fx'), type: id, params: defaultParams(id), bypass: false }); changed(); render(); } }))), html: icon('plus', 14) + ' Add effect' });
  const saveBtn = h('button', { class: 'btn', onclick: async () => { const n = await promptDialog('Save preset', t.name + ' FX', 'Preset name'); if (n?.trim()) { const all = userPresets(); all.push({ name: n.trim(), chain: t.fx.map((f) => ({ type: f.type, params: { ...f.params } })) }); localStorage.setItem('bandy.fxpresets', JSON.stringify(all)); toast('Preset saved'); render(); } }, html: icon('save', 14) + ' Save preset' });
  const clearBtn = h('button', { class: 'btn', onclick: () => { checkpoint(); t.fx = []; changed(); render(); } }, 'Clear');
  body.append(head, h('div', { class: 'preset-scroll' }, pl), h('div', { class: 'fx-actions' }, addBtn, saveBtn, clearBtn), chain);
  if (!t.fx.length) chain.append(h('div', { class: 'muted pad center' }, 'No effects on this track. Pick a preset above or add an effect.'));
  t.fx.forEach((fx, idx) => {
    const def = FX[fx.type];
    const card = h('div', { class: 'fx-card' + (fx.bypass ? ' off' : '') });
    const head = h('div', { class: 'fx-head' },
      h('button', { class: 'power' + (fx.bypass ? '' : ' on'), title: 'Bypass', html: icon('rec', 10), onclick: () => { checkpoint(); fx.bypass = !fx.bypass; changed(); render(); } }),
      h('div', { class: 'fx-name' }, def.name),
      h('div', { class: 'spacer' }),
      h('button', { class: 'icon-btn small', title: 'Move up', html: '↑', onclick: () => { if (idx) { checkpoint(); [t.fx[idx - 1], t.fx[idx]] = [t.fx[idx], t.fx[idx - 1]]; changed(); render(); } } }),
      h('button', { class: 'icon-btn small', title: 'Move down', html: '↓', onclick: () => { if (idx < t.fx.length - 1) { checkpoint(); [t.fx[idx + 1], t.fx[idx]] = [t.fx[idx], t.fx[idx + 1]]; changed(); render(); } } }),
      h('button', { class: 'icon-btn small', title: 'Remove', html: icon('close', 14), onclick: () => { checkpoint(); t.fx.splice(idx, 1); changed(); render(); } }));
    const params = h('div', { class: 'fx-params' });
    for (const [k, d] of Object.entries(def.params)) {
      if (d.type === 'select') params.append(h('label', { class: 'fx-sel' }, h('span', null, d.label), h('select', { class: 'select', onchange: (e) => { cpOnce(); fx.params[k] = e.target.value; changed(); } }, d.options.map((o) => h('option', { value: o, selected: o === fx.params[k] }, o)))));
      else params.append(knob({ value: fx.params[k] ?? d.def, min: d.min, max: d.max, def: d.def, step: d.step, label: d.label, unit: d.unit || '', log: d.log, size: 42, onChange: (v) => { cpOnce(); fx.params[k] = v; changed(); } }));
    }
    card.append(head, params); chain.append(card);
  });
}

// ---------------- Notes ----------------
function renderNotes() {
  const ta = h('textarea', { class: 'lyrics', placeholder: 'Write lyrics, chords or notes for this project…', value: S.project.lyrics || '' });
  ta.value = S.project.lyrics || '';
  const save = debounce(() => { S.project.lyrics = ta.value; changed(); }, 400);
  ta.addEventListener('input', save);
  body.append(h('div', { class: 'sb-head' }, h('div', { class: 'sb-title' }, 'Lyrics & notes'), h('p', { class: 'muted small' }, 'Saved with your project.')), h('div', { class: 'notes-wrap' }, ta));
}
