// routes.js — URL-hash deep links for the Explorer, so every view is shareable and
// back/forward work. Pure functions (no window), imported by app.js AND routes.test.ts.
//
//   #/                  → universe
//   #/galaxy/<id>       → one topic galaxy
//   #/star/<handle>     → one brain (star)
//   #/planet/<id>       → the owning star's view + that planet's reading panel

export function parseRoute(hash) {
  const h = String(hash || '').replace(/^#\/?/, '');
  if (!h) return { kind: 'universe' };
  const [kind, ...rest] = h.split('/');
  const id = decodeURIComponent(rest.join('/') || '');
  if ((kind === 'galaxy' || kind === 'star' || kind === 'planet') && id) return { kind, id };
  return { kind: 'universe' };
}

export function formatRoute(r) {
  if (!r || r.kind === 'universe') return '#/';
  return '#/' + r.kind + '/' + encodeURIComponent(r.id);
}

/**
 * Resolve a parsed route against the render dataset.
 * A handle can own a star in SEVERAL galaxies (the data shape buckets stars per galaxy),
 * so `#/star/<handle>` prefers the galaxy already in view before falling back to the first.
 * @returns {{view:{mode:string,galaxy?:object,star?:object}, planet:object|null}|null} null = broken link
 */
export function resolveRoute(route, data, current) {
  const gs = (data && data.galaxies) || [];
  if (route.kind === 'galaxy') {
    const g = gs.find((g) => g.id === route.id);
    return g ? { view: { mode: 'galaxy', galaxy: g }, planet: null } : null;
  }
  if (route.kind === 'star') {
    const pref = current && (current.galaxy || (current.star && current.star.gal));
    const inPref = pref && pref.stars && pref.stars.find((s) => s.handle === route.id);
    if (inPref) return { view: { mode: 'star', star: inPref }, planet: null };
    for (const g of gs) {
      const s = g.stars.find((s) => s.handle === route.id);
      if (s) return { view: { mode: 'star', star: s }, planet: null };
    }
    return null;
  }
  if (route.kind === 'planet') {
    for (const g of gs) for (const s of g.stars) {
      const p = s.planets.find((p) => p && p.manifest && p.manifest.id === route.id);
      if (p) return { view: { mode: 'star', star: s }, planet: p };
    }
    return null;
  }
  return { view: { mode: 'universe', galaxy: null, star: null }, planet: null };
}
