// Bottom-panel editors: sample (audio region) editor, sampler pads and on-screen keyboard.
import { h, clamp, knob, drag, toast, uid, on, isBlack, noteName, debounce, modal } from '../util.js';
import { icon } from '../icons.js';
import { S, findRegion, getTrack, checkpoint, changed, setRegionSpeed, beatsPerBar, contentBeats, addTrack, makeAudioRegion, selectRegions, settings } from '../state.js';
import { engine, audioInfo, dropProcCache } from '../audio/engine.js';
import { computePeaks, normalizeBuffer, slicePeak, splitStems } from '../audio/dsp.js';
import { liveNote, captureMic, liveTarget } from '../audio/record.js';
import { pickAudioFiles, bounceRegionToWav } from './actions.js';

// ---------------- Sample editor ----------------
export function mountSampleEditor(container, regionId) {
  const f0 = findRegion(regionId); if (!f0) return () => {};
  const reg = () => findRegion(regionId)?.region;
  const root = h('div', { class: 'se' });
  const cv = h('canvas', { class: 'se-canvas' });
  const controls = h('div', { class: 'se-controls' });
  root.append(h('div', { class: 'se-wave' }, cv), controls);
  container.append(root);
  let W = 0, H = 0, alive = true, peaks = null, peaksBuf = null;
  const cpOnce = (() => { let t = 0; return () => { if (Date.now() - t > 900) checkpoint(); t = Date.now(); }; })();
  const refreshProc = debounce(() => changed(true), 260);

  function draw() {
    const r = reg(); if (!r) return;
    const base = S.buffers.get(r.bufferId); if (!base) return;
    if (peaksBuf !== base) { peaks = computePeaks(base, 256); peaksBuf = base; }
    const dpr = Math.min(2, devicePixelRatio || 1), rect = cv.parentElement.getBoundingClientRect();
    W = Math.max(100, rect.width); H = Math.max(60, rect.height);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement), col = f0.track.color, D = base.duration;
    c.fillStyle = css.getPropertyValue('--pr-bg'); c.fillRect(0, 0, W, H);
    const x0 = (r.srcOffset / D) * W, x1 = ((r.srcOffset + r.srcLen) / D) * W, mid = H / 2, amp = mid - 8, bs = 256 / base.sampleRate;
    c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, 0, x0, H); c.fillRect(x1, 0, W - x1, H);
    for (let x = 0; x < W; x++) {
      const t0 = (x / W) * D, t1 = ((x + 1) / W) * D, i0 = Math.floor(t0 / bs), i1 = Math.min(peaks.length / 2 - 1, Math.max(i0, Math.floor(t1 / bs)));
      let mn = 1, mx = -1; for (let i = i0; i <= i1; i++) { mn = Math.min(mn, peaks[i * 2]); mx = Math.max(mx, peaks[i * 2 + 1]); }
      if (mn > mx) continue;
      c.fillStyle = x >= x0 && x <= x1 ? col : 'rgba(150,150,150,.5)';
      c.fillRect(x, mid - mx * amp, 1, Math.max(1, (mx - mn) * amp));
    }
    c.fillStyle = col; c.fillRect(x0 - 1, 0, 3, H); c.fillRect(x1 - 2, 0, 3, H);
    c.fillStyle = 'rgba(255,255,255,.9)'; c.fillRect(x0 - 5, 0, 10, 16); c.fillRect(x1 - 5, H - 16, 10, 16);
    c.fillStyle = css.getPropertyValue('--text-dim'); c.font = '600 10px Inter, sans-serif'; c.textBaseline = 'top';
    c.fillText(`${r.name} · ${D.toFixed(2)} s · ${base.numberOfChannels === 1 ? 'mono' : 'stereo'} · ${base.sampleRate / 1000} kHz`, 14, H - 14 > 0 ? 6 : 6);
    if (engine.playing) { const rel = engine.displayPos() - r.start; if (rel >= 0 && rel < r.length) { const cb = contentBeats(r), within = rel % cb, sec = r.srcOffset + within * (60 / S.project.bpm) * r.speed; const px = (r.reverse ? D - sec : sec) / D * W; c.fillStyle = css.getPropertyValue('--accent'); c.fillRect(px, 0, 2, H); } }
  }
  cv.addEventListener('pointerdown', (e) => {
    const r = reg(), base = S.buffers.get(r.bufferId); if (!r || !base) return;
    const rc = cv.getBoundingClientRect(), D = base.duration, spb = 60 / S.project.bpm;
    const x0 = (r.srcOffset / D) * W, x1 = ((r.srcOffset + r.srcLen) / D) * W, x = e.clientX - rc.left;
    const mode = Math.abs(x - x0) < 9 ? 'l' : Math.abs(x - x1) < 9 ? 'r' : null; if (!mode) return;
    checkpoint(); const o = { off: r.srcOffset, len: r.srcLen };
    drag(e, (ev) => {
      const t = clamp(((ev.clientX - rc.left) / W) * D, 0, D);
      if (mode === 'l') { const no = clamp(t, 0, o.off + o.len - 0.02); r.srcOffset = no; r.srcLen = o.off + o.len - no; }
      else r.srcLen = clamp(t - o.off, 0.02, D - o.off);
      r.length = (r.srcLen / r.speed) / spb;
      changed();
    });
  });

  const ctl = () => {
    const r = reg(); if (!r) return; controls.replaceChildren();
    const num = (label, props) => h('label', { class: 'se-field' }, h('span', null, label), h('input', { class: 'num-input', type: 'number', ...props }));
    const srcBpm = num('Source BPM', { min: 30, max: 300, step: 0.1, placeholder: '—', title: 'Enter the original tempo of this clip, then press Fit' });
    controls.append(
      knob({ value: r.gain || 0, min: -24, max: 12, def: 0, label: 'Gain', unit: ' dB', size: 46, onChange: (v) => { cpOnce(); reg().gain = v; changed(); } }),
      knob({ value: r.pitch || 0, min: -12, max: 12, def: 0, step: 1, label: 'Pitch', unit: ' st', size: 46, onChange: (v) => { cpOnce(); reg().pitch = v; refreshProc(); } }),
      knob({ value: r.speed || 1, min: 0.5, max: 2, def: 1, label: 'Speed', unit: '×', size: 46, onChange: (v) => { cpOnce(); const rr = reg(); const nv = Math.round(v * 100) / 100; if (nv !== rr.speed) setRegionSpeed(rr, nv); refreshProc(); } }),
      knob({ value: r.fadeIn || 0, min: 0, max: Math.max(0.5, r.length / 2), def: 0, label: 'Fade in', unit: ' b', size: 46, onChange: (v) => { cpOnce(); reg().fadeIn = v; changed(); } }),
      knob({ value: r.fadeOut || 0, min: 0, max: Math.max(0.5, r.length / 2), def: 0, label: 'Fade out', unit: ' b', size: 46, onChange: (v) => { cpOnce(); reg().fadeOut = v; changed(); } }),
      h('div', { class: 'se-btns' },
        h('button', { class: 'btn' + (r.reverse ? ' primary' : ''), onclick: () => { checkpoint(); reg().reverse = !reg().reverse; changed(true); ctl(); } }, 'Reverse'),
        h('button', { class: 'btn', onclick: async () => { const rr = reg(), base = S.buffers.get(rr.bufferId); checkpoint(); const pk = slicePeak(base); rr.gain = Math.min(24, 20 * Math.log10(0.97 / Math.max(pk, 1e-4))); changed(); ctl(); toast(`Normalised (${rr.gain.toFixed(1)} dB gain)`); } }, 'Normalise'),
        h('button', { class: 'btn', onclick: () => splitterDialog(regionId) }, 'Split stems…'),
        h('button', { class: 'btn', onclick: () => bounceRegionToWav(regionId) }, 'Export WAV')),
      h('div', { class: 'se-fit' }, srcBpm, h('button', { class: 'btn', onclick: () => { const v = +srcBpm.querySelector('input').value; if (!v) return toast('Enter the clip’s original BPM', 'warn'); checkpoint(); const rr = reg(); setRegionSpeed(rr, Math.round(clamp(S.project.bpm / v, 0.5, 2) * 100) / 100); changed(true); ctl(); toast(`Stretched to ${S.project.bpm} BPM`); } }, 'Fit to tempo')));
  };
  ctl();
  let raf; const loop = () => { if (!alive) return; raf = requestAnimationFrame(loop); draw(); }; loop();
  return () => { alive = false; cancelAnimationFrame(raf); root.remove(); };
}

export async function splitterDialog(regionId) {
  const f = findRegion(regionId); if (!f || f.region.type !== 'audio') return toast('Select an audio region first', 'warn');
  const r = f.region, base = S.buffers.get(r.bufferId);
  const status = h('p', { class: 'muted' }, 'Splits the clip into four stems using filtering and stereo-centre extraction. This is a lightweight DSP splitter – not AI source separation – so results depend on how the song was mixed.');
  let m;
  m = modal('Split into stems', status, { width: 480, actions: [{ label: 'Cancel' }, { label: 'Split', primary: true, keepOpen: true, action: async () => {
    status.textContent = 'Processing…';
    await new Promise((res) => setTimeout(res, 40));
    const stems = await splitStems(base);
    checkpoint();
    for (const st of stems) {
      const id = uid('b'); S.buffers.set(id, st.buffer);
      const t = addTrack('audio', { name: `${r.name} – ${st.name}` });
      const nr = { ...JSON.parse(JSON.stringify(r)), id: uid('r'), bufferId: id, name: st.name };
      t.regions.push(nr);
    }
    f.track.mute = true; changed(); toast('Stems added as new tracks (original muted)'); m.close(); return false;
  } }] });
}

// ---------------- Sampler pads ----------------
export function mountPads(container) {
  const root = h('div', { class: 'pads' });
  container.append(root);
  let selPad = 0;
  const trk = () => { const t = getTrack(S.sel.track); return t?.type === 'sampler' ? t : null; };
  function render() {
    root.replaceChildren(); const t = trk();
    if (!t) { root.append(h('div', { class: 'muted center pad' }, 'Select a Sampler track to play and edit its pads. Add one with “Add track → Sampler”.')); return; }
    const grid = h('div', { class: 'pad-grid' });
    const order = [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3];
    for (const i of order) {
      const p = t.pads[i];
      const el = h('button', { class: 'pad' + (i === selPad ? ' sel' : '') + (p.bufferId ? ' loaded' : ''), dataset: { n: i }, style: { '--pc': t.color } }, h('span', { class: 'pad-n' }, i + 1), h('span', { class: 'pad-name' }, p.name || (p.bufferId ? 'Sample' : 'Drum')));
      el.addEventListener('pointerdown', (e) => { selPad = i; el.classList.add('hit'); liveNote(36 + i, 100, true, t.id); drag(e, () => {}, () => { el.classList.remove('hit'); liveNote(36 + i, 0, false, t.id); }); root.querySelectorAll('.pad').forEach((b) => b.classList.toggle('sel', +b.dataset.n === selPad)); side(); });
      grid.append(el);
    }
    const sideEl = h('div', { class: 'pad-side' }); root.append(grid, sideEl);
    function side() {
      sideEl.replaceChildren(); const p = t.pads[selPad], buf = p.bufferId && S.buffers.get(p.bufferId);
      let rec = null;
      const recBtn = h('button', { class: 'btn', onclick: async () => {
        if (rec) { const b = await rec.stop(); rec = null; recBtn.classList.remove('primary'); recBtn.innerHTML = icon('mic', 14) + ' Record'; if (b) { checkpoint(); const id = uid('b'); S.buffers.set(id, normalizeBuffer(engine.ctx, b)); p.bufferId = id; p.name = 'Rec ' + (selPad + 1); changed(); render(); } return; }
        try { rec = await captureMic(); recBtn.classList.add('primary'); recBtn.textContent = '● Stop'; } catch (e) { toast('Microphone unavailable: ' + e.message, 'error'); }
      }, html: icon('mic', 14) + ' Record' });
      sideEl.append(h('div', { class: 'sb-title' }, `Pad ${selPad + 1}`, h('span', { class: 'muted small' }, ' · ' + (buf ? p.name || 'Sample' : 'Built-in drum sound'))),
        h('div', { class: 'row gap wrap' }, recBtn,
          h('button', { class: 'btn', onclick: () => { const i = h('input', { type: 'file', accept: 'audio/*' }); i.onchange = async () => { const f = i.files[0]; if (!f) return; await engine.init(); const b = await engine.ctx.decodeAudioData(await f.arrayBuffer()); checkpoint(); const id = uid('b'); S.buffers.set(id, b); p.bufferId = id; p.name = f.name.replace(/\.[^.]+$/, '').slice(0, 14); changed(); render(); }; i.click(); }, html: icon('upload', 14) + ' Load sample' }),
          h('button', { class: 'btn', disabled: !p.bufferId, onclick: () => { checkpoint(); p.bufferId = null; p.name = ''; changed(); render(); } }, 'Clear')),
        h('div', { class: 'row gap' }, knob({ value: p.vol || 0, min: -24, max: 12, def: 0, label: 'Volume', unit: ' dB', onChange: (v) => { p.vol = v; changed(); } }), knob({ value: p.pitch || 0, min: -12, max: 12, def: 0, step: 1, label: 'Pitch', unit: ' st', onChange: (v) => { p.pitch = v; changed(); } })),
        h('p', { class: 'muted small' }, 'Tip: arm this track and hit record to capture your pad performance as MIDI, then edit it in the piano roll.'));
    }
    side();
  }
  const offs = [on('selection', render), on('load', render)];
  render();
  return () => { offs.forEach((o) => o()); root.remove(); };
}

// ---------------- Keyboard ----------------
const MAP = 'awsedftgyhujkolp;\''.split('');
export const typing = { octave: 4, on: false };
export function typingKey(e, down) {
  if (!typing.on || e.ctrlKey || e.metaKey || e.altKey) return false;
  const k = e.key.toLowerCase();
  if (down && !e.repeat && (k === 'z' || k === 'x')) { typing.octave = clamp(typing.octave + (k === 'z' ? -1 : 1), 0, 8); return true; }
  const i = MAP.indexOf(k); if (i < 0) return false;
  if (e.repeat) return true;
  liveNote(12 * (typing.octave + 1) + i, 100, down);
  return true;
}
export function mountKeyboard(container) {
  const root = h('div', { class: 'kbd' });
  const keys = h('div', { class: 'keys' });
  const label = h('span', { class: 'muted small' });
  const target = h('span', { class: 'muted small' });
  const typeChk = h('input', { type: 'checkbox', checked: typing.on, onchange: (e) => (typing.on = e.target.checked) });
  root.append(h('div', { class: 'kbd-bar' },
    h('button', { class: 'icon-btn', html: icon('minus', 16), onclick: () => { typing.octave = clamp(typing.octave - 1, 0, 7); build(); } }), label,
    h('button', { class: 'icon-btn', html: icon('plus', 16), onclick: () => { typing.octave = clamp(typing.octave + 1, 0, 7); build(); } }),
    h('label', { class: 'chk', title: 'Play notes with your computer keyboard (A–L row = white keys, W E T Y U = black keys, Z/X = octave)' }, typeChk, 'Musical typing'), target,
    h('div', { class: 'spacer' }), h('span', { class: 'muted small' }, 'Tip: arm an instrument track, press record and play.')), keys);
  container.append(root);
  typing.on = true; typeChk.checked = true;
  function build() {
    keys.replaceChildren(); const base = 12 * (typing.octave + 1) - 12 * 0, start = base, n = 3 * 12 + 1;
    label.textContent = `C${typing.octave - 0} – C${typing.octave + 3}`;
    let wx = 0; const avail = Math.max(300, (container.clientWidth || 900) - 24), W = clamp(Math.floor(avail / 22), 24, 48);
    for (let i = 0; i < n; i++) {
      const note = start + i, black = isBlack(note);
      if (!black) { const k = h('div', { class: 'key white', dataset: { note }, style: { left: wx * W + 'px', width: W + 'px' } }, h('span', null, note % 12 === 0 ? noteName(note) : '')); keys.append(k); wx++; }
    }
    wx = 0;
    for (let i = 0; i < n; i++) { const note = start + i; if (isBlack(note)) keys.append(h('div', { class: 'key black', dataset: { note }, style: { left: wx * W - W * 0.3 + 'px', width: W * 0.6 + 'px' } })); else wx++; }
    keys.style.width = wx * W + 'px';
    keys.querySelectorAll('.key').forEach((k) => {
      k.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); const note = +k.dataset.note, vel = Math.round(clamp(55 + (e.offsetY / k.clientHeight) * 72, 30, 127)); k.classList.add('down'); liveNote(note, vel, true); drag(e, () => {}, () => { k.classList.remove('down'); liveNote(note, 0, false); }); });
    });
    const tt = liveTarget(); target.textContent = tt ? '→ ' + tt.name : '→ no instrument track';
  }
  build();
  const offs = [on('liveNote', ({ note, on: down }) => { const k = keys.querySelector(`.key[data-note="${note}"]`); k?.classList.toggle('down', down); }), on('selection', () => { const tt = liveTarget(); target.textContent = tt ? '→ ' + tt.name : '→ no instrument track'; })];
  return () => { typing.on = false; offs.forEach((o) => o()); root.remove(); };
}
