// Bottom dock: mixer, editor (piano roll / sample editor), sampler pads, keyboard.
import { h, on, emit, drag, clamp } from '../util.js';
import { icon } from '../icons.js';
import { S, findRegion, getTrack } from '../state.js';
import { mountMixer } from './mixer.js';
import { mountPianoRoll } from './pianoroll.js';
import { mountSampleEditor, mountPads, mountKeyboard, typing } from './editors.js';

const TABS = [['mixer', 'Mixer', 'mixer'], ['editor', 'Editor', 'edit'], ['pads', 'Pads', 'pads'], ['keyboard', 'Keyboard', 'keyboard']];
let host, content, tabs, destroy = null, mountedKey = '';

export function initBottom(root) {
  host = root;
  const handle = h('div', { class: 'bottom-handle', title: 'Drag to resize' });
  tabs = h('div', { class: 'bt-tabs' }, TABS.map(([id, label, ic]) => h('button', { class: 'bt-tab', dataset: { id }, onclick: () => { if (S.ui.bottomTab === id && S.ui.bottomOpen) S.ui.bottomOpen = false; else { S.ui.bottomTab = id; S.ui.bottomOpen = true; } emit('layout'); }, html: icon(ic, 15) + `<span>${label}</span>` })),
    h('div', { class: 'spacer' }), h('button', { class: 'icon-btn', title: 'Collapse panel', html: icon('chevron', 16), onclick: () => { S.ui.bottomOpen = !S.ui.bottomOpen; emit('layout'); } }));
  content = h('div', { class: 'bt-content' });
  root.append(handle, tabs, content);
  handle.addEventListener('pointerdown', (e) => { e.preventDefault(); const h0 = S.ui.bottomH, y0 = e.clientY; drag(e, (ev) => { S.ui.bottomH = clamp(h0 - (ev.clientY - y0), 160, innerHeight - 220); S.ui.bottomOpen = true; apply(); }); });
  on('layout', apply); on('editor', () => { mountedKey = ''; apply(); });
  on('selection', () => {
    if (S.ui.bottomTab === 'editor') { const id = [...S.sel.regions][0]; if (id && id !== S.editRegion) { S.editRegion = id; apply(); } }
  });
  on('project', (d) => { if (d?.full && S.ui.bottomTab === 'editor') { mountedKey = ''; apply(); } });
  on('load', () => { S.editRegion = null; mountedKey = ''; apply(); });
  apply();
}

function apply() {
  if (!host) return;
  host.classList.toggle('collapsed', !S.ui.bottomOpen);
  host.style.height = S.ui.bottomOpen ? S.ui.bottomH + 'px' : '40px';
  for (const b of tabs.querySelectorAll('.bt-tab')) b.classList.toggle('on', b.dataset.id === S.ui.bottomTab && S.ui.bottomOpen);
  typing.on = typing.on && S.ui.bottomTab === 'keyboard';
  if (!S.ui.bottomOpen) { unmount(); mountedKey = ''; return; }
  let key = S.ui.bottomTab;
  if (key === 'editor') { const f = findRegion(S.editRegion); key += ':' + (f ? f.region.id + f.region.type : 'none'); }
  if (key === 'pads') key += ':' + S.sel.track;
  if (key === mountedKey) return;
  mountedKey = key; unmount();
  switch (S.ui.bottomTab) {
    case 'mixer': destroy = mountMixer(content); break;
    case 'keyboard': destroy = mountKeyboard(content); break;
    case 'pads': destroy = mountPads(content); break;
    case 'editor': {
      const f = findRegion(S.editRegion);
      if (!f) { const e = h('div', { class: 'empty-editor' }, h('div', { html: icon('edit', 28) }), h('p', null, 'Double-click a region to edit it here.'), h('p', { class: 'muted small' }, 'MIDI regions open in the piano roll; audio regions open in the sample editor.')); content.append(e); destroy = () => e.remove(); }
      else destroy = f.region.type === 'midi' ? mountPianoRoll(content, f.region.id) : mountSampleEditor(content, f.region.id);
      break;
    }
  }
}
function unmount() { destroy?.(); destroy = null; content.replaceChildren(); }
