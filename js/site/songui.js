// Song card + player bar used by the Song browser (and the landing page teaser).
import { h, icon, coverStyle, coverBars } from './ui.js';
import { backend, ago, fmtDur } from './backend.js';

const num = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n));

// handlers: { onPlay(song), onLike(song, liked), onReport(song), onDelete(song) } - any may be omitted
export function songCard(song, { liked = false, handlers = {}, playing = false, compact = false } = {}) {
  const seed = song.id + song.title;
  const play = h('button', { class: 'pbtn', 'aria-label': `Play ${song.title}`, html: icon('play', 22), onclick: () => handlers.onPlay?.(song) });
  const like = h('button', { class: 'ibtn' + (liked ? ' liked' : ''), 'aria-pressed': String(liked), 'aria-label': 'Like', title: 'Like', html: icon('heart', 17) + `<span>${num(song.likes)}</span>`,
    onclick: () => handlers.onLike?.(song, like) });
  const foot = h('div', { class: 'song-foot' }, h('span', null, `${fmtDur(song.duration)} · ${num(song.plays)} plays`), h('span', { class: 'sp' }));
  if (!compact) {
    foot.append(like);
    if (song.mine) foot.append(h('button', { class: 'ibtn', title: 'Delete your upload', 'aria-label': 'Delete', html: icon('trash', 16), onclick: () => handlers.onDelete?.(song) }));
    else foot.append(h('button', { class: 'ibtn', title: 'Report this song', 'aria-label': 'Report', html: icon('flag', 16), onclick: () => handlers.onReport?.(song) }));
  }
  return h('article', { class: 'song' + (playing ? ' playing' : ''), dataset: { id: song.id } },
    h('div', { class: 'cover', style: { '--g': coverStyle(seed) }, html: coverBars(seed) }, h('span', { class: 'tag' }, song.genre), play),
    h('div', { class: 'song-body' },
      h('h3', { title: song.title }, song.title), h('div', { class: 'by' }, `${song.artist} · ${ago(song.created_at)}`),
      song.description && !compact ? h('p', { class: 'desc' }, song.description) : null, foot));
}

export function createPlayer(root = document.body) {
  const audio = new Audio(); audio.preload = 'none';
  let queue = [], idx = -1, listeners = new Set();
  const cover = h('div', { class: 'pl-cover' }), title = h('b'), artist = h('span');
  const btn = h('button', { class: 'pbig', 'aria-label': 'Play / pause', html: icon('play', 18), onclick: () => (audio.paused ? audio.play() : audio.pause()) });
  const prev = h('button', { class: 'ibtn', 'aria-label': 'Previous', html: icon('prev', 18), onclick: () => step(-1) });
  const next = h('button', { class: 'ibtn', 'aria-label': 'Next', html: icon('next', 18), onclick: () => step(1) });
  const cur = h('span', { class: 'time' }, '0:00'), dur = h('span', { class: 'time' }, '0:00');
  const seek = h('input', { class: 'seek', type: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'Seek' });
  const vol = h('input', { class: 'vol', type: 'range', min: 0, max: 100, value: 85, 'aria-label': 'Volume' });
  const close = h('button', { class: 'ibtn', 'aria-label': 'Close player', html: icon('x', 16), onclick: () => { audio.pause(); el.classList.remove('show'); idx = -1; emit(); } });
  const el = h('div', { class: 'player', role: 'region', 'aria-label': 'Player' },
    h('div', { class: 'pl-info' }, cover, h('div', { class: 'pl-t' }, title, artist)),
    h('div', { class: 'pl-mid' }, prev, btn, next, cur, seek, dur),
    h('div', { class: 'pl-right' }, h('span', { html: icon('vol', 18), style: { color: 'var(--dim)' } }), vol, close));
  root.append(el);

  const setFill = (inp) => inp.style.setProperty('--p', (inp.value / inp.max) * 100 + '%');
  const fmt = (s) => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
  const emit = () => listeners.forEach((fn) => fn(current(), !audio.paused));
  const current = () => queue[idx] || null;

  function load(i) {
    idx = i; const s = queue[i]; if (!s) return;
    audio.src = backend.audioUrl(s);
    cover.style.setProperty('--g', coverStyle(s.id + s.title)); title.textContent = s.title; artist.textContent = s.artist;
    el.classList.add('show'); audio.play().catch(() => {}); backend.recordPlay?.(s);
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: s.artist, album: 'Bandy Song browser' });
    emit();
  }
  function step(d) { if (!queue.length) return; load((idx + d + queue.length) % queue.length); }
  audio.addEventListener('play', () => { btn.innerHTML = icon('pause', 18); emit(); });
  audio.addEventListener('pause', () => { btn.innerHTML = icon('play', 18); emit(); });
  audio.addEventListener('ended', () => (queue.length > 1 ? step(1) : emit()));
  audio.addEventListener('loadedmetadata', () => { dur.textContent = fmt(audio.duration); });
  audio.addEventListener('timeupdate', () => { if (!seeking && audio.duration) { seek.value = (audio.currentTime / audio.duration) * 1000; setFill(seek); } cur.textContent = fmt(audio.currentTime); });
  audio.addEventListener('error', () => { title.textContent = 'Could not play this file'; });
  let seeking = false;
  seek.addEventListener('pointerdown', () => (seeking = true)); seek.addEventListener('pointerup', () => (seeking = false));
  seek.addEventListener('input', () => { setFill(seek); if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration; });
  vol.addEventListener('input', () => { audio.volume = vol.value / 100; setFill(vol); });
  audio.volume = 0.85; setFill(vol); setFill(seek);
  if ('mediaSession' in navigator) { navigator.mediaSession.setActionHandler('previoustrack', () => step(-1)); navigator.mediaSession.setActionHandler('nexttrack', () => step(1)); }

  return {
    play(song, list) {
      if (current()?.id === song.id) { audio.paused ? audio.play() : audio.pause(); return; }
      queue = list && list.length ? list : [song]; load(Math.max(0, queue.findIndex((s) => s.id === song.id)));
    },
    onChange(fn) { listeners.add(fn); },
    current,
    get playing() { return !audio.paused; },
    update(song) { const i = queue.findIndex((s) => s.id === song.id); if (i >= 0) queue[i] = song; },
    drop(song) { const i = queue.findIndex((s) => s.id === song.id); if (i < 0) return; if (i === idx) { audio.pause(); el.classList.remove('show'); idx = -1; } else if (i < idx) idx--; queue.splice(i, 1); },
  };
}
