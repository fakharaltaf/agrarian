// The Region view: a 2.5D diorama of the whole region, reached through the clouds. Your land in the middle, the main road running
// west to the Arid Frontier and east to the Coastal Trade Hub, the river running south past the River Plains to the bay, and the
// Tropical Highlands across the water. Drawn once from fixed geography; only the caravans and labels follow the game.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { box, cone, cyl, gable, hauler, mat, PAL, sphere } from './models';
import { graphicsQuality } from './Scene3D';
import { focusNeighbour, getGame, go, throughClouds, travel, useGame, useStore } from '../../stores/game';
import { attitude, isNeighbour, NEIGHBOUR_IDS, NEIGHBOURS, regionOf, ROUTE_SIDE, type NeighbourId } from '../../simulation/region-state';
import { GOODS, REGIONS } from '../../simulation/config';
import { population } from '../../simulation/community-state';
import { cityActive } from '../../simulation/city-state';
import { num } from '../format';

type P = [number, number];
type Place = NeighbourId | 'home';

// ---------------------------------------------------------------- geography (x east, z south; one unit ≈ a few hundred metres)
const RIVER_KEYS: P[] = [[-14, -92], [-11, -64], [-6, -44], [-10, -26], [-8, -8], [-6, 8], [-2, 22], [3, 34], [8, 48], [12, 60], [15, 72], [18, 84], [20, 96], [22, 108]];
const ROAD_KEYS: P[] = [[-71, -3], [-58, -6], [-44, -3], [-30, -1], [-17, 0], [-8, 0], [2, 0], [14, 1], [28, -1], [43, 1], [56, 0], [64, 0]];
const TOWNS: Record<Place, P> = { home: [7, -2], arid: [-75, -3], coastal: [63, -1], river: [22, 62], tropics: [-30, 88] };
/** Ground kept clear of fields and woods for each town (centre and radius): your farmstead and your town, then the four neighbours. */
const AREAS: [number, number, number][] = [[5, -7, 5.5], [9, 5, 8], [-75, -3, 10.5], [62, -1, 9.5], [22, 62, 8], [-30, 88, 9], [-40, 82, 5.5], [-20, 95, 5.5]];
const inTown = (x: number, z: number, pad = 0) => AREAS.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r + pad);
const MESAS: [number, number, number, number][] = [[-58, -24, 4.5, 4.2], [-86, 14, 6, 5.5], [-50, 18, 3.2, 3.4], [-92, -22, 5, 4.8], [-64, 30, 3.6, 3.8]];
const PIVOTS: P[] = [[-62, 9], [-60, -15], [-84, -8]];

const curve = (keys: P[], n: number, y = 0) => new THREE.CatmullRomCurve3(keys.map(([x, z]) => new THREE.Vector3(x, y, z))).getSpacedPoints(n).map((v) => [v.x, v.z] as P);
const RIVER = curve(RIVER_KEYS, 160), ROAD = curve(ROAD_KEYS, 160);
/** From the river's mouth across the bay to the Tropical Highlands' jetty. */
const BAY_PATH: P[] = [[16, 90], [6, 91], [-4, 88]];
/** What you can see: round each town (the harbour with a little of the sea), along the main road, down the river and across the bay. The rest lies under cloud, for later. */
const SIGHT: [number, number, number][] = [[7, -1, 20], [-75, -3, 15], [70, 0, 14], [22, 62, 14], [-28, 88, 14]];
const DOWNRIVER = RIVER.filter(([, z]) => z > -6 && z < 92);
function hidden(x: number, z: number) {
  let d = Math.min(...SIGHT.map(([cx, cz, r]) => Math.hypot(x - cx, z - cz) - r), lineDist(x, z, ROAD) - 5, lineDist(x, z, DOWNRIVER) - riverW(z) - 5, lineDist(x, z, BAY_PATH) - 4);
  if (x > 72) d = Math.max(d, x - 86); // only a strip of the sea past the harbour
  return d;
}

const hash = (x: number, z: number) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x: number, z: number) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x: number, z: number) => { let t = 0, a = 0.5, f = 1; for (let i = 0; i < 4; i++) { t += a * vnoise(x * f, z * f); f *= 2; a *= 0.5; } return t / 0.9375; };
const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function lineDist(x: number, z: number, line: P[]) {
  let best = 1e9;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1], dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
/** How far inland a point is (negative out at sea): the coast all round, the east shore with the harbour's cove, and the southern bay. */
function landness(x: number, z: number) {
  const n = (fbm(x * 0.05 + 7, z * 0.05) - 0.5) * 10;
  const edge = (1 - Math.hypot(x / 106, (z - 12) / 102)) * 60 + n;
  const east = 75 + Math.sin(z * 0.09) * 4 + n * 0.5 - 7 * Math.exp(-(((z - 3) / 6) ** 2)) - x;
  const bay = Math.max(84 + Math.sin(x * 0.12) * 3 + n * 0.3 - z, -5 + Math.sin(z * 0.25) * 2 - x);
  return Math.min(edge, east, bay);
}
const riverW = (z: number) => 1 + Math.max(0, z + 90) * 0.011;
/** The lie of the land before towns level it and the river cuts it. */
function landform(x: number, z: number) {
  let h = 0.55 + fbm(x * 0.04, z * 0.04) * 1.3;
  const arid = sstep(-34, -48, x);
  h += arid * (Math.sin(x * 0.32 + z * 0.14 + fbm(x * 0.1, z * 0.1) * 3) * 0.5 + 0.5) * 1.1; // dunes
  for (const [mx, mz, r, mh] of MESAS) { const d = Math.hypot(x - mx, z - mz) + (fbm(x * 0.3, z * 0.3) - 0.5) * 2.4; h = Math.max(h, mh * sstep(r + 1.4, r - 0.2, d) + h * (1 - sstep(r + 1.4, r - 0.2, d))); }
  const ridge = 1 - Math.abs(fbm(x * 0.06 + 3, z * 0.06) * 2 - 1);
  h += sstep(-36, -60, z) * (4 + ridge * 15 + fbm(x * 0.15, z * 0.15) * 4); // the mountains to the north
  h += sstep(66, 76, z) * sstep(-4, -16, x) * (2 + fbm(x * 0.09 + 11, z * 0.09) * 8); // the tropical hills
  h += sstep(44, 58, x) * sstep(-12, -26, z) * fbm(x * 0.1, z * 0.1) * 2.5; // the coastal headland
  return h;
}
let levels: number[] | null = null;
function height(x: number, z: number) {
  let h = landform(x, z);
  levels ??= AREAS.slice(0, 6).map(([cx, cz]) => Math.max(0.6, landform(cx, cz)));
  for (let i = 0; i < 6; i++) { const [cx, cz, r] = AREAS[i], t = sstep(r + 3, r - 0.5, Math.hypot(x - cx, z - cz)); if (t > 0) h = lerp(h, levels[i], t); } // each town stands on level ground
  const d = lineDist(x, z, RIVER), w = riverW(z);
  h = lerp(h, 0.45, sstep(w + 9, w + 2, d) * 0.85); // the river's valley
  h = lerp(h, -0.9, sstep(w + 1.1, w * 0.55, d)); // and its bed
  return lerp(-3.4, h, sstep(-3, 2.6, landness(x, z)));
}
const C = (hex: number) => new THREE.Color(hex);
const COL = { sandWet: C(0xcbb27c), deep: C(0x3f7f86), beach: C(0xead7a3), grass: C(0x86b552), grass2: C(0x6ea443), lush: C(0x6cad45), sand: C(0xdcb878), sand2: C(0xcf9f62), mesa: C(0xc06c40), mesa2: C(0xa9563a), jungle: C(0x3f8f3a), jungle2: C(0x337d33), rock: C(0x8d8677), rock2: C(0x6f6a60), snow: C(0xf3f6f8), coastGrass: C(0x8cba5e) };
function groundColor(x: number, z: number, h: number, slope: number, out: THREE.Color) {
  const n = fbm(x * 0.12 + 40, z * 0.12);
  if (h < -0.15) return out.copy(COL.sandWet).lerp(COL.deep, sstep(-0.2, -3, h));
  const L = landness(x, z);
  out.copy(COL.grass).lerp(COL.grass2, n);
  if (z > 18 && z < 84 && x > -20) out.lerp(COL.lush, sstep(18, 30, z) * 0.7); // the river plains
  if (x > 46) out.lerp(COL.coastGrass, sstep(46, 56, x));
  const arid = sstep(-32, -46, x);
  if (arid > 0) out.lerp(new THREE.Color().copy(COL.sand).lerp(COL.sand2, n), arid);
  if (h > 1.8 && MESAS.some(([mx, mz, r]) => Math.hypot(x - mx, z - mz) < r + 1.8)) out.copy(Math.floor(h * 2.2) % 2 ? COL.mesa : COL.mesa2); // banded mesa cliffs
  const trop = sstep(66, 74, z) * sstep(-4, -14, x);
  if (trop > 0) out.lerp(new THREE.Color().copy(COL.jungle).lerp(COL.jungle2, n), trop);
  const rocky = Math.max(sstep(4, 7, h) * sstep(-30, -40, z), sstep(0.9, 1.6, slope) * (arid > 0.5 ? 0 : 1));
  if (rocky > 0) out.lerp(new THREE.Color().copy(COL.rock).lerp(COL.rock2, n), rocky);
  if (h > 12.5 + n * 3 && slope < 2.2) out.copy(COL.snow);
  if (L < 2.4 && h < 1.4 && arid < 0.5) out.lerp(COL.beach, sstep(2.4, 0.6, L));
  if (h < 0.15) out.lerp(COL.sandWet, sstep(0.15, -0.15, h));
  return out;
}

// ---------------------------------------------------------------- building the diorama
type Rig = { scene: THREE.Scene; owned: THREE.BufferGeometry[]; water: THREE.Mesh; waterBase: Float32Array; spin: { o: THREE.Object3D; axis: 'x' | 'z' }[]; ships: { o: THREE.Object3D; cx: number; cz: number; r: number; v: number; a: number }[]; clouds: THREE.Group[]; caravans: Map<number, THREE.Object3D>; units: THREE.Group; townHits: THREE.Object3D[]; walkers: Walker[]; fog?: { inst: THREE.InstancedMesh; at: THREE.Matrix4[] } };
type Walker = { o: THREE.Object3D; seg: number[]; t: number; dir: number; v: number };
/** The streets of the town being built, for its people to walk. */
let curPaths: number[][] = [];

const groundAt = (x: number, z: number) => Math.max(0, height(x, z));
function put(o: THREE.Object3D, x: number, z: number, rot = 0, s = 1, sink = 0) { o.position.set(x, groundAt(x, z) - sink, z); o.rotation.y = rot; o.scale.setScalar(s); return o; }
const rnd = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
function house(w: number, d: number, h: number, wall: number, roof: number) {
  const g = new THREE.Group();
  g.add(box(w, h + 0.5, d, wall, 0, -0.5, 0), gable(w, d, Math.min(w, d) * 0.45, roof, 0, h, 0), box(0.2, 0.32, 0.03, PAL.door, 0, 0, d / 2 + 0.01));
  return g;
}
function flatRoof(w: number, d: number, h: number, wall: number) {
  const g = new THREE.Group();
  g.add(box(w, h + 0.5, d, wall, 0, -0.5, 0), box(w + 0.08, 0.1, d + 0.08, 0xc9a874, 0, h, 0), box(0.2, 0.34, 0.03, PAL.woodDark, 0, 0, d / 2 + 0.01));
  return g;
}
function ship(sail = true) {
  const g = new THREE.Group();
  g.add(box(2.2, 0.45, 0.8, PAL.woodDark, 0, -0.15, 0), box(0.5, 0.45, 0.6, PAL.barnRed, -0.2, 0.3, 0), box(1.9, 0.06, 0.7, PAL.wood, 0, 0.3, 0));
  if (sail) g.add(cyl(0.04, 2, PAL.wood, 0.4, 0.3, 0, 5), box(1.0, 1.25, 0.05, PAL.white, 0.15, 0.75, 0));
  else g.add(box(0.5, 0.3, 0.45, 0xc9a874, 0.5, 0.3, 0), box(0.4, 0.25, 0.4, 0xd8b85a, -0.1, 0.3, 0)); // crates on a barge
  return g;
}
function windmill(rig: Rig) {
  const g = new THREE.Group();
  g.add(cyl(0.65, 2.4, PAL.cream, 0, -0.4, 0, 8, 0.45), cone(0.6, 0.7, PAL.roofBrown, 0, 2, 0, 8));
  const blades = new THREE.Group(); blades.position.set(0, 1.75, 0.55);
  for (let i = 0; i < 4; i++) { const b = new THREE.Group(); b.rotation.z = (i * Math.PI) / 2; b.add(box(0.22, 1.5, 0.03, PAL.creamDark, 0, 0.1, 0)); blades.add(b); }
  g.add(blades); rig.spin.push({ o: blades, axis: 'z' });
  return g;
}

function buildTerrain(rig: Rig) {
  const W = 236, D = 228, geo = new THREE.PlaneGeometry(W, D, W, D);
  geo.rotateX(-Math.PI / 2); geo.translate(0, 0, 10);
  const pos = geo.attributes.position as THREE.BufferAttribute, n = pos.count, hs = new Float32Array(n);
  for (let i = 0; i < n; i++) { hs[i] = height(pos.getX(i), pos.getZ(i)); pos.setY(i, hs[i]); }
  const cols = new Float32Array(n * 3), c = new THREE.Color(), row = W + 1;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), z = pos.getZ(i), ix = i % row, iz = Math.floor(i / row);
    const sx = hs[iz * row + Math.min(W, ix + 1)] - hs[iz * row + Math.max(0, ix - 1)], sz = hs[Math.min(D, iz + 1) * row + ix] - hs[Math.max(0, iz - 1) * row + ix];
    groundColor(x, z, hs[i], Math.hypot(sx, sz) / 2, c);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  ground.receiveShadow = true; ground.name = 'ground';
  rig.scene.add(ground); rig.owned.push(geo);
  // water: one sheet at sea level fills the sea, the bay and the river's bed, rippling gently
  const wg = new THREE.PlaneGeometry(1400, 1100, 200, 160); wg.rotateX(-Math.PI / 2); rig.owned.push(wg);
  const water = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0x3f98c8, transparent: true, opacity: 0.8, roughness: 0.18, metalness: 0.08, flatShading: true }));
  water.receiveShadow = true; rig.scene.add(water);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1100).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: COL.deep, flatShading: true, roughness: 0.95 })); // the sea bed out past the land, the same as the deep water by the shore
  floor.position.y = -3.5; rig.owned.push(floor.geometry); rig.scene.add(floor);
  rig.water = water; rig.waterBase = Float32Array.from((wg.attributes.position as THREE.BufferAttribute).array as Float32Array);
}

/** The main road from the Arid Frontier through your land to the coast, a bridge where it crosses the river. */
const TRACK = curve([[12, 1], [13, 10], [15, 20], [17, 30], [19, 40], [21, 50], [22, 55]], 50);
function ribbon(rig: Rig, line: P[], half: number, color: number) {
  const pts: number[] = [], idx: number[] = [];
  line.forEach(([x, z], i) => {
    const [nx, nz] = line[Math.min(line.length - 1, i + 1)], [px, pz] = line[Math.max(0, i - 1)], dx = nx - px, dz = nz - pz, l = Math.hypot(dx, dz) || 1, ox = (-dz / l) * half, oz = (dx / l) * half;
    for (const s of [1, -1]) { const X = x + ox * s, Z = z + oz * s; pts.push(X, Math.max(0.55, height(X, Z) + 0.12), Z); }
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); geo.setIndex(idx); geo.computeVertexNormals(); rig.owned.push(geo);
  const road = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide })); road.receiveShadow = true; rig.scene.add(road);
}
function buildRoad(rig: Rig) {
  ribbon(rig, ROAD, 0.55, 0x6b6258); ribbon(rig, TRACK, 0.28, 0xa48d64);
  const bridge = new THREE.Group(); // a stone bridge over the river
  bridge.add(box(5, 0.35, 1.5, PAL.stone, 0, 0.35, 0));
  for (const z of [-0.7, 0.7]) bridge.add(box(5, 0.3, 0.12, PAL.stoneDark, 0, 0.7, z));
  for (const x of [-1.3, 1.3]) bridge.add(box(0.5, 1.0, 1.3, PAL.stoneDark, x, -0.6, 0));
  bridge.position.set(-8, 0, 0); rig.scene.add(bridge);
}

/** Fields of the farms: patchwork round your land and down the river plains, pivots in the desert. */
function buildFields(rig: Rig, taken: [number, number, number, number][]) {
  const tex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 32; const g = cv.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, 32, 32); g.fillStyle = '#d9d2c4'; for (let y = 0; y < 32; y += 4) g.fillRect(0, y, 32, 2); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const tones = [0xd9b84a, 0x9cc45a, 0x6fa040, 0x8a6a45, 0xc2c766, 0xe2c25e, 0x7fb04a];
  const list: [number, number, number, number, number][] = [], rand = rnd(42);
  const areas: [number, number, number, number][] = [[-5, -26, 40, 22], [-30, -24, -14, 20], [16, 14, 38, 52], [26, 50, 44, 82], [-18, 24, -4, 46], [-4, 46, 8, 66], [42, -18, 56, 18]];
  for (const [x0, z0, x1, z1] of areas) for (let x = x0; x < x1; x += 4.4) for (let z = z0; z < z1; z += 3.6) {
    const w = 3.6 + rand() * 0.6, d = 2.8 + rand() * 0.5, cx = x + w / 2, cz = z + d / 2;
    if (Math.abs(cz - roadZ(cx)) < 2.6 || lineDist(cx, cz, RIVER) < riverW(cz) + 3 || inTown(cx, cz, 2.6) || rand() < 0.12) continue;
    const hs = [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].map(([a, b]) => height(cx + a, cz + b));
    if (Math.min(...hs) < 0.35 || Math.max(...hs) - Math.min(...hs) > 0.7) continue;
    list.push([cx, cz, w, d, Math.max(...hs)]); taken.push([cx - w / 2 - 0.3, cz - d / 2 - 0.3, cx + w / 2 + 0.3, cz + d / 2 + 0.3]);
  }
  const geo = new THREE.BoxGeometry(1, 0.4, 1); rig.owned.push(geo);
  const inst = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }), list.length), m = new THREE.Matrix4(), col = new THREE.Color();
  list.forEach(([x, z, w, d, h], i) => { m.compose(new THREE.Vector3(x, h - 0.14, z), new THREE.Quaternion(), new THREE.Vector3(w, 1, d)); inst.setMatrixAt(i, m); inst.setColorAt(i, col.setHex(tones[Math.floor(rand() * tones.length)])); });
  inst.receiveShadow = true; rig.scene.add(inst);
  for (const [x, z] of PIVOTS) { const p = cyl(2.6, 0.3, 0x7fb04a, x, groundAt(x, z) - 0.1, z, 20); rig.scene.add(p); taken.push([x - 3, z - 3, x + 3, z + 3]); } // irrigated circles in the desert
}
const roadZ = (x: number) => { for (let i = 0; i < ROAD.length - 1; i++) if (ROAD[i + 1][0] >= x) { const [ax, az] = ROAD[i], [bx, bz] = ROAD[i + 1]; return az + (bz - az) * ((x - ax) / (bx - ax || 1)); } return 999; };

/** Woods, pines, palms and cacti, each where it grows, kept off roads, water, fields and towns. */
function buildTrees(rig: Rig, taken: [number, number, number, number][]) {
  const kinds = {
    pine: { trunk: [0.1, 0.5], crown: () => new THREE.ConeGeometry(0.7, 2.1, 6).translate(0, 1.5, 0), col: [0x3f7a45, 0x356b3c, 0x4a8a4c] },
    broad: { trunk: [0.12, 0.8], crown: () => new THREE.IcosahedronGeometry(0.85, 0).translate(0, 1.35, 0), col: [0x5b9a3f, 0x6aa848, 0x4f8c3a, 0x7aa64a] },
    jungle: { trunk: [0.14, 1.0], crown: () => new THREE.IcosahedronGeometry(1.15, 0).translate(0, 1.7, 0), col: [0x2f7d35, 0x3a8f3c, 0x276b2d] },
    palm: { trunk: [0.08, 1.7], crown: () => new THREE.ConeGeometry(1.0, 0.45, 7).rotateX(Math.PI).translate(0, 1.85, 0), col: [0x4f9a3a, 0x5fa845] },
    cactus: { trunk: [0.16, 1.1], crown: () => new THREE.CylinderGeometry(0.1, 0.1, 0.6, 5).rotateZ(Math.PI / 2).translate(0, 0.7, 0), col: [0x5f8a3a] },
  } as const;
  type K = keyof typeof kinds;
  const spots: Record<K, [number, number, number, number, number][]> = { pine: [], broad: [], jungle: [], palm: [], cactus: [] }, rand = rnd(7);
  const blocked = (x: number, z: number) => taken.some(([a, b, c, d]) => x > a && x < c && z > b && z < d) || inTown(x, z, 0.4) || Math.abs(z - roadZ(x)) < 2 || lineDist(x, z, RIVER) < riverW(z) + 1.6;
  for (let i = 0; i < 30000; i++) {
    const x = -112 + rand() * 224, z = -94 + rand() * 212, h = height(x, z);
    if (h < 0.3 || blocked(x, z)) continue;
    const L = landness(x, z), clump = fbm(x * 0.08 + 5, z * 0.08), arid = x < -40, trop = z > 68 && x < -6;
    let k: K | null = null;
    if (z < -36 && h > 1 && h < 12) k = rand() < 0.55 ? 'pine' : null;
    else if (trop) k = L < 7 ? (rand() < 0.5 ? 'palm' : null) : clump > 0.38 ? 'jungle' : null;
    else if (arid) k = PIVOTS.some(([px, pz]) => Math.hypot(x - px, z - pz) < 6) || Math.hypot(x - TOWNS.arid[0] - 4, z - TOWNS.arid[1] - 7) < 5 ? (rand() < 0.5 ? 'palm' : null) : h < 2.4 && rand() < 0.07 ? 'cactus' : null;
    else if (x > 50 && L < 5) k = rand() < 0.3 ? 'palm' : null;
    else if (clump > 0.6 || (z < -22 && clump > 0.5)) k = z < -26 && rand() < 0.5 ? 'pine' : 'broad';
    if (k) spots[k].push([x, h, z, (k === 'jungle' ? 0.6 : 0.5) + rand() * 0.35, rand() * 6.28]);
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  for (const k of Object.keys(kinds) as K[]) {
    const def = kinds[k], list = spots[k];
    if (!list.length) continue;
    const tg = new THREE.CylinderGeometry(def.trunk[0] * 0.8, def.trunk[0], def.trunk[1], 5).translate(0, def.trunk[1] / 2, 0), cg = def.crown();
    rig.owned.push(tg, cg);
    const trunk = new THREE.InstancedMesh(tg, mat(k === 'cactus' ? 0x5f8a3a : PAL.woodDark), list.length), crown = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }), list.length);
    list.forEach(([x, h, z, s, r], i) => { m.compose(new THREE.Vector3(x, h - 0.05, z), q.setFromAxisAngle(up, r), new THREE.Vector3(s, s, s)); trunk.setMatrixAt(i, m); crown.setMatrixAt(i, m); crown.setColorAt(i, col.setHex(def.col[i % def.col.length])); });
    for (const o of [trunk, crown]) { o.castShadow = true; o.receiveShadow = true; rig.scene.add(o); }
  }
}

function town(rig: Rig, place: Place, build: (g: THREE.Group, rand: () => number) => void) {
  const g = new THREE.Group(); g.name = place; g.userData.place = place;
  curPaths = [];
  build(g, rnd(place.length * 97 + 3));
  people(rig, place, curPaths);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.place = place; } });
  rig.scene.add(g); rig.townHits.push(g);
}
/** Homes in rings round a centre, each on the ground where it stands, kept off the road and the water. */
const fits = (g: THREE.Group, x: number, z: number, keep: (x: number, z: number) => boolean, gap = 1.45, counts = (o: THREE.Object3D) => !o.userData.street) => Math.abs(z - roadZ(x)) > 1.5 && height(x, z) > 0.35 && lineDist(x, z, RIVER) > riverW(z) + 1 && keep(x, z) && !g.children.some((o) => counts(o) && Math.hypot(o.position.x - x, o.position.z - z) < gap);
/** Homes scattered round a centre, each facing it: a hamlet. */
function ring(g: THREE.Group, rand: () => number, [cx, cz]: P, n: number, r0: number, r1: number, make: (i: number) => THREE.Object3D, keep = (_x: number, _z: number) => true) {
  for (let i = 0, tries = 0; i < n && tries < n * 12; tries++) {
    const a = rand() * Math.PI * 2, r = r0 + rand() * (r1 - r0), x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (!fits(g, x, z, keep, 1.55)) continue;
    g.add(put(make(i), x, z, Math.atan2(cx - x, cz - z) + (rand() - 0.5) * 0.3)); i++; curPaths.push([cx, cz, cx + (x - cx) * 0.8, cz + (z - cz) * 0.8]);
  }
}
/** Homes in blocks along streets (every third row and column left open), fronts to the street: a town. */
function blocks(g: THREE.Group, rand: () => number, [cx, cz]: P, n: number, r1: number, step: number, make: (i: number) => THREE.Object3D, keep = (_x: number, _z: number) => true, jitter = 0.06, paving = 0) {
  const spots: [number, number, number][] = [], k = Math.ceil(r1 / step);
  const street: THREE.BufferGeometry[] = [];
  if (paving) for (let i = -k; i <= k; i++) if (((i % 3) + 3) % 3 === 2) for (const across of [false, true]) { // the streets between the blocks, in unbroken runs
    const at = (t: number): P => (across ? [cx + i * step, cz + t] : [cx + t, cz + i * step]);
    const ok = (t: number) => { const [x, z] = at(t); return Math.hypot(x - cx, z - cz) < r1 - 0.4 && Math.abs(z - roadZ(x)) > 1.1 && height(x, z) > 0.3 && lineDist(x, z, RIVER) > riverW(z) + 0.6 && keep(x, z); };
    let start: number | null = null;
    for (let t = -k * step; t <= k * step + 0.5; t += 0.5) {
      if (t <= k * step && ok(t)) { start ??= t; continue; }
      if (start !== null && t - start > 0.6) { const len = t - start, [x, z] = at(start + len / 2 - 0.25); street.push(new THREE.BoxGeometry(across ? 0.55 : len, 0.3, across ? len : 0.55).translate(x, height(x, z) - 0.11, z)); const [ax, az] = at(start), [bx, bz] = at(t - 0.5); curPaths.push([ax, az, bx, bz]); }
      start = null;
    }
  }
  if (street.length) { const geo = mergeGeometries(street), st = new THREE.Mesh(geo, mat(paving, { rough: 1 })); street.forEach((x) => x.dispose()); madeGeo.push(geo); st.receiveShadow = true; st.userData.street = true; g.add(st); }
  for (let i = -k; i <= k; i++) for (let j = -k; j <= k; j++) if (((i % 3) + 3) % 3 !== 2 && ((j % 3) + 3) % 3 !== 2 && Math.hypot(i, j) * step < r1) spots.push([cx + i * step, cz + j * step, Math.hypot(i, j) + rand() * 1.5]);
  spots.sort((a, b) => a[2] - b[2]); // fill from the middle out
  let made = 0;
  for (const [x0, z0] of spots) {
    if (made >= n) break;
    const x = x0 + (rand() - 0.5) * jitter * 2, z = z0 + (rand() - 0.5) * jitter * 2;
    if (!fits(g, x, z, keep, step * 0.8, (o) => !o.userData.street)) continue;
    const row = Math.round((z0 - cz) / step);
    g.add(put(make(made), x, z, (((row % 3) + 3) % 3 === 0 ? Math.PI : 0) + (rand() - 0.5) * jitter)); made++;
  }
}
let winTex: THREE.Texture | null = null;
/** Geometry made for this view's towns, freed when it closes. */
const madeGeo: THREE.BufferGeometry[] = [];
/** A block of flats or offices: walls with rows of windows, a flat roof. */
function tower(w: number, h: number, wall: number) {
  winTex ??= (() => { const cv = document.createElement('canvas'); cv.width = 32; cv.height = 64; const c = cv.getContext('2d')!; c.fillStyle = '#fff'; c.fillRect(0, 0, 32, 64); c.fillStyle = '#5b6f80'; for (let y = 3; y < 64; y += 8) for (let x = 3; x < 32; x += 8) c.fillRect(x, y, 4, 4); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; })();
  const t = winTex.clone(); t.repeat.set(1, h / 2.4); t.needsUpdate = true;
  const bg = new THREE.BoxGeometry(w, h + 0.5, w); madeGeo.push(bg);
  const g = new THREE.Group(), body = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ map: t, color: wall, roughness: 0.8 }));
  body.position.y = (h + 0.5) / 2 - 0.5; g.add(body, box(w + 0.1, 0.12, w + 0.1, PAL.roofGrey, 0, h, 0), box(w * 0.4, 0.3, w * 0.3, PAL.metalDark, 0, h + 0.1, 0));
  return g;
}

function buildTowns(rig: Rig, s: ReturnType<typeof getGame>) {
  const v = regionOf(s);
  // your land: the farmhouse, barns and silos north of the road, the town south of it, apartment blocks once it is a city
  town(rig, 'home', (g, rand) => {
    const [hx, hz] = TOWNS.home, pop = population(s), city = cityActive(s);
    g.add(put(house(2.2, 1.6, 1.2, PAL.cream, PAL.roofRed), hx - 1, hz - 6), put(house(2, 1.4, 1.1, PAL.barnRed, PAL.roofGrey), hx + 2.5, hz - 7.5, Math.PI / 2), put(house(1.8, 1.3, 1, PAL.barnRed, PAL.roofGrey), hx - 4, hz - 8.5));
    for (let i = 0; i < 3; i++) g.add(put(cyl(0.45, 2.4, PAL.metal, 0, 0, 0, 10), hx + 4.6 + i * 1.05, hz - 4.6));
    g.add(put(new THREE.Group().add(box(0.06, 3, 0.06, PAL.metalDark, 0, 0, 0), box(0.9, 0.55, 0.04, 0xc0392b, 0.47, 2.35, 0)), hx - 2.6, hz - 4.6)); // your flag
    if (city) for (let i = 0; i < 4; i++) g.add(put(tower(1.3, 2.4 + i * 0.9, [0xd8d0c4, 0xc4ced4, 0xe0d2b8, 0xbfc8cc][i]), hx + 1.2 + (i % 2) * 1.6, hz + 5.6 + Math.floor(i / 2) * 1.6)); // the city's blocks in the middle
    const homes = Math.max(22, Math.min(44, 18 + Math.round(pop / 15)));
    blocks(g, rand, [hx + 2, hz + 7], homes, 7.5, 1.6, (i) => house(1.2, 1, 0.8 + (i % 3) * 0.12, [PAL.cream, PAL.white, 0xe8d8b0][i % 3], [PAL.roofRed, PAL.roofBrown, PAL.roofGrey][i % 3]), (_x, z) => z > TOWNS.home[1] + 1.8, 0.06, 0x8f8a80);
  });
  // the Arid Frontier: adobe houses with domes inside a mud wall, a market, an oasis
  town(rig, 'arid', (g, rand) => {
    const [ax, az] = TOWNS.arid, pond = [ax + 4, az + 7] as P;
    let lvl = 0; for (let a = 0; a < 6.28; a += 0.5) lvl = Math.max(lvl, height(pond[0] + Math.cos(a) * 2.6, pond[1] + Math.sin(a) * 2.6));
    g.add(cyl(3.1, 1.2, 0x7fb04a, pond[0], lvl - 1.15, pond[1], 18), cyl(2.3, 1.2, 0x3f98c8, pond[0], lvl - 1.1, pond[1], 18)); // the oasis, its pool ringed with grass
    blocks(g, rand, [ax, az], 26, 8.5, 1.45, (i) => { const f = flatRoof(1 + (i % 3) * 0.25, 1 + (i % 2) * 0.3, 0.7 + (i % 4) * 0.25, [0xd8b98a, 0xe0c49a, 0xcfae80][i % 3]); if (i % 4 === 0) f.add(sphere(0.42, 0xe8d2a8, 0, 0.75 + (i % 4) * 0.25, 0)); return f; }, (x, z) => Math.hypot(x - pond[0], z - pond[1]) > 3.4, 0.06, 0xe4cd98);
    g.add(put(new THREE.Group().add(box(1.1, 4, 1.1, 0xd2b07e, 0, -0.5, 0), box(1.3, 0.2, 1.3, 0xc9a874, 0, 3.5, 0), sphere(0.5, 0xe8d2a8, 0, 3.7, 0)), ax, az)); // the khan's tower
    for (let i = 0; i < 4; i++) g.add(put(cone(0.55, 0.6, [0xc0392b, 0xe0b23a, 0x2f6f9a, 0xd07a2f][i], 0, 0, 0, 4), ax - 2.2 + i * 1.1, az + 2.2)); // market awnings
    for (let i = 0; i < 30; i++) { const a = (i / 30) * Math.PI * 2, x = ax + Math.cos(a) * 9.5, z = az + Math.sin(a) * 9.5; if (Math.abs(z - roadZ(x)) < 1.6 || Math.hypot(x - pond[0], z - pond[1]) < 3) continue; g.add(put(box(2.1, 1.3, 0.35, 0xc9a874, 0, -0.5, 0), x, z, -a - Math.PI / 2)); } // the mud wall round the town
  });
  // the Coastal Trade Hub: white houses on the hill, warehouses and piers in the harbour, a lighthouse on the point
  town(rig, 'coastal', (g, rand) => {
    const [cx, cz] = TOWNS.coastal;
    const shore = (z: number) => { let x = cx; while (landness(x + 0.5, z) > 1.2) x += 0.5; return x; }; // the last dry ground going east
    for (let i = 0; i < 3; i++) { const z = cz - 3.4 + i * 1.5, w = new THREE.Group(); w.add(box(2.4, 1.3, 1.1, PAL.brick, 0, -0.5, 0), gable(2.4, 1.1, 0.35, PAL.roofGrey, 0, 0.8, 0), box(0.6, 0.55, 0.03, PAL.woodDark, 0, 0, 0.56)); g.add(put(w, shore(z) - 1.6, z)); } // warehouses on the quay
    blocks(g, rand, [cx - 1.5, cz], 28, 8, 1.5, (i) => house(1.1, 1, 0.8 + (i % 3) * 0.2, [PAL.white, 0xf1e6cc, 0xe8eef0][i % 3], [0xc0613a, 0x3f6f9a, 0xb24a3c][i % 3]), (x, z) => landness(x, z) > 2.5 && x < shore(z) - 3.1, 0.06, 0xbdb4a2);
    for (const z of [cz + 1, cz + 4.5]) g.add(box(6, 0.2, 0.8, PAL.wood, shore(z) + 2.6, 0.15, z));
    const lh = new THREE.Group(); for (let i = 0; i < 6; i++) lh.add(cyl(0.6 - i * 0.04, 0.6, i % 2 ? 0xc0392b : PAL.white, 0, -0.4 + i * 0.6, 0, 10)); lh.add(cyl(0.45, 0.5, PAL.glass, 0, 3.2, 0, 8), cone(0.55, 0.5, 0xc0392b, 0, 3.7, 0, 8), sphere(0.22, 0xfff2b0, 0, 3.45, 0, { emissive: 0xc0a040 }));
    g.add(put(lh, shore(-15) - 0.6, -15));
    for (const [dx, z, r] of [[3, cz + 2.6, 0], [5, cz - 0.6, 0], [2.5, cz + 6.2, 0.1]] as const) { const sh = ship(); sh.position.set(shore(z) + dx, 0.12, z); sh.rotation.y = r; g.add(sh); }
  });
  // the River Plains: cottages by the water, a watermill and a windmill, a jetty
  town(rig, 'river', (g, rand) => {
    const [rx, rz] = TOWNS.river;
    blocks(g, rand, [rx, rz], 18, 7, 1.8, (i) => house(1.1, 1, 0.75, [PAL.cream, 0xe9dcc0, PAL.white][i % 3], [0xb8964e, PAL.roofBrown, 0xa8803e][i % 3]), undefined, 0.3, 0xb59c70);
    const wm = windmill(rig); g.add(put(wm, rx + 6, rz - 5));
    const mill = house(1.6, 1.3, 1, PAL.stone, PAL.roofBrown), wheel = cyl(0.8, 0.2, PAL.woodDark, 0, -0.1, 0, 10), hub = new THREE.Group(); wheel.rotation.z = Math.PI / 2; hub.add(wheel); hub.position.set(-0.95, 0.45, 0); mill.add(hub); rig.spin.push({ o: hub, axis: 'x' });
    const [mx, mz] = RIVER.find(([, z]) => z > rz - 4)!; g.add(put(mill, mx + riverW(mz) + 1.6, mz));
    const [jx, jz] = RIVER.find(([, z]) => z > rz + 2)!; g.add(box(2.2, 0.15, 0.7, PAL.wood, jx + riverW(jz) * 0.5, 0.2, jz)); const b = ship(false); b.scale.setScalar(0.7); b.position.set(jx, 0.1, jz + 1); b.rotation.y = Math.PI / 2; g.add(b);
  });
  // the Tropical Highlands: stilt huts and a longhouse among palms, terraced plantations on the hills
  town(rig, 'tropics', (g, rand) => {
    const [tx, tz] = TOWNS.tropics;
    ring(g, rand, [tx, tz], 16, 1.8, 7.5, () => { const h = new THREE.Group(); for (const [a, b] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) h.add(box(0.08, 0.7, 0.08, PAL.woodDark, a, -0.2, b)); h.add(box(1.1, 0.55, 1.1, 0xc9a874, 0, 0.5, 0), cone(0.95, 0.8, 0xb89a5a, 0, 1.05, 0, 8)); return h; });
    g.add(put(new THREE.Group().add(box(3.2, 1.6, 1.3, PAL.wood, 0, -0.5, 0), gable(3.2, 1.3, 0.9, 0xb89a5a, 0, 1.1, 0)), tx, tz));
    for (const [x, z] of [[tx - 10, tz - 6], [tx + 10, tz + 7]] as const) { const t = new THREE.Group(); for (let i = 0; i < 5; i++) t.add(cyl(4.6 - i * 0.85, 0.55, i % 2 ? 0x5fae45 : 0x4f9a3a, 0, -1 + i * 0.55, 0, 18)); g.add(put(t, x, z)); }
    const b = ship(false); b.position.set(-4, 0.1, tz - 1); g.add(b, box(2.4, 0.15, 0.7, PAL.wood, -6, 0.2, tz - 1));
  });
  // your border where the main road leaves your land: a gatehouse in a wall, or an arch with banners
  if (v.active) for (const x of [-30, 34]) {
    const g = new THREE.Group(), z = roadZ(x);
    if (v.border === 'walls') {
      for (const dz of [-1.3, 1.3]) g.add(box(0.9, 2.2, 0.9, PAL.stone, 0, -0.3, dz), box(1.05, 0.2, 1.05, PAL.stoneDark, 0, 1.9, dz));
      g.add(box(0.8, 0.5, 1.8, PAL.stone, 0, 1.4, 0));
      for (const dz of [-1, 1]) for (let k = 0; k < 3; k++) { const zz = z + dz * (2.2 + k * 0.9); g.add(box(0.5, 1.3 + (height(x, zz) - height(x, z)), 0.95, PAL.stoneDark, 0, -0.3, dz * (2.2 + k * 0.9))); }
    } else {
      for (const dz of [-1.1, 1.1]) g.add(box(0.16, 2, 0.16, PAL.wood, 0, 0, dz), box(0.04, 0.7, 0.4, 0xc0392b, 0.1, 1, dz - Math.sign(dz) * 0.25));
      g.add(box(0.2, 0.25, 2.6, PAL.woodDark, 0, 1.9, 0));
    }
    put(g, x, z); g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; }); rig.scene.add(g);
  }
}

/** A sea of cloud over all the land and sea you have not seen, piled higher away from what you can see. */
function buildFog(rig: Rig, low: boolean) {
  const geo = new THREE.IcosahedronGeometry(1, low ? 0 : 1); rig.owned.push(geo);
  const list: [number, number, number, number, number][] = [], rand = rnd(5);
  for (let x = -230; x <= 230; x += 4.2) for (let z = -190; z <= 230; z += 4.2) {
    const px = x + (rand() - 0.5) * 3, pz = z + (rand() - 0.5) * 3, d = hidden(px, pz);
    if (d < -1) continue;
    const k = sstep(-1, 9, d), sc = (3 + rand() * 2.6) * (0.55 + 0.6 * k);
    list.push([px, Math.max(4, groundAt(px, pz) + 2.5) + k * 3 + rand() * 1.5, pz, sc, rand() * 6.28]);
  }
  const inst = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x7f8a96, roughness: 1 }), list.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  list.forEach(([x, y, z, sc, a], i) => { m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, a), new THREE.Vector3(sc * 1.3, sc * 0.75, sc)); inst.setMatrixAt(i, m); inst.setColorAt(i, col.setHSL(0.58, 0.25, 0.93 + (i % 5) * 0.012)); });
  inst.receiveShadow = true; rig.scene.add(inst);
  rig.fog = { inst, at: list.map((_, i) => { const mm = new THREE.Matrix4(); inst.getMatrixAt(i, mm); return mm; }) };
}
/** On a visit the clouds round the town part, so its surroundings are seen; they close again when you leave. */
function fogAround(rig: Rig | null, place: NeighbourId | null) {
  if (!rig?.fog) return;
  const { inst, at } = rig.fog, p = new THREE.Vector3(), none = new THREE.Matrix4().makeScale(0, 0, 0);
  at.forEach((m, i) => { p.setFromMatrixPosition(m); inst.setMatrixAt(i, place && Math.hypot(p.x - TOWNS[place][0], p.z - TOWNS[place][1]) < 26 ? none : m); });
  inst.instanceMatrix.needsUpdate = true;
}
const SHIRT = [0xc9553f, 0x3f6fc9, 0xe0b23a, 0x4c9a5a, 0x8a5ac9, 0xd07a2f, 0xf1e6cc], SKIN = [0xe0b48a, 0xc68c5e, 0x8d5a3b, 0xf0c9a0];
/** Townsfolk going up and down their streets. */
function people(rig: Rig, place: Place, paths: number[][]) {
  const rand = rnd(place.length * 31 + 7), segs = paths.filter(([a, b, c, d]) => Math.hypot(c - a, d - b) > 1.2);
  for (let i = 0; segs.length && i < 16; i++) {
    const o = new THREE.Group(), shirt = SHIRT[Math.floor(rand() * SHIRT.length)];
    o.add(box(0.05, 0.12, 0.05, 0x3b3f4a, -0.03, 0, 0), box(0.05, 0.12, 0.05, 0x3b3f4a, 0.03, 0, 0), box(0.13, 0.15, 0.09, shirt, 0, 0.12, 0), sphere(0.055, SKIN[i % SKIN.length], 0, 0.33, 0));
    o.traverse((m) => { m.castShadow = true; });
    rig.units.add(o); rig.walkers.push({ o, seg: segs[Math.floor(rand() * segs.length)], t: rand(), dir: rand() < 0.5 ? 1 : -1, v: 0.35 + rand() * 0.3 });
  }
}
function walk(rig: Rig, t: number, dt: number) {
  for (const w of rig.walkers) {
    const [a, b, c, d] = w.seg, len = Math.hypot(c - a, d - b);
    w.t += (w.dir * w.v * dt) / len;
    if (w.t > 1 || w.t < 0) { w.dir = -w.dir; w.t = Math.max(0, Math.min(1, w.t)); }
    const x = a + (c - a) * w.t, z = b + (d - b) * w.t;
    w.o.position.set(x, groundAt(x, z) + 0.04 + Math.abs(Math.sin(t * 9 + len)) * 0.025, z);
    w.o.rotation.y = Math.atan2(-(d - b) * w.dir, (c - a) * w.dir) - Math.PI / 2;
  }
}
function buildClouds(rig: Rig) {
  const geo = new THREE.IcosahedronGeometry(1, 1); rig.owned.push(geo);
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1, transparent: true, opacity: 0.92 }), rand = rnd(11);
  for (let i = 0; i < 7; i++) {
    const g = new THREE.Group();
    for (let k = 0; k < 6; k++) { const p = new THREE.Mesh(geo, m), r = 2 + rand() * 2.2; p.scale.set(r * 1.3, r * 0.8, r); p.position.set((k - 2.5) * 2.2 + rand(), rand() * 1.2, (rand() - 0.5) * 3); p.castShadow = true; g.add(p); }
    g.position.set(-110 + i * 34 + rand() * 10, 24 + rand() * 4, -70 + rand() * 150); rig.scene.add(g); rig.clouds.push(g);
  }
}

// ---------------------------------------------------------------- caravans: along the road west or east, down the river south, across the bay to the tropics
const routeFor = (() => {
  const cache = new Map<NeighbourId, THREE.CatmullRomCurve3>();
  return (to: NeighbourId) => {
    const hit = cache.get(to); if (hit) return hit;
    const home = 6, side = ROUTE_SIDE[to];
    let pts: P[];
    if (side === 'west') pts = ROAD.filter(([x]) => x <= home).reverse();
    else if (side === 'east') pts = ROAD.filter(([x]) => x >= home);
    else { const down = RIVER.filter(([, z]) => z > 0 && z < (to === 'river' ? TOWNS.river[1] + 2 : 86)); pts = [[0, 0.5], [-8, 0.5], ...down, ...(to === 'tropics' ? BAY_PATH : [])]; }
    const water = side === 'south';
    const c = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, water ? 0.12 : Math.max(0.55, height(x, z) + 0.12), z)));
    cache.set(to, c); return c;
  };
})();
function animateCaravans(rig: Rig) {
  const s = getGame(), seen = new Set<number>();
  for (const sh of s.shipments) {
    if (!sh.caravan || sh.batchDay === undefined || !isNeighbour(sh.to) || s.tick >= sh.arrives) continue;
    const to = sh.to as NeighbourId, dep = (sh.batchDay + 1) * 24; if (s.tick < dep) continue;
    const f = Math.max(0, Math.min(1, (s.tick - dep) / Math.max(1, sh.arrives - dep)));
    seen.add(sh.id);
    let o = rig.caravans.get(sh.id);
    if (!o) { o = ROUTE_SIDE[to] === 'south' ? ship(false) : hauler('truck'); o.scale.setScalar(ROUTE_SIDE[to] === 'south' ? 0.75 : 0.8); o.traverse((m) => { m.castShadow = true; }); rig.units.add(o); rig.caravans.set(sh.id, o); }
    const c = routeFor(to), p = c.getPointAt(f), d = c.getTangentAt(f);
    o.position.copy(p); o.rotation.y = Math.atan2(-d.z, d.x);
  }
  for (const [id, o] of rig.caravans) if (!seen.has(id)) { rig.units.remove(o); rig.caravans.delete(id); }
}

// ---------------------------------------------------------------- the view
const FOV = 30, PITCH = 0.98;
const LABEL_Y: Record<Place, number> = { home: 5, arid: 6, coastal: 5, river: 5, tropics: 6 };

export default function RegionView() {
  const s = useGame(), v = regionOf(s), page = useStore((x) => x.page);
  const canvas = useRef<HTMLCanvasElement>(null), labels = useRef<Record<string, HTMLButtonElement | null>>({}), cam = useRef({ x: -4, z: 36, d: 200, goal: 200, min: 22, max: 300, home: 200, pitch: PITCH, visit: null as NeighbourId | null });
  const [visit, setVisit] = useState<NeighbourId | null>(null), rigRef = useRef<Rig | null>(null);
  /** Visit a town: through the clouds, down to its streets. Back out the same way. */
  const goVisit = (id: NeighbourId | null) => throughClouds(() => {
    const C = cam.current; C.visit = id; setVisit(id); go('farm'); fogAround(rigRef.current, id);
    if (id) { C.x = TOWNS[id][0]; C.z = TOWNS[id][1]; C.goal = 26; C.d = 36; C.pitch = 0.92; C.min = 12; C.max = 48; }
    else { C.x = -4; C.z = 36; C.goal = C.home; C.d = C.home * 0.8; C.pitch = PITCH; C.min = 22; C.max = C.home * 1.15; }
  });
  const open = (p: Place) => { if (p === 'home') travel('farm'); else if (!cam.current.visit) goVisit(p); };

  useEffect(() => {
    const c = canvas.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, powerPreference: 'high-performance' }); } catch { return; }
    const low = graphicsQuality() === 'low' || (innerWidth < 700 && devicePixelRatio > 1.25);
    renderer.setPixelRatio(low ? 1 : Math.min(2, devicePixelRatio));
    renderer.shadowMap.enabled = !low; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(), sky = new THREE.Color(0xe4edf3); // cloud, which the view fades into
    scene.background = sky; scene.fog = new THREE.Fog(sky, 200, 600);
    const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 2000);
    scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x8a7a55, 1.0));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.3); sun.position.set(-70, 110, 60); sun.castShadow = !low;
    Object.assign(sun.shadow.camera, { left: -125, right: 125, top: 105, bottom: -105, near: 10, far: 400 }); sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.4;
    scene.add(sun);
    const rig: Rig = { scene, owned: [], water: null!, waterBase: new Float32Array(), spin: [], ships: [], clouds: [], caravans: new Map(), units: new THREE.Group(), townHits: [], walkers: [] };
    scene.add(rig.units); rigRef.current = rig;
    const taken: [number, number, number, number][] = [];
    buildTerrain(rig); buildRoad(rig); buildFields(rig, taken); buildTowns(rig, getGame()); buildTrees(rig, taken); buildFog(rig, low); buildClouds(rig);
    for (const [cx, cz, r, v0] of [[85, 3, 5, 0.05]] as const) { const o = ship(); o.traverse((m) => { m.castShadow = true; }); scene.add(o); rig.ships.push({ o, cx, cz, r, v: v0, a: cx * 0.1 }); } // ships at sea

    // camera: fit the region on screen; a phone starts on the middle and pans
    const C = cam.current;
    const fit = (W: number, H: number) => {
      const t = Math.tan(((FOV / 2) * Math.PI) / 180), dw = 100 / (t * (W / H)), dh = (70 * Math.sin(PITCH)) / t;
      C.home = W < 600 ? 84 / (t * (W / H)) : Math.max(dw, dh) * 1.04; // what you can see, edge to edge; a phone fits the towns across
      C.max = C.home * 1.15; if (!C.visit) C.goal = C.home;
    };
    let W = 0, H = 0, raf = 0, last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const w = c.clientWidth, h = c.clientHeight; if (!w || !h) return;
      if (w !== W || h !== H) { const first = !W; W = w; H = h; renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix(); fit(W, H); if (first) C.d = C.goal * 0.55; }
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)), t = now / 1000; last = now;
      C.d += (C.goal - C.d) * Math.min(1, dt * 4);
      if (C.visit) { const [vx, vz] = TOWNS[C.visit]; C.x = Math.max(vx - 12, Math.min(vx + 12, C.x)); C.z = Math.max(vz - 10, Math.min(vz + 12, C.z)); } // a visit stays in town
      else { C.x = Math.max(-85, Math.min(80, C.x)); C.z = Math.max(-15, Math.min(100, C.z)); }
      camera.position.set(C.x, Math.sin(C.pitch) * C.d, C.z + Math.cos(C.pitch) * C.d); camera.lookAt(C.x, 0, C.z);
      (scene.fog as THREE.Fog).near = C.d * 1.1; (scene.fog as THREE.Fog).far = C.d * 3.2;
      // ripples, mills, ships, clouds and caravans
      const wp = rig.water.geometry.attributes.position as THREE.BufferAttribute, base = rig.waterBase;
      for (let i = 0; i < wp.count; i++) { const x = base[i * 3], z = base[i * 3 + 2]; wp.setY(i, Math.sin(x * 0.35 + t * 1.1) * 0.07 + Math.cos(z * 0.42 + t * 0.9) * 0.07); }
      wp.needsUpdate = true;
      for (const { o, axis } of rig.spin) o.rotation[axis] -= dt * 1.2;
      for (const sh of rig.ships) { sh.a += sh.v * dt * 6; sh.o.position.set(sh.cx + Math.cos(sh.a) * sh.r, 0.15 + Math.sin(t * 1.4 + sh.cx) * 0.05, sh.cz + Math.sin(sh.a) * sh.r * 0.6); sh.o.rotation.y = Math.atan2(-Math.cos(sh.a) * 0.6 * sh.v, -Math.sin(sh.a) * sh.v); } // heading along the loop
      for (const g of rig.clouds) { g.position.x += dt * 1.6; if (g.position.x > 130) g.position.x = -130; }
      animateCaravans(rig);
      walk(rig, t, dt);
      renderer.render(scene, camera);
      // labels follow their towns
      const p = new THREE.Vector3();
      for (const id of Object.keys(TOWNS) as Place[]) {
        const el = labels.current[id]; if (!el) continue;
        p.set(TOWNS[id][0], groundAt(TOWNS[id][0], TOWNS[id][1]) + LABEL_Y[id], TOWNS[id][1]).project(camera);
        const half = el.offsetWidth / 2 + 6, x = Math.max(half, Math.min(W - half, (p.x * 0.5 + 0.5) * W)), y = (-p.y * 0.5 + 0.5) * H; // kept on screen at the edges
        el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`; el.style.visibility = !C.visit && p.z < 1 && Math.abs((p.x * 0.5 + 0.5) * W - x) < half && y > 40 && y < H + 60 ? 'visible' : 'hidden';
      }
    };
    raf = requestAnimationFrame(frame);
    (window as unknown as Record<string, unknown>).__region = C; // screenshots point the camera

    // drag to pan, wheel or pinch to zoom, tap a town to open it
    const pts = new Map<number, [number, number]>(); let moved = 0, pinch = 0;
    const down = (e: PointerEvent) => { c.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } };
    const move = (e: PointerEvent) => {
      const prev = pts.get(e.pointerId); if (!prev) return;
      const dx = e.clientX - prev[0], dy = e.clientY - prev[1]; pts.set(e.pointerId, [e.clientX, e.clientY]); moved += Math.abs(dx) + Math.abs(dy);
      if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) { C.goal = Math.max(C.min, Math.min(C.max, C.goal * (pinch / d))); C.d = C.goal; } pinch = d; return; }
      const wpp = (2 * Math.tan(((FOV / 2) * Math.PI) / 180) * C.d) / (H || 1);
      C.x -= dx * wpp; C.z -= (dy * wpp) / Math.sin(C.pitch);
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId); if (pts.size < 2) pinch = 0;
      if (moved > 6 || pts.size) return;
      const r = c.getBoundingClientRect(), ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(rig.townHits, true)[0];
      if (hit?.object.userData.place) open(hit.object.userData.place as Place);
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); C.goal = Math.max(C.min, Math.min(C.max, C.goal * Math.exp(e.deltaY * 0.0012))); };
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up); c.addEventListener('wheel', wheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up); c.removeEventListener('wheel', wheel);
      for (const g of [...rig.owned, ...madeGeo.splice(0)]) g.dispose();
      renderer.dispose(); renderer.forceContextLoss();
    };
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && page === 'farm' && !document.querySelector('.modal-bg')) { if (cam.current.visit) goVisit(null); else travel('farm'); } };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [page]);

  const zoom = (f: number) => { const C = cam.current; C.goal = Math.max(C.min, Math.min(C.max, C.goal * f)); };
  const escorts = s.shipments.filter((x) => x.caravan && isNeighbour(x.to) && s.tick < x.arrives).length;
  return <div className="region-view">
    <canvas ref={canvas} className="region-canvas" role="img" aria-label="Map of the region: your land in the middle, the Arid Frontier to the west, the Coastal Trade Hub to the east, the River Plains down the river and the Tropical Highlands across the bay. Drag to move, scroll to zoom, tap a town." />
    <div className="region-labels">
      <button ref={(el) => { labels.current.home = el; }} className="rv-label home" onClick={() => open('home')}>
        <span className="rv-crest">🏡</span><span className="rv-text"><b>Your land</b><small>{REGIONS.heartland.name} · back to the farm</small></span>
      </button>
      {NEIGHBOUR_IDS.map((id) => { const n = v.neighbours[id], r = n.request;
        return <button key={id} ref={(el) => { labels.current[id] = el; }} className={`rv-label${r ? ' wants' : ''}`} onClick={() => open(id)}>
          <span className="rv-crest">{NEIGHBOURS[id].icon}</span>
          <span className="rv-text"><b>{REGIONS[id].name}</b><small>{NEIGHBOURS[id].leader}{v.active ? ` · ${attitude(n.trust)}` : ''}</small>
            {r && <em>📜 {num(Math.max(0, r.qty - r.done))} {GOODS[r.good].name.toLowerCase()} wanted</em>}</span>
        </button>; })}
    </div>
    {visit ? <Visit id={visit} onTrade={() => { focusNeighbour(visit); go('region'); }} /> : null}
    <div className="region-top">
      {visit ? <button className="btn region-back" onClick={() => goVisit(null)}>← Region</button> : <button className="btn region-back" onClick={() => travel('farm')}>← Farm</button>}
      {visit ? <div className="region-title"><b>Visiting {REGIONS[visit].name}</b><span>{NEIGHBOURS[visit].icon} {NEIGHBOURS[visit].leader}’s town</span></div> : <div className="region-title"><b>The Region</b><span>{v.active ? `${v.border === 'walls' ? '🧱 Walls & tolls' : '🕊 Open borders'} · ${escorts ? `${escorts} caravan${escorts > 1 ? 's' : ''} on the way` : 'no caravans out'}` : 'Four neighbours beyond your land'}</span></div>}
    </div>
    <div className="region-zoom tool-grid"><button className="icon-btn" aria-label="Zoom in" onClick={() => zoom(0.75)}>+</button><button className="icon-btn" aria-label="Zoom out" onClick={() => zoom(1.33)}>−</button></div>
  </div>;
}

const TOWN_LINE: Record<NeighbourId, string> = {
  arid: 'A walled adobe town round its oasis, at the western end of the main road.',
  coastal: 'The harbour where the main road meets the sea. Ships come in from everywhere.',
  river: 'Mills and cottages downriver, on the plains the river waters.',
  tropics: 'Stilt huts and terraced hills across the bay, where coffee and cane grow.',
};
/** What you see on a visit: who leads the town, how they feel about you, what they want. Nothing to do here yet. */
function Visit({ id, onTrade }: { id: NeighbourId; onTrade: () => void }) {
  const s = useGame(), v = regionOf(s), n = v.neighbours[id], who = NEIGHBOURS[id], r = n.request;
  const out = s.shipments.filter((x) => x.caravan && x.to === id && s.tick < x.arrives).length;
  return <aside className="visit-card" aria-label={`Visiting ${REGIONS[id].name}`}>
    <div className="visit-head"><span className="rv-crest">{who.icon}</span><div><b>{REGIONS[id].name}</b><small>{who.leader}</small></div></div>
    <p>{TOWN_LINE[id]}</p>
    {v.active && <div className="visit-trust"><span>{attitude(n.trust)}</span><span className="visit-bar"><i style={{ width: `${Math.max(0, Math.min(100, n.trust))}%` }} /></span><b>{Math.round(n.trust)}</b></div>}
    <ul className="visit-facts">
      <li>💛 Wants <b>{GOODS[who.wants].name.toLowerCase()}</b></li>
      {r && <li>📜 Order: <b>{num(Math.max(0, r.qty - r.done))} {GOODS[r.good].name.toLowerCase()}</b></li>}
      {v.active && <li>🐫 {out ? `${out} caravan${out > 1 ? 's' : ''} on the way` : 'No caravans on the way'}</li>}
    </ul>
    <button className="btn primary" onClick={onTrade}>{v.active ? 'Trade & diplomacy' : 'Choose your border policy'}</button>
  </aside>;
}
