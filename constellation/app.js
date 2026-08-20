// app.js — the Explorer's UX layer: data loading (live registry → mock snapshot →
// inline demo; the Explorer ALWAYS renders), hash routing/deep links, search, the
// reading panel, onboarding, keyboard nav, and the client-side discovery game.
// Rendering is delegated to render3d.js (WebGL) or render2d.js (canvas fallback).

import { mapUniverseToData, GALAXY_CATALOG } from './map.js';
import { DEFAULT_REGISTRY } from './registry.config.js';
import { parseRoute, formatRoute, resolveRoute } from './routes.js';
import { searchPlanets } from './search.js';
import {
  loadState, saveState, discover, discoveredSet, planetKey,
  galaxyProgress, completion, computeRank, todaysPlanet, deriveTrails,
} from './game.js';

// Registry base URL: ?registry=<url> overrides the configured default.
const REGISTRY = new URLSearchParams(location.search).get('registry') || DEFAULT_REGISTRY;
const TOUCH = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (id) => document.getElementById(id);
const cv = $('c'), tip = $('tip'), crumbs = $('crumbs'), sourceEl = $('source'), statsEl = $('stats');
const panel = $('panel'), panelBody = $('panelBody'), q = $('q'), resultsEl = $('results');
const toastEl = $('toast'), tourBar = $('tourbar'), obEl = $('onboard');

let renderer = null;
let DATA = { galaxies: [] };
let view = { mode: 'universe', galaxy: null, star: null };
let openPlanet = null;          // the planet whose reading panel is open
let state = loadState(localStorage);
let today = null, trails = [], tour = null;
let lastRankIdx = 0;
let kbIdx = -1;                 // keyboard planet-cycling index (star view)

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const persist = () => saveState(localStorage, state);

// ---------- renderer boot: WebGL first, 2D canvas fallback (always renders) ----------
function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch { return false; }
}
async function bootRenderer() {
  if (webglAvailable()) {
    try {
      const mod = await import('./render3d.js');
      return mod.createRenderer({ canvas: cv, labelLayer: $('labels'), touch: TOUCH, reduced: REDUCED });
    } catch (e) { console.warn('WebGL renderer failed, falling back to 2D:', e); }
  }
  const mod = await import('./render2d.js');
  return mod.createRenderer({ canvas: cv, touch: TOUCH, reduced: REDUCED });
}

// ---------- routing (deep links; back/forward just work) ----------
function navigate(route) {
  const h = formatRoute(route);
  if (location.hash === h) applyRoute(); else location.hash = h;
}
function upLevel() {
  if (view.mode === 'star') navigate({ kind: 'galaxy', id: view.star.gal.id });
  else if (view.mode === 'galaxy') navigate({ kind: 'universe' });
}
function applyRoute(opts = {}) {
  const resolved = resolveRoute(parseRoute(location.hash), DATA, view) ||
    { view: { mode: 'universe', galaxy: null, star: null }, planet: null }; // broken link → home
  view = resolved.view;
  kbIdx = -1;
  renderer.setView(view, { instant: opts.instant, keepIntro: opts.keepIntro });
  if (resolved.planet) openPanel(resolved.planet);
  else { hidePanel(); renderer.focusPlanet(null); }
  renderCrumbs();
}
addEventListener('hashchange', () => applyRoute());

function renderCrumbs() {
  let html = '<a data-l="u">Universe</a>';
  if (view.mode === 'galaxy' || view.mode === 'star') {
    const g = view.galaxy || view.star.gal;
    html += '<span class="sep">›</span><a data-l="g">' + esc(g.name) + '</a>';
  }
  if (view.mode === 'star') html += '<span class="sep">›</span><span>' + esc(view.star.display) + '</span>';
  crumbs.innerHTML = html;
  crumbs.querySelectorAll('a').forEach((a) => a.onclick = () => {
    if (a.dataset.l === 'u') navigate({ kind: 'universe' });
    else navigate({ kind: 'galaxy', id: (view.galaxy || view.star.gal).id });
  });
}

// ---------- reading panel (side panel; bottom sheet w/ drag-dismiss on phones) ----------
function galaxyChip(gid) {
  const g = DATA.galaxies.find((g) => g.id === gid);
  const color = g ? g.color : '#9aa0b5';
  const name = g ? g.name : (GALAXY_CATALOG[gid]?.name || gid);
  return `<span class="chip" style="border-color:${color};color:${color}">${esc(name)}</span>`;
}
function row(k, v) { return '<div class="prow"><span>' + k + '</span><div>' + v + '</div></div>'; }
function openPanel(p) {
  openPlanet = p;
  const m = p.manifest;
  const id = planetKey(p);
  const isNew = discover(state, p);
  if (isNew) { persist(); refreshGame(); }
  renderer.focusPlanet(p);
  const link = location.origin + location.pathname + location.search + formatRoute({ kind: 'planet', id });
  if (!m) {
    panelBody.innerHTML = '<h2>' + esc(p.name) + '</h2>';
  } else {
    const lineage = m.origin ? ('moon of <code>' + esc(m.origin) + '</code>') : 'origin planet (no fork)';
    const price = m.price ? (m.price.amount + ' ' + (m.price.currency || '') + ' → grants ' + esc(m.price.grants_license || '')) : 'free';
    panelBody.innerHTML =
      '<h2>' + esc(m.title) + '</h2>' +
      (m.summary ? '<div class="psum">' + esc(m.summary) + '</div>' : '') +
      row('author', esc(m.author?.display || m.author?.handle || '—') + ' <span class="dim">(' + esc(m.author?.star || '') + ')</span>') +
      row('galaxy', (m.galaxy || []).map(galaxyChip).join(' ') || '—') +
      row('license', esc(m.license || '—')) +
      row('lineage', lineage) +
      row('version', 'v' + esc(String(m.version ?? 1)) + ' · ' + esc((m.published_at || '').slice(0, 10))) +
      row('price', price) +
      row('id', '<code class="pid">' + esc(m.id || '') + '</code>') +
      (m.signature ? '<div class="signed">✓ signed manifest (authorship provable)</div>' : '') +
      '<div class="discovered-note">' + (isNew ? '✦ New discovery — added to your constellation' : '✓ In your constellation') + '</div>';
  }
  $('copyLink').onclick = async () => {
    try { await navigator.clipboard.writeText(link); toast('Link copied'); }
    catch { prompt('Copy this link:', link); }
  };
  panel.style.display = 'flex'; panel.style.transform = '';
}
function hidePanel() { panel.style.display = 'none'; openPlanet = null; }
function closePanel() {
  // if the URL points at this planet, back the route up to its star (keeps history sane)
  if (openPlanet && parseRoute(location.hash).kind === 'planet') navigate({ kind: 'star', id: view.star.handle });
  else { hidePanel(); renderer.focusPlanet(null); }
}
$('panelClose').onclick = closePanel;
// bottom-sheet drag-to-dismiss (phones)
{
  let y0 = null, dy = 0;
  const grip = $('panelGrip');
  grip.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; dy = 0; }, { passive: true });
  grip.addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    panel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  grip.addEventListener('touchend', () => {
    if (dy > 90) closePanel(); else panel.style.transform = '';
    y0 = null;
  }, { passive: true });
}

// ---------- tooltip ----------
function galaxyName(id) { return GALAXY_CATALOG[id]?.name || String(id).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }
function marker(color) { return '<span class="dot" style="color:' + color + '"></span>'; }
function tipHTML(hit) {
  const o = hit.o;
  if (hit.type === 'galaxy') {
    const n = o.stars.length, prog = galaxyProgress(state, o);
    const explored = prog.done > 0 ? ` · ${prog.done}/${prog.total} explored` : '';
    return `<div class="tt">${marker(o.color)}${esc(o.name)}</div><div class="ts">Topic galaxy — ${n} ${n === 1 ? 'brain' : 'brains'} publishing ideas here${explored}. Tap to zoom in.</div>`;
  }
  if (hit.type === 'star') {
    const n = o.planets.length;
    return `<div class="tt">${marker('#ffd76a')}${esc(o.display)}</div><div class="ts">A person's published second brain — ${n} ${n === 1 ? 'note' : 'notes'} shared. Tap to open it.</div>`;
  }
  const m = o.manifest || {};
  const gals = (m.galaxy || []).map(galaxyName).join(', ');
  const author = m.author?.display || m.author?.handle || '';
  const lineage = m.origin ? ' · moon (forked from another idea)' : '';
  const id = planetKey(o);
  const badges = (discoveredSet(state).has(id) ? ' <span class="disc-badge">✓ discovered</span>' : '') +
    (today && today.id === id ? ' <span class="today-badge">★ today’s discovery</span>' : '');
  const gist = m.summary ? `<div class="ts" style="margin:4px 0 5px;color:#cdd4ff">${esc(m.summary.length > 150 ? m.summary.slice(0, 149).trimEnd() + '…' : m.summary)}</div>` : '';
  const sub = `Published note${gals ? ` in ${esc(gals)}` : ''}${author ? ` · by ${esc(author)}` : ''}${lineage} — tap for more.`;
  const pc = (view.star && view.star.gal && view.star.gal.color) || '#9db0ff';
  return `<div class="tt">${marker(pc)}${esc(o.name)}${badges}</div>${gist}<div class="ts">${sub}</div>`;
}
function placeTip(x, y) {
  const tw = tip.offsetWidth || 200, th = tip.offsetHeight || 44;
  tip.style.left = Math.min(Math.max(8, x + 14), innerWidth - tw - 8) + 'px';
  tip.style.top = Math.min(Math.max(8, y + 14), innerHeight - th - 8) + 'px';
}

// ---------- pointer interactions ----------
cv.addEventListener('mousemove', (e) => {
  if (!renderer) return;
  const hit = renderer.pick(e.clientX, e.clientY);
  renderer.setHot(hit ? hit.o : null);
  cv.style.cursor = hit ? 'pointer' : 'default';
  if (hit) { tip.innerHTML = tipHTML(hit); tip.style.opacity = 1; placeTip(e.clientX, e.clientY); }
  else tip.style.opacity = 0;
});
// Touch has no hover, so let a finger drag highlight + preview elements before lifting to select.
cv.addEventListener('touchmove', (e) => {
  const tch = e.touches[0]; if (!tch || !renderer) return;
  const hit = renderer.pick(tch.clientX, tch.clientY);
  renderer.setHot(hit ? hit.o : null);
  if (hit) {
    tip.innerHTML = tipHTML(hit); tip.style.opacity = 1;
    const tw = tip.offsetWidth || 200, th = tip.offsetHeight || 44;
    tip.style.left = Math.min(Math.max(8, tch.clientX - tw / 2), innerWidth - tw - 8) + 'px';
    tip.style.top = Math.max(8, tch.clientY - th - 18) + 'px';
  } else tip.style.opacity = 0;
}, { passive: true });
cv.addEventListener('touchend', () => { setTimeout(() => { tip.style.opacity = 0; }, 900); }, { passive: true });
cv.addEventListener('click', (e) => {
  if (!renderer) return;
  const hit = renderer.pick(e.clientX, e.clientY);
  if (!hit) {
    // Touch mercy: a near-miss in star view selects the NEAREST planet within a
    // finger-width instead of zooming out — moving dots are hard to tap exactly.
    if (view.mode === 'star' && TOUCH) {
      const best = renderer.nearestPlanet(e.clientX, e.clientY, 44);
      if (best) { navigate({ kind: 'planet', id: planetKey(best) }); return; }
    }
    upLevel();
  } else if (hit.type === 'galaxy') navigate({ kind: 'galaxy', id: hit.o.id });
  else if (hit.type === 'star') navigate({ kind: 'star', id: hit.o.handle });
  else if (hit.type === 'planet') navigate({ kind: 'planet', id: planetKey(hit.o) });
});
// first interaction skips the establishing shot
addEventListener('pointerdown', () => renderer && renderer.skipIntro && renderer.skipIntro(), { once: true });

// ---------- search ----------
let sel = -1;
function renderResults() {
  const rs = searchPlanets(DATA, q.value);
  if (!rs.length) { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; sel = -1; return; }
  sel = Math.min(Math.max(sel, 0), rs.length - 1);
  resultsEl.innerHTML = rs.map((r, i) =>
    '<div data-i="' + i + '"' + (i === sel ? ' class="sel"' : '') + '>' + esc(r.title) +
    '<div class="rs">' + esc(r.s.display) + ' · <span style="color:' + r.g.color + '">' + esc(r.g.name) + '</span></div></div>').join('');
  resultsEl.style.display = 'block';
  resultsEl.querySelectorAll('div[data-i]').forEach((el) => el.onmousedown = (ev) => { ev.preventDefault(); selectResult(rs[+el.dataset.i]); });
}
function selectResult(r) {
  q.value = ''; resultsEl.style.display = 'none'; sel = -1; q.blur();
  navigate({ kind: 'planet', id: planetKey(r.p) }); // flies to the star + opens the panel
}
q.addEventListener('input', () => { sel = 0; renderResults(); });
q.addEventListener('blur', () => setTimeout(() => { resultsEl.style.display = 'none'; }, 120));
q.addEventListener('keydown', (e) => {
  const rs = searchPlanets(DATA, q.value);
  if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, rs.length - 1); renderResults(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); renderResults(); }
  else if (e.key === 'Enter' && rs.length) { e.preventDefault(); selectResult(rs[Math.max(sel, 0)]); }
  else if (e.key === 'Escape') { q.value = ''; renderResults(); q.blur(); e.stopPropagation(); }
});

// ---------- keyboard: '/' search, arrows cycle planets, Enter opens, Esc backs out ----------
addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
  if (typing) return;
  if (renderer && renderer.skipIntro) renderer.skipIntro();
  if (e.key === '/') { e.preventDefault(); q.focus(); return; }
  if (e.key === 'Escape') {
    if (panel.style.display !== 'none' && panel.style.display !== '') closePanel();
    else if (tour) exitTour();
    else upLevel();
    return;
  }
  if (view.mode === 'star' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    e.preventDefault();
    const ps = view.star.planets; if (!ps.length) return;
    kbIdx = ((kbIdx + (e.key === 'ArrowRight' ? 1 : -1)) % ps.length + ps.length) % ps.length;
    const p = ps[kbIdx];
    renderer.setHot(p);
    if (p._x !== undefined && renderer.dpr) {
      tip.innerHTML = tipHTML({ type: 'planet', o: p }); tip.style.opacity = 1;
      placeTip(p._x / renderer.dpr, p._y / renderer.dpr);
    }
    return;
  }
  if (e.key === 'Enter' && view.mode === 'star' && kbIdx >= 0) {
    navigate({ kind: 'planet', id: planetKey(view.star.planets[kbIdx]) });
  }
});

// ---------- game layer: stats, ranks, today's planet, trails, share ----------
function toast(msg, glow) {
  toastEl.textContent = msg; toastEl.classList.add('show');
  if (glow && !REDUCED) { $('hud').classList.add('pulse'); setTimeout(() => $('hud').classList.remove('pulse'), 1600); }
  setTimeout(() => toastEl.classList.remove('show'), 3600);
}
function pushFx() {
  if (!renderer) return;
  const progress = new Map(DATA.galaxies.map((g) => [g.id, galaxyProgress(state, g)]));
  renderer.setFx({
    discovered: discoveredSet(state),
    todayId: today ? today.id : null,
    showTrail: !!state.showConstellation,
    trailIds: state.discovered.map((d) => d.id),
    progress,
  });
}
function refreshStats() {
  const c = completion(state, DATA);
  const brains = new Set(); DATA.galaxies.forEach((g) => g.stars.forEach((s) => brains.add(s.handle)));
  const K = DATA.galaxies.length;
  const rank = computeRank(state, DATA);
  statsEl.innerHTML =
    '<b>' + c.total + '</b> ' + (c.total === 1 ? 'planet' : 'planets') +
    ' · <b>' + brains.size + '</b> ' + (brains.size === 1 ? 'brain' : 'brains') +
    ' · <b>' + K + '</b> ' + (K === 1 ? 'galaxy' : 'galaxies') +
    (c.done > 0 ? ' · <b>' + c.pct + '%</b> explored' : '') +
    (c.done > 0 ? ' <span class="rank">' + esc(rank.name) + '</span>' : '');
}
function refreshGame() {
  refreshStats(); pushFx();
  const rank = computeRank(state, DATA);
  if (rank.index > lastRankIdx) { toast('Rank up — ' + rank.name, true); }
  lastRankIdx = rank.index;
}
// today's planet chip
function initToday() {
  const d = new Date();
  const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  today = todaysPlanet(DATA, key);
  const chip = $('todayChip');
  if (!today) { chip.style.display = 'none'; return; }
  chip.innerHTML = '★ Today: <b>' + esc(String(today.p.name).length > 22 ? String(today.p.name).slice(0, 21) + '…' : today.p.name) + '</b>';
  chip.onclick = () => navigate({ kind: 'planet', id: today.id });
}
// trails menu + tour mode
let trailsMenuWired = false;
function initTrails() {
  trails = deriveTrails(DATA);
  const menu = $('trailsMenu');
  if (!trails.length) { $('trailsBtn').style.display = 'none'; return; }
  $('trailsBtn').onclick = () => { menu.style.display = menu.style.display === 'block' ? 'none' : 'block'; };
  menu.innerHTML = trails.map((t2, i) =>
    '<div data-i="' + i + '"><b>' + esc(t2.name) + (state.trailsDone.includes(t2.id) ? ' <span class="done">✓</span>' : '') + '</b>' +
    '<div class="rs">' + esc(t2.desc) + ' · ' + t2.stops.length + ' stops</div></div>').join('');
  menu.querySelectorAll('div[data-i]').forEach((el) => el.onclick = () => { menu.style.display = 'none'; startTrail(trails[+el.dataset.i]); });
  if (!trailsMenuWired) {
    trailsMenuWired = true;
    document.addEventListener('click', (e) => { if (!menu.contains(e.target) && e.target !== $('trailsBtn')) menu.style.display = 'none'; });
  }
}
function startTrail(trail) { tour = { trail, i: 0 }; renderTour(); goStop(); }
function goStop() { navigate({ kind: 'planet', id: tour.trail.stops[tour.i].id }); renderTour(); }
function renderTour() {
  if (!tour) { tourBar.style.display = 'none'; return; }
  const n = tour.trail.stops.length;
  tourBar.style.display = 'flex';
  tourBar.innerHTML = '<span class="tname">' + esc(tour.trail.name) + '</span>' +
    '<span class="dots">' + tour.trail.stops.map((_, i) => '<i class="' + (i < tour.i ? 'past' : i === tour.i ? 'now' : '') + '"></i>').join('') + '</span>' +
    '<button id="tourNext">' + (tour.i < n - 1 ? 'Next stop →' : 'Finish ✦') + '</button>' +
    '<button id="tourExit" aria-label="Exit trail">×</button>';
  $('tourNext').onclick = () => {
    if (tour.i < n - 1) { tour.i++; goStop(); }
    else {
      if (!state.trailsDone.includes(tour.trail.id)) { state.trailsDone.push(tour.trail.id); persist(); }
      toast('Trail complete — ' + tour.trail.name, true);
      exitTour(); initTrails(); refreshGame();
    }
  };
  $('tourExit').onclick = exitTour;
}
function exitTour() { tour = null; renderTour(); }
// personal-constellation toggle
function initTrailToggle() {
  const btn = $('trailToggle');
  const sync = () => btn.classList.toggle('on', !!state.showConstellation);
  sync();
  btn.onclick = () => { state.showConstellation = !state.showConstellation; persist(); sync(); pushFx(); };
}
// share your map → PNG download (watermarked), clipboard-link fallback
$('shareBtn').onclick = async () => {
  try {
    const url = renderer.snapshot();
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const oc = document.createElement('canvas'); oc.width = img.width; oc.height = img.height;
    const c = oc.getContext('2d');
    c.fillStyle = '#05060e'; c.fillRect(0, 0, oc.width, oc.height);
    c.drawImage(img, 0, 0);
    const s = Math.max(1, Math.round(oc.width / 1440));
    const cmp = completion(state, DATA), rank = computeRank(state, DATA);
    c.font = '600 ' + (13 * s) + 'px "Space Grotesk", sans-serif';
    c.fillStyle = 'rgba(233,237,255,.9)';
    c.fillText('My constellation — ' + cmp.done + '/' + cmp.total + ' planets · ' + rank.name, 18 * s, oc.height - 18 * s);
    const wm = location.host + location.pathname;
    c.font = (11 * s) + 'px ui-sans-serif, sans-serif';
    c.fillStyle = 'rgba(139,147,192,.9)'; c.textAlign = 'right';
    c.fillText(wm, oc.width - 18 * s, oc.height - 18 * s);
    const a = document.createElement('a');
    a.download = 'constellation-map.png'; a.href = oc.toDataURL('image/png'); a.click();
    toast('Map saved');
  } catch {
    try { await navigator.clipboard.writeText(location.href); toast('Could not render PNG — link copied instead'); }
    catch { toast('Could not export the map'); }
  }
};

// ---------- onboarding: 3 dismissible coach marks, remembered in the state key ----------
const OB_STEPS = [
  ['Welcome to the Constellation', 'A universe of published second brains: <b>galaxies</b> are topics, <b>stars</b> are people, <b>planets</b> are their notes.'],
  ['Navigate', 'Click a galaxy, then a star, then a planet to read it. Click empty space (or press Esc) to zoom back out. Press <b>/</b> to search.'],
  ['Build your constellation', 'Planets you visit are added to <b>your constellation</b> — a luminous trail only you can see, saved on this device. Explore to rank up.'],
];
function runOnboarding() {
  if (state.onboarded) return;
  let step = 0;
  const render = () => {
    const [h, b] = OB_STEPS[step];
    obEl.innerHTML = '<div class="obcard glass"><div class="obstep">' + (step + 1) + ' / ' + OB_STEPS.length + '</div>' +
      '<h3>' + h + '</h3><p>' + b + '</p>' +
      '<div class="obrow"><button id="obSkip">Skip</button><button id="obNext" class="primary">' +
      (step < OB_STEPS.length - 1 ? 'Next' : 'Start exploring') + '</button></div></div>';
    $('obNext').onclick = () => { if (step < OB_STEPS.length - 1) { step++; render(); } else finish(); };
    $('obSkip').onclick = finish;
  };
  const finish = () => { obEl.style.display = 'none'; state.onboarded = true; persist(); };
  obEl.style.display = 'flex'; render();
}

// ---------- data load (LIVE-first; the Explorer never hard-depends on the registry) ----------
function normalize(data) {
  data.galaxies.forEach((g) => g.stars.forEach((s) => s.planets.forEach((p, k) => {
    if (typeof p === 'string') s.planets[k] = { name: p };
  })));
  return data;
}
async function start(data, source) {
  DATA = normalize(data); sourceEl.textContent = source;
  renderer = await bootRenderer();
  window.__cosmos = { // test/debug hook (harmless in prod): e2e reads layout + picking
    get data() { return DATA; }, get view() { return view; },
    get dpr() { return renderer.dpr; }, pick: (x, y) => renderer.pick(x, y),
  };
  renderer.setData(DATA);
  initToday(); initTrails(); initTrailToggle();
  lastRankIdx = computeRank(state, DATA).index;
  refreshStats(); pushFx();
  const initial = parseRoute(location.hash);
  renderer.start({ intro: initial.kind === 'universe' });
  // keepIntro: the first route application must not cancel the establishing shot
  applyRoute({ instant: initial.kind === 'universe', keepIntro: true });
  addEventListener('resize', () => renderer.resize());
  runOnboarding();
}

fetch(REGISTRY.replace(/\/+$/, '') + '/universe')
  .then((r) => { if (!r.ok) throw new Error('registry ' + r.status); return r.json(); })
  .then((u) => {
    const data = mapUniverseToData(u.planets || []);
    if (!data.galaxies.length) throw new Error('registry empty');
    const planetCount = (u.planets || []).length;
    return start(data, '🟢 Live — ' + planetCount + ' planets from ' + REGISTRY);
  })
  .catch(() => fetch('mock/data.json').then((r) => r.json())
    .then((d) => start(d, '🟡 Snapshot of Dom\'s published planets (live registry offline)'))
    .catch(() => start(
      { galaxies: [{ id: 'demo', name: 'Demo Galaxy', color: '#7c5cff', stars: [{ handle: 'you', display: 'You', planets: ['Open via a local server (npm run demo) to see real planets'] }] }] },
      '⚪ Offline fallback')),
  );
