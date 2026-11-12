// Mixer: channel strips with faders, pan, meters, insert list and the master section.
import { h, clamp, dbToGain, drag, on, menuBelow, knob } from '../util.js';
import { icon } from '../icons.js';
import { S, checkpoint, changed, selectTrack, TRACK_KINDS } from '../state.js';
import { engine } from '../audio/engine.js';
import { FX } from '../audio/effects.js';
import { MASTER_PRESETS } from '../audio/effects.js';
import { emit } from '../util.js';

const pFromDb = (db) => (db <= -60 ? 0 : db >= 0 ? 0.75 + (Math.min(db, 6) / 6) * 0.25 : 0.75 * (1 - Math.pow(-db / 60, 1 / 1.6)));
const dbFromP = (p) => (p <= 0.001 ? -60 : p <= 0.75 ? -60 * Math.pow(1 - p / 0.75, 1.6) : ((p - 0.75) / 0.25) * 6);
const fmtDb = (db) => (db <= -59.5 ? '-∞' : (db > 0 ? '+' : '') + db.toFixed(1));
const meterPos = (v) => clamp((20 * Math.log10(Math.max(v, 1e-4)) + 60) / 66, 0, 1);

function fader(getDb, setDb, onStart) {
  const el = h('div', { class: 'fader' });
  const track = h('div', { class: 'fader-track' }), thumb = h('div', { class: 'fader-thumb' });
  const scale = h('div', { class: 'fader-scale' }, [6, 0, -6, -12, -24, -48].map((d) => h('span', { style: { bottom: pFromDb(d) * 100 + '%' } }, d)));
  const meter = h('div', { class: 'fader-meter' }, h('div', { class: 'm-fill' }), h('div', { class: 'm-peak' }));
  el.append(scale, track, meter, thumb);
  const upd = () => { thumb.style.bottom = `calc(${pFromDb(getDb()) * 100}% - 9px)`; };
  const setFromY = (ev) => { const r = track.getBoundingClientRect(); setDb(dbFromP(clamp(1 - (ev.clientY - r.top) / r.height, 0, 1))); upd(); };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); onStart?.(); setFromY(e); drag(e, setFromY); });
  el.addEventListener('dblclick', () => { onStart?.(); setDb(0); upd(); });
  el.addEventListener('wheel', (e) => { e.preventDefault(); setDb(clamp(getDb() - Math.sign(e.deltaY) * 0.5, -60, 6)); upd(); }, { passive: false });
  el.update = upd; el.meter = meter; upd();
  return el;
}

export function mountMixer(container) {
  const root = h('div', { class: 'mixer' });
  const strips = h('div', { class: 'strips' });
  const masterBox = h('div', { class: 'strip master' });
  root.append(strips, masterBox);
  container.append(root);
  const map = new Map();
  let alive = true, raf;

  function makeStrip(t) {
    const cur = () => S.project.tracks.find((x) => x.id === t.id);
    const el = h('div', { class: 'strip' });
    const ins = h('div', { class: 'ins' });
    const name = h('div', { class: 'st-name' });
    const volLab = h('div', { class: 'st-db' });
    let panKnob = null;
    const panBox = h('div', { class: 'st-pan' });
    const f = fader(() => cur().vol, (db) => { const t2 = cur(); t2.vol = db; volLab.textContent = fmtDb(db) + ' dB'; changed(); }, () => checkpoint());
    const bm = h('button', { class: 'tb mute', onclick: () => { checkpoint(); const x = cur(); x.mute = !x.mute; changed(); } }, 'M');
    const bs = h('button', { class: 'tb solo', onclick: () => { checkpoint(); const x = cur(); x.solo = !x.solo; changed(); } }, 'S');
    const ba = h('button', { class: 'tb arm', html: icon('rec', 12), onclick: () => { checkpoint(); const x = cur(); x.arm = !x.arm; changed(); } });
    el.addEventListener('pointerdown', () => selectTrack(t.id));
    el.append(h('div', { class: 'st-color' }), ins, panBox, h('div', { class: 'st-btns' }, bm, bs, ba), f, volLab, name);
    return {
      el, f, ins, name, volLab, bm, bs, ba, panBox,
      update(t) {
        el.querySelector('.st-color').style.background = t.color; name.textContent = t.name; name.title = t.name;
        el.classList.toggle('selected', S.sel.track === t.id); bm.classList.toggle('on', t.mute); bs.classList.toggle('on', t.solo); ba.classList.toggle('on', t.arm);
        volLab.textContent = fmtDb(t.vol) + ' dB'; f.update();
        // inserts
        ins.replaceChildren(...t.fx.slice(0, 4).map((fx) => h('button', { class: 'ins-slot' + (fx.bypass ? ' off' : ''), title: FX[fx.type].name, onclick: () => { selectTrack(t.id); S.ui.sideOpen = true; S.ui.sideTab = 'fx'; emit('layout'); } }, FX[fx.type].name)), h('button', { class: 'ins-slot add', onclick: () => { selectTrack(t.id); S.ui.sideOpen = true; S.ui.sideTab = 'fx'; emit('layout'); } }, '+ FX'));
        if (!panKnob) { panKnob = knob({ value: t.pan, min: -1, max: 1, def: 0, label: 'Pan', size: 34, fmt: (v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? 'L' + Math.round(-v * 100) : 'R' + Math.round(v * 100)), onChange: (v) => { const x = cur(); if (!panKnob._cp) { checkpoint(); panKnob._cp = true; setTimeout(() => (panKnob._cp = false), 600); } x.pan = v; changed(); } }); panBox.append(panKnob); } else panKnob.set(t.pan);
      },
    };
  }
  const mdb = () => S.project.master.vol;
  const mf = fader(mdb, (db) => { S.project.master.vol = db; mvol.textContent = fmtDb(db) + ' dB'; changed(); }, () => checkpoint());
  const mvol = h('div', { class: 'st-db' });
  const mf2 = h('div', { class: 'fader-meter m2' }, h('div', { class: 'm-fill' }), h('div', { class: 'm-peak' }));
  const mpreset = h('button', { class: 'btn small master-preset', title: 'Mastering preset', onclick: (e) => menuBelow(e.currentTarget, Object.keys(MASTER_PRESETS).map((n) => ({ label: n, checked: S.project.master.mastering === n, action: () => { checkpoint(); S.project.master.mastering = n; changed(); } }))) });
  masterBox.append(h('div', { class: 'st-color', style: { background: 'var(--accent)' } }), h('div', { class: 'ins' }, h('div', { class: 'muted tiny' }, 'Mastering'), mpreset), h('div', { class: 'st-pan' }), h('div', { class: 'st-btns' }), mf, mvol, h('div', { class: 'st-name' }, 'Master'));
  mf.appendChild(mf2); mf2.style.right = '2px';

  function sync() {
    const ids = new Set(S.project.tracks.map((t) => t.id));
    for (const [id, s] of map) if (!ids.has(id)) { s.el.remove(); map.delete(id); }
    S.project.tracks.forEach((t, i) => {
      let s = map.get(t.id); if (!s) { s = makeStrip(t); map.set(t.id, s); }
      if (strips.children[i] !== s.el) strips.insertBefore(s.el, strips.children[i] || null);
      s.update(t);
    });
    mpreset.textContent = S.project.master.mastering === 'Off' ? 'Off' : S.project.master.mastering; mpreset.classList.toggle('on', S.project.master.mastering !== 'Off');
    mvol.textContent = fmtDb(mdb()) + ' dB'; mf.update();
  }
  const offs = [on('project', sync), on('selection', sync)];
  sync();
  const peaks = new Map();
  function loop() {
    if (!alive) return; raf = requestAnimationFrame(loop);
    for (const [id, s] of map) {
      const v = engine.playing || engine.live.size ? engine.trackLevel(id) : 0, p = peaks.get(id) || { v: 0, pk: 0, t: 0 };
      p.v = Math.max(v, p.v * 0.88); if (v > p.pk) { p.pk = v; p.t = performance.now(); } else if (performance.now() - p.t > 900) p.pk *= 0.93;
      peaks.set(id, p);
      s.f.meter.firstChild.style.height = meterPos(p.v) * 100 + '%'; s.f.meter.lastChild.style.bottom = meterPos(p.pk) * 100 + '%';
    }
    const [l, r] = engine.playing || engine.live.size ? engine.masterLevels() : [0, 0], pm = peaks.get('m') || { v: 0, pk: 0, t: 0 }, v = Math.max(l, r);
    pm.v = Math.max(v, pm.v * 0.88); if (v > pm.pk) { pm.pk = v; pm.t = performance.now(); } else if (performance.now() - pm.t > 900) pm.pk *= 0.93; peaks.set('m', pm);
    mf.meter.firstChild.style.height = meterPos(pm.v) * 100 + '%'; mf.meter.lastChild.style.bottom = meterPos(pm.pk) * 100 + '%';
    mf2.firstChild.style.height = meterPos(Math.max(l, r) * 0.98) * 100 + '%'; mf2.lastChild.style.bottom = meterPos(pm.pk) * 100 + '%';
  }
  loop();
  return () => { alive = false; cancelAnimationFrame(raf); offs.forEach((o) => o()); root.remove(); };
}
