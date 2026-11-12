// Song browser page: browse, play, like, report, upload.
import { h, icon, LOGO, toast, modal, initChrome } from './ui.js';
import { backend, mode, onAuthChange, validateUpload, LIMITS, fmtSize, mimeOf } from './backend.js';
import { songCard, createPlayer } from './songui.js';

const $ = (s) => document.querySelector(s);
$('#logo').innerHTML = LOGO; $('#logo2').innerHTML = LOGO; $('#menuBtn').innerHTML = icon('menu', 22); $('#searchIc').innerHTML = icon('search', 18);
$('#uploadBtn').innerHTML = icon('upload', 18) + ' Upload a song';
initChrome();

const state = { q: '', genre: 'All', sort: 'new', mine: false, items: [], offset: 0, hasMore: false, liked: new Set(), loading: false };
const player = createPlayer();
const grid = $('#grid'), more = $('#moreBtn');
const PAGE = 24;

if (mode === 'demo') {
  $('#banner').append(h('div', { class: 'banner' }, h('span', { html: icon('zap', 20) }), h('div', null, h('b', null, 'Demo mode. '), 'Uploads stay on this device until the site owner connects a Supabase backend. ', h('a', { href: 'https://github.com/ahpah-dev/bandy/blob/main/docs/SONG_BROWSER.md', target: '_blank', rel: 'noopener' }, 'How to enable sharing'))));
}

/* ---------- auth ---------- */
function renderAuth() {
  const box = $('#auth'); box.replaceChildren();
  const u = backend.user();
  if (mode === 'demo') return;
  if (!u) box.append(h('button', { class: 'btn sm', onclick: () => signInModal() }, 'Sign in'));
  else box.append(h('span', { class: 'user-chip' }, u.email, h('button', { 'aria-label': 'Sign out', title: 'Sign out', html: icon('logout', 15), onclick: async () => { await backend.signOut(); toast('Signed out'); } })));
}
onAuthChange(async () => { renderAuth(); state.liked = await backend.likedIds().catch(() => new Set()); load(true); });

function signInModal(then) {
  const email = h('input', { class: 'input', type: 'email', placeholder: 'you@example.com', autocomplete: 'email', 'aria-label': 'Email' });
  const code = h('input', { class: 'input', inputmode: 'numeric', placeholder: '6-digit code (if your email has one)', autocomplete: 'one-time-code', 'aria-label': 'Code' });
  const msg = h('p', { class: 'msg' }), codeField = h('label', { class: 'field', style: { display: 'none' } }, h('span', null, 'Or enter the code'), code);
  const send = h('button', { class: 'btn primary', onclick: async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) { msg.className = 'msg err'; msg.textContent = 'Enter a valid email address.'; return; }
    send.disabled = true; msg.className = 'msg'; msg.textContent = 'Sending…';
    try { await backend.signInEmail(email.value.trim()); msg.className = 'msg ok'; msg.textContent = 'Check your inbox – open the link, or paste the code below.'; codeField.style.display = ''; verify.style.display = ''; }
    catch (e) { msg.className = 'msg err'; msg.textContent = e.message; } finally { send.disabled = false; }
  } }, 'Email me a sign-in link');
  const verify = h('button', { class: 'btn', style: { display: 'none' }, onclick: async () => {
    try { await backend.verifyCode(email.value.trim(), code.value.trim()); m.close(); toast('Signed in'); then?.(); } catch (e) { msg.className = 'msg err'; msg.textContent = e.message; }
  } }, 'Verify code');
  const m = modal([h('h2', null, 'Sign in to upload'), h('p', { class: 'sub' }, 'No password needed. We email you a one-time link. Listening never requires an account.'),
    h('label', { class: 'field' }, h('span', null, 'Email'), email), codeField, msg, h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'), verify, send)]);
  setTimeout(() => email.focus(), 50);
}
const needAuth = (then) => { if (backend.user()) return true; signInModal(then); return false; };

/* ---------- list ---------- */
function renderGenres() {
  const g = $('#genres'); g.replaceChildren(...['All', ...LIMITS.genres].map((n) => h('button', { class: 'chip' + (state.genre === n ? ' on' : ''), 'aria-pressed': String(state.genre === n), onclick: () => { state.genre = n; renderGenres(); load(true); } }, n)));
}
const handlers = {
  onPlay: (s) => player.play(s, state.items),
  async onLike(s, btn) {
    if (!needAuth()) return;
    const was = state.liked.has(s.id); was ? state.liked.delete(s.id) : state.liked.add(s.id); s.likes += was ? -1 : 1;
    btn.classList.toggle('liked', !was); btn.setAttribute('aria-pressed', String(!was)); btn.querySelector('span').textContent = s.likes;
    try { await backend.setLike(s, !was); } catch (e) { was ? state.liked.add(s.id) : state.liked.delete(s.id); s.likes += was ? 1 : -1; btn.classList.toggle('liked', was); btn.querySelector('span').textContent = s.likes; toast(e.message); }
  },
  onReport(s) { if (needAuth()) reportModal(s); },
  onDelete(s) { deleteModal(s); },
};
function card(s) { return songCard(s, { liked: state.liked.has(s.id), handlers, playing: player.current()?.id === s.id && player.playing }); }
function renderEmpty() {
  const first = !state.q && state.genre === 'All' && !state.mine;
  grid.append(h('div', { class: 'empty' }, h('div', { class: 'big', html: icon(state.mine ? 'upload' : 'music', 30) }),
    h('h3', null, state.mine ? 'You haven’t uploaded anything yet' : first ? 'No songs yet – be the first!' : 'No songs match your search'),
    h('p', null, state.mine ? 'Share a track and it will show up here.' : first ? 'Upload a song and it will appear here for everyone to hear.' : 'Try a different word or genre.'),
    h('button', { class: 'btn primary', style: { marginTop: '14px' }, onclick: openUpload, html: icon('upload', 18) + ' Upload a song' })));
}
async function load(reset) {
  if (state.loading) return; state.loading = true;
  if (reset) { state.offset = 0; state.items = []; grid.replaceChildren(...[...Array(6)].map(() => h('div', { class: 'skeleton' }))); more.hidden = true; }
  try {
    if (!state.liked.size && backend.user()) state.liked = await backend.likedIds().catch(() => new Set());
    const { items, hasMore } = await backend.list({ q: state.q, genre: state.genre, sort: state.sort, mine: state.mine, offset: state.offset, limit: PAGE });
    if (reset) grid.replaceChildren();
    state.items.push(...items); state.offset += items.length; state.hasMore = hasMore;
    items.forEach((s) => grid.append(card(s)));
    if (!state.items.length) renderEmpty();
    more.hidden = !hasMore;
  } catch (e) {
    grid.replaceChildren(h('div', { class: 'empty' }, h('h3', null, 'Couldn’t load songs'), h('p', null, e.message), h('button', { class: 'btn', style: { marginTop: '12px' }, onclick: () => load(true) }, 'Try again')));
  } finally { state.loading = false; }
}
player.onChange((cur, playing) => {
  grid.querySelectorAll('.song').forEach((el) => {
    const on = cur && el.dataset.id === cur.id && playing; el.classList.toggle('playing', !!on);
    el.querySelector('.pbtn').innerHTML = icon(on ? 'pause' : 'play', 22);
  });
});

/* ---------- toolbar ---------- */
let t; $('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; load(true); }, 250); });
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; load(true); });
$('#mineBtn').addEventListener('click', (e) => {
  if (!state.mine && !needAuth(() => $('#mineBtn').click())) return;
  state.mine = !state.mine; e.currentTarget.setAttribute('aria-pressed', String(state.mine)); e.currentTarget.classList.toggle('primary', state.mine); load(true);
});
more.addEventListener('click', () => load(false));
$('#uploadBtn').addEventListener('click', openUpload);

/* ---------- modals ---------- */
function reportModal(s) {
  const reason = h('select', { class: 'select', style: { width: '100%' }, 'aria-label': 'Reason' }, ['Copyright – I own this or know who does', 'Offensive or hateful content', 'Spam or not music', 'Something else'].map((r) => h('option', null, r)));
  const m = modal([h('h2', null, 'Report this song'), h('p', { class: 'sub' }, `“${s.title}” will be hidden once it gets enough reports, pending review.`), h('label', { class: 'field' }, h('span', null, 'Reason'), reason),
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: async (e) => {
      e.target.disabled = true;
      try { await backend.report(s, reason.value); m.close(); toast('Thanks – we’ll take a look'); if (mode === 'demo') { state.items = state.items.filter((x) => x.id !== s.id); player.drop(s); grid.querySelector(`[data-id="${s.id}"]`)?.remove(); if (!state.items.length) renderEmpty(); } }
      catch (err) { e.target.disabled = false; toast(err.message); }
    } }, 'Send report'))]);
}
function deleteModal(s) {
  const m = modal([h('h2', null, 'Delete this song?'), h('p', { class: 'sub' }, `“${s.title}” will be permanently removed.`), h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: async (e) => {
      e.target.disabled = true;
      try { await backend.remove(s); player.drop(s); state.items = state.items.filter((x) => x.id !== s.id); grid.querySelector(`[data-id="${s.id}"]`)?.remove(); if (!state.items.length) renderEmpty(); m.close(); toast('Song deleted'); }
      catch (err) { e.target.disabled = false; toast(err.message); }
    } }, 'Delete'))]);
}

function openUpload() {
  if (!needAuth(openUpload)) return;
  let file = null, duration = 0;
  const fileIn = h('input', { type: 'file', accept: Object.keys(LIMITS.types).map((e) => '.' + e).join(','), hidden: true });
  const dropTitle = h('b', null, 'Drop an audio file here'), dropSub = h('span', null, `or click to browse · ${Object.keys(LIMITS.types).join(', ').toUpperCase()} · up to ${fmtSize(LIMITS.maxBytes)}`);
  const drop = h('div', { class: 'drop', tabindex: 0, role: 'button', 'aria-label': 'Choose an audio file' }, h('div', { html: icon('upload', 30), style: { color: 'var(--accent2)', margin: '0 auto 8px', width: '30px' } }), dropTitle, dropSub, fileIn);
  const title = h('input', { class: 'input', maxlength: 80, placeholder: 'Song title' });
  const artist = h('input', { class: 'input', maxlength: 60, placeholder: 'Your artist name', value: localStorage.getItem('bandy.artist') || '' });
  const genre = h('select', { class: 'select', style: { width: '100%' } }, LIMITS.genres.map((g) => h('option', null, g)));
  const desc = h('textarea', { class: 'input', maxlength: 500, placeholder: 'Tell people about it (optional)' });
  const rights = h('input', { type: 'checkbox' });
  const prog = h('div', { class: 'prog', hidden: true }, h('i')), msg = h('p', { class: 'msg' });
  const go = h('button', { class: 'btn primary', onclick: submit, html: icon('upload', 18) + ' Publish' });
  const cancel = h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel');

  function pick(f) {
    if (!f) return;
    file = f; drop.classList.add('has'); dropTitle.textContent = f.name; dropSub.textContent = fmtSize(f.size);
    if (!title.value) title.value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 80);
    const a = new Audio(), u = URL.createObjectURL(f); a.preload = 'metadata'; a.src = u;
    a.onloadedmetadata = () => { duration = a.duration; URL.revokeObjectURL(u); }; a.onerror = () => URL.revokeObjectURL(u);
    const err = validateUpload(f, { title: 'x', artist: 'x', rights: true }); msg.className = 'msg ' + (err ? 'err' : ''); msg.textContent = err;
  }
  drop.addEventListener('click', () => fileIn.click()); drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
  fileIn.addEventListener('change', () => pick(fileIn.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); }); drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); pick(e.dataTransfer.files[0]); });

  async function submit() {
    const meta = { title: title.value, artist: artist.value, genre: genre.value, description: desc.value, rights: rights.checked, duration: isFinite(duration) ? duration : 0 };
    const err = validateUpload(file, meta); if (err) { msg.className = 'msg err'; msg.textContent = err; return; }
    go.disabled = cancel.disabled = true; prog.hidden = false; msg.className = 'msg'; msg.textContent = 'Uploading…';
    try {
      localStorage.setItem('bandy.artist', artist.value.trim());
      const song = await backend.upload(file, meta, (p) => { prog.firstChild.style.width = Math.round(p * 100) + '%'; });
      m.close(); toast('Your song is live 🎉');
      if (state.q || state.genre !== 'All' || state.sort !== 'new') { state.q = ''; $('#q').value = ''; state.genre = 'All'; state.sort = 'new'; $('#sort').value = 'new'; renderGenres(); }
      state.mine = false; $('#mineBtn').setAttribute('aria-pressed', 'false'); $('#mineBtn').classList.remove('primary'); load(true);
    } catch (e) { go.disabled = cancel.disabled = false; prog.hidden = true; msg.className = 'msg err'; msg.textContent = e.message; }
  }
  const m = modal([h('h2', null, 'Upload a song'), h('p', { class: 'sub' }, 'Share something you made. Songs are public and anyone can listen.'), drop,
    h('label', { class: 'field' }, h('span', null, 'Title'), title),
    h('div', { class: 'row2' }, h('label', { class: 'field' }, h('span', null, 'Artist'), artist), h('label', { class: 'field' }, h('span', null, 'Genre'), genre)),
    h('label', { class: 'field' }, h('span', null, 'Description'), desc),
    h('label', { class: 'chk' }, rights, h('span', null, 'I made this song or have the rights to share it, and I accept that it will be public.')),
    prog, msg, h('div', { class: 'actions' }, cancel, go)]);
}

/* ---------- boot ---------- */
(async () => {
  await backend.init(); renderAuth(); renderGenres(); load(true);
})();
