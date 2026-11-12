// Monophonic pitch detection (autocorrelation) used by the tuner.
export function detectPitch(buf, sr) {
  const n = buf.length; let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n); if (rms < 0.008) return 0;
  const minLag = Math.floor(sr / 1200), maxLag = Math.min(Math.floor(sr / 60), n >> 1);
  const c = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag++) { let s = 0, e = 0; for (let i = 0; i < n - lag; i++) { s += buf[i] * buf[i + lag]; e += buf[i + lag] * buf[i + lag]; } c[lag] = s / (Math.sqrt(e * rms * rms * n) + 1e-9); }
  let best = 0, bl = 0;
  for (let lag = minLag + 1; lag < maxLag; lag++) if (c[lag] > c[lag - 1] && c[lag] >= c[lag + 1] && c[lag] > 0.55) { if (c[lag] > best) { best = c[lag]; bl = lag; } if (best > 0.92) break; }
  if (!bl) return 0;
  const a = c[bl - 1], b = c[bl], d = c[bl + 1], den = a - 2 * b + d;
  return sr / (den ? bl + (0.5 * (a - d)) / den : bl);
}
