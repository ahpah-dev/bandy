// Song browser data layer. Two interchangeable backends behind one API:
//   - "supabase": shared, public uploads (configure js/site/config.js)
//   - "demo": everything stays in this browser (IndexedDB) so the UI works with zero setup
import { SUPABASE, LIMITS } from './config.js';

export const mode = SUPABASE.url && SUPABASE.anonKey ? 'supabase' : 'demo';
export { LIMITS };

const authListeners = new Set();
export const onAuthChange = (fn) => (authListeners.add(fn), () => authListeners.delete(fn));
const emitAuth = () => authListeners.forEach((fn) => fn(backend.user()));

export const extOf = (name) => (name.split('.').pop() || '').toLowerCase();
export const mimeOf = (file) => LIMITS.types[extOf(file.name)] || '';
export const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
export const fmtDur = (s) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:––');
export function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  const m = s / 60; if (m < 60) return `${Math.floor(m)} min ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)} h ago`;
  const d = h / 24; if (d < 30) return `${Math.floor(d)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function validateUpload(file, meta) {
  if (!file) return 'Choose an audio file to upload.';
  if (!mimeOf(file)) return `Unsupported file type. Use ${Object.keys(LIMITS.types).join(', ').toUpperCase()}.`;
  if (file.size > LIMITS.maxBytes) return `That file is ${fmtSize(file.size)}. The limit is ${fmtSize(LIMITS.maxBytes)}.`;
  if (file.size < 1024) return 'That file looks empty.';
  const title = (meta.title || '').trim(), artist = (meta.artist || '').trim();
  if (!title || title.length > 80) return 'Give your song a title (up to 80 characters).';
  if (!artist || artist.length > 60) return 'Add an artist name (up to 60 characters).';
  if ((meta.description || '').length > 500) return 'The description is limited to 500 characters.';
  if (!meta.rights) return 'Please confirm you have the rights to share this song.';
  return '';
}

/* ------------------------------------------------------------------ Supabase */
const SESSION_KEY = 'bandy.songs.session';
let session = null;
try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { session = null; }
const saveSession = (s) => { session = s; if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); emitAuth(); };
const base = SUPABASE.url.replace(/\/+$/, '');

async function raw(path, { method = 'GET', body, headers = {}, auth = true } = {}) {
  const token = auth && session?.access_token ? session.access_token : SUPABASE.anonKey;
  const res = await fetch(base + path, {
    method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    headers: { apikey: SUPABASE.anonKey, Authorization: 'Bearer ' + token, ...(body !== undefined && typeof body !== 'string' ? { 'Content-Type': 'application/json' } : {}), ...headers },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); msg = j.message || j.msg || j.error_description || j.error || msg; } catch { /* no body */ }
    throw Object.assign(new Error(msg), { status: res.status });
  }
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function refreshIfNeeded() {
  if (!session) return;
  if (session.expires_at && session.expires_at - 60 > Date.now() / 1000) return;
  try {
    const s = await raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token }, auth: false });
    saveSession({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + s.expires_in, user: { id: s.user.id, email: s.user.email } });
  } catch { saveSession(null); }
}

// Magic links return to the page with the session in the URL hash.
async function consumeHash() {
  if (!location.hash.includes('access_token=')) return;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  const token = p.get('access_token'); if (!token) return;
  try {
    const user = await raw('/auth/v1/user', { auth: false, headers: { Authorization: 'Bearer ' + token } });
    saveSession({ access_token: token, refresh_token: p.get('refresh_token'), expires_at: Math.floor(Date.now() / 1000) + (+p.get('expires_in') || 3600), user: { id: user.id, email: user.email } });
  } catch { /* ignore invalid link */ }
}

const publicUrl = (path) => `${base}/storage/v1/object/public/songs/${path.split('/').map(encodeURIComponent).join('/')}`;
const fromRow = (r) => ({ id: r.id, title: r.title, artist: r.artist, genre: r.genre, description: r.description || '', size: r.file_size, duration: r.duration, plays: r.plays, likes: r.likes, created_at: r.created_at, mine: !!session && r.user_id === session.user.id, hidden: r.hidden, url: publicUrl(r.file_path), path: r.file_path });
const played = new Set();

const supabase = {
  mode: 'supabase',
  async init() { await consumeHash(); await refreshIfNeeded(); },
  user: () => session?.user || null,
  async signInEmail(email) {
    const redirect = encodeURIComponent(location.origin + location.pathname);
    await raw(`/auth/v1/otp?redirect_to=${redirect}`, { method: 'POST', body: { email, create_user: true }, auth: false });
  },
  async verifyCode(email, token) {
    const s = await raw('/auth/v1/verify', { method: 'POST', body: { type: 'email', email, token }, auth: false });
    saveSession({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + s.expires_in, user: { id: s.user.id, email: s.user.email } });
  },
  async signOut() { try { await raw('/auth/v1/logout', { method: 'POST' }); } catch { /* best effort */ } saveSession(null); },
  async list({ q = '', genre = 'All', sort = 'new', mine = false, offset = 0, limit = 24 } = {}) {
    await refreshIfNeeded();
    const p = new URLSearchParams({ select: '*' });
    if (mine) { if (!session) return { items: [], hasMore: false }; p.set('user_id', `eq.${session.user.id}`); } else p.set('hidden', 'eq.false');
    if (genre !== 'All') p.set('genre', `eq.${genre}`);
    const term = q.replace(/[^\p{L}\p{N}\s'-]/gu, '').trim().slice(0, 60);
    if (term) p.set('or', `(title.ilike.*${term}*,artist.ilike.*${term}*)`);
    p.set('order', { new: 'created_at.desc', top: 'likes.desc,created_at.desc', plays: 'plays.desc,created_at.desc' }[sort] || 'created_at.desc');
    p.set('limit', String(limit + 1)); p.set('offset', String(offset));
    const rows = await raw('/rest/v1/songs?' + p);
    return { items: rows.slice(0, limit).map(fromRow), hasMore: rows.length > limit };
  },
  async likedIds() {
    if (!session) return new Set();
    await refreshIfNeeded();
    const rows = await raw(`/rest/v1/likes?select=song_id&user_id=eq.${session.user.id}&limit=1000`);
    return new Set(rows.map((r) => r.song_id));
  },
  async setLike(song, like) {
    await refreshIfNeeded();
    if (like) await raw('/rest/v1/likes', { method: 'POST', body: { song_id: song.id }, headers: { Prefer: 'return=minimal' } }).catch((e) => { if (e.status !== 409) throw e; });
    else await raw(`/rest/v1/likes?song_id=eq.${song.id}&user_id=eq.${session.user.id}`, { method: 'DELETE' });
  },
  async report(song, reason) {
    await refreshIfNeeded();
    await raw('/rest/v1/reports', { method: 'POST', body: { song_id: song.id, reason }, headers: { Prefer: 'return=minimal' } }).catch((e) => { if (e.status !== 409) throw e; });
  },
  async remove(song) {
    await refreshIfNeeded();
    await raw(`/rest/v1/songs?id=eq.${song.id}`, { method: 'DELETE' });
    await raw(`/storage/v1/object/songs/${song.path.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' }).catch(() => {});
  },
  async upload(file, meta, onProgress) {
    await refreshIfNeeded();
    if (!session) throw new Error('Sign in to upload.');
    const mime = mimeOf(file), path = `${session.user.id}/${crypto.randomUUID()}.${extOf(file.name)}`;
    await new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', `${base}/storage/v1/object/songs/${path}`);
      x.setRequestHeader('apikey', SUPABASE.anonKey); x.setRequestHeader('Authorization', 'Bearer ' + session.access_token);
      x.setRequestHeader('Content-Type', mime); x.setRequestHeader('x-upsert', 'false'); x.setRequestHeader('cache-control', 'max-age=31536000');
      x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      x.onload = () => (x.status < 300 ? resolve() : reject(new Error(x.status === 413 ? 'The file is too large for the server.' : 'The upload was rejected. Check the file type and size.')));
      x.onerror = () => reject(new Error('Network error while uploading.'));
      x.send(file);
    });
    try {
      const rows = await raw('/rest/v1/songs', { method: 'POST', body: { title: meta.title.trim(), artist: meta.artist.trim(), genre: meta.genre, description: (meta.description || '').trim() || null, file_path: path, file_size: file.size, mime, duration: meta.duration || null, rights_confirmed: true }, headers: { Prefer: 'return=representation' } });
      return fromRow(rows[0]);
    } catch (e) {
      await raw(`/storage/v1/object/songs/${path}`, { method: 'DELETE' }).catch(() => {});
      throw new Error(/daily|limit/i.test(e.message) ? `Upload limit reached (${LIMITS.maxUploadsPerDay} songs per day). Try again tomorrow.` : e.message);
    }
  },
  audioUrl: (song) => song.url,
  recordPlay(song) { if (played.has(song.id)) return; played.add(song.id); raw('/rest/v1/rpc/record_play', { method: 'POST', body: { song_id: song.id } }).catch(() => {}); },
};

/* ---------------------------------------------------------------------- Demo */
const DB = 'bandy-songs-demo';
let dbp;
const db = () => (dbp ||= new Promise((res, rej) => {
  const rq = indexedDB.open(DB, 1);
  rq.onupgradeneeded = () => rq.result.createObjectStore('songs', { keyPath: 'id' });
  rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
}));
const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('songs', mode); const r = fn(t.objectStore('songs')); t.oncomplete = () => res(r.result); t.onerror = () => rej(t.error); }); };
const likedKey = 'bandy.songs.demo.likes';
const urls = new Map();
const demoUser = { id: 'demo', email: 'you (this device)' };
const demoSong = (r) => ({ id: r.id, title: r.title, artist: r.artist, genre: r.genre, description: r.description, size: r.size, duration: r.duration, plays: r.plays, likes: r.likes, created_at: r.created_at, mine: true, hidden: r.hidden, url: '', blob: r.blob });

const demo = {
  mode: 'demo',
  async init() {},
  user: () => demoUser,
  async signInEmail() {}, async verifyCode() {}, async signOut() {},
  async list({ q = '', genre = 'All', sort = 'new', mine = false, offset = 0, limit = 24 } = {}) {
    let all = (await tx('readonly', (s) => s.getAll())).filter((r) => !r.hidden);
    const term = q.trim().toLowerCase();
    if (term) all = all.filter((r) => (r.title + ' ' + r.artist).toLowerCase().includes(term));
    if (genre !== 'All') all = all.filter((r) => r.genre === genre);
    const by = { new: (a, b) => b.created_at.localeCompare(a.created_at), top: (a, b) => b.likes - a.likes || b.created_at.localeCompare(a.created_at), plays: (a, b) => b.plays - a.plays || b.created_at.localeCompare(a.created_at) }[sort] || (() => 0);
    all.sort(by);
    return { items: all.slice(offset, offset + limit).map(demoSong), hasMore: all.length > offset + limit };
  },
  async likedIds() { return new Set(JSON.parse(localStorage.getItem(likedKey) || '[]')); },
  async setLike(song, like) {
    const set = await demo.likedIds(); like ? set.add(song.id) : set.delete(song.id); localStorage.setItem(likedKey, JSON.stringify([...set]));
    const r = await tx('readonly', (s) => s.get(song.id)); if (r) { r.likes = Math.max(0, r.likes + (like ? 1 : -1)); await tx('readwrite', (s) => s.put(r)); }
  },
  async report(song) { const r = await tx('readonly', (s) => s.get(song.id)); if (r) { r.hidden = true; await tx('readwrite', (s) => s.put(r)); } },
  async remove(song) { await tx('readwrite', (s) => s.delete(song.id)); urls.delete(song.id); },
  async upload(file, meta, onProgress) {
    for (let i = 1; i <= 5; i++) { onProgress?.(i / 5); await new Promise((r) => setTimeout(r, 70)); }
    const rec = { id: crypto.randomUUID(), title: meta.title.trim(), artist: meta.artist.trim(), genre: meta.genre, description: (meta.description || '').trim(), size: file.size, duration: meta.duration || null, plays: 0, likes: 0, hidden: false, created_at: new Date().toISOString(), blob: file };
    await tx('readwrite', (s) => s.put(rec));
    return demoSong(rec);
  },
  audioUrl(song) { if (!urls.has(song.id)) urls.set(song.id, URL.createObjectURL(song.blob)); return urls.get(song.id); },
  async recordPlay(song) { const r = await tx('readonly', (s) => s.get(song.id)); if (r) { r.plays++; await tx('readwrite', (s) => s.put(r)); } },
};

export const backend = mode === 'supabase' ? supabase : demo;
