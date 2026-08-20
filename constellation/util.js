// util.js — tiny shared helpers for both renderers (2D fallback + WebGL).
// Dependency-free ES module; everything here is deterministic and testable.

// Deterministic PRNG — galaxy shapes must not shimmer between frames or reloads.
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---- color helpers (hex in, css/rgb out) ----
export function hexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
export function rgba(hex, a) { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; }
export function mix(hex, to, k) {
  const A = hexRgb(hex), B = to === '#fff' ? [255, 255, 255] : [0, 0, 0];
  return `rgb(${A.map((c, i) => Math.round(c + (B[i] - c) * k)).join(',')})`;
}

export function easeC(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }

// Truncate long planet titles for on-map labels (full title lives in the tooltip/panel).
export function truncate(s, n = 26) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}
