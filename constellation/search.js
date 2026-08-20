// search.js — fuzzy planet search over titles + tags. Pure functions (no DOM),
// imported by app.js AND search.test.ts.

/**
 * Score `query` against `text`. 0 = no match. Substring matches dominate; otherwise an
 * ordered-subsequence match scores by contiguity + word-boundary hits (classic fuzzy-finder).
 */
export function fuzzyScore(query, text) {
  const q = String(query).toLowerCase().trim(), t = String(text).toLowerCase();
  if (!q) return 0;
  const ix = t.indexOf(q);
  if (ix >= 0) return 100 - Math.min(ix, 40) + (ix === 0 ? 15 : 0) + (q.length / Math.max(t.length, 1)) * 20;
  let ti = 0, score = 0, run = 0;
  for (const ch of q) {
    if (ch === ' ') { run = 0; continue; } // spaces separate fuzzy tokens
    const f = t.indexOf(ch, ti);
    if (f < 0) return 0;
    run = f === ti ? run + 1 : 1;
    score += 1 + run + (f === 0 || /[^a-z0-9]/.test(t[f - 1] || '') ? 3 : 0);
    ti = f + 1;
  }
  return score;
}

/**
 * @param {{galaxies:Array}} data - the renderer's data shape
 * @returns {Array<{p,s,g,title,score}>} best-first, deduped by manifest id (a multi-galaxy
 *   planet appears once, under the first galaxy that carries it)
 */
export function searchPlanets(data, query, limit = 8) {
  const q = String(query || '').trim();
  if (!q) return [];
  const out = [], seen = new Set();
  for (const g of (data && data.galaxies) || []) for (const s of g.stars || []) for (const p of s.planets || []) {
    const title = p && p.name ? String(p.name) : String(p);
    const key = (p && p.manifest && p.manifest.id) || title;
    if (seen.has(key)) continue;
    let sc = fuzzyScore(q, title) * 2;
    let tagBest = 0;
    for (const tag of (p && p.manifest && p.manifest.tags) || []) tagBest = Math.max(tagBest, fuzzyScore(q, tag));
    sc += tagBest;
    if (sc > 0) { seen.add(key); out.push({ p, s, g, title, score: sc }); }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
