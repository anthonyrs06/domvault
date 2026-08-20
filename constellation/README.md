# Constellation — a living brain you fly through

The public face of the vault. **Galaxies** (topics) → **stars** (people's brains) →
**planets** (published ideas) — and the point of the whole thing, the **edges**:
luminous constellation lines between linked ideas, mined from the notes themselves.
Bright arcs bridge galaxies (the interesting connections). WebGL (three.js, vendored)
with a 2D canvas fallback — the Explorer always renders.

## Run it
Plain ES modules, zero build step. Because it `fetch()`es the registry / `mock/data.json`,
serve it over HTTP (file:// blocks fetch):
```bash
cd constellation && python3 -m http.server 8080
# open http://localhost:8080
```

## The four pillars
- **The edges are the show** — `registry-static/build.mjs` mines per-planet `links`
  from explicit references and distinctive title-phrase mentions across the corpus
  (deterministic; see `links.test.ts`). Hovering a planet lights its 1–2 hop
  neighborhood; sparks arc between not-yet-linked ideas on a schedule seeded per
  session-minute (frozen under `prefers-reduced-motion`).
- **Watch it grow** — `#/timelapse` replays the universe from earliest `published_at`
  to today: planets ignite in order, edges lace in once both endpoints exist, the
  camera pulls back as it grows. ~24s autoplay, scrubbable (`timelapse.js`).
- **Free flight** — drag to orbit, scroll/pinch to fly, momentum easing, optional
  WASD. Hash routes are eased camera targets, not discrete walls; labels emerge
  with proximity (semantic zoom).
- **Land on a planet** — double-click (or "Land & read"): the camera dives and the
  note's actual markdown cross-fades in, typeset (`markdown.js`, dependency-free +
  escaped). Wiki-links and mined connections that resolve to another planet fly you
  there. Esc pulls back to space. A landing is the discovery event for the game layer.

## Data flow (the contract)
`GET ${REGISTRY}/universe` → `mapUniverseToData(u.planets)` (map.js, shared with the
Node tests) → the render shape. Manifests now carry `links` (outbound planet ids) and
`content` (the full markdown body — the files are already public in this repo).
Three-tier fallback: live registry → `mock/data.json` snapshot → inline demo. Override
the registry per-visit with `?registry=<url>`. `window.__cosmos` exposes
`{data, view, dpr, pick, edges}` for e2e checks.

## Files
- `index.html` — shell (HUD, reading panel, landing reader, timeline, onboarding, labels)
- `app.js` — UX layer: routing (`#/galaxy/<id>`, `#/star/<handle>`, `#/planet/<id>`,
  `#/read/<id>`, `#/timelapse`), fuzzy search (`/` to focus), reading panel + reader,
  time-lapse UI, keyboard nav, discovery game
- `render3d.js` — the living-brain WebGL renderer (edge layer + hover neighborhoods,
  sparks, free-flight camera, semantic-zoom labels, time-lapse, landing dive,
  quality tiers + frame-time degrade)
- `render2d.js` — 2D canvas fallback (feature-detected; v2-level, no fly/time-lapse)
- `map.js` / `routes.js` / `search.js` / `game.js` / `timelapse.js` / `markdown.js` /
  `util.js` — pure modules, each covered by a `*.test.ts` beside it (`npm test` from
  the repo root; `links.test.ts` covers the miner in `registry-static/build.mjs`)
- `vendor/three.module.js` — three.js r170, pinned + vendored (MIT, see THREE-LICENSE.md)

## The discovery layer
Client-side only (one versioned localStorage key, `constellation.state.v1` — no accounts,
no server writes): planets you land on build a personal constellation trail, per-galaxy
progress rings, ranks (Stargazer → Cosmographer), a deterministic date-hashed "today's
planet", data-derived trails (guided tours), and a shareable PNG of your map. All of it
is optional garnish — a visitor who ignores it gets the plain explorer.
