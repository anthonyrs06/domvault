// render2d.js — the 2D canvas fallback renderer. Used when WebGL is unavailable
// (feature-detected in app.js): the Explorer must ALWAYS render. Implements the same
// interface as render3d.js; all interaction/UX logic lives in app.js.

import { mulberry32, hashStr, rgba, mix, easeC, truncate } from './util.js';

const MUTED = '#8b93c0';

export function createRenderer({ canvas, touch, reduced }) {
  const cv = canvas, ctx = cv.getContext('2d');
  let W, H, DPR, UI = 1;
  const TOUCH = touch, REDUCED = reduced;
  const PAD = TOUCH ? 2.6 : 1; // enlarge tap targets on touch
  const SPD = TOUCH ? 0.002 : 0.006; // slow orbits on touch: moving dots are hard to tap

  let DATA = { galaxies: [] };
  let view = { mode: 'universe', galaxy: null, star: null };
  let t = 0, hot = null, held = null; // held: the keyboard/panel-focused planet (paused)
  let FX = { discovered: new Set(), todayId: null, showTrail: true, trailIds: [], progress: new Map() };
  let anchors = new Map(); // planet id -> {g,s,k} for trail/beacon anchoring

  function resize() {
    DPR = devicePixelRatio || 1; W = cv.width = innerWidth * DPR; H = cv.height = innerHeight * DPR;
    cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
    UI = Math.min(innerWidth, innerHeight) < 600 ? 1.7 : 1;
    buildField(); layout();
  }

  // deterministic layout positions
  function layout() {
    if (!W) return; // setData can land before start()/resize() sized the canvas
    const cx = W / 2, cy = H / 2;
    // Elliptical ring (separate X/Y radii) so galaxies spread into the taller axis on portrait
    // phones instead of bunching in a tight circle where their labels collide.
    const Rx = W * 0.34, Ry = H * 0.32;
    DATA.galaxies.forEach((g, i) => {
      const a = (i / DATA.galaxies.length) * Math.PI * 2 - Math.PI / 2;
      g.x = cx + Math.cos(a) * Rx; g.y = cy + Math.sin(a) * Ry;
      g.stars.forEach((s, j) => {
        const sa = (j / g.stars.length) * Math.PI * 2;
        const sr = Math.min(W, H) * 0.16;
        s.x = g.x + Math.cos(sa) * sr; s.y = g.y + Math.sin(sa) * sr; s.gal = g;
        s.planets.forEach((p, k) => { if (typeof p === 'string') s.planets[k] = { name: p }; });
      });
    });
    anchors = new Map();
    DATA.galaxies.forEach((g) => g.stars.forEach((s) => s.planets.forEach((p, k) => {
      const id = (p.manifest && p.manifest.id) || p.name;
      if (!anchors.has(id)) anchors.set(id, { g, s, k });
    })));
  }

  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const pid = (p) => (p.manifest && p.manifest.id) || p.name;

  // Scene-wide fade multiplier so camera crossfades compose with local alpha levels.
  let ALPHA = 1; const ga = (a) => { ctx.globalAlpha = Math.max(0, Math.min(1, a * ALPHA)); };
  const fontHead = (px, w = 600) => `${w} ${px}px "Space Grotesk", ui-sans-serif, sans-serif`;

  // ---- ambient: 3-depth parallax starfield + slow shooting stars ----
  let FIELD = [];
  function buildField() {
    const rnd = mulberry32(20260819); FIELD = [];
    [[0.35, 80], [0.6, 64], [1, 44]].forEach(([depth, n]) => {
      const stars = [];
      for (let i = 0; i < n; i++) stars.push({ x: rnd() * W, y: rnd() * H, r: (0.5 + rnd() * 0.9) * depth, tw: rnd() * 6.28, warm: rnd() < 0.3 });
      FIELD.push({ depth, stars });
    });
  }
  function drawField() {
    for (const layer of FIELD) {
      const drift = (t * 22 * layer.depth * DPR) % W;
      for (const s of layer.stars) {
        const x = (s.x + drift + W) % W;
        ctx.globalAlpha = (0.22 + 0.3 * (0.5 + 0.5 * Math.sin(s.tw + t * 2))) * layer.depth;
        ctx.fillStyle = s.warm ? '#ffe7c2' : '#cfd9ff';
        ctx.fillRect(x, s.y, s.r * DPR + 0.6, s.r * DPR + 0.6);
      }
    }
    ctx.globalAlpha = 1;
  }
  let shoot = null, nextShoot = 3500;
  function drawShooting(now) {
    if (REDUCED) return;
    if (!shoot && now > nextShoot) {
      const r = Math.random; // spawn-time only, never per frame
      const a = Math.PI * (0.15 + r() * 0.2), len = (180 + r() * 140) * DPR;
      shoot = { x: W * (0.15 + r() * 0.7), y: H * (0.05 + r() * 0.3), dx: Math.cos(a) * len, dy: Math.sin(a) * len, t0: now, dur: 1700 };
    }
    if (shoot) {
      const k = (now - shoot.t0) / shoot.dur;
      if (k >= 1) { shoot = null; nextShoot = now + 9000 + Math.random() * 14000; return; }
      const hx = shoot.x + shoot.dx * k, hy = shoot.y + shoot.dy * k, tl = Math.min(k, 0.22);
      const grad = ctx.createLinearGradient(hx - shoot.dx * tl, hy - shoot.dy * tl, hx, hy);
      grad.addColorStop(0, 'rgba(255,240,214,0)'); grad.addColorStop(1, `rgba(255,240,214,${0.75 * Math.sin(Math.PI * k)})`);
      ctx.strokeStyle = grad; ctx.lineWidth = 1.2 * DPR; ctx.beginPath();
      ctx.moveTo(hx - shoot.dx * tl, hy - shoot.dy * tl); ctx.lineTo(hx, hy); ctx.stroke();
    }
  }

  // ---- galaxies: baked nebula sprite + seeded spiral particle cluster ----
  function nebulaSprite(g) {
    const R = Math.round(96 * DPR);
    if (g._neb && g._neb.R === R) return g._neb;
    const oc = document.createElement('canvas'); oc.width = oc.height = R * 2;
    const c2 = oc.getContext('2d'); c2.globalCompositeOperation = 'lighter';
    const rnd = mulberry32(hashStr(String(g.id || g.name)));
    for (let i = 0; i < 4; i++) {
      const a = rnd() * 6.28, d = R * 0.22 * rnd(), rr = R * (0.55 + rnd() * 0.45);
      const x = R + Math.cos(a) * d, y = R + Math.sin(a) * d;
      const grad = c2.createRadialGradient(x, y, rr * 0.06, x, y, rr);
      grad.addColorStop(0, rgba(g.color, 0.34)); grad.addColorStop(0.55, rgba(g.color, 0.12)); grad.addColorStop(1, rgba(g.color, 0));
      c2.fillStyle = grad; c2.beginPath(); c2.arc(x, y, rr, 0, 7); c2.fill();
    }
    return g._neb = { cv: oc, R };
  }
  function galaxyParticles(g) {
    if (g._pts) return g._pts;
    const rnd = mulberry32(hashStr(String(g.id || g.name)) ^ 0x9e3779b9);
    const pts = [], ARMS = 3;
    for (let i = 0; i < 84; i++) {
      const f = Math.pow(rnd(), 0.72);
      const a = (i % ARMS) * (6.2832 / ARMS) + f * 2.7 + (rnd() - 0.5) * 0.55;
      pts.push({ r: f, a, s: 0.5 + rnd() * 1.1, o: 0.25 + rnd() * 0.5 });
    }
    return g._pts = pts;
  }

  // Anchor point of a planet in universe space (for the personal-constellation trail).
  function universeAnchor(id) {
    const a = anchors.get(id); if (!a || a.g.x === undefined) return null;
    const h = hashStr(String(id));
    const ang = (h % 628) / 100, rr = (30 + (h >> 4) % 34) * DPR;
    return { x: a.g.x + Math.cos(ang) * rr, y: a.g.y + Math.sin(ang) * rr };
  }
  // The visitor's own constellation: a luminous trail through discoveries in visit order.
  function drawTrail(points) {
    if (points.length < 1) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    if (points.length > 1) {
      for (const [w, al] of [[5 * DPR, 0.05], [1.4 * DPR, 0.28]]) {
        ga(al); ctx.strokeStyle = '#ffe9b8'; ctx.lineWidth = w; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          const mx = (points[i - 1].x + points[i].x) / 2, my = (points[i - 1].y + points[i].y) / 2;
          ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, mx, my);
        }
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y); ctx.stroke();
      }
    }
    for (const pt of points) {
      ga(0.85); ctx.fillStyle = '#fff3d0';
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 1.6 * DPR, 0, 7); ctx.fill();
    }
    ctx.restore(); ga(1);
  }

  function drawUniverse() {
    DATA.galaxies.forEach((g) => {
      const R = 96 * DPR, rot = REDUCED ? 0 : t * 0.06;
      ga(hot === g ? 0.95 : 0.7);
      ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(rot);
      const neb = nebulaSprite(g); ctx.drawImage(neb.cv, -neb.R, -neb.R); ctx.restore();
      ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(rot * 1.5);
      const lit = mix(g.color, '#fff', 0.35);
      for (const p of galaxyParticles(g)) {
        ga(p.o * (hot === g ? 1 : 0.8));
        ctx.fillStyle = p.r < 0.25 ? lit : g.color;
        ctx.beginPath(); ctx.arc(Math.cos(p.a) * p.r * R * 0.72, Math.sin(p.a) * p.r * R * 0.5, p.s * DPR, 0, 7); ctx.fill();
      }
      ctx.restore();
      g.stars.forEach((s, j) => {
        const a = t * 0.5 + j * (6.2832 / Math.max(g.stars.length, 1)); const r = 40 * DPR;
        const x = g.x + Math.cos(a) * r, y = g.y + Math.sin(a) * r;
        ga(0.9); ctx.fillStyle = '#fff3d8'; ctx.beginPath(); ctx.arc(x, y, 2.5 * DPR * UI, 0, 7); ctx.fill();
        ga(0.3); ctx.beginPath(); ctx.arc(x, y, 5 * DPR * UI, 0, 7); ctx.fill();
      });
      // boundary ring; doubles as the per-galaxy progress ring when discoveries exist
      const prog = FX.progress.get(g.id);
      ga(hot === g ? 0.4 : 0.22); ctx.strokeStyle = g.color; ctx.lineWidth = DPR;
      ctx.beginPath(); ctx.ellipse(g.x, g.y, R * 0.78, R * 0.56, 0, 0, 7); ctx.stroke();
      if (prog && prog.done > 0) {
        ga(0.85); ctx.strokeStyle = '#ffe9b8'; ctx.lineWidth = 1.6 * DPR;
        ctx.beginPath(); ctx.ellipse(g.x, g.y, R * 0.78, R * 0.56, 0, -Math.PI / 2, -Math.PI / 2 + (prog.done / prog.total) * 6.2832); ctx.stroke();
      }
      const TS = Math.min(UI, 1.2);
      ga(1); ctx.fillStyle = '#f0f3ff'; ctx.font = fontHead(13 * DPR * TS); ctx.textAlign = 'center';
      ctx.fillText(g.name, g.x, g.y + 72 * DPR * TS);
      ctx.fillStyle = mix(g.color, '#fff', 0.25); ctx.font = fontHead(10 * DPR * TS, 500);
      const sub = g.stars.length + (g.stars.length === 1 ? ' brain' : ' brains') +
        (prog && prog.done > 0 ? ` · ${prog.done}/${prog.total} explored` : '');
      ctx.fillText(sub, g.x, g.y + 88 * DPR * TS);
    });
    if (FX.showTrail && FX.trailIds.length) {
      drawTrail(FX.trailIds.map(universeAnchor).filter(Boolean));
    }
  }

  // A small shaded sphere: light falls from the star side, dark terminator on the far side.
  function drawPlanetDot(x, y, pr, color, lx, ly, bright) {
    const grad = ctx.createRadialGradient(x + (lx - x) * 0.4 / Math.max(dist(x, y, lx, ly) / pr, 1), y + (ly - y) * 0.4 / Math.max(dist(x, y, lx, ly) / pr, 1), pr * 0.15, x, y, pr * 1.15);
    grad.addColorStop(0, mix(color, '#fff', bright ? 0.75 : 0.55)); grad.addColorStop(1, mix(color, '#000', bright ? 0.2 : 0.45));
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y, pr, 0, 7); ctx.fill();
    if (bright) { ga(0.25); ctx.fillStyle = mix(color, '#fff', 0.6); ctx.beginPath(); ctx.arc(x, y, pr * 1.8, 0, 7); ctx.fill(); ga(1); }
  }
  function drawSun(x, y, R, coreR) {
    const gr = ctx.createRadialGradient(x, y, 2, x, y, R);
    gr.addColorStop(0, 'rgba(255,247,214,.95)'); gr.addColorStop(0.35, 'rgba(255,214,116,.30)'); gr.addColorStop(1, 'rgba(255,214,116,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fill();
    const core = ctx.createRadialGradient(x - coreR * 0.3, y - coreR * 0.3, coreR * 0.1, x, y, coreR);
    core.addColorStop(0, '#fffbe9'); core.addColorStop(1, '#ffcf5e');
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(x, y, coreR, 0, 7); ctx.fill();
  }
  // Soft pulsing ring — today's-planet beacon (static ring under reduced motion).
  function beacon(x, y, base) {
    const k = REDUCED ? 0.5 : 0.5 + 0.5 * Math.sin(t * 4);
    ga(0.5 - 0.25 * k); ctx.strokeStyle = '#ffe9b8'; ctx.lineWidth = 1.5 * DPR;
    ctx.beginPath(); ctx.arc(x, y, base * (1.6 + k * 0.9), 0, 7); ctx.stroke(); ga(1);
  }

  function drawGalaxy(g) {
    ga(0.1); ctx.fillStyle = g.color;
    ctx.beginPath(); ctx.arc(g.x, g.y, Math.min(W, H) * 0.30, 0, 7); ctx.fill();
    g.stars.forEach((s) => {
      ga(1); drawSun(s.x, s.y, 26 * DPR, (hot === s ? 8 : 6) * DPR * UI);
      s.planets.forEach((p, k) => {
        const a = t * (0.6 + k * 0.12) + k; const r = (18 + k * 8) * DPR * UI;
        ga(0.09); ctx.strokeStyle = '#fff'; ctx.lineWidth = DPR;
        ctx.beginPath(); ctx.ellipse(s.x, s.y, r, r * 0.9, 0, 0, 7); ctx.stroke();
        ga(1); drawPlanetDot(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r * 0.9, 3 * DPR * UI, g.color, s.x, s.y, FX.discovered.has(pid(p)));
      });
      ga(1); ctx.fillStyle = '#f0f3ff'; ctx.font = fontHead(12 * DPR * UI); ctx.textAlign = 'center';
      ctx.fillText(s.display, s.x, s.y + 44 * DPR * UI);
      ctx.fillStyle = MUTED; ctx.font = fontHead(10 * DPR * UI, 500);
      ctx.fillText(s.planets.length + (s.planets.length === 1 ? ' planet' : ' planets'), s.x, s.y + 60 * DPR * UI);
    });
  }

  function drawStar(s) {
    const g = s.gal || view.galaxy || { color: '#7c5cff' }; const cx = W / 2, cy = H / 2;
    ga(1); drawSun(cx, cy, 52 * DPR, 13 * DPR * UI);
    ctx.fillStyle = '#f0f3ff'; ctx.font = fontHead(14 * DPR * UI); ctx.textAlign = 'center';
    ctx.fillText(s.display + "'s brain", cx, cy - 64 * DPR * UI);
    // Spread orbits to fill the viewport so planets never bunch up on small screens.
    const n = s.planets.length, baseR = Math.min(W, H) * 0.16, maxR = Math.min(W, H) * 0.40;
    const step = n > 1 ? (maxR - baseR) / (n - 1) : 0;
    const ECC = 0.93; // slightly elliptical orbits
    const trailPts = [];
    s.planets.forEach((p, k) => {
      if (p._ph === undefined) p._ph = k * 1.3;
      if (!REDUCED && hot !== p && held !== p && s === view.star) p._ph += SPD * (0.5 + k * 0.08); // hover pauses THIS planet
      const a = p._ph; const r = baseR + k * step;
      ga(0.07); ctx.strokeStyle = '#fff'; ctx.lineWidth = DPR;
      ctx.beginPath(); ctx.ellipse(cx, cy, r, r * ECC, 0, 0, 7); ctx.stroke();
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r * ECC;
      if (s === view.star) { p._x = px; p._y = py; } // hit-test coords belong to the ACTIVE scene only
      const id = pid(p), disc = FX.discovered.has(id);
      ga(1); drawPlanetDot(px, py, (hot === p || held === p ? 9 : 6) * DPR * UI, g.color, cx, cy, disc);
      if (id === FX.todayId) beacon(px, py, 9 * DPR * UI);
      if (disc && FX.showTrail) trailPts.push({ x: px, y: py, ord: FX.trailIds.indexOf(id) });
      ctx.fillStyle = disc ? '#f0e9cf' : '#cdd4ff'; ctx.font = fontHead(11 * DPR * UI, 500);
      // Truncate + align away from the edges so labels never run off-screen.
      const label = truncate(p.name);
      ctx.textAlign = px < W * 0.30 ? 'left' : px > W * 0.70 ? 'right' : 'center';
      ctx.fillText(label, px, py - 14 * DPR * UI);
      ctx.textAlign = 'center';
    });
    if (trailPts.length > 1) drawTrail(trailPts.sort((a, b) => a.ord - b.ord));
  }

  function drawScene(v) {
    if (v.mode === 'universe') drawUniverse();
    else if (v.mode === 'galaxy') drawGalaxy(v.galaxy);
    else if (v.mode === 'star') drawStar(v.star);
  }

  // ---- camera: eased crossfade-zoom between view levels (~450ms) ----
  let trans = null;
  const DEPTH = { universe: 0, galaxy: 1, star: 2 };
  const zoomAround = (fx, fy, s) => { ctx.translate(fx, fy); ctx.scale(s, s); ctx.translate(-fx, -fy); };
  function focusOf(v) {
    if (v.mode === 'galaxy' && v.galaxy) return { x: v.galaxy.x, y: v.galaxy.y };
    if (v.mode === 'star' && v.star) return { x: v.star.x, y: v.star.y };
    return { x: W / 2, y: H / 2 };
  }

  let started = false;
  function draw(now) {
    if (!REDUCED) t += SPD;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
    drawField(); drawShooting(now || performance.now());
    if (trans) {
      const k = Math.min(1, ((now || performance.now()) - trans.t0) / 450), e = easeC(k);
      const f = trans.focus;
      ctx.save(); ALPHA = Math.max(0, 1 - e * 1.6);
      if (trans.dir > 0) zoomAround(f.x, f.y, 1 + e * 0.8); else zoomAround(W / 2, H / 2, 1 - e * 0.1);
      if (ALPHA > 0.01) drawScene(trans.from);
      ctx.restore();
      ctx.save(); ALPHA = e;
      if (trans.dir > 0) zoomAround(W / 2, H / 2, 0.9 + e * 0.1); else zoomAround(f.x, f.y, 1.12 - e * 0.12);
      drawScene(view);
      ctx.restore(); ALPHA = 1;
      if (k >= 1) trans = null;
    } else { ALPHA = 1; drawScene(view); }
    requestAnimationFrame(draw);
  }

  return {
    quality: '2d-fallback',
    get dpr() { return DPR; },
    setData(data) { DATA = data; layout(); },
    setView(nv, opts = {}) {
      const from = view; view = nv;
      if (!REDUCED && !opts.instant && from.mode !== nv.mode) {
        const focus = DEPTH[nv.mode] >= DEPTH[from.mode] ? focusOf(nv) : focusOf(from);
        trans = { from, dir: DEPTH[nv.mode] >= DEPTH[from.mode] ? 1 : -1, focus, t0: performance.now() };
      }
    },
    setHot(o) { hot = o; },
    focusPlanet(p) { held = p; },
    setFx(fx) { FX = { ...FX, ...fx }; },
    pick(mx, my) {
      mx *= DPR; my *= DPR;
      if (view.mode === 'universe') { for (const g of DATA.galaxies) if (dist(mx, my, g.x, g.y) < 90 * DPR) return { type: 'galaxy', o: g }; }
      else if (view.mode === 'galaxy') { for (const s of view.galaxy.stars) if (dist(mx, my, s.x, s.y) < 34 * DPR * PAD) return { type: 'star', o: s }; }
      else if (view.mode === 'star') { for (const p of view.star.planets) if (p._x && dist(mx, my, p._x, p._y) < 16 * DPR * PAD * UI) return { type: 'planet', o: p }; }
      return null;
    },
    // Touch mercy support: nearest planet within a finger-width in star view.
    nearestPlanet(mx, my, maxCss) {
      if (view.mode !== 'star') return null;
      mx *= DPR; my *= DPR; let best = null, bd = maxCss * DPR;
      for (const p of view.star.planets) { if (!p._x) continue; const d0 = dist(mx, my, p._x, p._y); if (d0 < bd) { bd = d0; best = p; } }
      return best;
    },
    resize,
    start() { if (started) return; started = true; resize(); requestAnimationFrame(draw); },
    snapshot() { return cv.toDataURL('image/png'); },
  };
}
