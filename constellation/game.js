// game.js — the client-side discovery layer: visited planets, ranks, today's planet,
// derived trails. All state lives in ONE versioned localStorage key (this is a static
// site — no accounts, no server writes). Pure logic is separated from storage so
// game.test.ts can exercise it without a DOM.

import { hashStr } from './util.js';

export const STATE_KEY = 'constellation.state.v1';

export function emptyState() {
  return { v: 1, discovered: [], trailsDone: [], showConstellation: true, onboarded: false };
}

// Storage may be unavailable (private mode, file://) — the game layer degrades to
// session-only silently; the explorer itself never depends on it.
export function loadState(storage) {
  try {
    const raw = storage.getItem(STATE_KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    if (!s || s.v !== 1 || !Array.isArray(s.discovered)) return emptyState();
    return { ...emptyState(), ...s };
  } catch { return emptyState(); }
}
export function saveState(storage, state) {
  try { storage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* session-only */ }
}

export function planetKey(p) { return (p && p.manifest && p.manifest.id) || (p && p.name) || String(p); }

/** Mark a planet discovered (visit order preserved). Returns true if it was new. */
export function discover(state, p) {
  const id = planetKey(p);
  if (state.discovered.some((d) => d.id === id)) return false;
  state.discovered.push({ id, at: new Date().toISOString() });
  return true;
}
export function discoveredSet(state) { return new Set(state.discovered.map((d) => d.id)); }

// ---- universe accounting ----
export function allPlanets(data) {
  const out = [], seen = new Set();
  for (const g of (data && data.galaxies) || []) for (const s of g.stars || []) for (const p of s.planets || []) {
    const k = planetKey(p);
    if (seen.has(k)) continue; seen.add(k);
    out.push({ p, s, g, id: k });
  }
  return out;
}
export function galaxyProgress(state, g) {
  const set = discoveredSet(state), seen = new Set();
  let done = 0, total = 0;
  for (const s of g.stars || []) for (const p of s.planets || []) {
    const k = planetKey(p);
    if (seen.has(k)) continue; seen.add(k);
    total++; if (set.has(k)) done++;
  }
  return { done, total };
}
export function completion(state, data) {
  const all = allPlanets(data), set = discoveredSet(state);
  const done = all.filter((e) => set.has(e.id)).length;
  return { done, total: all.length, pct: all.length ? Math.round((done / all.length) * 100) : 0 };
}

// ---- ranks (ordered; highest satisfied wins) ----
export const RANKS = [
  { name: 'Observer',     test: () => true },
  { name: 'Stargazer',    test: (c) => c.done >= 1 },
  { name: 'Navigator',    test: (c) => c.done >= 10 },
  { name: 'Cartographer', test: (c) => c.done >= 25 },
  { name: 'Astronomer',   test: (c, gal) => gal },              // any one galaxy fully explored
  { name: 'Cosmographer', test: (c) => c.total > 0 && c.done >= c.total }, // 100%
];
export function computeRank(state, data) {
  const c = completion(state, data);
  const galaxyCleared = ((data && data.galaxies) || []).some((g) => {
    const gp = galaxyProgress(state, g); return gp.total > 0 && gp.done >= gp.total;
  });
  let idx = 0;
  RANKS.forEach((r, i) => { if (r.test(c, galaxyCleared)) idx = i; });
  return { name: RANKS[idx].name, index: idx, completion: c, galaxyCleared };
}

// ---- today's planet: deterministic from the date, NO Math.random ----
export function todaysPlanet(data, dateStr) {
  const all = allPlanets(data);
  if (!all.length) return null;
  const ids = all.map((e) => e.id).sort(); // stable across galaxy iteration order
  const pick = ids[hashStr(String(dateStr)) % ids.length];
  return all.find((e) => e.id === pick) || null;
}

// ---- trails: 2-3 guided tours DERIVED from the data (planet ids change as the
// registry grows, so nothing is hardcoded) ----
export function deriveTrails(data) {
  const gs = ((data && data.galaxies) || []).filter((g) => g.stars && g.stars.length);
  if (!gs.length) return [];
  const trails = [];
  const byTitle = (a, b) => a.title.localeCompare(b.title);
  const entries = (g) => {
    const seen = new Set(), out = [];
    for (const s of g.stars) for (const p of s.planets) {
      const k = planetKey(p); if (seen.has(k)) continue; seen.add(k);
      out.push({ p, s, g, id: k, title: p.name ? String(p.name) : String(p) });
    }
    return out.sort(byTitle);
  };
  // 1. Grand tour — one planet from every galaxy, a lap around the whole universe.
  const grand = gs.map((g) => entries(g)[0]).filter(Boolean);
  if (grand.length >= 2) trails.push({ id: 'grand-tour', name: 'Grand tour', desc: 'One idea from every galaxy', stops: grand });
  // 2. Deep dive — up to 5 planets spread across the largest galaxy.
  const largest = [...gs].sort((a, b) => entries(b).length - entries(a).length)[0];
  const le = entries(largest);
  if (le.length >= 3) {
    const step = Math.max(1, Math.floor(le.length / 5));
    const stops = []; for (let i = 0; i < le.length && stops.length < 5; i += step) stops.push(le[i]);
    trails.push({ id: 'deep-' + largest.id, name: 'Deep dive: ' + largest.name, desc: 'Five ideas from the largest galaxy', stops });
  }
  // 3. Common thread — planets sharing the most frequent tag (lineage first if moons exist).
  const all = allPlanets(data);
  const moons = all.filter((e) => e.p.manifest && e.p.manifest.origin && String(e.p.manifest.origin).startsWith('planet_'));
  if (moons.length >= 2) {
    trails.push({ id: 'lineage', name: 'Lineage trail', desc: 'Forked ideas and where they came from', stops: moons.slice(0, 5) });
  } else {
    const freq = new Map();
    for (const e of all) for (const t of (e.p.manifest && e.p.manifest.tags) || []) {
      if (t === 'framework') continue; // omnipresent tag says nothing
      freq.set(t, (freq.get(t) || 0) + 1);
    }
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 2) {
      const stops = all.filter((e) => ((e.p.manifest && e.p.manifest.tags) || []).includes(top[0])).slice(0, 5);
      trails.push({ id: 'thread-' + top[0], name: 'Common thread: ' + top[0], desc: 'Ideas sharing one tag across galaxies', stops });
    }
  }
  return trails.slice(0, 3);
}
