// MIDI editor (piano roll / drum grid) with velocity lane.
import { h, clamp, uid, noteName, isBlack, drag, menuBelow, hexToRgba, SCALES } from '../util.js';
import { icon } from '../icons.js';
import { S, findRegion, checkpoint, changed, quantizeNotes, humanizeNotes, beatsPerBar } from '../state.js';
import { engine } from '../audio/engine.js';
import { DRUM_MAP } from '../audio/synth.js';
import { on } from '../util.js';

const KEYS_W = 72, RULER_H = 22, VEL_H = 68, VEL_HEAD = 16;
const GRIDS = [['1/4', 1], ['1/8', 0.5], ['1/8T', 1 / 3], ['1/16', 0.25], ['1/16T', 1 / 6], ['1/32', 0.125], ['Off', 0]];

export function mountPianoRoll(container, regionId) {
  const f0 = findRegion(regionId); if (!f0) return () => {};
  const drum = f0.track.type === 'drums' || f0.track.type === 'sampler';
  const ROWS = f0.track.type === 'sampler' ? f0.track.pads.map((pd, i) => ({ note: 36 + i, name: pd.name || 'Pad ' + (i + 1) })) : DRUM_MAP;
  const nRows = drum ? ROWS.length : 128;
  const rowOfPitch = (p) => { if (!drum) return p; let bi = 0, bd = 999; ROWS.forEach((d, i) => { const dd = Math.abs(d.note - p); if (dd < bd) { bd = dd; bi = i; } }); return bi; };
  const pitchOfRow = (r) => (drum ? ROWS[clamp(r, 0, nRows - 1)].note : clamp(r, 0, 127));
  const rowLabel = (r) => (drum ? ROWS[r].name : noteName(r));
  const view = { x0: 0, top: 70, ppb: 80, rowH: drum ? 24 : 16 };
  const st = { tool: 'pencil', grid: drum ? 0.25 : 0.25, sel: new Set(), lastLen: 0.25, scaleOn: true, clip: null, dirty: true };
  let cv, ctx, W = 0, H = 0, raf, alive = true, hover = null, heldKey = null;

  const reg = () => findRegion(regionId)?.region;
  const trackColor = () => findRegion(regionId)?.track.color || '#f44';
  const len = () => reg()?.loopLen || 4;

  // ---- UI scaffolding ----
  const root = h('div', { class: 'pr', tabindex: 0 });
  const nameEl = h('div', { class: 'pr-title' });
  const toolBtn = (id, ic, title) => h('button', { class: 'icon-btn tool' + (st.tool === id ? ' on' : ''), title, dataset: { t: id }, html: icon(ic, 16), onclick: () => { st.tool = id; root.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', b.dataset.t === id)); } });
  const gridBtn = h('button', { class: 'btn small', onclick: (e) => menuBelow(e.currentTarget, GRIDS.map(([n, v]) => ({ label: n, checked: st.grid === v, action: () => { st.grid = v; gridBtn.firstChild.textContent = 'Snap ' + n; } }))) }, h('span', null, 'Snap 1/16'), h('span', { html: icon('chevron', 12) }));
  const bars = h('input', { class: 'num-input', type: 'number', min: 1, max: 64, step: 1, title: 'Region length in bars', onchange: () => { const r = reg(); if (!r) return; checkpoint(); r.loopLen = Math.max(1, Math.round(+bars.value || 1)) * beatsPerBar(); r.length = r.loopLen; changed(); st.dirty = true; } });
  const mkBtn = (label, title, fn) => h('button', { class: 'btn small', title, onclick: fn }, label);
  const selNotes = () => { const r = reg(); const s = r.notes.filter((n) => st.sel.has(n.id)); return s.length ? s : r.notes; };
  const bar = h('div', { class: 'pr-bar' },
    nameEl,
    h('div', { class: 'tool-group' }, toolBtn('pencil', 'pencil', 'Draw (D)'), toolBtn('select', 'cursor', 'Select (S)'), toolBtn('erase', 'eraser', 'Erase (E)')),
    gridBtn,
    mkBtn('Quantize', 'Snap notes to the grid', () => { const r = reg(); checkpoint(); quantizeNotes(selNotes(), st.grid || 0.25); changed(); st.dirty = true; }),
    mkBtn('Humanize', 'Randomise timing and velocity slightly', () => { checkpoint(); humanizeNotes(selNotes()); changed(); st.dirty = true; }),
    drum ? null : h('div', { class: 'btn-group' }, mkBtn('−1', 'Transpose down a semitone', () => transpose(-1)), mkBtn('+1', 'Transpose up a semitone', () => transpose(1)), mkBtn('−8ve', 'Down an octave', () => transpose(-12)), mkBtn('+8ve', 'Up an octave', () => transpose(12))),
    drum ? null : h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { st.scaleOn = e.target.checked; st.dirty = true; } }), 'Scale'),
    h('div', { class: 'spacer' }),
    h('label', { class: 'muted small' }, 'Bars'), bars,
    h('button', { class: 'icon-btn', title: 'Zoom out', html: icon('zoomout', 16), onclick: () => zoom(1 / 1.3) }),
    h('button', { class: 'icon-btn', title: 'Zoom in', html: icon('zoomin', 16), onclick: () => zoom(1.3) }),
  );
  cv = h('canvas', { class: 'pr-canvas' });
  root.append(bar, h('div', { class: 'pr-wrap' }, cv));
  container.append(root);
  const wrap = root.querySelector('.pr-wrap');
  ctx = cv.getContext('2d');

  function transpose(d) { const r = reg(); checkpoint(); for (const n of selNotes()) n.p = clamp(n.p + d, 0, 127); changed(); st.dirty = true; }
  function zoom(f, ax = (W - KEYS_W) / 2) { const b = view.x0 + ax / view.ppb; view.ppb = clamp(view.ppb * f, 12, 600); view.x0 = Math.max(0, b - ax / view.ppb); st.dirty = true; }

  function resize() {
    const r = wrap.getBoundingClientRect(); W = Math.max(200, r.width); H = Math.max(120, r.height);
    const dpr = Math.min(2, devicePixelRatio || 1); cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (drum) view.rowH = Math.max(18, (H - RULER_H - VEL_H) / nRows);
    st.dirty = true;
  }
  const ro = new ResizeObserver(resize); ro.observe(wrap);

  const gridTop = RULER_H, gridH = () => H - RULER_H - VEL_H;
  const visRows = () => gridH() / view.rowH;
  const rowTopY = (r) => gridTop + (view.top - (r + 1)) * view.rowH; // y of the top edge of row r (row r spans [r, r+1))
  const xOf = (b) => KEYS_W + (b - view.x0) * view.ppb;
  const bOf = (x) => view.x0 + (x - KEYS_W) / view.ppb;
  const rowAtY = (y) => Math.floor(view.top - (y - gridTop) / view.rowH);
  const snapT = (b, floor = false) => (st.grid ? (floor ? Math.floor(b / st.grid + 1e-6) : Math.round(b / st.grid)) * st.grid : b);

  // ---- drawing ----
  function draw() {
    const r = reg(); if (!r) return;
    const col = trackColor(), css = getComputedStyle(document.documentElement);
    const C = (v) => css.getPropertyValue(v).trim();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = C('--pr-bg'); ctx.fillRect(0, 0, W, H);
    const L = len(), bpb = beatsPerBar(), key = S.project.key, sc = SCALES[S.project.scale] || SCALES.major;
    // rows
    ctx.save(); ctx.beginPath(); ctx.rect(KEYS_W, gridTop, W - KEYS_W, gridH()); ctx.clip();
    const r0 = Math.max(0, Math.floor(view.top - visRows()) - 1), r1 = Math.min(nRows - 1, Math.ceil(view.top));
    for (let row = r0; row <= r1; row++) {
      const y = rowTopY(row), blk = !drum && isBlack(row), inScale = drum || !st.scaleOn || sc.includes(((row - key) % 12 + 12) % 12);
      ctx.fillStyle = drum ? (row % 2 ? C('--pr-row-a') : C('--pr-row-b')) : blk ? C('--pr-row-black') : C('--pr-row-white');
      ctx.fillRect(KEYS_W, y, W - KEYS_W, view.rowH);
      if (!drum && st.scaleOn && inScale) { ctx.fillStyle = hexToRgba(col, row % 12 === key ? 0.14 : 0.05); ctx.fillRect(KEYS_W, y, W - KEYS_W, view.rowH); }
      ctx.fillStyle = C('--pr-line'); ctx.fillRect(KEYS_W, y + view.rowH - 1, W - KEYS_W, 1);
    }
    // vertical grid
    const g = st.grid || 0.25, unit = 4 / S.project.sig[1];
    const b0 = Math.max(0, Math.floor(bOf(KEYS_W) / g) * g), b1 = bOf(W);
    for (let b = b0; b <= Math.min(b1, L + bpb * 64); b += g) {
      const x = Math.round(xOf(b)) + 0.5, beat = Math.abs(b / unit - Math.round(b / unit)) < 1e-6, bar = Math.abs(b / bpb - Math.round(b / bpb)) < 1e-6;
      if (g * view.ppb < 5 && !beat) continue;
      ctx.fillStyle = bar ? C('--pr-bar') : beat ? C('--pr-beat') : C('--pr-sub');
      ctx.fillRect(x, gridTop, 1, gridH());
    }
    // shade beyond loop length
    const xe = xOf(L); if (xe < W) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(xe, gridTop, W - xe, gridH()); ctx.fillStyle = col; ctx.fillRect(xe - 1, gridTop, 2, gridH()); }
    // notes
    for (const n of r.notes) {
      const row = rowOfPitch(n.p), x = xOf(n.s), w = Math.max(3, n.l * view.ppb - 1), y = rowTopY(row);
      if (x + w < KEYS_W || x > W || y + view.rowH < gridTop || y > gridTop + gridH()) continue;
      const sel = st.sel.has(n.id), vel = n.v / 127;
      ctx.fillStyle = sel ? '#fff' : col; ctx.globalAlpha = sel ? 1 : 0.55 + vel * 0.45;
      ctx.beginPath(); ctx.roundRect(x, y + 1, w, view.rowH - 2, 3); ctx.fill(); ctx.globalAlpha = 1;
      if (sel) { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); }
      if (!drum && w > 34 && view.rowH >= 14) { ctx.fillStyle = sel ? '#222' : 'rgba(0,0,0,.6)'; ctx.font = '600 10px Inter, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText(noteName(n.p), x + 5, y + view.rowH / 2); }
    }
    ctx.restore();
    // keys
    ctx.save(); ctx.beginPath(); ctx.rect(0, gridTop, KEYS_W, gridH()); ctx.clip();
    for (let row = r0; row <= r1; row++) {
      const y = rowTopY(row), blk = !drum && isBlack(row), down = heldKey === row;
      ctx.fillStyle = down ? col : drum ? C('--pr-key-w') : blk ? C('--pr-key-b') : C('--pr-key-w');
      const kw = !drum && blk ? KEYS_W * 0.62 : KEYS_W;
      ctx.fillRect(0, y, kw, view.rowH - 1);
      if (!drum && blk) { ctx.fillStyle = C('--pr-key-w'); ctx.fillRect(kw, y, KEYS_W - kw, view.rowH - 1); if (down) { ctx.fillStyle = col; ctx.fillRect(0, y, kw, view.rowH - 1); } }
      const showLabel = drum || row % 12 === 0 || view.rowH >= 18;
      if (showLabel && (drum || !blk)) { ctx.fillStyle = down ? '#fff' : C('--pr-key-text'); ctx.font = '600 10px Inter, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText(rowLabel(row), 7, y + view.rowH / 2); }
      ctx.fillStyle = C('--pr-line'); ctx.fillRect(0, y + view.rowH - 1, KEYS_W, 1);
    }
    ctx.restore();
    // ruler
    ctx.fillStyle = C('--pr-ruler'); ctx.fillRect(0, 0, W, RULER_H);
    ctx.fillStyle = C('--pr-line'); ctx.fillRect(0, RULER_H - 1, W, 1);
    ctx.font = '600 10px Inter, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillStyle = C('--text-dim');
    for (let b = Math.floor(bOf(KEYS_W) / unit) * unit; b <= b1; b += unit) { if (b < 0) continue; const x = Math.round(xOf(b)) + 0.5; const isBar = Math.abs(b / bpb - Math.round(b / bpb)) < 1e-6; ctx.fillStyle = C('--pr-bar'); ctx.fillRect(x, isBar ? 4 : 14, 1, RULER_H - (isBar ? 8 : 15)); if (isBar) { ctx.fillStyle = C('--text-dim'); ctx.fillText(String(Math.round(b / bpb) + 1), x + 4, 10); } }
    // velocity lane
    const vy = H - VEL_H;
    ctx.fillStyle = C('--pr-vel-bg'); ctx.fillRect(0, vy, W, VEL_H);
    ctx.fillStyle = C('--pr-line'); ctx.fillRect(0, vy, W, 1);
    ctx.fillStyle = C('--text-dim'); ctx.font = '600 10px Inter, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText('Velocity', 8, vy + VEL_HEAD / 2 + 2);
    ctx.save(); ctx.beginPath(); ctx.rect(KEYS_W, vy + 1, W - KEYS_W, VEL_H - 1); ctx.clip();
    const bh = VEL_H - VEL_HEAD - 6;
    for (const n of r.notes) {
      const x = xOf(n.s); if (x > W || x < KEYS_W - 10) continue;
      const hh = (n.v / 127) * bh, sel = st.sel.has(n.id);
      ctx.fillStyle = sel ? '#fff' : col; ctx.globalAlpha = sel ? 1 : 0.8; ctx.fillRect(x, vy + VEL_H - 4 - hh, 3, hh); ctx.beginPath(); ctx.arc(x + 1.5, vy + VEL_H - 4 - hh, 3.5, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    }
    ctx.restore();
    // playhead
    if (engine.playing) {
      const reg0 = reg(); let rel = engine.displayPos() - reg0.start;
      if (rel >= 0 && rel < reg0.length) { rel = rel % L; const x = xOf(rel); if (x >= KEYS_W && x <= W) { ctx.fillStyle = C('--accent'); ctx.fillRect(x, 0, 2, H); } }
    }
    // hover ghost
    if (hover && st.tool === 'pencil' && hover.row >= 0) { const x = xOf(hover.beat), y = rowTopY(hover.row); ctx.fillStyle = hexToRgba(col, 0.35); ctx.fillRect(x, y + 1, Math.max(4, st.lastLen * view.ppb - 1), view.rowH - 2); }
    // marquee
    if (st.marq) { const m = st.marq; ctx.strokeStyle = '#fff'; ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1; ctx.fillRect(m.x0, m.y0, m.x1 - m.x0, m.y1 - m.y0); ctx.strokeRect(m.x0 + 0.5, m.y0 + 0.5, m.x1 - m.x0, m.y1 - m.y0); }
  }
  function loop() { if (!alive) return; raf = requestAnimationFrame(loop); if (st.dirty || engine.playing) { st.dirty = false; try { draw(); } catch (e) { console.error(e); } } }

  // ---- hit testing ----
  const noteHit = (x, y) => {
    const r = reg(); let hitN = null;
    for (let i = r.notes.length - 1; i >= 0; i--) {
      const n = r.notes[i], nx = xOf(n.s), w = Math.max(3, n.l * view.ppb), ny = rowTopY(rowOfPitch(n.p));
      if (x >= nx && x <= nx + w && y >= ny && y <= ny + view.rowH) { hitN = { n, zone: x > nx + w - 6 && w > 12 ? 'right' : 'body' }; break; }
    }
    return hitN;
  };
  const velHit = (x, y) => {
    const r = reg(), vy = H - VEL_H; let best = null, bd = 12;
    for (const n of r.notes) { const nx = xOf(n.s) + 1.5; const d = Math.abs(nx - x); if (d < bd) { bd = d; best = n; } }
    return best;
  };

  cv.addEventListener('pointermove', (e) => {
    const rc = cv.getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top;
    if (x > KEYS_W && y > gridTop && y < H - VEL_H) { hover = { beat: Math.max(0, snapT(bOf(x), true)), row: rowAtY(y) }; const hn = noteHit(x, y); cv.style.cursor = hn ? (hn.zone === 'right' ? 'ew-resize' : st.tool === 'erase' ? 'not-allowed' : 'grab') : st.tool === 'select' ? 'crosshair' : 'cell'; } else { hover = null; cv.style.cursor = x < KEYS_W ? 'pointer' : y >= H - VEL_H ? 'ns-resize' : 'default'; }
    st.dirty = true;
  });
  cv.addEventListener('pointerleave', () => { hover = null; st.dirty = true; });
  cv.addEventListener('contextmenu', (e) => { e.preventDefault(); const rc = cv.getBoundingClientRect(), hn = noteHit(e.clientX - rc.left, e.clientY - rc.top); if (hn) { checkpoint(); const r = reg(); r.notes = r.notes.filter((n) => n !== hn.n); st.sel.delete(hn.n.id); changed(); st.dirty = true; } });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rc = cv.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoom(Math.pow(1.002, -e.deltaY), e.clientX - rc.left - KEYS_W);
    else if (e.altKey && !drum) { view.rowH = clamp(view.rowH * Math.pow(1.002, -e.deltaY), 9, 34); }
    else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) view.x0 = Math.max(0, view.x0 + (e.deltaX || e.deltaY) / view.ppb);
    else if (!drum) view.top = clamp(view.top + e.deltaY / view.rowH, visRows(), 128);
    st.dirty = true;
  }, { passive: false });

  cv.addEventListener('pointerdown', (e) => {
    root.focus();
    const rc = cv.getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top, r = reg(); if (!r) return;
    if (e.button === 2) return;
    // keys
    if (x < KEYS_W && y > gridTop && y < H - VEL_H) {
      const row = rowAtY(y), p = pitchOfRow(row); heldKey = row; st.dirty = true;
      engine.noteOn(f0.track.id, p, 100);
      drag(e, () => {}, () => { engine.noteOff(f0.track.id, p); heldKey = null; st.dirty = true; });
      return;
    }
    // velocity lane
    if (y >= H - VEL_H && x > KEYS_W) {
      checkpoint();
      const setV = (ev) => { const yy = ev.clientY - rc.top, vy = H - VEL_H, bh = VEL_H - VEL_HEAD - 6; const n = velHit(ev.clientX - rc.left, yy); if (n) { n.v = clamp(Math.round(((vy + VEL_H - 4 - yy) / bh) * 127), 1, 127); changed(); st.dirty = true; } };
      setV(e); drag(e, setV); return;
    }
    if (y < gridTop && x > KEYS_W) { engine.seek(reg().start + clamp(bOf(x), 0, len())); return; }
    if (x < KEYS_W || y > H - VEL_H) return;
    const hn = noteHit(x, y), beat = bOf(x);
    if (st.tool === 'erase') {
      if (hn) { checkpoint(); r.notes = r.notes.filter((n) => n !== hn.n); changed(); st.dirty = true; }
      const sweep = (ev) => { const h2 = noteHit(ev.clientX - rc.left, ev.clientY - rc.top); if (h2) { r.notes = r.notes.filter((n) => n !== h2.n); changed(); st.dirty = true; } };
      drag(e, sweep); return;
    }
    if (hn) {
      const n = hn.n;
      if (!st.sel.has(n.id)) { if (!e.shiftKey) st.sel = new Set(); st.sel.add(n.id); }
      else if (e.shiftKey) { st.sel.delete(n.id); st.dirty = true; return; }
      st.dirty = true;
      engine.previewNote(f0.track.id, n.p, 180, n.v);
      checkpoint();
      const sels = r.notes.filter((q) => st.sel.has(q.id)), orig = sels.map((q) => ({ ...q }));
      const row0 = rowOfPitch(n.p), b0 = beat; let dup = e.altKey && hn.zone === 'body', moved = false;
      if (hn.zone === 'right') {
        drag(e, (ev) => { const d = bOf(ev.clientX - rc.left) - b0; sels.forEach((q, i) => { let nl = orig[i].l + d; nl = st.grid ? Math.max(st.grid, Math.round((orig[i].s + nl) / st.grid) * st.grid - orig[i].s) : Math.max(0.03, nl); q.l = nl; }); st.lastLen = n.l; changed(); st.dirty = true; });
        return;
      }
      let lastPreviewPitch = n.p;
      drag(e, (ev) => {
        const dB = bOf(ev.clientX - rc.left) - b0, dR = rowAtY(ev.clientY - rc.top) - row0;
        if (!moved && Math.abs(ev.clientX - e.clientX) < 3 && Math.abs(ev.clientY - e.clientY) < 3) return;
        if (!moved && dup) { const copies = sels.map((q) => ({ ...q, id: uid('n') })); r.notes.push(...copies); st.sel = new Set(copies.map((c) => c.id)); sels.splice(0, sels.length, ...copies); }
        moved = true;
        let ds = st.grid ? Math.round((orig[0].s + dB) / st.grid) * st.grid - orig[0].s : dB;
        const minS = Math.min(...orig.map((q) => q.s)); if (minS + ds < 0) ds = -minS;
        sels.forEach((q, i) => { q.s = orig[i].s + ds; if (!drum) q.p = clamp(orig[i].p + dR, 0, 127); else q.p = pitchOfRow(rowOfPitch(orig[i].p) + dR); });
        if (dR && sels.length === 1 && sels[0].p !== lastPreviewPitch) { engine.previewNote(f0.track.id, sels[0].p, 120, sels[0].v); lastPreviewPitch = sels[0].p; }
        changed(); st.dirty = true;
      });
      return;
    }
    if (st.tool === 'pencil' && !e.shiftKey) {
      checkpoint();
      const row = rowAtY(y), s0 = Math.max(0, snapT(beat, true));
      if (s0 >= len()) { r.loopLen = r.length = Math.ceil((s0 + 1) / beatsPerBar()) * beatsPerBar(); bars.value = Math.round(r.loopLen / beatsPerBar()); }
      const n = { id: uid('n'), p: pitchOfRow(row), s: s0, l: st.lastLen || st.grid || 0.25, v: 100 };
      r.notes.push(n); st.sel = new Set([n.id]); engine.previewNote(f0.track.id, n.p, 220, n.v); changed(); st.dirty = true;
      let resized = false;
      drag(e, (ev) => {
        const end = bOf(ev.clientX - rc.left);
        if (Math.abs(ev.clientX - e.clientX) > 4) resized = true;
        if (resized) { n.l = st.grid ? Math.max(st.grid, Math.round(end / st.grid) * st.grid - n.s) : Math.max(0.03, end - n.s); changed(); st.dirty = true; }
      }, () => { st.lastLen = n.l; });
      return;
    }
    // select tool marquee
    if (!e.shiftKey) st.sel = new Set();
    const base = new Set(st.sel); st.marq = { x0: x, y0: y, x1: x, y1: y };
    drag(e, (ev) => {
      const mx = ev.clientX - rc.left, my = ev.clientY - rc.top; st.marq = { x0: Math.min(x, mx), y0: Math.min(y, my), x1: Math.max(x, mx), y1: Math.max(y, my) };
      const m = st.marq; st.sel = new Set(base);
      for (const n of r.notes) { const nx = xOf(n.s), ny = rowTopY(rowOfPitch(n.p)), nw = n.l * view.ppb; if (nx < m.x1 && nx + nw > m.x0 && ny < m.y1 && ny + view.rowH > m.y0) st.sel.add(n.id); }
      st.dirty = true;
    }, () => { st.marq = null; st.dirty = true; });
  });
  cv.addEventListener('dblclick', (e) => {
    if (st.tool !== 'select') return;
    const rc = cv.getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top; if (x < KEYS_W || y < gridTop || y > H - VEL_H || noteHit(x, y)) return;
    checkpoint(); const r = reg(); r.notes.push({ id: uid('n'), p: pitchOfRow(rowAtY(y)), s: Math.max(0, snapT(bOf(x), true)), l: st.lastLen || 0.25, v: 100 }); changed(); st.dirty = true;
  });

  root.addEventListener('keydown', (e) => {
    const r = reg(); if (!r) return;
    const k = e.key.toLowerCase();
    if (k === 'delete' || k === 'backspace') { if (st.sel.size) { checkpoint(); r.notes = r.notes.filter((n) => !st.sel.has(n.id)); st.sel.clear(); changed(); st.dirty = true; } e.preventDefault(); e.stopPropagation(); }
    else if (k === 'a' && (e.ctrlKey || e.metaKey)) { st.sel = new Set(r.notes.map((n) => n.id)); st.dirty = true; e.preventDefault(); e.stopPropagation(); }
    else if (k === 'c' && (e.ctrlKey || e.metaKey)) { st.clip = r.notes.filter((n) => st.sel.has(n.id)).map((n) => ({ ...n })); e.stopPropagation(); }
    else if (k === 'v' && (e.ctrlKey || e.metaKey) && st.clip?.length) { checkpoint(); const min = Math.min(...st.clip.map((n) => n.s)), at = Math.max(0, Math.min(len() - 0.25, engine.playing ? engine.pos() - r.start : min)); const add = st.clip.map((n) => ({ ...n, id: uid('n'), s: n.s - min + (hover ? hover.beat : at) })); r.notes.push(...add); st.sel = new Set(add.map((n) => n.id)); changed(); st.dirty = true; e.preventDefault(); e.stopPropagation(); }
    else if (k === 'd' && (e.ctrlKey || e.metaKey)) { if (st.sel.size) { checkpoint(); const src = r.notes.filter((n) => st.sel.has(n.id)), span = Math.max(...src.map((n) => n.s + n.l)) - Math.min(...src.map((n) => n.s)); const add = src.map((n) => ({ ...n, id: uid('n'), s: n.s + span })); r.notes.push(...add); st.sel = new Set(add.map((n) => n.id)); changed(); st.dirty = true; } e.preventDefault(); e.stopPropagation(); }
    else if (['arrowup', 'arrowdown'].includes(k) && st.sel.size && !drum) { transpose(k === 'arrowup' ? (e.shiftKey ? 12 : 1) : e.shiftKey ? -12 : -1); e.preventDefault(); e.stopPropagation(); }
    else if (['arrowleft', 'arrowright'].includes(k) && st.sel.size) { checkpoint(); const d = (st.grid || 0.25) * (k === 'arrowright' ? 1 : -1); for (const n of r.notes) if (st.sel.has(n.id)) n.s = Math.max(0, n.s + d); changed(); st.dirty = true; e.preventDefault(); e.stopPropagation(); }
    else if (k === 'd' && !e.ctrlKey) { st.tool = 'pencil'; syncTools(); e.stopPropagation(); }
    else if (k === 's' && !e.ctrlKey && !e.metaKey) { st.tool = 'select'; syncTools(); e.stopPropagation(); }
    else if (k === 'e') { st.tool = 'erase'; syncTools(); e.stopPropagation(); }
  });
  function syncTools() { root.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', b.dataset.t === st.tool)); }

  const sync = () => { const r = reg(); if (!r) return; nameEl.textContent = r.name; nameEl.style.setProperty('--c', trackColor()); bars.value = Math.round(r.loopLen / beatsPerBar() * 100) / 100; gridBtn.firstChild.textContent = 'Snap ' + (GRIDS.find(([, v]) => v === st.grid)?.[0] || 'Off'); st.dirty = true; };
  const off = on('project', sync);
  // initial view
  const r0 = reg();
  if (drum) view.top = nRows; else { const ps = r0.notes.map((n) => n.p); const mid = ps.length ? (Math.min(...ps) + Math.max(...ps)) / 2 : 64; view.top = mid + 10; }
  view.ppb = clamp(((wrap.clientWidth || 800) - KEYS_W - 20) / Math.max(4, len()), 20, 140);
  sync(); resize(); loop();
  return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); off(); root.remove(); };
}
