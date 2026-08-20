// timelapse.js — pure logic for the "watch it grow" replay (#/timelapse): the
// deterministic ignition order of the universe and which planets/edges exist at
// a given playback position. No DOM, no renderer — imported by app.js AND
// timelapse.test.ts.

import { allPlanets, planetKey } from './game.js';

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

export { planetKey };
