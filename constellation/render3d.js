// render3d.js — the cinematic WebGL renderer (three.js, vendored at ./vendor — no CDN,
// no build step). One continuous 3D world: parallax starfield shells, spiral particle
// galaxies with layered nebula glow, suns, shaded planets with fresnel atmospheres and
// orbital trails. The camera dollies between universe → galaxy → star → planet focus.
// Same interface as render2d.js; all interaction/UX logic lives in app.js.

import * as THREE from './vendor/three.module.js';
import { mulberry32, hashStr, easeC } from './util.js';

const U_HOME = { pos: [0, 92, 238], look: [0, 0, 0] };
const INTRO_FROM = [0, 210, 560];
const RING_R = 120;          // galaxy ring radius (world units)
const GAL_R = 24;            // galaxy disc radius
const STAR_RING = 9.5;       // star ring inside a galaxy
const ECC = 0.93;            // slightly elliptical orbits

export function createRenderer({ canvas, labelLayer, touch, reduced }) {
  const TOUCH = touch, REDUCED = reduced;
  const PAD = TOUCH ? 2.6 : 1;                 // enlarge pick targets on touch
  const SPD = TOUCH ? 0.002 : 0.006;           // slow orbits on touch (hard to tap moving dots)

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
  let gEntries = []; // [{g, grp, hit, stars:[{s, grp, sunWorld(), planets:[{p, k, mesh, hit, orbitR}], light}]}]
  const planetById = new Map(); // id -> first render entry {mesh, star, gal}
  const sphereGeo = new THREE.SphereGeometry(0.24, 20, 14);
  const atmoGeo = new THREE.SphereGeometry(0.34, 20, 14);

  function clearWorld() {
    worldGroup.clear(); gEntries = []; planetById.clear();
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
      grp.add(new THREE.Points(geo, new THREE.PointsMaterial({
        size: 0.7, map: dotTex, vertexColors: true, transparent: true, opacity: 0.95,
        depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
      })));

      // layered nebula glow ("volumetric" feel from stacked offset sprites)
      for (let k = 0; k < 3; k++) {
        const sp = new THREE.Sprite(additive(glowTex, g.color, 0.16 - k * 0.03));
        sp.scale.setScalar(34 + k * 14);
        sp.position.set((rnd() - 0.5) * 8, (rnd() - 0.5) * 3, (rnd() - 0.5) * 8);
        grp.add(sp);
      }
      const core = new THREE.Sprite(additive(glowTex, '#ffffff', 0.3)); core.scale.setScalar(10); grp.add(core);

      // invisible pick volume
      const hit = new THREE.Mesh(new THREE.SphereGeometry(GAL_R, 8, 8),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      hit.userData.pick = { type: 'galaxy', o: g }; grp.add(hit);

      const gEntry = { g, grp, hit, stars: [] };
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

        const sEntry = { s, grp: sGrp, hit: sHit, planets: [], light };
        gEntry.stars.push(sEntry);

        const n = s.planets.length, span = n > 1 ? 7.0 / (n - 1) : 0;
        const atmo = atmosphereMat(g.color);
        s.planets.forEach((p, k) => {
          const orbitR = 2.0 + k * span;
          // orbit trail (slightly elliptical)
          const curve = new THREE.EllipseCurve(0, 0, orbitR, orbitR * ECC);
          const linePts = curve.getPoints(96).map((v) => new THREE.Vector3(v.x, 0, v.y));
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(linePts),
            new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, depthWrite: false }));
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
          const pEntry = { p, k, mesh, mat, hit: pHit, orbitR };
          sEntry.planets.push(pEntry);
          if (!planetById.has(pid(p))) planetById.set(pid(p), { entry: pEntry, sEntry, gEntry });
        });
      });
    });
    applyFx();
  }

  // ---- discovery FX: brighter discovered planets, today's beacon, the personal trail ----
  let beacon = null, sunBeacon = null, beaconRef = null;
  let trailLine = null, trailNodes = null;
  function applyFx() {
    for (const [id, ref] of planetById) {
      const disc = FX.discovered.has(id);
      for (const ge of gEntries) for (const se of ge.stars) for (const pe of se.planets) {
        if (pid(pe.p) !== id) continue;
        pe.mat.emissiveIntensity = disc ? 0.55 : 0.1;
      }
    }
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
    if (!FX.showTrail || FX.trailIds.length < 1) return;
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

  // ---- HTML labels (crisp text > canvas sprites), rebuilt per view mode ----
  let labelEls = [];
  function clearLabels() { labelLayer.textContent = ''; labelEls = []; }
  function addLabel(kindClass, html, getWorld, cssOffsetY = 0) {
    const el = document.createElement('div');
    el.className = 'lbl ' + kindClass; el.innerHTML = html;
    labelLayer.appendChild(el);
    labelEls.push({ el, getWorld, cssOffsetY });
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
    if (view.mode === 'universe') {
      for (const ge of gEntries) {
        const prog = FX.progress.get(ge.g.id);
        const sub = ge.g.stars.length + (ge.g.stars.length === 1 ? ' brain' : ' brains');
        const ring = prog && prog.done > 0 ? `<span class="ring">${ringSvg(prog.done, prog.total)}<i>${prog.done}/${prog.total} explored</i></span>` : '';
        addLabel('lbl-galaxy', `<b style="color:#f0f3ff">${esc(ge.g.name)}</b><span style="color:${ge.g.color}">${sub}</span>${ring}`,
          (v) => v.setFromMatrixPosition(ge.grp.matrixWorld), 46);
      }
    } else if (view.mode === 'galaxy' && view.galaxy) {
      const ge = gEntries.find((e) => e.g === view.galaxy);
      if (ge) for (const se of ge.stars) {
        const n = se.s.planets.length;
        addLabel('lbl-star', `<b>${esc(se.s.display)}</b><span>${n} ${n === 1 ? 'planet' : 'planets'}</span>`,
          (v) => v.setFromMatrixPosition(se.grp.matrixWorld), 30);
      }
    } else if (view.mode === 'star' && view.star) {
      const ref = findStar(view.star);
      if (ref) {
        addLabel('lbl-star', `<b>${esc(ref.se.s.display)}'s brain</b>`,
          (v) => v.setFromMatrixPosition(ref.se.grp.matrixWorld), -44);
        for (const pe of ref.se.planets) {
          const disc = FX.discovered.has(pid(pe.p));
          addLabel('lbl-planet' + (disc ? ' disc' : ''), esc(pe.p.name),
            (v) => v.setFromMatrixPosition(pe.mesh.matrixWorld), -16);
        }
      }
    }
  }
  function findStar(s) {
    for (const ge of gEntries) for (const se of ge.stars) if (se.s === s) return { ge, se };
    return null;
  }

  // ---- camera flights ----
  let flight = null, introFlight = null;
  const camDpr = () => renderer.getPixelRatio();
  function flyTo(pos, look, dur = 1100) {
    if (REDUCED || dur === 0) { camera.position.set(...pos); lookAt.set(...look); camera.lookAt(lookAt); flight = null; return; }
    flight = { fromP: camera.position.clone(), toP: new THREE.Vector3(...pos), fromL: lookAt.clone(), toL: new THREE.Vector3(...look), t0: performance.now(), dur };
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
    for (const L of labelEls) {
      L.getWorld(V); V.project(camera);
      if (V.z > 1) { L.el.style.display = 'none'; continue; }
      const x = (V.x * 0.5 + 0.5) * innerWidth, y = (-V.y * 0.5 + 0.5) * innerHeight + L.cssOffsetY;
      L.el.style.display = '';
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

    if (introFlight) {
      const k = Math.min(1, (now - introFlight.t0) / introFlight.dur), e = easeC(k);
      camera.position.lerpVectors(introFlight.fromP, introFlight.toP, e);
      camera.lookAt(lookAt);
      if (k >= 1) introFlight = null;
    } else if (flight) {
      const k = Math.min(1, (now - flight.t0) / flight.dur), e = easeC(k);
      camera.position.lerpVectors(flight.fromP, flight.toP, e);
      lookAt.lerpVectors(flight.fromL, flight.toL, e);
      camera.lookAt(lookAt);
      if (k >= 1) flight = null;
    } else camera.lookAt(lookAt);

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

  // ---- picking (raycast against the current view's hit volumes) ----
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  function pickables() {
    if (view.mode === 'universe') return gEntries.map((e) => e.hit);
    if (view.mode === 'galaxy' && view.galaxy) {
      const ge = gEntries.find((e) => e.g === view.galaxy);
      return ge ? ge.stars.map((se) => se.hit) : [];
    }
    if (view.mode === 'star' && view.star) {
      const ref = findStar(view.star);
      return ref ? ref.se.planets.map((pe) => pe.hit) : [];
    }
    return [];
  }

  let started = false;
  return {
    get quality() { return quality; },
    get dpr() { return camDpr(); },
    setData(data) { DATA = data; buildWorld(); rebuildLabels(); },
    setView(nv, opts = {}) {
      view = nv;
      if (!opts.keepIntro) introFlight = null; // navigation skips the establishing shot
      if (!(opts.keepIntro && introFlight)) {
        const t2 = targetFor(nv);
        flyTo(t2.pos, t2.look, opts.instant ? 0 : 1100);
      }
      rebuildLabels();
    },
    setHot(o) { hot = o; },
    focusPlanet(p) {
      held = p;
      if (p && view.mode === 'star') {
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
      } else if (!p && view.mode === 'star') {
        const t2 = targetFor(view); flyTo(t2.pos, t2.look, 900);
      }
    },
    setFx(fx) { FX = { ...FX, ...fx }; applyFx(); rebuildLabels(); },
    pick(cssX, cssY) {
      ndc.set((cssX / innerWidth) * 2 - 1, -(cssY / innerHeight) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(pickables(), false);
      return hits.length ? hits[0].object.userData.pick : null;
    },
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
