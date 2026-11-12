// Procedurally generated loop library (royalty-free by construction - everything here is original code).
import { SCALES } from '../util.js';

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const hash = (str) => { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const S = 0.25; // one 16th step in beats

const degNote = (base, scale, deg) => { const n = scale.length; return base + scale[((deg % n) + n) % n] + 12 * Math.floor(deg / n); };
const triad = (base, scale, d, ext) => (ext ? [d, d + 2, d + 4, d + 6] : [d, d + 2, d + 4]).map((x) => degNote(base, scale, x));

const DRUMS = {
  hiphop: { kick: 'x..x......x.....', snare: '....x.......x...', chh: 'x.x.x.x.x.x.x.xo', ohh: '..............x.' },
  boombap: { kick: 'x.....x...x...x.', snare: '....x.......x...', chh: 'x.x.x.x.x.x.x.x.', rim: '..............o.' },
  trap: { kick: 'x.....x...x....x', snare: '........x.......', clap: '........x.......', chh: 'XoxoXoxoXoxoxxxo', ohh: '......x.......x.' },
  lofi: { kick: 'x.....x...x.....', snare: '....x.......x..o', chh: 'x.o.x.o.x.o.x.oo', shk: '.o.o.o.o.o.o.o.o' },
  house: { kick: 'x...x...x...x...', clap: '....x.......x...', chh: 'x.x.x.x.x.x.x.x.', ohh: '..x...x...x...x.' },
  pop: { kick: 'x...x...x...x...', snare: '....x.......x...', chh: 'x.x.x.x.x.x.x.x.', clap: '....x.......x...' },
  rock: { kick: 'x.......x.x.....', snare: '....x.......x...', ride: 'x.x.x.x.x.x.x.x.', crash: 'x...............' },
  funk: { kick: 'x..x...x..x.....', snare: '....x..o.o..x..o', chh: 'xxoxxxoxxxoxxxox' },
  dnb: { kick: 'x.........x.....', snare: '....x.......x...', chh: 'x.x.x.x.x.x.x.x.', ohh: '.......x......x.' },
  reggae: { kick: '........x.......', snare: '........x.......', rim: '....x.......x...', chh: 'x.x.x.x.x.x.x.x.' },
  synth: { kick: 'x...x...x...x...', snare: '....x.......x...', chh: '..x...x...x...x.', clap: '....x.......x...' },
  rnb: { kick: 'x.....x...x.....', snare: '....x.......x...', chh: 'x.x.x.x.x.x.x.xx', rim: '...........o....' },
  chip: { kick: 'x..x..x.x..x..x.', snare: '....x.......x...', chh: 'xxxxxxxxxxxxxxxx' },
};
const BASS = {
  sub: ['x.......x.....o.', 'x...x...x..x....'], walk: ['x..x..f.o..x..f.', 'x.f.x.o.x.f.o.f.'], eighth: ['x.x.x.x.x.x.x.x.', 'x.x.xox.x.x.xofx'],
  sync: ['x..x..x...x..x..', 'x.xo..x..fx.o...'], whole: ['x...............', 'x.......x.......'], off: ['.x...x...x...x..', '.x.x.xo..x.x.xf.'],
};
const CHORD_RHYTHM = { whole: 'x...............', stabs: 'x..x..x.........', off: '..x...x...x...x.', pulse: 'x...x...x...x...', syn: 'x.....x...x.x...', skank: '....x.......x...' };

export const GENRES = [
  { id: 'hiphop', name: 'Hip Hop', bpm: 90, mood: 'Chill', scale: 'minor', prog: [0, 5, 2, 6], kit: 'acoustic', drums: ['boombap', 'hiphop'], bass: ['sub', 'sub'], chords: { inst: 'epiano', rhythm: 'stabs', ext: true }, lead: { inst: 'bell', density: 0.35 } },
  { id: 'trap', name: 'Trap', bpm: 140, mood: 'Dark', scale: 'minor', prog: [0, 5, 6, 4], kit: 'trap', drums: ['trap', 'trap'], bass: ['sub', 'sync'], bassInst: 'b808', chords: { inst: 'glass', rhythm: 'whole' }, lead: { inst: 'pluck', density: 0.5 } },
  { id: 'lofi', name: 'Lo-Fi', bpm: 78, mood: 'Mellow', scale: 'major', prog: [1, 4, 0, 5], kit: 'lofi', drums: ['lofi', 'lofi'], bass: ['walk', 'sub'], bassInst: 'upright', chords: { inst: 'epiano', rhythm: 'syn', ext: true }, lead: { inst: 'marimba', density: 0.3 } },
  { id: 'house', name: 'House', bpm: 124, mood: 'Energetic', scale: 'minor', prog: [0, 5, 3, 4], kit: 'house', drums: ['house', 'house'], bass: ['off', 'off'], chords: { inst: 'super', rhythm: 'off' }, lead: { inst: 'pluck', density: 0.55 } },
  { id: 'pop', name: 'Pop', bpm: 118, mood: 'Uplifting', scale: 'major', prog: [0, 4, 5, 3], kit: 'house', drums: ['pop', 'pop'], bass: ['eighth', 'sync'], chords: { inst: 'grand', rhythm: 'pulse', ext: false }, lead: { inst: 'saw', density: 0.5 } },
  { id: 'rock', name: 'Rock', bpm: 112, mood: 'Driving', scale: 'minor', prog: [0, 3, 4, 0], kit: 'acoustic', drums: ['rock', 'rock'], bass: ['eighth', 'eighth'], bassInst: 'synbass', chords: { inst: 'organ', rhythm: 'pulse' }, lead: { inst: 'square', density: 0.45 } },
  { id: 'funk', name: 'Funk', bpm: 102, mood: 'Groovy', scale: 'dorian', prog: [0, 3, 0, 4], kit: 'acoustic', drums: ['funk', 'funk'], bass: ['sync', 'walk'], chords: { inst: 'clav', rhythm: 'syn' }, lead: { inst: 'brass', density: 0.4 } },
  { id: 'dnb', name: 'Drum & Bass', bpm: 174, mood: 'Intense', scale: 'minor', prog: [0, 5, 2, 6], kit: 'house', drums: ['dnb', 'dnb'], bass: ['sync', 'sub'], bassInst: 'acid', chords: { inst: 'pad', rhythm: 'whole' }, lead: { inst: 'saw', density: 0.45 } },
  { id: 'reggae', name: 'Reggae', bpm: 76, mood: 'Laid-back', scale: 'major', prog: [0, 3, 4, 3], kit: 'acoustic', drums: ['reggae', 'reggae'], bass: ['walk', 'sub'], bassInst: 'upright', chords: { inst: 'organ', rhythm: 'skank' }, lead: { inst: 'flute', density: 0.3 } },
  { id: 'synthwave', name: 'Synthwave', bpm: 100, mood: 'Nostalgic', scale: 'minor', prog: [0, 5, 2, 4], kit: '808', drums: ['synth', 'synth'], bass: ['eighth', 'eighth'], bassInst: 'acid', chords: { inst: 'pad', rhythm: 'whole' }, lead: { inst: 'saw', density: 0.5 } },
  { id: 'rnb', name: 'R&B', bpm: 85, mood: 'Smooth', scale: 'major', prog: [1, 4, 0, 5], kit: 'trap', drums: ['rnb', 'rnb'], bass: ['sub', 'sync'], chords: { inst: 'epiano', rhythm: 'stabs', ext: true }, lead: { inst: 'bell', density: 0.35 } },
  { id: 'ambient', name: 'Ambient', bpm: 70, mood: 'Dreamy', scale: 'major', prog: [0, 5, 3, 4], kit: 'lofi', drums: [], bass: ['whole', 'whole'], bassInst: 'sub', chords: { inst: 'glass', rhythm: 'whole', ext: true }, lead: { inst: 'bell', density: 0.2 } },
  { id: 'chip', name: 'Chiptune', bpm: 140, mood: 'Playful', scale: 'major', prog: [0, 4, 5, 3], kit: 'house', drums: ['chip'], bass: ['eighth', 'sync'], bassInst: 'chip', chords: { inst: 'chip', rhythm: 'syn' }, lead: { inst: 'chip', density: 0.6 } },
];

function drumNotes(styleId, bars, variant) {
  const pat = DRUMS[styleId], out = [], r = rng(hash(styleId + variant));
  const map = { kick: 36, snare: 38, clap: 39, rim: 37, chh: 42, ohh: 46, ride: 51, crash: 49, shk: 70 };
  for (let b = 0; b < bars; b++) {
    for (const [k, str] of Object.entries(pat)) for (let i = 0; i < 16; i++) {
      const ch = str[i]; if (ch === '.') continue;
      if (k === 'crash' && b % 4) continue;
      if (variant && k === 'kick' && b % 4 === 3 && i > 8 && r() < 0.5) continue;
      out.push({ p: map[k], s: b * 4 + i * S, l: 0.2, v: ch === 'X' ? 118 : ch === 'x' ? 98 + Math.round(r() * 10) : 58 + Math.round(r() * 10) });
    }
    if (b % 4 === 3 && variant !== undefined) {
      const fillStart = variant ? 8 : 12;
      for (let i = fillStart; i < 16; i += (variant ? 1 : 2)) out.push({ p: i > 13 ? 45 : 48, s: b * 4 + i * S, l: 0.2, v: 80 + Math.round(r() * 30) });
    }
  }
  return out;
}

function bassNotes(g, bars, variant, root, scale) {
  const sc = SCALES[g.scale]; const base = 36 + root, out = [];
  const pat = BASS[g.bass[variant % g.bass.length]][variant % 2];
  for (let b = 0; b < bars; b++) {
    const deg = g.prog[b % g.prog.length], rootN = degNote(base, sc, deg);
    const hits = [];
    for (let i = 0; i < 16; i++) if (pat[i] !== '.') hits.push([i, pat[i]]);
    hits.forEach(([i, ch], k) => {
      const next = k + 1 < hits.length ? hits[k + 1][0] : 16;
      const n = ch === 'o' ? rootN + 12 : ch === 'f' ? rootN + 7 : rootN;
      out.push({ p: n, s: b * 4 + i * S, l: Math.max(S, (next - i) * S * (g.bassInst === 'b808' ? 0.95 : 0.85)), v: 100 });
    });
  }
  return out;
}

function chordNotes(g, bars, variant, root) {
  const sc = SCALES[g.scale], out = [], base = 60 + root - (root > 6 ? 12 : 0);
  const rhythm = variant === 1 && g.chords.rhythm === 'whole' ? 'stabs' : g.chords.rhythm;
  const pat = CHORD_RHYTHM[rhythm];
  for (let b = 0; b < bars; b++) {
    const ch = triad(base - 12, sc, g.prog[b % g.prog.length], g.chords.ext);
    const hits = []; for (let i = 0; i < 16; i++) if (pat[i] !== '.') hits.push(i);
    hits.forEach((i, k) => {
      const next = k + 1 < hits.length ? hits[k + 1] : 16;
      const len = rhythm === 'whole' ? 16 : (rhythm === 'off' || rhythm === 'skank' ? 1.5 : Math.min(next - i, 4));
      for (const n of ch) out.push({ p: n, s: b * 4 + i * S, l: len * S * (rhythm === 'whole' ? 0.98 : 0.9), v: 80 });
    });
  }
  return out;
}

function arpNotes(g, bars, variant, root) {
  const sc = SCALES[g.scale], out = [], base = 60 + root - (root > 6 ? 12 : 0);
  for (let b = 0; b < bars; b++) {
    const ch = triad(base, sc, g.prog[b % g.prog.length]);
    const seq = [ch[0], ch[1], ch[2], ch[1] + 12 > ch[2] + 12 ? ch[1] : ch[0] + 12, ch[2], ch[1], ch[0] + 12, ch[1]];
    for (let i = 0; i < 16; i += 2) out.push({ p: seq[(i / 2) % 8] + (variant ? 12 : 0), s: b * 4 + i * S, l: 0.4, v: 85 });
  }
  return out;
}

function leadNotes(g, bars, variant, root, seedStr) {
  const sc = SCALES[g.scale], out = [], r = rng(hash(seedStr)), base = 72 + root - (root > 6 ? 12 : 0);
  let prevDeg = 4;
  for (let b = 0; b < bars; b++) {
    const chordDeg = g.prog[b % g.prog.length];
    const tones = [chordDeg, chordDeg + 2, chordDeg + 4, chordDeg + 7];
    let i = 0;
    while (i < 16) {
      if (r() < g.lead.density + (i % 4 === 0 ? 0.25 : 0)) {
        const len = [1, 2, 2, 3, 4][Math.floor(r() * 5)];
        let deg = r() < 0.55 ? tones[Math.floor(r() * tones.length)] : prevDeg + (r() < 0.5 ? -1 : 1) * (1 + Math.floor(r() * 2));
        deg = Math.max(0, Math.min(deg, 11));
        out.push({ p: degNote(base, sc, deg) - 12, s: b * 4 + i * S, l: len * S * 0.9, v: 78 + Math.round(r() * 30) });
        prevDeg = deg; i += len;
      } else i++;
    }
  }
  return out;
}

export const LOOPS = [];
for (const g of GENRES) {
  const mk = (id, name, type, bars, inst, kit, gen) => LOOPS.push({ id: `${g.id}-${id}`, name: `${g.name} ${name}`, type, genre: g.name, mood: g.mood, bars, bpm: g.bpm, scale: g.scale === 'dorian' ? 'minor' : g.scale, inst, kit, gen });
  g.drums.forEach((d, i) => { mk('drums' + i, i ? 'Drums B' : 'Drums A', 'Drums', 4, null, g.kit, () => drumNotes(d, 4, i)); });
  if (g.drums.length) mk('beat', 'Beat Fill', 'Drums', 1, null, g.kit, () => drumNotes(g.drums[0], 1));
  g.bass.slice(0, 2).forEach((_, i) => mk('bass' + i, i ? 'Bass B' : 'Bass A', 'Bass', 4, g.bassInst || 'synbass', null, (ctx) => bassNotes(g, 4, i, ctx.root)));
  mk('chords0', 'Chords', 'Keys', 4, g.chords.inst, null, (ctx) => chordNotes(g, 4, 0, ctx.root));
  if (g.chords.rhythm === 'whole') mk('chords1', 'Chords Stabs', 'Keys', 4, g.chords.inst, null, (ctx) => chordNotes(g, 4, 1, ctx.root));
  mk('arp', 'Arp', 'Synth', 4, g.id === 'chip' ? 'chip' : g.lead.inst === 'bell' ? 'bell' : 'pluck', null, (ctx) => arpNotes(g, 4, 0, ctx.root));
  mk('lead', 'Melody', 'Lead', 4, g.lead.inst, null, (ctx) => leadNotes(g, 4, 0, ctx.root, g.id + 'lead'));
  mk('lead1', 'Hook', 'Lead', 4, g.lead.inst, null, (ctx) => leadNotes(g, 4, 1, ctx.root, g.id + 'hook'));
}
export const LOOP_TYPES = ['Drums', 'Bass', 'Keys', 'Synth', 'Lead'];
export const LOOP_BY_ID = Object.fromEntries(LOOPS.map((l) => [l.id, l]));

// Build notes for a loop in the given project key. Notes are shifted so they stay in a sensible range.
export function buildLoop(loop, key = 0) { return loop.gen({ root: key }).map((n, i) => ({ id: 'n' + i + Math.random().toString(36).slice(2, 6), ...n })); }
