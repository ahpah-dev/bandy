// Landing page behaviour: animated studio mock, playable keyboard, latest-songs teaser.
import { h, icon, LOGO, initChrome } from './ui.js';
import { INSTRUMENTS, INST_BY_ID, startVoice } from '../audio/synth.js';
import { backend } from './backend.js';
import { songCard, createPlayer } from './songui.js';

const $ = (s) => document.querySelector(s);
$('#logo').innerHTML = LOGO; $('#logo2').innerHTML = LOGO; $('#menuBtn').innerHTML = icon('menu', 22); $('#ghBtn').innerHTML = icon('github', 18) + ' GitHub';
$('#ctaStudio').innerHTML = 'Open the studio ' + icon('play', 16); $('#ctaSongs').innerHTML = icon('music', 18) + ' Browse songs'; $('#ctaFinal').innerHTML = 'Open the studio ' + icon('play', 16);
$('#ghBig').innerHTML = icon('github', 18) + ' View on GitHub'; $('#upLink').innerHTML = icon('upload', 18) + ' Upload yours'; $('#mPlay').innerHTML = icon('play', 11);
[['t1', 'No account needed'], ['t2', 'Unlicense / public domain'], ['t3', 'Your projects stay on your device']].forEach(([id, t]) => { $('#' + id).innerHTML = icon('check', 16) + t; });
document.querySelectorAll('.f-ic').forEach((el) => { el.innerHTML = icon(el.dataset.ic, 22); });
initChrome();

/* ---------- animated studio mock ---------- */
const TRACKS = [
  ['Drums', '#ff4b2b', [[2, 46], [50, 48]]], ['Bass', '#ff7a2f', [[2, 46], [50, 48]]], ['Chords', '#ffb020', [[2, 22], [26, 22], [50, 22], [74, 24]]],
  ['Lead', '#22c78a', [[26, 22], [74, 24]]], ['Vocals', '#7c5cff', [[50, 46]]],
];
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const heads = $('#mHeads'), lanes = $('#mLanes');
for (const [name, color, regs] of TRACKS) {
  heads.append(h('div', { class: 'mock-head', style: { '--c': color } }, name, h('small', null, h('b'), h('b'), h('b'))));
  const lane = h('div', { class: 'mock-lane' });
  for (const [left, width] of regs) {
    const notes = h('div', { class: 'notes' });
    const n = Math.round(width * 0.9);
    for (let i = 0; i < n; i++) notes.append(h('i', { style: { height: (name === 'Vocals' ? 14 + Math.sin(i / 2.2) * 12 + rnd() * 16 : 6 + rnd() * 28) + 'px', alignSelf: name === 'Drums' || name === 'Bass' ? 'auto' : 'center', opacity: String(0.55 + rnd() * 0.45) } }));
    lane.append(h('div', { class: 'reg', style: { '--c': color, left: left + '%', width: width + '%' } }, notes));
  }
  lanes.append(lane);
}

/* ---------- playable keyboard ---------- */
const PICKS = ['grand', 'epiano', 'super', 'pad', 'pluck', 'bell', 'strings', 'synbass'].filter((id) => INST_BY_ID[id]);
let inst = INST_BY_ID[PICKS[0]], ctx = null, master = null, analyser = null;
const chips = $('#insts');
for (const id of PICKS) chips.append(h('button', { class: 'chip' + (id === PICKS[0] ? ' on' : ''), 'aria-pressed': String(id === PICKS[0]), onclick: (e) => { inst = INST_BY_ID[id]; chips.querySelectorAll('.chip').forEach((c) => { c.classList.remove('on'); c.setAttribute('aria-pressed', 'false'); }); e.currentTarget.classList.add('on'); e.currentTarget.setAttribute('aria-pressed', 'true'); play(inst.cat === 'Bass' ? 48 : 60, 0.4); } }, INST_BY_ID[id].name));

function audio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  ctx = new AudioContext({ latencyHint: 'interactive' });
  master = ctx.createGain(); master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor(); analyser = ctx.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.82;
  master.connect(comp); comp.connect(analyser); comp.connect(ctx.destination);
  requestAnimationFrame(draw);
  return ctx;
}
const held = new Map();
function on(note) {
  if (held.has(note)) return;
  const c = audio(), keyEl = document.querySelector(`.pk[data-n="${note}"]`); keyEl?.classList.add('down');
  held.set(note, startVoice(c, master, inst, c.currentTime + 0.005, note, 105));
}
function off(note) { const v = held.get(note); if (!v) return; v.release(ctx.currentTime); held.delete(note); document.querySelector(`.pk[data-n="${note}"]`)?.classList.remove('down'); }
function play(note, sec) { on(note); setTimeout(() => off(note), sec * 1000); }

const piano = $('#piano'), LO = 60, HI = 76; // C4 .. E5
const black = (n) => [1, 3, 6, 8, 10].includes(n % 12), names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const whites = []; for (let n = LO; n <= HI; n++) if (!black(n)) whites.push(n);
const W = 100 / whites.length;
whites.forEach((n, i) => piano.append(h('div', { class: 'pk w', dataset: { n }, style: { left: i * W + '%', width: W + '%' } }, n % 12 === 0 ? names[n % 12] + (Math.floor(n / 12) - 1) : '')));
for (let n = LO; n <= HI; n++) if (black(n)) piano.append(h('div', { class: 'pk b', dataset: { n }, style: { left: whites.indexOf(n - 1) * W + W * 0.7 + '%', width: W * 0.6 + '%' } }));
piano.addEventListener('pointerdown', (e) => { const k = e.target.closest('.pk'); if (!k) return; e.preventDefault(); const n = +k.dataset.n; on(n); const up = () => { off(n); window.removeEventListener('pointerup', up); }; window.addEventListener('pointerup', up); });
const MAP = 'awsedftgyhujkolp;'.split('');
addEventListener('keydown', (e) => { if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return; const i = MAP.indexOf(e.key.toLowerCase()); if (i >= 0 && LO + i <= HI) on(LO + i); });
addEventListener('keyup', (e) => { const i = MAP.indexOf(e.key.toLowerCase()); if (i >= 0) off(LO + i); });

const viz = $('#viz'), vc = viz.getContext('2d');
function draw() {
  requestAnimationFrame(draw);
  const r = viz.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  if (viz.width !== Math.round(r.width * dpr)) { viz.width = Math.round(r.width * dpr); viz.height = Math.round(r.height * dpr); }
  vc.clearRect(0, 0, viz.width, viz.height);
  const data = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(data);
  const n = 48, bw = viz.width / n, g = vc.createLinearGradient(0, viz.height, 0, 0); g.addColorStop(0, '#e0173d'); g.addColorStop(1, '#7c5cff'); vc.fillStyle = g;
  for (let i = 0; i < n; i++) { const v = data[Math.floor((i / n) * data.length * 0.7)] / 255, hh = Math.max(3 * dpr, v * viz.height * 0.95); vc.beginPath(); vc.roundRect(i * bw + bw * 0.18, viz.height - hh, bw * 0.64, hh, 4 * dpr); vc.fill(); }
}
// idle shimmer before any sound is played
(function idle() { if (ctx) return; const r = viz.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1); viz.width = Math.round(r.width * dpr); viz.height = Math.round(r.height * dpr); const n = 48, bw = viz.width / n; vc.fillStyle = 'rgba(255,255,255,.08)'; for (let i = 0; i < n; i++) vc.fillRect(i * bw + bw * 0.18, viz.height - 4 * dpr, bw * 0.64, 4 * dpr); })();

/* ---------- latest songs teaser ---------- */
(async () => {
  const box = $('#teaser'), player = createPlayer();
  try {
    await backend.init();
    const { items } = await backend.list({ limit: 4 });
    if (!items.length) { box.append(h('div', { class: 'empty' }, h('div', { class: 'big', html: icon('music', 30) }), h('h3', null, 'The stage is empty'), h('p', null, 'Be the first to share a song with the community.'), h('a', { class: 'btn primary', style: { marginTop: '14px' }, href: 'songs.html', html: icon('upload', 18) + ' Upload a song' }))); return; }
    items.forEach((s) => box.append(songCard(s, { compact: true, handlers: { onPlay: (x) => player.play(x, items) } })));
    player.onChange((cur, playing) => box.querySelectorAll('.song').forEach((el) => { const onn = cur && el.dataset.id === cur.id && playing; el.classList.toggle('playing', !!onn); el.querySelector('.pbtn').innerHTML = icon(onn ? 'pause' : 'play', 22); }));
  } catch { box.append(h('div', { class: 'empty' }, h('h3', null, 'Songs are taking a break'), h('p', null, 'Open the Song browser to try again.'), h('a', { class: 'btn', style: { marginTop: '12px' }, href: 'songs.html' }, 'Go to Song browser'))); }
})();
