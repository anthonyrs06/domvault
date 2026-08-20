// render3d.js — the living-brain WebGL renderer (three.js, vendored at ./vendor — no CDN,
// no build step). One continuous 3D world you FLY through, pushed to the WebGL ceiling
// in v4: an HDR pipeline (ACES filmic tonemapping + threshold bloom + subtle vignette),
// GLSL FBM nebulae with slow internal churn, a 30–60k point-sprite starfield with
// per-star temperature + twinkle, seeded FBM planet surfaces lit by their sun with a
// real day/night terminator, noise-animated sun coronas — and the point of the whole
// thing, the EDGES: luminous constellation lines with energy pulses traveling along
// them, bright arcing bridges where a connection crosses galaxies.
//
// Camera is free flight (drag to orbit, scroll/pinch to fly, momentum, optional WASD);
// hash routes remain eased fly-to TARGETS, not discrete walls. Labels are semantic-zoom.
// The time-lapse is SIMULATED growth (timelapse.js simulateGrowth — labeled in the UI):
// enterTimelapse(sim, mode) drives event-timed ignitions, edge lacing, a camera that is
// a pure function of t (scrub-exact), and a bloom-surge "moment" on the first bridge.
// mode 'intro' ends exactly at the home pose so the loading cinematic hands the camera
// to the user seamlessly; mode 'cinema' is the wide "watch it grow" replay.
// Same interface as render2d.js plus optional v4 methods (app.js feature-detects them).

import * as THREE from './vendor/three.module.js';
import { EffectComposer } from './vendor/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/postprocessing/RenderPass.js';
import { ShaderPass } from './vendor/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from './vendor/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/postprocessing/OutputPass.js';
import { mulberry32, hashStr, easeC } from './util.js';
import { collectEdges } from './timelapse.js';

const U_HOME = { pos: [0, 92, 238], look: [0, 0, 0] };
const INTRO_FROM = [0, 210, 560];
const LOAD_POS = [0, 34, 96];  // pre-data loading pose (starfield + first spark)
const RING_R = 120;          // galaxy ring radius (world units)
const GAL_R = 24;            // galaxy disc radius
const STAR_RING = 9.5;       // star ring inside a galaxy
const ECC = 0.93;            // slightly elliptical orbits
const BLOOM_STRENGTH = 0.85;

// ---- shared GLSL: hash / value noise / FBM (deterministic, no textures) ----
const GLSL_NOISE = `
float vhash(vec3 p){ p = fract(p*0.3183099 + vec3(0.1,0.17,0.13)); p *= 17.0;
  return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f*f*(3.0-2.0*f);
  return mix(mix(mix(vhash(i+vec3(0.,0.,0.)), vhash(i+vec3(1.,0.,0.)), f.x),
                 mix(vhash(i+vec3(0.,1.,0.)), vhash(i+vec3(1.,1.,0.)), f.x), f.y),
             mix(mix(vhash(i+vec3(0.,0.,1.)), vhash(i+vec3(1.,0.,1.)), f.x),
                 mix(vhash(i+vec3(0.,1.,1.)), vhash(i+vec3(1.,1.,1.)), f.x), f.y), f.z);
}
float fbm(vec3 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a*vnoise(p); p = p*2.03 + vec3(11.7); a *= 0.5; }
  return v;
}
float fbm3(vec3 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a*vnoise(p); p = p*2.11 + vec3(7.3); a *= 0.5; }
  return v;
}`;

export function createRenderer({ canvas, labelLayer, touch, reduced }) {
  const TOUCH = touch, REDUCED = reduced;
  const PAD = TOUCH ? 2.6 : 1;                 // enlarge pick targets on touch
  const SPD = TOUCH ? 0.0016 : 0.004;          // slow orbits — the graph, not orbits, is the spine
  const MOTION = REDUCED ? 0 : 1;              // freezes churn/twinkle/pulses under reduced motion

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x04050c, 1);
  // Quality tier: coarse pointers start low; a frame-time probe can degrade further.
  let quality = TOUCH ? 'low' : 'high';
  const TIER = () => quality === 'high'
    ? { px: 2, field: [24000, 15000, 9000], gal: 1200 }
    : { px: 1.5, field: [7000, 4500, 2500], gal: 600 };
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, TIER().px));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 4000);
  camera.position.set(...(REDUCED ? U_HOME.pos : INTRO_FROM));
  const lookAt = new THREE.Vector3(0, 0, 0);
  camera.lookAt(lookAt);
  scene.add(new THREE.AmbientLight(0x9aa2d0, 0.55));

  // one clock feeds every shader; frozen at 0 under prefers-reduced-motion
  const U_TIME = { value: 0 };

  // ---- post pipeline: ACES + threshold bloom + subtle vignette (tiered) ----
  // high = full-res bloom · low = half-res bloom · degraded = no composer (direct
  // render; the renderer's own ACES tonemapping still applies).
  let composer = null, bloomPass = null;
  const VIGNETTE = {
    uniforms: { tDiffuse: { value: null } },
    vertexShader: `varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        float d = distance(vUv, vec2(0.5, 0.44));
        c.rgb += vec3(0.010, 0.013, 0.038) * (1.0 - smoothstep(0.0, 0.72, d)); // deep-space center lift
        c.rgb *= 1.0 - smoothstep(0.52, 1.05, d) * 0.38;                        // subtle vignette
        gl_FragColor = c;
      }`,
  };
  function sizeComposer() {
    if (!composer) return;
    // UnrealBloomPass already runs its mip chain at half input res (its own setSize
    // halves) — that IS the low tier's half-res bloom; quarter-res gets blocky.
    composer.setSize(innerWidth, innerHeight);
  }
  function buildComposer() {
    if (quality === 'degraded') { composer = null; bloomPass = null; return; }
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // strength/radius/threshold tuned so suns, edge pulses, sparks and ignitions GLOW
    // without the big-mip square artifacts that over-bright point sources produce
    bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight),
      BLOOM_STRENGTH, 0.35, 0.65);
    composer.addPass(bloomPass);
    composer.addPass(new ShaderPass(VIGNETTE));
    composer.addPass(new OutputPass());
    sizeComposer();
  }
  function killComposer() {
    if (composer) { composer.dispose(); composer = null; bloomPass = null; }
  }

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

  // ---- 3-shell parallax starfield: point-sprite shader, gaussian falloff, ----
  // per-star temperature tint (blue-white → amber) and per-star twinkle phase.
  const fieldShells = [];
  const starUniforms = { uTime: U_TIME, uPx: { value: renderer.getPixelRatio() }, uTwinkle: { value: MOTION } };
  const starMatFor = (baseSize) => new THREE.ShaderMaterial({
    uniforms: starUniforms,
    vertexShader: `
      attribute vec3 aColor; attribute float aSize, aPhase;
      uniform float uTime, uPx, uTwinkle;
      varying vec3 vC; varying float vTw;
      void main(){
        vC = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float tw = 1.0 - uTwinkle * 0.45 * (0.5 + 0.5 * sin(uTime * (0.7 + fract(aPhase * 7.31) * 2.4) + aPhase * 6.2831));
        vTw = tw;
        gl_PointSize = aSize * ${baseSize.toFixed(2)} * uPx * (340.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vC; varying float vTw;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float a = exp(-dot(q, q) * 15.0) - 0.014;  // soft gaussian falloff
        if (a <= 0.0) discard;
        gl_FragColor = vec4(vC * vTw, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  function buildField() {
    const counts = TIER().field;
    const cool = new THREE.Color('#b9c9ff'), mid = new THREE.Color('#ffffff'), warm = new THREE.Color('#ffc98a');
    const c = new THREE.Color();
    [[700, counts[0], 1.6], [1000, counts[1], 2.2], [1500, counts[2], 3.2]].forEach(([R, n, size], i) => {
      const rnd = mulberry32(777 + i);
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      const sz = new Float32Array(n), ph = new Float32Array(n);
      for (let j = 0; j < n; j++) {
        // uniform on a sphere shell
        const u = rnd() * 2 - 1, a = rnd() * 6.2832, r = R * (0.8 + rnd() * 0.4);
        const s = Math.sqrt(1 - u * u);
        pos.set([Math.cos(a) * s * r, u * r * 0.7, Math.sin(a) * s * r], j * 3);
        // temperature: most stars cool blue-white, a warm amber minority
        const T = rnd();
        if (T < 0.62) c.lerpColors(cool, mid, T / 0.62);
        else c.lerpColors(mid, warm, (T - 0.62) / 0.38);
        c.multiplyScalar(0.45 + rnd() * 0.55);
        col.set([c.r, c.g, c.b], j * 3);
        sz[j] = 0.6 + rnd() * (rnd() < 0.04 ? 2.4 : 0.9); // rare bright standouts
        ph[j] = rnd();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
      const pts = new THREE.Points(geo, starMatFor(size));
      pts.userData.driftSpeed = 0.0008 / (i + 1); // deeper shells drift slower (parallax)
      scene.add(pts); fieldShells.push(pts);
    });
  }
  buildField();

  // ---- fresnel atmosphere shader (rim glow on planets, galaxy-tinted) ----
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

  // ---- planet surface shader: seeded FBM terrain (rocky vs banded gas giant), ----
  // lit by the system sun with a real day/night terminator. uEmissive carries the
  // hover-neighborhood / discovery glow (HDR-ish so bloom picks it up).
  function planetMat(color, id) {
    const seed = hashStr('planet:' + id);
    const gas = seed % 5 < 2; // ~40% banded gas giants, the rest rocky
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uSeed: { value: (seed % 1000) / 7.3 },
        uSunPos: { value: new THREE.Vector3() },
        uEmissive: { value: 0.1 },
        uGas: { value: gas ? 1 : 0 },
        uTime: U_TIME,
      },
      vertexShader: `
        varying vec3 vObj; varying vec3 vWN; varying vec3 vWP;
        void main(){
          vObj = normalize(position);
          vWN = normalize(mat3(modelMatrix) * normal);
          vWP = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: GLSL_NOISE + `
        uniform vec3 uColor, uSunPos; uniform float uSeed, uEmissive, uGas, uTime;
        varying vec3 vObj, vWN, vWP;
        void main(){
          // slow prograde rotation of the sampled surface = day cycle under the terminator
          float rot = uTime * 0.05 + uSeed;
          float cs = cos(rot), sn = sin(rot);
          vec3 sp = vec3(vObj.x * cs - vObj.z * sn, vObj.y, vObj.x * sn + vObj.z * cs);
          vec3 surf;
          if (uGas > 0.5) {
            // banded gas giant: latitudinal bands warped by FBM storms
            float warp = fbm(sp * 2.1 + uSeed) * 2.2;
            float band = sin(sp.y * (7.0 + mod(uSeed, 5.0)) + warp);
            vec3 lo = uColor * 0.30, hi = uColor * 1.05 + vec3(0.10, 0.09, 0.07);
            surf = mix(lo, hi, smoothstep(-0.7, 0.7, band));
            surf = mix(surf, vec3(0.86, 0.80, 0.70) * uColor * 1.3,
                       smoothstep(0.62, 0.85, fbm3(sp * 3.4 + uSeed * 1.7)) * 0.5); // pale storm cells
          } else {
            // rocky: FBM continents over darker maria, galaxy-tinted regolith
            float h = fbm(sp * 3.1 + uSeed);
            vec3 lo = uColor * 0.16, hi = mix(uColor, vec3(0.72, 0.69, 0.64), 0.28);
            surf = mix(lo, hi, smoothstep(0.34, 0.72, h));
            surf *= 0.72 + 0.28 * smoothstep(0.25, 0.6, fbm3(sp * 6.3 + uSeed * 2.3)); // crater mottle
          }
          vec3 N = normalize(vWN);
          vec3 L = normalize(uSunPos - vWP);
          float nd = dot(N, L);
          float day = smoothstep(-0.12, 0.22, nd);            // the terminator
          float wrap = clamp(nd * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = surf * (0.045 + day * (0.55 + 0.75 * wrap));
          col += uColor * uEmissive;                           // hood/discovery glow (bloomable)
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
  }

  // ---- sun: noise-animated corona billboard (HDR core feeds the bloom pass) ----
  function coronaMat(seed) {
    return new THREE.ShaderMaterial({
      uniforms: { uTime: U_TIME, uSeed: { value: (seed % 100) / 3.7 }, uIntensity: { value: 1 }, uScale: { value: 7 } },
      vertexShader: `
        uniform float uScale; varying vec2 vUv;
        void main(){
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); // camera-facing billboard
          mv.xy += position.xy * uScale;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: GLSL_NOISE + `
        uniform float uTime, uSeed, uIntensity; varying vec2 vUv;
        void main(){
          vec2 q = (vUv - 0.5) * 2.0;
          float r = length(q);
          vec2 dir = r > 0.001 ? q / r : vec2(1.0, 0.0);
          float fl = fbm(vec3(dir * 2.3, uSeed + uTime * 0.22 + r * 2.2)); // corona flames
          float core = exp(-r * r * 22.0) * 2.3;                            // HDR — blooms
          float halo = pow(max(1.0 - r, 0.0), 2.4) * (0.35 + 0.85 * fl);
          vec3 col = vec3(1.0, 0.95, 0.82) * core + vec3(1.0, 0.78, 0.38) * halo;
          float a = clamp(core + halo, 0.0, 1.0) * uIntensity;
          if (a < 0.004) discard;
          gl_FragColor = vec4(col * uIntensity, a);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
  }

  // ---- nebula: layered FBM-noise planes per galaxy (replaces v3's sprite blobs). ----
  // 3 planes at different heights = camera parallax; time-warped FBM = slow internal
  // churn; deterministic per-galaxy seed; tinted per galaxy color.
  function nebulaMat(color, seed, baseOp) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uSeed: { value: (seed % 1000) / 11.3 },
        uTime: U_TIME,
        uOpacity: { value: baseOp },
        uMotion: { value: MOTION },
      },
      vertexShader: `varying vec2 vUv; varying vec3 vW;
        void main(){ vUv = uv; vW = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: GLSL_NOISE + `
        uniform vec3 uColor; uniform float uSeed, uTime, uOpacity, uMotion;
        varying vec2 vUv; varying vec3 vW;
        void main(){
          vec2 p = (vUv - 0.5) * 7.0;
          float r = length(p) / 3.5;
          float t = uTime * 0.03 * uMotion;
          vec2 w = vec2(fbm(vec3(p * 0.55, uSeed + t)),
                        fbm(vec3(p * 0.55 + 3.7, uSeed - t * 1.31)));  // domain-warp = churn
          float n = fbm(vec3(p * 0.9 + (w - 0.5) * 2.6, uSeed * 1.7 + t * 0.4));
          float body = smoothstep(1.0, 0.12, r);
          // the fog thins right around the camera, so flying INTO a galaxy (and
          // landing on a planet) stays readable instead of blowing out additively
          float near = smoothstep(3.5, 16.0, distance(vW, cameraPosition));
          float d = pow(max(n - 0.16, 0.0), 1.5) * body * near;
          if (d < 0.003) discard;
          vec3 col = uColor * (0.5 + 1.1 * n) + vec3(0.05, 0.06, 0.11) * n * 0.6;
          gl_FragColor = vec4(col * 1.5, d * uOpacity);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
  }

  // ---- world build: galaxies → stars → planets ----
  let DATA = { galaxies: [] };
  let view = { mode: 'universe', galaxy: null, star: null };
  let hot = null, held = null;
  let FX = { discovered: new Set(), todayId: null, showTrail: true, trailIds: [], progress: new Map() };
  const pid = (p) => (p.manifest && p.manifest.id) || p.name;

  const worldGroup = new THREE.Group(); scene.add(worldGroup);
  let gEntries = []; // [{g, grp, hit, discMat, nebulae, core, stars:[{s, grp, planets:[...], light, corona}]}]
  const planetById = new Map(); // id -> first render entry {entry, sEntry, gEntry}
  const entriesById = new Map(); // id -> EVERY pEntry (multi-galaxy planets render per galaxy)
  const sphereGeo = new THREE.SphereGeometry(0.24, 48, 32); // dense enough for landing close-ups
  const atmoGeo = new THREE.SphereGeometry(0.34, 32, 20);
  const coronaGeo = new THREE.PlaneGeometry(1, 1);

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

      // layered FBM nebula planes ("volumetric" churn; parallax from stacked heights)
      const nebulae = [];
      for (let k = 0; k < 3; k++) {
        const baseOp = 0.5 - k * 0.13;
        const mat = nebulaMat(g.color, seed + k * 131, baseOp);
        const size = GAL_R * (2.6 + k * 0.8);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.82), mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.z = rnd() * Math.PI * 2;
        mesh.position.set((rnd() - 0.5) * 5, (k - 1) * 2.4 + (rnd() - 0.5), (rnd() - 0.5) * 5);
        grp.add(mesh);
        nebulae.push({ mesh, mat, baseOp });
      }
      const core = new THREE.Sprite(additive(glowTex, '#ffffff', 0.3));
      core.material.color.setScalar(1.6); // HDR-ish core feeds bloom
      core.scale.setScalar(10); grp.add(core);

      // invisible pick volume
      const hit = new THREE.Mesh(new THREE.SphereGeometry(GAL_R, 8, 8),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      hit.userData.pick = { type: 'galaxy', o: g }; grp.add(hit);

      const gEntry = { g, grp, hit, discMat, nebulae, core, stars: [] };
      gEntries.push(gEntry);

      g.stars.forEach((s, j) => {
        s.planets.forEach((p, k) => { if (typeof p === 'string') s.planets[k] = { name: p }; });
        s.gal = g; // crumbs/back-navigation need the owning galaxy (same as the 2D layout)
        const sa = (j / Math.max(g.stars.length, 1)) * Math.PI * 2;
        const sGrp = new THREE.Group();
        sGrp.position.set(Math.cos(sa) * STAR_RING, 1.5, Math.sin(sa) * STAR_RING * 0.8);
        grp.add(sGrp);
        const corona = new THREE.Mesh(coronaGeo, coronaMat(hashStr(String(s.handle) + j)));
        corona.frustumCulled = false; // billboard offsets happen in the vertex shader
        sGrp.add(corona);
        const light = new THREE.PointLight(0xfff2d0, 60, 60, 1.8); sGrp.add(light);
        const sHit = new THREE.Mesh(new THREE.SphereGeometry(2.5 * PAD, 8, 8),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
        sHit.userData.pick = { type: 'star', o: s }; sGrp.add(sHit);

        const sEntry = { s, grp: sGrp, hit: sHit, planets: [], light, corona };
        gEntry.stars.push(sEntry);

        const n = s.planets.length, span = n > 1 ? 7.0 / (n - 1) : 0;
        const atmo = atmosphereMat(g.color);
        s.planets.forEach((p, k) => {
          const orbitR = 2.0 + k * span;
          // orbit trail — kept, but dim: the link graph is the visual spine now
          const curve = new THREE.EllipseCurve(0, 0, orbitR, orbitR * ECC);
          const linePts = curve.getPoints(96).map((v) => new THREE.Vector3(v.x, 0, v.y));
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(linePts),
            new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.04, depthWrite: false }));
          sGrp.add(line);
          const mat = planetMat(g.color, pid(p));
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

  // helpers the time-lapse fades run through (nebulae + suns are shader-driven now).
  // Unborn galaxies are barely-there ghosts so the first spark really is alone in
  // darkness, while still giving the eye somewhere to expect the next ignition.
  function galaxyFade(ge, f) {
    ge.discMat.opacity = 0.04 + 0.91 * f;
    for (const nb of ge.nebulae) nb.mat.uniforms.uOpacity.value = nb.baseOp * (0.07 + 0.93 * f);
    ge.core.material.opacity = 0.3 * (0.1 + 0.9 * f);
  }
  function sunFade(se, f) {
    const k = Math.min(1, f * 3);
    se.corona.material.uniforms.uIntensity.value = 0.05 + 0.95 * k;
    se.light.intensity = 60 * (0.1 + 0.9 * k);
  }
  function restoreWorldFades() {
    for (const ge of gEntries) { galaxyFade(ge, 1); for (const se of ge.stars) sunFade(se, 1); }
  }

  // ---- THE EDGES ARE THE SHOW: constellation lines between linked planets, with ----
  // animated energy pulses traveling along them. Same-galaxy links: slow subtle
  // threads. Cross-galaxy links: bright arcing bridges with faster, brighter pulses.
  // Hover-neighborhood lighting also raises the pulse rate (uBoost).
  const edgeGroup = new THREE.Group(); scene.add(edgeGroup);
  let edgeEntries = []; // [{a, b, key, cross, line, posAttr, segs, baseOp, mat}]
  const adjacency = new Map(); // id -> Set(id)
  function edgeMat(cross, baseOp, key) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: U_TIME,
        uOpacity: { value: baseOp },
        uRate: { value: cross ? 0.30 : 0.10 },       // pulses/sec — bridges pulse faster
        uAmp: { value: (cross ? 1.8 : 1.0) * MOTION }, // and brighter (0 = reduced motion)
        uBoost: { value: 0 },
        uPhase: { value: (hashStr('pulse:' + key) % 997) / 997 },
      },
      vertexShader: `
        attribute float aT; attribute vec3 aCol;
        varying float vT; varying vec3 vC;
        void main(){ vT = aT; vC = aCol;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uTime, uOpacity, uRate, uAmp, uBoost, uPhase;
        varying float vT; varying vec3 vC;
        void main(){
          float p = fract(uTime * uRate * (1.0 + 2.2 * uBoost) + uPhase);
          float d = vT - p;
          float pulse = exp(-d * d * 900.0) * uAmp * (1.0 + 1.5 * uBoost);
          vec3 col = vC * (uOpacity * (1.0 + 0.5 * uBoost) + pulse);
          gl_FragColor = vec4(col, 1.0);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
  }
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
      const ts = new Float32Array(segs + 1);
      const ca = new THREE.Color(ra.gEntry.g.color).lerp(new THREE.Color('#ffffff'), 0.35);
      const cb = new THREE.Color(rb.gEntry.g.color).lerp(new THREE.Color('#ffffff'), 0.35);
      const c = new THREE.Color();
      for (let i = 0; i <= segs; i++) {
        c.lerpColors(ca, cb, i / segs);
        col.set([c.r, c.g, c.b], i * 3);
        ts[i] = i / segs;
      }
      const geo = new THREE.BufferGeometry();
      const posAttr = new THREE.BufferAttribute(pos, 3);
      geo.setAttribute('position', posAttr);
      geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aT', new THREE.BufferAttribute(ts, 1));
      const baseOp = cross ? 0.45 : 0.14;
      const key = a + '|' + b;
      const mat = edgeMat(cross, baseOp, key);
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false; // endpoints move every frame; skip stale-bounds culling
      edgeGroup.add(line);
      edgeEntries.push({ a, b, key, cross, line, posAttr, segs, baseOp, mat });
    }
  }
  const EV_A = new THREE.Vector3(), EV_B = new THREE.Vector3(), EV_C = new THREE.Vector3();
  const EV_1 = new THREE.Vector3(), EV_2 = new THREE.Vector3();
  function updateEdges() {
    for (const e of edgeEntries) {
      const ra = planetById.get(e.a), rb = planetById.get(e.b);
      if (!ra || !rb) continue;
      if (!ra.entry.mesh.visible || !rb.entry.mesh.visible) { e.line.visible = false; continue; }
      if (tl && tl.edgeT) {
        // simulated growth: an edge laces in at ITS OWN moment, after both endpoints
        const bt = tl.edgeT.get(e.key);
        if (bt === undefined || bt > tl.t) { e.line.visible = false; continue; }
      }
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
      const u = e.mat.uniforms;
      if (!hood) { u.uOpacity.value = e.baseOp; u.uBoost.value = 0; continue; }
      const touches0 = hood.l0.has(e.a) || hood.l0.has(e.b);
      const in12 = (x) => hood.l0.has(x) || hood.l1.has(x) || hood.l2.has(x);
      if (touches0) { u.uOpacity.value = 0.95; u.uBoost.value = 1; }
      else if (in12(e.a) && in12(e.b)) { u.uOpacity.value = Math.min(0.6, e.baseOp + 0.35); u.uBoost.value = 0.45; }
      else { u.uOpacity.value = e.baseOp * 0.25; u.uBoost.value = 0; }
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
      for (const pe of entries) pe.mat.uniforms.uEmissive.value = v;
    }
  }

  // ---- sparks: shooting stars between NOT-yet-linked ideas ("watch it think") ----
  // Deterministic: one PRNG seeded from the session minute drives every interval,
  // pair choice, and ignition flash — no per-frame Math.random. Frozen under
  // prefers-reduced-motion. v4: HDR heads with fading bloom trails.
  const sparkRnd = mulberry32(hashStr('spark:' + Math.floor(Date.now() / 60000)));
  const TRAIL_N = 14;
  let sparks = [];        // active: {t0, dur, A, B, C, head, trail, hist, flashAtEnd, target}
  let flashes = [];       // {sprite, t0, dur}
  let nextSparkAt = 0;
  function scheduleSpark(now) { nextSparkAt = now + 8000 + sparkRnd() * 7000; }
  function makeTrail() {
    const pos = new Float32Array(TRAIL_N * 3);
    const col = new Float32Array(TRAIL_N * 3);
    for (let i = 0; i < TRAIL_N; i++) {
      const k = Math.pow(1 - i / TRAIL_N, 1.7) * 1.6; // brightest at the head, HDR tip
      col.set([k, k, k * 1.06], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    line.frustumCulled = false;
    return line;
  }
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
    head.material.color.setRGB(1.7, 1.7, 1.9); // HDR head → bloom streak
    head.scale.setScalar(1.4); scene.add(head);
    const trail = makeTrail(); scene.add(trail);
    sparks.push({ t0: now, dur: 1500 + sparkRnd() * 500, A, B, C, head, trail, hist: [], flashAtEnd: sparkRnd() < 0.3, target: rb });
  }
  function updateSparks(now) {
    if (REDUCED || tl) return;
    if (!nextSparkAt) scheduleSpark(now);
    if (now >= nextSparkAt) { spawnSpark(now); scheduleSpark(now); }
    sparks = sparks.filter((sp) => {
      const k = (now - sp.t0) / sp.dur;
      if (k >= 1) {
        sp.head.removeFromParent(); sp.trail.removeFromParent();
        sp.trail.geometry.dispose(); sp.trail.material.dispose();
        if (sp.flashAtEnd) ignitionFlash(sp.B, now, '#ffe9b8');
        return false;
      }
      EV_1.lerpVectors(sp.A, sp.C, k); EV_2.lerpVectors(sp.C, sp.B, k); EV_1.lerp(EV_2, k);
      sp.head.position.copy(EV_1);
      sp.head.material.opacity = 0.9 * Math.sin(Math.PI * k); // ease in+out
      // trail: history of head positions, brightest at the front (bloom picks it up)
      sp.hist.unshift(EV_1.clone());
      if (sp.hist.length > TRAIL_N) sp.hist.pop();
      const pa = sp.trail.geometry.getAttribute('position');
      for (let i = 0; i < TRAIL_N; i++) {
        const v = sp.hist[Math.min(i, sp.hist.length - 1)];
        pa.array.set([v.x, v.y, v.z], i * 3);
      }
      pa.needsUpdate = true;
      sp.trail.material.opacity = 0.85 * Math.sin(Math.PI * k);
      return true;
    });
  }
  function ignitionFlash(worldPos, now, color = '#ffffff') {
    const f = new THREE.Sprite(additive(glowTex, color, 0.9));
    f.material.color.multiplyScalar(1.8); // HDR flash → ignitions GLOW through the bloom pass
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

  // ---- TIME-LAPSE: SIMULATED growth (labeled in the UI — never real history). ----
  // Driven from app.js: enterTimelapse(sim, mode) → setTimelapseT(t∈[0,1]) →
  // exitTimelapse(). sim comes from timelapse.js simulateGrowth: planets ignite at
  // their own event times (flash on forward crossings), edges lace at THEIR times
  // (strictly after both endpoints), and the first cross-galaxy bridge gets a
  // moment: the camera leans toward it and the bloom surges. The camera is a pure
  // function of t so scrubbing is exact. mode 'intro' ends exactly at U_HOME for a
  // seamless hand-off to free flight; mode 'cinema' is the wide replay.
  let tl = null; // { mode, t, lastT, pT, edgeT, firstBridge, n, G0, PA, sphA, thDelta }
  const HOME_SPH = new THREE.Spherical().setFromVector3(new THREE.Vector3(...U_HOME.pos));
  const LOAD_V = new THREE.Vector3(...LOAD_POS);
  const ORIGIN = new THREE.Vector3(0, 0, 0);
  const TL_P = new THREE.Vector3(), TL_L = new THREE.Vector3();
  const smooth = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  function enterTimelapse(sim, mode = 'cinema') {
    tl = {
      mode, t: 0, lastT: 0, n: sim.planets.length,
      pT: new Map(sim.planets.map((o) => [o.id, o.t])),
      edgeT: new Map(sim.edges.map((e) => [e.key, e.t])),
      firstBridge: sim.firstBridge || null,
    };
    // intro-path anchors (galaxy group positions are static; only their spin animates)
    const first = sim.planets[0] && planetById.get(sim.planets[0].id);
    tl.G0 = first ? first.gEntry.grp.position.clone() : new THREE.Vector3(0, 0, -RING_R);
    const out = tl.G0.clone().setY(0); if (out.lengthSq() < 1) out.set(0, 0, -1); out.normalize();
    tl.PA = tl.G0.clone().addScaledVector(out, 44); tl.PA.y += 22;
    tl.sphA = new THREE.Spherical().setFromVector3(tl.PA);
    let dTh = HOME_SPH.theta - tl.sphA.theta;
    while (dTh > Math.PI) dTh -= Math.PI * 2;
    while (dTh < -Math.PI) dTh += Math.PI * 2;
    tl.thDelta = dTh;
    cancelFlights();
    if (trailLine) { trailLine.removeFromParent(); trailNodes.removeFromParent(); trailLine = trailNodes = null; }
    if (beacon) { beacon.visible = false; sunBeacon.visible = false; }
    labelLayer.style.opacity = 0.35; // galaxy names stay as faint wayfinding
    setTimelapseT(0);
  }
  function bridgeW(t) {
    // attention window around the first cross-galaxy bridge (~7.5% of the timeline)
    if (!tl || !tl.firstBridge) return 0;
    const k = (t - (tl.firstBridge.t - 0.012)) / 0.075;
    if (k <= 0 || k >= 1) return 0;
    return Math.sin(Math.PI * k);
  }
  function bridgeMid(out) {
    const ra = planetById.get(tl.firstBridge.a), rb = planetById.get(tl.firstBridge.b);
    ra.entry.mesh.getWorldPosition(EV_1); rb.entry.mesh.getWorldPosition(EV_2);
    return out.addVectors(EV_1, EV_2).multiplyScalar(0.5);
  }
  function tlCamera(t) {
    if (tl.mode === 'intro') {
      // loading cinematic: starts at the pre-data pose over darkness, sweeps low
      // toward the founding galaxy, then pulls back and lands EXACTLY on U_HOME
      const A_END = 0.12;
      if (t < A_END) {
        const k = easeC(t / A_END);
        TL_P.lerpVectors(LOAD_V, tl.PA, k);
        TL_L.lerpVectors(ORIGIN, tl.G0, k);
      } else {
        const k = easeC((t - A_END) / (1 - A_END));
        const r = tl.sphA.radius + (HOME_SPH.radius - tl.sphA.radius) * k;
        const ph = tl.sphA.phi + (HOME_SPH.phi - tl.sphA.phi) * k;
        const th = tl.sphA.theta + tl.thDelta * k;
        TL_P.setFromSphericalCoords(r, ph, th);
        TL_L.lerpVectors(tl.G0, ORIGIN, smooth(0.2, 0.62, t));
      }
    } else {
      // cinematic pull-back: low and close over the first ignitions → wide
      // establishing shot of the finished universe
      const e = easeC(t);
      const r = 120 + 210 * e;
      const th = -Math.PI / 2 + 0.85 * t;
      const ph = 1.22 - 0.34 * e;
      TL_P.set(r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph), r * Math.sin(ph) * Math.cos(th));
      TL_L.set(0, 0, 0);
    }
    // the first bridge is a MOMENT: the camera leans toward it, briefly
    const w = bridgeW(t);
    if (w > 0) {
      bridgeMid(EV_C);
      TL_L.lerp(EV_C, 0.5 * w);
      TL_P.lerp(EV_C, 0.12 * w);
    }
    camera.position.copy(TL_P);
    lookAt.copy(TL_L);
    camera.lookAt(lookAt);
  }
  function setTimelapseT(t) {
    if (!tl) return;
    tl.t = Math.max(0, Math.min(1, t));
    const now = performance.now();
    for (const [id, entries] of entriesById) {
      const bt = tl.pT.get(id);
      const on = bt !== undefined && bt <= tl.t;
      if (on && !entries[0].mesh.visible && tl.t > tl.lastT && !REDUCED) {
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
        sunFade(se, se.planets.length ? sOn / se.planets.length : 1);
      }
      galaxyFade(ge, gTot ? gOn / gTot : 1);
    }
    tl.lastT = tl.t;
    tlCamera(tl.t);
    // the bloom SURGES with the first bridge (pure fn of t → scrub-exact)
    if (bloomPass) bloomPass.strength = BLOOM_STRENGTH + 0.55 * bridgeW(tl.t);
  }
  function exitTimelapse() {
    if (!tl) return;
    tl = null;
    for (const entries of entriesById.values()) for (const pe of entries) { pe.mesh.visible = true; pe.orbit.visible = true; }
    restoreWorldFades();
    if (bloomPass) bloomPass.strength = BLOOM_STRENGTH;
    if (beacon) { beacon.visible = true; sunBeacon.visible = true; }
    labelLayer.style.opacity = '';
    applyFx();
    // no camera write here: the intro ends exactly at U_HOME (seamless hand-off);
    // the cinema exit is followed by app.js navigating home (setView flight)
  }

  // ---- per-frame update ----
  const V = new THREE.Vector3();
  let frameCount = 0, probeAcc = 0, lastNow = 0, trailTick = 0;
  let protoSpark = null, loading = false;
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
    if (!REDUCED) U_TIME.value = now / 1000; // one clock for every shader
    // frame-time probe → degrade gracefully instead of stuttering
    if (frameCount > 30 && frameCount <= 150) probeAcc += dt;
    if (frameCount === 150 && probeAcc / 120 > 26 && quality !== 'degraded') {
      quality = 'degraded';
      renderer.setPixelRatio(1);
      starUniforms.uPx.value = 1;
      fieldShells[2].visible = false; // drop the deepest shell
      killComposer();                 // no bloom on degraded; ACES stays on the renderer
      for (const ge of gEntries) if (ge.nebulae[2]) ge.nebulae[2].mesh.visible = false;
    }
    frameCount++;

    if (!REDUCED) {
      for (const sh of fieldShells) sh.rotation.y += sh.userData.driftSpeed * (dt / 16);
      for (const ge of gEntries) ge.grp.rotation.y += ge.grp.userData.spin * (dt / 16) * (view.galaxy === ge.g || view.mode === 'universe' ? 1 : 0.4);
    }
    // orbital motion (hover/panel focus pauses that planet)
    for (const ge of gEntries) for (const se of ge.stars) {
      se.grp.getWorldPosition(EV_A); // the sun lights its planets' terminators
      for (const pe of se.planets) {
        if (!REDUCED && hot !== pe.p && held !== pe.p) pe.p._ph += SPD * (0.5 + pe.k * 0.08) * (dt / 16);
        pe.mesh.position.set(Math.cos(pe.p._ph) * pe.orbitR, 0, Math.sin(pe.p._ph) * pe.orbitR * ECC);
        pe.mat.uniforms.uSunPos.value.copy(EV_A);
      }
    }
    // pre-data loading: a first spark pulsing alone in darkness (fades once growth starts)
    if (protoSpark) {
      if (loading && !tl) {
        const k = REDUCED ? 0.6 : 0.55 + 0.35 * Math.sin(now * 0.004);
        protoSpark.material.opacity = k;
        protoSpark.scale.setScalar(2.4 + k * 1.4);
      } else {
        protoSpark.material.opacity -= dt / 400;
        if (protoSpark.material.opacity <= 0.02) { protoSpark.removeFromParent(); protoSpark = null; }
      }
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
    if (composer) composer.render(); else renderer.render(scene, camera);
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
  function startLoop() {
    if (started) return; started = true;
    renderer.setSize(innerWidth, innerHeight);
    buildComposer();
    requestAnimationFrame(tick);
  }
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
      sizeComposer();
    },
    // the loading experience: render immediately (starfield + a first spark pulsing
    // in darkness) while universe.json is still in flight; app.js then feeds the
    // real planets in via enterTimelapse(sim, 'intro')
    startLoading() {
      loading = true;
      camera.position.copy(LOAD_V); lookAt.set(0, 0, 0); camera.lookAt(lookAt);
      protoSpark = new THREE.Sprite(additive(glowTex, '#ffe9c8', 0));
      protoSpark.material.color.multiplyScalar(2.0);
      protoSpark.scale.setScalar(3); scene.add(protoSpark);
      startLoop();
    },
    endLoading() { loading = false; },
    start(opts = {}) {
      if (started) { loading = false; return; } // startLoading already runs the loop
      if (opts.intro && !REDUCED) {
        introFlight = { fromP: new THREE.Vector3(...INTRO_FROM), toP: new THREE.Vector3(...U_HOME.pos), t0: performance.now(), dur: 4200 };
      } else { camera.position.set(...U_HOME.pos); }
      startLoop();
    },
    skipIntro() { if (introFlight) { camera.position.copy(introFlight.toP); introFlight = null; } },
    snapshot() {
      if (composer) composer.render(); else renderer.render(scene, camera);
      return canvas.toDataURL('image/png');
    },
  };
}
