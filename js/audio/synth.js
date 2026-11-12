// Built-in instruments: polyphonic synth voices, synthesised drum kits and metronome.
// Custom instruments (registry below) reuse the same synth voice; sample instruments play a decoded buffer.
import { midiToFreq, clamp, uid } from '../util.js';

// osc layers: [type, detuneCents, gain, octaveOffset]
export const INSTRUMENTS = [
  { id: 'grand', name: 'Grand Piano', cat: 'Keys', osc: [['triangle', 0, 0.8, 0], ['sine', 2, 0.5, 1], ['sine', 0, 0.18, 2]], env: [0.003, 1.6, 0, 0.35], filter: { type: 'lowpass', freq: 3800, q: 0.5, track: 1.2, amt: 2600, decay: 0.5 }, gain: 0.85 },
  { id: 'epiano', name: 'Electric Piano', cat: 'Keys', osc: [['sine', 0, 0.9, 0], ['sine', 3, 0.3, 2], ['triangle', -3, 0.3, 0]], env: [0.004, 1.4, 0.05, 0.4], filter: { type: 'lowpass', freq: 3000, q: 0.6, amt: 1500, decay: 0.3 }, gain: 0.9, trem: [4.5, 0.12] },
  { id: 'organ', name: 'Drawbar Organ', cat: 'Keys', osc: [['sine', 0, 0.7, 0], ['sine', 0, 0.55, 1], ['sine', 0, 0.35, 1.585], ['sine', 0, 0.3, 2]], env: [0.01, 0.05, 1, 0.08], filter: { type: 'lowpass', freq: 6000, q: 0.4 }, gain: 0.6, trem: [6, 0.08] },
  { id: 'clav', name: 'Funk Clav', cat: 'Keys', osc: [['square', 0, 0.5, 0], ['sawtooth', 5, 0.4, 0]], env: [0.002, 0.25, 0, 0.08], filter: { type: 'bandpass', freq: 2200, q: 1.5, amt: 2000, decay: 0.12 }, gain: 0.8 },
  { id: 'bell', name: 'Glass Bell', cat: 'Keys', osc: [['sine', 0, 0.7, 0], ['sine', 0, 0.35, 2.76], ['sine', 0, 0.2, 5.4]], env: [0.002, 2.2, 0, 0.8], filter: { type: 'lowpass', freq: 9000, q: 0.3 }, gain: 0.8 },
  { id: 'marimba', name: 'Marimba', cat: 'Keys', osc: [['sine', 0, 0.9, 0], ['sine', 0, 0.25, 3.9]], env: [0.002, 0.45, 0, 0.12], filter: { type: 'lowpass', freq: 4000, q: 0.5 }, gain: 1 },
  { id: 'pad', name: 'Warm Pad', cat: 'Pads', osc: [['sawtooth', -9, 0.35, 0], ['sawtooth', 9, 0.35, 0], ['triangle', 0, 0.4, -1]], env: [0.7, 0.5, 0.8, 1.2], filter: { type: 'lowpass', freq: 1400, q: 0.7 }, gain: 0.55 },
  { id: 'strings', name: 'String Ensemble', cat: 'Pads', osc: [['sawtooth', -12, 0.3, 0], ['sawtooth', 0, 0.3, 0], ['sawtooth', 12, 0.3, 0]], env: [0.35, 0.3, 0.85, 0.5], filter: { type: 'lowpass', freq: 2600, q: 0.5 }, gain: 0.5, vib: [5.2, 6] },
  { id: 'choir', name: 'Choir Ahh', cat: 'Pads', osc: [['sawtooth', -6, 0.3, 0], ['triangle', 6, 0.4, 0], ['sine', 0, 0.3, 1]], env: [0.5, 0.4, 0.8, 0.9], filter: { type: 'bandpass', freq: 900, q: 0.9 }, gain: 0.9, vib: [5, 8] },
  { id: 'glass', name: 'Glass Pad', cat: 'Pads', osc: [['sine', 0, 0.5, 0], ['sine', 7, 0.35, 1], ['triangle', -7, 0.25, 2]], env: [1.0, 0.5, 0.8, 1.6], filter: { type: 'lowpass', freq: 5000, q: 0.5 }, gain: 0.7, vib: [3.5, 4] },
  { id: 'saw', name: 'Saw Lead', cat: 'Leads', osc: [['sawtooth', -6, 0.5, 0], ['sawtooth', 6, 0.5, 0]], env: [0.01, 0.2, 0.7, 0.2], filter: { type: 'lowpass', freq: 2600, q: 2, amt: 2500, decay: 0.25 }, gain: 0.6, vib: [5.5, 5] },
  { id: 'square', name: 'Square Lead', cat: 'Leads', osc: [['square', 0, 0.5, 0], ['square', 7, 0.3, 1]], env: [0.005, 0.1, 0.75, 0.15], filter: { type: 'lowpass', freq: 3500, q: 1.2 }, gain: 0.5, vib: [5.5, 6] },
  { id: 'super', name: 'Super Saw', cat: 'Leads', osc: [['sawtooth', -22, 0.22, 0], ['sawtooth', -11, 0.22, 0], ['sawtooth', 0, 0.22, 0], ['sawtooth', 11, 0.22, 0], ['sawtooth', 22, 0.22, 0]], env: [0.01, 0.3, 0.7, 0.25], filter: { type: 'lowpass', freq: 5200, q: 0.8 }, gain: 0.6 },
  { id: 'chip', name: 'Chiptune', cat: 'Leads', osc: [['square', 0, 0.6, 0]], env: [0.001, 0.05, 0.8, 0.04], filter: { type: 'lowpass', freq: 9000, q: 0.1 }, gain: 0.4, vib: [6, 10] },
  { id: 'pluck', name: 'Synth Pluck', cat: 'Leads', osc: [['sawtooth', -5, 0.5, 0], ['square', 5, 0.3, 0]], env: [0.002, 0.28, 0, 0.12], filter: { type: 'lowpass', freq: 600, q: 3, amt: 5000, decay: 0.18 }, gain: 0.7 },
  { id: 'brass', name: 'Brass Section', cat: 'Leads', osc: [['sawtooth', -4, 0.5, 0], ['sawtooth', 4, 0.5, 0]], env: [0.06, 0.2, 0.75, 0.15], filter: { type: 'lowpass', freq: 800, q: 1, amt: 3500, decay: 0.25 }, gain: 0.6 },
  { id: 'flute', name: 'Soft Flute', cat: 'Leads', osc: [['sine', 0, 0.8, 0], ['triangle', 0, 0.2, 1]], env: [0.08, 0.1, 0.85, 0.15], filter: { type: 'lowpass', freq: 5000, q: 0.3 }, gain: 0.85, vib: [5, 9], breath: 0.03 },
  { id: 'synbass', name: 'Synth Bass', cat: 'Bass', osc: [['sawtooth', 0, 0.55, 0], ['square', 0, 0.35, -1]], env: [0.004, 0.2, 0.55, 0.1], filter: { type: 'lowpass', freq: 500, q: 3, amt: 1800, decay: 0.18 }, gain: 0.7 },
  { id: 'sub', name: 'Sub Bass', cat: 'Bass', osc: [['sine', 0, 1, 0], ['triangle', 0, 0.15, 1]], env: [0.01, 0.1, 0.9, 0.1], filter: { type: 'lowpass', freq: 400, q: 0.3 }, gain: 1 },
  { id: 'b808', name: '808 Bass', cat: 'Bass', osc: [['sine', 0, 1, 0]], env: [0.003, 1.4, 0.0, 0.25], filter: { type: 'lowpass', freq: 700, q: 0.3 }, gain: 1.2, glide: 0.06, drive: 2.2 },
  { id: 'acid', name: 'Acid Bass', cat: 'Bass', osc: [['sawtooth', 0, 0.8, 0]], env: [0.002, 0.18, 0.3, 0.06], filter: { type: 'lowpass', freq: 300, q: 12, amt: 3200, decay: 0.2 }, gain: 0.55 },
  { id: 'upright', name: 'Upright Bass', cat: 'Bass', osc: [['triangle', 0, 0.8, 0], ['sine', 0, 0.5, 1]], env: [0.01, 0.5, 0.12, 0.15], filter: { type: 'lowpass', freq: 900, q: 0.6, amt: 700, decay: 0.2 }, gain: 1 },
  // ---- Keys ----
  { id: 'rhodes', name: 'Rhodes', cat: 'Keys', osc: [['sine', 0, 0.8, 0], ['sine', 0, 0.15, 2]], fm: { ratio: 1, index: 2, decay: 0.5, end: 0.05 }, env: [0.003, 1.8, 0.2, 0.5], filter: { type: 'lowpass', freq: 3500, q: 0.5, amt: 1200, decay: 0.4 }, gain: 0.85, trem: [4, 0.1] },
  { id: 'wurli', name: 'Wurlitzer', cat: 'Keys', osc: [['triangle', 0, 0.7, 0], ['sine', 2, 0.4, 0], ['sine', 0, 0.2, 1]], fm: { ratio: 2, index: 0.6, decay: 0.3, end: 0.1 }, env: [0.004, 1.2, 0.3, 0.4], filter: { type: 'lowpass', freq: 2600, q: 0.7, amt: 1000, decay: 0.25 }, gain: 0.8, trem: [5.5, 0.15] },
  { id: 'harpsi', name: 'Harpsichord', cat: 'Keys', osc: [['sawtooth', 0, 0.5, 0], ['square', 0, 0.2, 1]], env: [0.001, 0.6, 0, 0.1], filter: { type: 'lowpass', freq: 3000, q: 1, amt: 4000, decay: 0.08 }, gain: 0.6, attackNoise: { gain: 0.35, decay: 0.012, type: 'hp', freq: 3000 } },
  { id: 'celesta', name: 'Celesta', cat: 'Keys', osc: [['sine', 0, 0.9, 0], ['sine', 0, 0.2, 2]], fm: { ratio: 4, index: 0.8, decay: 0.8, end: 0.1 }, env: [0.002, 1.4, 0, 0.5], filter: { type: 'lowpass', freq: 7000, q: 0.3 }, gain: 0.8 },
  { id: 'honky', name: 'Honky-Tonk Piano', cat: 'Keys', osc: [['triangle', -14, 0.45, 0], ['triangle', 14, 0.45, 0], ['sine', 0, 0.3, 1]], env: [0.003, 1.3, 0, 0.35], filter: { type: 'lowpass', freq: 3200, q: 0.6, amt: 2200, decay: 0.4 }, gain: 0.8, attackNoise: { gain: 0.15, decay: 0.01, type: 'bp', freq: 2500, q: 1 } },
  { id: 'uprpno', name: 'Upright Piano', cat: 'Keys', osc: [['triangle', 0, 0.7, 0], ['sawtooth', 0, 0.12, 0], ['sine', 2, 0.3, 1]], env: [0.004, 1.0, 0, 0.3], filter: { type: 'lowpass', freq: 2200, q: 0.6, amt: 1500, decay: 0.25 }, gain: 0.8, attackNoise: { gain: 0.2, decay: 0.01, type: 'bp', freq: 2500, q: 1 } },
  { id: 'accord', name: 'Accordion', cat: 'Keys', osc: [['sawtooth', -7, 0.3, 0], ['square', 7, 0.25, 0], ['sawtooth', 0, 0.2, 1]], env: [0.05, 0.1, 0.9, 0.12], filter: { type: 'lowpass', freq: 2800, q: 0.9 }, gain: 0.55, vib: [5.8, 5] },
  { id: 'harm', name: 'Harmonium', cat: 'Keys', osc: [['sawtooth', 0, 0.4, 0], ['sawtooth', -5, 0.2, 0], ['sine', 0, 0.3, 0]], env: [0.25, 0.2, 0.9, 0.3], filter: { type: 'bandpass', freq: 1100, q: 1.2 }, gain: 0.65, breath: 0.02, vib: [5, 4] },
  { id: 'church', name: 'Church Organ', cat: 'Keys', osc: [['sine', 0, 0.6, 0], ['sine', 0, 0.5, 1], ['sine', 0, 0.4, 2], ['sine', 0, 0.25, 3], ['sine', 0, 0.15, 4]], env: [0.08, 0.1, 1, 0.25], filter: { type: 'lowpass', freq: 3000, q: 0.4 }, gain: 0.45, vib: [5.2, 6] },
  { id: 'rockorg', name: 'Rock Organ', cat: 'Keys', osc: [['square', 0, 0.4, 0], ['sine', 0, 0.5, 1], ['sawtooth', 0, 0.25, 0]], env: [0.005, 0.08, 1, 0.08], filter: { type: 'lowpass', freq: 4500, q: 0.8 }, gain: 0.45, trem: [6.5, 0.1], drive: 1.6 },
  { id: 'pipe', name: 'Pipe Organ', cat: 'Keys', osc: [['sine', 0, 0.6, 0], ['sine', 0, 0.5, 1], ['sine', 0, 0.4, 2], ['sine', 0, 0.3, 3], ['sawtooth', 0, 0.12, 0]], unison: { voices: 2, spread: 5, type: 'sine' }, env: [0.25, 0.2, 1, 0.5], filter: { type: 'lowpass', freq: 2500, q: 0.5 }, gain: 0.45 },
  { id: 'toy', name: 'Toy Piano', cat: 'Keys', osc: [['sine', 0, 0.8, 1], ['sine', 0, 0.3, 2]], env: [0.002, 0.9, 0, 0.2], filter: { type: 'bandpass', freq: 2800, q: 1.5 }, gain: 0.8, attackNoise: { gain: 0.15, decay: 0.005, type: 'hp', freq: 5000 } },
  { id: 'clav2', name: 'Clavinet 2', cat: 'Keys', osc: [['square', 0, 0.45, 0], ['sawtooth', -4, 0.35, 0], ['square', 0, 0.2, 1]], env: [0.001, 0.3, 0.05, 0.1], filter: { type: 'bandpass', freq: 1800, q: 2.5, amt: 3500, decay: 0.15 }, gain: 0.75, attackNoise: { gain: 0.3, decay: 0.01, type: 'bp', freq: 3000, q: 2 } },
  // ---- Plucked ----
  { id: 'nylon', name: 'Nylon Guitar', cat: 'Plucked', osc: [['triangle', 0, 0.8, 0], ['sine', 0, 0.2, 1], ['sawtooth', 0, 0.05, 0]], env: [0.002, 1.1, 0, 0.2], filter: { type: 'lowpass', freq: 2400, q: 0.5, amt: 2600, decay: 0.25 }, gain: 0.9, attackNoise: { gain: 0.15, decay: 0.008, type: 'bp', freq: 2500, q: 1.2 } },
  { id: 'steel', name: 'Steel Guitar', cat: 'Plucked', osc: [['sawtooth', 0, 0.4, 0], ['triangle', 0, 0.4, 0], ['sine', 0, 0.25, 1]], env: [0.001, 1.6, 0, 0.3], filter: { type: 'lowpass', freq: 3000, q: 0.6, amt: 3000, decay: 0.3 }, gain: 0.75, attackNoise: { gain: 0.25, decay: 0.01, type: 'bp', freq: 3500, q: 1.5 } },
  { id: 'cleang', name: 'Clean Electric Guitar', cat: 'Plucked', osc: [['sawtooth', 0, 0.4, 0], ['triangle', 3, 0.3, 0]], env: [0.002, 1.2, 0, 0.25], filter: { type: 'lowpass', freq: 3400, q: 0.8, amt: 2000, decay: 0.2 }, gain: 0.8, unison: { voices: 2, spread: 6, type: 'sawtooth' }, drive: 1.3 },
  { id: 'mute', name: 'Muted Guitar', cat: 'Plucked', osc: [['sawtooth', 0, 0.5, 0], ['square', 0, 0.2, 0]], env: [0.001, 0.22, 0, 0.06], filter: { type: 'lowpass', freq: 1200, q: 1.5, amt: 1800, decay: 0.08 }, gain: 0.9, attackNoise: { gain: 0.6, decay: 0.012, type: 'hp', freq: 2500 } },
  { id: 'harp', name: 'Harp', cat: 'Plucked', osc: [['triangle', 0, 0.7, 0], ['sine', 0, 0.25, 1], ['sine', 0, 0.1, 2]], fm: { ratio: 2, index: 0.15, decay: 0.4, end: 0.05 }, env: [0.002, 2.2, 0, 0.6], filter: { type: 'lowpass', freq: 5000, q: 0.4 }, gain: 0.9, attackNoise: { gain: 0.2, decay: 0.01, type: 'hp', freq: 5000 } },
  { id: 'banjo', name: 'Banjo', cat: 'Plucked', osc: [['sawtooth', 0, 0.4, 0], ['square', 0, 0.1, 0], ['sine', 0, 0.2, 1]], env: [0.001, 0.6, 0, 0.1], filter: { type: 'lowpass', freq: 4200, q: 1.2, amt: 3800, decay: 0.08 }, gain: 0.75, attackNoise: { gain: 0.3, decay: 0.008, type: 'hp', freq: 3000 } },
  { id: 'koto', name: 'Koto', cat: 'Plucked', osc: [['sawtooth', 0, 0.3, 0], ['triangle', 0, 0.4, 0], ['sine', 0, 0.25, 1]], pitchEnv: [0.3, 0.08], env: [0.001, 2.0, 0, 0.4], filter: { type: 'lowpass', freq: 3000, q: 0.8 }, gain: 0.8, attackNoise: { gain: 0.25, decay: 0.01, type: 'bp', freq: 2800, q: 2 } },
  { id: 'sitar', name: 'Sitar', cat: 'Plucked', osc: [['sawtooth', 0, 0.35, 0], ['square', 0, 0.1, 0], ['sawtooth', 0, 0.2, 1], ['sine', 0, 0.15, 2]], fm: { ratio: 1, index: 0.6, decay: 1.0, end: 0.3 }, pitchEnv: [0.6, 0.1], env: [0.002, 2.4, 0, 0.7], filter: { type: 'lowpass', freq: 2600, q: 1.5, amt: 2000, decay: 0.4 }, gain: 0.8, drive: 2.4 },
  { id: 'uke', name: 'Ukulele', cat: 'Plucked', osc: [['triangle', 0, 0.6, 0], ['sine', 0, 0.3, 1], ['sawtooth', 0, 0.08, 0]], env: [0.001, 0.9, 0, 0.2], filter: { type: 'lowpass', freq: 4000, q: 0.5, amt: 1500, decay: 0.15 }, gain: 0.9, attackNoise: { gain: 0.2, decay: 0.008, type: 'hp', freq: 3500 } },
  { id: 'mando', name: 'Mandolin', cat: 'Plucked', osc: [['sawtooth', -2, 0.4, 0], ['sawtooth', 2, 0.4, 0]], env: [0.001, 1.0, 0, 0.2], filter: { type: 'lowpass', freq: 3600, q: 0.9, amt: 2500, decay: 0.18 }, gain: 0.65, attackNoise: { gain: 0.3, decay: 0.01, type: 'bp', freq: 3000, q: 1.5 } },
  { id: 'pizz', name: 'Pizzicato Strings', cat: 'Plucked', osc: [['sawtooth', -6, 0.3, 0], ['sawtooth', 6, 0.3, 0], ['triangle', 0, 0.3, -1]], env: [0.003, 0.6, 0, 0.15], filter: { type: 'lowpass', freq: 2200, q: 0.6, amt: 1800, decay: 0.2 }, gain: 0.8, attackNoise: { gain: 0.35, decay: 0.008, type: 'hp', freq: 3000 } },
  { id: 'lute', name: 'Lute', cat: 'Plucked', osc: [['triangle', 0, 0.6, 0], ['sine', 0, 0.25, 1], ['triangle', 0, 0.15, 2]], env: [0.002, 1.6, 0, 0.35], filter: { type: 'lowpass', freq: 3000, q: 0.6, amt: 1600, decay: 0.25 }, gain: 0.85, attackNoise: { gain: 0.2, decay: 0.01, type: 'bp', freq: 2200 } },
  // ---- Bass ----
  { id: 'fretless', name: 'Fretless Bass', cat: 'Bass', osc: [['sawtooth', 0, 0.5, 0], ['sine', 0, 0.4, 0]], env: [0.04, 0.6, 0.85, 0.2], filter: { type: 'lowpass', freq: 1000, q: 0.5, amt: 500, decay: 0.3 }, gain: 0.9, vib: [5, 8] },
  { id: 'slap', name: 'Slap Bass', cat: 'Bass', osc: [['sawtooth', 0, 0.5, 0], ['square', 0, 0.3, 0], ['sine', 0, 0.4, 1]], env: [0.001, 0.35, 0.2, 0.1], filter: { type: 'bandpass', freq: 900, q: 2, amt: 2200, decay: 0.1 }, gain: 0.9, attackNoise: { gain: 0.7, decay: 0.012, type: 'bp', freq: 2200, q: 1 } },
  { id: 'wobble', name: 'Wobble Bass', cat: 'Bass', osc: [['sawtooth', -8, 0.4, 0], ['sawtooth', 8, 0.4, 0], ['square', 0, 0.2, -1]], env: [0.01, 0.2, 0.85, 0.15], filter: { type: 'lowpass', freq: 1000, q: 4 }, lfoFilter: [3.5, 700], gain: 0.6 },
  { id: 'reese', name: 'Reese Bass', cat: 'Bass', osc: [['sawtooth', -14, 0.45, 0], ['sawtooth', 14, 0.45, 0], ['sawtooth', 0, 0.2, -1]], env: [0.02, 0.5, 0.9, 0.2], filter: { type: 'lowpass', freq: 800, q: 2.5 }, lfoFilter: [0.5, 250], gain: 0.55 },
  { id: 'fmbass', name: 'FM Bass', cat: 'Bass', osc: [['sine', 0, 0.9, 0], ['sine', 0, 0.3, -1]], fm: { ratio: 1, index: 3, decay: 0.25, end: 0.05 }, env: [0.002, 0.5, 0.25, 0.12], filter: { type: 'lowpass', freq: 3000, q: 0.4 }, gain: 0.85 },
  { id: 'moog', name: 'Moog Bass', cat: 'Bass', osc: [['sawtooth', 0, 0.6, 0], ['square', 0, 0.25, -1]], env: [0.003, 0.4, 0.5, 0.15], filter: { type: 'lowpass', freq: 400, q: 6, amt: 1800, decay: 0.25 }, gain: 0.8, drive: 1.8 },
  { id: 'sqbass', name: 'Square Bass', cat: 'Bass', osc: [['square', 0, 0.6, 0], ['square', 3, 0.3, 0], ['sine', 0, 0.3, -1]], env: [0.004, 0.25, 0.6, 0.1], filter: { type: 'lowpass', freq: 900, q: 1.5, amt: 800, decay: 0.15 }, gain: 0.75 },
  { id: 'pluckbass', name: 'Pluck Bass', cat: 'Bass', osc: [['triangle', 0, 0.8, 0], ['sawtooth', 0, 0.25, 0]], env: [0.001, 0.4, 0, 0.12], filter: { type: 'lowpass', freq: 800, q: 0.8, amt: 1800, decay: 0.18 }, gain: 0.9, attackNoise: { gain: 0.4, decay: 0.01, type: 'bp', freq: 1200, q: 1 } },
  { id: 'dub', name: 'Dub Bass', cat: 'Bass', osc: [['sine', 0, 0.9, 0], ['triangle', 0, 0.3, 1]], env: [0.005, 0.9, 0.3, 0.4], filter: { type: 'lowpass', freq: 350, q: 1.5, amt: 300, decay: 0.4 }, gain: 0.9, drive: 1.5 },
  { id: 'ebass', name: 'Electric Bass (finger)', cat: 'Bass', osc: [['sawtooth', 0, 0.35, 0], ['triangle', 0, 0.5, 0], ['sine', 0, 0.4, -1]], env: [0.005, 0.5, 0.35, 0.15], filter: { type: 'lowpass', freq: 800, q: 0.7, amt: 900, decay: 0.25 }, gain: 0.9, attackNoise: { gain: 0.2, decay: 0.01, type: 'bp', freq: 1400, q: 1.2 } },
  // ---- Strings ----
  { id: 'violin', name: 'Violin', cat: 'Strings', osc: [['sawtooth', -4, 0.35, 0], ['sawtooth', 4, 0.35, 0], ['sine', 0, 0.15, 1]], env: [0.12, 0.3, 0.9, 0.3], filter: { type: 'lowpass', freq: 3500, q: 0.7, amt: 1500, decay: 0.3 }, gain: 0.7, vib: [5.5, 12], attackNoise: { gain: 0.18, decay: 0.06, type: 'bp', freq: 2500, q: 1 } },
  { id: 'viola', name: 'Viola', cat: 'Strings', osc: [['sawtooth', -5, 0.35, 0], ['sawtooth', 5, 0.35, 0], ['triangle', 0, 0.2, -1]], env: [0.15, 0.3, 0.9, 0.35], filter: { type: 'lowpass', freq: 2600, q: 0.7, amt: 1000, decay: 0.3 }, gain: 0.7, vib: [5, 10], attackNoise: { gain: 0.15, decay: 0.06, type: 'bp', freq: 2000, q: 1 } },
  { id: 'cello', name: 'Cello', cat: 'Strings', osc: [['sawtooth', -5, 0.35, 0], ['sawtooth', 5, 0.35, 0], ['triangle', 0, 0.3, -1]], env: [0.18, 0.35, 0.9, 0.4], filter: { type: 'lowpass', freq: 1800, q: 0.7, amt: 900, decay: 0.35 }, gain: 0.8, vib: [4.8, 10], attackNoise: { gain: 0.15, decay: 0.06, type: 'bp', freq: 1500, q: 1 } },
  { id: 'contra', name: 'Contrabass', cat: 'Strings', osc: [['sawtooth', -4, 0.4, 0], ['sawtooth', 4, 0.4, 0], ['triangle', 0, 0.4, -1]], env: [0.2, 0.35, 0.85, 0.4], filter: { type: 'lowpass', freq: 900, q: 0.7, amt: 500, decay: 0.3 }, gain: 0.85, vib: [4.5, 8], attackNoise: { gain: 0.2, decay: 0.05, type: 'bp', freq: 800, q: 1 } },
  { id: 'orch', name: 'Orchestral Strings', cat: 'Strings', osc: [['sawtooth', -12, 0.25, 0], ['sawtooth', -4, 0.25, 0], ['sawtooth', 4, 0.25, 0], ['sawtooth', 12, 0.25, 0]], env: [0.4, 0.4, 0.85, 0.6], filter: { type: 'lowpass', freq: 2800, q: 0.6, amt: 1000, decay: 0.4 }, gain: 0.55, vib: [5.2, 7] },
  { id: 'tremstr', name: 'Tremolo Strings', cat: 'Strings', osc: [['sawtooth', -8, 0.3, 0], ['sawtooth', 8, 0.3, 0], ['sawtooth', 0, 0.2, 0]], env: [0.3, 0.3, 0.85, 0.4], filter: { type: 'lowpass', freq: 2400, q: 0.6 }, gain: 0.55, vib: [4.5, 8], trem: [9, 0.35] },
  { id: 'stacc', name: 'Staccato Strings', cat: 'Strings', osc: [['sawtooth', -6, 0.35, 0], ['sawtooth', 6, 0.35, 0], ['triangle', 0, 0.2, -1]], env: [0.02, 0.22, 0.2, 0.1], filter: { type: 'lowpass', freq: 2600, q: 0.7, amt: 1200, decay: 0.1 }, gain: 0.7 },
  { id: 'slowstr', name: 'Slow Strings', cat: 'Strings', osc: [['sawtooth', -10, 0.3, 0], ['sawtooth', 0, 0.3, 0], ['sawtooth', 10, 0.3, 0]], env: [0.85, 0.5, 0.85, 1.2], filter: { type: 'lowpass', freq: 2000, q: 0.5 }, gain: 0.5, vib: [4, 5] },
  { id: 'fiddle', name: 'Fiddle', cat: 'Strings', osc: [['sawtooth', -6, 0.3, 0], ['sawtooth', 6, 0.3, 0], ['square', 0, 0.1, 0]], env: [0.06, 0.3, 0.9, 0.2], filter: { type: 'bandpass', freq: 2200, q: 0.9, amt: 1500, decay: 0.2 }, gain: 0.6, vib: [6.5, 18], attackNoise: { gain: 0.12, decay: 0.03, type: 'bp', freq: 3200, q: 1 } },
  // ---- Brass ----
  { id: 'trumpet', name: 'Trumpet', cat: 'Brass', osc: [['sawtooth', -3, 0.5, 0], ['sawtooth', 3, 0.5, 0], ['square', 0, 0.1, 0]], env: [0.03, 0.15, 0.9, 0.12], filter: { type: 'lowpass', freq: 1500, q: 0.8, amt: 3200, decay: 0.18 }, gain: 0.6, drive: 1.2, pitchEnv: [-0.5, 0.06], vib: [5.5, 6] },
  { id: 'trombone', name: 'Trombone', cat: 'Brass', osc: [['sawtooth', -4, 0.5, 0], ['sawtooth', 4, 0.5, 0], ['triangle', 0, 0.3, -1]], env: [0.06, 0.2, 0.9, 0.15], filter: { type: 'lowpass', freq: 1100, q: 1, amt: 2400, decay: 0.25 }, gain: 0.6, pitchEnv: [-1, 0.1], vib: [5, 5] },
  { id: 'fhorn', name: 'French Horn', cat: 'Brass', osc: [['sawtooth', -5, 0.4, 0], ['sawtooth', 5, 0.4, 0], ['sine', 0, 0.4, -1]], env: [0.14, 0.3, 0.9, 0.3], filter: { type: 'lowpass', freq: 1200, q: 0.9, amt: 1000, decay: 0.3 }, gain: 0.6, vib: [4.8, 8] },
  { id: 'tuba', name: 'Tuba', cat: 'Brass', osc: [['sine', 0, 0.6, -1], ['sawtooth', 0, 0.3, -1], ['triangle', 0, 0.3, 0]], env: [0.1, 0.25, 0.9, 0.25], filter: { type: 'lowpass', freq: 900, q: 0.8, amt: 500, decay: 0.25 }, gain: 0.9 },
  { id: 'brassstab', name: 'Brass Stabs', cat: 'Brass', osc: [['sawtooth', -5, 0.5, 0], ['sawtooth', 5, 0.5, 0], ['square', 0, 0.2, -1]], env: [0.005, 0.25, 0.1, 0.15], filter: { type: 'lowpass', freq: 1600, q: 1.5, amt: 3500, decay: 0.12 }, gain: 0.6, drive: 1.4 },
  { id: 'synbrass', name: 'Synth Brass', cat: 'Brass', osc: [['sawtooth', -8, 0.4, 0], ['sawtooth', 8, 0.4, 0], ['square', 0, 0.25, -1]], env: [0.07, 0.35, 0.8, 0.2], filter: { type: 'lowpass', freq: 900, q: 2, amt: 3800, decay: 0.3 }, gain: 0.6, pitchEnv: [-0.3, 0.05] },
  { id: 'mutedtrp', name: 'Muted Trumpet', cat: 'Brass', osc: [['sawtooth', -3, 0.5, 0], ['sawtooth', 3, 0.5, 0]], env: [0.04, 0.2, 0.85, 0.15], filter: { type: 'bandpass', freq: 1400, q: 2.2, amt: 900, decay: 0.15 }, gain: 0.6, vib: [5.5, 5] },
  // ---- Winds ----
  { id: 'clarinet', name: 'Clarinet', cat: 'Winds', osc: [['square', 0, 0.5, 0], ['sine', 0, 0.3, 0], ['triangle', 0, 0.2, 1]], env: [0.04, 0.1, 0.9, 0.12], filter: { type: 'lowpass', freq: 2200, q: 0.6, amt: 800, decay: 0.15 }, gain: 0.65, vib: [5, 6], breath: 0.015 },
  { id: 'oboe', name: 'Oboe', cat: 'Winds', osc: [['sawtooth', 0, 0.45, 0], ['sawtooth', 0, 0.25, 1], ['sine', 0, 0.2, 0]], env: [0.05, 0.12, 0.9, 0.12], filter: { type: 'bandpass', freq: 1600, q: 1.5, amt: 800, decay: 0.15 }, gain: 0.6, vib: [5.5, 8], breath: 0.01 },
  { id: 'altosax', name: 'Alto Sax', cat: 'Winds', osc: [['sawtooth', 0, 0.45, 0], ['square', 0, 0.2, 0], ['sine', 0, 0.2, -1]], env: [0.06, 0.15, 0.9, 0.15], filter: { type: 'lowpass', freq: 1700, q: 1, amt: 1800, decay: 0.2 }, gain: 0.65, pitchEnv: [-0.7, 0.1], vib: [5, 6], breath: 0.02 },
  { id: 'tenorsax', name: 'Tenor Sax', cat: 'Winds', osc: [['sawtooth', 0, 0.4, 0], ['square', 0, 0.2, 0], ['sine', 0, 0.3, -1]], env: [0.07, 0.18, 0.9, 0.18], filter: { type: 'lowpass', freq: 1300, q: 1.1, amt: 1500, decay: 0.25 }, gain: 0.65, pitchEnv: [-0.8, 0.12], vib: [4.8, 7], breath: 0.025 },
  { id: 'panflute', name: 'Pan Flute', cat: 'Winds', osc: [['sine', 0, 0.8, 0], ['triangle', 0, 0.2, 1]], env: [0.12, 0.2, 0.85, 0.3], filter: { type: 'lowpass', freq: 4000, q: 0.4 }, gain: 0.8, vib: [5, 10], breath: 0.04 },
  { id: 'recorder', name: 'Recorder', cat: 'Winds', osc: [['sine', 0, 0.7, 0], ['sine', 0, 0.3, 1], ['triangle', 0, 0.1, 2]], env: [0.04, 0.1, 0.9, 0.1], filter: { type: 'lowpass', freq: 5000, q: 0.5 }, gain: 0.75, vib: [5, 4], breath: 0.05 },
  { id: 'whistle', name: 'Whistle', cat: 'Winds', osc: [['sine', 0, 0.9, 1]], env: [0.05, 0.1, 0.95, 0.12], filter: { type: 'lowpass', freq: 6000, q: 0.3 }, gain: 0.6, vib: [6, 25], breath: 0.04 },
  { id: 'bassoon', name: 'Bassoon', cat: 'Winds', osc: [['sawtooth', 0, 0.35, 0], ['square', 0, 0.25, -1], ['sine', 0, 0.2, -1]], env: [0.08, 0.15, 0.9, 0.15], filter: { type: 'bandpass', freq: 900, q: 1.2, amt: 500, decay: 0.2 }, gain: 0.75, vib: [5, 6], breath: 0.01 },
  { id: 'ocarina', name: 'Ocarina', cat: 'Winds', osc: [['sine', 0, 0.8, 0], ['triangle', 0, 0.2, 1]], fm: { ratio: 2, index: 0.15, decay: 0.3, end: 0.3 }, env: [0.05, 0.1, 0.9, 0.2], filter: { type: 'lowpass', freq: 2800, q: 0.6 }, gain: 0.85, vib: [5.5, 12], breath: 0.02 },
  { id: 'shaku', name: 'Shakuhachi', cat: 'Winds', osc: [['sine', 0, 0.7, 0], ['sine', 1, 0.25, 1], ['triangle', 0, 0.15, 0]], env: [0.2, 0.3, 0.9, 0.3], filter: { type: 'bandpass', freq: 2000, q: 0.6 }, gain: 0.8, pitchEnv: [-0.5, 0.15], vib: [4, 14], breath: 0.08 },
  // ---- Leads ----
  { id: 'synclead', name: 'Sync Lead', cat: 'Leads', osc: [['sawtooth', 0, 0.45, 0], ['sawtooth', -7, 0.3, 1]], fm: { ratio: 1.5, index: 1.2, decay: 0.25, end: 0.3 }, env: [0.005, 0.3, 0.8, 0.2], filter: { type: 'lowpass', freq: 3800, q: 2.5, amt: 3000, decay: 0.25 }, gain: 0.55, vib: [5.5, 4] },
  { id: 'trancepluck', name: 'Trance Pluck', cat: 'Leads', osc: [['sawtooth', -8, 0.4, 0], ['sawtooth', 8, 0.4, 0], ['square', 0, 0.2, 1]], env: [0.001, 0.4, 0, 0.12], filter: { type: 'lowpass', freq: 500, q: 4, amt: 6000, decay: 0.3 }, gain: 0.6 },
  { id: 'laser', name: 'Laser Lead', cat: 'Leads', osc: [['square', 0, 0.5, 0]], pitchEnv: [12, 0.15], env: [0.001, 0.4, 0.5, 0.2], filter: { type: 'lowpass', freq: 8000, q: 0.5 }, gain: 0.45 },
  { id: 'hoover', name: 'Hoover', cat: 'Leads', osc: [['sawtooth', 0, 0.4, 0]], unison: { voices: 5, spread: 18, type: 'sawtooth' }, pitchEnv: [5, 0.3], env: [0.05, 0.6, 0.85, 0.3], filter: { type: 'lowpass', freq: 3800, q: 0.8 }, gain: 0.65 },
  { id: 'detune', name: 'Detuned Saw Lead', cat: 'Leads', osc: [['sawtooth', -15, 0.3, 0], ['sawtooth', -5, 0.3, 0], ['sawtooth', 5, 0.3, 0], ['sawtooth', 15, 0.3, 0]], env: [0.02, 0.3, 0.8, 0.25], filter: { type: 'lowpass', freq: 3200, q: 1, amt: 1200, decay: 0.3 }, gain: 0.5, vib: [5, 6] },
  { id: 'mono', name: 'Mono Portamento', cat: 'Leads', osc: [['sawtooth', 0, 0.5, 0], ['square', 3, 0.3, 0]], glide: 0.12, env: [0.005, 0.2, 0.85, 0.15], filter: { type: 'lowpass', freq: 2200, q: 1.2, amt: 1400, decay: 0.2 }, gain: 0.6, vib: [5, 4] },
  { id: 'pulse', name: 'Pulse Lead', cat: 'Leads', osc: [['square', 0, 0.6, 0], ['triangle', 0, 0.2, 1]], env: [0.01, 0.2, 0.8, 0.2], filter: { type: 'lowpass', freq: 4000, q: 1, amt: 1500, decay: 0.2 }, gain: 0.5, vib: [5.5, 6] },
  { id: 'acidlead', name: 'Acid Lead', cat: 'Leads', osc: [['sawtooth', 0, 0.7, 0]], env: [0.002, 0.25, 0.4, 0.1], filter: { type: 'lowpass', freq: 400, q: 14, amt: 4000, decay: 0.25 }, gain: 0.5, drive: 1.5 },
  { id: 'vocoder', name: 'Vocoder Voice', cat: 'Leads', osc: [['sawtooth', 0, 0.6, 0], ['sawtooth', 7, 0.3, 0]], env: [0.03, 0.2, 0.85, 0.2], filter: { type: 'bandpass', freq: 1300, q: 2.5 }, lfoFilter: [4.5, 350], gain: 0.6, vib: [5, 8] },
  { id: 'screamer', name: 'Screamer', cat: 'Leads', osc: [['sawtooth', -10, 0.4, 0], ['sawtooth', 10, 0.4, 0], ['square', 0, 0.2, 1]], env: [0.005, 0.3, 0.85, 0.2], filter: { type: 'lowpass', freq: 2800, q: 2, amt: 2000, decay: 0.3 }, gain: 0.45, drive: 2.6, vib: [6, 9] },
  // ---- Pads ----
  { id: 'darkpad', name: 'Dark Pad', cat: 'Pads', osc: [['sawtooth', -10, 0.3, 0], ['sawtooth', 10, 0.3, 0], ['triangle', 0, 0.4, -1]], env: [0.8, 0.6, 0.8, 1.4], filter: { type: 'lowpass', freq: 900, q: 1.1, amt: 500, decay: 1.0 }, lfoFilter: [0.2, 200], gain: 0.55 },
  { id: 'sweeppad', name: 'Sweep Pad', cat: 'Pads', osc: [['sawtooth', -8, 0.3, 0], ['sawtooth', 8, 0.3, 0], ['sawtooth', 0, 0.3, 0]], env: [0.9, 0.5, 0.85, 1.4], filter: { type: 'lowpass', freq: 900, q: 2.5 }, lfoFilter: [0.25, 1000], gain: 0.45 },
  { id: 'choiroo', name: 'Choir Oohs', cat: 'Pads', osc: [['sawtooth', -5, 0.3, 0], ['triangle', 5, 0.4, 0], ['sine', 0, 0.3, 1]], env: [0.5, 0.4, 0.85, 0.9], filter: { type: 'bandpass', freq: 500, q: 3 }, gain: 0.9, vib: [5, 8] },
  { id: 'spacevoice', name: 'Space Voice', cat: 'Pads', osc: [['sine', 0, 0.7, 0], ['sine', 0, 0.4, 1]], fm: { ratio: 2, index: 0.5, decay: 1.5, end: 0.2 }, env: [0.9, 0.8, 0.75, 1.5], filter: { type: 'bandpass', freq: 1500, q: 1 }, lfoFilter: [0.3, 500], gain: 0.7, vib: [4, 15] },
  { id: 'bowedpad', name: 'Bowed Pad', cat: 'Pads', osc: [['sawtooth', -4, 0.3, 0], ['sawtooth', 4, 0.3, 0], ['sine', 0, 0.2, -1]], env: [0.7, 0.4, 0.9, 1.0], filter: { type: 'lowpass', freq: 1800, q: 1.2, amt: 800, decay: 0.6 }, gain: 0.55, vib: [4.5, 6], attackNoise: { gain: 0.08, decay: 0.4, type: 'bp', freq: 1500, q: 1 } },
  { id: 'warmstrpad', name: 'Warm Strings Pad', cat: 'Pads', osc: [['sawtooth', -10, 0.25, 0], ['sawtooth', 0, 0.3, 0], ['sawtooth', 10, 0.25, 0], ['triangle', 0, 0.25, -1]], env: [0.6, 0.5, 0.85, 1.0], filter: { type: 'lowpass', freq: 1500, q: 0.6, amt: 600, decay: 0.5 }, gain: 0.55, vib: [4.5, 7] },
  { id: 'evolve', name: 'Evolving Pad', cat: 'Pads', osc: [['sawtooth', -7, 0.3, 0], ['sawtooth', 7, 0.3, 0], ['square', 0, 0.15, -1]], env: [0.85, 0.6, 0.8, 1.2], filter: { type: 'lowpass', freq: 1200, q: 1.5 }, lfoFilter: [0.15, 900], gain: 0.5, vib: [3, 6] },
  { id: 'icepad', name: 'Ice Pad', cat: 'Pads', osc: [['sine', 0, 0.5, 0], ['sine', 7, 0.4, 1], ['triangle', -7, 0.3, 2]], fm: { ratio: 3.5, index: 0.8, decay: 2, end: 0.4 }, env: [0.9, 0.8, 0.8, 1.8], filter: { type: 'lowpass', freq: 6000, q: 0.5 }, gain: 0.65, vib: [2.5, 3] },
  { id: 'drone', name: 'Ambient Drone', cat: 'Pads', osc: [['sine', 0, 0.7, 0], ['sine', 0.5, 0.5, 0], ['sine', -0.5, 0.5, 0], ['sine', 0, 0.25, -1]], env: [0.9, 0.5, 0.9, 1.8], filter: { type: 'lowpass', freq: 1000, q: 0.5 }, lfoFilter: [0.1, 300], gain: 0.65 },
  // ---- Mallets ----
  { id: 'vibes', name: 'Vibraphone', cat: 'Mallets', osc: [['sine', 0, 0.9, 0], ['sine', 0, 0.15, 2]], env: [0.003, 2.0, 0, 0.5], filter: { type: 'lowpass', freq: 5000, q: 0.5 }, gain: 0.9, trem: [5.5, 0.18] },
  { id: 'xylo', name: 'Xylophone', cat: 'Mallets', osc: [['sine', 0, 0.9, 0], ['sine', 0, 0.3, 1.98]], env: [0.001, 0.25, 0, 0.1], filter: { type: 'lowpass', freq: 6000, q: 0.6 }, gain: 1, attackNoise: { gain: 0.3, decay: 0.006, type: 'hp', freq: 4000 } },
  { id: 'glock', name: 'Glockenspiel', cat: 'Mallets', osc: [['sine', 0, 0.8, 0], ['sine', 0, 0.3, 1.46]], fm: { ratio: 3.5, index: 0.8, decay: 0.5, end: 0.05 }, env: [0.002, 1.8, 0, 0.6], filter: { type: 'lowpass', freq: 9000, q: 0.3 }, gain: 0.8 },
  { id: 'kalimba', name: 'Kalimba', cat: 'Mallets', osc: [['sine', 0, 0.9, 0], ['sine', 0, 0.15, 1]], fm: { ratio: 14, index: 3, decay: 0.2, end: 0.05 }, env: [0.002, 1.2, 0, 0.3], filter: { type: 'lowpass', freq: 3500, q: 0.5 }, gain: 0.9, attackNoise: { gain: 0.15, decay: 0.004, type: 'hp', freq: 4000 } },
  { id: 'steeldrum', name: 'Steel Drum', cat: 'Mallets', osc: [['sine', 0, 0.8, 0], ['sine', 0, 0.35, 1], ['triangle', 0, 0.15, 2.02]], fm: { ratio: 2, index: 0.3, decay: 0.15, end: 0.2 }, env: [0.002, 1.0, 0, 0.4], filter: { type: 'lowpass', freq: 5000, q: 0.5 }, gain: 0.8 },
  { id: 'musicbox', name: 'Music Box', cat: 'Mallets', osc: [['sine', 0, 0.9, 0], ['sine', 0, 0.3, 2]], fm: { ratio: 6, index: 1.5, decay: 0.6, end: 0.1 }, env: [0.002, 1.6, 0, 0.5], filter: { type: 'lowpass', freq: 7000, q: 0.5 }, gain: 0.75, attackNoise: { gain: 0.2, decay: 0.004, type: 'hp', freq: 5000 } },
  { id: 'tubular', name: 'Tubular Bells', cat: 'Mallets', osc: [['sine', 0, 0.8, 0], ['sine', 0, 0.25, 1.6]], fm: { ratio: 3.5, index: 2.5, decay: 2.5, end: 0.2 }, env: [0.003, 3.0, 0, 1.2], filter: { type: 'lowpass', freq: 6000, q: 0.4 }, gain: 0.8 },
  { id: 'timpani', name: 'Timpani', cat: 'Mallets', osc: [['sine', 0, 0.9, 0], ['sine', 0, 0.3, 0.585], ['sine', 0, 0.15, 1]], pitchEnv: [5, 0.1], env: [0.003, 1.2, 0, 0.5], filter: { type: 'lowpass', freq: 1400, q: 0.6 }, gain: 0.9, drive: 1.3 },
  { id: 'gong', name: 'Gong', cat: 'Mallets', osc: [['sine', 0, 0.8, 0], ['sine', 0, 0.3, 0.5]], fm: { ratio: 1.41, index: 3, decay: 2.5, end: 0.4 }, env: [0.02, 3.0, 0, 1.5], filter: { type: 'lowpass', freq: 3200, q: 0.6 }, gain: 0.6, attackNoise: { gain: 0.6, decay: 0.15, type: 'bp', freq: 800, q: 1 } },
  { id: 'handpan', name: 'Handpan', cat: 'Mallets', osc: [['sine', 0, 0.8, 0], ['sine', 0, 0.3, 1], ['sine', 2, 0.3, 0], ['triangle', 0, 0.1, 2]], fm: { ratio: 2, index: 0.2, decay: 0.5, end: 0.3 }, env: [0.003, 2.2, 0, 0.8], filter: { type: 'lowpass', freq: 3000, q: 0.4 }, gain: 0.75 },
  // ---- Synth FX ----
  { id: 'riser', name: 'Riser', cat: 'Synth FX', osc: [['sawtooth', 0, 0.4, 0], ['sawtooth', 7, 0.3, 0], ['sine', 0, 0.2, 1]], pitchEnv: [-12, 1.0], env: [0.85, 0.2, 1, 0.2], filter: { type: 'lowpass', freq: 4000, q: 1 }, gain: 0.5 },
  { id: 'downlift', name: 'Downlifter', cat: 'Synth FX', osc: [['sawtooth', 0, 0.4, 0], ['sawtooth', -7, 0.3, 0]], pitchEnv: [12, 1.0], env: [0.02, 1.0, 0, 0.3], filter: { type: 'lowpass', freq: 3000, q: 1 }, gain: 0.5 },
  { id: 'noisesweep', name: 'Noise Sweep', cat: 'Synth FX', osc: [['sawtooth', 0, 0.25, 0]], env: [0.3, 1.0, 0.6, 0.3], filter: { type: 'bandpass', freq: 1400, q: 4 }, lfoFilter: [0.6, 1000], gain: 0.5, attackNoise: { gain: 0.9, decay: 0.8, type: 'bp', freq: 3000, q: 0.7 } },
  { id: 'zap', name: 'Zap', cat: 'Synth FX', osc: [['square', 0, 0.5, 0], ['sawtooth', 0, 0.3, 0]], pitchEnv: [24, 0.12], env: [0.001, 0.2, 0, 0.05], filter: { type: 'lowpass', freq: 6000, q: 2 }, gain: 0.45, drive: 1.5 },
  { id: 'bubble', name: 'Bubble', cat: 'Synth FX', osc: [['sine', 0, 0.9, 0]], pitchEnv: [-12, 0.08], env: [0.002, 0.25, 0, 0.1], filter: { type: 'lowpass', freq: 4000, q: 0.5 }, gain: 0.6, vib: [18, 25] },
  { id: 'radio', name: 'Radio Static Pad', cat: 'Synth FX', osc: [['sawtooth', 0, 0.15, 0], ['sine', 0, 0.2, 1]], env: [0.3, 1.2, 0.6, 0.5], filter: { type: 'bandpass', freq: 1800, q: 2.5 }, gain: 0.6, attackNoise: { gain: 0.9, decay: 1.2, type: 'bp', freq: 2500, q: 0.6 } },
  { id: 'windpad', name: 'Wind Pad', cat: 'Synth FX', osc: [['sawtooth', 0, 0.3, 0], ['triangle', 0, 0.2, -1]], env: [0.85, 0.6, 0.7, 1.2], filter: { type: 'lowpass', freq: 1200, q: 1.2 }, lfoFilter: [0.2, 600], gain: 0.5, attackNoise: { gain: 0.5, decay: 1.5, type: 'bp', freq: 1000, q: 0.8 } },
  { id: 'subdrop', name: 'Sub Drop', cat: 'Synth FX', osc: [['sine', 0, 1, 0]], pitchEnv: [12, 0.9], env: [0.003, 1.2, 0, 0.4], filter: { type: 'lowpass', freq: 800, q: 0.3 }, gain: 1 },
];
export const INST_BY_ID = Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i]));

// ---- Custom instrument registry ----
// Custom definitions (ids start with 'u_') are validated by sanitizeInstrument() before they reach the audio graph.
export const OSC_TYPES = ['sine', 'square', 'sawtooth', 'triangle'];
export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch'];
export const NOISE_TYPES = ['bp', 'hp', 'lp'];
const CUSTOM = new Map();
const CUSTOM_ID = /^u_[\w-]{3,48}$/;
const numOr = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
const pairOr = (v, lo1, hi1, lo2, hi2) => (Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? [clamp(v[0], lo1, hi1), clamp(v[1], lo2, hi2)] : null);
export const isBuiltinInstrument = (id) => Object.prototype.hasOwnProperty.call(INST_BY_ID, id);

// Returns a safe copy of an instrument definition: every number is finite and in range (NaN falls back to the default),
// unknown enum values fall back to sensible types, and at most 4 oscillator layers are kept.
// Returns null when the input is not an object at all.
export function sanitizeInstrument(def) {
  if (!def || typeof def !== 'object' || Array.isArray(def)) return null;
  const id = typeof def.id === 'string' && CUSTOM_ID.test(def.id) ? def.id : uid('u_');
  const name = typeof def.name === 'string' && def.name.trim() ? def.name.trim().slice(0, 60) : 'Custom sound';
  const cat = typeof def.cat === 'string' && def.cat.trim() ? def.cat.trim().slice(0, 24) : 'My instruments';
  if (def.type === 'sample') {
    const out = {
      id, name, cat, type: 'sample', bufferId: typeof def.bufferId === 'string' ? def.bufferId.slice(0, 80) : '',
      rootNote: Math.round(numOr(def.rootNote, 0, 127, 60)), attack: numOr(def.attack, 0, 8, 0.005), release: numOr(def.release, 0, 8, 0.3), gain: numOr(def.gain, 0, 1.5, 1),
    };
    if (Number.isFinite(def.loopStart) && Number.isFinite(def.loopEnd) && def.loopEnd > def.loopStart) {
      out.loopStart = clamp(def.loopStart, 0, 3600); out.loopEnd = clamp(def.loopEnd, out.loopStart + 0.001, 3600);
    }
    return out;
  }
  const osc = (Array.isArray(def.osc) ? def.osc.slice(0, 4) : [])
    .filter((ly) => Array.isArray(ly))
    .map((ly) => [OSC_TYPES.includes(ly[0]) ? ly[0] : 'sine', numOr(ly[1], -100, 100, 0), numOr(ly[2], 0, 1.5, 0.5), numOr(ly[3], -6, 6, 0)]);
  if (!osc.length) osc.push(['sine', 0, 0.8, 0]);
  const e = Array.isArray(def.env) ? def.env : [];
  const out = {
    id, name, cat, type: 'synth', osc,
    env: [numOr(e[0], 0, 8, 0.01), numOr(e[1], 0, 8, 0.3), numOr(e[2], 0, 1, 0.8), numOr(e[3], 0, 8, 0.3)],
    gain: numOr(def.gain, 0, 1.5, 0.8),
  };
  const f = def.filter;
  if (f && typeof f === 'object') out.filter = {
    type: FILTER_TYPES.includes(f.type) ? f.type : 'lowpass', freq: numOr(f.freq, 40, 18000, 2000), q: numOr(f.q, 0.1, 20, 0.7),
    track: numOr(f.track, 0, 2, 0), amt: numOr(f.amt, 0, 18000, 0), decay: numOr(f.decay, 0.01, 8, 0.2),
  };
  const vib = pairOr(def.vib, 0, 30, 0, 100); if (vib && vib[1] > 0) out.vib = vib;
  const trem = pairOr(def.trem, 0, 30, 0, 1); if (trem && trem[1] > 0) out.trem = trem;
  const drive = numOr(def.drive, 0, 10, 0); if (drive > 0) out.drive = drive;
  const glide = numOr(def.glide, 0, 2, 0); if (glide > 0) out.glide = glide;
  const breath = numOr(def.breath, 0, 0.2, 0); if (breath > 0) out.breath = breath;
  const pe = pairOr(def.pitchEnv, -24, 24, 0, 4); if (pe && pe[0] !== 0) out.pitchEnv = pe;
  const lfo = pairOr(def.lfoFilter, 0, 30, 0, 8000); if (lfo && lfo[1] > 0) out.lfoFilter = lfo;
  if (def.fm && typeof def.fm === 'object') {
    const fm = { ratio: numOr(def.fm.ratio, 0.05, 32, 1), index: numOr(def.fm.index, 0, 10, 0), decay: numOr(def.fm.decay, 0.01, 8, 0.5), end: numOr(def.fm.end, 0, 1, 0.1) };
    if (fm.index > 0) out.fm = fm;
  }
  if (def.attackNoise && typeof def.attackNoise === 'object') {
    const an = def.attackNoise, g = numOr(an.gain, 0, 1.5, 0);
    if (g > 0) out.attackNoise = { gain: g, decay: numOr(an.decay, 0.001, 3, 0.03), type: NOISE_TYPES.includes(an.type) ? an.type : 'bp', freq: numOr(an.freq, 40, 18000, 2000), q: numOr(an.q, 0.1, 20, 1) };
  }
  if (def.unison && typeof def.unison === 'object') {
    const voices = Math.round(numOr(def.unison.voices, 1, 5, 1));
    if (voices > 1) out.unison = { voices, spread: numOr(def.unison.spread, 0, 50, 8), ...(OSC_TYPES.includes(def.unison.type) ? { type: def.unison.type } : {}) };
  }
  return out;
}

export function registerInstrument(def) { const clean = sanitizeInstrument(def); if (clean) CUSTOM.set(clean.id, clean); return clean; }
export function unregisterInstrument(id) { CUSTOM.delete(id); }
export function getCustomInstrument(id) { return CUSTOM.get(id) || null; }
export function listCustomInstruments() { return [...CUSTOM.values()]; }
// Replaces the whole custom set (used when the library or the open project changes). Defs must already be sanitized.
export function setCustomInstruments(defs) { CUSTOM.clear(); for (const d of defs) if (d?.id) CUSTOM.set(d.id, d); }
// Custom first, then built-ins, then Grand Piano for unknown ids (so a missing instrument never silences a track).
export function getInstrument(id) { return CUSTOM.get(id) || (isBuiltinInstrument(id) ? INST_BY_ID[id] : INST_BY_ID.grand); }

// ---- Drum kits ----
export const DRUM_MAP = [
  { note: 36, name: 'Kick', key: 'kick' }, { note: 38, name: 'Snare', key: 'snare' }, { note: 39, name: 'Clap', key: 'clap' }, { note: 37, name: 'Rim', key: 'rim' },
  { note: 42, name: 'Closed Hat', key: 'chh' }, { note: 46, name: 'Open Hat', key: 'ohh' }, { note: 41, name: 'Low Tom', key: 'tomL' }, { note: 45, name: 'Mid Tom', key: 'tomM' },
  { note: 48, name: 'High Tom', key: 'tomH' }, { note: 49, name: 'Crash', key: 'crash' }, { note: 51, name: 'Ride', key: 'ride' }, { note: 56, name: 'Cowbell', key: 'cow' }, { note: 70, name: 'Shaker', key: 'shk' },
];
const NOTE_TO_KEY = Object.fromEntries(DRUM_MAP.map((d) => [d.note, d.key]));
export const KITS = [
  { id: '808', name: '808 Classic', kick: { f0: 160, f1: 42, d: 0.9, click: 0.2, drive: 0.4 }, snare: { f: 190, tone: 0.5, noise: 0.8, d: 0.22, hp: 1500 }, hat: { hp: 7500, d: 0.05, od: 0.35 }, clap: { d: 0.25 }, tom: 1, crash: 1.2 },
  { id: 'acoustic', name: 'Studio Acoustic', kick: { f0: 130, f1: 55, d: 0.32, click: 0.6, drive: 0.15 }, snare: { f: 220, tone: 0.55, noise: 1, d: 0.2, hp: 1800 }, hat: { hp: 8000, d: 0.04, od: 0.28 }, clap: { d: 0.18 }, tom: 1.4, crash: 1.6 },
  { id: 'trap', name: 'Trap Kit', kick: { f0: 190, f1: 38, d: 1.4, click: 0.1, drive: 0.7 }, snare: { f: 200, tone: 0.2, noise: 0.9, d: 0.16, hp: 2500 }, hat: { hp: 9500, d: 0.03, od: 0.2 }, clap: { d: 0.2 }, tom: 0.8, crash: 0.9 },
  { id: 'lofi', name: 'Lo-Fi Dust', kick: { f0: 120, f1: 50, d: 0.4, click: 0.1, drive: 0.5 }, snare: { f: 180, tone: 0.6, noise: 0.6, d: 0.19, hp: 1200 }, hat: { hp: 6000, d: 0.045, od: 0.25 }, clap: { d: 0.2 }, tom: 1, crash: 1, lp: 6500 },
  { id: 'house', name: 'House Machine', kick: { f0: 170, f1: 48, d: 0.45, click: 0.5, drive: 0.5 }, snare: { f: 210, tone: 0.3, noise: 1, d: 0.2, hp: 2200 }, hat: { hp: 8500, d: 0.045, od: 0.4 }, clap: { d: 0.3 }, tom: 1.2, crash: 1.4 },
  { id: 'rock', name: 'Rock', kick: { f0: 110, f1: 50, d: 0.5, click: 0.8, drive: 0.25 }, snare: { f: 200, tone: 0.7, noise: 0.9, d: 0.25, hp: 1400 }, hat: { hp: 6000, d: 0.05, od: 0.3 }, clap: { d: 0.15 }, tom: 1.3, crash: 1.8 },
  { id: 'jazz', name: 'Jazz', kick: { f0: 100, f1: 50, d: 0.25, click: 0.25, drive: 0.05 }, snare: { f: 240, tone: 0.4, noise: 0.5, d: 0.12, hp: 2500 }, hat: { hp: 9000, d: 0.03, od: 0.22 }, clap: { d: 0.12 }, tom: 1.5, crash: 1.2 },
  { id: 'techno', name: 'Techno', kick: { f0: 150, f1: 45, d: 0.5, click: 0.7, drive: 0.6 }, snare: { f: 190, tone: 0.3, noise: 0.8, d: 0.14, hp: 2000 }, hat: { hp: 9000, d: 0.03, od: 0.5 }, clap: { d: 0.3 }, tom: 0.9, crash: 1.0 },
  { id: '909', name: '909', kick: { f0: 180, f1: 50, d: 0.6, click: 0.4, drive: 0.7 }, snare: { f: 230, tone: 0.7, noise: 0.7, d: 0.18, hp: 1600 }, hat: { hp: 9500, d: 0.05, od: 0.45 }, clap: { d: 0.3 }, tom: 1.1, crash: 1.1 },
  { id: 'boombap', name: 'Boom Bap', kick: { f0: 110, f1: 45, d: 0.35, click: 0.9, drive: 0.3 }, snare: { f: 200, tone: 0.5, noise: 0.7, d: 0.18, hp: 1300 }, hat: { hp: 7000, d: 0.04, od: 0.3 }, clap: { d: 0.2 }, tom: 1, crash: 1, lp: 7500 },
  { id: 'dubstep', name: 'Dubstep', kick: { f0: 140, f1: 35, d: 1.2, click: 0.3, drive: 0.9 }, snare: { f: 170, tone: 0.6, noise: 0.9, d: 0.3, hp: 1200 }, hat: { hp: 8000, d: 0.04, od: 0.25 }, clap: { d: 0.3 }, tom: 0.7, crash: 1.3, lp: 9000 },
  { id: 'afro', name: 'Afro Latin', kick: { f0: 150, f1: 60, d: 0.25, click: 0.6, drive: 0.1 }, snare: { f: 280, tone: 0.8, noise: 0.5, d: 0.1, hp: 3000 }, hat: { hp: 9000, d: 0.03, od: 0.3 }, clap: { d: 0.12 }, tom: 1.6, crash: 1.0 },
  { id: 'electro', name: 'Electro', kick: { f0: 200, f1: 50, d: 0.4, click: 0.8, drive: 0.4 }, snare: { f: 260, tone: 0.9, noise: 0.6, d: 0.15, hp: 2800 }, hat: { hp: 8000, d: 0.035, od: 0.4 }, clap: { d: 0.25 }, tom: 1.2, crash: 1.2 },
  { id: 'traphard', name: 'Trap Hard', kick: { f0: 200, f1: 34, d: 1.6, click: 0.15, drive: 0.95 }, snare: { f: 210, tone: 0.15, noise: 1, d: 0.14, hp: 3000 }, hat: { hp: 10000, d: 0.025, od: 0.3 }, clap: { d: 0.18 }, tom: 0.7, crash: 0.8 },
  { id: 'brush', name: 'Brush Kit', kick: { f0: 110, f1: 55, d: 0.3, click: 0.3, drive: 0.05 }, snare: { f: 200, tone: 0.2, noise: 0.45, d: 0.32, hp: 1200 }, hat: { hp: 7000, d: 0.09, od: 0.18 }, clap: { d: 0.3 }, tom: 1, crash: 1.5 },
];
export const KIT_BY_ID = Object.fromEntries(KITS.map((k) => [k.id, k]));

const noiseCache = new WeakMap();
export function noiseBuf(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) { b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; noiseCache.set(ctx, b); }
  return b;
}
function noise(ctx, out, t, dur, { hp = 0, lp = 0, bp = 0, q = 1, gain = 1, a = 0.001, shape = 3 } = {}) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf(ctx); s.loop = true;
  const g = ctx.createGain(); let node = s;
  const chain = [];
  if (hp) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; chain.push(f); }
  if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; chain.push(f); }
  if (bp) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = bp; f.Q.value = q; chain.push(f); }
  for (const f of chain) { node.connect(f); node = f; }
  node.connect(g); g.connect(out);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + a);
  g.gain.setTargetAtTime(0, t + a, dur / shape);
  s.start(t, Math.random()); s.stop(t + dur * 1.6 + 0.05);
  return { s, nodes: [...chain, g] };
}
function tone(ctx, out, t, f0, f1, dur, gain, type = 'sine', drive = 0) {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + Math.min(dur * 0.35, 0.12));
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.002); g.gain.setTargetAtTime(0, t + 0.002, dur / 4);
  let node = o;
  if (drive) { const ws = ctx.createWaveShaper(); const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = (i / 511.5) - 1; c[i] = Math.tanh(x * (1 + drive * 3)); } ws.curve = c; o.connect(ws); node = ws; }
  node.connect(g); g.connect(out); o.start(t); o.stop(t + dur * 1.6 + 0.05);
}

export function playDrum(ctx, out, kitId, note, t, vel = 100) {
  const k = KIT_BY_ID[kitId] || KITS[0], key = NOTE_TO_KEY[note] || nearestKey(note), v = Math.pow(vel / 127, 1.3);
  let dst = out;
  if (k.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = k.lp; f.connect(out); dst = f; setTimeout(() => f.disconnect(), 2500); }
  switch (key) {
    case 'kick': { const c = k.kick; tone(ctx, dst, t, c.f0, c.f1, c.d, 1.0 * v, 'sine', c.drive); noise(ctx, dst, t, 0.02, { hp: 1800, gain: c.click * v * 0.8, shape: 4 }); break; }
    case 'snare': { const c = k.snare; tone(ctx, dst, t, c.f * 1.3, c.f * 0.9, c.d * 0.6, c.tone * v * 0.8, 'triangle'); noise(ctx, dst, t, c.d, { hp: c.hp, gain: c.noise * v * 0.9, a: 0.001 }); break; }
    case 'clap': { for (let i = 0; i < 4; i++) noise(ctx, dst, t + i * 0.011, i === 3 ? k.clap.d : 0.03, { bp: 1500, q: 0.9, gain: 0.7 * v, shape: 3 }); break; }
    case 'rim': tone(ctx, dst, t, 520, 480, 0.05, 0.6 * v, 'square'); noise(ctx, dst, t, 0.03, { hp: 3000, gain: 0.5 * v }); break;
    case 'chh': noise(ctx, dst, t, k.hat.d, { hp: k.hat.hp, gain: k.hat.od * v, shape: 4 }); break;
    case 'ohh': noise(ctx, dst, t, k.hat.d * 6, { hp: k.hat.hp * 0.9, gain: k.hat.od * v * 0.9, shape: 3 }); break;
    case 'tomL': tone(ctx, dst, t, 150 * k.tom, 90, 0.4, 0.9 * v, 'sine', 0.2); break;
    case 'tomM': tone(ctx, dst, t, 210 * k.tom, 130, 0.35, 0.9 * v, 'sine', 0.2); break;
    case 'tomH': tone(ctx, dst, t, 290 * k.tom, 190, 0.3, 0.9 * v, 'sine', 0.2); break;
    case 'crash': noise(ctx, dst, t, 1.4 * k.crash, { hp: 4500, gain: 0.5 * v, shape: 3, a: 0.003 }); break;
    case 'ride': noise(ctx, dst, t, 0.9, { hp: 7000, gain: 0.25 * v, shape: 3 }); tone(ctx, dst, t, 5200, 5200, 0.5, 0.06 * v, 'square'); break;
    case 'cow': tone(ctx, dst, t, 800, 780, 0.18, 0.4 * v, 'square'); tone(ctx, dst, t, 540, 530, 0.2, 0.4 * v, 'square'); break;
    case 'shk': noise(ctx, dst, t, 0.07, { hp: 6500, gain: 0.35 * v, a: 0.02, shape: 3 }); break;
  }
}
function nearestKey(note) { let best = DRUM_MAP[0], bd = 99; for (const d of DRUM_MAP) if (Math.abs(d.note - note) < bd) { bd = Math.abs(d.note - note); best = d; } return best.key; }

// ---- Synth voice ----
// Returns { release(time) } and schedules everything on the audio clock.
// Optional instrument fields (all backwards compatible):
//   fm:          { ratio, index, decay, end }  sine modulator at f0*ratio driving every carrier's pitch;
//                index is a deviation in units of f0 (Hz = index*f0), decaying to end*index over decay seconds
//   pitchEnv:    [semitones, seconds]           carriers start `semitones` away and glide to pitch (ignored if glide is set)
//   lfoFilter:   [hz, depthHz]                  sine LFO on the filter cutoff (needs filter)
//   attackNoise: { gain, decay, type, freq, q } one-shot filtered noise burst at note start (type: 'bp' | 'hp' | 'lp')
//   unison:      { voices, spread, type }       duplicate osc layers of `type` (all if omitted) +/- spread cents; max 12 oscillators per note
// Sample instrument voice: plays `buffer` pitched from inst.rootNote, with attack/release gain and optional loop.
// `buffer` is resolved by the caller (the project's audio buffers); a missing buffer gives a silent voice.
export function startSampleVoice(ctx, out, inst, t, note, vel = 100, buffer = null) {
  const peak = Math.pow(vel / 127, 1.15) * (inst.gain ?? 1), a = Math.max(0.001, inst.attack ?? 0.005), r = inst.release ?? 0.3;
  const env = ctx.createGain(); env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(peak, t + a);
  env.connect(out);
  const src = buffer ? ctx.createBufferSource() : null;
  if (src) {
    src.buffer = buffer; src.playbackRate.value = Math.pow(2, (note - (inst.rootNote ?? 60)) / 12);
    if (inst.loopStart != null && inst.loopEnd > inst.loopStart) { src.loop = true; src.loopStart = inst.loopStart; src.loopEnd = inst.loopEnd; }
    src.connect(env); src.start(t);
  }
  let released = false;
  return {
    release(when) {
      if (released) return; released = true;
      const end = Math.max(when, t + 0.01), dt = end - t;
      const lvl = dt < a ? peak * (dt / a) : peak;
      env.gain.cancelScheduledValues(end); env.gain.setValueAtTime(lvl, end); env.gain.setTargetAtTime(0, end, Math.max(0.01, r) / 4);
      const stopAt = end + Math.max(0.05, r) * 1.3 + 0.1;
      if (src) src.stop(stopAt);
      setTimeout(() => { try { env.disconnect(); src?.disconnect(); } catch {} }, (stopAt - ctx.currentTime + 0.3) * 1000);
    },
  };
}

export function startVoice(ctx, out, inst, t, note, vel = 100, buffer = null) {
  if (inst.type === 'sample') return startSampleVoice(ctx, out, inst, t, note, vel, buffer);
  const f0 = midiToFreq(note), peak = Math.pow(vel / 127, 1.15) * inst.gain * 0.5;
  const [a, d, s, r] = inst.env;
  const env = ctx.createGain(); env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + Math.max(0.001, a));
  if (s < 1) env.gain.setTargetAtTime(peak * s, t + a, Math.max(0.01, d) / 3);
  let tail = env;
  const nodes = [], oscs = [], bursts = [];
  if (inst.filter) {
    const f = ctx.createBiquadFilter(); f.type = inst.filter.type; f.Q.value = inst.filter.q || 0.7;
    const base = inst.filter.freq * (inst.filter.track ? Math.pow(2, (note - 60) / 12 * inst.filter.track * 0.5) : 1);
    if (inst.filter.amt) { f.frequency.setValueAtTime(Math.min(18000, base + inst.filter.amt), t); f.frequency.setTargetAtTime(base, t, (inst.filter.decay || 0.2) / 3); } else f.frequency.value = Math.min(18000, base);
    env.connect(f); tail = f; nodes.push(f);
    if (inst.lfoFilter) {
      const lo = ctx.createOscillator(), lg = ctx.createGain();
      lo.frequency.value = inst.lfoFilter[0]; lg.gain.value = inst.lfoFilter[1];
      lo.connect(lg); lg.connect(f.frequency); lo.start(t); oscs.push(lo); nodes.push(lg);
    }
  }
  if (inst.drive) { const ws = ctx.createWaveShaper(), c = new Float32Array(1024); for (let i = 0; i < 1024; i++) c[i] = Math.tanh(((i / 511.5) - 1) * inst.drive); ws.curve = c; tail.connect(ws); tail = ws; nodes.push(ws); }
  tail.connect(out);
  let lfo = null, lfoG = null;
  if (inst.vib) { lfo = ctx.createOscillator(); lfo.frequency.value = inst.vib[0]; lfoG = ctx.createGain(); lfoG.gain.setValueAtTime(0, t); lfoG.gain.linearRampToValueAtTime(inst.vib[1], t + 0.4); lfo.connect(lfoG); lfo.start(t); nodes.push(lfoG); }
  if (inst.trem) { const tl = ctx.createOscillator(), tg = ctx.createGain(); tl.frequency.value = inst.trem[0]; tg.gain.value = inst.trem[1] * peak; tl.connect(tg); tg.connect(env.gain); tl.start(t); oscs.push(tl); nodes.push(tg); }
  let fmG = null;
  if (inst.fm) {
    const fm = inst.fm, mod = ctx.createOscillator(), idx = fm.index * f0;
    mod.frequency.value = f0 * fm.ratio;
    fmG = ctx.createGain();
    fmG.gain.setValueAtTime(idx, t);
    fmG.gain.setTargetAtTime(idx * (fm.end ?? 0.15), t, Math.max(0.01, fm.decay ?? 0.5) / 3);
    mod.connect(fmG); mod.start(t); oscs.push(mod); nodes.push(fmG);
  }
  // Optional unison: duplicate matching layers (gain split so the total stays constant), capped at 12 oscillators.
  let layers = inst.osc;
  if (inst.unison) {
    const u = inst.unison, match = (ly) => !u.type || ly[0] === u.type;
    const nMatch = layers.filter(match).length, nOther = layers.length - nMatch;
    const V = nMatch ? Math.max(1, Math.min(u.voices || 2, Math.floor((12 - nOther) / nMatch))) : 1;
    const sp = u.spread ?? 8;
    if (V > 1) layers = layers.flatMap((ly) => match(ly) ? Array.from({ length: V }, (_, k) => [ly[0], ly[1] - sp + (2 * sp * k) / (V - 1), ly[2] / V, ly[3]]) : [ly]);
  }
  for (const [type, det, g, oct] of layers) {
    const o = ctx.createOscillator(); o.type = type;
    const freq = f0 * Math.pow(2, oct);
    if (inst.glide) { o.frequency.setValueAtTime(freq * 1.5, t); o.frequency.exponentialRampToValueAtTime(freq, t + inst.glide); }
    else if (inst.pitchEnv) { o.frequency.setValueAtTime(freq * Math.pow(2, inst.pitchEnv[0] / 12), t); o.frequency.exponentialRampToValueAtTime(freq, t + Math.max(0.005, inst.pitchEnv[1])); }
    else o.frequency.value = freq;
    o.detune.value = det + (Math.random() - 0.5) * 3;
    if (lfoG) lfoG.connect(o.detune);
    if (fmG) fmG.connect(o.frequency);
    const og = ctx.createGain(); og.gain.value = g; o.connect(og); og.connect(env); o.start(t); oscs.push(o); nodes.push(og);
  }
  if (inst.breath) noise(ctx, env, t, 0.4, { bp: f0 * 2, q: 2, gain: inst.breath, shape: 1 });
  if (inst.attackNoise) {
    const an = inst.attackNoise, dur = an.decay ?? 0.03, fq = an.freq ?? 2000, opt = { gain: an.gain ?? 0.5, shape: 3 };
    if (an.type === 'hp') opt.hp = fq; else if (an.type === 'lp') opt.lp = fq; else { opt.bp = fq; opt.q = an.q ?? 1; }
    const nz = noise(ctx, env, t, dur, opt);
    bursts.push([nz.s, t + dur * 1.6 + 0.05]); nodes.push(...nz.nodes);
  }
  let released = false;
  return {
    release(when) {
      if (released) return; released = true;
      const end = Math.max(when, t + 0.01), dt = end - t;
      const lvl = dt < a ? peak * (dt / Math.max(a, 1e-4)) : peak * (s + (1 - s) * Math.exp(-(dt - a) / (Math.max(0.01, d) / 3)));
      env.gain.cancelScheduledValues(end);
      env.gain.setValueAtTime(lvl, end);
      env.gain.setTargetAtTime(0, end, Math.max(0.01, r) / 4);
      const stopAt = end + Math.max(0.05, r) * 1.3 + 0.1;
      for (const o of oscs) o.stop(stopAt);
      for (const [src, natural] of bursts) if (stopAt < natural) src.stop(stopAt);
      if (lfo) lfo.stop(stopAt);
      setTimeout(() => { try { env.disconnect(); nodes.forEach((n) => n.disconnect()); } catch {} }, (stopAt - ctx.currentTime + 0.3) * 1000);
    },
  };
}

export function clickSound(ctx, out, t, accent, vol = 0.5) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'square'; o.frequency.value = accent ? 1760 : 1175;
  g.gain.setValueAtTime(vol * (accent ? 0.5 : 0.32), t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.05);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.06);
}
