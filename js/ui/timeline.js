// Arrangement view: ruler, track headers, lanes, regions, playhead, automation.
import { h, clamp, hexToRgba, on, emit, showMenu, menuBelow, promptDialog, drag, toast, noteName, fmtTime, uid, throttleRaf } from '../util.js';
import { icon } from '../icons.js';
import { S, settings, beatsPerBar, getTrack, findRegion, checkpoint, changed, selectRegions, selectTrack, snapBeat, deleteRegions, duplicateRegions, copyRegions, pasteRegions, splitRegionAt, contentBeats, compatible, projectEnd, removeTrack, duplicateTrack, moveTrack, addRegion, makeMidiRegion, makeAudioRegion, TRACK_KINDS, mergeRegionsMidi, setRegionSpeed, presetChain } from '../state.js';
import { engine, audioInfo } from '../audio/engine.js';
import { getInstrument, KITS } from '../audio/synth.js';
import { computePeaks } from '../audio/dsp.js';
import { TRACK_COLORS } from '../util.js';
import { importAudioFiles, openNewTrackDialog, openEditorFor } from './actions.js';
import { buildLoop, LOOP_BY_ID } from '../audio/loops.js';

export const HEADER_W = 248, RULER_H = 38;
const els = {};
const rows = new Map(); // trackId -> {row, header, lane, regions: Map}
const peakCache = new WeakMap();
const peaksOf = (buf) => { let p = peakCache.get(buf); if (!p) { p = computePeaks(buf, 128); peakCache.set(buf, p); } return p; };

export function initTimeline(root) {
  els.root = root;
  els.scroll = h('div', { class: 'tl-scroll' });
  els.inner = h('div', { class: 'tl-inner' });
  els.rulerRow = h('div', { class: 'ruler-row' });
  els.corner = h('div', { class: 'ruler-corner' });
  els.rulerWrap = h('div', { class: 'ruler-wrap' });
  els.ruler = h('canvas', { class: 'ruler' });
  els.rulerWrap.append(els.ruler);
  els.rulerRow.append(els.corner, els.rulerWrap);
  els.rows = h('div', { class: 'track-rows' });
  els.addRow = h('div', { class: 'add-row' }, h('div', { class: 'add-cell' }, h('button', { class: 'btn add-track', onclick: () => openNewTrackDialog(), html: icon('plus', 16) + ' Add track' })), h('div', { class: 'add-lane' }));
  els.playhead = h('div', { class: 'playhead' }, h('div', { class: 'ph-head' }));
  els.loopShade = h('div', { class: 'loop-shade' });
  els.marquee = h('div', { class: 'marquee' });
  els.empty = h('div', { class: 'tl-empty' });
  els.inner.append(els.rulerRow, els.rows, els.addRow, els.loopShade, els.empty, els.marquee, els.playhead);
  els.scroll.append(els.inner);
  root.append(els.scroll);
  buildCorner();

  els.scroll.addEventListener('scroll', () => { S.ui.scrollX = els.scroll.scrollLeft; drawRuler(); });
  els.scroll.addEventListener('wheel', onWheel, { passive: false });
  new ResizeObserver(() => { drawRuler(); layout(); }).observe(els.scroll);
  els.ruler.addEventListener('pointerdown', onRulerDown);
  els.rows.addEventListener('pointerdown', (e) => { if (e.target.classList.contains('lane') && e.button === 0) onLaneDown(e); });
  els.rows.addEventListener('dblclick', onLaneDbl);
  els.rows.addEventListener('contextmenu', (e) => { const el = e.target.closest('.region'); if (el) { e.preventDefault(); regionMenu(e.clientX, e.clientY, el.dataset.id); } else if (e.target.classList.contains('lane')) { e.preventDefault(); laneMenu(e); } });
  els.scroll.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  els.scroll.addEventListener('drop', onDrop);

  on('project', () => renderTimeline());
  on('selection', () => updateSelection());
  on('load', () => { els.scroll.scrollLeft = 0; });
  on('settings', () => renderTimeline());
  on('ui', () => { renderTimeline(); });
  renderTimeline();
  requestAnimationFrame(frame);
}

const pxPerBeat = () => S.ui.ppb;
const beatFromClientX = (cx) => (cx - els.scroll.getBoundingClientRect().left - HEADER_W + els.scroll.scrollLeft) / S.ui.ppb;
export const clientXToBeat = beatFromClientX;

function buildCorner() {
  const tool = (id, ic, title) => h('button', { class: 'icon-btn tool' + (S.ui.tool === id ? ' on' : ''), title, dataset: { tool: id }, html: icon(ic, 16), onclick: () => { S.ui.tool = id; els.corner.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === id)); els.root.classList.toggle('tool-split', id === 'split'); } });
  const autoBtn = h('button', { class: 'icon-btn auto-btn', title: 'Automation', html: icon('auto', 16), onclick: (e) => {
    menuBelow(e.currentTarget, [{ label: 'Off', checked: !S.ui.automation, action: () => setAuto(null) }, { label: 'Volume automation', checked: S.ui.automation === 'volume', action: () => setAuto('volume') }, { label: 'Pan automation', checked: S.ui.automation === 'pan', action: () => setAuto('pan') }]);
  } });
  const setAuto = (v) => { S.ui.automation = v; autoBtn.classList.toggle('on', !!v); renderTimeline(true); };
  els.corner.append(
    h('div', { class: 'tool-group' }, tool('select', 'cursor', 'Select (V)'), tool('split', 'scissors', 'Split tool (C)')),
    autoBtn,
    h('div', { class: 'spacer' }),
    h('button', { class: 'icon-btn', title: 'Zoom out (-)', html: icon('zoomout', 16), onclick: () => zoomBy(1 / 1.35) }),
    h('button', { class: 'icon-btn', title: 'Zoom in (+)', html: icon('zoomin', 16), onclick: () => zoomBy(1.35) }),
  );
}
export function zoomBy(f, anchorPx) {
  const sc = els.scroll, vw = sc.clientWidth - HEADER_W;
  const ax = anchorPx ?? vw / 2, beat = (sc.scrollLeft + ax) / S.ui.ppb;
  S.ui.ppb = clamp(S.ui.ppb * f, 6, 480);
  renderTimeline(true);
  sc.scrollLeft = Math.max(0, beat * S.ui.ppb - ax);
  drawRuler();
}
export function zoomToFit() {
  const end = Math.max(projectEnd(), 16), vw = els.scroll.clientWidth - HEADER_W - 40;
  S.ui.ppb = clamp(vw / end, 6, 480); els.scroll.scrollLeft = 0; renderTimeline(true);
}
function onWheel(e) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const rect = els.scroll.getBoundingClientRect();
    zoomBy(Math.pow(1.0018, -e.deltaY), e.clientX - rect.left - HEADER_W);
  } else if (e.shiftKey && !e.deltaX) { e.preventDefault(); els.scroll.scrollLeft += e.deltaY; }
}

// ---------- layout ----------
function totalBeats() {
  const bpb = beatsPerBar(), vw = (els.scroll?.clientWidth || 1200) - HEADER_W;
  return Math.max(Math.ceil((projectEnd() + bpb * 8) / bpb) * bpb, Math.ceil(vw / S.ui.ppb / bpb) * bpb + bpb, 32);
}
function layout() {
  const p = S.project, ppb = S.ui.ppb, tb = totalBeats(), bpb = beatsPerBar();
  els.inner.style.setProperty('--ppb', ppb + 'px');
  els.inner.style.setProperty('--bar-px', ppb * bpb + 'px');
  els.inner.style.setProperty('--beat-px', ppb * (4 / p.sig[1]) + 'px');
  els.inner.style.setProperty('--header-w', HEADER_W + 'px');
  els.inner.style.setProperty('--ruler-h', RULER_H + 'px');
  els.inner.style.width = HEADER_W + tb * ppb + 'px';
  els.inner.classList.toggle('dense', ppb * (4 / p.sig[1]) < 14);
  els.rulerWrap.style.width = Math.max(100, els.scroll.clientWidth - HEADER_W) + 'px';
  for (const r of rows.values()) r.lane.style.width = tb * ppb + 'px';
  els.addRow.querySelector('.add-lane').style.width = tb * ppb + 'px';
  updateLoopShade();
}

// ---------- rendering ----------
export const renderTimeline = throttleRaf((force = false) => doRender(force));
function doRender(force) {
  const p = S.project; if (!p) return;
  layout();
  const ids = new Set(p.tracks.map((t) => t.id));
  for (const [id, r] of rows) if (!ids.has(id)) { r.row.remove(); rows.delete(id); }
  let prev = null;
  p.tracks.forEach((t, i) => {
    let r = rows.get(t.id);
    if (!r) { r = createRow(t); rows.set(t.id, r); }
    // ensure order
    const want = els.rows.children[i];
    if (want !== r.row) els.rows.insertBefore(r.row, want || null);
    updateRow(r, t, force);
  });
  layout(); // make sure lanes created above get their width right away
  els.empty.style.display = p.tracks.length ? 'none' : '';
  if (!p.tracks.length) { els.empty.innerHTML = ''; els.empty.append(h('div', { class: 'empty-card' }, h('div', { class: 'big-ic', html: icon('wave', 40) }), h('h3', null, 'Start something new'), h('p', null, 'Add a track, drag in an audio file, or browse loops in the Sounds panel.'), h('div', { class: 'row gap' }, h('button', { class: 'btn primary', onclick: () => openNewTrackDialog(), html: icon('plus', 16) + ' Add track' }), h('button', { class: 'btn', onclick: () => { S.ui.sideOpen = true; S.ui.sideTab = 'loops'; emit('layout'); }, html: icon('loops', 16) + ' Browse loops' })))); }
  drawRuler(); updateLoopShade(); updateSelection();
}

function createRow(t) {
  const row = h('div', { class: 'track-row', dataset: { id: t.id } });
  const header = createHeader(t);
  const lane = h('div', { class: 'lane', dataset: { id: t.id }, style: { width: totalBeats() * S.ui.ppb + 'px' } });
  const auto = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  auto.setAttribute('class', 'auto-svg');
  lane.append(auto);
  row.append(header.el, lane);
  return { row, header, lane, auto, regions: new Map() };
}
function updateRow(r, t, force) {
  r.row.style.height = t.height + 'px';
  r.lane.style.width = totalBeats() * S.ui.ppb + 'px';
  r.row.classList.toggle('selected', S.sel.track === t.id);
  r.row.style.setProperty('--tc', t.color);
  r.header.update(t);
  // regions
  const seen = new Set();
  for (const reg of t.regions) {
    seen.add(reg.id);
    let o = r.regions.get(reg.id);
    if (!o) { o = createRegionEl(reg); r.regions.set(reg.id, o); r.lane.append(o.el); }
    updateRegionEl(o, reg, t, force);
  }
  for (const [id, o] of r.regions) if (!seen.has(id)) { o.el.remove(); r.regions.delete(id); }
  drawAutomation(r, t);
}

// ---------- header ----------
function createHeader(t0) {
  const el = h('div', { class: 'th' });
  const strip = h('div', { class: 'th-strip', title: 'Track colour', onclick: (e) => { const t = getTrack(el.closest('.track-row').dataset.id); colorMenu(e, t); } });
  const ic = h('div', { class: 'th-icon' });
  const name = h('div', { class: 'th-name', title: 'Double-click to rename' });
  const more = h('button', { class: 'icon-btn small', html: icon('more', 16), title: 'Track menu', onclick: (e) => trackMenu(e, getTrack(el.closest('.track-row').dataset.id)) });
  const bm = h('button', { class: 'tb mute', title: 'Mute (M)' }, 'M'), bs = h('button', { class: 'tb solo', title: 'Solo (S)' }, 'S'), ba = h('button', { class: 'tb arm', title: 'Arm for recording (R)', html: icon('rec', 12) });
  const bfx = h('button', { class: 'tb fx', title: 'Effects', html: icon('fx', 14) + '<span>FX</span>' });
  const bmon = h('button', { class: 'tb mon', title: 'Input monitoring', html: icon('headphones', 14) });
  const inst = h('button', { class: 'th-inst' });
  const vol = h('input', { type: 'range', class: 'slider vol', min: -60, max: 6, step: 0.1, title: 'Volume (double-click to reset)' });
  const pan = h('input', { type: 'range', class: 'slider pan', min: -1, max: 1, step: 0.01, title: 'Pan (double-click to center)' });
  const meter = h('div', { class: 'th-meter' }, h('div', { class: 'fill' }));
  const resize = h('div', { class: 'th-resize' });
  const tr = () => getTrack(el.closest('.track-row').dataset.id);
  bm.onclick = () => { const t = tr(); checkpoint(); t.mute = !t.mute; changed(); };
  bs.onclick = (e) => { const t = tr(); checkpoint(); const v = !t.solo; if (!e.shiftKey && !e.ctrlKey) S.project.tracks.forEach((x) => (x.solo = false)); t.solo = v; changed(); };
  ba.onclick = () => { const t = tr(); checkpoint(); t.arm = !t.arm; changed(); };
  bmon.onclick = () => { const t = tr(); checkpoint(); t.monitor = !t.monitor; changed(); };
  bfx.onclick = () => { selectTrack(tr().id); S.ui.sideOpen = true; S.ui.sideTab = 'fx'; emit('layout'); };
  inst.onclick = () => { selectTrack(tr().id); S.ui.sideOpen = true; S.ui.sideTab = 'instruments'; emit('layout'); };
  let vc = false;
  vol.addEventListener('pointerdown', () => { if (!vc) { checkpoint(); vc = true; } });
  vol.addEventListener('input', () => { const t = tr(); t.vol = +vol.value; changed(); });
  vol.addEventListener('change', () => (vc = false));
  vol.addEventListener('dblclick', () => { const t = tr(); checkpoint(); t.vol = 0; changed(); });
  let pc = false;
  pan.addEventListener('pointerdown', () => { if (!pc) { checkpoint(); pc = true; } });
  pan.addEventListener('input', () => { const t = tr(); t.pan = +pan.value; changed(); });
  pan.addEventListener('change', () => (pc = false));
  pan.addEventListener('dblclick', () => { const t = tr(); checkpoint(); t.pan = 0; changed(); });
  name.addEventListener('dblclick', async () => { const t = tr(); const v = await promptDialog('Rename track', t.name); if (v?.trim()) { checkpoint(); t.name = v.trim(); changed(); } });
  resize.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation(); const t = tr(), y0 = e.clientY, h0 = t.height; checkpoint();
    drag(e, (ev) => { t.height = clamp(h0 + ev.clientY - y0, 52, 360); changed(); });
  });
  el.addEventListener('pointerdown', (e) => { const t = tr(); if (t && S.sel.track !== t.id) selectTrack(t.id); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); trackMenu(e, tr()); });
  const top = h('div', { class: 'th-top' }, ic, name, more);
  const btns = h('div', { class: 'th-btns' }, bm, bs, ba, bmon, bfx);
  const sl = h('div', { class: 'th-sliders' }, h('span', { class: 'sl-ic', html: icon('vol', 13) }), vol, h('span', { class: 'sl-ic pan-l' }, 'L·R'), pan);
  el.append(strip, h('div', { class: 'th-body' }, top, btns, inst, sl), meter, resize);
  return {
    el,
    update(t) {
      strip.style.background = t.color;
      ic.innerHTML = icon(TRACK_KINDS[t.kind]?.icon || 'wave', 16); ic.style.color = t.color;
      name.textContent = t.name;
      bm.classList.toggle('on', t.mute); bs.classList.toggle('on', t.solo); ba.classList.toggle('on', t.arm); bmon.classList.toggle('on', t.monitor);
      bmon.style.display = t.type === 'audio' ? '' : 'none';
      bfx.classList.toggle('has', t.fx.some((f) => !f.bypass));
      inst.textContent = t.type === 'synth' ? getInstrument(t.inst).name : t.type === 'drums' || t.type === 'sampler' ? (KITS.find((k) => k.id === t.kit)?.name || 'Kit') : '';
      inst.style.display = inst.textContent ? '' : 'none';
      if (document.activeElement !== vol) vol.value = t.vol;
      if (document.activeElement !== pan) pan.value = t.pan;
      el.classList.toggle('compact', t.height < 84); el.classList.toggle('tiny', t.height < 66);
      el.classList.toggle('muted', t.mute);
      el._meter = meter.firstChild; el._trackId = t.id;
    },
  };
}
function colorMenu(e, t) {
  const m = showMenu(e.clientX, e.clientY, [{ header: 'Track colour' }]);
  const g = h('div', { class: 'swatches' }, TRACK_COLORS.map((c) => h('button', { class: 'swatch' + (c === t.color ? ' on' : ''), style: { background: c }, onclick: () => { checkpoint(); t.color = c; changed(); m.remove(); } })));
  m.append(g);
}
function trackMenu(e, t) {
  if (!t) return;
  const r = e.currentTarget.getBoundingClientRect?.();
  const x = e.clientX || r?.left, y = e.clientY || r?.bottom;
  showMenu(x, y, [
    { label: 'Rename', action: async () => { const v = await promptDialog('Rename track', t.name); if (v?.trim()) { checkpoint(); t.name = v.trim(); changed(); } } },
    { label: 'Duplicate track', action: () => duplicateTrack(t.id) },
    { label: 'Change colour', action: () => colorMenu({ clientX: x, clientY: y }, t) },
    { sep: true },
    { label: 'Open effects', action: () => { selectTrack(t.id); S.ui.sideOpen = true; S.ui.sideTab = 'fx'; emit('layout'); } },
    t.type !== 'audio' ? { label: 'Choose sound…', action: () => { selectTrack(t.id); S.ui.sideOpen = true; S.ui.sideTab = 'instruments'; emit('layout'); } } : null,
    { label: t.height < 84 ? 'Expand' : 'Collapse', action: () => { checkpoint(); t.height = t.height < 84 ? 96 : 56; changed(); } },
    { label: 'Clear automation', action: () => { checkpoint(); t.auto = { volume: [], pan: [] }; changed(); } },
    { sep: true },
    { label: 'Move up', action: () => moveTrack(t.id, -1) },
    { label: 'Move down', action: () => moveTrack(t.id, 1) },
    { sep: true },
    { label: 'Delete track', action: () => removeTrack(t.id) },
  ].filter(Boolean));
}

// ---------- regions ----------
function createRegionEl(r) {
  const el = h('div', { class: 'region', dataset: { id: r.id } });
  const label = h('div', { class: 'r-label' });
  const cv = h('canvas', { class: 'r-canvas' });
  const hl = h('div', { class: 'r-h left' }), hr = h('div', { class: 'r-h right' });
  const loopH = h('div', { class: 'r-loop', title: 'Drag to loop', html: icon('loop', 12) });
  const fi = h('div', { class: 'r-fade in', title: 'Fade in' }), fo = h('div', { class: 'r-fade out', title: 'Fade out' });
  const fiShape = h('div', { class: 'r-fshape in' }), foShape = h('div', { class: 'r-fshape out' });
  el.append(cv, fiShape, foShape, label, hl, hr, fi, fo, loopH);
  el.addEventListener('pointerdown', (e) => regionDown(e, el));
  el.addEventListener('dblclick', (e) => { e.stopPropagation(); selectRegions([el.dataset.id]); openEditorFor(el.dataset.id); });
  fi.addEventListener('pointerdown', (e) => fadeDown(e, el, 'in'));
  fo.addEventListener('pointerdown', (e) => fadeDown(e, el, 'out'));
  loopH.addEventListener('pointerdown', (e) => loopDown(e, el));
  return { el, label, cv, fiShape, foShape, key: '' };
}
function updateRegionEl(o, r, t, force) {
  const ppb = S.ui.ppb, w = Math.max(3, r.length * ppb);
  const el = o.el;
  el.style.left = r.start * ppb + 'px'; el.style.width = w + 'px';
  el.style.setProperty('--rc', t.color);
  el.classList.toggle('audio', r.type === 'audio'); el.classList.toggle('midi', r.type !== 'audio');
  el.classList.toggle('muted', !!r.muted); el.classList.toggle('selected', S.sel.regions.has(r.id));
  o.label.textContent = r.name + (r.type === 'audio' && (r.pitch || r.speed !== 1 || r.reverse) ? '  ·  ' + [r.pitch ? (r.pitch > 0 ? '+' : '') + r.pitch + 'st' : '', r.speed !== 1 ? r.speed.toFixed(2) + '×' : '', r.reverse ? 'rev' : ''].filter(Boolean).join(' ') : '');
  const fiW = Math.min(w, (r.fadeIn || 0) * ppb), foW = Math.min(w, (r.fadeOut || 0) * ppb);
  o.fiShape.style.width = fiW + 'px'; o.foShape.style.width = foW + 'px';
  o.fiShape.style.display = fiW > 1 ? '' : 'none'; o.foShape.style.display = foW > 1 ? '' : 'none';
  el.querySelector('.r-fade.in').style.left = fiW + 'px'; el.querySelector('.r-fade.out').style.right = foW + 'px';
  const bodyH = t.height - 23;
  const key = [r.type === 'midi' ? r.notes.length + ':' + r.notes.reduce((a, n) => a + n.s * 7 + n.p * 13 + n.l * 3, 0).toFixed(2) + ':' + r.loopLen : [r.bufferId, r.srcOffset, r.srcLen, r.speed, r.reverse, r.pitch, S.project.bpm].join('|'), Math.round(w), bodyH, t.color, r.length, document.documentElement.dataset.theme].join('#');
  if (key !== o.key || force === true) { o.key = key; drawRegion(o.cv, r, t, w, bodyH); }
}
function drawRegion(cv, r, t, w, bodyH) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.min(8192, Math.ceil(w)), H = Math.max(10, bodyH);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = w + 'px'; cv.style.height = H + 'px';
  const c = cv.getContext('2d'); c.scale(dpr * (W / w), dpr);
  const ppb = S.ui.ppb, col = t.color, ink = document.documentElement.dataset.theme === 'light' ? 'rgba(20,20,28,.72)' : 'rgba(255,255,255,.88)';
  if (r.type === 'midi') {
    if (!r.notes.length) return;
    let lo = 127, hi = 0; for (const n of r.notes) { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); }
    const span = Math.max(11, hi - lo + 2), nh = Math.max(2, Math.min(6, (H - 6) / span)), L = r.loopLen || r.length;
    c.fillStyle = ink;
    for (let k = 0; k * L < r.length - 1e-6; k++) {
      c.globalAlpha = k === 0 ? 1 : 0.55;
      for (const n of r.notes) {
        const x = (k * L + n.s) * ppb; if (n.s >= L || k * L + n.s >= r.length) continue;
        const y = 3 + (hi + 1 - n.p) * ((H - 6) / span);
        c.fillRect(x, y, Math.max(2, Math.min(n.l, r.length - k * L - n.s) * ppb - 1), nh);
      }
    }
    c.globalAlpha = 1;
    if (r.length > L + 1e-6) { c.fillStyle = 'rgba(0,0,0,.35)'; for (let k = 1; k * L < r.length; k++) c.fillRect(k * L * ppb, 0, 1, H); }
    return;
  }
  const info = audioInfo(r); if (!info) return;
  const spb = 60 / S.project.bpm, C = contentBeats(r), peaks = peaksOf(info.base), base = info.base, bs = 128 / base.sampleRate;
  c.fillStyle = ink;
  const mid = H / 2, amp = mid - 2;
  for (let x = 0; x < w; x += 1) {
    const b0 = x / ppb, b1 = (x + 1) / ppb;
    const c0 = b0 % C, c1 = Math.min(c0 + (b1 - b0), C);
    let t0 = r.srcOffset + c0 * spb * r.speed, t1 = r.srcOffset + c1 * spb * r.speed;
    if (r.reverse) { const d = base.duration; [t0, t1] = [d - t1, d - t0]; }
    const i0 = Math.max(0, Math.floor(t0 / bs)), i1 = Math.min(peaks.length / 2 - 1, Math.max(i0, Math.floor(t1 / bs)));
    let mn = 1, mx = -1;
    for (let i = i0; i <= i1; i++) { if (peaks[i * 2] < mn) mn = peaks[i * 2]; if (peaks[i * 2 + 1] > mx) mx = peaks[i * 2 + 1]; }
    if (mn > mx) continue;
    const y0 = mid - mx * amp, y1 = mid - mn * amp;
    c.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
  if (r.length > C + 1e-6) { c.fillStyle = 'rgba(0,0,0,.4)'; for (let k = 1; k * C < r.length; k++) c.fillRect(k * C * ppb, 0, 1, H); }
}

// pointer interaction for regions
let dragState = null;
function regionDown(e, el) {
  if (e.button !== 0 || e.target.closest('.r-fade,.r-loop')) return;
  e.stopPropagation();
  const id = el.dataset.id;
  if (S.ui.tool === 'split') {
    const beat = snapBeat(beatFromClientX(e.clientX));
    if (splitRegionAt(id, beat)) return;
  }
  const additive = e.shiftKey || e.ctrlKey || e.metaKey;
  if (!S.sel.regions.has(id)) selectRegions([id], additive);
  else if (additive) { selectRegions([id], true); return; }
  const rect = el.getBoundingClientRect(), x = e.clientX - rect.left;
  const zone = x < 7 ? 'left' : x > rect.width - 7 ? 'right' : 'move';
  const ids = [...S.sel.regions];
  const startBeat = beatFromClientX(e.clientX);
  const origs = new Map();
  let started = false, dup = e.altKey && zone === 'move';
  const trackOf = new Map();
  for (const rid of ids) { const f = findRegion(rid); if (f) { origs.set(rid, JSON.parse(JSON.stringify(f.region))); trackOf.set(rid, f.track.id); } }
  const main = origs.get(id);
  const laneUnder = (ev) => { const lane = document.elementsFromPoint(ev.clientX, ev.clientY).find((x) => x.classList?.contains('lane')); return lane ? lane.dataset.id : null; };
  let moved = false;
  drag(e, (ev) => {
    const dx = (ev.clientX - e.clientX);
    if (!started && Math.abs(dx) < 3 && Math.abs(ev.clientY - e.clientY) < 3) return;
    if (!started) {
      started = true; checkpoint();
      if (dup) { const nids = duplicateRegionsInPlace(ids); ids.length = 0; ids.push(...nids.map((x) => x.new)); for (const x of nids) { origs.set(x.new, origs.get(x.old)); trackOf.set(x.new, trackOf.get(x.old)); } selectRegions(ids); }
    }
    moved = true;
    const cur = beatFromClientX(ev.clientX), snapBoth = ev.altKey && zone !== 'move' ? false : true;
    if (zone === 'move') {
      let delta = snapBeat(main.start + (cur - startBeat)) - main.start;
      const minStart = Math.min(...[...origs.values()].map((o) => o.start));
      if (minStart + delta < 0) delta = -minStart;
      const newTrack = ids.length === 1 ? laneUnder(ev) : null;
      for (const rid of ids) {
        const f = findRegion(rid), o = origs.get(rid); if (!f) continue;
        f.region.start = o.start + delta;
        if (newTrack && newTrack !== f.track.id) { const nt = getTrack(newTrack); if (nt && compatible(nt, f.region)) { f.track.regions = f.track.regions.filter((x) => x !== f.region); nt.regions.push(f.region); } }
      }
    } else for (const rid of ids) {
      const f = findRegion(rid), o = origs.get(rid); if (!f) continue;
      const r = f.region, minLen = S.ui.snap || 0.125;
      if (zone === 'right') {
        const maxL = r.type === 'audio' ? Math.max(contentBeats(o), o.length) : Infinity;
        r.length = clamp(snapBeat(o.start + o.length + (cur - startBeat)) - o.start, minLen, maxL);
      } else {
        let ns = snapBeat(o.start + (cur - startBeat)); const end = o.start + o.length;
        ns = clamp(ns, Math.max(0, o.start - (o.type === 'audio' ? o.srcOffset / (60 / S.project.bpm) / o.speed : 1e9)), end - minLen);
        const d = ns - o.start; r.start = ns; r.length = o.length - d;
        if (r.type === 'audio') r.srcOffset = Math.max(0, o.srcOffset + d * (60 / S.project.bpm) * o.speed), r.srcLen = Math.max(0.01, o.srcLen - d * (60 / S.project.bpm) * o.speed);
        else { r.notes = o.notes.map((n) => ({ ...n, s: n.s - d })).filter((n) => n.s + n.l > 0).map((n) => (n.s < 0 ? { ...n, l: n.l + n.s, s: 0 } : n)); r.loopLen = Math.max(minLen, o.loopLen - d); }
      }
    }
    changed();
  }, () => { if (!moved && S.sel.regions.size > 1 && !additive) selectRegions([id]); });
}
function duplicateRegionsInPlace(ids) {
  const out = [];
  for (const id of ids) { const f = findRegion(id); if (!f) continue; const c = JSON.parse(JSON.stringify(f.region)); c.id = uid('r'); if (c.notes) c.notes.forEach((n) => (n.id = uid('n'))); f.track.regions.push(c); out.push({ old: id, new: c.id }); }
  return out;
}
function fadeDown(e, el, side) {
  e.stopPropagation(); e.preventDefault();
  const f = findRegion(el.dataset.id); if (!f) return; const r = f.region; checkpoint();
  const cur0 = beatFromClientX(e.clientX), o = { in: r.fadeIn || 0, out: r.fadeOut || 0 };
  drag(e, (ev) => { const d = beatFromClientX(ev.clientX) - cur0; if (side === 'in') r.fadeIn = clamp(o.in + d, 0, r.length - (r.fadeOut || 0)); else r.fadeOut = clamp(o.out - d, 0, r.length - (r.fadeIn || 0)); changed(); });
}
function loopDown(e, el) {
  e.stopPropagation(); e.preventDefault();
  const f = findRegion(el.dataset.id); if (!f) return; const r = f.region; checkpoint();
  const C = contentBeats(r), startLen = r.length, cur0 = beatFromClientX(e.clientX);
  selectRegions([r.id]);
  drag(e, (ev) => {
    let nl = startLen + (beatFromClientX(ev.clientX) - cur0);
    const near = Math.round(nl / C) * C; if (Math.abs(near - nl) * S.ui.ppb < 10) nl = near; else nl = snapBeat(r.start + nl) - r.start;
    r.length = Math.max(S.ui.snap || 0.125, nl); changed();
  });
}

function regionMenu(x, y, id) {
  if (!S.sel.regions.has(id)) selectRegions([id]);
  const ids = [...S.sel.regions], f = findRegion(id); if (!f) return;
  const r = f.region, pos = engine.pos();
  showMenu(x, y, [
    { label: 'Edit…', shortcut: 'Enter', action: () => openEditorFor(id) },
    { label: 'Split at playhead', shortcut: 'S', disabled: !(pos > r.start && pos < r.start + r.length), action: () => ids.forEach((i) => splitRegionAt(i, pos)) },
    { label: 'Copy', shortcut: 'Ctrl+C', action: () => copyRegions(ids) },
    { label: 'Cut', shortcut: 'Ctrl+X', action: () => { copyRegions(ids); deleteRegions(ids); } },
    { label: 'Duplicate', shortcut: 'Ctrl+D', action: () => duplicateRegions(ids) },
    { label: r.muted ? 'Unmute region' : 'Mute region', action: () => { checkpoint(); ids.forEach((i) => { const g = findRegion(i); if (g) g.region.muted = !r.muted; }); changed(); } },
    { label: 'Rename…', action: async () => { const v = await promptDialog('Rename region', r.name); if (v?.trim()) { checkpoint(); r.name = v.trim(); changed(); } } },
    ids.length > 1 && f.region.type === 'midi' ? { label: 'Merge MIDI regions', action: () => mergeRegionsMidi(ids) } : null,
    r.type === 'audio' ? { label: r.reverse ? 'Unreverse' : 'Reverse', action: () => { checkpoint(); r.reverse = !r.reverse; changed(); } } : null,
    { sep: true },
    { label: 'Delete', shortcut: 'Del', action: () => deleteRegions(ids) },
  ].filter(Boolean));
}
function laneMenu(e) {
  const t = getTrack(e.target.dataset.id), beat = snapBeat(beatFromClientX(e.clientX));
  showMenu(e.clientX, e.clientY, [
    t.type !== 'audio' ? { label: 'New MIDI region here', action: () => newMidiRegion(t, beat) } : { label: 'Import audio here…', action: () => pickFiles(t, beat) },
    { label: 'Paste', shortcut: 'Ctrl+V', disabled: !S.clipboard, action: () => { selectTrack(t.id); pasteRegions(beat); } },
    { label: 'Move playhead here', action: () => engine.seek(beat) },
  ]);
}
function pickFiles(t, beat) { const i = h('input', { type: 'file', accept: 'audio/*,video/*', multiple: true }); i.onchange = () => importAudioFiles([...i.files], { trackId: t.id, beat }); i.click(); }
export function newMidiRegion(t, beat, bars = 1) {
  checkpoint();
  const r = makeMidiRegion(beat, beatsPerBar() * bars, [], t.name + ' region'); addRegion(t.id, r); selectRegions([r.id]); openEditorFor(r.id); return r;
}

// lane: marquee + click handling
function onLaneDown(e) {
  const t = getTrack(e.target.dataset.id); if (!t) return;
  selectTrack(t.id);
  if (!e.shiftKey) selectRegions([]);
  const inner = els.inner.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
  const base = new Set(S.sel.regions); let moved = false;
  const rectsCache = () => [...document.querySelectorAll('.region')].map((el) => ({ id: el.dataset.id, r: el.getBoundingClientRect() }));
  const rects = rectsCache();
  drag(e, (ev) => {
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return; moved = true;
    const l = Math.min(x0, ev.clientX), tp = Math.min(y0, ev.clientY), w = Math.abs(ev.clientX - x0), hh = Math.abs(ev.clientY - y0);
    Object.assign(els.marquee.style, { display: 'block', left: l - inner.left + 'px', top: tp - inner.top + 'px', width: w + 'px', height: hh + 'px' });
    const hit = rects.filter((q) => q.r.left < l + w && q.r.right > l && q.r.top < tp + hh && q.r.bottom > tp).map((q) => q.id);
    S.sel.regions = new Set([...base, ...hit]); updateSelection(); emit('selection');
  }, () => { els.marquee.style.display = 'none'; });
}
function onLaneDbl(e) {
  if (!e.target.classList.contains('lane')) return;
  const t = getTrack(e.target.dataset.id); const beat = Math.max(0, Math.floor(beatFromClientX(e.clientX) / beatsPerBar()) * beatsPerBar());
  if (t.type === 'audio') pickFiles(t, beat); else newMidiRegion(t, beat);
}
async function onDrop(e) {
  e.preventDefault();
  const lane = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.classList?.contains('lane'));
  const beat = Math.max(0, snapBeat(beatFromClientX(e.clientX)));
  const loopId = e.dataTransfer.getData('application/x-bandy-loop');
  if (loopId) { const { addLoopToProject } = await import('./actions.js'); addLoopToProject(LOOP_BY_ID[loopId], { beat, trackId: lane?.dataset.id }); return; }
  const files = [...e.dataTransfer.files].filter((f) => /^(audio|video)\//.test(f.type) || /\.(wav|mp3|ogg|flac|m4a|aac|webm|mp4|aif|aiff)$/i.test(f.name));
  if (files.length) importAudioFiles(files, { beat, trackId: lane?.dataset.id });
}

// ---------- ruler ----------
function drawRuler() {
  const cv = els.ruler; if (!cv || !S.project) return;
  const p = S.project, ppb = S.ui.ppb, bpb = beatsPerBar(), w = Math.max(100, els.scroll.clientWidth - HEADER_W), H = RULER_H, dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(H * dpr); cv.style.width = w + 'px'; cv.style.height = H + 'px'; }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, H);
  const sx = els.scroll.scrollLeft, css = getComputedStyle(document.documentElement);
  const fg = css.getPropertyValue('--text-dim').trim() || '#999', line = css.getPropertyValue('--ruler-line').trim() || '#444', accent = css.getPropertyValue('--accent').trim() || '#f33';
  // loop strip
  const ly = 22, lh = H - ly - 3;
  if (p.loop.on || S.ui.hoverLoop) {
    const a = p.loop.start * ppb - sx, b = p.loop.end * ppb - sx;
    c.fillStyle = p.loop.on ? accent : 'rgba(128,128,128,.25)'; c.globalAlpha = p.loop.on ? 0.9 : 0.5; c.beginPath(); c.roundRect(a, ly, Math.max(4, b - a), lh, 3); c.fill(); c.globalAlpha = 1;
    if (p.loop.on) { c.fillStyle = 'rgba(255,255,255,.85)'; c.fillRect(a + 1, ly + 3, 2, lh - 6); c.fillRect(b - 3, ly + 3, 2, lh - 6); }
  }
  c.font = '600 10px Inter, system-ui, sans-serif'; c.textBaseline = 'middle';
  const first = Math.floor(sx / ppb / (4 / p.sig[1])), unit = 4 / p.sig[1], lastB = (sx + w) / ppb;
  const barPx = ppb * bpb, step = barPx < 28 ? Math.ceil(36 / barPx) : 1; // bars per label
  for (let i = first; i * unit <= lastB; i++) {
    const beat = i * unit, x = Math.round(beat * ppb - sx) + 0.5, isBar = i % p.sig[0] === 0;
    if (isBar) {
      const bar = i / p.sig[0];
      const labelled = bar % step === 0;
      c.strokeStyle = line; c.beginPath(); c.moveTo(x, labelled ? 4 : 12); c.lineTo(x, 20); c.stroke();
      if (labelled) { c.fillStyle = fg; c.fillText(String(bar + 1), x + 4, 11); }
    } else if (ppb * unit >= 14) { c.strokeStyle = line; c.globalAlpha = 0.6; c.beginPath(); c.moveTo(x, 15); c.lineTo(x, 20); c.stroke(); c.globalAlpha = 1; }
  }
  c.strokeStyle = line; c.beginPath(); c.moveTo(0, 20.5); c.lineTo(w, 20.5); c.stroke();
}
function onRulerDown(e) {
  e.preventDefault();
  const rect = els.ruler.getBoundingClientRect(), p = S.project, y = e.clientY - rect.top;
  const toBeat = (ev) => (ev.clientX - rect.left + els.scroll.scrollLeft) / S.ui.ppb;
  if (y > 21) { // loop strip
    const b0 = toBeat(e), ppb = S.ui.ppb, L = p.loop; let mode = 'new';
    if (L.on) { if (Math.abs(b0 - L.start) * ppb < 8) mode = 'start'; else if (Math.abs(b0 - L.end) * ppb < 8) mode = 'end'; else if (b0 > L.start && b0 < L.end) mode = 'move'; }
    const o = { ...L }; checkpoint();
    let moved = false;
    drag(e, (ev) => {
      moved = true; const b = toBeat(ev), sn = (v) => Math.max(0, Math.round(v / beatsPerBar()) * beatsPerBar());
      if (mode === 'new') { const a = sn(Math.min(b0, b)), z = sn(Math.max(b0, b)); L.start = a; L.end = Math.max(z, a + beatsPerBar()); L.on = true; }
      else if (mode === 'start') L.start = clamp(sn(b), 0, o.end - beatsPerBar());
      else if (mode === 'end') L.end = Math.max(o.start + beatsPerBar(), sn(b));
      else { const d = sn(b) - sn(b0); L.start = Math.max(0, o.start + d); L.end = L.start + (o.end - o.start); }
      changed();
    }, () => { if (!moved && mode !== 'new') { L.on = !L.on; changed(); } });
    return;
  }
  const seek = (ev) => engine.seek(Math.max(0, snapBeat(toBeat(ev))));
  seek(e); drag(e, seek);
}
function updateLoopShade() {
  const p = S.project; if (!p) return;
  const on = p.loop.on, ppb = S.ui.ppb;
  els.loopShade.style.display = on ? '' : 'none';
  els.loopShade.style.left = HEADER_W + p.loop.start * ppb + 'px'; els.loopShade.style.width = (p.loop.end - p.loop.start) * ppb + 'px';
}
function updateSelection() {
  for (const r of rows.values()) {
    r.row.classList.toggle('selected', r.row.dataset.id === S.sel.track);
    for (const [id, o] of r.regions) o.el.classList.toggle('selected', S.sel.regions.has(id));
  }
}

// ---------- automation ----------
const NS = 'http://www.w3.org/2000/svg';
function drawAutomation(r, t) {
  const kind = S.ui.automation, svg = r.auto;
  svg.style.display = kind ? '' : 'none';
  r.lane.classList.toggle('auto-on', !!kind);
  if (!kind) { svg.replaceChildren(); return; }
  const H = t.height, ppb = S.ui.ppb, pts = t.auto[kind];
  const yOf = (v) => (kind === 'volume' ? (1 - (clamp(v, -48, 6) + 48) / 54) : (1 - (v + 1) / 2)) * (H - 10) + 5;
  const vOf = (y) => { const f = 1 - clamp((y - 5) / (H - 10), 0, 1); return kind === 'volume' ? (f <= 0.001 ? -60 : -48 + f * 54) : f * 2 - 1; };
  svg.replaceChildren();
  svg.setAttribute('width', parseFloat(r.lane.style.width) || 4000); svg.setAttribute('height', H);
  const def = kind === 'volume' ? t.vol : t.pan;
  const mk = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const path = pts.length ? `M0 ${yOf(pts[0].v)} ` + pts.map((p) => `L${p.t * ppb} ${yOf(p.v)}`).join(' ') + ` L${parseFloat(r.lane.style.width) || 4000} ${yOf(pts[pts.length - 1].v)}` : `M0 ${yOf(def)} L${parseFloat(r.lane.style.width) || 4000} ${yOf(def)}`;
  svg.append(mk('path', { d: path, class: 'auto-line' + (pts.length ? '' : ' idle') }));
  const hit = mk('path', { d: path, class: 'auto-hit' });
  hit.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault(); checkpoint();
    const rect = r.lane.getBoundingClientRect(), pt = { t: Math.max(0, snapBeat((e.clientX - rect.left) / ppb)), v: vOf(e.clientY - rect.top) };
    pts.push(pt); pts.sort((a, b) => a.t - b.t); changed(); dragPoint(e, pt, pts, rect, ppb, vOf);
  });
  svg.append(hit);
  for (const pt of pts) {
    const c = mk('circle', { cx: pt.t * ppb, cy: yOf(pt.v), r: 5, class: 'auto-pt' });
    c.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); checkpoint(); dragPoint(e, pt, pts, r.lane.getBoundingClientRect(), ppb, vOf); });
    c.addEventListener('dblclick', (e) => { e.stopPropagation(); checkpoint(); pts.splice(pts.indexOf(pt), 1); changed(); });
    svg.append(c);
  }
}
function dragPoint(e, pt, pts, rect, ppb, vOf) {
  drag(e, (ev) => { pt.t = Math.max(0, snapBeat((ev.clientX - rect.left) / ppb)); pt.v = vOf(ev.clientY - rect.top); pts.sort((a, b) => a.t - b.t); changed(); });
}

// ---------- animation frame: playhead, meters ----------
let lastScrollFollow = 0;
function frame() {
  requestAnimationFrame(frame);
  if (!S.project) return;
  const beat = engine.playing ? engine.displayPos() : S.pos, ppb = S.ui.ppb;
  const x = HEADER_W + beat * ppb;
  els.playhead.style.transform = `translateX(${x}px)`;
  if (engine.playing && settings.follow && !els.scroll.dragging) {
    const sc = els.scroll, vx = x - sc.scrollLeft;
    if (vx > sc.clientWidth - 40 || vx < HEADER_W) sc.scrollLeft = Math.max(0, beat * ppb - 30);
  }
  for (const r of rows.values()) {
    const m = r.header.el._meter; if (!m) continue;
    const lv = engine.playing || engine.live.size ? engine.trackLevel(r.header.el._trackId) : 0;
    const prev = r.header._lv || 0, v = Math.max(lv, prev * 0.86);
    r.header._lv = v; m.style.height = Math.min(100, Math.pow(v, 0.6) * 100) + '%';
  }
}
export function scrollToBeat(b) { els.scroll.scrollLeft = Math.max(0, b * S.ui.ppb - 40); }
export function getScroller() { return els.scroll; }
