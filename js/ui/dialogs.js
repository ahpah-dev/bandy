// Settings, shortcuts, tuner, about and project templates.
import { h, modal, toast, clamp, NOTE_NAMES, freqToMidi, midiToFreq, emit } from '../util.js';
import { icon, LOGO } from '../icons.js';
import { S, settings, saveSettings } from '../state.js';
import { engine } from '../audio/engine.js';
import { ensureMic, getMicSource, listInputs, initMidi, midiInputNames } from '../audio/record.js';
import { detectPitch } from '../audio/pitch.js';
import { newProjectAction, openProjectDialog } from './actions.js';

export const REPO_URL = 'https://github.com/ahpah-dev/bandy';

export function applyTheme() { document.documentElement.dataset.theme = settings.theme; }

export async function openSettings() {
  const inputs = await listInputs();
  const row = (label, el, hint) => h('label', { class: 'set-row' }, h('div', null, h('div', null, label), hint ? h('div', { class: 'muted small' }, hint) : null), el);
  const sel = h('select', { class: 'select', onchange: (e) => { settings.inputDeviceId = e.target.value; saveSettings(); } },
    h('option', { value: '' }, 'System default'), inputs.map((d, i) => h('option', { value: d.deviceId, selected: d.deviceId === settings.inputDeviceId }, d.label || 'Input ' + (i + 1))));
  const allow = h('button', { class: 'btn', onclick: async () => { try { await ensureMic(); toast('Microphone enabled'); m.close(); openSettings(); } catch (e) { toast('Microphone blocked: ' + e.message, 'error'); } } }, 'Allow microphone');
  const chk = (key, onch) => h('input', { type: 'checkbox', checked: !!settings[key], onchange: (e) => { settings[key] = e.target.checked; saveSettings(); onch?.(); } });
  const midi = h('div', { class: 'muted small' }, 'Looking for MIDI devices…');
  initMidi().then(() => { const n = midiInputNames(); midi.textContent = n.length ? 'Connected: ' + n.join(', ') : navigator.requestMIDIAccess ? 'No MIDI keyboards detected.' : 'Web MIDI is not supported in this browser.'; });
  const body = h('div', { class: 'settings' },
    h('h3', null, 'Audio'),
    row('Input device', h('div', { class: 'row gap' }, sel, inputs.some((d) => d.label) ? null : allow)),
    row('Latency compensation', h('div', { class: 'row gap' }, h('input', { class: 'num-input', type: 'number', min: 0, max: 500, step: 1, value: settings.latencyMs, onchange: (e) => { settings.latencyMs = clamp(+e.target.value || 0, 0, 500); saveSettings(); } }), h('span', { class: 'muted' }, 'ms')), '0 = automatic estimate. Increase if recordings sound late.'),
    row('Monitor input while recording', chk('monitor'), 'Use headphones to avoid feedback.'),
    row('Metronome volume', h('input', { type: 'range', class: 'slider', min: 0, max: 1, step: 0.01, value: settings.metroVol, oninput: (e) => { settings.metroVol = +e.target.value; saveSettings(); } })),
    row('Count-in before recording', chk('countIn')),
    h('h3', null, 'Interface'),
    row('Theme', h('select', { class: 'select', onchange: (e) => { settings.theme = e.target.value; saveSettings(); applyTheme(); } }, ['dark', 'light'].map((t) => h('option', { value: t, selected: settings.theme === t }, t[0].toUpperCase() + t.slice(1))))),
    row('Follow playhead', chk('follow')),
    row('Auto-save projects', chk('autoSave'), 'Projects are stored in this browser (IndexedDB).'),
    h('h3', null, 'MIDI'), midi);
  const m = modal('Settings', body, { width: 560, actions: [{ label: 'Done', primary: true }] });
}

export function openShortcuts() {
  const rows = [
    ['Playback', [['Space', 'Play / pause'], ['Home', 'Return to start'], ['R', 'Record'], ['L', 'Toggle loop'], ['K', 'Toggle metronome'], ['← / →', 'Move playhead by a bar']]],
    ['Editing', [['Ctrl Z / Ctrl Shift Z', 'Undo / redo'], ['Ctrl C / X / V', 'Copy / cut / paste regions'], ['Ctrl D', 'Duplicate regions'], ['S', 'Split at playhead'], ['Delete', 'Delete selection'], ['Ctrl A', 'Select all regions'], ['Enter', 'Open editor for region'], ['Alt + drag', 'Duplicate while dragging']]],
    ['Tracks', [['T', 'Add track'], ['M', 'Mute selected track'], ['Shift S', 'Solo selected track'], ['A', 'Arm selected track'], ['Ctrl I', 'Import audio']]],
    ['View', [['+ / −', 'Zoom in / out'], ['Ctrl + wheel', 'Zoom at cursor'], ['Shift + wheel', 'Scroll horizontally'], ['F', 'Zoom to fit project'], ['V / C', 'Select / split tool'], ['?', 'This help']]],
    ['Piano roll', [['D / S / E', 'Draw / select / erase'], ['↑ ↓', 'Transpose selected notes'], ['← →', 'Nudge selected notes'], ['Right-click', 'Delete note'], ['Ctrl C / V / D', 'Copy / paste / duplicate notes']]],
    ['Musical typing', [['A S D F G H J K', 'White keys'], ['W E T Y U O P', 'Black keys'], ['Z / X', 'Octave down / up']]],
  ];
  modal('Keyboard shortcuts', h('div', { class: 'shortcuts' }, rows.map(([t, items]) => h('div', { class: 'sc-group' }, h('h3', null, t), items.map(([k, d]) => h('div', { class: 'sc-row' }, h('kbd', null, k), h('span', null, d)))))), { width: 760, actions: [{ label: 'Close', primary: true }] });
}

export async function openTuner() {
  await engine.init();
  try { await ensureMic(); } catch (e) { toast('Microphone unavailable: ' + e.message, 'error'); return; }
  const ctx = engine.ctx, an = ctx.createAnalyser(); an.fftSize = 4096; const src = getMicSource(); src.connect(an);
  const note = h('div', { class: 'tn-note' }, '–'), hz = h('div', { class: 'muted' }, 'Play a note…'), needle = h('div', { class: 'tn-needle' });
  const meter = h('div', { class: 'tn-meter' }, [...Array(11)].map((_, i) => h('i', { class: i === 5 ? 'mid' : '', style: { left: i * 10 + '%' } })), needle);
  const cents = h('div', { class: 'tn-cents' });
  let alive = true; const buf = new Float32Array(an.fftSize); let sm = 0;
  const tick = () => {
    if (!alive) return; requestAnimationFrame(tick);
    an.getFloatTimeDomainData(buf);
    const f = detectPitch(buf.subarray(0, 2048), ctx.sampleRate);
    if (f > 0) {
      const m = freqToMidi(f), n = Math.round(m), c = (m - n) * 100; sm += (c - sm) * 0.35;
      note.textContent = NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1); hz.textContent = f.toFixed(1) + ' Hz'; cents.textContent = (sm > 0 ? '+' : '') + sm.toFixed(0) + ' cents';
      needle.style.left = 50 + clamp(sm, -50, 50) + '%'; meter.classList.toggle('ok', Math.abs(sm) < 5);
    }
  };
  tick();
  modal('Tuner', h('div', { class: 'tuner' }, note, hz, meter, cents, h('p', { class: 'muted small' }, 'Use headphones or an interface for best results.')), { width: 380, onClose: () => { alive = false; try { src.disconnect(an); } catch {} }, actions: [{ label: 'Close', primary: true }] });
}

export function openAbout() {
  modal('About Bandy', h('div', { class: 'about' },
    h('div', { class: 'about-logo', html: LOGO }), h('h2', null, 'Bandy'), h('p', null, 'A free, open-source music studio that runs entirely in your browser: multitrack recording, MIDI editing, synths, drums, effects, loops, mixing and mastering.'),
    h('p', { class: 'muted' }, 'Inspired by the workflow of browser-based studios such as BandLab. Not affiliated with or endorsed by BandLab. All sounds and loops are generated by original code – nothing is sampled.'),
    h('p', null, 'Released into the public domain under the ', h('a', { href: 'https://unlicense.org', target: '_blank', rel: 'noopener' }, 'Unlicense'), '. ', h('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, 'Source on GitHub'))), { width: 480, actions: [{ label: 'Close', primary: true }] });
}

export function openTemplates() {
  const items = [['blank', 'Blank project', 'Start with an empty studio', 'plus'], ['beat', 'Beat starter', 'Drums, bass and chords at 90 BPM', 'drum'], ['vocal', 'Vocal & keys', 'A voice track and an instrument', 'mic'], ['band', 'Full band', 'Drums, bass, guitar and vocals', 'guitar']];
  const m = modal('New project', h('div', { class: 'kind-grid' }, items.map(([id, t, d, ic]) => h('button', { class: 'kind-card', onclick: () => { m.close(); newProjectAction(id); } }, h('div', { class: 'kc-ic', html: icon(ic, 28) }), h('div', { class: 'kc-name' }, t), h('div', { class: 'kc-desc' }, d)))), { width: 600, actions: [{ label: 'Open existing…', action: () => openProjectDialog() }, { label: 'Cancel' }] });
}
