# Constellation — universe visualization

The public face of the vault: a cinematic, zoomable universe. **Galaxies** (topics) →
**stars** (people's brains) → **planets** (published notes). WebGL (three.js, vendored)
with a 2D canvas fallback — the Explorer always renders.

## Run it
Plain ES modules, zero build step. Because it `fetch()`es the registry / `mock/data.json`,
serve it over HTTP (file:// blocks fetch):
```bash
cd constellation && python3 -m http.server 8080
# open http://localhost:8080
```

## Data flow (the contract)
`GET ${REGISTRY}/universe` → `mapUniverseToData(u.planets)` (map.js, shared with the
Node tests) → the render shape. Three-tier fallback: live registry → `mock/data.json`
snapshot → inline demo. Override the registry per-visit with `?registry=<url>`.
`window.__cosmos` exposes `{data, view, dpr, pick}` for e2e checks.

## Files
- `index.html` — shell (HUD, reading panel, onboarding, labels layer)
- `app.js` — UX layer: routing (`#/galaxy/<id>`, `#/star/<handle>`, `#/planet/<id>`),
  fuzzy search (`/` to focus), reading panel, keyboard nav, discovery game
- `render3d.js` — cinematic WebGL renderer (spiral particle galaxies, nebula glow,
  shaded planets, eased camera dollies, quality tiers + frame-time degrade)
- `render2d.js` — 2D canvas fallback (feature-detected)
- `map.js` / `routes.js` / `search.js` / `game.js` / `util.js` — pure modules, each
  covered by a `*.test.ts` beside it (`npm test` from the repo root)
- `vendor/three.module.js` — three.js r170, pinned + vendored (MIT, see THREE-LICENSE.md)

## The discovery layer
Client-side only (one versioned localStorage key, `constellation.state.v1` — no accounts,
no server writes): visited planets build a personal constellation trail, per-galaxy
progress rings, ranks (Stargazer → Cosmographer), a deterministic date-hashed "today's
planet", data-derived trails (guided tours), and a shareable PNG of your map. All of it
is optional garnish — a visitor who ignores it gets the plain explorer.
