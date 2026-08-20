// timelapse.js — pure logic for the "watch it grow" replay (#/timelapse) AND the
// simulated-growth loading cinematic: deterministic ignition order/timing of the
// universe and which planets/edges exist at a given playback position. No DOM,
// no renderer — imported by app.js AND timelapse.test.ts.

import { allPlanets, planetKey } from './game.js';
import { mulberry32, hashStr } from './util.js';

/**
 * The ignition order: earliest published_at first, ties broken by title then id
 * so the replay is stable even when a whole corpus shares one publish commit
 * (which the current frameworks write-back does).
 * @returns {Array<{id:string, title:string, at:string|null}>} deduped by planet id
 */
export function timelapseOrder(data) {
  return allPlanets(data)
    .map((e) => ({
      id: e.id,
      title: e.p.name ? String(e.p.name) : String(e.p),
      at: (e.p.manifest && e.p.manifest.published_at) || null,
    }))
    .sort((a, b) =>
      String(a.at || '').localeCompare(String(b.at || '')) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id));
}

/**
 * Playback position t ∈ [0,1] → how many planets have ignited. Eases nothing:
 * the renderer decides the flourish; this is the single source of truth for
 * "does planet i exist yet".
 */
export function ignitedCount(order, t) {
  const k = Math.max(0, Math.min(1, Number(t) || 0));
  return Math.round(k * order.length);
}

/** The set of planet ids alive at position t. */
export function ignitedSet(order, t) {
  return new Set(order.slice(0, ignitedCount(order, t)).map((o) => o.id));
}

/**
 * Edges visible at position t: an edge laces in only once BOTH endpoints exist.
 * @param {Array<[string,string]>} edges undirected id pairs
 */
export function visibleEdges(edges, order, t) {
  const alive = ignitedSet(order, t);
  return edges.filter(([a, b]) => alive.has(a) && alive.has(b));
}

/** Collect the deduped undirected edge list [idA,idB] from manifest links. */
export function collectEdges(data) {
  const ids = new Set(allPlanets(data).map((e) => e.id));
  const seen = new Set(), out = [];
  for (const e of allPlanets(data)) {
    for (const to of (e.p.manifest && e.p.manifest.links) || []) {
      if (!ids.has(to) || to === e.id) continue; // unresolved / self links dropped
      const k = e.id < to ? e.id + '|' + to : to + '|' + e.id;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e.id < to ? [e.id, to] : [to, e.id]);
    }
  }
  return out;
}

// ---- SIMULATED growth (v4): the real per-planet dates are degenerate (one publish
// commit), so the replay tells a PLAUSIBLE story instead — always labeled "growth,
// simulated" in the UI, never presented as real history. Narrative: one first spark
// ignites alone → the founding (most-connected) galaxy accretes around it → other
// domains ignite as island galaxies → in-galaxy edges lace as domains mature → the
// first cross-galaxy bridge → bridges densify → today's universe.
//
// Deterministic: one PRNG seeded from the sorted planet ids; NO Math.random.

/**
 * Simulate a growth history for the universe.
 * @returns {{
 *   planets: Array<{id:string, t:number, galaxy:string}>,  // sorted by t (t∈[0,~0.94])
 *   edges: Array<{a:string, b:string, key:string, cross:boolean, t:number}>, // sorted by t
 *   firstBridge: {a:string, b:string, key:string, t:number}|null,
 *   phases: {domains:number, bridge:number},               // caption boundaries
 * }}
 */
export function simulateGrowth(data) {
  const entries = allPlanets(data); // deduped; e.g = the planet's FIRST (primary) galaxy
  const edges = collectEdges(data);
  const rnd = mulberry32(hashStr('growth:' + entries.map((e) => e.id).sort().join('|')));

  // edge degree per planet (hubs ignite early) + primary galaxy per planet
  const deg = new Map();
  for (const [a, b] of edges) {
    deg.set(a, (deg.get(a) || 0) + 1);
    deg.set(b, (deg.get(b) || 0) + 1);
  }
  const prim = new Map(entries.map((e) => [e.id, e.g.id]));

  // galaxy connectivity = edge endpoints landing in it → the most-connected founds first
  const conn = new Map(), size = new Map();
  for (const e of entries) size.set(e.g.id, (size.get(e.g.id) || 0) + 1);
  for (const [a, b] of edges) {
    conn.set(prim.get(a), (conn.get(prim.get(a)) || 0) + 1);
    conn.set(prim.get(b), (conn.get(prim.get(b)) || 0) + 1);
  }
  const galOrder = [...size.keys()].sort((x, y) =>
    (conn.get(y) || 0) - (conn.get(x) || 0) ||
    (size.get(y) || 0) - (size.get(x) || 0) ||
    String(x).localeCompare(String(y)));

  const byGal = new Map(galOrder.map((g) => [g, []]));
  for (const e of entries) byGal.get(e.g.id).push(e);
  const hubsFirst = (a, b) =>
    (deg.get(b.id) || 0) - (deg.get(a.id) || 0) ||
    String(a.p.name || '').localeCompare(String(b.p.name || '')) ||
    a.id.localeCompare(b.id);

  // ignition ticks: bursts + quiet gaps, later galaxies overlap the earlier tail
  let horizon = 0;
  const planets = [], tOf = new Map();
  galOrder.forEach((gid, gi) => {
    let t = gi === 0 ? 0 : horizon * (0.55 + rnd() * 0.2);
    for (const [i, e] of byGal.get(gid).sort(hubsFirst).entries()) {
      planets.push({ id: e.id, t, galaxy: gid });
      tOf.set(e.id, t);
      if (gi === 0 && i === 0) t += 6 + rnd() * 2;                       // the first spark holds alone
      else t += rnd() < 0.22 ? 2.5 + rnd() * 3.5 : 0.35 + rnd() * 1.1;   // burst … quiet gap … burst
      horizon = Math.max(horizon, t);
    }
  });

  // edges lace strictly after both endpoints; bridges linger longer before appearing
  const simEdges = edges.map(([a, b]) => {
    const cross = prim.get(a) !== prim.get(b);
    const t = Math.max(tOf.get(a), tOf.get(b)) + (cross ? 2.2 + rnd() * 4.5 : 0.6 + rnd() * 2.2);
    return { a, b, key: a + '|' + b, cross, t };
  });

  // normalize into [0, ~0.94] — uniform scale preserves every ordering invariant,
  // and the tail leaves room for the camera to settle on today's universe
  const maxT = Math.max(...planets.map((p) => p.t), ...simEdges.map((e) => e.t), 1);
  const k = 0.94 / maxT;
  for (const p of planets) p.t *= k;
  for (const e of simEdges) e.t *= k;
  planets.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  simEdges.sort((a, b) => a.t - b.t || a.key.localeCompare(b.key));

  const firstBridge = simEdges.find((e) => e.cross) || null;
  const secondGal = planets.find((p) => p.galaxy !== galOrder[0]);
  return {
    planets, edges: simEdges, firstBridge,
    phases: {
      domains: secondGal ? secondGal.t : 0.3,
      bridge: firstBridge ? firstBridge.t : 0.65,
    },
  };
}

/** How many simulated planets have ignited by position t (for the scrubber label). */
export function simIgnitedCount(sim, t) {
  const k = Math.max(0, Math.min(1, Number(t) || 0));
  let n = 0;
  for (const p of sim.planets) { if (p.t <= k) n++; else break; } // planets sorted by t
  return n;
}

export { planetKey };
