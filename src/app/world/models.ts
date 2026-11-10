// Stylised low-poly models, built from simple shapes in a shared palette so everything belongs together.
// 1 world unit = 1 tile. Models sit on y = 0 with their footprint starting at (0, 0).
import * as THREE from 'three';
import type { AnimalId, MachineType } from '../../simulation/config';
import type { Lot } from './layout';
import { artModel, type ArtId } from './art';

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

/** A house-like volume: stone footing, walls with corner trim, gable roof with ridge cap, framed windows and door on the front (+z). */
function shed(g: THREE.Group, w: number, d: number, wallH: number, wall: number, roof: number, x: number, z: number, opts: { door?: 'barn' | 'house' | 'roller'; windows?: number; roofH?: number } = {}) {
  const trim = wall === PAL.white || wall === PAL.cream ? PAL.woodDark : PAL.white;
  g.add(box(w + 0.06, 0.12, d + 0.06, PAL.stoneDark, x + w / 2, 0, z + d / 2, { rough: 1 })); // footing
  g.add(box(w, wallH - 0.1, d, wall, x + w / 2, 0.1, z + d / 2));
  for (const cx of [x, x + w]) for (const cz of [z, z + d]) g.add(box(0.06, wallH - 0.1, 0.06, trim, cx, 0.1, cz)); // corner boards
  const rh = opts.roofH ?? d * 0.45;
  g.add(gable(w, d, rh, roof, x + w / 2, wallH, z + d / 2));
  g.add(box(w + 0.3, 0.05, 0.08, roof === PAL.roofGrey ? PAL.metalDark : PAL.woodDark, x + w / 2, wallH + rh - 0.02, z + d / 2)); // ridge cap
  const front = z + d + 0.01;
  if (opts.door === 'barn') {
    g.add(box(w * 0.38, wallH * 0.72, 0.04, PAL.white, x + w / 2, 0.08, front));
    g.add(box(w * 0.32, wallH * 0.64, 0.05, wall === PAL.barnRed ? PAL.barnRedDark : PAL.door, x + w / 2, 0.1, front));
    const brace = box(0.04, wallH * 0.8, 0.02, PAL.white, x + w / 2, 0.1, front + 0.03); brace.rotation.z = 0.5; g.add(brace); // the barn-door X
    const brace2 = box(0.04, wallH * 0.8, 0.02, PAL.white, x + w / 2, 0.1, front + 0.03); brace2.rotation.z = -0.5; g.add(brace2);
  } else if (opts.door === 'roller') {
    for (const fx of [0.3, 0.7]) {
      g.add(box(w * 0.3 + 0.06, wallH * 0.7 + 0.04, 0.03, PAL.stoneDark, x + w * fx, 0.08, front));
      g.add(box(w * 0.3, wallH * 0.7, 0.04, PAL.metalDark, x + w * fx, 0.1, front));
      for (let k = 1; k < 5; k++) g.add(box(w * 0.3, 0.015, 0.05, PAL.metal, x + w * fx, 0.1 + (wallH * 0.7 * k) / 5, front)); // roller slats
    }
  } else {
    g.add(box(0.36, wallH * 0.55 + 0.05, 0.03, trim, x + w / 2, 0.1, front));
    g.add(box(0.28, wallH * 0.55, 0.04, PAL.door, x + w / 2, 0.1, front));
    g.add(box(0.42, 0.06, 0.18, PAL.stone, x + w / 2, 0, front + 0.08)); // doorstep
  }
  const n = opts.windows ?? Math.max(1, Math.floor(w) - 1);
  const framed = (wx: number, wz: number, side: boolean) => {
    g.add(side ? box(0.02, 0.3, 0.32, trim, wx, wallH * 0.5 - 0.03, wz) : box(0.32, 0.3, 0.02, trim, wx, wallH * 0.5 - 0.03, wz));
    const win = side ? box(0.03, 0.24, 0.26, PAL.window, wx + 0.01, wallH * 0.5, wz) : box(0.26, 0.24, 0.03, PAL.window, wx, wallH * 0.5, wz + 0.01);
    win.userData.window = true; g.add(win);
    g.add(side ? box(0.08, 0.03, 0.34, trim, wx + 0.03, wallH * 0.5 - 0.05, wz) : box(0.34, 0.03, 0.08, trim, wx, wallH * 0.5 - 0.05, wz + 0.03)); // sill
  };
  for (let i = 0; i < n; i++) {
    const wx = x + ((i + 0.5) / n) * w;
    if (Math.abs(wx - (x + w / 2)) < 0.3 && opts.door !== 'roller') continue;
    framed(wx, front, false);
  }
  framed(x + w + 0.01, z + d / 2, true); // side window
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

/** Single-slope roof: high at the back (z), low at the front (z + d). */
function leanTo(g: THREE.Group, w: number, d: number, hBack: number, hFront: number, color: number, x: number, z: number) {
  const len = Math.hypot(d, hBack - hFront);
  const r = mesh(cached(`lean${w},${len.toFixed(2)}`, () => new THREE.BoxGeometry(w + 0.2, 0.07, len + 0.15)), mat(color), x + w / 2, (hBack + hFront) / 2, z + d / 2);
  r.rotation.x = Math.atan2(hBack - hFront, d);
  g.add(r);
}

/** Low dry-stone wall around a rectangle, open on the front for a gate. */
function stoneWall(g: THREE.Group, w: number, d: number, x: number, z: number, h = 0.3) {
  const t = 0.18, gate = 0.8;
  const seg = (sw: number, sd: number, cx: number, cz: number) => { g.add(box(sw, h, sd, PAL.stoneDark, cx, 0, cz, { rough: 1 })); g.add(box(sw - 0.04, 0.06, sd - 0.04, PAL.stone, cx, h, cz, { rough: 1 })); };
  seg(w, t, x + w / 2, z); seg(t, d, x, z + d / 2); seg(t, d, x + w, z + d / 2);
  const side = (w - gate) / 2;
  seg(side, t, x + side / 2, z + d); seg(side, t, x + w - side / 2, z + d);
}

function trough(g: THREE.Group, x: number, z: number, len = 0.8, water = true) {
  g.add(box(len, 0.16, 0.24, water ? PAL.metalDark : PAL.woodDark, x, 0, z));
  g.add(box(len - 0.08, 0.02, 0.16, water ? 0x65a8bb : PAL.hay, x, 0.15, z));
}

const hashStr = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };
const WALLS = [PAL.cream, PAL.white, 0xe6d3a8, 0xcdbfa8, 0xd8b39a, 0xc9d3c0];
const ROOFS = [PAL.roofRed, PAL.roofBrown, PAL.roofGrey, 0x5d6f4c, 0x7a4a3e];

/** A small family cottage with a garden: wall and roof colours vary per home. */
function cottage(g: THREE.Group, w: number, d: number, seed: number) {
  const wall = WALLS[Math.floor(seed * WALLS.length)], roof = ROOFS[Math.floor(hashStr(String(seed)) * ROOFS.length)];
  g.add(box(w - 0.1, 0.04, d - 0.1, 0x7fa65a, w / 2, 0, d / 2, { rough: 1 })); // garden
  shed(g, 1.8, 1.3, 1.0, wall, roof, 0.55, 0.45, { door: 'house', windows: 2, roofH: 0.7 });
  chimney(g, 0.9 + seed * 0.8, 0.8, 1.2, 0.5);
  g.add(box(0.35, 0.03, d - 1.8, PAL.stone, 1.45, 0.04, 1.75 + (d - 1.8) / 2)); // path
  for (const x of [0.4, w - 0.4]) g.add(sphere(0.22 + seed * 0.08, 0x5f8f4a, x, 0.22, d - 0.45)); // shrubs
  g.add(box(w - 0.3, 0.18, 0.06, PAL.white, w / 2, 0, d - 0.12)); // picket fence
}

function awning(g: THREE.Group, w: number, x: number, y: number, z: number, a = PAL.barnRed, b = PAL.white) {
  for (let i = 0; i < Math.round(w / 0.25); i++) { const s = box(0.25, 0.03, 0.4, i % 2 ? b : a, x + 0.125 + i * 0.25, y, z + 0.18); s.rotation.x = 0.35; g.add(s); }
}
const barrel = (g: THREE.Group, x: number, z: number, c = PAL.woodDark) => { g.add(cyl(0.12, 0.3, c, x, 0, z, 10)); g.add(cyl(0.125, 0.025, PAL.metalDark, x, 0.07, z, 10)); g.add(cyl(0.125, 0.025, PAL.metalDark, x, 0.22, z, 10)); };
const pallet = (g: THREE.Group, x: number, z: number, c: number) => { g.add(box(0.36, 0.05, 0.36, PAL.wood, x, 0, z)); g.add(box(0.32, 0.22, 0.32, c, x, 0.05, z)); };

export interface Model { group: THREE.Group; smoke: THREE.Vector3[]; sails?: THREE.Object3D; pen?: { x0: number; z0: number; x1: number; z1: number }; windows: THREE.Mesh[] }

/** Builds the model for a lot; positions are relative to the lot origin. */
export function buildLot(type: Lot['type'], w: number, d: number, variant = ''): Model {
  const g = new THREE.Group();
  const smoke: THREE.Vector3[] = [];
  let sails: THREE.Object3D | undefined;
  let pen: Model['pen'];
  const pad = (c = PAL.stone) => g.add(box(w - 0.1, 0.05, d - 0.1, c, w / 2, 0, d / 2, { rough: 1 }));
  switch (type) {
    case 'house':
      if (variant === 'crew') { // bunkhouse: a log cabin for the farm crew, with a covered porch
        pad(PAL.creamDark);
        const lw = 2.6, ld = 1.3, x0 = 0.2, z0 = 0.4, rows = 6, lr = 0.085;
        for (let i = 0; i < rows; i++) { // stacked logs, ends poking out at the corners
          const y = lr + i * lr * 1.9, c = i % 2 ? PAL.wood : 0x8a5d3a;
          for (const z of [z0, z0 + ld]) { const l = cyl(lr, lw + 0.16, c, x0 + lw / 2, y - lr, z, 7); l.rotation.z = Math.PI / 2; l.position.y = y; g.add(l); }
          for (const x of [x0, x0 + lw]) { const l = cyl(lr, ld + 0.16, c, x, y - lr, z0 + ld / 2, 7); l.rotation.x = Math.PI / 2; l.position.y = y; g.add(l); }
        }
        g.add(box(lw - 0.05, rows * lr * 1.9, ld - 0.05, 0x7a5232, x0 + lw / 2, 0, z0 + ld / 2)); // infill
        const wallH = rows * lr * 1.9 + 0.05;
        g.add(gable(lw + 0.2, ld + 0.9, 0.6, PAL.roofGreen, x0 + lw / 2, wallH, z0 + ld / 2 + 0.35)); // roof runs out over the porch
        const front = z0 + ld + 0.09;
        g.add(box(0.3, 0.62, 0.04, PAL.door, x0 + lw / 2, 0, front));
        for (const wx of [x0 + 0.45, x0 + 0.95, x0 + lw - 0.95, x0 + lw - 0.45]) {
          const win = box(0.24, 0.24, 0.03, PAL.window, wx, 0.42, front); win.userData.window = true; g.add(win);
          g.add(box(0.3, 0.04, 0.05, PAL.white, wx, 0.39, front + 0.01));
        }
        g.add(box(lw + 0.1, 0.06, 0.75, PAL.woodDark, x0 + lw / 2, 0, front + 0.38)); // porch deck
        for (const px of [x0 + 0.05, x0 + lw / 2 - 0.5, x0 + lw / 2 + 0.5, x0 + lw - 0.05]) g.add(box(0.07, wallH, 0.07, PAL.woodDark, px, 0.06, front + 0.7));
        g.add(box(0.8, 0.1, 0.22, PAL.wood, x0 + 0.6, 0.2, front + 0.2)); // bench
        smoke.push(chimney(g, x0 + lw - 0.4, z0 + 0.4, wallH + 0.2, 0.6));
        for (let i = 0; i < 4; i++) { const log = cyl(0.07, 0.5, PAL.woodDark, 0, 0, 0, 7); log.rotation.x = Math.PI / 2; log.position.set(x0 + lw + 0.35, 0.07 + Math.floor(i / 2) * 0.13, z0 + 0.3 + (i % 2) * 0.15 + Math.floor(i / 2) * 0.07); g.add(log); } // woodpile
        break;
      }
      if (variant === 'office') { // farm office: neat, painted, with a sign
        pad(PAL.stone);
        shed(g, 2.0, 1.4, 1.3, PAL.white, PAL.roofBlue, 0.5, 0.4, { door: 'house', windows: 3, roofH: 0.5 });
        g.add(box(0.08, 1.1, 0.08, PAL.woodDark, 0.35, 0, 2.5), box(0.08, 1.1, 0.08, PAL.woodDark, 1.15, 0, 2.5));
        g.add(box(0.95, 0.35, 0.05, PAL.roofGreen, 0.75, 0.75, 2.5)); // sign board
        g.add(box(0.05, 1.8, 0.05, PAL.metal, 2.75, 0, 0.6), box(0.4, 0.25, 0.02, PAL.barnRed, 2.95, 1.5, 0.6)); // flag
        break;
      }
      pad(PAL.creamDark);
      shed(g, 2.2, 1.6, 1.5, PAL.cream, PAL.roofRed, 0.4, 0.5, { door: 'house', windows: 3 });
      g.add(box(0.9, 0.05, 0.5, PAL.wood, 1.5, 0.05, 2.3)); // porch
      smoke.push(chimney(g, 0.75, 0.9, 1.5, 0.9));
      g.add(sphere(0.32, 0x5f8f4a, 2.85, 0.32, 2.6)); // garden shrub
      break;
    case 'shed':
      if (variant === 'market') { // village trader: a market stall with a striped awning, produce crates and a hand cart
        g.add(box(w - 0.1, 0.04, d - 0.1, PAL.stone, w / 2, 0, d / 2, { rough: 1 }));
        g.add(box(1.5, 0.55, 0.5, PAL.wood, w / 2, 0, 0.55)); // counter
        g.add(box(1.6, 0.05, 0.6, PAL.woodDark, w / 2, 0.55, 0.55));
        for (const x of [w / 2 - 0.78, w / 2 + 0.78]) for (const z of [0.3, 0.85]) g.add(box(0.06, 1.25, 0.06, PAL.woodDark, x, 0, z));
        for (let i = 0; i < 6; i++) { // striped awning
          const s = box(0.28, 0.04, 0.85, i % 2 ? PAL.white : PAL.barnRed, w / 2 - 0.7 + i * 0.28, 1.25, 0.62);
          s.rotation.x = -0.25; g.add(s);
        }
        const goods = [0xd8aa54, 0xc0392b, 0x6faf5a, 0xe8c44a, 0xb0604a];
        for (let i = 0; i < 5; i++) { g.add(box(0.24, 0.12, 0.2, PAL.wood, w / 2 - 0.6 + i * 0.3, 0.6, 0.55)); g.add(box(0.2, 0.06, 0.16, goods[i], w / 2 - 0.6 + i * 0.3, 0.72, 0.55)); }
        for (let i = 0; i < 3; i++) g.add(box(0.3, 0.25, 0.3, PAL.wood, 0.35 + i * 0.05, i * 0.25, d - 0.45)); // stacked crates
        g.add(box(0.5, 0.1, 0.35, PAL.wood, w - 0.45, 0.2, d - 0.45)); // hand cart
        const wheel = cyl(0.14, 0.04, PAL.woodDark, w - 0.45, 0, d - 0.25, 10); wheel.rotation.x = Math.PI / 2; wheel.position.y = 0.14; g.add(wheel);
        g.add(box(0.05, 0.05, 0.5, PAL.woodDark, w - 0.1, 0.25, d - 0.45));
        g.add(box(0.9, 0.22, 0.04, PAL.roofGreen, w / 2, 1.45, 0.3)); // sign board
        break;
      }
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
      for (let i = 0; i < 9; i++) g.add(box(0.03, 1.05, 0.02, 0xd9dcdc, 0.35 + i * 0.29, 0.12, 1.82)); // ribbed cladding
      g.add(box(2.6, 0.3, 0.35, PAL.stoneDark, 1.5, 0, 2.0)); // loading dock
      break;
    case 'warehouse':
    case 'distribution':
      pad();
      shed(g, w - 0.4, d - 0.6, 1.5, type === 'warehouse' ? 0xd7d2c4 : 0xc9d6df, type === 'warehouse' ? PAL.roofGrey : PAL.roofBlue, 0.2, 0.2, { door: 'roller', windows: 3, roofH: 0.5 });
      if (type === 'distribution') g.add(box(1.0, 0.6, 0.5, 0x3f6f9a, w - 1.0, 0, d - 0.3)); // a parked lorry box
      g.add(box(w - 1.2, 0.28, 0.35, PAL.stoneDark, w / 2, 0, d - 0.2)); // loading dock
      [0xd8aa54, 0x9a6b44, 0xc9b49a].forEach((c, i) => pallet(g, 0.6 + i * 0.45, d - 0.35, c));
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
      awning(g, 1.5, 0.25, 0.95, 1.5);
      g.add(box(0.6, 0.35, 0.25, PAL.wood, 1.45, 0, 1.95)); for (let i = 0; i < 3; i++) g.add(sphere(0.07, 0xc68a4e, 1.25 + i * 0.2, 0.42, 1.95)); // bread on the stall
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
      for (let i = 0; i < 3; i++) { g.add(cyl(0.08, 0.22, PAL.metal, 2.2 + i * 0.2, 0, 1.75, 10)); g.add(cyl(0.05, 0.05, PAL.metalDark, 2.2 + i * 0.2, 0.22, 1.75, 8)); } // milk churns
      break;
    case 'oilPress':
      shed(g, 1.8, 1.4, 1.2, 0xd9c48a, PAL.roofBrown, 0.2, 0.3, { door: 'roller' });
      g.add(cyl(0.32, 1.1, 0xd9b95b, 2.4, 0, 0.6, 12)); g.add(cyl(0.32, 1.1, 0xd9b95b, 2.4, 0, 1.4, 12));
      smoke.push(chimney(g, 1.6, 0.6, 1.2, 0.7));
      barrel(g, 2.3, 1.95, 0xd9b95b); barrel(g, 2.6, 1.95, 0xd9b95b);
      break;
    case 'sugarMill':
      shed(g, 2.4, 1.5, 1.3, PAL.stone, PAL.roofGrey, 0.2, 0.3, { door: 'roller' });
      g.add(cyl(0.18, 2.6, PAL.brick, 2.75, 0, 0.6, 8));
      smoke.push(new THREE.Vector3(2.75, 2.7, 0.6));
      for (let i = 0; i < 6; i++) { const cane = cyl(0.03, 0.7, 0x8fae4a, 0, 0, 0, 5); cane.rotation.z = Math.PI / 2; cane.position.set(2.4, 0.04 + Math.floor(i / 3) * 0.06, 1.75 + (i % 3) * 0.07); g.add(cane); } // cut cane
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
    case 'windTurbine': {
      g.add(box(1.2, 0.1, 1.2, PAL.stone, 1, 0, 1)); // foundation
      g.add(cyl(0.14, 3.6, PAL.white, 1, 0.1, 1, 12, 0.08)); // tapering tower
      g.add(box(0.5, 0.22, 0.24, PAL.white, 1, 3.65, 0.95)); // nacelle
      const rotor = new THREE.Group(); rotor.position.set(1, 3.76, 1.12);
      rotor.add(sphere(0.08, PAL.white, 0, 0, 0));
      for (let i = 0; i < 3; i++) { const blade = new THREE.Group(); blade.rotation.z = (i * Math.PI * 2) / 3; blade.add(mesh(cached('turbineBlade', () => new THREE.BoxGeometry(0.1, 1.5, 0.03)), mat(PAL.white), 0, 0.78, 0)); rotor.add(blade); }
      g.add(rotor); sails = rotor;
      break;
    }
    case 'oilWell': {
      g.add(box(w - 0.2, 0.08, d - 0.2, 0x3a3a3a, w / 2, 0, d / 2, { rough: 1 }));
      for (const z of [0.7, 1.3]) { const leg = box(0.08, 1.3, 0.08, 0x2f3b46, 0.9, 0, z); leg.rotation.x = z < 1 ? 0.18 : -0.18; g.add(leg); } // A-frame
      g.add(box(1.7, 0.12, 0.12, 0x2f3b46, 0.9, 1.25, 1)); // walking beam
      g.add(box(0.2, 0.4, 0.2, 0x2f3b46, 1.75, 1.0, 1)); // horse head over the well
      g.add(cyl(0.06, 0.9, PAL.metalDark, 1.78, 0.08, 1, 8)); // polished rod down to the well
      const crank = new THREE.Group(); crank.position.set(0.25, 0.45, 1);
      crank.add(box(0.5, 0.12, 0.1, 0xc0392b, 0.2, 0, 0)); // counterweight arm, turns while it pumps
      g.add(crank); sails = crank;
      g.add(box(0.4, 0.3, 0.3, 0x2f3b46, 0.25, 0.08, 1.45)); // motor
      for (let i = 0; i < 2; i++) g.add(cyl(0.18, 0.5, 0x2b2b2b, 0.4 + i * 0.45, 0.08, 0.35, 10)); // barrels of crude
      break;
    }
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
      g.add(box(0.03, 0.8, 0.03, PAL.metalDark, 0.6, 1.5, 0.6)); g.add(box(0.3, 0.03, 0.03, PAL.metalDark, 0.6, 2.2, 0.6)); // antenna
      break;
    case 'coop':
      {const coop=artModel('coop',1.4,1);if(coop){coop.position.add(new THREE.Vector3(.2,0,.2));g.add(coop);}else shed(g, 1.4, 1.0, 0.8, PAL.barnRed, PAL.roofBrown, 0.2, 0.2, { door: 'house', windows: 1 });}
      fenceRect(g, w - 0.3, d - 1.4, 0.15, 1.25, 0.25);
      pen = { x0: 0.3, z0: 1.4, x1: w - 0.3, z1: d - 0.25 };
      break;
    case 'pigsty':
      // low stone sty with a lean-to roof, a muddy run and a feed trough
      g.add(box(1.3, 0.6, 1.0, PAL.stone, 0.85, 0, 0.75, { rough: 1 }));
      leanTo(g, 1.3, 1.15, 0.85, 0.6, PAL.roofBrown, 0.2, 0.2);
      g.add(box(0.32, 0.4, 0.04, PAL.door, 0.85, 0, 1.27));
      g.add(box(w - 2, 0.03, d - 0.6, 0x6e5537, (w + 1.6) / 2, 0, d / 2)); // mud
      fenceRect(g, w - 1.8, d - 0.4, 1.7, 0.2, 0.26);
      trough(g, w - 0.8, 0.55, 0.7, false);
      pen = { x0: 1.9, z0: 0.6, x1: w - 0.3, z1: d - 0.4 };
      break;
    case 'cowshed': {
      // open-sided cattle shed on posts, straw inside, a fenced yard with trough and hay rack in front
      const sw = w - 1.0, sd = 1.4, sx = 0.5, sz = 0.25;
      g.add(box(sw, 1.0, 0.1, PAL.wood, sx + sw / 2, 0, sz));
      g.add(box(0.1, 1.0, sd, PAL.wood, sx, 0, sz + sd / 2), box(0.1, 1.0, sd, PAL.wood, sx + sw, 0, sz + sd / 2));
      for (let i = 1; i < 4; i++) g.add(box(0.09, 0.8, 0.09, PAL.woodDark, sx + (i * sw) / 4, 0, sz + sd));
      leanTo(g, sw, sd + 0.1, 1.25, 0.85, 0x8c979b, sx, sz);
      g.add(box(sw - 0.15, 0.03, sd - 0.1, PAL.hay, sx + sw / 2, 0, sz + sd / 2, { rough: 1 }));
      for (const hx of [sx + 0.45, sx + 0.85]) g.add(box(0.35, 0.25, 0.25, PAL.hay, hx, 0, sz + 0.35));
      fenceRect(g, w - 0.3, d - 1.85, 0.15, 1.7);
      trough(g, w - 0.9, d - 0.45);
      g.add(box(0.6, 0.45, 0.28, PAL.woodDark, 0.75, 0, d - 0.45), box(0.5, 0.12, 0.22, PAL.hay, 0.75, 0.45, d - 0.45)); // hay rack
      pen = { x0: 0.4, z0: 1.9, x1: w - 0.4, z1: d - 0.3 };
      break;
    }
    case 'sheepfold':
      // dry-stone fold with a small timber shelter and a hay rack
      stoneWall(g, w - 0.3, d - 0.3, 0.15, 0.15);
      for (const [px, pz] of [[0.4, 0.35], [2.0, 0.35], [0.4, 1.25], [2.0, 1.25]]) g.add(box(0.08, 0.75, 0.08, PAL.woodDark, px, 0, pz));
      g.add(box(1.7, 0.75, 0.08, PAL.wood, 1.2, 0, 0.32));
      leanTo(g, 1.7, 1.05, 0.95, 0.75, PAL.roofGreen, 0.35, 0.3);
      g.add(box(1.5, 0.03, 0.8, PAL.hay, 1.2, 0, 0.8, { rough: 1 }));
      g.add(box(0.6, 0.4, 0.26, PAL.woodDark, w - 0.8, 0, 0.6), box(0.5, 0.12, 0.2, PAL.hay, w - 0.8, 0.4, 0.6));
      pen = { x0: 0.5, z0: 1.5, x1: w - 0.5, z1: d - 0.5 };
      break;
    case 'winery':
      pad(PAL.creamDark);
      shed(g, 2.2, 1.6, 1.3, PAL.stone, PAL.roofRed, 0.2, 0.3, { door: 'barn', windows: 2 });
      for (let i = 0; i < 3; i++) { const b = cyl(0.17, 0.4, PAL.woodDark, 0.6 + i * 0.45, 0, 2.4, 10); b.rotation.z = Math.PI / 2; b.position.y = 0.18; g.add(b); }
      break;
  }
  const ids: Partial<Record<Lot['type'], ArtId>>={house:'house',shed:'shed',barn:'barn',silo:'silo',flourMill:'mill'};
  const art=ids[type] && !variant && artModel(ids[type]!, w, d);
  if(art){g.clear();g.add(art);smoke.length=0;sails=undefined;}
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
  const robot = type.startsWith('robot');
  const body = type === 'truck' ? 0x3f6f9a : type === 'grapeHarvester' ? 0x7a4a8a : type.includes('arvester') ? 0x4c8a3a : robot ? 0xeef0f0 : 0xc0392b;
  const TYRE = 0x222222, HUB = robot ? 0x2f7fd0 : 0xe8c44a, GLASS = 0x9fd0e0;
  const wheel = (x: number, z: number, r: number, wdt = 0.07) => {
    const w = mesh(cached(`wh${r},${wdt}`, () => new THREE.CylinderGeometry(r, r, wdt, 14)), mat(TYRE, { rough: 1 }), x, r, z);
    w.rotation.x = Math.PI / 2; g.add(w);
    const h = mesh(cached(`hub${r}`, () => new THREE.CylinderGeometry(r * 0.45, r * 0.45, wdt + 0.01, 10)), mat(HUB), x, r, z);
    h.rotation.x = Math.PI / 2; g.add(h);
  };
  const cab = (x: number, y: number, w: number, d: number, h: number) => { // glass cab with a roof
    g.add(box(w, h, d, GLASS, x, y, 0, { opacity: 0.55, rough: 0.2 }));
    g.add(box(w + 0.04, 0.03, d + 0.04, robot ? 0x2f2f2f : body, x, y + h, 0));
  };
  if (type === 'orchardPlatform') {
    // low self-propelled deck with railings that pickers stand on
    g.add(box(0.6, 0.06, 0.34, 0xd9a441, 0, 0.16, 0));
    for (const z of [-0.16, 0.16]) g.add(box(0.6, 0.12, 0.02, 0x8a6a3a, 0, 0.25, z));
    for (const z of [-0.14, 0.14]) { wheel(0.2, z, 0.07); wheel(-0.2, z, 0.07); }
    return g;
  }
  if (type === 'truck') {
    g.add(box(0.9, 0.06, 0.3, 0x2f2f2f, -0.05, 0.1, 0)); // chassis
    g.add(box(0.26, 0.28, 0.32, body, 0.32, 0.14, 0)); // cab
    g.add(box(0.03, 0.12, 0.26, GLASS, 0.455, 0.27, 0, { opacity: 0.7, rough: 0.2 })); // windscreen
    g.add(box(0.58, 0.34, 0.34, PAL.creamDark, -0.14, 0.15, 0)); // box body
    g.add(box(0.58, 0.04, 0.35, body, -0.14, 0.49, 0)); // roof trim
    for (const x of [-0.36, -0.2, 0.32]) for (const z of [-0.16, 0.16]) wheel(x, z, 0.075, 0.05);
    return g;
  }
  if (type.includes('arvester') && type !== 'grapeHarvester') {
    g.add(box(0.55, 0.3, 0.34, body, -0.02, 0.12, 0)); // body
    g.add(box(0.26, 0.14, 0.3, body, -0.15, 0.42, 0)); // grain tank
    g.add(box(0.27, 0.02, 0.31, 0xd8aa54, -0.15, 0.56, 0)); // grain showing
    if (robot) g.add(sphere(0.06, 0x2f7fd0, 0.15, 0.5, 0, { emissive: 0x103050 })); else cab(0.16, 0.42, 0.18, 0.24, 0.2);
    g.add(box(0.12, 0.07, 0.8, 0xd8aa54, 0.36, 0.05, 0)); // header
    const reel = mesh(cached('reel', () => new THREE.CylinderGeometry(0.06, 0.06, 0.74, 8)), mat(0xc0392b), 0.4, 0.17, 0);
    reel.rotation.x = Math.PI / 2; g.add(reel);
    const auger = mesh(cached('auger', () => new THREE.CylinderGeometry(0.025, 0.025, 0.4, 6)), mat(body), -0.15, 0.5, 0.3);
    auger.rotation.x = Math.PI / 2 - 0.3; g.add(auger);
    for (const z of [-0.19, 0.19]) { wheel(0.14, z, 0.15, 0.08); wheel(-0.22, z, 0.09); }
    return g;
  }
  if (type === 'grapeHarvester') {
    // tall straddle machine that drives over a vine row
    for (const z of [-0.17, 0.17]) { g.add(box(0.5, 0.42, 0.07, body, 0, 0.12, z)); wheel(0.18, z, 0.1); wheel(-0.18, z, 0.1); }
    g.add(box(0.5, 0.08, 0.42, body, 0, 0.54, 0));
    cab(0.12, 0.62, 0.18, 0.22, 0.18);
    g.add(box(0.18, 0.12, 0.3, 0x5a3a6a, -0.14, 0.62, 0)); // berry bin
    return g;
  }
  // tractor (and its driverless cousin): big rear wheels, small front wheels, long hood, cab
  g.add(box(0.48, 0.08, 0.2, 0x2f2f2f, 0.02, 0.12, 0)); // chassis
  g.add(box(0.26, 0.15, 0.18, body, 0.15, 0.18, 0)); // hood
  g.add(box(0.02, 0.11, 0.14, 0x3a3a3a, 0.285, 0.2, 0)); // grille
  if (robot) { g.add(box(0.2, 0.16, 0.22, body, -0.08, 0.2, 0)); g.add(box(0.06, 0.04, 0.24, 0x2f7fd0, -0.04, 0.37, 0, { emissive: 0x103050 })); }
  else {
    cab(-0.08, 0.2, 0.2, 0.22, 0.24);
    g.add(mesh(cached('exhaust', () => new THREE.CylinderGeometry(0.014, 0.014, 0.2, 6)), mat(0x3a3a3a), 0.22, 0.42, 0.06));
  }
  for (const z of [-0.155, 0.155]) { wheel(-0.1, z, 0.15, 0.08); g.add(box(0.22, 0.025, 0.09, body, -0.1, 0.31, z)); wheel(0.21, z, 0.08, 0.05); }
  return g;
}

/** Market hauling: a dog cart, a horse cart, or (from the Equipment page) a truck. Faces +x. */
export function hauler(kind: 'cart' | 'horse' | 'truck') {
  if (kind === 'truck') return vehicle('truck');
  const g = new THREE.Group(), big = kind === 'horse';
  const wheel = (z: number) => { const w = mesh(cached(`cartwheel${big}`, () => new THREE.CylinderGeometry(big ? 0.14 : 0.1, big ? 0.14 : 0.1, 0.03, 10)), mat(PAL.woodDark), -0.05, big ? 0.14 : 0.1, z); w.rotation.x = Math.PI / 2; g.add(w); };
  const bw = big ? 0.42 : 0.3, bd = big ? 0.3 : 0.22;
  g.add(box(bw, 0.12, bd, PAL.wood, -0.05, big ? 0.16 : 0.12, 0)); // cart bed
  g.add(box(bw * 0.8, 0.1, bd * 0.8, PAL.hay, -0.05, big ? 0.28 : 0.24, 0)); // the load
  wheel(-bd / 2 - 0.02); wheel(bd / 2 + 0.02);
  g.add(box(0.3, 0.02, 0.02, PAL.woodDark, 0.25, big ? 0.22 : 0.16, -0.06), box(0.3, 0.02, 0.02, PAL.woodDark, 0.25, big ? 0.22 : 0.16, 0.06)); // shafts
  if (big) { // horse
    const brown = 0x7a4f2e;
    g.add(box(0.34, 0.16, 0.12, brown, 0.5, 0.26, 0)); g.add(box(0.1, 0.18, 0.08, brown, 0.7, 0.36, 0)); g.add(box(0.12, 0.06, 0.07, brown, 0.76, 0.46, 0));
    for (const [x, z] of [[0.38, -0.04], [0.38, 0.04], [0.62, -0.04], [0.62, 0.04]]) g.add(box(0.035, 0.26, 0.035, 0x3b2a1a, x, 0, z));
  } else { // dog in harness
    const fur = 0xc9a26b;
    g.add(box(0.18, 0.07, 0.07, fur, 0.42, 0.1, 0)); g.add(box(0.07, 0.07, 0.07, fur, 0.53, 0.15, 0)); g.add(box(0.03, 0.04, 0.03, 0x3b2a1a, 0.56, 0.2, 0.025));
    for (const [x, z] of [[0.35, -0.025], [0.35, 0.025], [0.48, -0.025], [0.48, 0.025]]) g.add(box(0.025, 0.08, 0.025, fur, x, 0, z));
  }
  return g;
}

export function animal(a: AnimalId) {
  // the imported cow and sheep are modelled nose-to-tail along z: fit them lengthwise, then turn them to face +x like the rest
  const imported=a==='cows'?artModel('cow',.32,.7,true):a==='sheep'?artModel('sheep',.28,.45,true):null;
  if(imported){
    imported.rotation.y=Math.PI/2;
    imported.traverse((o)=>{o.frustumCulled=false;}); // skinned meshes keep their bind-pose bounds, which three culls wrongly once scaled
    const g=new THREE.Group();g.add(imported);
    Object.assign(g.userData,{clips:imported.userData.clips,rig:imported.userData.rig,play:a==='cows'?'Armature|WalkSlow':'Armature|Idle'});
    return g;
  }
  const g = new THREE.Group();
  if (a === 'chickens') {
    g.add(sphere(0.07, PAL.white, 0, 0.08, 0));
    g.add(sphere(0.04, PAL.white, 0.06, 0.15, 0));
    g.add(box(0.02, 0.03, 0.02, 0xd8482f, 0.07, 0.17, 0));
  } else if (a === 'pigs') {
    const pink = 0xeaa39b, dark = 0xd2837b;
    const body = sphere(0.12, pink, 0, 0.16, 0); body.scale.set(1.45, 0.95, 1); g.add(body);
    g.add(sphere(0.085, pink, 0.17, 0.18, 0));
    g.add(box(0.04, 0.055, 0.07, dark, 0.255, 0.15, 0)); // snout
    for (const z of [-0.045, 0.045]) g.add(box(0.035, 0.045, 0.03, dark, 0.16, 0.25, z)); // ears
    for (const [x, z] of [[-0.1, -0.06], [-0.1, 0.06], [0.1, -0.06], [0.1, 0.06]]) g.add(box(0.04, 0.08, 0.04, dark, x, 0, z));
    g.add(box(0.03, 0.03, 0.03, dark, -0.18, 0.2, 0)); // tail
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
/** Stylised low-poly scenery tree in the farm's palette. `kind` 0 = leafy (seasonal crown), 1 = evergreen pine. */
export function tree(scale: number, crown: THREE.Material, kind = 0) {
  const g = new THREE.Group();
  if (kind === 1) {
    g.add(mesh(cached('pineTrunk', () => new THREE.CylinderGeometry(0.05, 0.08, 0.35, 6)), mat(PAL.woodDark), 0, 0.17, 0));
    const pine = mat(0x3f6b45, { rough: 0.95 });
    for (const [r, h, y] of [[0.42, 0.55, 0.55], [0.33, 0.48, 0.85], [0.22, 0.4, 1.12]] as const)
      g.add(mesh(cached(`pine${r}`, () => new THREE.ConeGeometry(r, h, 7)), pine, 0, y, 0));
  } else {
    g.add(mesh(cached('trunk2', () => new THREE.CylinderGeometry(0.06, 0.1, 0.6, 6)), mat(PAL.woodDark), 0, 0.3, 0));
    for (const [r, x, y, z] of [[0.4, 0, 0.85, 0], [0.28, 0.24, 0.72, 0.1], [0.26, -0.2, 0.75, -0.12]] as const) {
      const c = mesh(cached(`crown${r}`, () => new THREE.IcosahedronGeometry(r, 1)), crown, x, y, z);
      c.userData.crown = true;
      g.add(c);
    }
  }
  g.scale.setScalar(scale);
  return g;
}

export { cached, cyl, mesh };

/** Civic housing keeps the farm's materials while making density visible. */
export function buildCommunityHome(tier: string, w: number, d: number, key = ''): Model {
  const group = new THREE.Group(), windows: THREE.Mesh[] = [], smoke: THREE.Vector3[] = [];
  const seed = hashStr(key);
  if (tier === 'cottage') cottage(group, w, d, seed);
  else if (tier === 'terrace') {
    // a row of three narrow two-storey houses under one roof, each painted differently
    group.add(box(w - 0.1, 0.04, d - 0.1, PAL.stone, w / 2, 0, d / 2, { rough: 1 }));
    const uw = (w - 0.4) / 3, x0 = 0.2, z0 = 0.5, hd = 1.5, wallH = 1.6;
    for (let i = 0; i < 3; i++) {
      const cx = x0 + uw * (i + 0.5), wall = WALLS[Math.floor(hashStr(key + i) * WALLS.length)];
      group.add(box(uw, wallH, hd, wall, cx, 0, z0 + hd / 2));
      group.add(box(0.26, 0.55, 0.04, PAL.door, cx - uw * 0.2, 0, z0 + hd + 0.01));
      for (const [wx, wy] of [[cx + uw * 0.2, 0.45], [cx - uw * 0.2, 1.05], [cx + uw * 0.2, 1.05]]) { const win = box(0.24, 0.26, 0.03, PAL.window, wx, wy, z0 + hd + 0.01); win.userData.window = true; group.add(win); }
      if (i < 2) smoke.push(chimney(group, x0 + uw * (i + 1), z0 + 0.5, wallH + 0.3, 0.45));
    }
    group.add(gable(w - 0.4, hd, 0.7, ROOFS[Math.floor(seed * ROOFS.length)], w / 2, wallH, z0 + hd / 2));
    group.add(box(w - 0.3, 0.18, 0.06, PAL.white, w / 2, 0, d - 0.15));
  } else {
    // apartments: a four-storey block with balconies, an entrance canopy, a parapet and a water tank
    const wall = [0xd8cfc0, 0xc9b49a, 0xbfc6c9, 0xd6c2a8][Math.floor(seed * 4)], bw = w - 0.6, bd = d - 1.2, floors = 4, fh = 0.78, cx = w / 2, cz = 0.4 + bd / 2;
    group.add(box(w - 0.1, 0.05, d - 0.1, PAL.stone, w / 2, 0, d / 2, { rough: 1 }));
    group.add(box(bw, floors * fh, bd, wall, cx, 0, cz));
    group.add(box(bw + 0.1, 0.18, bd + 0.1, PAL.stoneDark, cx, floors * fh, cz)); // parapet
    group.add(box(bw - 0.12, 0.04, bd - 0.12, PAL.roofGrey, cx, floors * fh + 0.12, cz));
    group.add(cyl(0.22, 0.4, PAL.metalDark, cx + bw / 2 - 0.4, floors * fh + 0.14, cz - 0.2, 10)); // water tank
    const front = cz + bd / 2 + 0.01;
    for (let f = 0; f < floors; f++) for (let c = 0; c < 4; c++) {
      const x = cx - bw / 2 + (c + 0.5) * (bw / 4);
      if (f === 0 && c === 1) continue; // the entrance
      const win = box(0.32, 0.36, 0.03, PAL.window, x, f * fh + 0.25, front); win.userData.window = true; group.add(win);
      if (f > 0 && c % 2 === 0) { group.add(box(0.5, 0.05, 0.22, PAL.stone, x, f * fh + 0.18, front + 0.1)); group.add(box(0.5, 0.16, 0.02, PAL.metalDark, x, f * fh + 0.23, front + 0.21)); } // balcony
    }
    const ex = cx - bw / 2 + 1.5 * (bw / 4);
    group.add(box(0.4, 0.6, 0.04, PAL.door, ex, 0, front));
    group.add(box(0.7, 0.05, 0.4, PAL.roofGrey, ex, 0.68, front + 0.18)); // canopy
    for (const x of [0.35, w - 0.35]) group.add(sphere(0.25, 0x5f8f4a, x, 0.25, d - 0.4));
  }
  group.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.userData.window && !windows.includes(o as THREE.Mesh)) windows.push(o as THREE.Mesh); });
  return { group, smoke, windows };
}

/** Small civic landmarks use the farm palette and shared geometry caches. */
export function buildCivic(type: string, w: number, d: number): Model {
  const group = new THREE.Group(), windows: THREE.Mesh[] = [];
  group.add(box(w-.1,.08,d-.1,PAL.stone,w/2,0,d/2));
  if(type==='lighting'){
    for(const x of [.5,w-.5]){const bulb=sphere(.18,0xffd889,x+.5,2.4,d/2,{emissive:0x806020});windows.push(bulb);group.add(box(.1,2.5,.1,PAL.roofGrey,x,0,d/2),box(.7,.1,.1,PAL.roofGrey,x+.25,2.5,d/2),bulb);}
  } else if(type==='sanitation'){
    group.add(cyl(.85,.65,PAL.stone,w/2,.1,d/2),cyl(.75,.04,0x65a8bb,w/2,.78,d/2),box(1.8,.08,.15,PAL.roofGrey,w/2,.9,d/2));
  } else if(type==='watchtower'){
    for(const [x,z] of [[.6,.6],[w-.6,.6],[.6,d-.6],[w-.6,d-.6]])group.add(box(.14,3,.14,PAL.wood,x,.1,z));
    group.add(box(w-.6,.12,d-.6,PAL.wood,w/2,3,d/2),box(w-.6,.4,.08,PAL.wood,w/2,3.1,.55),box(w-.6,.4,.08,PAL.wood,w/2,3.1,d-.55));
    group.add(gable(w-.4,d-.4,.7,PAL.barnRed,w/2,3.5,d/2));
    const fire=sphere(.14,0xffb055,w/2,3.35,d/2,{emissive:0x804010});windows.push(fire);group.add(fire);
  } else if(type==='waterTower'){
    for(const [x,z] of [[w/2-.6,d/2-.6],[w/2+.6,d/2-.6],[w/2-.6,d/2+.6],[w/2+.6,d/2+.6]])group.add(box(.1,2.4,.1,PAL.metalDark,x,.1,z));
    group.add(cyl(.85,.9,0x7fa7c4,w/2,2.5,d/2,16),cone(.9,.4,PAL.roofGrey,w/2,3.4,d/2,16));
    group.add(box(.06,2.4,.06,PAL.metal,w/2,.1,d/2)); // feed pipe
  } else if(type==='road') {
    group.add(box(w-.1,.05,d-.1,PAL.roofGrey,w/2,.09,d/2));
    for(let i=0;i<Math.min(18,Math.ceil(d/2));i++)group.add(box(.06,.02,.4,PAL.white,w/2,.15,.4+i*2));
    group.add(box(.08,1.8,.08,PAL.wood,.2,.1,.5),sphere(.16,0xffd889,.2,2,.5,{emissive:0x806020}));
  } else if(type==='well'||type==='waterworks') {
    group.add(cyl(type==='well'?.55:1,1,PAL.creamDark,w/2,.1,d/2));
    group.add(cyl(type==='well'?.42:.85,.04,0x65a8bb,w/2,1.1,d/2));
    group.add(box(.12,1,.12,PAL.wood,w/2-.6,1,d/2),box(.12,1,.12,PAL.wood,w/2+.6,1,d/2));
    group.add(gable(1.6,1.3,.5,PAL.roofBlue,w/2,2,d/2));
  } else if(type==='park') {
    const a=tree(.7,mat(PAL.roofGreen));a.position.set(w/2,0,d/2);group.add(a);
    group.add(box(1,.12,.35,PAL.wood,w/2,.35,d-.5));
  } else {
    shed(group,w-.4,d-.6,1.6,PAL.cream,type==='school'?PAL.roofGreen:PAL.roofBlue,.2,.2,{door:'house',windows:3});
    if(type==='clinic'||type==='hospital')group.add(box(.65,.13,.1,PAL.barnRed,w/2,1.55,d-.35),box(.13,.65,.1,PAL.barnRed,w/2,1.3,d-.35));
    if(type==='school') {
      group.add(box(.8,.45,.12,PAL.wood,w/2,1.2,d-.35));
      group.add(box(.28,.34,.02,PAL.white,w/2-.15,1.25,d-.27),box(.28,.34,.02,PAL.creamDark,w/2+.15,1.25,d-.27));
    }
    if(type==='barracks'){group.add(box(.06,2.6,.06,PAL.wood,w-.3,.1,.3),box(.7,.4,.03,PAL.barnRed,w-.65,2.4,.3));}
    if(type==='police')group.add(box(.5,.6,.08,PAL.roofBlue,w/2,1.2,d-.3),box(.12,.4,.1,PAL.cream,w/2,1.3,d-.25));
    if(type==='hall') {group.add(box(.08,1.6,.08,PAL.wood,w-.4,2,.5),box(.5,.3,.06,PAL.roofGreen,w-.15,3,.5));}
  }
  group.traverse(o=>{if((o as THREE.Mesh).isMesh&&o.userData.window&&!windows.includes(o as THREE.Mesh))windows.push(o as THREE.Mesh);});
  return {group,windows,smoke:[]};
}
