// Small shared helpers.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const uid = (p = 'x') => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
export const dbToGain = (db) => (db <= -60 ? 0 : Math.pow(10, db / 20));
export const gainToDb = (g) => (g <= 0.001 ? -60 : 20 * Math.log10(g));
export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
export const isBlack = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
export const KEYS = NOTE_NAMES;
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonic: [0, 2, 4, 7, 9],
  'minor pentatonic': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
export const TRACK_COLORS = ['#f4433c', '#ff7a2f', '#ffb020', '#8bc34a', '#22c78a', '#1fb5c9', '#3b8bff', '#7c5cff', '#c05cff', '#ff5ca8'];

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function throttleRaf(fn) {
  let queued = false;
  return (...a) => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fn(...a); }); };
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export function fmtTime(sec, ms = true) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(ms ? 1 : 0)}`;
}

export function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// Tiny pub/sub
const listeners = {};
export const on = (e, fn) => ((listeners[e] ||= new Set()).add(fn), () => listeners[e].delete(fn));
export const emit = (e, d) => listeners[e]?.forEach((fn) => { try { fn(d); } catch (err) { console.error(err); } });

// Toasts
export function toast(msg, kind = '') {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + kind }, msg);
  box.append(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3000);
}

// Context menu / dropdown
let openMenu = null;
export function closeMenu() { openMenu?.remove(); openMenu = null; }
export function showMenu(x, y, items, opts = {}) {
  closeMenu();
  const m = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it === '-' || it.sep) { m.append(h('div', { class: 'menu-sep' })); continue; }
    if (it.header) { m.append(h('div', { class: 'menu-header' }, it.header)); continue; }
    const row = h('div', {
      class: 'menu-item' + (it.disabled ? ' disabled' : '') + (it.checked ? ' checked' : ''),
      onclick: (e) => {
        e.stopPropagation();
        if (it.disabled) return;
        if (it.items) return;
        closeMenu();
        it.action?.();
      },
    }, h('span', { class: 'mi-check' }, it.checked ? '✓' : ''), h('span', { class: 'mi-label' }, it.label), it.shortcut ? h('span', { class: 'mi-key' }, it.shortcut) : null, it.items ? h('span', { class: 'mi-key' }, '›') : null);
    if (it.items) {
      row.addEventListener('mouseenter', () => {
        m.querySelectorAll('.menu.sub').forEach((s) => s.remove());
        const r = row.getBoundingClientRect();
        const sub = showSub(r.right - 4, r.top - 6, it.items);
        m.append(sub);
      });
    }
    m.append(row);
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  openMenu = m;
  setTimeout(() => window.addEventListener('pointerdown', (e) => { if (!m.contains(e.target)) closeMenu(); }, { once: true, capture: true }), 0);
  return m;
}
function showSub(x, y, items) {
  const m = h('div', { class: 'menu sub', style: { left: x + 'px', top: y + 'px' } });
  for (const it of items) {
    m.append(h('div', { class: 'menu-item' + (it.checked ? ' checked' : ''), onclick: (e) => { e.stopPropagation(); closeMenu(); it.action?.(); } }, h('span', { class: 'mi-check' }, it.checked ? '✓' : ''), h('span', { class: 'mi-label' }, it.label)));
  }
  return m;
}
export function menuBelow(el, items) {
  const r = el.getBoundingClientRect();
  return showMenu(r.left, r.bottom + 4, items);
}

// Modal dialog
export function modal(title, body, { width = 520, actions = [], onClose, cls = '' } = {}) {
  const back = h('div', { class: 'modal-back' });
  const close = () => { back.remove(); onClose?.(); document.removeEventListener('keydown', esc, true); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', esc, true);
  const box = h('div', { class: 'modal ' + cls, style: { width: width + 'px' }, role: 'dialog' },
    h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'icon-btn', onclick: close, 'aria-label': 'Close', html: '✕' })),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('div', { class: 'modal-foot' }, actions.map((a) => h('button', { class: 'btn ' + (a.primary ? 'primary' : ''), onclick: () => { const r = a.action?.(close); if (r !== false && !a.keepOpen) close(); } }, a.label))) : null);
  back.append(box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  document.body.append(back);
  return { close, box };
}

export function confirmDialog(title, text, okLabel = 'OK') {
  return new Promise((res) => {
    let done = false;
    modal(title, h('p', { class: 'muted' }, text), { width: 420, onClose: () => { if (!done) res(false); }, actions: [{ label: 'Cancel' }, { label: okLabel, primary: true, action: () => { done = true; res(true); } }] });
  });
}
export function promptDialog(title, value = '', label = '') {
  return new Promise((res) => {
    const inp = h('input', { class: 'text-input', value, type: 'text' });
    let done = false;
    const m = modal(title, h('div', null, label ? h('label', { class: 'muted small' }, label) : null, inp), { width: 400, onClose: () => { if (!done) res(null); }, actions: [{ label: 'Cancel' }, { label: 'OK', primary: true, action: () => { done = true; res(inp.value); } }] });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { done = true; res(inp.value); m.close(); } });
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });
}

// Rotary knob
export function knob({ value, min, max, def, step = 0, label, unit = '', fmt, onChange, size = 38, log = false, color }) {
  const wrap = h('div', { class: 'knob', title: label + ' (double-click to reset)' });
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40'); svg.setAttribute('width', size); svg.setAttribute('height', size);
  const track = document.createElementNS(NS, 'path');
  const arc = document.createElementNS(NS, 'path');
  const dot = document.createElementNS(NS, 'line');
  track.setAttribute('class', 'k-track'); arc.setAttribute('class', 'k-arc'); dot.setAttribute('class', 'k-dot');
  if (color) arc.style.stroke = color;
  svg.append(track, arc, dot);
  const val = h('div', { class: 'k-val' });
  const lab = h('div', { class: 'k-label' }, label);
  wrap.append(svg, val, lab);
  const A0 = -225, A1 = 45;
  const pt = (a, r) => [20 + r * Math.cos((a * Math.PI) / 180), 20 + r * Math.sin((a * Math.PI) / 180)];
  const arcPath = (a0, a1) => { const [x0, y0] = pt(a0, 15), [x1, y1] = pt(a1, 15); return `M${x0} ${y0} A15 15 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`; };
  const toN = (v) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromN = (n) => (log ? min * Math.pow(max / min, n) : min + n * (max - min));
  let cur = value;
  const fmtV = (v) => (fmt ? fmt(v) : (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2).replace(/\.?0+$/, '') || '0') + unit);
  const draw = () => {
    const n = clamp(toN(cur), 0, 1), a = A0 + n * (A1 - A0);
    track.setAttribute('d', arcPath(A0, A1));
    const bipolar = min < 0 && max > 0 && !log;
    const zero = bipolar ? A0 + (-min / (max - min)) * (A1 - A0) : A0;
    arc.setAttribute('d', arcPath(Math.min(zero, a), Math.max(zero, a) + 0.01));
    const [x0, y0] = pt(a, 6), [x1, y1] = pt(a, 14);
    dot.setAttribute('x1', x0); dot.setAttribute('y1', y0); dot.setAttribute('x2', x1); dot.setAttribute('y2', y1);
    val.textContent = fmtV(cur);
  };
  const set = (v, fire = true) => {
    v = clamp(v, min, max);
    if (step) v = Math.round(v / step) * step;
    cur = v; draw(); if (fire) onChange?.(v);
  };
  svg.addEventListener('pointerdown', (e) => {
    e.preventDefault(); svg.setPointerCapture(e.pointerId);
    const y0 = e.clientY, n0 = toN(cur);
    const mv = (ev) => set(fromN(clamp(n0 + ((y0 - ev.clientY) / (ev.shiftKey ? 600 : 150)), 0, 1)));
    const up = () => { svg.removeEventListener('pointermove', mv); svg.removeEventListener('pointerup', up); };
    svg.addEventListener('pointermove', mv); svg.addEventListener('pointerup', up);
  });
  svg.addEventListener('dblclick', () => set(def));
  svg.addEventListener('wheel', (e) => { e.preventDefault(); set(fromN(clamp(toN(cur) - Math.sign(e.deltaY) * 0.02, 0, 1))); }, { passive: false });
  draw();
  wrap.set = (v) => { cur = v; draw(); };
  return wrap;
}

export function drag(e, onMove, onUp) {
  const mv = (ev) => onMove(ev);
  const up = (ev) => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); onUp?.(ev); };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
