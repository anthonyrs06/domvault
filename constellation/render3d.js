// render3d.js — the living-brain WebGL renderer (three.js, vendored at ./vendor — no CDN,
// no build step). One continuous 3D world you FLY through: parallax starfield shells,
// spiral particle galaxies with layered nebula glow, suns, shaded planets — and the
// point of the whole thing, the EDGES: luminous constellation lines between linked
// ideas, bright arcing bridges where a connection crosses galaxies. Hovering a planet
// lights its 1–2 hop neighborhood; sparks arc between not-yet-linked ideas on a
// deterministic schedule; #/timelapse replays the universe growing.
//
// Camera is free flight (drag to orbit, scroll/pinch to fly, momentum, optional WASD);
// hash routes remain eased fly-to TARGETS, not discrete walls. Labels are semantic-zoom:
// they emerge with proximity instead of switching per mode.
// Same interface as render2d.js plus optional v3 methods (app.js feature-detects them).

import * as THREE from './vendor/three.module.js';
import { mulberry32, hashStr, easeC } from './util.js';
import { collectEdges } from './timelapse.js';

const U_HOME = { pos: [0, 92, 238], look: [0, 0, 0] };
const INTRO_FROM = [0, 210, 560];
const RING_R = 120;          // galaxy ring radius (world units)
const GAL_R = 24;            // galaxy disc radius
const STAR_RING = 9.5;       // star ring inside a galaxy
const ECC = 0.93;            // slightly elliptical orbits

export function createRenderer({ canvas, labelLayer, touch, reduced }) {
  const TOUCH = touch, REDUCED = reduced;
  const PAD = TOUCH ? 2.6 : 1;                 // enlarge pick targets on touch
  const SPD = TOUCH ? 0.0016 : 0.004;          // slow orbits — the graph, not orbits, is the spine

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  // Quality tier: coarse pointers start low; a frame-time probe can degrade further.
  let quality = TOUCH ? 'low' : 'high';
  const TIER = () => quality === 'high'
    ? { px: 2, field: [2400, 1500, 900], gal: 1200 }
    : { px: 1.5, field: [1200, 800, 500], gal: 600 };
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, TIER().px));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 4000);
  camera.position.set(...(REDUCED ? U_HOME.pos : INTRO_FROM));
  const lookAt = new THREE.Vector3(0, 0, 0);
  camera.lookAt(lookAt);
  scene.add(new THREE.AmbientLight(0x9aa2d0, 0.55));

  // ---- generated textures (no assets shipped) ----
  function radialTex(stops, size = 128) {
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [k, col] of stops) g.addColorStop(k, col);
    c.fillStyle = g; c.fillRect(0, 0, size, size);
    const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; return tx;
  }
  const dotTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,.6)'], [1, 'rgba(255,255,255,0)']], 64);
  const glowTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,.45)'], [1, 'rgba(255,255,255,0)']]);
  const ringTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const c = cv.getContext('2d');
    c.strokeStyle = 'rgba(255,233,184,1)'; c.lineWidth = 5;
    c.beginPath(); c.arc(64, 64, 52, 0, 7); c.stroke();
    const tx = new THREE.CanvasTexture(cv); return tx;
  })();

  const additive = (map, color, opacity) => new THREE.SpriteMaterial({
    map, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
  });

  // ---- 3-shell parallax starfield ----
  const fieldShells = [];
  function buildField() {
    const counts = TIER().field;
    [[700, counts[0], 1.6], [1000, counts[1], 2.2], [1500, counts[2], 3.2]].forEach(([R, n, size], i) => {
      const rnd = mulberry32(777 + i);
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      const warm = new THREE.Color('#ffe7c2'), cool = new THREE.Color('#cfd9ff');
      for (let j = 0; j < n; j++) {
        // uniform on a sphere shell
        const u = rnd() * 2 - 1, ph = rnd() * 6.2832, r = R * (0.8 + rnd() * 0.4);
        const s = Math.sqrt(1 - u * u);
        pos.set([Math.cos(ph) * s * r, u * r * 0.7, Math.sin(ph) * s * r], j * 3);
        const c = (rnd() < 0.3 ? warm : cool).clone().multiplyScalar(0.5 + rnd() * 0.5);
        col.set([c.r, c.g, c.b], j * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        size, map: dotTex, vertexColors: true, transparent: true, opacity: 0.85,
        depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
      }));
      pts.userData.driftSpeed = 0.0008 / (i + 1); // deeper shells drift slower (parallax)
      scene.add(pts); fieldShells.push(pts);
    });
  }
  buildField();

  // ---- fresnel atmosphere shader (rim glow on planets) ----
  function atmosphereMat(color) {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: 0.6 } },
      vertexShader: `varying vec3 vN; varying vec3 vV;
        void main(){ vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uIntensity; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
          gl_FragColor = vec4(uColor, f * uIntensity); }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
  }

  // ---- world build: galaxies → stars → planets ----
  let DATA = { galaxies: [] };
  let view = { mode: 'universe', galaxy: null, star: null };
  let hot = null, held = null;
  let FX = { discovered: new Set(), todayId: null, showTrail: true, trailIds: [], progress: new Map() };
  const pid = (p) => (p.manifest && p.manifest.id) || p.name;

  const worldGroup = new THREE.Group(); scene.add(worldGroup);
  let gEntries = []; // [{g, grp, hit, disc, glows, stars:[{s, grp, sunWorld(), planets:[...], light}]}]
  const planetById = new Map(); // id -> first render entry {entry, sEntry, gEntry}
  const entriesById = new Map(); // id -> EVERY pEntry (multi-galaxy planets render per galaxy)
  const sphereGeo = new THREE.SphereGeometry(0.24, 20, 14);
  const atmoGeo = new THREE.SphereGeometry(0.34, 20, 14);

  function clearWorld() {
    worldGroup.clear(); gEntries = []; planetById.clear(); entriesById.clear();
  }
  function buildWorld() {
    clearWorld();
    const nG = Math.max(DATA.galaxies.length, 1);
    DATA.galaxies.forEach((g, i) => {
      const seed = hashStr(String(g.id || g.name));
      const rnd = mulberry32(seed);
      const a = (i / nG) * Math.PI * 2 - Math.PI / 2;
      const grp = new THREE.Group();
      grp.position.set(Math.cos(a) * RING_R, (rnd() - 0.5) * 26, Math.sin(a) * RING_R * 0.82);
      grp.userData.spin = 0.0005 + rnd() * 0.0004;
      worldGroup.add(grp);
      const color = new THREE.Color(g.color);

      // spiral particle disc (deterministic per-galaxy seed)
      const N = TIER().gal, ARMS = 3;
      const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
      const lit = color.clone().lerp(new THREE.Color('#ffffff'), 0.55);
      for (let j = 0; j < N; j++) {
        const f = Math.pow(rnd(), 0.65);
        const ang = (j % ARMS) * (6.2832 / ARMS) + f * 2.9 + (rnd() - 0.5) * 0.6;
        const r = f * GAL_R;
        const y = (rnd() + rnd() - 1) * 1.5 * (1 - f * 0.7); // thin disc, puffier core
        pos.set([Math.cos(ang) * r, y, Math.sin(ang) * r * 0.72], j * 3);
        const c = (f < 0.22 ? lit : color).clone().multiplyScalar(0.35 + rnd() * 0.65);
        col.set([c.r, c.g, c.b], j * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const discMat = new THREE.PointsMaterial({
        size: 0.7, map: dotTex, vertexColors: true, transparent: true, opacity: 0.95,
        depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
      });
      grp.add(new THREE.Points(geo, discMat));

      // layered nebula glow ("volumetric" feel from stacked offset sprites)
      const glows = [];
      for (let k = 0; k < 3; k++) {
        const sp = new THREE.Sprite(additive(glowTex, g.color, 0.16 - k * 0.03));
        sp.scale.setScalar(34 + k * 14);
        sp.position.set((rnd() - 0.5) * 8, (rnd() - 0.5) * 3, (rnd() - 0.5) * 8);
        grp.add(sp); glows.push(sp);
      }
      const core = new THREE.Sprite(additive(glowTex, '#ffffff', 0.3)); core.scale.setScalar(10); grp.add(core);
      glows.push(core);

      // invisible pick volume
      const hit = new THREE.Mesh(new THREE.SphereGeometry(GAL_R, 8, 8),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      hit.userData.pick = { type: 'galaxy', o: g }; grp.add(hit);

      const gEntry = { g, grp, hit, discMat, glows, stars: [] };
      gEntries.push(gEntry);

      g.stars.forEach((s, j) => {
        s.planets.forEach((p, k) => { if (typeof p === 'string') s.planets[k] = { name: p }; });
        s.gal = g; // crumbs/back-navigation need the owning galaxy (same as the 2D layout)
        const sa = (j / Math.max(g.stars.length, 1)) * Math.PI * 2;
        const sGrp = new THREE.Group();
        sGrp.position.set(Math.cos(sa) * STAR_RING, 1.5, Math.sin(sa) * STAR_RING * 0.8);
        grp.add(sGrp);
        const sunGlow = new THREE.Sprite(additive(glowTex, '#ffd76a', 0.55)); sunGlow.scale.setScalar(5); sGrp.add(sunGlow);
        const sunCore = new THREE.Sprite(additive(glowTex, '#fff7dc', 0.95)); sunCore.scale.setScalar(1.8); sGrp.add(sunCore);
        const light = new THREE.PointLight(0xfff2d0, 60, 60, 1.8); sGrp.add(light);
        const sHit = new THREE.Mesh(new THREE.SphereGeometry(2.5 * PAD, 8, 8),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
        sHit.userData.pick = { type: 'star', o: s }; sGrp.add(sHit);

        const sEntry = { s, grp: sGrp, hit: sHit, planets: [], light, sunGlow, sunCore };
        gEntry.stars.push(sEntry);

        const n = s.planets.length, span = n > 1 ? 7.0 / (n - 1) : 0;
        const atmo = atmosphereMat(g.color);
        s.planets.forEach((p, k) => {
          const orbitR = 2.0 + k * span;
          // orbit trail — kept, but dimmer than v2: the link graph is the visual spine now
          const curve = new THREE.EllipseCurve(0, 0, orbitR, orbitR * ECC);
          const linePts = curve.getPoints(96).map((v) => new THREE.Vector3(v.x, 0, v.y));
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(linePts),
            new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.04, depthWrite: false }));
          sGrp.add(line);
          const mat = new THREE.MeshStandardMaterial({
            color: g.color, roughness: 0.5, metalness: 0.05,
            emissive: new THREE.Color(g.color), emissiveIntensity: 0.1,
          });
          const mesh = new THREE.Mesh(sphereGeo, mat);
          const rim = new THREE.Mesh(atmoGeo, atmo); mesh.add(rim);
          const pHit = new THREE.Mesh(new THREE.SphereGeometry(0.55 * PAD, 8, 8),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
          pHit.userData.pick = { type: 'planet', o: p }; mesh.add(pHit);
          sGrp.add(mesh);
          if (p._ph === undefined) p._ph = k * 1.3;
          const pEntry = { p, k, mesh, mat, hit: pHit, orbitR, orbit: line };
          sEntry.planets.push(pEntry);
          if (!planetById.has(pid(p))) planetById.set(pid(p), { entry: pEntry, sEntry, gEntry });
          if (!entriesById.has(pid(p))) entriesById.set(pid(p), []);
          entriesById.get(pid(p)).push(pEntry);
        });
      });
    });
    buildEdgeLayer();
    applyFx();
  }

  // ---- THE EDGES ARE THE SHOW: constellation lines between linked planets ----
  // Same-galaxy links: subtle luminous threads. Cross-galaxy links: bright arcing
  // bridges lifted above the plane (those are the interesting connections).
  const edgeGroup = new THREE.Group(); scene.add(edgeGroup);
  let edgeEntries = []; // [{a, b, cross, line, posAttr, segs, baseOp, mat}]
  const adjacency = new Map(); // id -> Set(id)
  function buildEdgeLayer() {
    edgeGroup.clear(); edgeEntries = []; adjacency.clear();
    for (const [a, b] of collectEdges(DATA)) {
      const ra = planetById.get(a), rb = planetById.get(b);
      if (!ra || !rb) continue;
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      if (!adjacency.has(b)) adjacency.set(b, new Set());
      adjacency.get(a).add(b); adjacency.get(b).add(a);
      const cross = ra.gEntry !== rb.gEntry;
      const segs = cross ? 32 : 12;
      const pos = new Float32Array((segs + 1) * 3);
      const col = new Float32Array((segs + 1) * 3);
      const ca = new THREE.Color(ra.gEntry.g.color).lerp(new THREE.Color('#ffffff'), 0.35);
      const cb = new THREE.Color(rb.gEntry.g.color).lerp(new THREE.Color('#ffffff'), 0.35);
      const c = new THREE.Color();
      for (let i = 0; i <= segs; i++) {
        c.lerpColors(ca, cb, i / segs);
        col.set([c.r, c.g, c.b], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      const posAttr = new THREE.BufferAttribute(pos, 3);
      geo.setAttribute('position', posAttr);
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const baseOp = cross ? 0.45 : 0.14;
      const mat = new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: baseOp,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false; // endpoints move every frame; skip stale-bounds culling
      edgeGroup.add(line);
      edgeEntries.push({ a, b, cross, line, posAttr, segs, baseOp, mat });
    }
  }
  const EV_A = new THREE.Vector3(), EV_B = new THREE.Vector3(), EV_C = new THREE.Vector3();
  const EV_1 = new THREE.Vector3(), EV_2 = new THREE.Vector3();
  function updateEdges() {
    for (const e of edgeEntries) {
      const ra = planetById.get(e.a), rb = planetById.get(e.b);
      if (!ra || !rb) continue;
      if (!ra.entry.mesh.visible || !rb.entry.mesh.visible) { e.line.visible = false; continue; }
      e.line.visible = true;
      ra.entry.mesh.getWorldPosition(EV_A);
      rb.entry.mesh.getWorldPosition(EV_B);
      // quadratic bezier: bridges arc high above the plane, local threads barely lift
      const lift = EV_A.distanceTo(EV_B) * (e.cross ? 0.24 : 0.10);
      EV_C.addVectors(EV_A, EV_B).multiplyScalar(0.5); EV_C.y += lift;
      for (let i = 0; i <= e.segs; i++) {
        const t = i / e.segs;
        EV_1.lerpVectors(EV_A, EV_C, t);
        EV_2.lerpVectors(EV_C, EV_B, t);
        EV_1.lerp(EV_2, t);
        e.posAttr.array.set([EV_1.x, EV_1.y, EV_1.z], i * 3);
      }
      e.posAttr.needsUpdate = true;
    }
  }

  // ---- hover neighborhood: light the 1–2 hop graph around the hot planet ----
  let hood = null; // { l0:Set, l1:Set, l2:Set }
  function setNeighborhood(planet) {
    const id = planet && pid(planet);
    if (!id || !adjacency.has(id)) { if (hood) { hood = null; applyHood(); } return; }
    const l1 = adjacency.get(id);
    const l2 = new Set();
    for (const n of l1) for (const m of adjacency.get(n) || []) if (m !== id && !l1.has(m)) l2.add(m);
    hood = { l0: new Set([id]), l1, l2 };
    applyHood();
  }
  function applyHood() {
    for (const e of edgeEntries) {
      if (!hood) { e.mat.opacity = e.baseOp; continue; }
      const touches0 = hood.l0.has(e.a) || hood.l0.has(e.b);
      const in12 = (x) => hood.l0.has(x) || hood.l1.has(x) || hood.l2.has(x);
      if (touches0) e.mat.opacity = 0.95;
      else if (in12(e.a) && in12(e.b)) e.mat.opacity = Math.min(0.6, e.baseOp + 0.35);
      else e.mat.opacity = e.baseOp * 0.25;
    }
    for (const [id, entries] of entriesById) {
      const base = FX.discovered.has(id) ? 0.55 : 0.1;
      let v = base;
      if (hood) {
        if (hood.l0.has(id)) v = 1.0;
        else if (hood.l1.has(id)) v = 0.8;
        else if (hood.l2.has(id)) v = 0.45;
        else v = base * 0.6;
      }
      for (const pe of entries) pe.mat.emissiveIntensity = v;
    }
  }

  // ---- sparks: shooting stars between NOT-yet-linked ideas ("watch it think") ----
  // Deterministic: one PRNG seeded from the session minute drives every interval,
  // pair choice, and ignition flash — no per-frame Math.random. Frozen under
  // prefers-reduced-motion.
  const sparkRnd = mulberry32(hashStr('spark:' + Math.floor(Date.now() / 60000)));
  let sparks = [];        // active: {t0, dur, A, B, C, head, flashAtEnd, target}
  let flashes = [];       // {sprite, t0, dur}
  let nextSparkAt = 0;
  function scheduleSpark(now) { nextSparkAt = now + 8000 + sparkRnd() * 7000; }
  function spawnSpark(now) {
    const ids = [...planetById.keys()].sort();
    if (ids.length < 2) return;
    // deterministic pair draw; skip already-linked pairs (a spark is a thought
    // that HASN'T become an edge yet)
    let a = null, b = null;
    for (let tries = 0; tries < 12; tries++) {
      const i = Math.floor(sparkRnd() * ids.length);
      const j = Math.floor(sparkRnd() * ids.length);
      if (i === j) continue;
      if (adjacency.get(ids[i])?.has(ids[j])) continue;
      a = ids[i]; b = ids[j]; break;
    }
    if (!a) return;
    const ra = planetById.get(a), rb = planetById.get(b);
    if (!ra.entry.mesh.visible || !rb.entry.mesh.visible) return;
    const A = ra.entry.mesh.getWorldPosition(new THREE.Vector3());
    const B = rb.entry.mesh.getWorldPosition(new THREE.Vector3());
    const C = A.clone().add(B).multiplyScalar(0.5); C.y += A.distanceTo(B) * 0.3 + 6;
    const head = new THREE.Sprite(additive(glowTex, '#ffffff', 0.9));
    head.scale.setScalar(1.4); scene.add(head);
    sparks.push({ t0: now, dur: 1500 + sparkRnd() * 500, A, B, C, head, flashAtEnd: sparkRnd() < 0.3, target: rb });
  }
  function updateSparks(now) {
    if (REDUCED || tl) return;
    if (!nextSparkAt) scheduleSpark(now);
    if (now >= nextSparkAt) { spawnSpark(now); scheduleSpark(now); }
    sparks = sparks.filter((sp) => {
      const k = (now - sp.t0) / sp.dur;
      if (k >= 1) {
        sp.head.removeFromParent();
        if (sp.flashAtEnd) ignitionFlash(sp.B, now, '#ffe9b8');
        return false;
      }
      EV_1.lerpVectors(sp.A, sp.C, k); EV_2.lerpVectors(sp.C, sp.B, k); EV_1.lerp(EV_2, k);
      sp.head.position.copy(EV_1);
      sp.head.material.opacity = 0.9 * Math.sin(Math.PI * k); // ease in+out
      return true;
    });
  }
  function ignitionFlash(worldPos, now, color = '#ffffff') {
    const f = new THREE.Sprite(additive(glowTex, color, 0.9));
    f.position.copy(worldPos); f.scale.setScalar(0.5); scene.add(f);
    flashes.push({ sprite: f, t0: now, dur: 520 });
  }
  function updateFlashes(now) {
    flashes = flashes.filter((f) => {
      const k = (now - f.t0) / f.dur;
      if (k >= 1) { f.sprite.removeFromParent(); return false; }
      f.sprite.scale.setScalar(0.5 + k * 6);
      f.sprite.material.opacity = 0.9 * (1 - k);
      return true;
    });
  }

  // ---- discovery FX: brighter discovered planets, today's beacon, the personal trail ----
  let beacon = null, sunBeacon = null, beaconRef = null;
  let trailLine = null, trailNodes = null;
  function applyFx() {
    applyHood(); // planet emissive baseline (discovered state) lives there now
    // today's planet beacon (pulsing ring; static under reduced motion)
    if (beacon) { beacon.removeFromParent(); sunBeacon.removeFromParent(); beacon = sunBeacon = null; beaconRef = null; }
    const today = FX.todayId && planetById.get(FX.todayId);
    if (today) {
      beacon = new THREE.Sprite(additive(ringTex, '#ffe9b8', 0.75)); beacon.scale.setScalar(1.6);
      today.sEntry.grp.add(beacon); beaconRef = today;
      sunBeacon = new THREE.Sprite(additive(glowTex, '#ffe9b8', 0.3)); sunBeacon.scale.setScalar(11);
      today.sEntry.grp.add(sunBeacon);
    }
    rebuildTrail();
  }
  // Fixed world-space anchor per planet (near its sun, spread by orbit index) — the trail
  // is a map of WHERE the ideas live, so anchors don't chase the orbital motion.
  function trailAnchor(id, out) {
    const ref = planetById.get(id); if (!ref) return null;
    const base = ref.entry.k * 1.3;
    out.set(Math.cos(base) * ref.entry.orbitR, 0.4 + (ref.entry.k % 3) * 0.3, Math.sin(base) * ref.entry.orbitR * ECC);
    return ref.sEntry.grp.localToWorld(out);
  }
  function rebuildTrail() {
    if (trailLine) { trailLine.removeFromParent(); trailNodes.removeFromParent(); trailLine = trailNodes = null; }
    if (!FX.showTrail || FX.trailIds.length < 1 || tl) return;
    scene.updateMatrixWorld(true); // anchors need fresh world matrices before first render
    const anchors = [];
    for (const id of FX.trailIds) { const v = trailAnchor(id, new THREE.Vector3()); if (v) anchors.push(v.clone()); }
    if (!anchors.length) return;
    const pts = anchors.length > 1
      ? new THREE.CatmullRomCurve3(anchors, false, 'catmullrom', 0.5).getPoints(anchors.length * 14)
      : anchors;
    trailLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffe9b8, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(trailLine);
    const npos = new Float32Array(anchors.length * 3);
    anchors.forEach((v, i) => npos.set([v.x, v.y, v.z], i * 3));
    const ngeo = new THREE.BufferGeometry(); ngeo.setAttribute('position', new THREE.BufferAttribute(npos, 3));
    trailNodes = new THREE.Points(ngeo, new THREE.PointsMaterial({
      size: 2.4, map: glowTex, color: 0xfff3d0, transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    scene.add(trailNodes);
  }

  // ---- HTML labels: ALL levels built once, SEMANTIC ZOOM decides visibility ----
  // Instead of switching label sets per view mode, every label carries fade
  // distances and emerges as the camera approaches (near, far) in world units.
  let labelEls = [];
  function clearLabels() { labelLayer.textContent = ''; labelEls = []; }
  function addLabel(kindClass, html, getWorld, cssOffsetY, fade) {
    const el = document.createElement('div');
    el.className = 'lbl ' + kindClass; el.innerHTML = html;
    labelLayer.appendChild(el);
    labelEls.push({ el, getWorld, cssOffsetY, fade, op: -1 });
    return el;
  }
  function ringSvg(done, total) {
    const C = 2 * Math.PI * 8, f = total ? done / total : 0;
    return `<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="2"/>` +
      `<circle cx="10" cy="10" r="8" fill="none" stroke="#ffe9b8" stroke-width="2" stroke-linecap="round" transform="rotate(-90 10 10)" stroke-dasharray="${(C * f).toFixed(1)} ${C.toFixed(1)}"/></svg>`;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function rebuildLabels() {
    clearLabels();
    for (const ge of gEntries) {
      const prog = FX.progress.get(ge.g.id);
      const sub = ge.g.stars.length + (ge.g.stars.length === 1 ? ' brain' : ' brains');
      const ring = prog && prog.done > 0 ? `<span class="ring">${ringSvg(prog.done, prog.total)}<i>${prog.done}/${prog.total} explored</i></span>` : '';
      // galaxy names live at a distance; they dissolve as you fly INTO the galaxy
      addLabel('lbl-galaxy', `<b style="color:#f0f3ff">${esc(ge.g.name)}</b><span style="color:${ge.g.color}">${sub}</span>${ring}`,
        (v) => v.setFromMatrixPosition(ge.grp.matrixWorld), 46, { showBeyond: 46, band: 18 });
      for (const se of ge.stars) {
        const n = se.s.planets.length;
        addLabel('lbl-star', `<b>${esc(se.s.display)}</b><span>${n} ${n === 1 ? 'note' : 'notes'}</span>`,
          (v) => v.setFromMatrixPosition(se.grp.matrixWorld), 30, { showWithin: 75, band: 25 });
        for (const pe of se.planets) {
          const disc = FX.discovered.has(pid(pe.p));
          addLabel('lbl-planet' + (disc ? ' disc' : ''), esc(pe.p.name),
            (v) => v.setFromMatrixPosition(pe.mesh.matrixWorld), -16, { showWithin: 21, band: 7, entry: pe });
        }
      }
    }
  }
  function findStar(s) {
    for (const ge of gEntries) for (const se of ge.stars) if (se.s === s) return { ge, se };
    return null;
  }

  // ---- FREE FLIGHT camera: drag orbits, scroll/pinch flies, momentum, WASD ----
  let flight = null, introFlight = null;
  const camDpr = () => renderer.getPixelRatio();
  function flyTo(pos, look, dur = 1100, onDone = null) {
    if (REDUCED || dur === 0) {
      camera.position.set(...pos); lookAt.set(...look); camera.lookAt(lookAt); flight = null;
      if (onDone) onDone();
      return;
    }
    flight = { fromP: camera.position.clone(), toP: new THREE.Vector3(...pos), fromL: lookAt.clone(), toL: new THREE.Vector3(...look), t0: performance.now(), dur, onDone };
  }
  function targetFor(v) {
    if (v.mode === 'galaxy' && v.galaxy) {
      const ge = gEntries.find((e) => e.g === v.galaxy);
      const G = new THREE.Vector3().setFromMatrixPosition(ge.grp.matrixWorld);
      const dir = G.clone().setY(0).normalize();
      const p = G.clone().addScaledVector(dir, 34); p.y += 24;
      return { pos: p.toArray(), look: G.toArray() };
    }
    if (v.mode === 'star' && v.star) {
      const ref = findStar(v.star);
      const S = new THREE.Vector3().setFromMatrixPosition(ref.se.grp.matrixWorld);
      const G = new THREE.Vector3().setFromMatrixPosition(ref.ge.grp.matrixWorld);
      const dir = S.clone().sub(G).setY(0); if (dir.lengthSq() < 0.01) dir.set(0, 0, 1); dir.normalize();
      const p = S.clone().addScaledVector(dir, 15); p.y += 7;
      return { pos: p.toArray(), look: S.toArray() };
    }
    return { pos: U_HOME.pos, look: U_HOME.look };
  }

  // user-input camera state (spherical offset around lookAt) + momentum
  const sph = new THREE.Spherical();
  const fwd = new THREE.Vector3(), rgt = new THREE.Vector3();
  let vTheta = 0, vPhi = 0, vFly = 0;
  const keys = new Set();
  let dragging = false, dragged = false, px = 0, py = 0;
  const pointers = new Map(); let pinchDist = 0;
  function cancelFlights() { flight = introFlight = null; }
  function syncSph() { sph.setFromVector3(EV_1.subVectors(camera.position, lookAt)); }
  function applySph() {
    camera.position.setFromSpherical(sph).add(lookAt);
    camera.lookAt(lookAt);
  }
  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a[0] - b[0], a[1] - b[1]);
    }
    dragging = true; dragged = false; px = e.clientX; py = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* detached canvas in tests */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || tl) return;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) {
      // pinch-fly: two-finger spread dives in, squeeze pulls out
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinchDist > 0 && Math.abs(d - pinchDist) > 2) {
        cancelFlights(); syncSph();
        sph.radius = Math.max(2.5, Math.min(700, sph.radius * (pinchDist / d)));
        applySph();
        dragged = true;
      }
      pinchDist = d;
      return;
    }
    const dx = e.clientX - px, dy = e.clientY - py;
    if (!dragged && Math.hypot(e.clientX - px, e.clientY - py) < 5) return;
    if (!dragged) { dragged = true; cancelFlights(); }
    px = e.clientX; py = e.clientY;
    syncSph();
    sph.theta -= dx * 0.005;
    sph.phi = Math.max(0.08, Math.min(Math.PI - 0.08, sph.phi - dy * 0.005));
    vTheta = -dx * 0.005; vPhi = -dy * 0.005; // momentum carries the last gesture
    applySph();
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) dragging = false;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  // a real drag must not fall through to app.js's click-to-navigate
  canvas.addEventListener('click', (e) => { if (dragged) { e.stopImmediatePropagation(); dragged = false; } }, true);
  canvas.addEventListener('wheel', (e) => {
    if (tl) return;
    e.preventDefault();
    cancelFlights(); syncSph();
    const f = Math.exp(e.deltaY * 0.0012);
    if (sph.radius * f < 2.5 && f < 1) {
      // flying past the minimum orbit distance pushes the focus point forward —
      // continuous flight instead of a zoom wall
      camera.getWorldDirection(fwd);
      lookAt.addScaledVector(fwd, 1.2);
    } else {
      sph.radius = Math.min(700, sph.radius * f);
    }
    vFly = e.deltaY * 0.0012;
    applySph();
  }, { passive: false });
  // optional WASD (never required): glide the focus point in the camera plane
  addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) return;
    if ('wasd'.includes(e.key)) keys.add(e.key);
  });
  addEventListener('keyup', (e) => keys.delete(e.key));
  function updateFreeFlight(dt) {
    if (tl) return;
    const damp = Math.pow(0.92, dt / 16);
    if (!dragging && !flight && !introFlight && (Math.abs(vTheta) > 0.0001 || Math.abs(vPhi) > 0.0001)) {
      syncSph();
      sph.theta += vTheta; sph.phi = Math.max(0.08, Math.min(Math.PI - 0.08, sph.phi + vPhi));
      applySph();
    }
    vTheta *= damp; vPhi *= damp; vFly *= damp;
    if (keys.size && !flight && !introFlight) {
      camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
      rgt.crossVectors(fwd, camera.up).normalize();
      syncSph();
      const step = Math.max(0.2, sph.radius * 0.012) * (dt / 16);
      if (keys.has('w')) lookAt.addScaledVector(fwd, step);
      if (keys.has('s')) lookAt.addScaledVector(fwd, -step);
      if (keys.has('a')) lookAt.addScaledVector(rgt, -step);
      if (keys.has('d')) lookAt.addScaledVector(rgt, step);
      applySph();
    }
  }

  // ---- TIME-LAPSE: replay the universe growing (#/timelapse) ----
  // Driven from app.js: enterTimelapse(orderedIds) → setTimelapseT(t∈[0,1]) →
  // exitTimelapse(). Planets ignite in order (with a flash on forward crossings),
  // edges lace in once both endpoints exist, and the camera slowly pulls back.
  let tl = null; // { idx: Map<id,slot>, n, t, lastCount }
  function enterTimelapse(orderedIds) {
    tl = { idx: new Map(orderedIds.map((id, i) => [id, i])), n: orderedIds.length, t: 0, lastCount: 0 };
    cancelFlights();
    if (trailLine) { trailLine.removeFromParent(); trailNodes.removeFromParent(); trailLine = trailNodes = null; }
    if (beacon) { beacon.visible = false; sunBeacon.visible = false; }
    labelLayer.style.opacity = 0.35; // galaxy names stay as faint wayfinding
    setTimelapseT(0);
  }
  function setTimelapseT(t) {
    if (!tl) return;
    tl.t = Math.max(0, Math.min(1, t));
    const count = Math.round(tl.t * tl.n);
    const now = performance.now();
    for (const [id, entries] of entriesById) {
      const slot = tl.idx.get(id);
      const on = slot !== undefined && slot < count;
      if (on && !entries[0].mesh.visible && count > tl.lastCount && !REDUCED) {
        ignitionFlash(entries[0].mesh.getWorldPosition(new THREE.Vector3()), now, planetById.get(id).gEntry.g.color);
      }
      for (const pe of entries) { pe.mesh.visible = on; pe.orbit.visible = on; }
    }
    // galaxies + suns fade up as their ideas arrive
    for (const ge of gEntries) {
      let gOn = 0, gTot = 0;
      for (const se of ge.stars) {
        let sOn = 0;
        for (const pe of se.planets) { gTot++; if (pe.mesh.visible) { gOn++; sOn++; } }
        const sf = se.planets.length ? sOn / se.planets.length : 1;
        se.sunGlow.material.opacity = 0.1 + 0.45 * Math.min(1, sf * 3);
        se.sunCore.material.opacity = 0.2 + 0.75 * Math.min(1, sf * 3);
        se.light.intensity = 60 * (0.15 + 0.85 * Math.min(1, sf * 3));
      }
      const f = gTot ? gOn / gTot : 1;
      ge.discMat.opacity = 0.1 + 0.85 * f;
      ge.glows.forEach((sp, i) => { sp.material.opacity = (0.3 - i * 0.045) * (0.25 + 0.75 * f); });
    }
    tl.lastCount = count;
    // cinematic pull-back: low and close over the first ignitions → wide establishing
    // shot of the finished universe. Pure function of t, so scrubbing is exact.
    const e = easeC(tl.t);
    const r = 120 + 210 * e;
    const th = -Math.PI / 2 + 0.85 * tl.t;
    const ph = 1.22 - 0.34 * e;
    lookAt.set(0, 0, 0);
    camera.position.set(r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph), r * Math.sin(ph) * Math.cos(th));
    camera.lookAt(lookAt);
  }
  function exitTimelapse() {
    if (!tl) return;
    tl = null;
    for (const entries of entriesById.values()) for (const pe of entries) { pe.mesh.visible = true; pe.orbit.visible = true; }
    for (const ge of gEntries) {
      ge.discMat.opacity = 0.95;
      ge.glows.forEach((sp, i) => { sp.material.opacity = i < 3 ? 0.16 - i * 0.03 : 0.3; });
      for (const se of ge.stars) {
        se.sunGlow.material.opacity = 0.55; se.sunCore.material.opacity = 0.95; se.light.intensity = 60;
      }
    }
    if (beacon) { beacon.visible = true; sunBeacon.visible = true; }
    labelLayer.style.opacity = '';
    applyFx();
  }

  // ---- per-frame update ----
  const V = new THREE.Vector3();
  let frameCount = 0, probeAcc = 0, lastNow = 0, trailTick = 0;
  function annotate() {
    // Project to DEVICE pixels (matches the 2D renderer's g.x/s.x/p._x contract that
    // __cosmos consumers read). dpr here = the WebGL pixel ratio.
    const dpr = camDpr();
    const proj = (obj) => {
      V.setFromMatrixPosition(obj.matrixWorld).project(camera);
      return V.z < 1 ? { x: (V.x * 0.5 + 0.5) * innerWidth * dpr, y: (-V.y * 0.5 + 0.5) * innerHeight * dpr } : null;
    };
    for (const ge of gEntries) { const q2 = proj(ge.grp); if (q2) { ge.g.x = q2.x; ge.g.y = q2.y; } }
    if (view.mode === 'galaxy' && view.galaxy) {
      const ge = gEntries.find((e) => e.g === view.galaxy);
      if (ge) for (const se of ge.stars) { const q2 = proj(se.grp); if (q2) { se.s.x = q2.x; se.s.y = q2.y; } }
    }
    if (view.mode === 'star' && view.star) {
      const ref = findStar(view.star);
      if (ref) { const q2 = proj(ref.se.grp); if (q2) { ref.se.s.x = q2.x; ref.se.s.y = q2.y; }
        for (const pe of ref.se.planets) { const q3 = proj(pe.mesh); if (q3) { pe.p._x = q3.x; pe.p._y = q3.y; } } }
    }
  }
  function updateLabels() {
    // semantic zoom: each label fades in/out around its distance thresholds
    for (const L of labelEls) {
      L.getWorld(V);
      const d = V.distanceTo(camera.position);
      let op = 1;
      if (L.fade) {
        if (L.fade.showBeyond !== undefined) op = (d - L.fade.showBeyond) / L.fade.band + 0.5;
        if (L.fade.showWithin !== undefined) op = (L.fade.showWithin - d) / L.fade.band + 0.5;
        op = Math.max(0, Math.min(1, op));
      }
      if (L.fade && L.fade.entry && !L.fade.entry.mesh.visible) op = 0; // timelapse: unborn
      if (tl && L.fade && L.fade.showWithin !== undefined) op = 0;      // timelapse: wide shot only
      V.project(camera);
      if (V.z > 1 || op <= 0.02) { L.el.style.display = 'none'; L.op = 0; continue; }
      const x = (V.x * 0.5 + 0.5) * innerWidth, y = (-V.y * 0.5 + 0.5) * innerHeight + L.cssOffsetY;
      L.el.style.display = '';
      if (Math.abs(op - L.op) > 0.02) { L.el.style.opacity = op.toFixed(2); L.op = op; }
      // edge-aware alignment so labels never run off-screen
      const align = x < innerWidth * 0.18 ? '0%' : x > innerWidth * 0.82 ? '-100%' : '-50%';
      L.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(${align},-50%)`;
    }
  }
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = lastNow ? now - lastNow : 16; lastNow = now;
    // frame-time probe → degrade gracefully instead of stuttering
    if (frameCount > 30 && frameCount <= 150) probeAcc += dt;
    if (frameCount === 150 && probeAcc / 120 > 26 && quality !== 'degraded') {
      quality = 'degraded'; renderer.setPixelRatio(1);
      fieldShells[2].visible = false; // drop the deepest shell
    }
    frameCount++;

    if (!REDUCED) {
      for (const sh of fieldShells) sh.rotation.y += sh.userData.driftSpeed * (dt / 16);
      for (const ge of gEntries) ge.grp.rotation.y += ge.grp.userData.spin * (dt / 16) * (view.galaxy === ge.g || view.mode === 'universe' ? 1 : 0.4);
    }
    // orbital motion (hover/panel focus pauses that planet)
    for (const ge of gEntries) for (const se of ge.stars) for (const pe of se.planets) {
      if (!REDUCED && hot !== pe.p && held !== pe.p) pe.p._ph += SPD * (0.5 + pe.k * 0.08) * (dt / 16);
      pe.mesh.position.set(Math.cos(pe.p._ph) * pe.orbitR, 0, Math.sin(pe.p._ph) * pe.orbitR * ECC);
    }
    if (beacon && beaconRef) {
      beacon.position.copy(beaconRef.entry.mesh.position);
      const k = REDUCED ? 0.5 : 0.5 + 0.5 * Math.sin(now * 0.004);
      beacon.scale.setScalar(1.3 + k * 0.9);
      beacon.material.opacity = 0.85 - k * 0.45;
      sunBeacon.material.opacity = 0.18 + k * 0.2;
    }
    if (trailLine && !REDUCED && (trailTick++ % 3 === 0)) rebuildTrailPositions();
    updateSparks(now);
    updateFlashes(now);
    updateFreeFlight(dt);

    if (tl) {
      // camera fully owned by the replay (set in setTimelapseT)
    } else if (introFlight) {
      const k = Math.min(1, (now - introFlight.t0) / introFlight.dur), e = easeC(k);
      camera.position.lerpVectors(introFlight.fromP, introFlight.toP, e);
      camera.lookAt(lookAt);
      if (k >= 1) introFlight = null;
    } else if (flight) {
      const k = Math.min(1, (now - flight.t0) / flight.dur), e = easeC(k);
      camera.position.lerpVectors(flight.fromP, flight.toP, e);
      lookAt.lerpVectors(flight.fromL, flight.toL, e);
      camera.lookAt(lookAt);
      if (k >= 1) { const cb = flight.onDone; flight = null; if (cb) cb(); }
    } else camera.lookAt(lookAt);

    updateEdges();
    renderer.render(scene, camera);
    annotate(); updateLabels();
  }
  // galaxies rotate, so refresh existing trail vertex positions in place
  function rebuildTrailPositions() {
    const posAttr = trailLine.geometry.getAttribute('position');
    const anchors = [];
    for (const id of FX.trailIds) { const v = trailAnchor(id, new THREE.Vector3()); if (v) anchors.push(v.clone()); }
    if (anchors.length < 1) return;
    const pts = anchors.length > 1
      ? new THREE.CatmullRomCurve3(anchors, false, 'catmullrom', 0.5).getPoints(anchors.length * 14)
      : anchors;
    if (pts.length * 3 !== posAttr.array.length) { rebuildTrail(); return; }
    pts.forEach((v, i) => posAttr.array.set([v.x, v.y, v.z], i * 3));
    posAttr.needsUpdate = true;
    const nAttr = trailNodes.geometry.getAttribute('position');
    anchors.forEach((v, i) => nAttr.array.set([v.x, v.y, v.z], i * 3));
    nAttr.needsUpdate = true;
  }

  // ---- picking: proximity decides the level (free flight has no hard modes) ----
  // Planets win when you're close enough to read them, stars next, galaxies only
  // from outside their own volume — so clicking works at ANY camera position.
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  function pickLevel(hits, maxDist) {
    for (const h of hits) if (h.distance <= maxDist && h.object.userData.pick) return h.object.userData.pick;
    return null;
  }
  function pick(cssX, cssY) {
    ndc.set((cssX / innerWidth) * 2 - 1, -(cssY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const pHits = [], sHits = [], gHits = [];
    for (const ge of gEntries) {
      gHits.push(ge.hit);
      for (const se of ge.stars) { sHits.push(se.hit); for (const pe of se.planets) if (pe.mesh.visible) pHits.push(pe.hit); }
    }
    const p = pickLevel(ray.intersectObjects(pHits, false), 40);
    if (p) return p;
    const s = pickLevel(ray.intersectObjects(sHits, false), 130);
    if (s) return s;
    for (const h of ray.intersectObjects(gHits, false)) {
      const ge = gEntries.find((e) => e.hit === h.object);
      // inside a galaxy you interact with its contents, not the disc itself
      if (ge && camera.position.distanceTo(EV_1.setFromMatrixPosition(ge.grp.matrixWorld)) > GAL_R * 1.15) {
        return h.object.userData.pick;
      }
    }
    return null;
  }

  let started = false;
  return {
    get quality() { return quality; },
    get dpr() { return camDpr(); },
    get edgeCount() { return edgeEntries.length; },
    setData(data) { DATA = data; buildWorld(); rebuildLabels(); },
    setView(nv, opts = {}) {
      view = nv;
      if (!opts.keepIntro) introFlight = null; // navigation skips the establishing shot
      if (!(opts.keepIntro && introFlight) && !tl) {
        const t2 = targetFor(nv);
        flyTo(t2.pos, t2.look, opts.instant ? 0 : 1100);
      }
    },
    setHot(o) {
      hot = o;
      // hood lighting only makes sense for planets (galaxies have .stars, stars .planets)
      setNeighborhood(o && !o.stars && !o.planets ? o : null);
    },
    focusPlanet(p) {
      held = p;
      if (tl) return;
      if (p) {
        const ref = planetById.get(pid(p));
        if (ref) {
          const P = new THREE.Vector3(); ref.entry.mesh.getWorldPosition(P);
          const S = new THREE.Vector3(); ref.sEntry.grp.getWorldPosition(S);
          // approach from ABOVE the orbital plane so sibling planets never sweep the lens,
          // and keep enough distance that the sun stays readable behind the panel
          const dir = P.clone().sub(S).setY(0); if (dir.lengthSq() < 0.01) dir.set(0, 0, 1); dir.normalize();
          const pos = P.clone().addScaledVector(dir, 4.5); pos.y += 4.5;
          flyTo(pos.toArray(), P.toArray(), 900);
        }
      } else if (view.mode === 'star') {
        const t2 = targetFor(view); flyTo(t2.pos, t2.look, 900);
      }
    },
    // the LANDING: dive the camera onto the planet, then hand off to the reader
    diveTo(p, onDone) {
      if (tl) { if (onDone) onDone(); return; }
      const ref = planetById.get(pid(p));
      if (!ref) { if (onDone) onDone(); return; }
      held = p;
      const P = new THREE.Vector3(); ref.entry.mesh.getWorldPosition(P);
      const dir = camera.position.clone().sub(P).normalize();
      const pos = P.clone().addScaledVector(dir, 1.05);
      flyTo(pos.toArray(), P.toArray(), REDUCED ? 0 : 1150, onDone);
    },
    setFx(fx) { FX = { ...FX, ...fx }; applyFx(); rebuildLabels(); },
    pick,
    nearestPlanet(cssX, cssY, maxCss) {
      if (view.mode !== 'star' || !view.star) return null;
      const dpr = camDpr(); const mx = cssX * dpr, my = cssY * dpr;
      let best = null, bd = maxCss * dpr;
      for (const p of view.star.planets) {
        if (p._x === undefined) continue;
        const d = Math.hypot(mx - p._x, my - p._y);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    },
    enterTimelapse, setTimelapseT, exitTimelapse,
    resize() {
      camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    },
    start(opts = {}) {
      if (started) return; started = true;
      renderer.setSize(innerWidth, innerHeight);
      if (opts.intro && !REDUCED) {
        introFlight = { fromP: new THREE.Vector3(...INTRO_FROM), toP: new THREE.Vector3(...U_HOME.pos), t0: performance.now(), dur: 4200 };
      } else { camera.position.set(...U_HOME.pos); }
      requestAnimationFrame(tick);
    },
    skipIntro() { if (introFlight) { camera.position.copy(introFlight.toP); introFlight = null; } },
    snapshot() { renderer.render(scene, camera); return canvas.toDataURL('image/png'); },
  };
}
