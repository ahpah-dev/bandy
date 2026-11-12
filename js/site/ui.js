// Small DOM helpers and icons shared by the landing page and the Song browser.
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) (sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv)); }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

const P = {
  play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
  next: '<path d="M6 5.5v13l10-6.5z" fill="currentColor" stroke="none"/><path d="M19 5v14"/>',
  prev: '<path d="M18 5.5v13L8 12z" fill="currentColor" stroke="none"/><path d="M5 5v14"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.700 3.700 4.500 7 4.500c2 0 3.400 1 5 3 1.600-2 3-3 5-3 3.300 0 5.400 3.200 4.200 6.600-1.700 4.800-9.200 9.400-9.200 9.400z"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3M8 21h8"/>',
  piano: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 5v14M15 5v14"/><path d="M7 5v8M12 5v8M17 5v8" stroke-width="3"/>',
  sliders: '<path d="M6 4v16M12 4v16M18 4v16"/><rect x="4" y="13" width="4" height="3" rx="1" fill="currentColor"/><rect x="10" y="7" width="4" height="3" rx="1" fill="currentColor"/><rect x="16" y="11" width="4" height="3" rx="1" fill="currentColor"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5M3 17.500l9 5 9-5"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
  sparkle: '<path d="M12 3l1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800z"/><path d="M19 16l.8 2.200L22 19l-2.200.8L19 22l-.8-2.200L16 19l2.200-.8z"/>',
  drum: '<ellipse cx="12" cy="8" rx="8" ry="3"/><path d="M4 8v8c0 1.700 3.600 3 8 3s8-1.300 8-3V8M8 11l-2 8M16 11l2 8"/>',
  loops: '<path d="M4 8h10a4 4 0 010 8H8"/><path d="M7 5L4 8l3 3M10 13l-3 3 3 3"/>',
  github: '<path d="M12 2a10 10 0 00-3.200 19.500c.5.100.7-.2.7-.5v-1.800c-2.800.6-3.400-1.200-3.400-1.200-.5-1.200-1.100-1.500-1.100-1.500-.9-.6.100-.6.100-.6 1 .1 1.500 1 1.500 1 .9 1.500 2.400 1.100 3 .8.1-.7.4-1.100.7-1.400-2.200-.3-4.600-1.100-4.600-5 0-1.100.4-2 1-2.700-.1-.3-.4-1.300.1-2.700 0 0 .8-.3 2.700 1a9.400 9.400 0 015 0c1.900-1.300 2.700-1 2.700-1 .5 1.400.2 2.400.1 2.700.6.700 1 1.600 1 2.700 0 3.900-2.400 4.700-4.600 5 .4.300.7.900.7 1.800v2.700c0 .3.200.6.700.5A10 10 0 0012 2z" fill="currentColor" stroke="none"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  vol: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.500 8.500a5 5 0 010 7"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  code: '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.400 3.600-7 8-7s8 2.600 8 7"/>',
  logout: '<path d="M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4M16 8l4 4-4 4M20 12H9"/>',
};
export const icon = (n, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

export const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lgx" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5a3c"/><stop offset="1" stop-color="#e0173d"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#lgx)"/><g fill="#fff"><rect x="6" y="13" width="3" height="6" rx="1.5"/><rect x="11" y="8" width="3" height="16" rx="1.5"/><rect x="16" y="11" width="3" height="10" rx="1.5"/><rect x="21" y="6" width="3" height="20" rx="1.5"/></g></svg>';

// deterministic gradient + bars "cover art" for a song
const hash = (s) => { let x = 2166136261; for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; };
export function coverStyle(seed) {
  const n = hash(seed), h1 = n % 360, h2 = (h1 + 40 + ((n >> 8) % 90)) % 360;
  return `linear-gradient(135deg, hsl(${h1} 85% 58%), hsl(${h2} 80% 38%))`;
}
export function coverBars(seed) {
  let s = hash(seed) || 1; const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const bars = [...Array(26)].map((_, i) => { const hgt = 14 + r() * 62 * (0.45 + 0.55 * Math.sin((i / 25) * Math.PI)); return `<rect x="${6 + i * 3.6}" y="${50 - hgt / 2}" width="2.2" height="${hgt}" rx="1.1"/>`; }).join('');
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" fill="rgba(255,255,255,.34)">${bars}</svg>`;
}

export function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast', role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), 3200);
}
export function modal(content, { onClose } = {}) {
  const back = h('div', { class: 'modal-back' }), box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, content);
  const close = () => { back.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  back.append(box); back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', esc); document.body.append(back);
  return { close, box };
}

// shared nav behaviour + scroll reveal
export function initChrome() {
  const links = document.querySelector('.nav-links'), btn = document.querySelector('.menu-btn');
  btn?.addEventListener('click', () => links.classList.toggle('open'));
  links?.addEventListener('click', (e) => { if (e.target.tagName === 'A') links.classList.remove('open'); });
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
  document.querySelectorAll('.rv').forEach((el) => io.observe(el));
  document.querySelectorAll('.feature').forEach((f) => f.addEventListener('pointermove', (e) => { const r = f.getBoundingClientRect(); f.style.setProperty('--mx', e.clientX - r.left + 'px'); f.style.setProperty('--my', e.clientY - r.top + 'px'); }));
}
