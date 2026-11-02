// Stylised low-poly models, built from simple shapes in a shared palette so everything belongs together.
// 1 world unit = 1 tile. Models sit on y = 0 with their footprint starting at (0, 0).
import * as THREE from 'three';
import type { AnimalId, MachineType } from '../../simulation/config';
import type { Lot } from './layout';

export const PAL = {
  barnRed: 0xb24a3c, barnRedDark: 0x8e3a30, cream: 0xf1e6cc, creamDark: 0xd9cbab, white: 0xf4f2ec, roofRed: 0x9e3b2e, roofBrown: 0x6b4a36,
  roofGrey: 0x6f7a80, roofBlue: 0x4f7aa0, roofGreen: 0x4f7a52, wood: 0x9a6b44, woodDark: 0x6e4a2f, stone: 0xb9b2a4, stoneDark: 0x948b7c,
  brick: 0xb0604a, metal: 0xc4cacc, metalDark: 0x8f979b, glass: 0xbfe3ea, window: 0x3b4a55, windowLit: 0xffd27a, door: 0x5a3d28,
  solar: 0x2f4f7a, hay: 0xe0c060, soil: 0x7a5a3c, soilDark: 0x5f442c,
};

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: number, opts: { rough?: number; metal?: number; opacity?: number; emissive?: number } = {}) {
  const key = `${color}-${opts.rough ?? 0.85}-${opts.metal ?? 0}-${opts.opacity ?? 1}-${opts.emissive ?? 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0, flatShading: true, transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1, emissive: opts.emissive ?? 0 });
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
const cached = (key: string, make: () => THREE.BufferGeometry) => geoCache.get(key) ?? (geoCache.set(key, make()), geoCache.get(key)!);

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, shadow = true) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = shadow;
  o.receiveShadow = true;
  return o;
}
export const box = (w: number, h: number, d: number, color: number, x: number, y: number, z: number, o?: Parameters<typeof mat>[1]) =>
  mesh(cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), mat(color, o), x, y + h / 2, z);
const cyl = (r: number, h: number, color: number, x: number, y: number, z: number, seg = 10, rTop = r) =>
  mesh(cached(`c${r},${rTop},${h},${seg}`, () => new THREE.CylinderGeometry(rTop, r, h, seg)), mat(color, color === PAL.metal ? { rough: 0.5, metal: 0.3 } : {}), x, y + h / 2, z);
const cone = (r: number, h: number, color: number, x: number, y: number, z: number, seg = 10) =>
  mesh(cached(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg)), mat(color), x, y + h / 2, z);
const sphere = (r: number, color: number, x: number, y: number, z: number, o?: Parameters<typeof mat>[1]) =>
  mesh(cached(`s${r}`, () => new THREE.IcosahedronGeometry(r, 1)), mat(color, o), x, y, z);

/** Gable roof spanning w (x) by d (z), ridge along x, eaves at height y. */
function gable(w: number, d: number, h: number, color: number, x: number, y: number, z: number) {
  const g = cached(`g${w},${d},${h}`, () => {
    const shape = new THREE.Shape();
    shape.moveTo(-d / 2 - 0.12, 0);
    shape.lineTo(d / 2 + 0.12, 0);
    shape.lineTo(0, h);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: w + 0.24, bevelEnabled: false });
    geo.rotateY(Math.PI / 2);
    geo.translate(-(w + 0.24) / 2, 0, 0);
    return geo;
  });
  return mesh(g, mat(color), x, y, z);
}

/** A house-like volume: walls, gable roof, windows and a door on the front (+z) face. */
function shed(g: THREE.Group, w: number, d: number, wallH: number, wall: number, roof: number, x: number, z: number, opts: { door?: 'barn' | 'house' | 'roller'; windows?: number; roofH?: number } = {}) {
  g.add(box(w, wallH, d, wall, x + w / 2, 0, z + d / 2));
  g.add(gable(w, d, opts.roofH ?? d * 0.45, roof, x + w / 2, wallH, z + d / 2));
  const front = z + d + 0.01;
  if (opts.door === 'barn') {
    g.add(box(w * 0.38, wallH * 0.72, 0.04, PAL.white, x + w / 2, 0, front));
    g.add(box(w * 0.32, wallH * 0.64, 0.05, wall === PAL.barnRed ? PAL.barnRedDark : PAL.door, x + w / 2, 0.02, front));
  } else if (opts.door === 'roller') {
    g.add(box(w * 0.3, wallH * 0.7, 0.04, PAL.metalDark, x + w * 0.3, 0, front));
    g.add(box(w * 0.3, wallH * 0.7, 0.04, PAL.metalDark, x + w * 0.7, 0, front));
  } else g.add(box(0.28, wallH * 0.55, 0.04, PAL.door, x + w / 2, 0, front));
  const n = opts.windows ?? Math.max(1, Math.floor(w) - 1);
  for (let i = 0; i < n; i++) {
    const wx = x + ((i + 0.5) / n) * w;
    if (Math.abs(wx - (x + w / 2)) < 0.3 && opts.door !== 'roller') continue;
    const win = box(0.26, 0.24, 0.03, PAL.window, wx, wallH * 0.5, front);
    win.userData.window = true;
    g.add(win);
  }
  // side window
  const sw = box(0.03, 0.24, 0.26, PAL.window, x + w + 0.01, wallH * 0.5, z + d / 2);
  sw.userData.window = true;
  g.add(sw);
}

function chimney(g: THREE.Group, x: number, z: number, y: number, h = 0.7) {
  g.add(box(0.22, h, 0.22, PAL.brick, x, y, z));
  return new THREE.Vector3(x, y + h + 0.05, z);
}

function fenceRect(g: THREE.Group, w: number, d: number, x = 0, z = 0, h = 0.32) {
  const post = cached('fpost', () => new THREE.BoxGeometry(0.06, h, 0.06));
  const pm = mat(PAL.woodDark);
  const rail = (len: number, alongX: boolean, px: number, pz: number, y: number) => {
    const r = mesh(cached(`fr${len.toFixed(2)}${alongX}`, () => new THREE.BoxGeometry(alongX ? len : 0.03, 0.04, alongX ? 0.03 : len)), mat(PAL.wood), px, y, pz);
    g.add(r);
  };
  const edges: [number, number, number, number][] = [[x, z, x + w, z], [x + w, z, x + w, z + d], [x + w, z + d, x, z + d], [x, z + d, x, z]];
  edges.forEach(([ax, az, bx, bz]) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 0.8));
    for (let i = 0; i <= n; i++) {
      const px = ax + ((bx - ax) * i) / n, pz = az + ((bz - az) * i) / n;
      g.add(mesh(post, pm, px, h / 2, pz));
    }
    for (const y of [h * 0.45, h * 0.8]) rail(len, az === bz, (ax + bx) / 2, (az + bz) / 2, y);
  });
}

function silo(g: THREE.Group, x: number, z: number, r = 0.42, h = 2.4) {
  g.add(cyl(r, h, PAL.metal, x, 0, z, 14));
  g.add(cone(r * 1.05, r * 0.8, PAL.metalDark, x, h, z, 14));
  for (let i = 1; i < 5; i++) g.add(cyl(r + 0.01, 0.03, PAL.metalDark, x, (h * i) / 5, z, 14));
}

export interface Model { group: THREE.Group; smoke: THREE.Vector3[]; sails?: THREE.Object3D; pen?: { x0: number; z0: number; x1: number; z1: number }; windows: THREE.Mesh[] }

/** Builds the model for a lot; positions are relative to the lot origin. */
export function buildLot(type: Lot['type'], w: number, d: number): Model {
  const g = new THREE.Group();
  const smoke: THREE.Vector3[] = [];
  let sails: THREE.Object3D | undefined;
  let pen: Model['pen'];
  const pad = (c = PAL.stone) => g.add(box(w - 0.1, 0.05, d - 0.1, c, w / 2, 0, d / 2, { rough: 1 }));
  switch (type) {
    case 'house':
      pad(PAL.creamDark);
      shed(g, 2.2, 1.6, 1.5, PAL.cream, PAL.roofRed, 0.4, 0.5, { door: 'house', windows: 3 });
      g.add(box(0.9, 0.05, 0.5, PAL.wood, 1.5, 0.05, 2.3)); // porch
      smoke.push(chimney(g, 0.75, 0.9, 1.5, 0.9));
      g.add(sphere(0.32, 0x5f8f4a, 2.85, 0.32, 2.6)); // garden shrub
      break;
    case 'shed':
      shed(g, 1.6, 1.2, 1.1, PAL.cream, PAL.roofGrey, 0.2, 0.4, { door: 'house' });
      break;
    case 'barn':
      shed(g, 2.6, 1.6, 1.4, PAL.barnRed, PAL.roofGrey, 0.2, 0.2, { door: 'barn', windows: 2, roofH: 0.95 });
      for (const [hx, hz] of [[2.75, 1.95], [2.55, 1.85]]) g.add(box(0.3, 0.22, 0.2, PAL.hay, hx, 0, hz));
      break;
    case 'silo':
      silo(g, 0.6, 0.7); silo(g, 1.4, 1.2, 0.4, 2.1);
      break;
    case 'coldStore':
      shed(g, 2.6, 1.6, 1.2, PAL.white, PAL.roofBlue, 0.2, 0.2, { door: 'roller', roofH: 0.4 });
      g.add(box(0.5, 0.3, 0.3, PAL.metal, 2.3, 1.2 + 0.2, 0.9)); // cooling unit
      break;
    case 'warehouse':
    case 'distribution':
      pad();
      shed(g, w - 0.4, d - 0.6, 1.5, type === 'warehouse' ? 0xd7d2c4 : 0xc9d6df, type === 'warehouse' ? PAL.roofGrey : PAL.roofBlue, 0.2, 0.2, { door: 'roller', windows: 3, roofH: 0.5 });
      if (type === 'distribution') g.add(box(1.0, 0.6, 0.5, 0x3f6f9a, w - 1.0, 0, d - 0.3)); // a parked lorry box
      break;
    case 'flourMill': {
      g.add(cyl(0.75, 2.2, PAL.stone, 1, 0, 1, 10, 0.6));
      g.add(cone(0.72, 0.7, PAL.roofBrown, 1, 2.2, 1, 10));
      g.add(box(0.3, 0.55, 0.05, PAL.door, 1, 0, 1.68));
      const hub = new THREE.Group();
      hub.position.set(1, 2.05, 1.75);
      for (let i = 0; i < 4; i++) {
        const arm = new THREE.Group();
        arm.rotation.z = (i * Math.PI) / 2;
        arm.add(mesh(cached('sailArm', () => new THREE.BoxGeometry(0.06, 1.3, 0.04)), mat(PAL.woodDark), 0, 0.65, 0));
        arm.add(mesh(cached('sailCloth', () => new THREE.BoxGeometry(0.28, 1.05, 0.02)), mat(PAL.cream), 0.17, 0.72, 0.02));
        hub.add(arm);
      }
      g.add(hub);
      sails = hub;
      break;
    }
    case 'bakery':
      pad(PAL.creamDark);
      shed(g, 1.6, 1.4, 1.2, PAL.brick, PAL.roofBrown, 0.2, 0.3, { door: 'house', windows: 2 });
      smoke.push(chimney(g, 0.5, 0.7, 1.2, 0.9));
      break;
    case 'feedMill':
      shed(g, 1.8, 1.5, 1.3, 0xd8c9a0, PAL.roofGrey, 0.2, 0.3, { door: 'roller' });
      g.add(box(0.5, 2.6, 0.5, 0xd8c9a0, 2.4, 0, 0.8));
      g.add(gable(0.5, 0.5, 0.3, PAL.roofGrey, 2.4, 2.6, 0.8));
      silo(g, 2.5, 1.6, 0.25, 1.5);
      break;
    case 'ranch':
    case 'dairy':
      shed(g, 2.4, 1.4, 1.2, type === 'dairy' ? PAL.white : PAL.barnRed, PAL.roofGrey, w - 2.6, 0.2, { door: 'barn', windows: 2 });
      fenceRect(g, w - 3, d - 0.4, 0.15, 0.2);
      pen = { x0: 0.4, z0: 0.4, x1: w - 3.1, z1: d - 0.4 };
      break;
    case 'creamery':
      pad();
      shed(g, 1.8, 1.4, 1.2, PAL.white, PAL.roofBlue, 0.2, 0.3, { door: 'house' });
      g.add(cyl(0.3, 1.2, PAL.metal, 2.5, 0, 0.8, 12));
      smoke.push(chimney(g, 0.4, 0.6, 1.2, 0.6));
      break;
    case 'oilPress':
      shed(g, 1.8, 1.4, 1.2, 0xd9c48a, PAL.roofBrown, 0.2, 0.3, { door: 'roller' });
      g.add(cyl(0.32, 1.1, 0xd9b95b, 2.4, 0, 0.6, 12)); g.add(cyl(0.32, 1.1, 0xd9b95b, 2.4, 0, 1.4, 12));
      smoke.push(chimney(g, 1.6, 0.6, 1.2, 0.7));
      break;
    case 'sugarMill':
      shed(g, 2.4, 1.5, 1.3, PAL.stone, PAL.roofGrey, 0.2, 0.3, { door: 'roller' });
      g.add(cyl(0.18, 2.6, PAL.brick, 2.75, 0, 0.6, 8));
      smoke.push(new THREE.Vector3(2.75, 2.7, 0.6));
      break;
    case 'biogas':
      pad();
      for (const [x, z] of [[0.9, 0.9], [2.1, 1.9]]) { g.add(cyl(0.6, 0.5, PAL.stoneDark, x, 0, z, 14)); g.add(sphere(0.62, 0x7a8f5a, x, 0.5, z)); }
      break;
    case 'solar':
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
        const p = box(0.95, 0.04, 0.6, PAL.solar, 0.7 + c * 1.15, 0.45, 0.5 + r * 0.9, { rough: 0.3, metal: 0.5 });
        p.rotation.x = -0.45;
        g.add(p);
        g.add(box(0.05, 0.45, 0.05, PAL.metalDark, 0.7 + c * 1.15, 0, 0.5 + r * 0.9));
      }
      break;
    case 'verticalFarm':
      g.add(box(1.6, 3.4, 1.6, PAL.glass, 1, 0, 1, { opacity: 0.55, rough: 0.2 }));
      for (let i = 0; i < 6; i++) g.add(box(1.5, 0.08, 1.5, 0x6faf5a, 1, 0.3 + i * 0.52, 1));
      g.add(box(1.7, 0.1, 1.7, PAL.metalDark, 1, 3.4, 1));
      break;
    case 'lab':
    case 'lab2':
      pad();
      shed(g, w - 1, d - 0.6, 1.2, PAL.white, PAL.roofGrey, 0.2, 0.3, { door: 'house', roofH: 0.35 });
      g.add(sphere(0.55, 0xdfe8ee, w - 0.6, 0.9, 0.7, { rough: 0.3, metal: 0.2 }));
      g.add(cyl(0.5, 0.9, PAL.white, w - 0.6, 0, 0.7, 12));
      break;
    case 'coop':
      shed(g, 1.4, 1.0, 0.8, PAL.barnRed, PAL.roofBrown, 0.2, 0.2, { door: 'house', windows: 1 });
      fenceRect(g, w - 0.3, d - 1.4, 0.15, 1.25, 0.25);
      pen = { x0: 0.3, z0: 1.4, x1: w - 0.3, z1: d - 0.25 };
      break;
    case 'pigsty':
      shed(g, 1.4, 1.0, 0.8, PAL.wood, PAL.roofBrown, 0.2, 0.2, { door: 'house', windows: 1 });
      g.add(box(w - 2, 0.03, d - 0.6, 0x6e5537, (w + 1.6) / 2, 0, d / 2)); // mud
      fenceRect(g, w - 1.8, d - 0.4, 1.7, 0.2);
      pen = { x0: 1.9, z0: 0.4, x1: w - 0.3, z1: d - 0.4 };
      break;
    case 'cowshed':
      shed(g, 2.4, 1.4, 1.3, PAL.barnRed, PAL.roofGrey, 0.2, 0.2, { door: 'barn', windows: 2, roofH: 0.8 });
      fenceRect(g, w - 0.3, d - 1.8, 0.15, 1.65);
      pen = { x0: 0.4, z0: 1.9, x1: w - 0.4, z1: d - 0.3 };
      break;
    case 'sheepfold':
      shed(g, 1.6, 1.0, 0.8, PAL.wood, PAL.roofGreen, 0.2, 0.2, { door: 'house', windows: 1 });
      fenceRect(g, w - 0.3, d - 1.4, 0.15, 1.25);
      pen = { x0: 0.4, z0: 1.5, x1: w - 0.4, z1: d - 0.3 };
      break;
    case 'winery':
      pad(PAL.creamDark);
      shed(g, 2.2, 1.6, 1.3, PAL.stone, PAL.roofRed, 0.2, 0.3, { door: 'barn', windows: 2 });
      for (let i = 0; i < 3; i++) { const b = cyl(0.17, 0.4, PAL.woodDark, 0.6 + i * 0.45, 0, 2.4, 10); b.rotation.z = Math.PI / 2; b.position.y = 0.18; g.add(b); }
      break;
  }
  const windows: THREE.Mesh[] = [];
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.userData.window) windows.push(o as THREE.Mesh); });
  return { group: g, smoke, sails, pen, windows };
}

// ---------------------------------------------------------------- people, machines, animals

export function person(shirt: number, manager: boolean) {
  const g = new THREE.Group();
  g.add(box(0.07, 0.16, 0.07, 0x3b3f4a, -0.04, 0, 0));
  g.add(box(0.07, 0.16, 0.07, 0x3b3f4a, 0.04, 0, 0));
  g.add(box(0.2, 0.2, 0.12, manager ? PAL.white : shirt, 0, 0.16, 0));
  g.add(sphere(0.075, 0xe2b08c, 0, 0.44, 0));
  const hat = mesh(cached('hat', () => new THREE.CylinderGeometry(0.06, 0.13, 0.05, 10)), mat(manager ? 0x3b3f4a : PAL.hay), 0, 0.51, 0);
  g.add(hat);
  return g;
}

export function vehicle(type: MachineType | 'truck') {
  const g = new THREE.Group();
  const body = type === 'truck' ? 0x3f6f9a : type.includes('arvester') ? 0x4c8a3a : type.startsWith('robot') ? 0xe8e8e8 : 0xc0392b;
  const wheel = (x: number, z: number, r: number) => {
    const w = mesh(cached(`wh${r}`, () => new THREE.CylinderGeometry(r, r, 0.08, 12)), mat(0x222222), x, r, z);
    w.rotation.x = Math.PI / 2;
    g.add(w);
  };
  if (type === 'orchardPlatform') {
    // low self-propelled deck with railings that pickers stand on
    g.add(box(0.6, 0.06, 0.34, 0xd9a441, 0, 0.16, 0));
    for (const z of [-0.16, 0.16]) g.add(box(0.6, 0.12, 0.02, 0x8a6a3a, 0, 0.25, z));
    for (const z of [-0.14, 0.14]) { wheel(0.2, z, 0.07); wheel(-0.2, z, 0.07); }
    return g;
  }
  if (type === 'truck') {
    g.add(box(0.36, 0.3, 0.32, body, 0.3, 0.12, 0));
    g.add(box(0.62, 0.36, 0.36, PAL.creamDark, -0.2, 0.12, 0));
    for (const x of [-0.35, 0, 0.32]) for (const z of [-0.17, 0.17]) wheel(x, z, 0.08);
  } else if (type.includes('arvester')) {
    g.add(box(0.6, 0.32, 0.4, body, 0, 0.14, 0));
    g.add(box(0.26, 0.24, 0.3, 0x2f2f2f, -0.12, 0.46, 0, { opacity: 0.85 }));
    g.add(box(0.12, 0.08, 0.7, 0xd8aa54, 0.38, 0.12, 0)); // header
    for (const z of [-0.2, 0.2]) { wheel(0.12, z, 0.14); wheel(-0.22, z, 0.09); }
  } else {
    g.add(box(0.42, 0.18, 0.26, body, 0.04, 0.12, 0));
    g.add(box(0.18, 0.22, 0.22, 0x2f2f2f, -0.06, 0.3, 0, { opacity: 0.8 }));
    g.add(box(0.16, 0.14, 0.2, body, 0.2, 0.12, 0));
    for (const z of [-0.16, 0.16]) { wheel(-0.12, z, 0.15); wheel(0.2, z, 0.08); }
  }
  return g;
}

export function animal(a: AnimalId) {
  const g = new THREE.Group();
  if (a === 'chickens') {
    g.add(sphere(0.07, PAL.white, 0, 0.08, 0));
    g.add(sphere(0.04, PAL.white, 0.06, 0.15, 0));
    g.add(box(0.02, 0.03, 0.02, 0xd8482f, 0.07, 0.17, 0));
  } else if (a === 'pigs') {
    g.add(box(0.3, 0.16, 0.16, 0xe8a7a0, 0, 0.06, 0));
    g.add(box(0.1, 0.12, 0.12, 0xe8a7a0, 0.18, 0.08, 0));
  } else if (a === 'sheep') {
    g.add(sphere(0.14, 0xf2efe6, 0, 0.17, 0));
    g.add(box(0.08, 0.1, 0.08, 0x2b2b2b, 0.15, 0.18, 0));
    for (const [x, z] of [[-0.07, -0.06], [-0.07, 0.06], [0.07, -0.06], [0.07, 0.06]]) g.add(box(0.03, 0.08, 0.03, 0x2b2b2b, x, 0, z));
  } else {
    g.add(box(0.42, 0.2, 0.2, PAL.white, 0, 0.14, 0));
    g.add(box(0.14, 0.1, 0.16, 0x2b2b2b, -0.05, 0.25, 0));
    g.add(box(0.12, 0.13, 0.13, PAL.white, 0.26, 0.24, 0));
    for (const [x, z] of [[-0.15, -0.07], [-0.15, 0.07], [0.15, -0.07], [0.15, 0.07]]) g.add(box(0.05, 0.14, 0.05, 0x2b2b2b, x, 0, z));
  }
  return g;
}

/** A small decorative tree (season changes its crown). */
export function tree(scale: number, crown: THREE.Material) {
  const g = new THREE.Group();
  g.add(mesh(cached('trunk', () => new THREE.CylinderGeometry(0.06, 0.09, 0.5, 6)), mat(PAL.woodDark), 0, 0.25, 0));
  const c = mesh(cached('crown', () => new THREE.IcosahedronGeometry(0.42, 0)), crown, 0, 0.75, 0);
  c.userData.crown = true;
  g.add(c);
  g.scale.setScalar(scale);
  return g;
}

export { cached, mesh };
