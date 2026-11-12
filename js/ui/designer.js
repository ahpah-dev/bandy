// Instrument designer: custom synth and sample instruments with a live keyboard preview, plus import / export.
import { h, modal, knob, toast, confirmDialog, download, uid, noteName, isBlack } from '../util.js';
import { icon } from '../icons.js';
import { S, checkpoint, changed, getLibrary, saveLibrary } from '../state.js';
import { engine } from '../audio/engine.js';
import { INSTRUMENTS, OSC_TYPES, FILTER_TYPES, NOISE_TYPES, sanitizeInstrument, getInstrument, getCustomInstrument, listCustomInstruments, startVoice } from '../audio/synth.js';
import { encodeWav } from '../audio/dsp.js';

export const MY_CAT = 'My instruments';
const KEY_LO = 48, KEY_HI = 72; // preview keyboard: C3 to C5
const NOISE_LABEL = { bp: 'Bandpass', hp: 'Highpass', lp: 'Lowpass' };
const secFmt = (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
const hzFmt = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);

// Flat, form-friendly copy of a definition. modelOf() and defOf() convert between the two.
function modelOf(d) {
  const isSample = d.type === 'sample', osc = [0, 1, 2, 3].map((i) => {
    const ly = Array.isArray(d.osc) ? d.osc[i] : null;
    return ly ? { on: true, type: ly[0], detune: ly[1], gain: ly[2], oct: ly[3] } : { on: false, type: 'sine', detune: 0, gain: 0.5, oct: 0 };
  });
  const e = Array.isArray(d.env) ? d.env : [], f = d.filter, fm = d.fm, an = d.attackNoise, u = d.unison;
  return {
    type: isSample ? 'sample' : 'synth', name: d.name || '', cat: d.cat || MY_CAT, osc,
    env: { a: e[0] ?? 0.01, d: e[1] ?? 0.3, s: e[2] ?? 0.8, r: e[3] ?? 0.3 },
    gain: !isSample && d.gain != null ? d.gain : 0.8,
    filter: { on: !!f, type: f?.type ?? 'lowpass', freq: f?.freq ?? 2000, q: f?.q ?? 0.7, track: f?.track ?? 0, amt: f?.amt ?? 0, decay: f?.decay ?? 0.2 },
    vib: { rate: d.vib?.[0] ?? 5, depth: d.vib?.[1] ?? 0 },
    trem: { rate: d.trem?.[0] ?? 5, depth: d.trem?.[1] ?? 0 },
    lfo: { rate: d.lfoFilter?.[0] ?? 2, depth: d.lfoFilter?.[1] ?? 0 },
    drive: d.drive ?? 0, glide: d.glide ?? 0,
    fm: { on: !!fm, ratio: fm?.ratio ?? 1, index: fm?.index ?? 1, decay: fm?.decay ?? 0.5, end: fm?.end ?? 0.1 },
    noise: { gain: an?.gain ?? 0, decay: an?.decay ?? 0.03, type: an?.type ?? 'bp', freq: an?.freq ?? 2000, q: an?.q ?? 1 },
    unison: { voices: u?.voices ?? 1, spread: u?.spread ?? 8, type: u?.type ?? null },
    keep: { pitchEnv: d.pitchEnv ?? null, breath: d.breath ?? 0 },
    sample: {
      bufferId: d.bufferId ?? null, sampleName: '', rootNote: d.rootNote ?? 60, attack: d.attack ?? 0.005, release: d.release ?? 0.3,
      gain: isSample && d.gain != null ? d.gain : 1, loop: d.loopEnd != null, loopStart: d.loopStart ?? 0, loopEnd: d.loopEnd ?? 1,
    },
  };
}
function defOf(m) {
  if (m.type === 'sample') {
    const s = m.sample, def = { type: 'sample', name: m.name, cat: m.cat, bufferId: s.bufferId, rootNote: s.rootNote, attack: s.attack, release: s.release, gain: s.gain };
    if (s.loop) { def.loopStart = s.loopStart; def.loopEnd = s.loopEnd; }
    return def;
  }
  const def = { type: 'synth', name: m.name, cat: m.cat, osc: m.osc.filter((o) => o.on).map((o) => [o.type, o.detune, o.gain, o.oct]), env: [m.env.a, m.env.d, m.env.s, m.env.r], gain: m.gain };
  if (m.filter.on) def.filter = { type: m.filter.type, freq: m.filter.freq, q: m.filter.q, track: m.filter.track, amt: m.filter.amt, decay: m.filter.decay };
  if (m.vib.depth > 0) def.vib = [m.vib.rate, m.vib.depth];
  if (m.trem.depth > 0) def.trem = [m.trem.rate, m.trem.depth];
  if (m.lfo.depth > 0) def.lfoFilter = [m.lfo.rate, m.lfo.depth];
  if (m.drive > 0) def.drive = m.drive;
  if (m.glide > 0) def.glide = m.glide;
  if (m.fm.on) def.fm = { ratio: m.fm.ratio, index: m.fm.index, decay: m.fm.decay, end: m.fm.end };
  if (m.noise.gain > 0) def.attackNoise = { gain: m.noise.gain, decay: m.noise.decay, type: m.noise.type, freq: m.noise.freq, q: m.noise.q };
  if (m.unison.voices > 1) def.unison = { voices: m.unison.voices, spread: m.unison.spread, ...(m.unison.type ? { type: m.unison.type } : {}) };
  if (m.keep.pitchEnv) def.pitchEnv = m.keep.pitchEnv;
  if (m.keep.breath > 0) def.breath = m.keep.breath;
  return def;
}

const sec = (title, ...kids) => h('section', { class: 'id-sec' }, h('h4', null, title), ...kids);
const grid = (...kids) => h('div', { class: 'id-grid' }, ...kids);

export function openInstrumentDesigner(baseId = null) {
  const editing = baseId ? getCustomInstrument(baseId) : null;
  const editingId = editing ? editing.id : null;
  const base = editing || getInstrument(baseId || 'saw');
  let startId = base.id;
  const m = modelOf(base);
  m.name = editing ? editing.name : baseId ? `${base.name} (custom)` : 'My sound';
  m.cat = editing ? editing.cat : MY_CAT;

  // ---- preview voices ----
  const held = new Map(), down = new Set();
  let previewTimer = null;
  const stopVoice = (note) => { const v = held.get(note); if (v) { v.release(engine.ctx.currentTime); held.delete(note); } };
  const noteOff = (note) => { down.delete(note); stopVoice(note); };
  const current = () => sanitizeInstrument({ ...defOf(m), id: 'u_preview' });
  async function noteOn(note) {
    down.add(note);
    await engine.init();
    if (!down.has(note)) return;
    stopVoice(note);
    const def = current(), buf = def.type === 'sample' ? S.buffers.get(def.bufferId) || null : null;
    if (def.type === 'sample' && !buf) { down.delete(note); toast('Load an audio file for this sample first', 'warn'); return; }
    const ctx = engine.ctx;
    held.set(note, startVoice(ctx, engine.graph.masterIn, def, ctx.currentTime + 0.005, note, 110, buf));
  }
  const playNote = (note, ms) => { noteOn(note); setTimeout(() => noteOff(note), ms); };
  const previewNote = () => (m.cat === 'Bass' ? 36 : 60);
  // Every control change replays a short note, so tweaks are audible at once.
  const touch = () => {
    if (m.type === 'sample' && !m.sample.bufferId) return;
    clearTimeout(previewTimer); previewTimer = setTimeout(() => playNote(previewNote(), 550), 90);
  };

  // ---- control helpers (all write straight into the model) ----
  const kn = (o, key, label, min, max, { def, log = false, step = 0, fmt, unit = '' } = {}) => knob({
    value: o[key], min, max, def: def ?? o[key], label, log, step, fmt, unit, size: 40, onChange: (v) => { o[key] = v; touch(); },
  });
  const sel = (o, key, opts) => h('select', { class: 'select', onchange: (e) => { o[key] = e.target.value; touch(); } }, opts.map(([v, l]) => h('option', { value: v, selected: o[key] === v }, l)));
  const check = (label, checked, onc) => h('label', { class: 'id-check' }, h('input', { type: 'checkbox', checked, onchange: (e) => { onc(e.target.checked); touch(); } }), h('span', null, label));

  function oscRow(o, i) {
    const row = h('div', { class: 'id-osc' + (o.on ? '' : ' off') });
    const cb = h('input', { type: 'checkbox', checked: o.on, onchange: (e) => {
      if (!e.target.checked && m.osc.every((x) => x === o || !x.on)) { e.target.checked = true; toast('Keep at least one layer on'); return; }
      o.on = e.target.checked; row.classList.toggle('off', !o.on); touch();
    } });
    row.append(h('label', { class: 'id-check' }, cb, h('span', null, `Layer ${i + 1}`)), sel(o, 'type', OSC_TYPES.map((t) => [t, t])),
      kn(o, 'detune', 'Detune', -100, 100, { def: 0, unit: ' ct' }), kn(o, 'gain', 'Gain', 0, 1, { def: 0.5 }), kn(o, 'oct', 'Octave', -2, 2, { def: 0 }));
    return row;
  }

  function synthPanel() {
    return h('div', null,
      sec('Oscillator layers (up to 4)', h('div', { class: 'id-oscs' }, m.osc.map(oscRow))),
      sec('Amplitude',
        grid(kn(m.env, 'a', 'Attack', 0.001, 8, { def: 0.01, log: true, fmt: secFmt }), kn(m.env, 'd', 'Decay', 0.001, 8, { def: 0.3, log: true, fmt: secFmt }),
          kn(m.env, 's', 'Sustain', 0, 1, { def: 0.8 }), kn(m.env, 'r', 'Release', 0.001, 8, { def: 0.3, log: true, fmt: secFmt }),
          kn(m, 'gain', 'Level', 0, 1.5, { def: 0.8 }))),
      sec('Filter', h('div', { class: 'id-row' }, check('On', m.filter.on, (v) => { m.filter.on = v; }), sel(m.filter, 'type', FILTER_TYPES.map((t) => [t, t]))),
        grid(kn(m.filter, 'freq', 'Cutoff', 40, 18000, { def: 2000, log: true, fmt: hzFmt }), kn(m.filter, 'q', 'Resonance', 0.1, 20, { def: 0.7, log: true }),
          kn(m.filter, 'track', 'Key track', 0, 2, { def: 0 }), kn(m.filter, 'amt', 'Env amount', 0, 12000, { def: 0, fmt: hzFmt }),
          kn(m.filter, 'decay', 'Env decay', 0.01, 8, { def: 0.2, log: true, fmt: secFmt }))),
      sec('Modulation',
        grid(kn(m.vib, 'rate', 'Vibrato rate', 0, 12, { def: 5, unit: ' Hz' }), kn(m.vib, 'depth', 'Vibrato depth', 0, 60, { def: 0, unit: ' ct' }),
          kn(m.trem, 'rate', 'Tremolo rate', 0, 12, { def: 5, unit: ' Hz' }), kn(m.trem, 'depth', 'Tremolo depth', 0, 1, { def: 0 }),
          kn(m.lfo, 'rate', 'Filter LFO', 0, 12, { def: 2, unit: ' Hz' }), kn(m.lfo, 'depth', 'LFO depth', 0, 4000, { def: 0, fmt: hzFmt }))),
      sec('Character', grid(kn(m, 'drive', 'Drive', 0, 4, { def: 0 }), kn(m, 'glide', 'Glide', 0, 1, { def: 0, fmt: secFmt }))),
      sec('FM', h('div', { class: 'id-row' }, check('On', m.fm.on, (v) => { m.fm.on = v; })),
        grid(kn(m.fm, 'ratio', 'Ratio', 0.5, 16, { def: 1 }), kn(m.fm, 'index', 'Index', 0, 8, { def: 1 }),
          kn(m.fm, 'decay', 'Decay', 0.01, 8, { def: 0.5, log: true, fmt: secFmt }), kn(m.fm, 'end', 'End', 0, 1, { def: 0.1 }))),
      sec('Attack noise',
        grid(kn(m.noise, 'gain', 'Level', 0, 1.5, { def: 0 }), kn(m.noise, 'decay', 'Decay', 0.001, 3, { def: 0.03, log: true, fmt: secFmt }),
          sel(m.noise, 'type', NOISE_TYPES.map((t) => [t, NOISE_LABEL[t]])), kn(m.noise, 'freq', 'Frequency', 40, 18000, { def: 2000, log: true, fmt: hzFmt }))),
      sec('Unison', grid(kn(m.unison, 'voices', 'Voices', 1, 5, { def: 1, step: 1 }), kn(m.unison, 'spread', 'Spread', 0, 50, { def: 8, unit: ' ct' }))),
    );
  }

  async function loadSample(f) {
    try {
      await engine.init();
      const buf = await engine.ctx.decodeAudioData(await f.arrayBuffer());
      const bid = uid('b'); S.buffers.set(bid, buf);
      m.sample.bufferId = bid; m.sample.sampleName = f.name.replace(/\.[^.]+$/, ''); m.sample.loopEnd = buf.duration;
      if (!m.name.trim() || m.name === 'My sound') { m.name = m.sample.sampleName; nameIn.value = m.name; }
      build(); touch();
    } catch (e) { toast(`Couldn't decode ${f.name}`, 'error'); }
  }

  function samplePanel() {
    const s = m.sample, buf = s.bufferId ? S.buffers.get(s.bufferId) : null;
    const fileIn = h('input', { type: 'file', accept: 'audio/*', hidden: true, onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) loadSample(f); } });
    const numIn = (key) => h('input', { type: 'number', class: 'num-input', min: 0, step: 0.01, value: s[key].toFixed(2), disabled: !s.loop, onchange: (e) => { s[key] = Math.max(0, +e.target.value || 0); touch(); } });
    return h('div', null,
      sec('Sample', h('div', { class: 'id-row' },
        h('button', { class: 'btn small', html: icon('upload', 14) + ' Load audio file…', onclick: () => fileIn.click() }),
        h('span', { class: 'muted small' }, buf ? `${s.sampleName || 'Audio'} · ${buf.duration.toFixed(2)} s` : 'No audio loaded yet'), fileIn)),
      sec('Playback', grid(kn(s, 'rootNote', 'Root note', 0, 127, { def: 60, step: 1, fmt: (v) => noteName(Math.round(v)) }),
        kn(s, 'attack', 'Attack', 0.001, 8, { def: 0.005, log: true, fmt: secFmt }), kn(s, 'release', 'Release', 0.001, 8, { def: 0.3, log: true, fmt: secFmt }),
        kn(s, 'gain', 'Level', 0, 1.5, { def: 1 }))),
      sec('Loop', h('div', { class: 'id-row' },
        check('Loop', s.loop, (v) => { s.loop = v; if (v && buf && s.loopEnd <= s.loopStart) s.loopEnd = buf.duration; build(); }),
        h('label', { class: 'id-num' }, h('span', null, 'Start (s)'), numIn('loopStart')),
        h('label', { class: 'id-num' }, h('span', null, 'End (s)'), numIn('loopEnd'))),
        h('p', { class: 'muted small' }, 'Without a loop the sample plays once and fades on release.')));
  }

  // ---- layout ----
  const nameIn = h('input', { class: 'text-input', value: m.name, placeholder: 'Instrument name', oninput: (e) => { m.name = e.target.value; } });
  const cats = [...new Set([MY_CAT, ...INSTRUMENTS.map((i) => i.cat), ...listCustomInstruments().map((d) => d.cat)])];
  if (!cats.includes(m.cat)) cats.push(m.cat);
  const catSel = h('select', { class: 'select', onchange: (e) => { m.cat = e.target.value; } }, cats.map((c) => h('option', { value: c, selected: c === m.cat }, c)));
  const startOpts = [...INSTRUMENTS.map((i) => [i.id, i.name]), ...listCustomInstruments().map((d) => [d.id, `${d.name} (mine)`])];
  const baseSel = h('select', { class: 'select id-base', title: 'Copy the settings of another sound', onchange: (e) => {
    startId = e.target.value; const b = getInstrument(startId), keepName = m.name, keepCat = m.cat;
    Object.assign(m, modelOf(b)); m.name = keepName; m.cat = keepCat; nameIn.value = keepName; build(); touch();
  } }, startOpts.map(([v, l]) => h('option', { value: v, selected: v === startId }, l)));
  const modeBtns = [['synth', 'Synth'], ['sample', 'Sample']].map(([v, l]) => h('button', { class: 'chip', dataset: { mode: v }, onclick: () => { m.type = v; build(); touch(); } }, l));
  const keys = keyboardEl();
  const panel = h('div', { class: 'id-panel' });
  function build() {
    for (const b of modeBtns) b.classList.toggle('on', b.dataset.mode === m.type);
    panel.replaceChildren(m.type === 'sample' ? samplePanel() : synthPanel());
  }
  function keyboardEl() {
    const whites = [], blacks = [];
    for (let n = KEY_LO; n <= KEY_HI; n++) (isBlack(n) ? blacks : whites).push(n);
    const W = 100 / whites.length, wrap = h('div', { class: 'id-keys' });
    const key = (n, cls, style) => h('div', { class: 'id-key ' + cls, style, title: noteName(n),
      onpointerdown: (e) => { e.preventDefault(); e.currentTarget.classList.add('down'); noteOn(n); },
      onpointerup: (e) => { e.currentTarget.classList.remove('down'); noteOff(n); },
      onpointerleave: (e) => { e.currentTarget.classList.remove('down'); noteOff(n); },
      onpointercancel: (e) => { e.currentTarget.classList.remove('down'); noteOff(n); } }, cls === 'white' && n % 12 === 0 ? h('span', null, noteName(n)) : null);
    whites.forEach((n, i) => wrap.append(key(n, 'white', { left: i * W + '%', width: W + '%' })));
    for (const n of blacks) wrap.append(key(n, 'black', { left: (whites.indexOf(n - 1) + 1) * W - W * 0.3 + '%', width: W * 0.6 + '%' }));
    return wrap;
  }
  const playBtn = h('button', { class: 'btn small', html: icon('play', 14) + ' Play', title: 'Play a note', onclick: () => playNote(previewNote(), 900) });

  // Credentials stay in this open designer only; generated settings are applied only after validation.
  const aiPrompt = h('textarea', { class: 'text-input ai-prompt', placeholder: 'Describe a sound, e.g. a warm, slow analog pad', rows: 2, maxlength: 2000 });
  const aiKey = h('input', { class: 'text-input', type: 'password', autocomplete: 'off', placeholder: 'OpenAI API key' });
  const aiModel = h('input', { class: 'text-input', value: 'gpt-4.1-mini', placeholder: 'Model ID' });
  const aiProvider = h('select', { class: 'select', onchange: (e) => {
    const kilo = e.target.value === 'kilo';
    aiModel.value = kilo ? 'cohere/north-mini-code:free' : 'gpt-4.1-mini';
    aiKey.value = ''; aiKey.placeholder = kilo ? 'Kilo Gateway API key' : 'OpenAI API key';
  } }, h('option', { value: 'openai', selected: true }, 'Bring your own key (OpenAI)'), h('option', { value: 'kilo' }, 'Kilo Gateway'));
  const aiStatus = h('p', { class: 'muted small', role: 'status' });
  let aiAbort = null;
  const generate = h('button', { class: 'btn small', onclick: async () => {
    const prompt = aiPrompt.value.trim(), model = aiModel.value.trim();
    if (!prompt || !model || !aiKey.value.trim()) { aiStatus.textContent = 'Enter a sound description, model ID and API key.'; return; }
    generate.disabled = true; aiStatus.textContent = 'Generating instrument…'; aiAbort = new AbortController();
    try {
      const response = await fetch('http://127.0.0.1:5175/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: aiAbort.signal, body: JSON.stringify({ provider: aiProvider.value, key: aiKey.value.trim(), model, messages: [
        { role: 'system', content: 'Design a playable synthesizer preset. Return only a JSON object, no markdown. Schema: {"name":string,"type":"synth","osc":[[wave,detuneCents,gain,octave]],"env":[attackSeconds,decaySeconds,sustain,releaseSeconds],"gain":number,"filter":{"type":"lowpass|highpass|bandpass|notch","freq":Hz,"q":number,"track":number,"amt":Hz,"decay":seconds},"vib":[rateHz,depthCents],"trem":[rateHz,depth],"drive":number,"glide":seconds,"fm":{"ratio":number,"index":number,"decay":seconds,"end":number},"unison":{"voices":1-5,"spread":cents}}. Oscillator waves: sine, square, sawtooth, triangle. Use 1-4 oscillators, gains 0-1, octave -2 to 2, envelope times 0.001-8, sustain 0-1. Optional effects may be omitted. Never return sample instruments.' },
        { role: 'user', content: prompt },
      ] }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || result.error || `Request failed (${response.status}).`);
      let content = result.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('The model did not return an instrument. Try another model.');
      content = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const raw = JSON.parse(content);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.type === 'sample' || !Array.isArray(raw.osc) || !raw.osc.length) throw new Error('The model returned an invalid synth. Try again.');
      const def = sanitizeInstrument({ ...raw, type: 'synth', cat: MY_CAT });
      Object.assign(m, modelOf(def)); nameIn.value = m.name; catSel.value = MY_CAT; build(); touch();
      aiStatus.textContent = 'Generated! Preview and adjust the sound, then save it.';
    } catch (e) {
      if (e.name !== 'AbortError') aiStatus.textContent = e instanceof SyntaxError ? 'The model returned invalid JSON. Try again or choose another model.' : (e.message === 'Failed to fetch' ? 'Could not reach the local AI bridge. Start it using the instructions below.' : e.message);
    } finally { aiAbort = null; generate.disabled = false; }
  } }, 'Generate instrument');
  const aiPanel = h('details', { class: 'id-sec ai-assist' }, h('summary', null, 'AI Assist'),
    h('p', { class: 'muted small' }, 'Describe a synth sound. Your prompt is sent to the selected provider; usage may incur charges.'),
    aiPrompt, h('label', { class: 'id-field' }, h('span', null, 'Provider'), aiProvider), h('label', { class: 'id-field' }, h('span', null, 'Model ID'), aiModel),
    h('label', { class: 'id-field' }, h('span', null, 'API key'), aiKey),
    h('p', { class: 'muted small' }, 'For Kilo, ', h('a', { href: 'https://app.kilo.ai/', target: '_blank', rel: 'noopener noreferrer' }, 'sign in to Kilo'), ' and copy your Gateway API key from your profile. Configure provider keys or subscriptions in Kilo BYOK. Your key stays in this open designer and is not saved.'),
    h('p', { class: 'muted small' }, 'Start the local bridge with ', h('code', null, 'python tools/ai_bridge.py'), ' and keep it running. See the README for setup.'), generate, aiStatus);

  // ---- save / delete / export ----
  function saveDesign(close, asCopy = false) {
    const id = asCopy || !editingId ? uid('u_') : editingId;
    const def = sanitizeInstrument({ ...defOf(m), id });
    if (def.type === 'sample' && !S.buffers.get(def.bufferId)) { toast('Load an audio file for this sample instrument first', 'warn'); return false; }
    checkpoint();
    if (def.type === 'sample') { forgetId(id); S.project.customInstruments = { ...(S.project.customInstruments || {}), [id]: def }; }
    else { forgetId(id); saveLibrary([...getLibrary(), def]); }
    changed(true);
    toast(`Saved “${def.name}”`);
    close();
    return false;
  }
  const exportDesign = () => { exportInstrument(sanitizeInstrument({ ...defOf(m), id: editingId || uid('u_') })); return false; };

  const actions = [];
  if (editingId) actions.push({ label: 'Delete', action: (close) => { deleteCustomInstrument(editingId, close); return false; } });
  actions.push({ label: 'Export JSON', action: exportDesign });
  if (editingId) actions.push({ label: 'Save as copy', action: (close) => saveDesign(close, true) });
  actions.push({ label: 'Cancel' });
  actions.push({ label: 'Save', primary: true, action: (close) => saveDesign(close) });

  const body = h('div', { class: 'designer' },
    h('div', { class: 'id-head' },
      h('label', { class: 'id-field grow' }, h('span', null, 'Name'), nameIn),
      h('label', { class: 'id-field' }, h('span', null, 'Category'), catSel),
      h('label', { class: 'id-field' }, h('span', null, 'Start from'), baseSel)),
    h('div', { class: 'id-modes' }, modeBtns),
    aiPanel,
    panel,
    h('div', { class: 'id-preview' },
      h('div', { class: 'id-prev-h' }, h('span', { class: 'id-prev-t' }, 'Preview'), h('span', { class: 'muted small' }, 'Hold a key to play. Each change is heard on the next note.'), h('span', { class: 'spacer' }), playBtn),
      keys));
  build();
  modal(editingId ? 'Edit instrument' : 'New instrument', body, {
    width: 760, cls: 'designer-modal', actions,
    onClose: () => { aiAbort?.abort(); aiKey.value = ''; for (const n of [...held.keys()]) stopVoice(n); down.clear(); clearTimeout(previewTimer); },
  });
}

// Removes a custom instrument (library or project), reassigning tracks that used it to Grand Piano.
export function deleteCustomInstrument(id, onDone) {
  const d = getCustomInstrument(id);
  if (!d) return;
  confirmDialog('Delete instrument?', `“${d.name}” will be deleted ${d.type === 'sample' ? 'from this project' : 'from your library'}. Tracks that use it will switch to Grand Piano.`, 'Delete').then((ok) => {
    if (!ok) return;
    checkpoint();
    forgetId(id);
    for (const t of S.project.tracks) if (t.inst === id) t.inst = 'grand';
    changed(true);
    onDone?.();
    toast(`Deleted “${d.name}”`);
  });
}
// Keeps an id in one place: a synth sound lives in the library, a sample lives in the project.
function forgetId(id) {
  if (S.project.customInstruments?.[id]) { const c = { ...S.project.customInstruments }; delete c[id]; S.project.customInstruments = c; }
  saveLibrary(getLibrary().filter((d) => d.id !== id));
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToArrayBuffer(b64) {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

// Downloads a definition as JSON. Sample instruments carry their audio (WAV, base64) so the file plays anywhere.
export async function exportInstrument(def) {
  const out = { ...def, format: 'bandy-instrument', version: 1 };
  if (def.type === 'sample') {
    const buf = S.buffers.get(def.bufferId);
    if (!buf) { toast('Load an audio file first', 'warn'); return; }
    out.audio = await blobToBase64(encodeWav(buf, 16));
  }
  const name = (def.name || 'instrument').replace(/[\\/:*?"<>|]/g, '_');
  download(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), name + '.bandy-instrument.json');
}

// Imports one definition or an array of them. Each gets a fresh id; sample audio is decoded into the project.
export async function importInstrumentFile(file) {
  if (!file) return 0;
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast("That file isn't a valid instrument", 'error'); return 0; }
  const list = (Array.isArray(data) ? data : [data]).filter((d) => d && typeof d === 'object' && !Array.isArray(d)).slice(0, 50);
  if (!list.length) { toast('No instruments found in that file', 'warn'); return 0; }
  checkpoint();
  const lib = getLibrary().slice(), projMap = { ...(S.project.customInstruments || {}) };
  let n = 0, failed = 0;
  for (const raw of list) {
    try {
      const id = uid('u_');
      if (raw.type === 'sample') {
        if (typeof raw.audio !== 'string') throw new Error('no audio');
        await engine.init();
        const buf = await engine.ctx.decodeAudioData(base64ToArrayBuffer(raw.audio));
        const bufferId = uid('b'); S.buffers.set(bufferId, buf);
        projMap[id] = sanitizeInstrument({ ...raw, id, bufferId });
      } else {
        const def = sanitizeInstrument({ ...raw, id });
        if (!def) throw new Error('invalid');
        lib.push(def);
      }
      n++;
    } catch (e) { failed++; console.warn('instrument import skipped', e); }
  }
  saveLibrary(lib);
  S.project.customInstruments = projMap;
  changed(true);
  toast(`Imported ${n} instrument${n === 1 ? '' : 's'}${failed ? ` (${failed} skipped)` : ''}`, n ? '' : 'error');
  return n;
}
