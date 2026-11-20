import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { toCreasedNormals } from './vendor/BufferGeometryUtils.js';

const $ = (s) => document.querySelector(s);
const status = (t, err = false) => { const e = $('#status'); e.textContent = t; e.classList.toggle('err', err); };

// ---------- parameters (names = halo_lamp.py P / Kotlin Params) ----------
const SPEC = [
  { g: 'Optics', n: 'LENS_D', l: 'Lens diameter', min: 30, max: 60, step: 1 },
  { g: 'Optics', n: 'LENS_F', l: 'Lens focal length', min: 40, max: 200, step: 5 },
  { g: 'Optics', n: 'LENS_ET', l: 'Lens edge thickness', min: 1.5, max: 8, step: 0.1 },
  { g: 'Optics', n: 'FILTER_D', l: 'Filter disc Ø', min: 30, max: 54, step: 0.5 },
  { g: 'Optics', n: 'APERTURE_D', l: 'Mask opening Ø', min: 8, max: 50, step: 0.5 },
  { g: 'Optics', n: 'MASK_KIND', l: 'Mask', type: 'select', opts: [[0, 'Disc (sun)'], [1, 'Ring (eclipse)']] },
  { g: 'Optics', n: 'RING_INNER_D', l: 'Ring mask blocker Ø', min: 4, max: 40, step: 0.5 },
  { g: 'LED', n: 'HS_W', l: 'Heatsink side', min: 20, max: 40, step: 0.5 },
  { g: 'LED', n: 'HS_H', l: 'Heatsink height', min: 6, max: 30, step: 0.5 },
  { g: 'LED', n: 'TRAVEL', l: 'Focus travel', min: 6, max: 30, step: 1 },
  { g: 'Stand', n: 'TUBE_D', l: 'Tube Ø', min: 10, max: 25, step: 0.5 },
  { g: 'Stand', n: 'TUBE_LEN', l: 'Tube length', min: 300, max: 1500, step: 10 },
  { g: 'Stand', n: 'BASE_D', l: 'Base Ø', min: 120, max: 250, step: 5 },
  { g: 'Stand', n: 'BASE_H', l: 'Base height', min: 15, max: 50, step: 1 },
  { g: 'Stand', n: 'YOKE_DROP', l: 'Yoke drop (tilt room)', min: 10, max: 60, step: 1 },
  { g: 'Dimmer box', n: 'DB_L', l: 'Box length', min: 50, max: 90, step: 1 },
  { g: 'Dimmer box', n: 'DB_W', l: 'Box width', min: 28, max: 50, step: 1 },
  { g: 'Body', n: 'WALL', l: 'Housing wall', min: 1.6, max: 4, step: 0.1 },
  { g: 'Body', n: 'CT', l: 'Cartridge thickness', min: 2.4, max: 5, step: 0.1 },
];
const PRESETS = [
  ['sunset', 'Sunset (gels)'], ['printed_sunset', 'Printed sunset'], ['gel_radial', 'One amber gel'],
  ['dichroic', 'Dichroic'], ['deep_blue', 'Deep blue'], ['sunset_ring', 'Eclipse ring'],
];
const PARTS = ['housing', 'carriage', 'rear_cap', 'cartridge', 'mask', 'lens_ring', 'yoke', 'base', 'base_lid', 'dimmer_box', 'dimmer_lid'];
const vals = {};
let K = null, io = null, wasmMem = null;
let mode = 'lamp', preset = 'sunset';

async function loadKotlin() {
  if (typeof WebAssembly === 'undefined') throw new Error('WebAssembly unavailable');
  K = await import('./kotlin/halo.mjs');
  io = await import('./kotlin/halo.import-object.mjs');
  wasmMem = io.importObject.intrinsics.memory;
  for (const s of SPEC) vals[s.n] = K.defaultOf(s.n);
}
function pushParams() { for (const s of SPEC) K.setParam(s.n, Number(vals[s.n])); }
function build(kind, q) {
  const t0 = performance.now();
  K.generate(kind, q);
  let pos, idx;
  K.copyOut((pv, nf, pi, ni) => { pos = new Float32Array(wasmMem.buffer, pv, nf).slice(); idx = new Int32Array(wasmMem.buffer, pi, ni).slice(); });
  const info = JSON.parse(K.infoJson()); info.ms = Math.round(performance.now() - t0);
  return { kind, pos, idx, info };
}

// ---------- scene ----------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x15171c);
const camera = new THREE.PerspectiveCamera(40, 1, 1, 50000);
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x303038, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(-400, 600, -300); scene.add(key);
const rim = new THREE.DirectionalLight(0x88aaff, 0.7); rim.position.set(300, 200, 400); scene.add(rim);
const root = new THREE.Group(); scene.add(root);
const M = {
  petg: new THREE.MeshStandardMaterial({ color: 0x6a6d72, roughness: 0.5, metalness: 0.05 }),
  cart: new THREE.MeshStandardMaterial({ color: 0x8a8e94, roughness: 0.5 }),
  mask: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 }),
  alu: new THREE.MeshStandardMaterial({ color: 0xc8cacc, roughness: 0.3, metalness: 0.9 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0xeaf4ff, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.35 }),
  led: new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
  floor: new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.9 }),
  wallBase: new THREE.MeshStandardMaterial({ color: 0x34322f, roughness: 0.95 }),
};
const texLoader = new THREE.TextureLoader(); const texCache = {};
function wallTex(p) { if (!texCache[p]) { const t = texLoader.load(`img/wall_${p}.png`); t.colorSpace = THREE.SRGBColorSpace; texCache[p] = t; } return texCache[p]; }

function geom(part) {
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(part.pos, 3)); g.setIndex(new THREE.BufferAttribute(part.idx, 1));
  g = toCreasedNormals(g, THREE.MathUtils.degToRad(35)); return g;
}
function lensMesh(L) {
  const a = vals.LENS_D / 2, R = vals.LENS_F * 0.5168, et = vals.LENS_ET;
  const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(a, 0), new THREE.Vector2(a, et)];
  const s0 = Math.sqrt(Math.max(R * R - a * a, 0));
  for (let i = 1; i <= 32; i++) { const r = a * (1 - i / 32); pts.push(new THREE.Vector2(r, et + Math.sqrt(Math.max(R * R - r * r, 0)) - s0)); }
  const g = new THREE.LatheGeometry(pts, 96); g.rotateX(Math.PI / 2);   // lathe axis +Y -> +Z
  const m = new THREE.Mesh(g, M.glass); m.position.z = L.z_lf; return m;
}

let cache = {}, layout = null, optics = null, dirty = true, framedFor = '';
function head(L, focusT, explode = 0) {
  const g = new THREE.Group();
  const zLed = L.z_led_min + focusT * (L.z_led_max - L.z_led_min);
  const zc0 = zLed - (L.carr_len - 2.0 + 3.0);
  const add = (k, mat, z, y = 0) => { const m = new THREE.Mesh(geom(cache[k]), mat); m.position.set(0, y, z); g.add(m); return m; };
  add('housing', M.petg, 0);
  add('rear_cap', M.petg, -45 * explode);
  add('carriage', M.petg, zc0 - 25 * explode);
  add('cartridge', M.cart, L.z_cart, 50 * explode);
  add('mask', M.mask, L.z_cart + vals.CT - 0.8 + 6 * explode, 50 * explode);
  add('lens_ring', M.petg, L.z_slot1 + 25 * explode);
  const lens = lensMesh(L); lens.position.z += 45 * explode; g.add(lens);
  const zf = zc0 + L.carr_len - 2.0 - 25 * explode;
  const hs = new THREE.Mesh(new THREE.BoxGeometry(vals.HS_W, vals.HS_W, vals.HS_H), M.alu); hs.position.z = zf - vals.HS_H / 2; g.add(hs);
  const star = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 1.6, 48), M.alu); star.rotation.x = Math.PI / 2; star.position.z = zf + 0.8; g.add(star);
  const led = new THREE.Mesh(new THREE.SphereGeometry(2.6, 24, 12), M.led); led.scale.z = 0.6; led.position.z = zf + 1.6; g.add(led);
  return g;
}

function compose() {
  root.clear();
  const L = layout, fT = Number($('#focus').value);
  if (mode === 'part') {
    const k = $('#part').value; root.add(new THREE.Mesh(geom(cache[k]), k === 'mask' ? M.mask : M.petg));
  } else if (mode === 'head' || mode === 'exploded') {
    root.add(head(L, fT, mode === 'exploded' ? 1 : 0));
    const y = new THREE.Mesh(geom(cache.yoke), M.petg); y.position.y = mode === 'exploded' ? -35 : 0; root.add(y);
  } else {
    const hd = head(L, fT); const hw = new THREE.Group(); hw.add(hd); hd.position.z = -L.z_piv;
    const y = new THREE.Mesh(geom(cache.yoke), M.petg); y.position.z = -L.z_piv; hw.add(y);
    hw.position.y = L.axis_h; root.add(hw);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(vals.TUBE_D / 2, vals.TUBE_D / 2, vals.TUBE_LEN, 32), M.alu); tube.position.y = vals.TUBE_LEN / 2; root.add(tube);
    const b = new THREE.Mesh(geom(cache.base), M.petg); b.rotation.x = -Math.PI / 2; root.add(b);
    // inline dimmer on the cable, lying on the floor knob-up (printed floor-down, used upside down)
    const db = new THREE.Mesh(geom(cache.dimmer_box), M.petg); db.rotation.x = Math.PI / 2; db.position.set(260, vals.DB_H, -120); root.add(db);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 14, 32), M.mask); knob.position.set(270, vals.DB_H + 7, -120); root.add(knob);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), M.floor); fl.rotation.x = -Math.PI / 2; fl.position.y = -0.5; root.add(fl);
    // wall + simulated halo (disc size from the Kotlin ray trace)
    const W = Number($('#wall').value) * 1000;
    const wz = L.z_lf + vals.LENS_ET + 6 - L.z_piv + W;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(9000, 5000), M.wallBase); wall.rotation.y = Math.PI; wall.position.set(0, 2500, wz); root.add(wall);
    const D = 2 * W * Math.tan(optics.coneDeg / 2 * Math.PI / 180);
    const frac = 0.75;   // simulation images are 2.5 x the wall distance wide; the disc fills ~75 % of them
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(D / frac, D / frac),
      new THREE.MeshBasicMaterial({ map: wallTex(preset), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.rotation.y = Math.PI; halo.position.set(0, L.axis_h, wz - 1); root.add(halo);
  }
  frame();
}

function frame() {
  const tag = mode + (mode === 'part' ? $('#part').value : '');
  if (framedFor === tag) return; framedFor = tag;
  const box = new THREE.Box3().setFromObject(root); const c = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3()).length();
  if (mode === 'lamp') { controls.target.set(0, layout.axis_h * 0.8, 500); camera.position.set(-1900, 1500, -1700); }
  else { controls.target.copy(c); camera.position.copy(c).add(new THREE.Vector3(-0.8, 0.5, -0.9).multiplyScalar(s * 0.95)); }
  camera.updateProjectionMatrix(); controls.update();
}

function needed() {
  if (mode === 'part') return [$('#part').value];
  const head = ['housing', 'carriage', 'rear_cap', 'cartridge', 'mask', 'lens_ring', 'yoke'];
  return mode === 'lamp' ? [...head, 'base', 'dimmer_box'] : head;
}

async function refresh() {
  if (!K) return;
  pushParams();
  layout = JSON.parse(K.layoutJson());
  updateOptics();
  const q = Number($('#quality').value);
  if (dirty) { cache = {}; dirty = false; }
  const list = needed().filter((k) => !cache[k]);
  for (let i = 0; i < list.length; i++) {
    status(`building ${list[i]} in Kotlin/Wasm (${i + 1}/${list.length})…`);
    await new Promise((r) => setTimeout(r, 0));
    cache[list[i]] = build(list[i], q);
  }
  compose();
  const shown = mode === 'part' ? cache[$('#part').value] : null;
  const tot = Object.values(cache).reduce((a, c) => a + c.info.ms, 0);
  status(`ready · ${Object.keys(cache).length} parts · ${tot} ms in Kotlin/Wasm`);
  $('#info').textContent = shown ? JSON.stringify(shown.info, null, 1) :
    `lamp height ${(layout.total_h / 10).toFixed(1)} cm · head Ø${(2 * layout.r_out).toFixed(1)} × ${layout.hl.toFixed(1)} mm (+ lens dome)\n` +
    Object.values(cache).map((c) => `${c.kind.padEnd(10)} ${String(c.info.triangles).padStart(7)} tris  ${c.info.volume.toFixed(0).padStart(7)} mm³  closed ${c.info.boundaryEdges === 0 && c.info.nonManifoldEdges === 0}`).join('\n');
}

function updateOptics() {
  optics = JSON.parse(K.opticsJson(Number($('#focus').value)));
  const W = Number($('#wall').value);
  const D = 2 * W * Math.tan(optics.coneDeg / 2 * Math.PI / 180);
  $('#focusv').textContent = `LED ${optics.dLedMask.toFixed(1)} mm behind the filter`;
  $('#wallv').textContent = `${W.toFixed(2)} m`;
  const rows = [
    ['Cone (full angle)', `${optics.coneDeg.toFixed(0)}°`],
    [`Disc Ø on the wall at ${W.toFixed(2)} m`, `${(D * 100).toFixed(0)} cm`],
    ['Disc Ø at 1 m', `${(optics.discAt1m / 10).toFixed(0)} cm`],
    ['Filter area that reaches the wall', `Ø ${(2 * optics.rFootprint).toFixed(1)} mm`],
    ['Colour fringe at the edge (blue↔red, at 1 m)', `${optics.fringe1m.toFixed(0)} mm`],
    ['Original Halo (catalogue)', '90°, Ø = 2 × distance'],
  ];
  $('#opticsTable').innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td class="v">${b}</td></tr>`).join('');
}

// ---------- UI ----------
function makeUI() {
  const c = $('#controls'); let grp = '';
  for (const s of SPEC) {
    if (s.g !== grp) { grp = s.g; const h = document.createElement('div'); h.className = 'foot'; h.style.marginTop = '8px'; h.textContent = grp.toUpperCase(); c.appendChild(h); }
    const d = document.createElement('div'); d.className = 'ctl';
    d.innerHTML = s.type === 'select'
      ? `<div class="top"><label>${s.l}</label><select id="p_${s.n}">${s.opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>`
      : `<div class="top"><label>${s.l}</label><input type="number" id="n_${s.n}" step="${s.step}"></div><input type="range" id="p_${s.n}" min="${s.min}" max="${s.max}" step="${s.step}">`;
    c.appendChild(d);
  }
  for (const s of SPEC) {
    const r = $('#p_' + s.n), n = $('#n_' + s.n);
    const set = (v) => { vals[s.n] = Number(v); r.value = v; if (n) n.value = v; dirty = true; schedule(); };
    r.addEventListener(s.type === 'select' ? 'change' : 'input', () => set(r.value)); if (n) n.addEventListener('change', () => set(n.value));
  }
  const ps = $('#presets');
  ps.innerHTML = PRESETS.map(([k, t]) => `<button data-p="${k}" class="${k === preset ? 'on' : ''}"><img src="img/wall_${k}.png" alt="">${t}</button>`).join('');
  ps.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { preset = b.dataset.p; ps.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); if (mode !== 'lamp') setMode('lamp'); else compose(); }));
  $('#part').innerHTML = PARTS.map((p) => `<option>${p}</option>`).join('');
  document.querySelectorAll('#modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('#part').addEventListener('change', () => schedule());
  $('#focus').addEventListener('input', () => { updateOptics(); compose(); });
  $('#wall').addEventListener('input', () => { updateOptics(); compose(); });
  $('#quality').addEventListener('change', () => { dirty = true; schedule(); });
  $('#reset').addEventListener('click', () => { K.resetParams(); for (const s of SPEC) vals[s.n] = K.defaultOf(s.n); syncUI(); dirty = true; schedule(); });
  $('#dl').addEventListener('click', download);
}
function syncUI() { for (const s of SPEC) { $('#p_' + s.n).value = vals[s.n]; const n = $('#n_' + s.n); if (n) n.value = vals[s.n]; } }
function setMode(m) { mode = m; document.querySelectorAll('#modes button').forEach((x) => x.classList.toggle('on', x.dataset.mode === m)); $('#partRow').style.display = m === 'part' ? '' : 'none'; schedule(); }
let timer = 0; function schedule() { clearTimeout(timer); timer = setTimeout(() => refresh().catch((e) => { console.error(e); status('error: ' + e.message, true); }), 80); }

function download() {
  const k = mode === 'part' ? $('#part').value : 'housing';
  const part = cache[k]; if (!part) return;
  const P = part.pos, I = part.idx, n = I.length / 3;
  const buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf); dv.setUint32(80, n, true); let o = 84;
  for (let t = 0; t < n; t++) { o += 12; for (let q = 0; q < 3; q++) { const i = I[3 * t + q] * 3; dv.setFloat32(o, P[i], true); dv.setFloat32(o + 4, P[i + 1], true); dv.setFloat32(o + 8, P[i + 2], true); o += 12; } o += 2; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'model/stl' })); a.download = `halo-${k}-live.stl`; a.click();
}

function resize() { const v = $('#view'); renderer.setSize(v.clientWidth, v.clientHeight, false); camera.aspect = v.clientWidth / v.clientHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize);
(function loop() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); })();

resize(); makeUI();
try {
  await loadKotlin(); syncUI();
  status('Kotlin/Wasm module loaded');
  await refresh();
  window.halo = { K, vals, refresh, setMode, get cache() { return cache; }, camera, controls };
} catch (e) {
  console.error(e);
  const f = $('#fallback'); f.hidden = false;
  f.innerHTML = `<div><h2>Could not start the Kotlin/Wasm module</h2><p>${e.message}</p><p>This page needs a browser with WebAssembly GC support: Chrome / Edge 119+, Firefox 120+, Safari 18.2+.</p></div>`;
  status('Wasm failed to load', true);
}
