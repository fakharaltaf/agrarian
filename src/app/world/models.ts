// Stylised low-poly models, built from simple shapes in a shared palette so everything belongs together.
// 1 world unit = 1 tile. Models sit on y = 0 with their footprint starting at (0, 0).
import * as THREE from 'three';
import type { AnimalId, MachineType } from '../../simulation/config';
import type { Lot } from './layout';
import { artFigure, artModel, recolor, type ArtId } from './art';

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

/** An imported prop fitted into a w×d footprint centred at (x, z), turned by rot. Null until the art has loaded. */
function prop(g: THREE.Group, id: ArtId, w: number, d: number, x: number, z: number, rot = 0) {
  const m = artModel(id, w, d, true);
  if (m) { m.position.set(x, 0, z); m.rotation.y = rot; g.add(m); }
  return m;
}

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
function shed(g: THREE.Group, w: number, d: number, wallH: number, wall: number, roof: number, x: number, z: number, opts: { door?: 'barn' | 'house' | 'roller'; windows?: number; roofH?: number; doorH?: number } = {}) {
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
    const dh = opts.doorH ?? wallH * 0.55; // a door stays door-sized on a tall building
    g.add(box(0.36, dh + 0.05, 0.03, trim, x + w / 2, 0.1, front));
    g.add(box(0.28, dh, 0.04, PAL.door, x + w / 2, 0.1, front));
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

/** Rows of windows on a storeyed front (one row per floor), leaving room for the door on the ground floor. */
function windowRows(g: THREE.Group, x0: number, x1: number, front: number, floors: number, perRow: number, floorH: number, y0 = 0.35) {
  const door = (x0 + x1) / 2;
  for (let f = 0; f < floors; f++) for (let i = 0; i < perRow; i++) {
    const x = x0 + ((i + 0.5) / perRow) * (x1 - x0);
    if (f === 0 && Math.abs(x - door) < 0.3) continue;
    const win = box(0.24, 0.26, 0.03, PAL.window, x, y0 + f * floorH, front + 0.01); win.userData.window = true; g.add(win);
    g.add(box(0.3, 0.03, 0.06, PAL.white, x, y0 + f * floorH - 0.03, front + 0.03)); // sill
  }
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
/** A steady choice of one in n from a key, taken from the hash's low digits so keys that differ by one character still spread out. */
const pick = (key: string, n: number) => Math.floor(hashStr(key) * 1e6) % n;
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
export function buildLot(type: Lot['type'], w: number, d: number, variant = '', level = 1): Model {
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
      if (level <= 2) { // the homestead's farmhouse; in the market town it gains a roofed porch, flower boxes and a picket fence
        shed(g, 2.2, 1.6, 1.5, PAL.cream, PAL.roofRed, 0.4, 0.5, { door: 'house', windows: 3 });
        g.add(box(0.9, 0.05, 0.5, PAL.wood, 1.5, 0.05, 2.3)); // porch
        smoke.push(chimney(g, 0.75, 0.9, 1.5, 0.9));
        g.add(sphere(0.32, 0x5f8f4a, 2.85, 0.32, 2.6)); // garden shrub
        if (level === 2) {
          g.add(box(1.0, 0.05, 0.6, PAL.roofRed, 1.5, 0.95, 2.35), box(0.05, 0.9, 0.05, PAL.white, 1.05, 0.05, 2.6), box(0.05, 0.9, 0.05, PAL.white, 1.95, 0.05, 2.6));
          for (const x of [0.75, 2.25]) { g.add(box(0.3, 0.07, 0.08, PAL.woodDark, x, 0.62, 2.14)); for (const dx of [-0.09, 0, 0.09]) g.add(sphere(0.045, [0xc94c4c, 0xe7a23b, 0xd673a4][Math.round((dx + 0.09) / 0.09)], x + dx, 0.72, 2.14)); }
          for (let i = 0; i < 9; i++) if (i !== 4) g.add(box(0.05, 0.3, 0.03, PAL.white, 0.3 + i * 0.3, 0.05, 2.88)); g.add(box(2.5, 0.03, 0.03, PAL.white, 1.5, 0.25, 2.88));
        }
        break;
      }
      { // from the farm business on: a second storey, then a wing, a turret, a columned front, and at last a three-storey mansion
        const tall = level >= 7, wallH = tall ? 2.9 : 2.2, bw = level >= 6 ? 2.5 : 2.2, bd = 1.6, x0 = level >= 4 ? 0.15 : 0.4, z0 = 0.4, cx = x0 + bw / 2, front = z0 + bd;
        const wall = level >= 6 ? 0xf4efe2 : PAL.cream, roofC = level >= 6 ? 0x7a4a3e : PAL.roofRed;
        g.add(box(bw + 0.06, 0.12, bd + 0.06, PAL.stoneDark, cx, 0, z0 + bd / 2), box(bw, wallH - 0.1, bd, wall, cx, 0.1, z0 + bd / 2), gable(bw, bd, 0.7, roofC, cx, wallH, z0 + bd / 2), box(bw + 0.3, 0.05, 0.08, 0x3a2a22, cx, wallH + 0.69, z0 + bd / 2));
        g.add(box(bw + 0.05, 0.05, bd + 0.05, PAL.white, cx, wallH - 0.06, z0 + bd / 2));
        const floors = tall ? 3 : 2;
        for (let f = 0; f < floors; f++) for (let i = 0; i < 4; i++) { const x = x0 + (i + 0.5) * (bw / 4), y = 0.42 + f * 0.82; if (f === 0 && (i === 1 || i === 2)) continue; g.add(box(0.32, 0.38, 0.02, PAL.white, x, y - 0.04, front + 0.005)); glassWin(g, 0.24, 0.3, x, y, front + 0.012); g.add(box(0.07, 0.36, 0.02, 0x4f7a52, x - 0.2, y - 0.03, front + 0.01), box(0.07, 0.36, 0.02, 0x4f7a52, x + 0.2, y - 0.03, front + 0.01)); }
        for (let f = 0; f < floors; f++) glassWin(g, 0.3, 0.3, x0 + bw + 0.012, 0.42 + f * 0.82, z0 + bd / 2, true);
        g.add(box(0.5, 0.68, 0.04, PAL.door, cx, 0.1, front + 0.01), box(0.6, 0.06, 0.06, PAL.white, cx, 0.8, front + 0.02));
        smoke.push(chimney(g, x0 + 0.35, z0 + 0.5, wallH + 0.2, 0.9)); if (level >= 5) smoke.push(chimney(g, x0 + bw - 0.35, z0 + 0.5, wallH + 0.2, 0.9));
        // veranda (farm business), then a columned portico with a balcony (town and city)
        if (level < 6) g.add(box(bw - 0.2, 0.06, 0.5, PAL.wood, cx, 0.08, front + 0.27), box(bw - 0.1, 0.05, 0.6, roofC, cx, 0.98, front + 0.3), ...[0, 1, 2, 3].map((i) => box(0.05, 0.86, 0.05, PAL.white, x0 + 0.15 + i * ((bw - 0.3) / 3), 0.12, front + 0.52)));
        else { for (const dx of [-0.5, -0.17, 0.17, 0.5]) g.add(cyl(0.05, 1.5, PAL.white, cx + dx, 0.12, front + 0.45, 10)); g.add(box(1.3, 0.1, 0.55, PAL.white, cx, 1.62, front + 0.25), box(1.3, 0.2, 0.03, PAL.white, cx, 1.72, front + 0.5), box(1.4, 0.08, 0.6, PAL.stone, cx, 0.04, front + 0.28)); const ped = gable(0.12, 1.3, 0.3, wall, cx, 1.92, front + 0.3); ped.rotation.y = Math.PI / 2; if (tall) g.add(ped); }
        if (level >= 4) { // a side wing
          const wx = x0 + bw + 0.02, ww = w - wx - 0.15; g.add(box(ww, 1.3, 1.2, wall, wx + ww / 2, 0.05, z0 + 0.7), gable(ww, 1.2, 0.5, roofC, wx + ww / 2, 1.35, z0 + 0.7)); glassWin(g, Math.min(0.5, ww - 0.2), 0.36, wx + ww / 2, 0.5, z0 + 1.31);
        }
        if (level >= 5) { // a round turret at the back corner
          g.add(cyl(0.36, wallH + 0.5, wall, x0 + 0.1, 0.05, z0 + 0.1, 12), cone(0.44, 0.7, roofC, x0 + 0.1, wallH + 0.55, z0 + 0.1, 12)); glassWin(g, 0.03, 0.3, x0 - 0.27, wallH - 0.2, z0 + 0.1, true);
        }
        // the garden grows with the house: hedges, then a lamp, then a fountain
        for (const x of [0.4, w - 0.4]) g.add(box(0.6, 0.24, 0.2, 0x5f8f4a, x, 0.05, d - 0.25));
        if (level >= 5) lampPost(g, cx + 0.9, d - 0.3, 0.8);
        if (level >= 6) g.add(cyl(0.26, 0.12, PAL.stone, cx, 0.05, d - 0.3, 12), cyl(0.2, 0.03, 0x7fb6d6, cx, 0.17, d - 0.3, 12), cyl(0.04, 0.3, PAL.stone, cx, 0.17, d - 0.3, 8));
        if (tall) g.add(box(0.03, 0.9, 0.03, PAL.metalDark, cx, wallH + 0.7, z0 + bd / 2), box(0.36, 0.22, 0.02, PAL.barnRed, cx + 0.2, wallH + 1.4, z0 + bd / 2));
      }
      break;
    case 'shed':
      if (variant === 'market' && artModel('stall', 1, 1)) { // village trader: a market stall with crates, sacks and a barrel
        g.add(box(w - 0.1, 0.04, d - 0.1, PAL.stone, w / 2, 0, d / 2, { rough: 1 }));
        prop(g, 'stall', 1.5, 1.3, w / 2 + 0.2, 0.8);
        prop(g, 'crate', 0.32, 0.32, 0.35, d - 0.4, 0.3); prop(g, 'crate', 0.26, 0.26, 0.38, d - 0.75, -0.2);
        prop(g, 'sacks', 0.45, 0.4, 0.85, d - 0.35); prop(g, 'barrel', 0.3, 0.3, w - 0.3, d - 0.35);
        break;
      }
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
      if (level > 1) { // the barn makes room for a machine lean-to (level 2), then steel grain bins (level 3)
        if (!prop(g, 'barn', w - 1.0, d - 0.1, (w - 1.0) / 2 + 0.05, d / 2)) shed(g, w - 1.2, 1.6, 1.4, PAL.barnRed, PAL.roofGrey, 0.1, 0.2, { door: 'barn', windows: 1, roofH: 0.95 });
        if (level === 2) {
          g.add(box(0.8, 0.85, d - 0.5, 0x8c979b, w - 0.5, 0, d / 2 - 0.05)); leanTo(g, 0.8, d - 0.4, 1.0, 0.75, PAL.roofGrey, w - 0.9, 0.2);
          g.add(box(0.6, 0.6, 0.04, PAL.metalDark, w - 0.5, 0, d - 0.29)); // open machine bay
          for (const z of [0.35, 0.65]) g.add(box(0.28, 0.2, 0.22, PAL.hay, w - 0.25, 0, d - z + 0.25));
        } else { silo(g, w - 0.48, 0.55, 0.4, 2.0); silo(g, w - 0.48, d - 0.5, 0.4, 1.7); g.add(box(0.1, 0.1, d - 1.0, PAL.metalDark, w - 0.48, 1.75, d / 2)); }
        break;
      }
      shed(g, 2.6, 1.6, 1.4, PAL.barnRed, PAL.roofGrey, 0.2, 0.2, { door: 'barn', windows: 2, roofH: 0.95 });
      for (const [hx, hz] of [[2.75, 1.95], [2.55, 1.85]]) g.add(box(0.3, 0.22, 0.2, PAL.hay, hx, 0, hz));
      break;
    case 'silo':
      if (level > 1) { // the old silo gets steel company: a second bin and a catwalk, then a bucket elevator over three bins
        if (level === 3) { silo(g, 0.5, 1.5, 0.38, 2.3); g.add(box(0.26, 3.3, 0.26, 0xc0392b, 0.45, 0, 0.45)); g.add(box(0.36, 0.3, 0.36, PAL.metalDark, 0.45, 3.3, 0.45));
          for (const [x, z] of [[1.5, 0.5], [0.5, 1.5]]) { const sp = box(0.06, 0.06, Math.hypot(x - 0.45, z - 0.45) + 0.1, PAL.metal, (x + 0.45) / 2, 2.9, (z + 0.45) / 2); sp.lookAt(x, 2.6, z); g.add(sp); } } // a bucket elevator with spouts to the bins
        silo(g, level === 3 ? 1.5 : 0.6, level === 3 ? 0.5 : 0.6, 0.42, level === 2 ? 2.1 : 2.4);
        if (!prop(g, 'silo', 1.2, 1.2, 1.3, 1.3)) silo(g, 1.4, 1.4, 0.42, 2.3); // the old silo in front
        if (level === 2) g.add(box(0.12, 0.05, 1.1, PAL.metalDark, 1.0, 2.15, 1.0)); // catwalk
        break;
      }
      silo(g, 0.6, 0.7); silo(g, 1.4, 1.2, 0.4, 2.1);
      break;
    case 'coldStore': {
      const wallH = [1.2, 1.45, 1.7][level - 1] ?? 1.2; // each level stacks the racks higher and adds a cooling unit
      shed(g, 2.6, 1.6, wallH, PAL.white, PAL.roofBlue, 0.2, 0.2, { door: 'roller', roofH: 0.4 });
      for (let i = 0; i < level; i++) g.add(box(0.45, 0.3, 0.3, PAL.metal, 2.3 - i * 0.6, wallH + 0.2, 0.9)); // cooling units
      for (let i = 0; i < 9; i++) g.add(box(0.03, wallH - 0.15, 0.02, 0xd9dcdc, 0.35 + i * 0.29, 0.12, 1.82)); // ribbed cladding
      g.add(box(2.6, 0.3, 0.35, PAL.stoneDark, 1.5, 0, 2.0)); // loading dock
      if (level === 3) g.add(box(0.35, 0.5, 0.25, 0x6a7a86, 0.45, 0, 2.0)); // backup generator
      break;
    }
    case 'warehouse':
    case 'distribution': {
      const wallH = [1.5, 1.9, 2.3][level - 1] ?? 1.5;
      pad();
      shed(g, w - 0.4, d - 0.6, wallH, type === 'warehouse' ? 0xd7d2c4 : 0xc9d6df, type === 'warehouse' ? PAL.roofGrey : PAL.roofBlue, 0.2, 0.2, { door: 'roller', windows: 3, roofH: 0.5 });
      if (level > 1) for (let i = 0; i < level + 1; i++) g.add(cyl(0.12, 0.22, PAL.metal, 0.9 + i * ((w - 1.8) / level), wallH + 0.4, (d - 0.6) / 2 + 0.2, 8)); // roof vents
      if (type === 'distribution') for (let i = 0; i < level; i++) g.add(box(1.0, 0.6, 0.5, [0x3f6f9a, 0xb0603a, 0x5c8a4a][i], w - 1.0 - i * 1.25, 0, d - 0.3)); // a lorry per level
      g.add(box(w - 1.2, 0.28, 0.35, PAL.stoneDark, w / 2, 0, d - 0.2)); // loading dock
      [0xd8aa54, 0x9a6b44, 0xc9b49a].forEach((c, i) => pallet(g, 0.6 + i * 0.45, d - 0.35, c));
      if (level === 3 && type === 'warehouse') { g.add(box(0.3, 0.25, 0.4, 0xe0b23a, 2.4, 0, d - 0.3), box(0.04, 0.5, 0.04, PAL.metalDark, 2.4, 0.25, d - 0.12)); pallet(g, 3.4, d - 0.35, 0xd8aa54); pallet(g, 3.85, d - 0.35, 0x9a6b44); } // forklift and more stock
      break;
    }
    case 'flourMill': {
      if (level === 3) { // a roller mill: a concrete mill house with its own grain bin, loud and busy
        pad();
        g.add(box(1.25, 2.5, 1.0, 0xd9d4c7, 0.75, 0, 0.75), box(1.33, 0.1, 1.08, PAL.metalDark, 0.75, 2.5, 0.75));
        for (let f = 0; f < 3; f++) for (let i = 0; i < 3; i++) { const win = box(0.2, 0.22, 0.03, PAL.window, 0.4 + i * 0.35, 0.45 + f * 0.75, 1.26); win.userData.window = true; g.add(win); }
        g.add(box(0.5, 0.6, 0.04, PAL.metalDark, 0.75, 0, 1.27));
        silo(g, 1.62, 0.5, 0.3, 2.3);
        const belt = box(0.12, 0.08, 1.1, PAL.metal, 1.62, 2.0, 1.1); belt.rotation.x = 0.5; g.add(belt);
        g.add(box(0.5, 0.35, 0.4, 0x3f6f9a, 1.6, 0, 1.65)); // flour lorry
        smoke.push(new THREE.Vector3(0.45, 2.75, 0.5));
        break;
      }
      if (level === 2) { // the windmill keeps turning, with a brick engine house and its chimney beside it
        if (!prop(g, 'mill', 1.5, 1.5, 0.75, 1.2)) { g.add(cyl(0.55, 2.0, PAL.stone, 0.7, 0, 1.3, 10, 0.45)); g.add(cone(0.52, 0.6, PAL.roofBrown, 0.7, 2.0, 1.3, 10)); }
        shed(g, 0.75, 0.7, 0.9, PAL.brick, PAL.roofGrey, 1.15, 0.1, { door: 'house', windows: 1, roofH: 0.35 }); // the engine house behind
        smoke.push(chimney(g, 1.8, 0.3, 0.9, 1.0));
        break;
      }
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
      if (level === 3) { // a bakery works: a tall insulated hall, two steel oven flues and a delivery van
        pad();
        shed(g, 1.7, 1.3, 1.6, PAL.cream, PAL.roofBlue, 0.15, 0.2, { door: 'roller', windows: 2, roofH: 0.35 });
        for (const x of [0.5, 1.0]) { g.add(cyl(0.09, 0.8, PAL.metal, x, 1.75, 0.55, 8)); smoke.push(new THREE.Vector3(x, 2.6, 0.55)); }
        g.add(box(0.6, 0.4, 0.3, PAL.white, 1.45, 0, 1.82), box(0.2, 0.25, 0.3, 0x3f6f9a, 1.05, 0, 1.82));
        break;
      }
      pad(PAL.creamDark);
      shed(g, 1.6, 1.4, 1.2, PAL.brick, PAL.roofBrown, 0.2, 0.3, { door: 'house', windows: 2 });
      smoke.push(chimney(g, 0.5, 0.7, 1.2, 0.9));
      awning(g, 1.5, 0.25, 0.95, 1.5);
      g.add(box(0.6, 0.35, 0.25, PAL.wood, 1.45, 0, 1.95)); for (let i = 0; i < 3; i++) g.add(sphere(0.07, 0xc68a4e, 1.25 + i * 0.2, 0.42, 1.95)); // bread on the stall
      if (level === 2) { smoke.push(chimney(g, 1.45, 0.6, 1.2, 0.9)); g.add(box(0.4, 0.3, 0.3, 0x5c8a4a, 0.45, 0, 1.85)); } // a second oven and a delivery cart
      break;
    case 'feedMill':
      { const th = [2.6, 3.1, 3.6][level - 1] ?? 2.6; // the mixing tower grows and more bins line up
      shed(g, 1.8, 1.5, 1.3, 0xd8c9a0, PAL.roofGrey, 0.2, 0.3, { door: 'roller' });
      g.add(box(0.5, th, 0.5, 0xd8c9a0, 2.4, 0, 0.8));
      g.add(gable(0.5, 0.5, 0.3, PAL.roofGrey, 2.4, th, 0.8));
      silo(g, 2.5, 1.6, 0.25, 1.5);
      if (level > 1) silo(g, 2.78, 0.28, 0.2, 1.6);
      if (level === 3) { silo(g, 2.05, 1.7, 0.22, 1.5); const belt = box(0.1, 0.08, 1.1, PAL.metal, 1.75, 1.75, 0.8); belt.rotation.z = Math.PI / 2; belt.rotation.y = Math.PI / 2; g.add(belt); }
      break; }
    case 'ranch':
    case 'dairy':
      shed(g, 2.4, 1.4, level === 3 ? 1.5 : 1.2, type === 'dairy' ? PAL.white : PAL.barnRed, PAL.roofGrey, w - 2.6, 0.2, { door: 'barn', windows: 2 });
      if (level > 1) silo(g, w - 0.38, d - 0.45, 0.28, 1.9); // a feed silo, then a second and a water tank
      if (level === 3) { silo(g, w - 1.0, d - 0.45, 0.28, 1.7); g.add(cyl(0.3, 0.55, type === 'dairy' ? PAL.metal : 0x4f6b45, w - 1.85, 0, d - 0.45, 12)); }
      fenceRect(g, w - 3, d - 0.4, 0.15, 0.2);
      pen = { x0: 0.4, z0: 0.4, x1: w - 3.1, z1: d - 0.4 };
      break;
    case 'creamery':
      pad();
      shed(g, 1.8, 1.4, [1.2, 1.4, 1.6][level - 1] ?? 1.2, PAL.white, PAL.roofBlue, 0.2, 0.3, { door: 'house' });
      g.add(cyl(0.3, [1.2, 1.6, 2.0][level - 1] ?? 1.2, PAL.metal, 2.5, 0, 0.8, 12)); // the milk silo grows
      if (level > 1) g.add(cyl(0.17, level === 3 ? 1.7 : 1.3, PAL.metal, 2.8, 0, 0.3, 10));
      if (level === 3) g.add(cyl(0.17, 1.5, PAL.metal, 2.2, 0, 0.25, 10));
      smoke.push(chimney(g, 0.4, 0.6, 1.2, 0.6));
      for (let i = 0; i < 3; i++) { g.add(cyl(0.08, 0.22, PAL.metal, 2.2 + i * 0.2, 0, 1.75, 10)); g.add(cyl(0.05, 0.05, PAL.metalDark, 2.2 + i * 0.2, 0.22, 1.75, 8)); } // milk churns
      break;
    case 'oilPress':
      { const wh = [1.2, 1.4, 1.6][level - 1] ?? 1.2, th = [1.1, 1.5, 1.9][level - 1] ?? 1.1;
      shed(g, 1.8, 1.4, wh, 0xd9c48a, PAL.roofBrown, 0.2, 0.3, { door: 'roller' });
      g.add(cyl(0.32, th, 0xd9b95b, 2.4, 0, 0.6, 12)); g.add(cyl(0.32, th, 0xd9b95b, 2.4, 0, 1.4, 12)); // oil tanks, taller with each level
      smoke.push(chimney(g, 1.6, 0.6, wh, 0.7));
      if (level === 3) { smoke.push(chimney(g, 0.6, 0.6, wh, 0.9)); g.add(box(0.7, 0.08, 0.08, PAL.metalDark, 2.4, th, 1.0)); } }
      barrel(g, 2.3, 1.95, 0xd9b95b); barrel(g, 2.6, 1.95, 0xd9b95b);
      break;
    case 'sugarMill':
      { const ch = [2.6, 3.1, 3.6][level - 1] ?? 2.6;
      shed(g, 2.4, 1.5, [1.3, 1.5, 1.7][level - 1] ?? 1.3, PAL.stone, PAL.roofGrey, 0.2, 0.3, { door: 'roller' });
      g.add(cyl(0.18, ch, PAL.brick, 2.75, 0, 0.6, 8));
      smoke.push(new THREE.Vector3(2.75, ch + 0.1, 0.6));
      if (level === 3) { g.add(cyl(0.15, ch - 0.4, PAL.brick, 2.75, 0, 1.2, 8)); smoke.push(new THREE.Vector3(2.75, ch - 0.3, 1.2)); } } // a second boiler stack
      for (let i = 0; i < 6; i++) { const cane = cyl(0.03, 0.7, 0x8fae4a, 0, 0, 0, 5); cane.rotation.z = Math.PI / 2; cane.position.set(2.4, 0.04 + Math.floor(i / 3) * 0.06, 1.75 + (i % 3) * 0.07); g.add(cane); } // cut cane
      break;
    case 'biogas': // two concrete digesters under green gas-holder domes, a pipe rack, a flare stack and a manure pit
      pad();
      for (const [x, z, r] of [[0.85, 0.85, 0.62], [2.15, 1.25, 0.5]] as const) {
        g.add(cyl(r, 0.55, 0xb9b3a6, x, 0, z, 16));
        const dome = mesh(cached(`dome${r}`, () => new THREE.SphereGeometry(r * 0.98, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), mat(0x4f6b45, { rough: 0.7 }), x, 0.55, z);
        g.add(dome);
        g.add(box(r * 2 + 0.04, 0.04, 0.04, PAL.stoneDark, x, 0.5, z));
      }
      g.add(box(1.4, 0.06, 0.06, PAL.metal, 1.5, 0.35, 1.05)); // gas pipe between them
      g.add(cyl(0.05, 1.7, PAL.metalDark, 2.7, 0, 2.5, 8), cyl(0.09, 0.12, 0x3a3a3a, 2.7, 1.7, 2.5, 8)); // flare stack
      g.add(box(1.1, 0.05, 0.7, 0x6e5537, 0.85, 0.02, 2.3), box(1.2, 0.18, 0.06, PAL.stone, 0.85, 0, 1.95)); // manure pit
      smoke.push(new THREE.Vector3(2.7, 1.9, 2.5));
      if (level > 1) { g.add(box(0.9, 0.5, 0.42, 0x4f6b45, 2.35, 0.05, 0.35), box(0.06, 0.3, 0.06, PAL.metalDark, 2.6, 0.55, 0.3)); } // a gas engine in its container
      if (level === 3) { g.add(cyl(0.38, 0.45, 0xb9b3a6, 1.95, 0.05, 2.35, 14)); g.add(mesh(cached('dome0.37', () => new THREE.SphereGeometry(0.37, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2)), mat(0x4f6b45, { rough: 0.7 }), 1.95, 0.5, 2.35)); } // a third digester
      break;
    case 'solar': { // a small array, then a full field, then a dense field with a battery store
      const rows = level === 1 ? 2 : 3, cols = level === 3 ? 4 : 4, h = level === 3 ? 0.6 : 0.45;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const p = box(level === 3 ? 1.05 : 0.95, 0.04, 0.6, PAL.solar, 0.7 + c * 1.15, h, 0.5 + r * 0.9, { rough: 0.3, metal: 0.5 });
        p.rotation.x = -0.45;
        g.add(p);
        g.add(box(0.05, h, 0.05, PAL.metalDark, 0.7 + c * 1.15, 0, 0.5 + r * 0.9));
      }
      if (level > 1) g.add(box(0.35, 0.5, 0.3, PAL.white, w - 0.25, 0, d - 0.35)); // inverter cabinet
      if (level === 3) g.add(box(0.35, 0.55, 1.2, 0xdcdcd2, w - 0.25, 0, 0.9), box(0.37, 0.04, 1.22, PAL.metalDark, w - 0.25, 0.55, 0.9)); // battery store
      break;
    }
    case 'windTurbine': {
      const th = [3.6, 4.4, 5.2][level - 1] ?? 3.6, bl = [1.5, 1.9, 2.3][level - 1] ?? 1.5; // taller towers and longer blades catch more wind
      g.add(box(1.2, 0.1, 1.2, PAL.stone, 1, 0, 1)); // foundation
      g.add(cyl(0.14 + level * 0.02, th, PAL.white, 1, 0.1, 1, 12, 0.08)); // tapering tower
      g.add(box(0.5 + level * 0.06, 0.22, 0.24, PAL.white, 1, th + 0.05, 0.95)); // nacelle
      const rotor = new THREE.Group(); rotor.position.set(1, th + 0.16, 1.12);
      rotor.add(sphere(0.08, PAL.white, 0, 0, 0));
      for (let i = 0; i < 3; i++) { const blade = new THREE.Group(); blade.rotation.z = (i * Math.PI * 2) / 3; blade.add(mesh(cached(`turbineBlade${bl}`, () => new THREE.BoxGeometry(0.1, bl, 0.03)), mat(PAL.white), 0, bl / 2 + 0.03, 0)); rotor.add(blade); }
      if (level > 1) g.add(box(0.3, 0.35, 0.25, PAL.white, 1.6, 0.1, 1.6)); // transformer
      g.add(rotor); sails = rotor;
      break;
    }
    case 'oilTank': { // two squat white tanks in a bund, a ladder and a pipe
      const th = [1.1, 1.4, 1.7][level - 1] ?? 1.1;
      g.add(box(w - 0.1, 0.12, d - 0.1, 0x6b6b66, w / 2, 0, d / 2, { rough: 1 }));
      for (const [x, z] of [[0.95, 0.95], [2.05, 2.05]]) g.add(cyl(0.8, th, 0xdcdcd2, x, 0.12, z, 18), cyl(0.82, 0.05, 0xb9b9ae, x, th + 0.12, z, 18));
      if (level > 1) g.add(cyl(0.5, th - 0.2, 0xdcdcd2, 2.35, 0.12, 0.65, 16), cyl(0.52, 0.05, 0xb9b9ae, 2.35, th - 0.08, 0.65, 16)); // a third tank
      if (level === 3) g.add(cyl(0.5, th - 0.2, 0xdcdcd2, 0.65, 0.12, 2.35, 16), box(1.6, 0.05, 0.2, PAL.metalDark, 1.5, th + 0.15, 1.5)); // a fourth, and a catwalk over the tops
      g.add(box(0.06, th, 0.25, PAL.metalDark, 1.78, 0.12, 0.95)); // ladder
      g.add(box(1.3, 0.08, 0.08, PAL.metalDark, 1.5, 0.3, 1.5)); // pipe between the tanks
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
    case 'refinery': { // a real refinery's sprawl: tank farm, distillation columns on a pipe rack, cracking unit, flare stack
      g.add(box(w - 0.1, 0.06, d - 0.1, 0x6b6b66, w / 2, 0, d / 2, { rough: 1 }));
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const x = 1.3 + i * 2.3, z = 1.3 + j * 2.4; g.add(cyl(0.95, 1.3, 0xdcdcd2, x, 0.06, z, 18), cyl(0.97, 0.06, 0xb9b9ae, x, 1.36, z, 18), box(1.95, 0.05, 1.95, 0x4f4f4a, x, 0.06, z)); } // the tank farm, each in its bund
      g.add(box(w - 1.2, 0.08, 0.3, PAL.metalDark, w / 2, 1.2, 5.3)); // pipe rack across the site
      for (let x = 1; x < w - 0.5; x += 1.4) g.add(box(0.08, 1.2, 0.3, PAL.metalDark, x, 0, 5.3));
      for (let k = 0; k < 3; k++) g.add(box(w - 1.2, 0.06, 0.06, k === 1 ? 0xb8862e : PAL.metal, w / 2, 1.3 + k * 0.08, 5.2 + k * 0.1));
      for (const [x, h, r] of [[2.2, 4.6, 0.38], [3.3, 3.8, 0.3], [4.2, 5.2, 0.42]] as const) { // distillation columns with their platforms
        g.add(cyl(r, h, 0xc9ccd0, x, 0.06, 6.6, 12));
        for (let y = 1; y < h; y += 1.2) g.add(cyl(r + 0.14, 0.04, PAL.metalDark, x, y, 6.6, 12));
      }
      g.add(box(2.4, 1.8, 1.6, 0x8a8f96, 7, 0.06, 6.7), box(2.6, 0.12, 1.8, PAL.metalDark, 7, 1.86, 6.7)); // cracking unit
      g.add(cyl(0.22, 2.6, 0x8a8f96, 6.2, 1.9, 6.4, 10), cyl(0.18, 2.2, 0x8a8f96, 7.8, 1.9, 7.0, 10)); // its stacks
      g.add(box(1.6, 0.9, 1.2, PAL.white, 10.2, 0.06, 6.9), box(1.7, 0.08, 1.3, PAL.roofGrey, 10.2, 0.96, 6.9)); // control room
      g.add(cyl(0.12, 6.4, 0xb04a3a, w - 0.8, 0.06, 1.0, 8), cyl(0.2, 0.25, PAL.metalDark, w - 0.8, 6.46, 1.0, 8)); // flare stack
      g.add(cone(0.22, 0.7, 0xffa53a, w - 0.8, 6.7, 1.0, 8)); // the flare
      smoke.push(new THREE.Vector3(6.2, 4.6, 6.4), new THREE.Vector3(7.8, 4.2, 7.0), new THREE.Vector3(w - 0.8, 7.4, 1.0));
      if (level > 1) { g.add(cyl(0.34, 4.2, 0xc9ccd0, 1.2, 0.06, 6.7, 12)); for (let y = 1; y < 4.2; y += 1.2) g.add(cyl(0.48, 0.04, PAL.metalDark, 1.2, y, 6.7, 12)); } // more columns
      if (level === 3) { g.add(cyl(0.4, 5.6, 0xc9ccd0, 5.2, 0.06, 6.7, 12)); for (let y = 1; y < 5.6; y += 1.2) g.add(cyl(0.54, 0.04, PAL.metalDark, 5.2, y, 6.7, 12)); g.add(cyl(0.22, 3.0, 0x8a8f96, 8.6, 1.9, 6.4, 10)); smoke.push(new THREE.Vector3(8.6, 5.0, 6.4)); }
      break;
    }
    case 'verticalFarm': { // a glass tower: steel frame, floors of greens under violet grow lights, plant room on the roof
      const floors = [6, 8, 10][level - 1] ?? 6, fw = 1.6, H = floors * 0.567, cx = w / 2, cz = d / 2; // more floors of greens each level
      g.add(box(fw + 0.2, 0.08, fw + 0.2, PAL.stoneDark, cx, 0, cz));
      g.add(box(fw, H, fw, 0xa9d4de, cx, 0.08, cz, { opacity: 0.35, rough: 0.1 }));
      for (let i = 0; i < floors; i++) {
        const y = 0.3 + i * 0.52;
        g.add(box(fw - 0.12, 0.05, fw - 0.12, PAL.metalDark, cx, y, cz), box(fw - 0.2, 0.1, fw - 0.2, 0x5faf4a, cx, y + 0.05, cz));
        const glow = box(fw - 0.2, 0.02, fw - 0.2, 0xc07ae0, cx, y + 0.42, cz, { emissive: 0x6a2a8a }); glow.userData.window = true; g.add(glow);
      }
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(box(0.07, H, 0.07, PAL.metalDark, cx + (dx * fw) / 2, 0.08, cz + (dz * fw) / 2));
      for (let i = 1; i <= floors; i++) g.add(box(fw + 0.04, 0.04, fw + 0.04, PAL.metalDark, cx, 0.08 + i * (H / floors) - 0.02, cz));
      g.add(box(fw + 0.1, 0.1, fw + 0.1, PAL.metalDark, cx, H + 0.08, cz), box(0.7, 0.35, 0.5, PAL.white, cx - 0.3, H + 0.18, cz - 0.3));
      g.add(cyl(0.18, 0.3, PAL.metal, cx + 0.45, H + 0.18, cz + 0.4, 10));
      break;
    }
    case 'lab':
    case 'lab2':
      pad();
      shed(g, w - 1, d - 0.6, 1.2, PAL.white, PAL.roofGrey, 0.2, 0.3, { door: 'house', roofH: 0.35 });
      g.add(sphere(0.55, 0xdfe8ee, w - 0.6, 0.9, 0.7, { rough: 0.3, metal: 0.2 }));
      g.add(cyl(0.5, 0.9, PAL.white, w - 0.6, 0, 0.7, 12));
      g.add(box(0.03, 0.8, 0.03, PAL.metalDark, 0.6, 1.5, 0.6)); g.add(box(0.3, 0.03, 0.03, PAL.metalDark, 0.6, 2.2, 0.6)); // antenna
      if (level > 1) { const dish = cyl(0.3, 0.06, PAL.white, 0, 0, 0, 14); dish.rotation.x = -0.7; dish.position.set(1.3, 1.85, 0.8); g.add(dish, box(0.05, 0.4, 0.05, PAL.metalDark, 1.3, 1.45, 0.8)); } // a satellite dish
      if (level === 3) { g.add(box(0.06, 2.6, 0.06, PAL.metalDark, 0.25, 0, 0.3)); for (const y of [1.2, 2.0]) g.add(box(0.4, 0.03, 0.03, PAL.metalDark, 0.25, y, 0.3)); } // a radio mast
      break;
    case 'coop':
      if (level === 3) { shed(g, w - 1.0, 0.95, 0.7, PAL.white, PAL.roofGrey, 0.2, 0.2, { door: 'house', windows: 4, roofH: 0.3 }); for (let i = 0; i < 3; i++) g.add(cyl(0.07, 0.2, PAL.metal, 0.6 + i * 0.6, 0.95, 0.65, 8)); silo(g, w - 0.4, 0.6, 0.24, 1.4); } // a long poultry house with its feed bin
      else {const coop=artModel('coop',1.4,1);if(coop){coop.position.add(new THREE.Vector3(.2,0,.2));g.add(coop);}else shed(g, 1.4, 1.0, 0.8, PAL.barnRed, PAL.roofBrown, 0.2, 0.2, { door: 'house', windows: 1 });
        if (level === 2) { shed(g, 0.9, 0.75, 0.6, PAL.barnRed, PAL.roofBrown, 1.8, 0.25, { door: 'house', windows: 0, roofH: 0.35 }); g.add(cyl(0.1, 0.35, PAL.metal, 2.25, 0, 1.6, 8)); } } // a second house and a feeder
      fenceRect(g, w - 0.3, d - 1.4, 0.15, 1.25, 0.25);
      pen = { x0: 0.3, z0: 1.4, x1: w - 0.3, z1: d - 0.25 };
      break;
    case 'pigsty':
      // low stone sty with a lean-to roof, a muddy run and a feed trough
      if (level === 3) { g.add(box(1.3, 0.75, d - 0.5, 0xc9c2b2, 0.85, 0, d / 2)); g.add(gable(1.3, d - 0.5, 0.45, PAL.roofGrey, 0.85, 0.75, d / 2)); for (const z of [0.7, 1.5, 2.3]) g.add(box(0.2, 0.2, 0.2, PAL.metalDark, 0.85, 1.05, z)); } // a pig barn with roof fans
      else {
      g.add(box(1.3, 0.6, 1.0, PAL.stone, 0.85, 0, 0.75, { rough: 1 }));
      leanTo(g, 1.3, 1.15, 0.85, 0.6, PAL.roofBrown, 0.2, 0.2);
      g.add(box(0.32, 0.4, 0.04, PAL.door, 0.85, 0, 1.27));
      if (level === 2) { g.add(box(1.3, 0.6, 1.0, PAL.stone, 0.85, 0, 1.95, { rough: 1 })); leanTo(g, 1.3, 1.15, 0.85, 0.6, PAL.roofBrown, 0.2, 1.4); } } // a second sty
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
      if (level > 1) silo(g, w - 0.25, 0.6, 0.2, 1.9); // feed silo, then a second
      if (level === 3) silo(g, 0.25, 0.6, 0.2, 1.7);
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
      if (level === 3) shed(g, 1.2, 0.85, 0.8, PAL.wood, PAL.roofGreen, w - 1.45, 0.3, { door: 'barn', windows: 0, roofH: 0.4 }); // a shearing shed
      else g.add(box(0.6, 0.4, 0.26, PAL.woodDark, w - 0.8, 0, 0.6), box(0.5, 0.12, 0.2, PAL.hay, w - 0.8, 0.4, 0.6));
      if (level > 1) { trough(g, w - 0.9, d - 0.5); for (const x of [0.6, 0.95]) g.add(box(0.3, 0.22, 0.25, 0xeee6d2, x, 0, d - 0.45)); } // a water trough and wool bales
      pen = { x0: 0.5, z0: 1.5, x1: w - 0.5, z1: d - 0.5 };
      break;
    case 'winery':
      pad(PAL.creamDark);
      shed(g, 2.2, 1.6, level === 3 ? 1.6 : 1.3, PAL.stone, PAL.roofRed, 0.2, 0.3, { door: 'barn', windows: 2 });
      for (let i = 0; i < 3 + (level === 3 ? 2 : 0); i++) { const b = cyl(0.17, 0.4, PAL.woodDark, 0.6 + (i % 3) * 0.45, 0, 2.4 + Math.floor(i / 3) * 0.35, 10); b.rotation.z = Math.PI / 2; b.position.y = 0.18; g.add(b); }
      for (let i = 0; i < (level - 1) * 2; i++) g.add(cyl(0.17, 1.1, PAL.metal, 2.72, 0, 0.5 + i * 0.5, 10)); // steel fermentation tanks
      break;
  }
  const ids: Partial<Record<Lot['type'], ArtId>>={house:'farmhouse',shed:'shed',barn:'barn',silo:'silo',flourMill:'mill'};
  const art=ids[type] && !variant && level === 1 && artModel(ids[type]!, w, d);
  if(art){g.clear();g.add(art);smoke.length=0;sails=undefined;}
  const windows: THREE.Mesh[] = [];
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.userData.window) windows.push(o as THREE.Mesh); });
  return { group: g, smoke, sails, pen, windows };
}

// ---------------------------------------------------------------- people, machines, animals

const FOLK: ArtId[] = ['farmer', 'man', 'woman2', 'farmer', 'woman'];
const SHIRTS_FARM = [0x9a6a3a, 0x8a3b2b, 0x6b7a3a, 0x5a7a9a, 0xc8b48a, 0xa04a3a]; // work shirts: tan, rust, olive, faded denim, cream, red
/** A farm hand: the farmer in overalls and straw hat, shirt in one of a few colours, a hoe in the right hand (and a scythe for the harvest). Null until the art has loaded. */
export function farmhand(seed: number) {
  const g = artFigure('farmer', 0.55);
  if (!g) return null;
  recolor(g, 'Brown', SHIRTS_FARM[seed % SHIRTS_FARM.length]);
  const rig = g.userData.rig as THREE.Object3D, hand = rig.getObjectByName('WristR');
  if (hand) {
    g.updateMatrixWorld(true);
    const k = rig.getWorldScale(new THREE.Vector3()).x / hand.getWorldScale(new THREE.Vector3()).x; // tools are made in the model's own units (a man about 1.8 tall), whatever the bone's
    const tool = (blade: THREE.Mesh) => { const t = new THREE.Group(); t.add(mesh(cached('toolshaft', () => new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6)), mat(0x8a5a30), 0, -0.1, 0, false), blade); t.scale.setScalar(k); hand.add(t); return t; };
    const hoe = tool(mesh(cached('hoeblade', () => new THREE.BoxGeometry(0.26, 0.05, 0.16)), mat(0x7d7d7d, { rough: 0.5 }), 0, 0.62, 0.08, false));
    const scythe = tool(mesh(cached('scytheblade', () => new THREE.BoxGeometry(0.06, 0.03, 0.7).translate(0, 0, 0.33)), mat(0xb8bcc0, { rough: 0.4 }), 0, 0.62, 0, false));
    scythe.visible = false;
    Object.assign(g.userData, { hoe, scythe });
  }
  g.userData.folk = true;
  return g;
}
export function person(shirt: number, manager: boolean) {
  const art = artFigure(manager ? 'man' : FOLK[(shirt >>> 4) % FOLK.length], 0.55);
  if (art) { art.userData.folk = true; return art; }
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
  const beast = artFigure(big ? 'horse' : 'donkey', big ? 0.8 : 0.66, true), cart = artFigure('cart', big ? 0.62 : 0.5, true);
  if (beast && cart) { // the cart's shafts reach forward to the animal's shoulders
    cart.position.x = -0.2; beast.position.x = big ? 0.42 : 0.34;
    g.add(cart, beast);
    Object.assign(g.userData, { clips: beast.userData.clips, rig: beast.userData.rig });
    return g;
  }
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
const SMOOTH_PINE = new THREE.MeshStandardMaterial({ color: 0x3f6b45, roughness: 0.95 });
export function tree(scale: number, crown: THREE.Material, kind = 0) {
  const g = new THREE.Group();
  if (kind === 1) {
    g.add(mesh(cached('pineTrunk', () => new THREE.CylinderGeometry(0.05, 0.08, 0.35, 6)), mat(PAL.woodDark), 0, 0.17, 0));
    const pine = SMOOTH_PINE;
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
export function buildCommunityHome(tier: string, w: number, d: number, key = '', level = 1): Model {
  if (tier === 'apartment' && level >= 2) return buildApartmentTower(level >= 3 ? 3 : 2, w, d, key);
  const group = new THREE.Group(), windows: THREE.Mesh[] = [], smoke: THREE.Vector3[] = [];
  const seed = hashStr(key);
  const kind: ArtId | null = tier === 'cottage' ? (['cottage', 'cottage2', 'cottage3'] as const)[Math.floor(seed * 3)] : tier === 'terrace' ? 'townhouse' : null;
  if (kind && artModel(kind, 1, 1)) {
    group.add(box(w - 0.1, 0.04, d - 0.1, PAL.stone, w / 2, 0, d / 2, { rough: 1 }));
    prop(group, kind, w - 0.3, d - 0.4, w / 2, d / 2 - 0.1);
    if (tier === 'cottage') group.add(sphere(0.2, 0x5f8f4a, w - 0.3, 0.18, d - 0.25)); // a shrub by the gate
  } else if (tier === 'cottage') cottage(group, w, d, seed);
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
    // apartments: a tall town block in the same warm walls and pitched roofs as the cottages and terraces,
    // white-framed windows, slim balconies on the upper floors, a porch over the door and hedges by the path
    const wall = WALLS[Math.floor(hashStr(key + 'w') * WALLS.length)], roof = ROOFS[Math.floor(hashStr(key + 'r') * 2)];
    const bw = w - 0.5, bd = d - 1.3, floors = 4, fh = 0.62, top = floors * fh, cx = w / 2, cz = 0.45 + bd / 2, front = cz + bd / 2, side = cx + bw / 2;
    const win = (o: THREE.Mesh) => { o.userData.window = true; group.add(o); };
    group.add(box(w - 0.1, 0.04, d - 0.1, PAL.stone, w / 2, 0, d / 2, { rough: 1 }));
    group.add(box(bw, top, bd, wall, cx, 0, cz));
    group.add(box(bw + 0.03, fh, bd + 0.03, 0xd9d0bd, cx, 0, cz)); // a pale stone ground floor
    for (let i = 1; i < 4; i++) group.add(box(bw + 0.04, 0.012, bd + 0.04, 0xbfb49e, cx, i * fh / 4, cz)); // its coursing
    group.add(box(bw + 0.07, 0.06, bd + 0.07, PAL.white, cx, fh - 0.02, cz)); // string course
    group.add(box(bw + 0.08, 0.08, bd + 0.08, PAL.white, cx, top - 0.04, cz)); // eaves band
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) group.add(box(0.07, top - fh, 0.07, PAL.white, cx + sx * (bw / 2 - 0.02), fh, cz + sz * (bd / 2 - 0.02))); // corner quoins
    for (const sx of [-1, 1]) group.add(box(0.04, top, 0.04, PAL.metalDark, cx + sx * (bw / 2 - 0.1), 0, front + 0.03)); // downpipes
    group.add(gable(bw + 0.1, bd, 0.75, roof, cx, top, cz));
    group.add(box(bw + 0.36, 0.05, 0.08, 0x3a2a22, cx, top + 0.74, cz)); // ridge cap
    for (const x of [cx - bw / 4, cx + bw / 4]) { // two dormers on the front slope
      const z = cz + 0.42;
      group.add(box(0.36, 0.36, 0.34, wall, x, top + 0.12, z));
      win(box(0.2, 0.2, 0.02, PAL.window, x, top + 0.19, z + 0.18));
      group.add(box(0.26, 0.26, 0.015, PAL.white, x, top + 0.16, z + 0.175));
      const cap = gable(0.12, 0.36, 0.16, roof, x, top + 0.48, z); cap.rotation.y = Math.PI / 2; group.add(cap);
    }
    smoke.push(chimney(group, cx - bw / 2 + 0.35, cz - 0.15, top + 0.2, 0.6), chimney(group, cx + bw / 2 - 0.35, cz - 0.15, top + 0.2, 0.6));
    const cols = [-1.5, -0.5, 0.5, 1.5].map((c) => cx + c * (bw / 4));
    for (let f = 0; f < floors; f++) {
      const y = f * fh + 0.2;
      cols.forEach((x, c) => {
        if (f === 0 && (c === 1 || c === 2)) return; // the doorway
        group.add(box(0.34, 0.38, 0.02, PAL.white, x, y - 0.02, front + 0.005)); // frame
        win(box(0.26, 0.3, 0.03, PAL.window, x, y + 0.02, front + 0.01));
        group.add(box(0.02, 0.3, 0.035, PAL.white, x, y + 0.02, front + 0.015), box(0.26, 0.02, 0.035, PAL.white, x, y + 0.2, front + 0.015)); // glazing bars
        if (f < 3 && (c === 1 || c === 2) && hashStr(key + f + c) > 0.35) { // window boxes of flowers
          group.add(box(0.3, 0.07, 0.08, PAL.woodDark, x, y - 0.06, front + 0.05));
          for (const dx of [-0.09, 0, 0.09]) group.add(sphere(0.045, [0xc94c4c, 0xe7a23b, 0xd673a4][Math.floor(hashStr(key + f + c + dx) * 3)], x + dx, y + 0.03, front + 0.05));
        }
        if (f > 0 && (c === 0 || c === 3)) { // a slim balcony on the outer bays
          group.add(box(0.46, 0.04, 0.18, PAL.white, x, f * fh + 0.12, front + 0.09));
          group.add(box(0.46, 0.14, 0.015, PAL.white, x, f * fh + 0.16, front + 0.18));
          if (hashStr(key + 'p' + f + c) > 0.4) group.add(sphere(0.06, 0x5f8f4a, x + 0.15, f * fh + 0.22, front + 0.1)); // a pot plant
        }
      });
      for (const z of [cz - bd / 4, cz + bd / 4]) { group.add(box(0.02, 0.38, 0.3, PAL.white, side + 0.005, y - 0.02, z)); win(box(0.03, 0.3, 0.22, PAL.window, side + 0.01, y + 0.02, z)); }
    }
    // the entrance: double door, a little pitched porch and a lamp
    group.add(box(0.5, 0.5, 0.03, PAL.door, cx, 0.18, front + 0.01));
    group.add(gable(0.7, 0.35, 0.18, roof, cx, 0.72, front + 0.17));
    group.add(box(0.04, 0.54, 0.04, PAL.white, cx - 0.32, 0.18, front + 0.3), box(0.04, 0.54, 0.04, PAL.white, cx + 0.32, 0.18, front + 0.3));
    group.add(box(0.6, 0.06, 0.4, PAL.stone, cx, 0.04, front + 0.2)); // step
    group.add(box(0.5, 0.03, d - front - 0.45, 0xd9cdb4, cx, 0.03, (front + 0.4 + d - 0.05) / 2, { rough: 1 }));
    for (const x of [cx - 0.75, cx + 0.75]) group.add(box(0.8, 0.24, 0.22, 0x5f8f4a, x, 0, d - 0.3)); // hedges
    group.add(box(0.04, 0.8, 0.04, PAL.metalDark, cx + 0.42, 0, d - 0.55), box(0.12, 0.1, 0.12, 0xffe2a0, cx + 0.42, 0.8, d - 0.55, { emissive: 0x6b5a2a })); // lamp
    group.add(box(0.12, 0.16, 0.08, 0xb5463a, cx - 0.42, 0.3, d - 0.55), box(0.03, 0.3, 0.03, PAL.metalDark, cx - 0.42, 0, d - 0.55)); // letterbox
  }
  group.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.userData.window && !windows.includes(o as THREE.Mesh)) windows.push(o as THREE.Mesh); });
  return { group, smoke, windows };
}

/** Small civic landmarks use the farm palette and shared geometry caches. */
export function buildCivic(type: string, w: number, d: number, level = 1, key = ''): Model {
  if (type.startsWith('park') && w < 6) return buildPark((type.split('-')[1] ?? 'garden') as 'garden' | 'play' | 'sport', level, w, d);
  if (w >= 6 && type !== 'mall' && !type.startsWith('shop')) { // four merged into one: the same building grown to fill the square, in grounds of its own
    const inner = buildCivic(type, 3, 3, level, key), g = new THREE.Group(), k = (w - 1.2) / 3;
    inner.group.scale.setScalar(k); inner.group.position.set(0.6, 0, 0.6); g.add(inner.group);
    g.add(box(w - 0.1, 0.05, d - 0.1, PAL.stone, w / 2, 0, d / 2, { rough: 1 }));
    for (const [x, z] of [[0.4, 0.4], [w - 0.4, 0.4], [0.4, d - 0.4], [w - 0.4, d - 0.4]]) planter(g, x, z, 0.22);
    lampPost(g, w / 2 - 1, d - 0.3, 1.0); lampPost(g, w / 2 + 1, d - 0.3, 1.0);
    return { group: g, windows: inner.windows, smoke: inner.smoke.map((p) => new THREE.Vector3(0.6 + p.x * k, p.y * k, 0.6 + p.z * k)) };
  }
  if (type.startsWith('shop')) return w >= 6 ? buildMarketHall(type.slice(4).toLowerCase() as ShopKind, w, d) : buildShop(type.slice(4).toLowerCase() as ShopKind, w, d);
  if (type === 'mall') return buildMall(w, d, level > 1);
  if (type === 'office') return buildOffice(Math.max(1, Math.min(3, level)) as 1 | 2 | 3, w, d, key);
  const group = new THREE.Group(), windows: THREE.Mesh[] = [], smoke: THREE.Vector3[] = [];
  group.add(box(w-.1,.08,d-.1,PAL.stone,w/2,0,d/2));
  if(type==='lighting'){ // power station: brick turbine hall, tall stack, fenced transformer yard, a pylon carrying the line out
    shed(group,1.7,1.2,1.1,PAL.brick,PAL.roofGrey,.2,.2,{door:'roller',windows:2,roofH:.35});
    group.add(cyl(.16,2.8,PAL.brick,1.65,0,.45,10,.12),cyl(.17,.12,PAL.stoneDark,1.65,2.8,.45,10));
    smoke.push(new THREE.Vector3(1.65,2.95,.45));
    group.add(box(1.1,.04,1.1,PAL.stoneDark,2.35,.08,2.3));
    for(const [x,z] of [[2.1,2.05],[2.6,2.05]]){group.add(box(.32,.38,.26,0x6f7d6a,x,.12,z));for(const dx of [-.09,0,.09])group.add(cyl(.025,.2,0xd9d2c0,x+dx,.5,z,6));}
    fenceRect(group,1.15,1.05,1.8,1.75,.28);
    const px=.55,pz=2.35; // lattice pylon
    for(const [dx,dz] of [[-.18,-.18],[.18,-.18],[-.18,.18],[.18,.18]]){const leg=box(.04,2.6,.04,PAL.metalDark,px+dx*.55,0,pz+dz*.55);leg.rotation.set(dz*.25,0,-dx*.25);group.add(leg);}
    for(const y of [1.9,2.35])group.add(box(.9,.04,.05,PAL.metalDark,px,y,pz));
    for(const dx of [-.42,0,.42])group.add(cyl(.025,.14,0xd9d2c0,px+dx,2.2,pz,6));
    if(level>1){group.add(box(.32,.38,.26,0x6f7d6a,2.35,.12,2.55));for(const dx of [-.09,0,.09])group.add(cyl(.025,.2,0xd9d2c0,2.35+dx,.5,2.55,6));} // a third transformer
    if(level===3){group.add(cyl(.14,2.4,PAL.brick,1.15,0,.45,10,.1));smoke.push(new THREE.Vector3(1.15,2.55,.45));} // a second boiler stack
  } else if(type==='sanitation'){ // treatment works: two settling tanks with turning bridges and a pump house
    for(const [x,z,r] of [[.95,1.05,.72],[2.25,2.2,.55]] as const){
      group.add(cyl(r,.45,PAL.stone,x,.08,z,18),cyl(r-.07,.03,0x5f7d6b,x,.5,z,18),box(r*2,.06,.12,PAL.metalDark,x,.58,z),cyl(.06,.2,PAL.metalDark,x,.5,z,8));
    }
    shed(group,.9,.75,.75,PAL.creamDark,PAL.roofBlue,1.9,.25,{door:'house',roofH:.3});
    group.add(box(.07,.07,1.1,PAL.metal,1.6,.2,1.6)); // pipe between the tanks
    if(level>1)group.add(cyl(.42,.45,PAL.stone,.6,.08,2.35,16),cyl(.36,.03,0x5f7d6b,.6,.5,2.35,16)); // a third tank
    if(level===3)group.add(mesh(cached('sanDome',()=>new THREE.SphereGeometry(.38,14,7,0,Math.PI*2,0,Math.PI/2)),mat(0x4f6b45,{rough:.7}),2.35,.85,.65),cyl(.38,.1,PAL.stone,2.35,.75,.65,14)); // a sludge digester on the pump house roof
  } else if(type==='watchtower'){
    for(const [x,z] of [[.6,.6],[w-.6,.6],[.6,d-.6],[w-.6,d-.6]])group.add(box(.14,3,.14,PAL.wood,x,.1,z));
    group.add(box(w-.6,.12,d-.6,PAL.wood,w/2,3,d/2),box(w-.6,.4,.08,PAL.wood,w/2,3.1,.55),box(w-.6,.4,.08,PAL.wood,w/2,3.1,d-.55));
    group.add(gable(w-.4,d-.4,.7,PAL.barnRed,w/2,3.5,d/2));
    const fire=sphere(.14,0xffb055,w/2,3.35,d/2,{emissive:0x804010});windows.push(fire);group.add(fire);
  } else if(type==='waterTower'){
    // each level stands taller with a bigger tank; the legs always meet the tank's rim, tied by braces, with a ladder up the front
    const legs=[2.3,2.8,3.3][level-1]??2.3,r=[.8,.9,1][level-1]??.8,th=[.9,1.05,1.2][level-1]??.9,k=r*.72,cx=w/2,cz=d/2;
    for(const [dx,dz] of [[-1,-1],[1,-1],[-1,1],[1,1]])group.add(box(.12,legs,.12,PAL.metalDark,cx+dx*k,.1,cz+dz*k));
    for(let y=.8;y<legs-.3;y+=.9){group.add(box(k*2,.05,.05,PAL.metalDark,cx,y,cz-k),box(k*2,.05,.05,PAL.metalDark,cx,y,cz+k),box(.05,.05,k*2,PAL.metalDark,cx-k,y,cz),box(.05,.05,k*2,PAL.metalDark,cx+k,y,cz));}
    group.add(cyl(r+.08,.06,PAL.metalDark,cx,legs+.06,cz,16)); // the catwalk round the tank
    group.add(cyl(r,th,0x7fa7c4,cx,legs+.12,cz,16),cone(r+.06,.4,PAL.roofGrey,cx,legs+.12+th,cz,16));
    group.add(box(.06,legs,.06,PAL.metal,cx,.1,cz)); // feed pipe
    group.add(box(.22,legs,.03,PAL.metal,cx+k,.1,cz+k+.08)); // ladder
    if(level===3)shed(group,.7,.55,.6,PAL.creamDark,PAL.roofBlue,.1,d-.7,{door:'house',windows:0,roofH:.25}); // pump house in the corner
  } else if(type==='road') {
    group.add(box(w-.1,.05,d-.1,PAL.roofGrey,w/2,.09,d/2));
    for(let i=0;i<Math.min(18,Math.ceil(d/2));i++)group.add(box(.06,.02,.4,PAL.white,w/2,.15,.4+i*2));
    group.add(box(.08,1.8,.08,PAL.wood,.2,.1,.5),sphere(.16,0xffd889,.2,2,.5,{emissive:0x806020}));
  } else if(type==='well'&&artModel('well',1,1)) {
    prop(group,'well',1.5,1.5,level>1?1.0:w/2,level>1?1.0:d/2); // a well is a small thing: the rest of its plot is the yard round it
    if(level>1){trough(group,w-.7,1.0,.9);group.add(box(.12,.6,.12,PAL.metalDark,w-.7,0,.6),box(.3,.06,.06,PAL.metalDark,w-.6,.55,.6));} // a hand pump and trough
    if(level===3){shed(group,.9,.7,.7,PAL.creamDark,PAL.roofBlue,.4,d-1.0,{door:'house',windows:0,roofH:.3});group.add(cyl(.32,1.2,PAL.metal,w-.6,0,d-.6,12));} // a borehole pump house and storage tank
  } else if(type==='well'||type==='waterworks') {
    group.add(cyl(type==='well'?.55:1,1,PAL.creamDark,w/2,.1,d/2));
    group.add(cyl(type==='well'?.42:.85,.04,0x65a8bb,w/2,1.1,d/2));
    group.add(box(.12,1,.12,PAL.wood,w/2-.6,1,d/2),box(.12,1,.12,PAL.wood,w/2+.6,1,d/2));
    group.add(gable(1.6,1.3,.5,PAL.roofBlue,w/2,2,d/2));
    if(level>1)group.add(cyl(.35,1.3,PAL.metal,w-.4,.1,.4,12)); // a storage tank, then a filter bed
    if(level===3)group.add(box(1.2,.25,.6,PAL.stone,.8,.1,d-.4),box(1.1,.03,.5,0x65a8bb,.8,.35,d-.4));
  } else if(type==='park') {
    const a=tree(.7,mat(PAL.roofGreen));a.position.set(w/2,0,d/2);group.add(a);
    group.add(box(1,.12,.35,PAL.wood,w/2,.35,d-.5));
  } else {
    if(type==='school'){ // a one-room schoolhouse with a bell cupola, a flagpole and a playground; then two storeys, then a sports hall
      const wh=level>1?2.0:1.3,mw=level===3?1.65:w-.6,mx=.3+mw/2; // level 3 makes room for a sports hall wing on the right
      shed(group,mw,1.5,wh,0xc96f4f,PAL.roofGreen,.3,.3,{door:'house',windows:level>1?0:3,roofH:.6,doorH:.7});
      if(level>1)windowRows(group,.3,.3+mw,1.8,2,3,.8,.45);
      group.add(box(.34,.3,.34,PAL.white,mx,wh+.45,1.05),cone(.3,.35,PAL.roofGreen,mx,wh+.75,1.05,4),cyl(.07,.1,0xc9a44a,mx,wh+.5,1.05,8));
      if(level===3){shed(group,.8,1.4,1.25,0xd8cfbd,PAL.roofGrey,2.05,.35,{door:'roller',windows:0,roofH:.3});const strip=box(.6,.18,.03,PAL.window,2.45,.95,1.76);strip.userData.window=true;group.add(strip);}
      group.add(box(.04,1.9,.04,PAL.metal,.3,0,d-.4),box(.35,.22,.02,0x3a6fb0,.48,1.62,d-.4));
      if(level<3){group.add(box(1,.04,.6,0xe0c98f,w-.8,.06,d-.55)); // sandpit
      for(const x of [w-1.25,w-.35])group.add(box(.05,.75,.05,PAL.metalDark,x,0,d-.25));
      group.add(box(.95,.05,.05,PAL.metalDark,w-.8,.75,d-.25),box(.22,.03,.1,PAL.barnRed,w-.8,.3,d-.25));}
    } else if(type==='clinic'||type==='hospital'){ // white clinic with a red-cross sign, a covered entrance and a bench
      const wh=[1.2,1.95,2.7][level-1]??1.2; // a clinic, a two-storey health centre, then a three-storey hospital with an ambulance
      shed(group,w-.6,1.6,wh,PAL.white,0x5f8fa8,.3,.25,{door:'house',windows:level>1?0:4,roofH:.4,doorH:.66});
      if(level>1)windowRows(group,.3,w-.3,1.85,level,4,.75,.45);
      if(level===3)group.add(box(.6,.38,.32,PAL.white,w-.55,0,d-.3),box(.62,.06,.34,PAL.barnRed,w-.55,.2,d-.3));
      group.add(box(.8,.05,.5,PAL.roofGrey,w/2,1.0,1.95),box(.05,1,.05,PAL.metalDark,w/2-.35,0,2.15),box(.05,1,.05,PAL.metalDark,w/2+.35,0,2.15));
      group.add(box(.05,1.1,.05,PAL.metalDark,.45,0,d-.35),box(.55,.55,.04,PAL.white,.45,1.1,d-.35));
      group.add(box(.4,.1,.05,PAL.barnRed,.45,1.32,d-.32),box(.1,.4,.05,PAL.barnRed,.45,1.17,d-.32));
      if(level<3)group.add(box(.6,.08,.18,PAL.wood,w-.7,.22,d-.35));
    } else if(type==='police'){ // a stone watchhouse with a blue lamp; a two-storey station with a patrol car and a flag; then headquarters with a radio tower and a second car
      const wh=level>1?1.95:1.15,mw=level===3?1.75:w-1.1,mx=.3+mw/2,blue=0x2d5fa8;
      shed(group,mw,1.5,wh,level>1?0x9aa3ad:0xa39d92,PAL.roofGrey,.3,.3,{door:'house',windows:level>1?0:2,roofH:.4,doorH:.66});
      if(level>1)windowRows(group,.3,.3+mw,1.8,2,3,.8,.45);
      group.add(box(1.05,.28,.04,blue,mx,wh-.36,1.82),box(.75,.07,.045,PAL.white,mx,wh-.26,1.83)); // the blue POLICE board over the door
      const lamp=box(.16,.2,.16,0x3b7be0,mx+.62,1.05,2.0,{emissive:0x1d3f80});lamp.userData.window=true; // the blue lamp, lit at night
      group.add(box(.05,1.05,.05,PAL.metalDark,mx+.62,0,2.0),lamp,box(.2,.04,.2,PAL.metalDark,mx+.62,1.25,2.0));
      const car=(x:number,z:number)=>{ // a white patrol car with a blue cabin and a red light bar
        group.add(box(.48,.2,.92,PAL.white,x,.08,z),box(.42,.16,.46,blue,x,.28,z-.04),box(.24,.05,.08,0xe0533d,x,.44,z-.04));
        for(const [dx,dz] of [[-.24,-.3],[.24,-.3],[-.24,.3],[.24,.3]])group.add(box(.06,.16,.18,0x2a2a2a,x+dx,0,z+dz));
      };
      if(level===1)group.add(box(.42,.5,.06,PAL.wood,w-.45,0,d-.45),box(.36,.3,.03,PAL.cream,w-.45,.45,d-.42)); // a notice board
      if(level>1){car(w-.5,d-.75);group.add(box(.04,1.9,.04,PAL.metal,.3,0,d-.3),box(.35,.22,.02,blue,.48,1.62,d-.3));}
      if(level===3){ // a lookout and radio tower beside the station, and a second car
        group.add(box(.7,2.6,.7,0x9aa3ad,2.5,0,.7),box(.8,.08,.8,PAL.roofGrey,2.5,2.6,.7),cyl(.03,1.2,PAL.metalDark,2.5,2.68,.7,6));
        const glass=box(.72,.3,.72,PAL.glass,2.5,2.1,.7);glass.userData.window=true;group.add(glass);
        car(w-1.15,d-.75);
      }
    } else if(type==='hall'){ // town hall: stone front with columns, a pediment and a clock tower
      group.add(box(w-.6,1.5,1.4,0xd8cfbd,w/2,0,1));
      group.add(gable(w-.5,1.5,.5,PAL.roofGrey,w/2,1.5,1));
      group.add(box(w-.4,.08,.5,PAL.stone,w/2,0,1.95),box(w-.5,.15,.45,PAL.stone,w/2,1.35,1.95));
      for(let i=0;i<4;i++)group.add(cyl(.07,1.35,PAL.white,.65+i*(w-1.3)/3,0,2.05,8));
      group.add(box(.32,.6,.04,PAL.door,w/2,0,1.71));
      for(const x of [.7,w-.7]){const win=box(.26,.5,.03,PAL.window,x,.55,1.71);win.userData.window=true;group.add(win);}
      group.add(box(.5,.9,.5,0xd8cfbd,w/2,1.7,.75),cone(.42,.55,PAL.roofGrey,w/2,2.6,.75,4),cyl(.16,.03,PAL.white,w/2,2.2,1.01,12));
      group.add(box(.04,1.5,.04,PAL.metal,w-.35,0,d-.3),box(.4,.25,.02,PAL.roofGreen,w-.15,1.25,d-.3));
    } else shed(group,w-.4,d-.6,1.6,PAL.cream,PAL.roofBlue,.2,.2,{door:'house',windows:3});
    if(type==='barracks'){group.add(box(.06,2.6,.06,PAL.wood,w-.3,.1,.3),box(.7,.4,.03,PAL.barnRed,w-.65,2.4,.3));}
  }
  group.traverse(o=>{if((o as THREE.Mesh).isMesh&&o.userData.window&&!windows.includes(o as THREE.Mesh))windows.push(o as THREE.Mesh);});
  return {group,windows,smoke};
}

// ---------------------------------------------------------------- city commerce: shops → markets → mall
export type ShopKind = 'baker' | 'dairy' | 'butcher' | 'grocer' | 'general';
const SHOP_LOOK: Record<ShopKind, { wall: number; roof: number; a: number; b: number; sign: number }> = {
  baker: { wall: 0xf0dfb8, roof: 0xb5643c, a: 0xd98a3a, b: 0xfff3dc, sign: 0x8a5a2b },
  dairy: { wall: 0xf4f2ec, roof: 0x4f7aa0, a: 0x5b8fc0, b: 0xf4f2ec, sign: 0x2f5f8f },
  butcher: { wall: 0xb0604a, roof: 0x5a4a44, a: 0xa8322c, b: 0xf4f2ec, sign: 0x6e1f1c },
  grocer: { wall: 0xe6dcc0, roof: 0x4f7a52, a: 0x4f8a4a, b: 0xf1e6cc, sign: 0x2f5f33 },
  general: { wall: 0xb98a5a, roof: 0x6b4a36, a: 0xc99a2e, b: 0x7a4a2f, sign: 0x4a3222 },
};
const disc = (r: number, color: number, x: number, y: number, z: number) => { const m = cyl(r, 0.04, color, x, 0, z, 16); m.rotation.x = Math.PI / 2; m.position.y = y; return m; };
const crate = (g: THREE.Group, x: number, z: number, fruit: number, y = 0, tilt = 0) => {
  const c = new THREE.Group(); c.add(box(0.3, 0.1, 0.24, PAL.wood, 0, 0, 0));
  for (const [dx, dz] of [[-0.08, -0.05], [0.08, -0.05], [-0.08, 0.06], [0.08, 0.06], [0, 0]]) c.add(sphere(0.055, fruit, dx, 0.12, dz));
  c.position.set(x, y, z); c.rotation.x = tilt; g.add(c);
};
const sack = (g: THREE.Group, x: number, z: number, c = 0xd8c9a0) => { const m = sphere(0.14, c, x, 0.12, z); m.scale.set(1, 1.2, 0.8); g.add(m); };
const churn = (g: THREE.Group, x: number, z: number) => { g.add(cyl(0.09, 0.26, PAL.metal, x, 0, z, 10), cyl(0.06, 0.08, PAL.metal, x, 0.26, z, 10), cyl(0.075, 0.02, PAL.metalDark, x, 0.34, z, 10)); };
const lampPost = (g: THREE.Group, x: number, z: number, h = 0.9) => { g.add(box(0.04, h, 0.04, PAL.metalDark, x, 0, z), box(0.12, 0.1, 0.12, 0xffe2a0, x, h, z, { emissive: 0x6b5a2a })); };
const planter = (g: THREE.Group, x: number, z: number, r = 0.2) => { g.add(box(r * 1.6, 0.14, r * 1.6, PAL.stoneDark, x, 0, z), sphere(r, 0x5f8f4a, x, 0.14 + r * 0.8, z)); };
const carProp = (g: THREE.Group, x: number, z: number, c: number, rot = 0) => {
  const k = new THREE.Group(); k.add(box(0.36, 0.14, 0.7, c, 0, 0.07, 0), box(0.32, 0.13, 0.36, c, 0, 0.21, -0.03), box(0.33, 0.09, 0.3, PAL.window, 0, 0.23, -0.03));
  for (const [dx, dz] of [[-0.18, -0.22], [0.18, -0.22], [-0.18, 0.22], [0.18, 0.22]]) { const w = cyl(0.07, 0.05, 0x2a2a2a, 0, 0, 0, 10); w.rotation.z = Math.PI / 2; w.position.set(dx, 0.07, dz); k.add(w); }
  k.position.set(x, 0, z); k.rotation.y = rot; g.add(k);
};
/** A market stall: a table of goods under a striped awning on four posts. */
const stall = (g: THREE.Group, x: number, z: number, a: number, b: number, goods: number, rot = 0) => {
  const k = new THREE.Group();
  for (const [dx, dz] of [[-0.36, -0.2], [0.36, -0.2], [-0.36, 0.2], [0.36, 0.2]]) k.add(box(0.04, 0.62, 0.04, PAL.woodDark, dx, 0, dz));
  k.add(box(0.76, 0.05, 0.44, PAL.wood, 0, 0.26, 0));
  for (let i = 0; i < 4; i++) { const s = box(0.2, 0.03, 0.56, i % 2 ? b : a, -0.3 + i * 0.2, 0.62, 0); s.rotation.x = 0.18; k.add(s); }
  for (const dx of [-0.22, 0, 0.22]) for (const dz of [-0.08, 0.1]) k.add(sphere(0.06, goods, dx, 0.36, dz));
  k.position.set(x, 0, z); k.rotation.y = rot; g.add(k);
};
const finish = (group: THREE.Group, smoke: THREE.Vector3[] = []): Model => {
  const windows: THREE.Mesh[] = [];
  group.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.userData.window) windows.push(o as THREE.Mesh); });
  return { group, windows, smoke };
};
const glassWin = (g: THREE.Group, w: number, h: number, x: number, y: number, z: number, side = false) => { const m = side ? box(0.03, h, w, PAL.window, x, y, z) : box(w, h, 0.03, PAL.window, x, y, z); m.userData.window = true; g.add(m); };

/** A high-street shop on a 3×3 lot: shopfront with a display window and striped awning, a flat above, and its trade set out on the pavement. */
export function buildShop(kind: ShopKind, w = 3, d = 3): Model {
  const g = new THREE.Group(), L = SHOP_LOOK[kind], smoke: THREE.Vector3[] = [];
  const bw = w - 0.7, bd = d - 1.4, x0 = 0.35, z0 = 0.25, cx = w / 2, cz = z0 + bd / 2, front = z0 + bd, gh = 0.9, uh = 0.6, top = gh + uh;
  g.add(box(w - 0.1, 0.05, d - 0.1, PAL.stone, w / 2, 0, d / 2, { rough: 1 }));
  g.add(box(w - 0.1, 0.02, d - front - 0.05, 0xcfc6b2, w / 2, 0.05, (front + d - 0.05) / 2, { rough: 1 })); // pavement
  g.add(box(bw, top, bd, L.wall, cx, 0, cz));
  g.add(box(bw + 0.04, 0.14, bd + 0.04, PAL.stoneDark, cx, 0, cz)); // plinth
  // shopfront: display window on a stall riser, door to the right, a painted fascia across the top
  g.add(box(bw - 0.1, 0.72, 0.04, L.sign, cx, 0.1, front + 0.005));
  glassWin(g, bw * 0.55, 0.48, cx - bw * 0.17, 0.26, front + 0.03);
  for (const dx of [-0.27, 0, 0.27]) g.add(box(0.025, 0.48, 0.045, L.b, cx - bw * 0.17 + dx * bw * 0.68, 0.26, front + 0.035)); // glazing bars
  g.add(box(0.34, 0.62, 0.05, PAL.door, cx + bw * 0.3, 0.1, front + 0.03)); glassWin(g, 0.2, 0.24, cx + bw * 0.3, 0.4, front + 0.06);
  g.add(box(bw, 0.16, 0.06, L.sign, cx, gh - 0.04, front + 0.02), box(bw * 0.6, 0.07, 0.07, L.b, cx, gh, front + 0.025)); // fascia and its lettering band
  awning(g, bw, x0, gh - 0.1, front + 0.02, L.a, L.b);
  // the flat above
  for (const x of [cx - bw * 0.25, cx + bw * 0.25]) { g.add(box(0.36, 0.38, 0.02, PAL.white, x, gh + 0.14, front + 0.005)); glassWin(g, 0.28, 0.3, x, gh + 0.18, front + 0.012); g.add(box(0.02, 0.3, 0.035, PAL.white, x, gh + 0.18, front + 0.016)); }
  for (const z of [cz - bd / 4, cz + bd / 4]) glassWin(g, 0.24, 0.28, x0 + bw + 0.01, gh + 0.18, z, true);
  g.add(box(bw + 0.08, 0.06, bd + 0.08, PAL.white, cx, top - 0.03, cz));
  // hanging sign on a bracket
  g.add(box(0.03, 0.03, 0.4, PAL.metalDark, x0 + bw - 0.1, gh + 0.42, front + 0.2));
  const hang = disc(0.15, L.a, x0 + bw - 0.1, gh + 0.22, front + 0.34); hang.rotation.z = Math.PI / 2; g.add(hang);
  if (kind === 'general') { // a boarded false front and a porch on posts
    g.add(box(bw + 0.1, 0.55, 0.08, L.wall, cx, top, front - 0.02), box(bw + 0.16, 0.06, 0.12, L.b, cx, top + 0.55, front - 0.02), box(bw * 0.7, 0.24, 0.03, 0xf1e6cc, cx, top + 0.14, front + 0.03));
    g.add(gable(bw, bd - 0.1, 0.4, L.roof, cx, top, cz - 0.05));
    for (const x of [x0 + 0.1, x0 + bw - 0.1]) g.add(box(0.06, gh - 0.14, 0.06, PAL.woodDark, x, 0.05, front + 0.45));
    barrel(g, x0 + 0.25, front + 0.55); barrel(g, x0 + 0.5, front + 0.62, 0x7a5a3c); sack(g, cx - 0.1, front + 0.7); sack(g, cx + 0.15, front + 0.62, 0xc9b98a);
    g.add(box(0.5, 0.05, 0.16, PAL.wood, x0 + bw - 0.4, 0.2, front + 0.75), box(0.5, 0.18, 0.03, PAL.wood, x0 + bw - 0.4, 0.22, front + 0.84)); // bench
  } else {
    g.add(gable(bw, bd, 0.5, L.roof, cx, top, cz), box(bw + 0.3, 0.05, 0.08, 0x3a2a22, cx, top + 0.49, cz));
  }
  if (kind === 'baker') { // oven chimney, baskets of loaves, a flour sack
    smoke.push(chimney(g, x0 + 0.3, cz - 0.2, top + 0.15, 0.75));
    for (const [x, c] of [[x0 + 0.3, 0xc98a4a], [x0 + 0.68, 0xe0b46a]] as const) crate(g, x, front + 0.55, c, 0.18, 0.25);
    g.add(box(0.8, 0.18, 0.3, PAL.woodDark, x0 + 0.5, 0, front + 0.55)); sack(g, x0 + bw - 0.35, front + 0.6);
  } else if (kind === 'dairy') { // churns by the door and a big bottle on the roof
    for (const [dx, dz] of [[0.2, 0.5], [0.42, 0.62], [0.64, 0.5]]) churn(g, x0 + dx, front + dz);
    g.add(box(0.5, 0.3, 0.5, L.wall, cx, top + 0.2, cz), cyl(0.2, 0.6, 0xfafafa, cx, top + 0.5, cz, 14), cyl(0.09, 0.2, 0xfafafa, cx, top + 1.1, cz, 14, 0.2), cyl(0.1, 0.07, L.a, cx, top + 1.3, cz, 14), cyl(0.205, 0.16, L.a, cx, top + 0.68, cz, 14)); // a bottle for a sign
    g.add(box(0.4, 0.3, 0.3, 0xdfe6ea, x0 + bw - 0.35, 0.05, front + 0.6), box(0.36, 0.2, 0.02, PAL.window, x0 + bw - 0.35, 0.12, front + 0.76)); // chilled cabinet
  } else if (kind === 'butcher') { // a rail of joints under the awning and a chopping block
    g.add(box(bw * 0.5, 0.025, 0.025, PAL.metalDark, cx - bw * 0.17, 0.58, front + 0.3));
    for (let i = 0; i < 4; i++) { const ham = cone(0.06, 0.2, 0x9c3a34, cx - bw * 0.36 + i * 0.3, 0.36, front + 0.3, 8); ham.rotation.x = Math.PI; ham.position.y = 0.47; g.add(ham); }
    g.add(cyl(0.14, 0.3, PAL.wood, x0 + bw - 0.3, 0.05, front + 0.6, 10)); smoke.push(chimney(g, x0 + bw - 0.3, cz - 0.2, top + 0.15, 0.6));
  } else if (kind === 'grocer') { // sloping stands of fruit and vegetables right across the pavement
    const fruits = [0xc94c4c, 0xe7a23b, 0x6fa84a, 0xb98a5a, 0xd9c84a, 0x7fb04f];
    for (let i = 0; i < 6; i++) crate(g, x0 + 0.22 + (i % 3) * 0.36, front + 0.45 + Math.floor(i / 3) * 0.3, fruits[i], 0.3 - Math.floor(i / 3) * 0.14, 0.3);
    g.add(box(1.1, 0.16, 0.62, PAL.woodDark, x0 + 0.58, 0.05, front + 0.6)); planter(g, x0 + bw - 0.25, front + 0.75, 0.16);
  }
  lampPost(g, w - 0.3, d - 0.3, 0.85);
  return finish(g, smoke);
}

/** Four shops of a kind merged: a market hall on a 6×6 lot, each with its own landmark. */
export function buildMarketHall(kind: ShopKind, w = 6, d = 6): Model {
  const g = new THREE.Group(), L = SHOP_LOOK[kind], smoke: THREE.Vector3[] = [], cx = w / 2;
  g.add(box(w - 0.1, 0.05, d - 0.1, 0xcfc6b2, w / 2, 0, d / 2, { rough: 1 }));
  const goods = { baker: 0xd9a05a, dairy: 0xfafafa, butcher: 0x9c3a34, grocer: 0xc94c4c, general: 0xc99a2e }[kind];
  if (kind === 'grocer') {
    // Farmers' market: an open timber pavilion with a cupola, stalls under it and out on the square
    const pw = 4.6, pd = 3.0, z0 = 0.5, ph = 1.35;
    for (const x of [0, 1, 2, 3]) for (const z of [0, 1]) g.add(box(0.12, ph, 0.12, PAL.woodDark, cx - pw / 2 + 0.2 + x * ((pw - 0.4) / 3), 0.05, z0 + 0.2 + z * (pd - 0.4)));
    g.add(box(pw, 0.1, pd, PAL.wood, cx, ph, z0 + pd / 2), gable(pw, pd, 1.0, L.roof, cx, ph + 0.1, z0 + pd / 2), box(pw + 0.3, 0.06, 0.1, 0x2f4a33, cx, ph + 1.08, z0 + pd / 2));
    g.add(box(0.7, 0.4, 0.7, PAL.cream, cx, ph + 0.95, z0 + pd / 2)); const cup = cone(0.6, 0.45, L.roof, cx, ph + 1.35, z0 + pd / 2, 4); cup.rotation.y = Math.PI / 4; g.add(cup);
    const f = [0xc94c4c, 0xe7a23b, 0x6fa84a, 0xd9c84a, 0xb98a5a, 0x8a5fb0];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) crate(g, cx - 1.6 + i * 1.05, z0 + 0.9 + j * 1.2, f[(i + j * 2) % 6], 0.3, 0.2), g.add(box(0.8, 0.26, 0.4, PAL.wood, cx - 1.6 + i * 1.05, 0.05, z0 + 0.9 + j * 1.2));
    for (let i = 0; i < 4; i++) stall(g, cx - 1.8 + i * 1.2, d - 1.25, [0x4f8a4a, 0xd98a3a, 0xa8322c, 0x5b8fc0][i], 0xf4f2ec, f[i]);
    for (let i = 0; i < 9; i++) g.add(box(0.14, 0.14, 0.02, [0xc94c4c, 0xe7a23b, 0x5b8fc0][i % 3], cx - pw / 2 + 0.4 + i * 0.48, ph - 0.22, z0 + pd + 0.02)); // bunting
    g.add(box(0.7, 0.3, 0.45, PAL.wood, 0.9, 0.2, d - 0.6), cyl(0.2, 0.05, PAL.woodDark, 0.6, 0.2, d - 0.35, 12)); // handcart
    planter(g, w - 0.6, d - 0.6, 0.26); planter(g, 0.6, 0.6, 0.22);
  } else if (kind === 'general') {
    // Commercial market: a two-storey arcade round a courtyard, with a clock tower
    const fh = 0.85, top = fh * 2;
    const block = (bx: number, bz: number, bw: number, bd: number) => { g.add(box(bw, top, bd, 0xe8d9b8, bx, 0.05, bz), box(bw + 0.1, 0.14, bd + 0.1, 0xb98a5a, bx, top + 0.05, bz), box(bw - 0.16, 0.02, bd - 0.16, 0xd9cdb4, bx, top + 0.19, bz), box(bw + 0.06, 0.05, bd + 0.06, 0xb98a5a, bx, fh, bz)); };
    block(cx, 1.2, 5.2, 1.6); block(0.95, 3.3, 1.5, 2.8); block(w - 0.95, 3.3, 1.5, 2.8);
    for (let i = 0; i < 7; i++) { const x = cx - 1.8 + i * 0.6; g.add(box(0.1, fh - 0.1, 0.1, PAL.white, x, 0.05, 2.05)); if (i < 6) { glassWin(g, 0.34, 0.5, x + 0.3, 0.12, 2.01); glassWin(g, 0.3, 0.36, x + 0.3, fh + 0.22, 2.01); } }
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) { const z = 2.3 + i * 0.62; glassWin(g, 0.36, 0.5, cx + sx * 2.29, 0.12, z, true); glassWin(g, 0.3, 0.36, cx + sx * 2.29, fh + 0.22, z, true); const a = box(0.34, 0.03, 0.5, [0xa8322c, 0xc99a2e, 0x4f8a8b, 0x4f8a4a][i], cx + sx * 2.05, fh - 0.2, z); a.rotation.z = sx * 0.3; g.add(a); }
    for (const sx of [-1, 1]) { // wing ends face the street: a shopfront each, and windows down the outer walls
      const x = cx + sx * (w / 2 - 0.95);
      glassWin(g, 0.9, 0.5, x, 0.14, 4.71); glassWin(g, 0.34, 0.36, x - 0.3, fh + 0.22, 4.71); glassWin(g, 0.34, 0.36, x + 0.3, fh + 0.22, 4.71); awning(g, 1.1, x - 0.55, fh - 0.14, 4.71, sx < 0 ? 0xa8322c : 0x4f8a8b, 0xf4f2ec);
      for (let i = 0; i < 4; i++) { glassWin(g, 0.36, 0.44, cx + sx * (w / 2 - 0.19), 0.16, 2.3 + i * 0.62, true); glassWin(g, 0.3, 0.36, cx + sx * (w / 2 - 0.19), fh + 0.22, 2.3 + i * 0.62, true); }
    }
    for (let i = 0; i < 2; i++) { glassWin(g, 0.3, 0.36, cx + 2.61, fh + 0.22, 0.8 + i * 0.7, true); glassWin(g, 0.36, 0.44, cx + 2.61, 0.16, 0.8 + i * 0.7, true); }
    g.add(box(0.9, 3.3, 0.9, 0xe8d9b8, cx, 0.05, 1.2), box(1.0, 0.1, 1.0, 0xb98a5a, cx, 2.6, 1.2)); g.add(disc(0.28, 0xfafafa, cx, 2.95, 1.67), disc(0.04, 0x2a2216, cx, 2.95, 1.7));
    { const side = disc(0.28, 0xfafafa, cx + 0.47, 2.95, 1.2); side.rotation.z = Math.PI / 2; g.add(side); }
    const cap = cone(0.75, 0.6, L.roof, cx, 3.35, 1.2, 4); cap.rotation.y = Math.PI / 4; g.add(cap);
    g.add(cyl(0.45, 0.12, PAL.stone, cx, 0.05, 3.6, 12), cyl(0.36, 0.04, 0x7fb6d6, cx, 0.17, 3.6, 12), cyl(0.06, 0.4, PAL.stone, cx, 0.17, 3.6, 8)); // fountain
    stall(g, cx - 0.95, 4.9, 0xa8322c, 0xf4f2ec, goods); stall(g, cx + 0.95, 4.9, 0x4f8a8b, 0xf4f2ec, 0xd673a4); stall(g, cx, 2.7, 0xc99a2e, 0xf4f2ec, 0x8a5fb0, Math.PI);
    lampPost(g, 0.5, d - 0.4); lampPost(g, w - 0.5, d - 0.4);
  } else {
    // Bakers' hall, Dairy hall and Meat market: a big gabled hall with a tall glazed front, awnings and its trade outside
    const hw = 4.8, hd = 3.3, z0 = 0.45, cz = z0 + hd / 2, front = z0 + hd, wh = 1.7, rh = 1.15;
    g.add(box(hw + 0.08, 0.16, hd + 0.08, PAL.stoneDark, cx, 0.05, cz), box(hw, wh, hd, L.wall, cx, 0.05, cz), gable(hw, hd, rh, L.roof, cx, wh + 0.05, cz), box(hw + 0.3, 0.06, 0.1, 0x3a2a22, cx, wh + rh + 0.03, cz));
    g.add(box(hw + 0.1, 0.07, hd + 0.1, PAL.white, cx, wh - 0.02, cz));
    g.add(box(hw * 0.6, 0.34, 0.7, L.wall, cx, wh + rh - 0.2, cz), gable(hw * 0.6, 0.7, 0.3, L.roof, cx, wh + rh + 0.14, cz)); for (let i = 0; i < 5; i++) glassWin(g, 0.36, 0.2, cx - hw * 0.24 + i * hw * 0.12, wh + rh - 0.1, cz + 0.36); // roof lantern
    for (const sx of [-1, 1]) g.add(box(0.14, wh, 0.1, PAL.white, cx + sx * (hw / 2 - 0.07), 0.05, front + 0.02), box(0.14, wh, 0.1, PAL.white, cx + sx * 0.75, 0.05, front + 0.02)); // pilasters
    g.add(box(1.2, 1.05, 0.05, PAL.door, cx, 0.05, front + 0.02)); glassWin(g, 1.0, 0.36, cx, 1.15, front + 0.03); g.add(disc(0.6, PAL.white, cx, 1.52, front + 0.0)); // arched doorway
    for (const sx of [-1, 1]) { glassWin(g, 1.1, 0.7, cx + sx * 1.6, 0.75, front + 0.02); for (const dx of [-0.28, 0, 0.28]) g.add(box(0.03, 0.7, 0.045, PAL.white, cx + sx * 1.6 + dx, 0.75, front + 0.025)); awning(g, 1.25, cx + sx * 1.6 - 0.625, 0.62, front + 0.02, L.a, L.b); }
    for (let i = 0; i < 4; i++) glassWin(g, 0.5, 0.6, cx + hw / 2 + 0.01, 0.7, z0 + 0.5 + i * 0.78, true);
    g.add(box(2.2, 0.3, 0.06, L.sign, cx, wh - 0.42, front + 0.04), box(1.5, 0.1, 0.07, L.b, cx, wh - 0.32, front + 0.045)); // name board
    if (kind === 'baker') {
      g.add(disc(0.36, PAL.window, cx, wh + 0.5, front + 0.13), disc(0.42, PAL.white, cx, wh + 0.5, front + 0.12)); // rose window in the gable
      smoke.push(chimney(g, cx - 1.7, cz - 0.5, wh + 0.4, 1.1), chimney(g, cx + 1.7, cz - 0.5, wh + 0.4, 1.1));
      stall(g, cx - 1.7, d - 1.1, L.a, L.b, 0xc98a4a); stall(g, cx + 1.7, d - 1.1, L.a, L.b, 0xe0b46a);
      for (const [x, z] of [[cx - 0.5, d - 0.8], [cx - 0.2, d - 0.7], [cx + 0.2, d - 0.85]]) sack(g, x, z);
      g.add(box(0.7, 0.3, 0.45, PAL.wood, w - 0.8, 0.2, d - 0.6), cyl(0.2, 0.05, PAL.woodDark, w - 0.5, 0.2, d - 0.35, 12)); crate(g, w - 0.8, d - 0.6, 0xc98a4a, 0.5);
    } else if (kind === 'dairy') {
      g.add(cyl(0.42, 1.5, 0xfafafa, 0.9, 0.05, d - 1.0, 14), cyl(0.2, 0.45, 0xfafafa, 0.9, 1.55, d - 1.0, 14, 0.42), cyl(0.22, 0.12, L.a, 0.9, 2.0, d - 1.0, 14), box(0.9, 0.12, 0.9, PAL.stoneDark, 0.9, 0, d - 1.0)); // the giant bottle
      for (let i = 0; i < 5; i++) churn(g, cx - 0.6 + i * 0.3, d - 0.9 + (i % 2) * 0.14);
      g.add(box(0.75, 0.55, 1.3, 0xf4f2ec, w - 0.9, 0.12, d - 1.1), box(0.7, 0.4, 0.4, L.a, w - 0.9, 0.12, d - 0.35), box(0.6, 0.18, 0.02, PAL.window, w - 0.9, 0.34, d - 0.14)); // milk float
      for (const dx of [-0.6, 0.6]) g.add(box(0.5, 0.3, 0.4, PAL.metal, cx + dx, wh + 0.55, cz - 0.9));
    } else {
      g.add(box(1.5, 1.1, 1.6, 0xe9ecec, w - 1.0, 0.05, 1.3), box(1.6, 0.08, 1.7, PAL.metalDark, w - 1.0, 1.15, 1.3)); for (const dz of [-0.4, 0.4]) g.add(box(0.4, 0.25, 0.4, PAL.metal, w - 1.0, 1.23, 1.3 + dz)); // cold room
      g.add(box(1.9, 0.03, 0.03, PAL.metalDark, cx - 1.6, 0.6, front + 0.42)); for (let i = 0; i < 6; i++) { const ham = cone(0.07, 0.24, 0x9c3a34, cx - 2.4 + i * 0.32, 0, front + 0.42, 8); ham.rotation.x = Math.PI; ham.position.y = 0.47; g.add(ham); }
      smoke.push(chimney(g, cx - 1.6, cz - 0.6, wh + 0.4, 1.0));
      stall(g, cx + 1.5, d - 1.1, L.a, L.b, goods); g.add(cyl(0.2, 0.36, PAL.wood, cx - 0.4, 0.05, d - 0.8, 10), cyl(0.2, 0.36, PAL.wood, cx + 0.2, 0.05, d - 0.7, 10));
    }
    lampPost(g, 0.45, d - 0.4); lampPost(g, w - 0.45, d - 0.4); planter(g, 0.6, 0.7, 0.24);
  }
  return finish(g, smoke);
}

/** Four markets merged: a two-storey mall with a glass atrium and a car park on a 12×12 lot; its upgrade adds an office tower. */
export function buildMall(w = 12, d = 12, tower = false): Model {
  const g = new THREE.Group(), cx = w / 2, bw = 10.4, bd = 6.2, z0 = 0.5, cz = z0 + bd / 2, front = z0 + bd, fh = 1.05, top = fh * 2;
  const wall = 0xe9e2d2, band = 0xb5643c, glass = mat(PAL.glass, { opacity: 0.8, rough: 0.2 });
  g.add(box(w - 0.1, 0.05, d - 0.1, 0xcfc6b2, w / 2, 0, d / 2, { rough: 1 }));
  g.add(box(bw, top, bd, wall, cx, 0.05, cz), box(bw + 0.14, 0.2, bd + 0.14, band, cx, top + 0.05, cz), box(bw + 0.06, 0.08, bd + 0.06, band, cx, fh, cz), box(bw - 0.3, 0.04, bd - 0.3, 0xa39d90, cx, top + 0.22, cz));
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) { const sk = box(1.0, 0.1, 0.7, 0, cx + sx * (2.4 + (i % 2) * 1.5), top + 0.26, z0 + 1.1 + i * 1.9); sk.material = glass; g.add(sk); }
  // glass atrium down the middle, rising through the roof, and a glazed entrance under a canopy
  const at = gable(bd + 0.6, 2.0, 0.9, 0, cx, top + 0.5, cz); at.material = glass; at.rotation.y = Math.PI / 2; g.add(at);
  g.add(box(2.0, 0.5, bd + 0.6, 0xf4f2ec, cx, top, cz));
  for (let i = 0; i < 6; i++) g.add(box(2.3, 0.05, 0.06, PAL.white, cx, top + 0.5, z0 + 0.2 + i * (bd / 5)));
  const ent = box(2.6, top + 0.3, 0.5, 0, cx, 0.05, front + 0.2); ent.material = glass; ent.userData.window = true; g.add(ent);
  for (const dx of [-1.3, -0.45, 0.45, 1.3]) g.add(box(0.06, top + 0.3, 0.06, PAL.white, cx + dx, 0.05, front + 0.46));
  g.add(box(3.4, 0.1, 1.2, band, cx, 0.95, front + 0.9), box(0.1, 0.9, 0.1, PAL.white, cx - 1.5, 0.05, front + 1.4), box(0.1, 0.9, 0.1, PAL.white, cx + 1.5, 0.05, front + 1.4));
  g.add(box(0.5, 2.6, 0.3, 0x2a3540, w - 0.9, 0.05, d - 0.6), box(0.56, 0.5, 0.36, band, w - 0.9, 2.1, d - 0.6), box(0.4, 0.3, 0.38, 0xffe2a0, w - 0.9, 1.6, d - 0.6, { emissive: 0x6b5a2a }), box(0.4, 0.3, 0.38, 0xf4f2ec, w - 0.9, 1.15, d - 0.6)); // sign pylon by the road
  // shopfronts on both floors, each with its own colour
  const cols = [0xa8322c, 0x4f8a8b, 0xc99a2e, 0x4f8a4a, 0x6b7fa8, 0xd98a3a, 0xb5643c, 0x5b8fc0];
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {
    const x = cx + sx * (1.75 + i * 0.95);
    glassWin(g, 0.7, 0.56, x, 0.2, front + 0.01); glassWin(g, 0.7, 0.5, x, fh + 0.28, front + 0.01);
    awning(g, 0.75, x - 0.375, 0.82, front + 0.01, cols[(i + (sx > 0 ? 4 : 0)) % 8], 0xf4f2ec);
  }
  for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) { glassWin(g, 0.6, 0.5, cx + sx * (bw / 2 + 0.01), 0.22, z0 + 0.6 + i * 1.0, true); glassWin(g, 0.6, 0.46, cx + sx * (bw / 2 + 0.01), fh + 0.3, z0 + 0.6 + i * 1.0, true); }
  for (const [x, z] of [[cx - 3.6, cz - 1.5], [cx - 3.0, cz + 1.2], [cx + 3.4, cz - 1.0], [cx + 2.8, cz + 1.6]]) g.add(box(0.7, 0.3, 0.5, PAL.metal, x, top + 0.24, z)); // rooftop plant
  // car park
  const pz = front + 2.6;
  g.add(box(w - 0.6, 0.02, 3.6, 0x55585a, cx, 0.05, pz + 0.55, { rough: 1 }));
  for (let i = 0; i <= 12; i++) if (Math.abs(0.9 + i * 0.85 - cx) > 1.2) g.add(box(0.03, 0.01, 0.9, 0xf4f2ec, 0.9 + i * 0.85, 0.07, pz + 1.7), box(0.03, 0.01, 0.9, 0xf4f2ec, 0.9 + i * 0.85, 0.07, pz - 0.2));
  [[1.3, 1.7, 0xa8322c], [3.0, 1.7, 0xf4f2ec], [8.95, 1.7, 0x4f7aa0], [10.65, 1.7, 0xc99a2e], [2.15, -0.2, 0x4f8a4a], [9.8, -0.2, 0x8f979b], [3.85, -0.2, 0x2a3540]].forEach(([x, dz, c]) => carProp(g, x, pz + dz, c));
  for (const x of [0.6, 4.0, 8.0, w - 0.6]) { planter(g, x, front + 0.9, 0.26); lampPost(g, x, d - 0.35, 1.2); }
  if (tower) { // the office tower: bands of glass, a crown and a mast
    const tw = 2.8, tx = cx - bw / 2 + tw / 2 + 0.3, tz = z0 + tw / 2 + 0.3, th = 9.0, floors = 12;
    g.add(box(tw, th, tw, 0xdfe4e6, tx, top + 0.05, tz));
    for (let f = 0; f < floors; f++) { const y = top + 0.3 + f * (th / floors); glassWin(g, tw - 0.3, 0.42, tx, y, tz + tw / 2 + 0.01); glassWin(g, tw - 0.3, 0.42, tx + tw / 2 + 0.01, y, tz, true); glassWin(g, tw - 0.3, 0.42, tx - tw / 2 - 0.01, y, tz, true); }
    for (const sx of [-1, 1]) g.add(box(0.12, th, 0.12, PAL.white, tx + sx * (tw / 2 - 0.04), top + 0.05, tz + tw / 2), box(0.12, th, 0.12, PAL.white, tx + sx * (tw / 2 - 0.04), top + 0.05, tz - tw / 2));
    g.add(box(tw + 0.16, 0.25, tw + 0.16, band, tx, top + th, tz));
    const sw = tw - 0.8, sh = 2.2; g.add(box(sw, sh, sw, 0xdfe4e6, tx, top + th + 0.25, tz));
    for (let f = 0; f < 3; f++) { const y = top + th + 0.5 + f * 0.7; glassWin(g, sw - 0.3, 0.42, tx, y, tz + sw / 2 + 0.01); glassWin(g, sw - 0.3, 0.42, tx + sw / 2 + 0.01, y, tz, true); }
    g.add(box(sw + 0.14, 0.2, sw + 0.14, band, tx, top + th + 0.25 + sh, tz), box(sw - 0.7, 0.4, sw - 0.7, 0xc9d0d3, tx, top + th + 0.45 + sh, tz), box(0.05, 1.6, 0.05, PAL.metalDark, tx, top + th + 0.85 + sh, tz), sphere(0.07, 0xc0392b, tx, top + th + 2.5 + sh, tz, { emissive: 0x7a1a12 }));
  }
  return finish(g);
}

// ---------------------------------------------------------------- towers: apartments and offices grow upward
/** Apartment levels 2 and 3 on the same 3×3 lot: an eight-storey mid-rise under a mansard roof, then a sixteen-storey tower with a setback crown. (Level 1 is buildCommunityHome's block.) */
export function buildApartmentTower(level: 2 | 3, w = 3, d = 3, key = ''): Model {
  const g = new THREE.Group(), wall = WALLS[pick(key + 'w', WALLS.length)], roof = ROOFS[pick(key + 'r', ROOFS.length)], accent = [0x4f8a8b, 0xb5643c, 0xc99a2e, 0x6b7fa8][pick(key + 'a', 4)];
  const tall = level === 3, bw = tall ? w - 0.9 : w - 0.6, bd = tall ? d - 1.4 : d - 1.25, style = pick(key + 'v', 3), floors = tall ? [14, 16, 18][pick(key + 'h', 3)] : [7, 8, 9][pick(key + 'h', 3)], fh = 0.6, top = floors * fh, cx = w / 2, cz = 0.4 + bd / 2, front = cz + bd / 2, side = cx + bw / 2;
  g.add(box(w - 0.1, 0.05, d - 0.1, PAL.stone, w / 2, 0, d / 2, { rough: 1 }));
  g.add(box(bw + 0.06, fh, bd + 0.06, 0xd9d0bd, cx, 0, cz), box(bw, top - fh, bd, wall, cx, fh, cz), box(bw + 0.1, 0.06, bd + 0.1, PAL.white, cx, fh - 0.02, cz));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.08, top - fh, 0.08, PAL.white, cx + sx * (bw / 2 - 0.02), fh, cz + sz * (bd / 2 - 0.02))); // corner piers
  const cols = [-1.5, -0.5, 0.5, 1.5].map((c) => cx + c * (bw / 4));
  for (let f = 0; f < floors; f++) {
    const y = f * fh + 0.2;
    cols.forEach((x, c) => {
      if (f === 0 && (c === 1 || c === 2)) return;
      g.add(box(0.32, 0.36, 0.02, PAL.white, x, y - 0.02, front + 0.005)); glassWin(g, 0.24, 0.28, x, y + 0.02, front + 0.012);
      if (f > 0 && (c === 0 || c === 3)) { g.add(box(0.44, 0.04, 0.18, PAL.white, x, f * fh + 0.12, front + 0.09), box(0.44, 0.14, 0.015, accent, x, f * fh + 0.16, front + 0.18)); if (hashStr(key + f + c) > 0.6) g.add(sphere(0.055, 0x5f8f4a, x + 0.14, f * fh + 0.22, front + 0.1)); }
    });
    for (const z of [cz - bd / 4, cz + bd / 4]) { g.add(box(0.02, 0.36, 0.3, PAL.white, side + 0.005, y - 0.02, z)); glassWin(g, 0.22, 0.28, side + 0.012, y + 0.02, z, true); }
    if (f > 0 && f % 4 === 0) g.add(box(bw + 0.06, 0.04, bd + 0.06, PAL.white, cx, f * fh - 0.02, cz)); // a band every fourth floor
  }
  // the stair and lift core, glazed, standing proud between the two middle bays
  g.add(box(0.5, top, 0.12, 0xe9e2d2, cx, 0, front + 0.05)); for (let f = 1; f < floors; f++) glassWin(g, 0.22, 0.4, cx, f * fh + 0.1, front + 0.12);
  g.add(box(0.44, 0.5, 0.04, PAL.door, cx, 0, front + 0.12), box(0.9, 0.05, 0.5, accent, cx, 0.58, front + 0.3), box(0.04, 0.56, 0.04, PAL.white, cx - 0.4, 0, front + 0.5), box(0.04, 0.56, 0.04, PAL.white, cx + 0.4, 0, front + 0.5));
  g.add(box(bw + 0.14, 0.1, bd + 0.14, PAL.white, cx, top - 0.02, cz));
  if (style === 1) { // a flat roof: a roof garden behind the parapet, a glazed penthouse and the water tanks
    g.add(box(bw - 0.1, 0.04, bd - 0.1, 0x8f8a80, cx, top + 0.08, cz), box(bw * 0.45, 0.06, bd * 0.5, 0x6f9a4a, cx - bw * 0.2, top + 0.1, cz));
    for (const [dx, dz] of [[-0.35, -0.2], [-0.15, 0.25], [-0.45, 0.2]]) g.add(sphere(0.12, 0x5f8f4a, cx + dx * (bw / 1.4), top + 0.24, cz + dz));
    g.add(box(bw * 0.4, 0.5, bd * 0.6, 0xe9e2d2, cx + bw * 0.22, top + 0.1, cz), box(bw * 0.44, 0.05, bd * 0.66, accent, cx + bw * 0.22, top + 0.6, cz)); glassWin(g, bw * 0.3, 0.3, cx + bw * 0.22, top + 0.2, cz + bd * 0.3 + 0.012);
    g.add(cyl(0.16, 0.3, PAL.metal, cx + bw * 0.3, top + 0.66, cz - 0.2, 12)); if (tall) g.add(box(0.03, 1.0, 0.03, PAL.metalDark, cx - bw * 0.35, top + 0.1, cz - bd * 0.3), sphere(0.05, 0xc0392b, cx - bw * 0.35, top + 1.13, cz - bd * 0.3, { emissive: 0x7a1a12 }));
  } else if (style === 2 && tall) { // stepped back twice under a slender spire
    let y = top + 0.08, sw = bw - 0.5, sd = bd - 0.4;
    for (let k = 0; k < 2; k++) { g.add(box(sw, fh * 2, sd, wall, cx, y, cz), box(sw + 0.1, 0.08, sd + 0.1, PAL.white, cx, y + fh * 2, cz)); for (let f = 0; f < 2; f++) { glassWin(g, sw - 0.3, 0.3, cx, y + 0.16 + f * fh, cz + sd / 2 + 0.012); glassWin(g, sd - 0.3, 0.3, cx + sw / 2 + 0.012, y + 0.16 + f * fh, cz, true); } y += fh * 2 + 0.08; sw -= 0.5; sd -= 0.4; }
    g.add(cone(0.28, 1.4, roof, cx, y, cz, 8), sphere(0.05, 0xc0392b, cx, y + 1.42, cz, { emissive: 0x7a1a12 }));
    g.add(box(bw + 0.3, 0.3, 0.5, 0xd9d0bd, cx, 0, front + 0.3));
  } else if (!tall) { // a mansard roof with dormers, and the lift house
    g.add(box(bw - 0.1, 0.5, bd - 0.1, roof, cx, top + 0.08, cz), box(bw - 0.4, 0.06, bd - 0.4, 0x3a2a22, cx, top + 0.58, cz));
    for (const x of [cx - bw / 4, cx + bw / 4]) { g.add(box(0.3, 0.3, 0.12, wall, x, top + 0.14, front - 0.02)); glassWin(g, 0.18, 0.18, x, top + 0.2, front + 0.045); }
    g.add(box(0.6, 0.35, 0.6, 0xe9e2d2, cx - 0.3, top + 0.64, cz - 0.2), cyl(0.2, 0.34, PAL.metal, cx + 0.55, top + 0.74, cz - 0.2, 12)); for (const [dx, dz] of [[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13]]) g.add(box(0.03, 0.12, 0.03, PAL.metalDark, cx + 0.55 + dx, top + 0.64, cz - 0.2 + dz));
  } else { // a two-storey setback under a pitched crown, with a mast
    const sw = bw - 0.6, sd = bd - 0.5;
    g.add(box(sw, fh * 2, sd, wall, cx, top + 0.08, cz), box(sw + 0.1, 0.08, sd + 0.1, PAL.white, cx, top + 0.08 + fh * 2, cz));
    for (let f = 0; f < 2; f++) { for (const dx of [-0.4, 0, 0.4]) glassWin(g, 0.24, 0.3, cx + dx, top + 0.24 + f * fh, cz + sd / 2 + 0.012); glassWin(g, 0.5, 0.3, cx + sw / 2 + 0.012, top + 0.24 + f * fh, cz, true); }
    const cr = cone(Math.hypot(sw, sd) / 2 + 0.06, 0.9, roof, cx, top + 0.16 + fh * 2, cz, 4); cr.rotation.y = Math.PI / 4; cr.scale.set(1, 1, sd / sw); g.add(cr);
    g.add(box(0.04, 0.9, 0.04, PAL.metalDark, cx, top + 1.0 + fh * 2, cz), sphere(0.06, 0xc0392b, cx, top + 1.95 + fh * 2, cz, { emissive: 0x7a1a12 }));
    g.add(box(bw + 0.3, 0.3, 0.5, 0xd9d0bd, cx, 0, front + 0.3)); // a podium step along the front
  }
  for (const x of [0.38, w - 0.38]) g.add(box(0.5, 0.24, 0.22, 0x5f8f4a, x, 0, d - 0.3)); lampPost(g, cx + 0.6, d - 0.4, 0.8);
  return finish(g);
}

/** Offices on a 3×3 lot: a three-storey block, a seven-storey mid-rise, then an eighteen-storey glass tower with setbacks. */
export function buildOffice(level: 1 | 2 | 3, w = 3, d = 3, key = ''): Model {
  const style = pick(key + 'o', 3), tint = [0x2f5f8f, 0x2f6f5a, 0x8a6a3a][pick(key + 't', 3)];
  const g = new THREE.Group(), floors = [3, 7, [18, 20, 16][style]][level - 1], fh = 0.56, bw = level === 3 ? w - 0.8 : w - 0.5, bd = level === 3 ? d - 1.2 : d - 1.1, top = floors * fh, cx = w / 2, cz = 0.35 + bd / 2, front = cz + bd / 2;
  const stone = level === 1 ? 0xe9e2d2 : 0xdfe4e6, band = level === 3 ? tint : [0xb5643c, tint, 0x6b4a36][style];
  g.add(box(w - 0.1, 0.05, d - 0.1, 0xcfc6b2, w / 2, 0, d / 2, { rough: 1 }));
  const shaft = (sw: number, sd: number, y0: number, n: number) => {
    g.add(box(sw, n * fh, sd, stone, cx, y0, cz));
    for (let f = 0; f < n; f++) { const y = y0 + f * fh + 0.12; if (y0 === 0 && f === 0) continue; glassWin(g, sw - 0.24, 0.34, cx, y, cz + sd / 2 + 0.012); glassWin(g, sd - 0.24, 0.34, cx + sw / 2 + 0.012, y, cz, true); glassWin(g, sd - 0.24, 0.34, cx - sw / 2 - 0.012, y, cz, true); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.1, n * fh, 0.1, PAL.white, cx + sx * (sw / 2 - 0.03), y0, cz + sz * (sd / 2 - 0.03)));
    for (let i = 1; i < 4; i++) g.add(box(0.035, n * fh - (y0 ? 0 : fh), 0.04, PAL.white, cx - sw / 2 + (i * sw) / 4, y0 + (y0 ? 0 : fh), cz + sd / 2 + 0.02)); // mullions
    g.add(box(sw + 0.12, 0.12, sd + 0.12, band, cx, y0 + n * fh, cz));
  };
  if (level < 3) shaft(bw, bd, 0, floors);
  else if (style === 0) { shaft(bw, bd, 0, 11); shaft(bw - 0.5, bd - 0.4, 11 * fh + 0.12, 5); shaft(bw - 1.0, bd - 0.8, 16 * fh + 0.24, 2); }
  else if (style === 1) { // one sheer slab under a sloping glass crown
    shaft(bw - 0.3, bd, 0, 20);
    const cr = box(bw - 0.3, 0.9, bd, 0, cx, 20 * fh + 0.12, cz); cr.material = mat(PAL.glass, { opacity: 0.85, rough: 0.2 }); cr.geometry = cached(`wedge${bw},${bd}`, () => { const ge = new THREE.BoxGeometry(bw - 0.3, 0.9, bd); const pa = ge.getAttribute('position'); for (let i = 0; i < pa.count; i++) if (pa.getY(i) > 0 && pa.getZ(i) > 0) pa.setY(i, -0.25); ge.computeVertexNormals(); return ge; }); g.add(cr);
  } else { // a round tower ringed with glass, on a square base
    shaft(bw, bd, 0, 3);
    const r = Math.min(bw, bd) / 2 - 0.1, y0 = 3 * fh + 0.12, n = 13;
    g.add(cyl(r, n * fh, stone, cx, y0, cz, 20));
    for (let f = 0; f < n; f++) { const ring = cyl(r + 0.012, 0.34, PAL.window, cx, y0 + f * fh + 0.12, cz, 20); ring.userData.window = true; g.add(ring); }
    g.add(cyl(r + 0.08, 0.12, band, cx, y0 + n * fh, cz, 20), cyl(r - 0.3, 0.5, 0xc9d0d3, cx, y0 + n * fh + 0.12, cz, 16));
  }
  // ground floor: a glazed lobby under a canopy
  const lobby = box(bw - 0.3, fh - 0.08, 0.05, 0, cx, 0.04, front + 0.02); lobby.material = mat(PAL.glass, { opacity: 0.8, rough: 0.2 }); lobby.userData.window = true; g.add(lobby);
  g.add(box(bw * 0.6, 0.06, 0.5, band, cx, fh - 0.02, front + 0.28), box(0.3, 0.42, 0.04, PAL.door, cx, 0.04, front + 0.05));
  if (level === 1) g.add(box(bw - 0.3, 0.04, bd - 0.3, 0xa39d90, cx, top + 0.12, cz), box(0.5, 0.25, 0.4, PAL.metal, cx + 0.5, top + 0.14, cz - 0.2), box(0.03, 1.0, 0.03, PAL.metalDark, cx - 0.7, top + 0.12, cz), box(0.36, 0.22, 0.02, band, cx - 0.52, top + 0.9, cz));
  else if (level === 2) g.add(box(0.7, 0.4, 0.7, stone, cx - 0.3, top + 0.12, cz), box(0.5, 0.25, 0.4, PAL.metal, cx + 0.6, top + 0.14, cz - 0.2), box(1.2, 0.3, 0.06, 0x2a3540, cx, top + 0.14, front - 0.1));
  else { const y = (style === 0 ? 18 * fh + 0.36 : style === 1 ? 20 * fh + 0.9 : 16 * fh + 0.86); g.add(box(0.6, 0.3, 0.6, 0xc9d0d3, cx, y, cz), box(0.05, 1.6, 0.05, PAL.metalDark, cx, y + 0.3, cz), sphere(0.07, 0xc0392b, cx, y + 1.95, cz, { emissive: 0x7a1a12 })); }
  planter(g, 0.45, d - 0.45, 0.2); planter(g, w - 0.45, d - 0.45, 0.2); lampPost(g, cx - 0.9, d - 0.3, 0.85);
  if (level > 1) carProp(g, cx + 0.3, d - 0.38, 0x2a3540, Math.PI / 2);
  return finish(g);
}

// ---------------------------------------------------------------- merged factories: two of a kind make a Works, two Works a Plant
const WORKS_LOOK: Record<string, { wall: number; roof: number; door: 'barn' | 'house' | 'roller' }> = {
  flourMill: { wall: 0xe9e2d2, roof: PAL.roofRed, door: 'roller' }, bakery: { wall: PAL.brick, roof: PAL.roofBrown, door: 'roller' }, feedMill: { wall: 0x9aa59c, roof: PAL.roofGrey, door: 'roller' },
  ranch: { wall: PAL.barnRed, roof: PAL.roofGrey, door: 'barn' }, dairy: { wall: PAL.white, roof: PAL.roofBlue, door: 'roller' }, creamery: { wall: PAL.cream, roof: PAL.roofBlue, door: 'roller' },
  oilPress: { wall: 0xd9b77e, roof: PAL.roofGreen, door: 'roller' }, sugarMill: { wall: PAL.brick, roof: PAL.roofGrey, door: 'roller' }, winery: { wall: 0xcfc4ad, roof: 0xb5643c, door: 'barn' },
};
const tankV = (g: THREE.Group, x: number, z: number, r = 0.34, h = 1.3, c = PAL.metal) => { g.add(cyl(r, h, c, x, 0.05, z, 14), cone(r, 0.22, c, x, 0.05 + h, z, 14), box(0.04, h, 0.04, PAL.metalDark, x + r, 0.05, z)); };
const lorry = (g: THREE.Group, x: number, z: number, c: number, rot = 0) => { const k = new THREE.Group(); k.add(box(0.5, 0.55, 1.1, c, 0, 0.14, -0.15), box(0.46, 0.4, 0.36, 0xe9ecec, 0, 0.14, 0.62), box(0.4, 0.16, 0.02, PAL.window, 0, 0.36, 0.81)); for (const [dx, dz] of [[-0.24, -0.5], [0.24, -0.5], [-0.24, 0.55], [0.24, 0.55]]) { const wl = cyl(0.11, 0.07, 0x2a2a2a, 0, 0, 0, 10); wl.rotation.z = Math.PI / 2; wl.position.set(dx, 0.11, dz); k.add(wl); } k.position.set(x, 0, z); k.rotation.y = rot; g.add(k); };
/** A merged factory drawn as one larger works (size 2) or plant (size 4), in the colours and with the trade marks of the building it grew from. */
export function buildWorks(type: string, size: 2 | 4, w: number, d: number): Model {
  const g = new THREE.Group(), L = WORKS_LOOK[type] ?? WORKS_LOOK.flourMill, smoke: THREE.Vector3[] = [], big = size === 4;
  g.add(box(w - 0.1, 0.06, d - 0.1, PAL.stone, w / 2, 0, d / 2, { rough: 1 }));
  // the halls: one long main hall, and on a plant a second behind it joined by a link block
  const hw = Math.max(2.2, w * 0.62), hd = big ? Math.max(1.6, d * 0.34) : Math.max(1.4, d * 0.58), wh = big ? 2.6 : 2.2; // taller than the level-3 buildings it replaces
  shed(g, hw, hd, wh, L.wall, L.roof, 0.25, 0.25, { door: L.door, windows: Math.max(3, Math.round(hw / 0.8)), roofH: 0.55 });
  if (big) { shed(g, hw, hd, wh - 0.3, L.wall, L.roof, 0.25, 0.25 + hd + 0.5, { door: L.door, windows: Math.max(3, Math.round(hw / 0.8)), roofH: 0.5 }); g.add(box(0.9, wh - 0.5, 0.5, L.wall, 0.25 + hw / 2, 0.06, 0.25 + hd + 0.25), box(1.0, 0.06, 0.6, PAL.metalDark, 0.25 + hw / 2, wh - 0.44, 0.25 + hd + 0.25)); }
  for (let i = 0; i < (big ? 4 : 2); i++) g.add(cyl(0.1, 0.2, PAL.metal, 0.9 + i * ((hw - 1.2) / (big ? 3 : 1)), wh + 0.42, 0.25 + hd / 2, 8)); // roof vents
  const fx = 0.25 + hw + 0.25, fw = w - fx - 0.2, fz = 0.3; // the yard beside the halls, for what makes this trade its own
  const row = (n: number, fn: (x: number, z: number, i: number) => void, z0 = fz + 0.5, dz = 0.95) => { for (let i = 0; i < n; i++) fn(fx + fw / 2 + ((i % 2) - 0.5) * Math.min(0.9, fw * 0.45), z0 + Math.floor(i / 2) * dz, i); };
  if (type === 'flourMill') { g.add(box(1.0, wh + 1.5, 0.9, L.wall, 0.25 + hw - 0.5, 0.06, 0.25 + hd / 2), box(1.1, 0.1, 1.0, PAL.metalDark, 0.25 + hw - 0.5, wh + 1.56, 0.25 + hd / 2)); for (let f = 0; f < 2; f++) glassWin(g, 0.5, 0.3, 0.25 + hw - 0.5, wh + 0.5 + f * 0.55, 0.25 + hd / 2 + 0.46); row(big ? 4 : 2, (x, z) => silo(g, x, z, 0.38, big ? 2.9 : 2.5)); g.add(box(0.3, big ? 3.6 : 3.1, 0.3, 0xc0392b, fx + fw / 2, 0.06, fz + 0.1), box(0.4, 0.3, 0.4, PAL.metalDark, fx + fw / 2, big ? 3.66 : 3.16, fz + 0.1)); for (let i = 0; i < 3; i++) sack(g, 0.6 + i * 0.3, d - 0.4); }
  else if (type === 'bakery') { for (let i = 0; i < (big ? 4 : 2); i++) smoke.push(chimney(g, 0.8 + i * ((hw - 1) / (big ? 3 : 1)), 0.25 + hd * 0.3, wh + 0.2, 1.0)); row(big ? 2 : 1, (x, z, i) => lorry(g, x, z + 0.4, [0xd98a3a, 0xf4f2ec][i % 2])); awning(g, Math.min(2, hw - 0.5), 0.5, 0.75, 0.25 + hd + (big ? hd + 0.5 : 0) + 0.02, 0xd98a3a, 0xfff3dc); crate(g, 0.8, d - 0.35, 0xc98a4a); }
  else if (type === 'feedMill') { row(big ? 4 : 2, (x, z) => { g.add(cyl(0.34, 0.9, 0xc9cfc8, x, 1.0, z, 12), cone(0.34, 0.5, 0xc9cfc8, x, 0.5, z, 12)); for (const [dx, dz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) g.add(box(0.05, 1.0, 0.05, PAL.metalDark, x + dx, 0.06, z + dz)); }); const cv = box(0.16, 0.1, Math.hypot(1.6, 1.2), PAL.metalDark, fx - 0.1, 1.5, fz + 0.9); cv.rotation.x = -0.6; g.add(cv); pallet(g, 0.7, d - 0.4, 0xd8c9a0); pallet(g, 1.15, d - 0.4, 0xc9b98a); }
  else if (type === 'ranch') { fenceRect(g, fw + 0.1, d - 0.9, fx - 0.05, 0.4, 0.34); for (let i = 0; i < (big ? 6 : 3); i++) g.add(box(0.34, 0.24, 0.16, [0x6e4a2f, 0xf4f2ec, 0x2a2a2a][i % 3], fx + 0.3 + (i % 2) * Math.max(0.5, fw * 0.4), 0.2, 0.9 + Math.floor(i / 2) * 0.9)); silo(g, 0.7, d - 0.75, 0.34, 2.0); trough(g, fx + fw / 2, d - 0.75, Math.min(1, fw - 0.3)); for (const [hx, hz] of [[1.5, d - 0.4], [1.85, d - 0.45]]) g.add(box(0.3, 0.22, 0.2, PAL.hay, hx, 0.06, hz)); }
  else if (type === 'dairy' || type === 'creamery') { row(big ? 4 : 2, (x, z) => tankV(g, x, z, 0.34, type === 'dairy' ? 1.5 : 1.1)); lorry(g, 0.9, d - 0.55, type === 'dairy' ? 0xdfe6ea : 0x5b8fc0, Math.PI / 2); for (let i = 0; i < 3; i++) churn(g, 1.9 + i * 0.25, d - 0.35); if (type === 'creamery') g.add(box(Math.min(1.4, fw), 0.9, 0.9, 0xe9ecec, fx + fw / 2, 0.06, d - 0.8), box(0.4, 0.25, 0.4, PAL.metal, fx + fw / 2, 0.96, d - 0.8)); }
  else if (type === 'oilPress') { g.add(box(0.9, wh + 1.0, 0.9, L.wall, fx + fw / 2, 0.06, fz + 0.5), box(1.0, 0.1, 1.0, L.roof, fx + fw / 2, wh + 1.06, fz + 0.5)); for (let f = 0; f < 3; f++) glassWin(g, 0.3, 0.3, fx + fw / 2, 0.5 + f * 0.8, fz + 0.96); row(big ? 4 : 2, (x, z) => { const t = cyl(0.3, 0.9, 0x4a5a4a, x, 0, z, 12); t.rotation.z = Math.PI / 2; t.position.y = 0.42; g.add(t, box(0.7, 0.1, 0.2, PAL.stoneDark, x, 0.06, z)); }, fz + 1.7); for (let i = 0; i < 4; i++) barrel(g, 0.6 + i * 0.3, d - 0.35, 0x4a5a4a); }
  else if (type === 'sugarMill') { for (let i = 0; i < (big ? 2 : 1); i++) { const x = fx + fw / 2 + (big ? (i - 0.5) * 0.8 : 0); g.add(cyl(0.22, 3.6, PAL.brick, x, 0.06, fz + 0.4, 12, 0.15), cyl(0.17, 0.12, PAL.stoneDark, x, 3.66, fz + 0.4, 12)); smoke.push(new THREE.Vector3(x, 3.85, fz + 0.4)); } g.add(box(Math.min(1.5, fw), 1.2, 1.0, PAL.brick, fx + fw / 2, 0.06, fz + 1.5), box(Math.min(1.6, fw + 0.1), 0.08, 1.1, PAL.metalDark, fx + fw / 2, 1.26, fz + 1.5), cone(0.5, 0.5, 0xfafafa, fx + fw / 2, 0.06, d - 0.7, 12)); pallet(g, 0.7, d - 0.4, 0xfafafa); pallet(g, 1.15, d - 0.4, 0xfafafa); }
  else if (type === 'winery') { g.add(cyl(0.5, wh + 0.6, L.wall, fx + fw / 2, 0.06, fz + 0.4, 12), cone(0.6, 0.7, L.roof, fx + fw / 2, wh + 0.66, fz + 0.4, 12)); for (let i = 0; i < (big ? 8 : 4); i++) { const b = cyl(0.2, 0.5, PAL.woodDark, 0, 0, 0, 10); b.rotation.x = Math.PI / 2; b.position.set(fx + 0.3 + (i % 2) * 0.5, 0.26 + (Math.floor(i / 2) % 2) * 0.38, fz + 1.5 + Math.floor(i / 4) * 0.7); g.add(b); } for (let i = 0; i < 4; i++) g.add(box(0.04, 0.5, 0.04, PAL.woodDark, 0.6 + i * 0.4, 0.06, d - 0.4), sphere(0.12, 0x6f8f4a, 0.6 + i * 0.4, 0.55, d - 0.4)); }
  g.add(box(Math.min(hw, 2.4), 0.26, 0.4, PAL.stoneDark, 0.25 + hw / 2, 0.06, d - 0.75 > 0.25 + hd + (big ? hd + 0.5 : 0) + 0.3 ? 0.25 + hd + (big ? hd + 0.5 : 0) + 0.25 : d - 0.3)); // loading dock
  lampPost(g, w - 0.3, d - 0.3, 0.9);
  return finish(g, smoke);
}

// ---------------------------------------------------------------- parks: gardens, a playground or a sports ground, each richer by level
export function buildPark(kind: 'garden' | 'play' | 'sport', level = 1, w = 3, d = 3): Model {
  const g = new THREE.Group(), cx = w / 2, cz = d / 2, lawn = 0x86a85a, path = 0xd9cdb4;
  g.add(box(w - 0.1, 0.05, d - 0.1, lawn, cx, 0, cz, { rough: 1 }));
  const tr = (x: number, z: number, k = 0.6, pine = 0) => { const t = tree(k, mat(0x5f8f4a), pine); t.position.set(x, 0.05, z); g.add(t); };
  const bench = (x: number, z: number) => g.add(box(0.4, 0.05, 0.14, PAL.wood, x, 0.2, z), box(0.4, 0.16, 0.03, PAL.wood, x, 0.22, z - 0.07), box(0.04, 0.16, 0.12, PAL.metalDark, x - 0.16, 0.05, z), box(0.04, 0.16, 0.12, PAL.metalDark, x + 0.16, 0.05, z));
  if (kind === 'garden') {
    g.add(box(0.3, 0.02, d - 0.2, path, cx, 0.05, cz, { rough: 1 }), box(w - 0.2, 0.02, 0.3, path, cx, 0.05, cz, { rough: 1 }));
    const beds = [[0.7, 0.7], [w - 0.7, 0.7], [0.7, d - 0.7], [w - 0.7, d - 0.7]] as const, cols = [0xc94c4c, 0xe7a23b, 0xd673a4, 0x8a5fb0];
    beds.forEach(([x, z], i) => { g.add(box(0.8, 0.06, 0.8, 0x6b4a2f, x, 0.05, z)); for (let k = 0; k < (level > 1 ? 9 : 4); k++) g.add(sphere(0.07, cols[(i + k) % 4], x - 0.25 + (k % 3) * 0.25, 0.16, z - 0.25 + Math.floor(k / 3) * 0.25)); if (level === 1) tr(x, z, 0.45); });
    if (level >= 2) g.add(cyl(0.42, 0.14, PAL.stone, cx, 0.05, cz, 14), cyl(0.34, 0.04, 0x7fb6d6, cx, 0.19, cz, 14), cyl(0.06, 0.45, PAL.stone, cx, 0.19, cz, 8), sphere(0.09, 0x9fd0e6, cx, 0.7, cz)); // fountain
    else bench(cx + 0.5, cz - 0.3);
    if (level >= 3) { for (const [dx, dz] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) g.add(box(0.05, 0.7, 0.05, PAL.white, cx + dx, 0.05, cz + dz + 0.0)); const roof = cone(0.85, 0.4, 0x4f7a52, cx, 0.75, cz, 8); g.add(roof); for (const [x, z] of [[0.35, cz], [w - 0.35, cz]]) lampPost(g, x, z, 0.7); }
  } else if (kind === 'play') {
    g.add(box(w - 0.9, 0.03, d - 0.9, 0xe2c98f, cx, 0.05, cz, { rough: 1 })); // sand
    const swing = (x: number, z: number) => { g.add(box(0.04, 0.6, 0.04, 0xc0392b, x - 0.3, 0.05, z), box(0.04, 0.6, 0.04, 0xc0392b, x + 0.3, 0.05, z), box(0.68, 0.04, 0.04, 0xc0392b, x, 0.65, z)); for (const dx of [-0.12, 0.12]) g.add(box(0.012, 0.4, 0.012, PAL.metalDark, x + dx, 0.25, z), box(0.14, 0.02, 0.08, PAL.wood, x + dx, 0.24, z)); };
    swing(0.9, 0.9); const slide = box(0.22, 0.04, 0.9, 0xe7a23b, w - 0.9, 0.35, 0.95); slide.rotation.x = -0.5; g.add(slide, box(0.3, 0.6, 0.3, 0x5b8fc0, w - 0.9, 0.05, 0.5));
    if (level >= 2) { g.add(cyl(0.34, 0.05, 0x4f8a8b, 0.95, 0.14, d - 0.95, 12), cyl(0.03, 0.3, PAL.metalDark, 0.95, 0.05, d - 0.95, 6)); const saw = box(0.9, 0.04, 0.12, 0x4f8a4a, w - 0.95, 0.22, d - 0.95); saw.rotation.z = 0.2; g.add(saw, box(0.08, 0.18, 0.14, PAL.metalDark, w - 0.95, 0.05, d - 0.95)); }
    if (level >= 3) { g.add(box(0.7, 0.7, 0.7, 0xb98a5a, cx, 0.05, cz), cone(0.55, 0.45, 0xc0392b, cx, 0.75, cz, 4), box(0.3, 0.04, 0.8, 0xe7a23b, cx + 0.55, 0.4, cz + 0.2)); swing(cx, d - 0.55); }
    tr(0.35, cz, 0.5); tr(w - 0.35, cz, 0.5, 1); bench(cx, 0.35);
  } else {
    g.add(box(w - 0.6, 0.02, d - 1.0, 0x6fa84a, cx, 0.05, cz, { rough: 1 }));
    for (const [bw, bd] of [[w - 0.6, 0.03], [0.03, d - 1.0]] as const) for (const s of [-1, 1]) g.add(box(bw, 0.01, bd, 0xf4f2ec, cx + (bd > 1 ? s * (w - 0.6) / 2 : 0), 0.07, cz + (bd > 1 ? 0 : s * (d - 1.0) / 2)));
    g.add(box(0.03, 0.01, d - 1.0, 0xf4f2ec, cx, 0.07, cz), cyl(0.3, 0.01, 0xf4f2ec, cx, 0.065, cz, 16), cyl(0.27, 0.012, 0x6fa84a, cx, 0.066, cz, 16));
    for (const s of [-1, 1]) g.add(box(0.03, 0.3, 0.03, PAL.white, cx + s * (w - 0.6) / 2, 0.05, cz - 0.3), box(0.03, 0.3, 0.03, PAL.white, cx + s * (w - 0.6) / 2, 0.05, cz + 0.3), box(0.03, 0.03, 0.63, PAL.white, cx + s * (w - 0.6) / 2, 0.33, cz)); // goals
    if (level >= 2) for (let k = 0; k < 3; k++) g.add(box(w - 1.0, 0.12, 0.14, [0x8f979b, 0x7a8286, 0x6a7276][k], cx, 0.05 + k * 0.12, 0.42 - k * 0.14)); // a stand
    else bench(cx, 0.3);
    if (level >= 3) { for (const [x, z] of [[0.3, 0.3], [w - 0.3, 0.3], [0.3, d - 0.3], [w - 0.3, d - 0.3]]) g.add(box(0.05, 1.5, 0.05, PAL.metalDark, x, 0.05, z), box(0.3, 0.14, 0.08, 0xffe2a0, x, 1.5, z, { emissive: 0x6b5a2a })); g.add(box(0.7, 0.4, 0.5, 0xe9e2d2, w - 0.6, 0.05, d - 0.4), box(0.76, 0.05, 0.56, 0x4f7aa0, w - 0.6, 0.45, d - 0.4)); }
    tr(0.3, d - 0.35, 0.45);
  }
  return finish(g);
}
