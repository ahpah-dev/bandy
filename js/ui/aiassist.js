// AI Assist card for the instrument designer: describe a sound, get an editable synth preset.
// Requests go through the local bridge (tools/ai_bridge.py). Keys are never written to disk;
// they are kept in memory for the life of the page so re-opening the designer doesn't need retyping.
import { h, toast } from '../util.js';
import { icon } from '../icons.js';
import { sanitizeInstrument } from '../audio/synth.js';

export const BRIDGE = 'http://127.0.0.1:5175';
const MIN_BRIDGE_VERSION = 2; // bridges older than this don't understand custom endpoints
// OpenAI-compatible chat-completions endpoints. `key: false` providers (e.g. a local Ollama) need no API key.
const PROVIDERS = {
  openai: { label: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1-mini', placeholder: 'sk-…', help: 'Create a key at platform.openai.com/api-keys.' },
  anthropic: { label: 'Anthropic (Claude)', endpoint: 'https://api.anthropic.com/v1/chat/completions', model: 'claude-haiku-5-5', placeholder: 'sk-ant-…', help: "Uses Anthropic's OpenAI-compatible endpoint. Create a key at console.anthropic.com." },
  openrouter: { label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4.1-mini', placeholder: 'sk-or-…', help: 'One key for hundreds of models: openrouter.ai/keys.' },
  groq: { label: 'Groq', endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', placeholder: 'gsk_…', help: 'Fast open models: console.groq.com/keys.' },
  mistral: { label: 'Mistral', endpoint: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-small-latest', placeholder: 'Mistral API key', help: 'console.mistral.ai/api-keys.' },
  deepseek: { label: 'DeepSeek', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', placeholder: 'sk-…', help: 'platform.deepseek.com/api_keys.' },
  together: { label: 'Together AI', endpoint: 'https://api.together.xyz/v1/chat/completions', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', placeholder: 'Together API key', help: 'api.together.ai/settings/api-keys.' },
  kilo: { label: 'Kilo Gateway', endpoint: 'https://ai-gateway.kilo.ai/api/v1/chat/completions', model: 'cohere/north-mini-code:free', placeholder: 'Kilo Gateway API key', help: 'Sign in at app.kilo.ai and copy your Gateway key from your profile.' },
  ollama: { label: 'Ollama (local, no key)', endpoint: 'http://127.0.0.1:11434/v1/chat/completions', model: 'llama3.1', placeholder: 'Not needed', key: false, help: 'Runs on your computer. Start Ollama and pull a model first (ollama pull llama3.1).' },
};
const CUSTOM_PREFIX = 'custom:';
const EXAMPLES = ['Warm, slow analog pad', 'Plucky 80s synth bass', 'Glassy FM bells', 'Dirty acid lead', 'Soft breathy flute', 'Wobbly dubstep bass', 'Dreamy detuned strings', 'Tiny chiptune lead'];
const sessionKeys = {}; // in memory, per provider id
const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const prefs = () => readJson('bandy.ai', {});
const savePrefs = (p) => localStorage.setItem('bandy.ai', JSON.stringify({ provider: p.provider, models: p.models, remember: !!p.remember }));
// User-defined OpenAI-compatible providers: [{ id, name, endpoint, model }]
const loadCustom = () => { const l = readJson('bandy.ai.custom', []); return (Array.isArray(l) ? l : []).filter((c) => c && typeof c.id === 'string' && typeof c.endpoint === 'string' && validEndpoint(c.endpoint)); };
const saveCustom = (list) => localStorage.setItem('bandy.ai.custom', JSON.stringify(list));
// Keys are only written to localStorage when the user ticks "Remember my keys on this device".
const loadKeys = () => readJson('bandy.ai.keys', {});
const storeKey = (id, key) => { const all = loadKeys(); if (key) all[id] = key; else delete all[id]; localStorage.setItem('bandy.ai.keys', JSON.stringify(all)); };
export function validEndpoint(u) {
  try {
    const x = new URL(u), local = ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname);
    return (x.protocol === 'https:' || (x.protocol === 'http:' && local)) && !x.username && !x.password;
  } catch { return false; }
}

const SYSTEM = `You are an expert sound designer for a Web Audio synthesizer. Reply with ONE JSON object and nothing else (no markdown, no commentary).
Schema: {"name":string,"type":"synth","osc":[[wave,detuneCents,gain,octave]],"env":[attackSec,decaySec,sustain,releaseSec],"gain":number,
"filter":{"type":"lowpass|highpass|bandpass|notch","freq":Hz,"q":number,"track":0-2,"amt":Hz,"decay":sec},"vib":[rateHz,depthCents],"trem":[rateHz,depth],
"lfoFilter":[rateHz,depthHz],"drive":0-4,"glide":sec,"fm":{"ratio":number,"index":number,"decay":sec,"end":0-1},
"attackNoise":{"gain":0-1,"decay":sec,"type":"bp|hp|lp","freq":Hz,"q":number},"unison":{"voices":1-5,"spread":cents}}
Rules: waves are sine, square, sawtooth or triangle; 1-4 oscillators; gains 0-1 (sum <= 1.4); octave -2..2; envelope times 0.001-8; sustain 0-1; gain 0.3-1. Omit optional blocks you don't need. Never return a sample instrument.
Guidance: pads = attack 0.4-1.5, release 0.8-2, two detuned saws (+-5..12 cents) into a lowpass 800-2500; plucks = attack 0.002, sustain 0, decay 0.15-0.6, filter envelope amt 2000-5000; basses = octave -1 or -2, lowpass 300-900 with amt; leads = saw/square with vib [5,6]; bells/keys = fm ratio 3.5 or 14, index 2-4, decay 1-3; winds/strings = slow attack + vibrato + breath-like attackNoise.
Example: {"name":"Warm Pad","type":"synth","osc":[["sawtooth",-9,0.4,0],["sawtooth",9,0.4,0],["triangle",0,0.3,-1]],"env":[0.8,0.6,0.8,1.4],"gain":0.6,"filter":{"type":"lowpass","freq":1400,"q":0.8,"track":0.3,"amt":0,"decay":0.3},"vib":[4.5,4]}`;

const describe = (d) => {
  const bits = [`${d.osc?.length || 1} layer${d.osc?.length === 1 ? '' : 's'}`];
  if (d.filter) bits.push(`${d.filter.type} ${d.filter.freq >= 1000 ? (d.filter.freq / 1000).toFixed(1) + ' kHz' : Math.round(d.filter.freq) + ' Hz'}`);
  const a = d.env?.[0] ?? 0; bits.push(`attack ${a < 1 ? Math.round(a * 1000) + ' ms' : a.toFixed(1) + ' s'}`);
  if (d.fm) bits.push('FM'); if (d.unison?.voices > 1) bits.push(`unison ×${d.unison.voices}`); if (d.vib) bits.push('vibrato'); if (d.drive > 0) bits.push('drive');
  return bits;
};

function friendly(status, fallback) {
  if (status === 401 || status === 403) return 'The provider rejected your API key. Check it and try again.';
  if (status === 404) return 'That model was not found. Check the model ID in Provider settings.';
  if (status === 429) return 'Rate limit or quota reached. Wait a moment or check your balance.';
  if (status >= 500) return 'The provider is having trouble right now. Try again shortly.';
  return fallback;
}

// ctx: { snapshot(), restore(snap), apply(def), preview() }
export function buildAiAssist(ctx) {
  const p = { provider: 'openai', models: {}, remember: false, ...prefs() };
  let customs = loadCustom();
  const allProviders = () => ({ ...PROVIDERS, ...Object.fromEntries(customs.map((c) => [c.id, { label: c.name, endpoint: c.endpoint, model: c.model || '', placeholder: 'API key (if your endpoint needs one)', custom: true, help: 'Custom endpoint.' }])) });
  const prov = () => allProviders()[p.provider] || PROVIDERS.openai;
  if (!allProviders()[p.provider]) p.provider = 'openai';
  const keyOf = (id) => sessionKeys[id] ?? (p.remember ? loadKeys()[id] : '') ?? '';

  const prompt = h('textarea', { class: 'ai-prompt', rows: 3, maxlength: 600, placeholder: 'Describe the sound you imagine…', 'aria-label': 'Describe the instrument' });
  const counter = h('span', { class: 'ai-count' }, '0 / 600');
  const chips = h('div', { class: 'ai-examples' }, EXAMPLES.map((t) => h('button', { type: 'button', class: 'ai-chip', onclick: () => { prompt.value = t; prompt.dispatchEvent(new Event('input')); prompt.focus(); } }, t)));
  const dot = h('span', { class: 'ai-dot' });
  const bridgeLabel = h('span', null, 'Checking bridge…');
  const bridge = h('button', { type: 'button', class: 'ai-bridge', title: 'Click to re-check the local bridge', onclick: () => ping() }, dot, bridgeLabel);
  const status = h('div', { class: 'ai-status', role: 'status', 'aria-live': 'polite' });

  // provider settings
  const ADD = '__add__';
  const provSel = h('select', { class: 'select', onchange: (e) => {
    if (e.target.value === ADD) { editor.classList.add('open'); cName.focus(); provSel.value = p.provider; return; }
    p.provider = e.target.value; editor.classList.remove('open'); refreshSettings(); savePrefs(p);
  } });
  const fillProviders = () => {
    provSel.replaceChildren(...Object.entries(allProviders()).map(([k, v]) => h('option', { value: k, selected: k === p.provider }, v.custom ? v.label + ' (custom)' : v.label)), h('option', { value: ADD }, '+ Add custom provider…'));
    provSel.value = p.provider;
  };
  const model = h('input', { class: 'text-input', placeholder: 'Model ID', oninput: () => { p.models[p.provider] = model.value.trim(); savePrefs(p); } });
  const key = h('input', { class: 'text-input', type: 'password', autocomplete: 'off', spellcheck: 'false', oninput: () => {
    sessionKeys[p.provider] = key.value; if (p.remember) storeKey(p.provider, key.value.trim());
  } });
  const eye = h('button', { type: 'button', class: 'icon-btn small', title: 'Show / hide key', html: icon('lock', 14), onclick: () => { key.type = key.type === 'password' ? 'text' : 'password'; } });
  const keyField = h('label', { class: 'id-field wide' }, h('span', null, 'API key'), h('div', { class: 'ai-keyrow' }, key, eye));
  const remember = h('input', { type: 'checkbox', checked: p.remember, onchange: (e) => {
    p.remember = e.target.checked; savePrefs(p);
    if (p.remember) { for (const [id, k] of Object.entries(sessionKeys)) if (k) storeKey(id, k.trim()); }
    else localStorage.removeItem('bandy.ai.keys');
    toast(p.remember ? 'Keys will be remembered on this device' : 'Stored keys removed');
  } });
  const help = h('p', { class: 'muted small ai-help' });
  const endpointNote = h('code', { class: 'ai-endpoint' });
  // custom provider editor
  const cName = h('input', { class: 'text-input', placeholder: 'e.g. My company gateway', maxlength: 40 });
  const cUrl = h('input', { class: 'text-input', placeholder: 'https://api.example.com/v1/chat/completions', spellcheck: 'false' });
  const cModel = h('input', { class: 'text-input', placeholder: 'default model ID (optional)' });
  const cMsg = h('p', { class: 'ai-cmsg small' });
  const editor = h('div', { class: 'ai-custom wide' },
    h('div', { class: 'ai-ctitle' }, 'Custom provider', h('span', { class: 'muted small' }, ' – any OpenAI-compatible chat-completions API')),
    h('label', { class: 'id-field' }, h('span', null, 'Name'), cName), h('label', { class: 'id-field' }, h('span', null, 'Model ID'), cModel),
    h('label', { class: 'id-field wide' }, h('span', null, 'Endpoint URL (https, or http for localhost)'), cUrl), cMsg,
    h('div', { class: 'ai-cactions' },
      h('button', { type: 'button', class: 'btn small primary', onclick: () => {
        const name = cName.value.trim(), url = cUrl.value.trim();
        if (!name) { cMsg.textContent = 'Give it a name.'; return; }
        if (!validEndpoint(url)) { cMsg.textContent = 'Enter a full https:// URL (http:// only works for localhost).'; return; }
        const id = CUSTOM_PREFIX + Math.random().toString(36).slice(2, 9);
        customs = [...customs, { id, name: name.slice(0, 40), endpoint: url, model: cModel.value.trim() }]; saveCustom(customs);
        p.provider = id; savePrefs(p); editor.classList.remove('open'); cMsg.textContent = ''; cName.value = cUrl.value = cModel.value = ''; fillProviders(); refreshSettings(); toast('Provider added');
      } }, 'Add provider'),
      h('button', { type: 'button', class: 'btn small', onclick: () => { editor.classList.remove('open'); cMsg.textContent = ''; } }, 'Cancel')));
  const removeBtn = h('button', { type: 'button', class: 'btn small ghost danger', onclick: () => {
    const id = p.provider; customs = customs.filter((c) => c.id !== id); saveCustom(customs); delete sessionKeys[id]; storeKey(id, ''); delete p.models[id];
    p.provider = 'openai'; savePrefs(p); fillProviders(); refreshSettings(); toast('Provider removed');
  } }, 'Remove this provider');
  const startCmd = 'python tools/ai_bridge.py';
  const setup = h('div', { class: 'ai-setup' }, h('p', { class: 'muted small' }, 'The bridge lets the browser reach AI providers (browsers block direct calls) and keeps your key off the page. Run this in your Bandy folder and leave it open:'),
    h('div', { class: 'ai-cmd' }, h('code', null, startCmd), h('button', { type: 'button', class: 'btn small', onclick: () => { navigator.clipboard?.writeText(startCmd); toast('Command copied'); } }, 'Copy')));
  const settings = h('div', { class: 'ai-settings' },
    h('label', { class: 'id-field' }, h('span', null, 'Provider'), provSel), h('label', { class: 'id-field' }, h('span', null, 'Model ID'), model),
    editor, keyField, help, endpointNote,
    h('label', { class: 'ai-remember wide' }, remember, h('span', null, 'Remember my keys on this device ', h('em', null, '(stored unencrypted in this browser — only on a computer you trust)'))),
    h('div', { class: 'ai-sfoot wide' }, removeBtn),
    h('p', { class: 'muted small' }, 'Keys stay in memory for this tab unless you tick the box above. Your prompt is sent to the provider you choose; they may bill you.'));
  function refreshSettings() {
    const v = prov();
    model.value = p.models[p.provider] || v.model; key.value = keyOf(p.provider) || ''; key.placeholder = v.placeholder; help.textContent = v.help;
    keyField.style.display = v.key === false ? 'none' : ''; removeBtn.style.display = v.custom ? '' : 'none';
    endpointNote.textContent = v.endpoint;
  }
  fillProviders(); refreshSettings();
  const gearBtn = h('button', { type: 'button', class: 'btn small ghost', 'aria-expanded': 'false', html: icon('gear', 14) + '<span>Provider</span>', onclick: () => { const open = card.classList.toggle('settings-open'); gearBtn.setAttribute('aria-expanded', String(open)); if (open) ping(); } });

  const spinner = h('span', { class: 'ai-spin', 'aria-hidden': 'true' });
  const genLabel = h('span', null, 'Generate');
  const gen = h('button', { type: 'button', class: 'btn primary ai-gen', onclick: () => run(false) }, h('span', { html: icon('fx', 15) }), genLabel, spinner);
  const cancel = h('button', { type: 'button', class: 'btn small', onclick: () => abort?.abort() }, 'Cancel');
  const again = h('button', { type: 'button', class: 'btn small', title: 'Ask for a different take on the same description', html: icon('loop', 14) + '<span>Variation</span>', onclick: () => run(true) });
  const undoBtn = h('button', { type: 'button', class: 'btn small', title: 'Restore the sound you had before generating', html: icon('undo', 14) + '<span>Undo</span>', onclick: () => { if (prev) { ctx.restore(prev); prev = null; setState('idle', 'Restored your previous sound.'); sync(); } } });

  const card = h('section', { class: 'ai-card' },
    h('header', { class: 'ai-head' }, h('div', { class: 'ai-title' }, h('span', { class: 'ai-spark', html: icon('fx', 16) }), h('strong', null, 'AI Assist'), h('span', { class: 'ai-badge' }, 'Beta')), bridge),
    h('div', { class: 'ai-body' },
      h('div', { class: 'ai-promptwrap' }, prompt, counter), chips,
      h('div', { class: 'ai-actions' }, gen, cancel, again, undoBtn, h('span', { class: 'spacer' }), gearBtn),
      settings, setup, status));

  let abort = null, prev = null, last = '', online = null, outdated = false;
  function sync() {
    const busy = !!abort;
    card.classList.toggle('busy', busy); gen.disabled = busy; prompt.disabled = busy; genLabel.textContent = busy ? 'Generating…' : 'Generate';
    cancel.style.display = busy ? '' : 'none'; again.style.display = !busy && last ? '' : 'none'; undoBtn.style.display = !busy && prev ? '' : 'none';
    card.classList.toggle('offline', online === false || outdated);
  }
  function setState(kind, msg, tags = []) {
    status.className = 'ai-status ' + kind; status.replaceChildren();
    if (!msg) return;
    status.append(h('div', { class: 'ai-msg' }, msg));
    if (tags.length) status.append(h('div', { class: 'ai-tags' }, tags.map((t) => h('span', { class: 'ai-tag' }, t))));
  }
  prompt.addEventListener('input', () => { counter.textContent = `${prompt.value.length} / 600`; });
  prompt.addEventListener('keydown', (e) => { e.stopPropagation(); if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(false); } });
  key.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') run(false); });
  model.addEventListener('keydown', (e) => e.stopPropagation());

  async function ping() {
    bridgeLabel.textContent = 'Checking bridge…'; dot.className = 'ai-dot';
    try {
      const r = await fetch(BRIDGE + '/health', { signal: AbortSignal.timeout(1500) });
      online = r.ok;
      const info = online ? await r.json().catch(() => ({})) : {};
      outdated = online && !(info.version >= MIN_BRIDGE_VERSION);
    } catch { online = false; outdated = false; }
    dot.className = 'ai-dot ' + (outdated ? 'warn' : online ? 'ok' : 'bad');
    bridgeLabel.textContent = outdated ? 'Bridge outdated' : online ? 'Bridge online' : 'Bridge offline';
    if (outdated) setState('error', 'Your local bridge is an older version. Stop it and start it again with the command below.');
    sync();
    return online && !outdated;
  }

  async function run(variation) {
    const text = (variation ? last : prompt.value).trim(), m = model.value.trim(), k = key.value.trim(), v = prov();
    if (!text) { setState('error', 'Describe the sound first — or tap one of the ideas above.'); prompt.focus(); return; }
    if (!k && v.key !== false && !v.custom) { card.classList.add('settings-open'); gearBtn.setAttribute('aria-expanded', 'true'); setState('error', 'Add your API key in Provider settings to generate.'); key.focus(); return; }
    if (!m) { card.classList.add('settings-open'); setState('error', 'Choose a model ID in Provider settings.'); model.focus(); return; }
    if (online === null || outdated) await ping();
    if (outdated) return;
    last = text; abort = new AbortController(); sync(); setState('loading', variation ? 'Dreaming up a different take…' : 'Designing your instrument…');
    const timer = setTimeout(() => abort?.abort('timeout'), 100000);
    try {
      const user = variation ? `${text}\n\nGive a clearly different variation from a typical take on this description.` : text;
      const res = await fetch(BRIDGE + '/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal, body: JSON.stringify({ endpoint: v.endpoint, key: k, model: m, temperature: variation ? 1 : 0.7, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] }) });
      online = true; dot.className = 'ai-dot ok'; bridgeLabel.textContent = 'Bridge online';
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(friendly(res.status, data.error?.message || data.error || `Request failed (${res.status}).`)), { handled: true });
      let content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw Object.assign(new Error('The model sent no instrument. Try another model.'), { handled: true });
      content = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const a = content.indexOf('{'), b = content.lastIndexOf('}');
      const raw = JSON.parse(a >= 0 && b > a ? content.slice(a, b + 1) : content);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.type === 'sample' || !Array.isArray(raw.osc) || !raw.osc.length) throw Object.assign(new Error('The model returned an unusable preset. Try again or switch model.'), { handled: true });
      const def = sanitizeInstrument({ ...raw, type: 'synth' });
      if (!def) throw Object.assign(new Error('The preset failed validation. Try again.'), { handled: true });
      def.name = String(def.name || text).slice(0, 40);
      prev = ctx.snapshot(); ctx.apply(def);
      setState('ok', `“${def.name}” is ready — listen, tweak the controls, then Save.`, describe(def));
      ctx.preview();
    } catch (e) {
      if (e.name === 'AbortError' || e === 'timeout') setState('idle', abort?.signal.reason === 'timeout' ? 'That took too long. Try again or pick a faster model.' : 'Cancelled.');
      else if (e.handled) setState('error', e.message);
      else if (e instanceof SyntaxError) setState('error', 'The model replied with something that wasn\'t valid JSON. Try again or choose another model.');
      else { online = false; dot.className = 'ai-dot bad'; bridgeLabel.textContent = 'Bridge offline'; card.classList.add('settings-open'); setState('error', 'Couldn\'t reach the local bridge. Start it with the command below, then try again.'); }
    } finally { clearTimeout(timer); abort = null; sync(); }
  }

  card.cancel = () => abort?.abort();
  sync(); ping();
  return card;
}
