import { SERVICE_DEFS } from '../../simulation/town-state';
import type { ServiceType } from '../../simulation/types';
import { communityOf, population, residentWorkers } from '../../simulation/community-state';
// The 3D farm. A live, lit, low-poly picture of the simulation: everything shown is read from game state.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { ANIMALS, BUILDINGS, CROPS, GOODS, REGIONS, SEASONS, type AnimalId, type CropId, type RegionId } from '../../simulation/config';
import { timingFactor, fertility, growth, isMature, isReady } from '../../simulation/engine';
import { stored } from '../../simulation/core';
import type { GameState } from '../../simulation/types';
import { getGame, getSpeed } from '../../stores/game';
import { stageAtLeast } from '../../simulation/stages';
import { preloadArt, artRevision } from './art';
import { num, pct0 } from '../format';
import { layoutRegion, type Layout, type Lot, type Plot } from './layout';
import { animal, buildCivic, buildCommunityHome, buildLot, box, cached, mat, mesh, PAL, person, tree, vehicle, type Model } from './models';

/** Graphics quality chosen in Settings (per browser). Low turns off shadows and high-DPI rendering. */
export const graphicsQuality = (): 'high' | 'low' => {
  try { return localStorage.getItem('agrarian.ui.graphics') === '"low"' ? 'low' : 'high'; } catch { return 'high'; }
};

export type WorldPick = { kind: 'field'; id: number; multi: boolean } | { kind: 'lot'; lot: Lot } | { kind: 'buy' } | { kind: 'none' };

const SEASON_GROUND: Record<string, number> = { Spring: 0x88ba5c, Summer: 0x93b14f, Autumn: 0xb3a253, Winter: 0xe4eaec };
const REGION_GROUND: Partial<Record<RegionId, number>> = { arid: 0xd3bd86, tropics: 0x5ea849 };
const CROWN: Record<string, number> = { Spring: 0x5f9a45, Summer: 0x4f8a3c, Autumn: 0xd08a3a, Winter: 0xf0f3f4 };
const reducedMotionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const SHIRTS = [0xc9553f, 0x3f6fc9, 0xe0b23a, 0x4c9a5a, 0x8a5ac9, 0xd07a2f];
const ANIMAL_BUILDING: Record<AnimalId, Lot['type']> = { chickens: 'coop', pigs: 'pigsty', cows: 'cowshed', sheep: 'sheepfold' };
const hash = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
const lerpC = (a: number, b: number, k: number) => new THREE.Color(a).lerp(new THREE.Color(b), Math.max(0, Math.min(1, k)));

type Shape = 'grain' | 'stalk' | 'bush' | 'trunk' | 'crown';
const SHAPE: Record<CropId, 'grain' | 'stalk' | 'bush' | 'tree'> = {
  wheat: 'grain', rice: 'grain', corn: 'stalk', sugarcane: 'stalk', potatoes: 'bush', soybeans: 'bush', cotton: 'bush', coffee: 'bush', apples: 'tree', grapes: 'tree',
};
const RIPE: Partial<Record<CropId, number>> = { wheat: 0xe0b23f, rice: 0xd9c46a, corn: 0xcfae4a, sugarcane: 0x8fbf55, potatoes: 0x8a9a3a, soybeans: 0xb6a24a, cotton: 0xf6f3ec, coffee: 0xb8392f, apples: 0xd2402f, grapes: 0x6b3a7e };

interface Rig {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera; target: THREE.Vector3; yaw: number; yawTo: number; zoom: number;
  sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; ground: THREE.Mesh;
  lots: THREE.Group; fields: THREE.Group; units: THREE.Group; deco: THREE.Group; fx: THREE.Group; sel: THREE.Group;
  models: { lot: Lot; model: Model; hit: THREE.Mesh }[]; pick: THREE.Object3D[];
  crops: Partial<Record<Shape, THREE.InstancedMesh>>; sig: { lots: string; fields: string; crops: string; sel: string; deco: string };
  neighbours: THREE.Group[]; people: Map<number, THREE.Group>; machines: Map<number, THREE.Group>; trucks: { obj: THREE.Group; t0: number }[]; herds: Map<string, THREE.Group[]>;
  storageProps: THREE.Group; lastStockTick: number; lastCash: number; lastCoin: number;
  rain: THREE.Points; smoke: THREE.Sprite[]; pops: { key: string; text: string; x: number; z: number; t0: number; tone?: string }[]; seenHarvest: Map<number, object>; popsReady: boolean; crownMat: THREE.MeshStandardMaterial; lastHaul: number; layout: Layout | null; region: RegionId;
}

export type WorldAction = 'harvest' | 'plant' | 'inspect' | 'plan' | 'place';

export function Scene3D({ region, selected, onPick, plantLabel, onAction, selectedLot }: { region: RegionId; selected: number[]; onPick: (p: WorldPick) => void; plantLabel?: string; selectedLot?: string; onAction?: (kind: WorldAction, fieldId: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const rig = useRef<Rig | null>(null);
  const live = useRef({ region, selected, onPick, plantLabel, onAction, selectedLot });
  live.current = { region, selected, onPick, plantLabel, onAction, selectedLot };
  const [hover, setHover] = useState<{ x: number; y: number; text: string[] } | null>(null);
  const [failed, setFailed] = useState(false);

  // ---------------------------------------------------------------- setup + loop
  useEffect(() => {
    const c = canvas.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, powerPreference: 'high-performance' });
    } catch {
      setFailed(true);
      return;
    }
    const low = graphicsQuality() === 'low' || (innerWidth < 700 && devicePixelRatio > 1.25);
    renderer.setPixelRatio(low ? 1 : Math.min(2, devicePixelRatio));
    renderer.shadowMap.enabled = !low;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -200, 400);
    const hemi = new THREE.HemisphereLight(0xfff4e0, 0xb59a70, 0.8); // warm sky and sunlit-earth bounce
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    scene.add(hemi, sun, sun.target);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: SEASON_GROUND.Spring, roughness: 1, map: grassTexture() }));
    (ground.material as THREE.MeshStandardMaterial).map!.repeat.set(150, 150);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    const g = () => { const x = new THREE.Group(); scene.add(x); return x; };
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(1500 * 3), 3));
    const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0xbcd4e6, size: 0.06, transparent: true, opacity: 0.7, depthWrite: false }));
    rain.visible = false;
    scene.add(rain);
    const R: Rig = {
      renderer, scene, camera, target: new THREE.Vector3(6, 0, 8), yaw: Math.PI / 4, yawTo: Math.PI / 4, zoom: 1, sun, hemi, ground,
      lots: g(), fields: g(), units: g(), deco: g(), fx: g(), sel: g(), models: [], pick: [], crops: {}, sig: { lots: '', fields: '', crops: '', sel: '', deco: '' },
      storageProps: g(), lastStockTick:-1, lastCash:getGame().cash, lastCoin:0,
      neighbours: [], people: new Map(), machines: new Map(), trucks: [], herds: new Map(), rain, smoke: [], pops: [], seenHarvest: new Map(), popsReady: false, crownMat: mat(CROWN.Spring).clone(), lastHaul: -1, layout: null, region,
    };
    rig.current = R;
    let raf = 0, framed = false, lastCrops = 0, viewSize = '', viewSelection = '', artVersion = artRevision();
    void preloadArt();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if(artVersion!==artRevision()){
        artVersion=artRevision(); c.dataset.art=String(artVersion); R.sig.lots=''; R.sig.deco='';
        for(const animals of R.herds.values())for(const a of animals)R.units.remove(a);
        R.herds.clear();
      }
      const W = c.clientWidth, H = c.clientHeight;
      if (!W || !H) return;
      const size=`${W}:${H}`, selection=live.current.selected.join(',')+':'+(live.current.selectedLot??'');
      if(size!==viewSize||selection!==viewSelection){viewSize=size;viewSelection=selection;framed=false;}
      if (c.width !== Math.round(W * renderer.getPixelRatio()) || c.height !== Math.round(H * renderer.getPixelRatio())) renderer.setSize(W, H, false);
      const s = getGame();
      if (R.region !== live.current.region) { R.region = live.current.region; R.sig = { lots: '', fields: '', crops: '', sel: '', deco: '' }; framed = false; R.lastHaul = -1; }
      const L = layoutRegion(s, R.region);
      R.layout = L;
      if (!framed) { frameCamera(R, L, live.current.selected, live.current.selectedLot); framed = true; }
      syncLots(R, L);
      syncFields(R, L);
      if (now - lastCrops > 400) { syncCrops(R, L, s); lastCrops = now; }
      syncSelection(R, L, live.current.selected);
      syncDeco(R, L);
      syncStorage(R,L,s);
      animateUnits(R, L, s, now / 1000);
      animateNeighbours(R, L, s, now / 1000);
      atmosphere(R, s, now / 1000);
      updateCamera(R, W, H);
      renderer.render(scene, camera);
      overlayLabels(R, L, s, W, H, overlay.current, now / 1000, live.current.selected, live.current.plantLabel, live.current.selectedLot);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); renderer.dispose(); renderer.forceContextLoss(); rig.current = null; };
  }, []);

  // ---------------------------------------------------------------- input
  useEffect(() => {
    const c = canvas.current!;
    const pts = new Map<number, { x: number; y: number }>();
    let moved = 0, pinch = 0, lastHover = 0, downAt = 0;
    const ray = new THREE.Raycaster();
    const pickAt = (sx: number, sy: number) => {
      const R = rig.current;
      if (!R) return null;
      const r = c.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((sx / r.width) * 2 - 1, -(sy / r.height) * 2 + 1), R.camera);
      return ray.intersectObjects(R.pick, false)[0]?.object.userData ?? null;
    };
    const pan = (dx: number, dy: number) => {
      const R = rig.current;
      if (!R) return;
      const k = (R.camera.top - R.camera.bottom) / c.clientHeight;
      const right = new THREE.Vector3(Math.cos(R.yaw), 0, -Math.sin(R.yaw));
      const fwd = new THREE.Vector3(-Math.sin(R.yaw), 0, -Math.cos(R.yaw));
      R.target.addScaledVector(right, -dx * k).addScaledVector(fwd, (dy * k) / Math.sin(0.62));
    };
    const zoomBy = (f: number) => { if (rig.current) rig.current.zoom = Math.max(0.15, Math.min(4, rig.current.zoom * f)); };
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0; downAt = performance.now();
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    };
    const move = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      const p = pts.get(e.pointerId);
      if (!p) {
        if (performance.now() - lastHover < 70) return;
        lastHover = performance.now();
        const u = pickAt(e.clientX - r.left, e.clientY - r.top);
        const s = getGame();
        const L = rig.current?.layout;
        if (u?.kind === 'field' && L) { const pl = L.plots.find((q) => q.field.id === u.id); if (pl) return setHover({ x: e.clientX - r.left, y: e.clientY - r.top, text: plotText(s, pl) }); }
        if (u?.kind === 'lot' && L) { const lot = L.lots.find((q) => q.key === u.key); if (lot) return setHover({ x: e.clientX - r.left, y: e.clientY - r.top, text: lotText(s, lot) }); }
        if (u?.kind === 'buy') return setHover({ x: e.clientX - r.left, y: e.clientY - r.top, text: ['Land for sale', 'Click to buy another hectare'] });
        return setHover(null);
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) zoomBy(d / pinch);
        pinch = d;
        moved += 10;
        return;
      }
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 4) { pan(dx, dy); setHover(null); }
    };
    const up = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      if (pts.size === 1 && moved <= 4) {
        const u = pickAt(e.clientX - r.left, e.clientY - r.top);
        const L = rig.current?.layout;
        const multi = e.shiftKey || e.ctrlKey || e.metaKey;
        if (u?.kind === 'field') { live.current.onPick({ kind: 'field', id: u.id, multi }); if(performance.now()-downAt>500)live.current.onAction?.('inspect',u.id); }
        else if (u?.kind === 'lot' && L) { const lot = L.lots.find((q) => q.key === u.key); if (lot) {live.current.onPick({ kind: 'lot', lot });if(performance.now()-downAt>500)live.current.onAction?.('inspect',0);} }
        else if (u?.kind === 'buy') live.current.onPick({ kind: 'buy' });
        else live.current.onPick({ kind: 'none' });
      }
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0015)); };
    const key = (e: KeyboardEvent) => {
      const R = rig.current;
      if (!R || (e.target as HTMLElement).closest('input, select, textarea, [role=dialog]')) return;
      if (e.key === 'q' || e.key === 'Q') R.yawTo += Math.PI / 2;
      else if (e.key === 'e' || e.key === 'E') R.yawTo -= Math.PI / 2;
      else if (e.key === 'ArrowLeft') pan(80, 0);
      else if (e.key === 'ArrowRight') pan(-80, 0);
      else if (e.key === 'ArrowUp') pan(0, 80);
      else if (e.key === 'ArrowDown') pan(0, -80);
      else if (e.key === '+' || e.key === '=') zoomBy(1.2);
      else if (e.key === '-') zoomBy(1 / 1.2);
      else return;
      e.preventDefault();
    };
    const cancel=(e:PointerEvent)=>{pts.delete(e.pointerId);pinch=0;};
    const leave=()=>setHover(null);
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', cancel);
    c.addEventListener('pointerleave', leave);
    c.addEventListener('wheel', wheel, { passive: false });
    addEventListener('keydown', key);
    const ov = overlay.current!;
    const onBubble = (e: MouseEvent) => {
      const b = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!b) return;
      const [kind, id] = b.dataset.action!.split(':');
      live.current.onAction?.(kind as WorldAction, Number(id));
    };
    ov.addEventListener('click', onBubble);
    (window as unknown as Record<string, unknown>).__world = { zoom: zoomBy, rotate: (d: number) => rig.current && (rig.current.yawTo += (d * Math.PI) / 2) };
    return () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', cancel);
      c.removeEventListener('pointerleave', leave);
      delete (window as unknown as Record<string,unknown>).__world;
      c.removeEventListener('wheel', wheel);
      removeEventListener('keydown', key);
      ov.removeEventListener('click', onBubble);
    };
  }, []);

  const ctl = () => (window as unknown as { __world: { zoom: (f: number) => void; rotate: (d: number) => void } }).__world;
  return (
    <div className="world">
      <canvas ref={canvas} className="world-canvas" role="img" aria-label={`Your farm in ${REGIONS[region].name}. Drag to move, scroll to zoom, Q and E to rotate, click a field or building.`} />
      <div ref={overlay} className="world-overlay" />
      {failed && <div className="world-loading">Your browser could not start 3D graphics (WebGL). Try another browser or enable hardware acceleration.</div>}
      {hover && <div className="world-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>{hover.text.filter(Boolean).map((t, i) => <div key={i} className={i ? 'muted' : ''}>{t}</div>)}</div>}
      <div className="world-zoom">
        <button className="icon-btn" aria-label="Zoom in" onClick={() => ctl().zoom(1.25)}>+</button>
        <button className="icon-btn" aria-label="Zoom out" onClick={() => ctl().zoom(0.8)}>−</button>
        <button className="icon-btn" aria-label="Rotate left (Q)" title="Rotate (Q)" onClick={() => ctl().rotate(1)}>⟲</button>
        <button className="icon-btn" aria-label="Rotate right (E)" title="Rotate (E)" onClick={() => ctl().rotate(-1)}>⟳</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- camera

function frameCamera(R: Rig,L:Layout,selected:number[]=[],selectedLot?:string){
  const place = selectedLot && L.lots.find(l => l.key === selectedLot);
  if(place){R.target.set(place.x+place.w/2,0,place.y+place.d/2);R.zoom=selectedLot?.startsWith('community:')?0.65:1;return;}
  const field=L.plots.find(x=>selected.includes(x.field.id))??L.plots[0];
  // The farm is the play space. Keep the selected field readable on phones;
  // fitting every distant lot into the viewport made the playable plot vanish.
  if(field){
    R.target.set(field.x+field.s/2,0,field.y+field.s/2);
    R.zoom=Math.max(.15,Math.min(1.5,8/field.s));
    return;
  }
  const lot=L.lots.find(x=>x.type==='house')??L.lots[0];
  if(lot){R.target.set(lot.x+lot.w/2,0,lot.y+lot.d/2);R.zoom=1;}
}

function updateCamera(R: Rig, W: number, H: number) {
  R.yaw += (R.yawTo - R.yaw) * 0.15;
  const pitch = 0.62; // ≈ 35°
  const dist = 80;
  const cam = R.camera;
  cam.position.set(R.target.x + Math.sin(R.yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, R.target.z + Math.cos(R.yaw) * Math.cos(pitch) * dist);
  cam.lookAt(R.target);
  const half = 9 / R.zoom;
  cam.left = (-half * W) / H; cam.right = (half * W) / H; cam.top = half; cam.bottom = -half;
  cam.updateProjectionMatrix();
  // shadow camera follows the view
  const ext = half * Math.max(1.2, W / H) * 1.3;
  const sc = R.sun.shadow.camera;
  sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 200;
  sc.updateProjectionMatrix();
}

// ---------------------------------------------------------------- world sync

function clear(g: THREE.Group) {
  for (const ch of [...g.children]) g.remove(ch);
}

function syncLots(R: Rig, L: Layout) {
  const sig = L.lots.map((l) => `${l.key}:${l.type}@${l.x},${l.y}:${l.buildings.length}:${l.buildings.map((b) => b.level).join('')}`).join('|');
  if (sig === R.sig.lots) return;
  R.sig.lots = sig;
  clear(R.lots);
  R.models = [];
  R.pick = R.pick.filter((o) => o.userData.kind !== 'lot');
  for (const lot of L.lots) {
    const model = lot.key.startsWith('civic:') ? buildCivic(lot.key.split(':')[1],lot.w,lot.d) : lot.key.startsWith('community:') ? buildCommunityHome(lot.key.split(':')[1], lot.w, lot.d) : buildLot(lot.type, lot.w, lot.d);
    model.group.position.set(lot.x, 0, lot.y);
    const lvl = Math.max(1, ...lot.buildings.map((b) => b.level));
    if (lvl > 1) model.group.scale.set(1, 1 + (lvl - 1) * 0.18, 1); // upgraded buildings stand taller
    R.lots.add(model.group);
    const hit = new THREE.Mesh(cached(`hit${lot.w},${lot.d}`, () => new THREE.BoxGeometry(lot.w, 2.6, lot.d)), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(lot.x + lot.w / 2, 1.3, lot.y + lot.d / 2);
    hit.userData = { kind: 'lot', key: lot.key };
    R.lots.add(hit);
    R.pick.push(hit);
    R.models.push({ lot, model, hit });
  }
  const home=L.lots[0];
  R.lots.add(box(2.6,.09,.32,PAL.wood,home.x+home.w+1.4,.2,home.y+1));
  R.lots.add(box(2.6,.25,.06,PAL.wood,home.x+home.w+1.4,.35,home.y+.85));
  // smoke sprites for every chimney
  for (const sp of R.smoke) R.fx.remove(sp);
  R.smoke = [];
  const smokeMat = new THREE.SpriteMaterial({ map: puffTexture(), color: 0xeeeeee, transparent: true, depthWrite: false, opacity: 0.6 });
  for (const m of R.models) for (const p of m.model.smoke) for (let i = 0; i < 5; i++) {
    const sp = new THREE.Sprite(smokeMat.clone());
    sp.userData = { origin: new THREE.Vector3(m.lot.x + p.x, p.y, m.lot.y + p.z), phase: i / 5, lot: m.lot };
    R.fx.add(sp);
    R.smoke.push(sp);
  }
}

function syncFields(R: Rig, L: Layout) {
  const sig = L.plots.map((p) => `${p.field.id}@${p.x},${p.y},${p.s}:${p.field.greenhouse ? 'g' : ''}${p.field.irrigated ? 'i' : ''}${fertility(p.field) < 0.45 ? 'p' : ''}`).join('|') + (L.buy ? `|buy${L.buy.x},${L.buy.y}` : '');
  if (sig === R.sig.fields) return;
  R.sig.fields = sig;
  clear(R.fields);
  R.pick = R.pick.filter((o) => o.userData.kind !== 'field' && o.userData.kind !== 'buy');
  const soil = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 1, map: furrowTexture(), flatShading: true });
  const soilPale = soil.clone();
  soilPale.color.set(0xa58a6a);
  const posts: THREE.Matrix4[] = [];
  const rails: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion(), sc = new THREE.Vector3();
  for (const p of L.plots) {
    const f = p.field;
    const geo = cached(`plate${p.s}`, () => {
      const gg = new THREE.BoxGeometry(p.s - 0.2, 0.1, p.s - 0.2);
      const uv = gg.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * p.s, uv.getY(i) * p.s);
      return gg;
    });
    const plate = mesh(geo, fertility(f) < 0.45 ? soilPale : soil, p.x + p.s / 2, 0.05, p.y + p.s / 2, false);
    plate.userData = { kind: 'field', id: f.id };
    R.fields.add(plate);
    R.pick.push(plate);
    if (f.greenhouse) {
      const glass = mesh(cached(`gh${p.s}`, () => new THREE.BoxGeometry(p.s - 0.15, 1.2, p.s - 0.15)), mat(0xd8eef2, { opacity: 0.35, rough: 0.1 }), p.x + p.s / 2, 0.6, p.y + p.s / 2, false);
      R.fields.add(glass);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry), new THREE.LineBasicMaterial({ color: 0xf4f6f6 }));
      edges.position.copy(glass.position);
      R.fields.add(edges);
    } else {
      // fence: posts every tile, two rails per side
      for (let i = 0; i <= p.s; i++) for (const [x, z] of [[p.x + i, p.y], [p.x + i, p.y + p.s], [p.x, p.y + i], [p.x + p.s, p.y + i]]) {
        posts.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.17, z), q, sc.set(1, 1, 1)));
      }
      for (const y of [0.13, 0.27]) {
        rails.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x + p.s / 2, y, p.y), q, new THREE.Vector3(p.s, 1, 1)));
        rails.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x + p.s / 2, y, p.y + p.s), q, new THREE.Vector3(p.s, 1, 1)));
        rails.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, y, p.y + p.s / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(p.s, 1, 1)));
        rails.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x + p.s, y, p.y + p.s / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(p.s, 1, 1)));
      }
    }
    if (f.irrigated && !f.greenhouse) for (let k = 1; k < p.s; k += 2) {
      const pipe = mesh(cached(`pipe${p.s}`, () => new THREE.CylinderGeometry(0.025, 0.025, p.s - 0.3, 6)), mat(0x5aa3c8), p.x + p.s / 2, 0.14, p.y + k, false);
      pipe.rotation.z = Math.PI / 2;
      R.fields.add(pipe);
    }
  }
  const post = new THREE.InstancedMesh(cached('post', () => new THREE.BoxGeometry(0.07, 0.34, 0.07)), mat(PAL.woodDark), Math.max(1, posts.length));
  posts.forEach((m, i) => post.setMatrixAt(i, m));
  post.count = posts.length;
  post.castShadow = true;
  const rail = new THREE.InstancedMesh(cached('rail', () => new THREE.BoxGeometry(1, 0.04, 0.035)), mat(PAL.wood), Math.max(1, rails.length));
  rails.forEach((m, i) => rail.setMatrixAt(i, m));
  rail.count = rails.length;
  rail.castShadow = true;
  R.fields.add(post, rail);
  if (L.buy) {
    const b = L.buy;
    const plot = mesh(cached('buyplot', () => new THREE.BoxGeometry(1.8, 0.04, 1.8)), mat(0xffffff, { opacity: 0.35 }), b.x + 1, 0.02, b.y + 1, false);
    plot.userData = { kind: 'buy' };
    R.fields.add(plot);
    R.pick.push(plot);
    const sign = new THREE.Group();
    sign.add(mesh(cached('signpost', () => new THREE.BoxGeometry(0.06, 0.6, 0.06)), mat(PAL.woodDark), 0, 0.3, 0));
    sign.add(mesh(cached('signboard', () => new THREE.BoxGeometry(0.5, 0.3, 0.04)), mat(PAL.cream), 0, 0.6, 0));
    sign.position.set(b.x + 1, 0, b.y + 1);
    R.fields.add(sign);
  }
}

/** Plants are instanced: one draw call per shape no matter how big the farm. */
function syncCrops(R: Rig, L: Layout, s: GameState) {
  const items: { shape: Shape; m: THREE.Matrix4; c: THREE.Color }[] = [];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const p of L.plots) {
    const f = p.field;
    if (!f.crop) continue;
    const c = f.crop;
    const shape = SHAPE[c];
    const g = growth(s, f);
    const ready = isReady(s, f);
    const perennial = !!CROPS[c].perennial;
    const mature = perennial && isMature(s, f);
    const n = shape === 'tree' ? Math.max(2, Math.round(p.s * 0.75)) : Math.max(3, Math.min(14, Math.round(p.s * 1.7)));
    const step = (p.s - 0.4) / n;
    const wilt = ready ? 1-timingFactor(s,f) : 0;
    const scaleBase = perennial ? (mature ? 1 : 0.35 + 0.65 * g) : 0.25 + 0.75 * g;
    let col = lerpC(0x9fd46b, shape === 'grain' ? 0x7fae45 : 0x4f8f3a, perennial ? (mature ? 1 : g) : g);
    if (ready) col = new THREE.Color(RIPE[c] ?? GOODS[c].color);
    if (f.pest > 0.35) col.lerp(new THREE.Color(0x8a7a3a), Math.min(0.7, f.pest));
    if(wilt>0)col.lerp(new THREE.Color(0x766044),wilt);
    if (f.frost > 0) col.lerp(new THREE.Color(0xa7b3b6), f.frost);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const jx = (hash(f.id * 97 + i * 13 + j) - 0.5) * step * 0.35, jz = (hash(f.id * 31 + i * 7 + j * 3) - 0.5) * step * 0.35;
      const x = p.x + 0.2 + step * (i + 0.5) + jx, z = p.y + 0.2 + step * (j + 0.5) + jz;
      const k = scaleBase * (0.85 + 0.3 * hash(i * 17 + j * 5 + f.id));
      q.setFromAxisAngle(up, hash(i + j * 9 + f.id) * Math.PI * 2);
      if (shape === 'tree') {
        const ts = (c === 'grapes' ? 0.55 : 1) * k;
        items.push({ shape: 'trunk', m: new THREE.Matrix4().compose(new THREE.Vector3(x, 0.1, z), q, new THREE.Vector3(ts, ts, ts)), c: new THREE.Color(PAL.woodDark) });
        const crownCol = ready ? lerpC(0x4f8a3c, RIPE[c]!, 0.55) : lerpC(0x9fd46b, 0x4f8a3c, mature ? 1 : g);
        items.push({ shape: 'crown', m: new THREE.Matrix4().compose(new THREE.Vector3(x, 0.1 + 0.62 * ts, z), q, new THREE.Vector3(ts * (c === 'grapes' ? 1.4 : 1), ts * (c === 'grapes' ? 0.7 : 1), ts)), c: crownCol });
      } else items.push({ shape, m: new THREE.Matrix4().compose(new THREE.Vector3(x, 0.1, z), q, new THREE.Vector3(k, k*(1-wilt*.6), k)), c: col });
    }
  }
  const sig = `${items.length}:${L.plots.map((p) => `${p.field.crop}${Math.round(growth(s, p.field) * 12)}${isReady(s, p.field) ? 'r' : ''}${p.field.pest > 0.35 ? 'p' : ''}${Math.round(p.field.frost * 4)}${Math.round(timingFactor(s,p.field)*8)}`).join('')}`;
  if (sig === R.sig.crops) return;
  R.sig.crops = sig;
  const geos: Record<Shape, () => THREE.BufferGeometry> = {
    grain: () => new THREE.ConeGeometry(0.07, 0.42, 5).translate(0, 0.21, 0),
    stalk: () => new THREE.ConeGeometry(0.1, 0.8, 5).translate(0, 0.4, 0),
    bush: () => new THREE.IcosahedronGeometry(0.14, 0).scale(1, 0.75, 1).translate(0, 0.1, 0),
    trunk: () => new THREE.CylinderGeometry(0.05, 0.07, 0.6, 6).translate(0, 0.3, 0),
    crown: () => new THREE.IcosahedronGeometry(0.34, 0).translate(0, 0.3, 0),
  };
  for (const shape of Object.keys(geos) as Shape[]) {
    const list = items.filter((it) => it.shape === shape);
    let im = R.crops[shape];
    if (!im || im.instanceMatrix.count < list.length) {
      if (im) R.scene.remove(im);
      im = new THREE.InstancedMesh(cached(`crop-${shape}`, geos[shape]), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), Math.max(64, Math.ceil(list.length * 1.3)));
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      R.scene.add(im);
      R.crops[shape] = im;
    }
    list.forEach((it, i) => { im!.setMatrixAt(i, it.m); im!.setColorAt(i, it.c); });
    im.count = list.length;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }
}

function syncSelection(R: Rig, L: Layout, selected: number[]) {
  const sig = selected.join(',') + '|' + R.sig.fields;
  if (sig === R.sig.sel) return;
  R.sig.sel = sig;
  clear(R.sel);
  for (const p of L.plots) {
    if (!selected.includes(p.field.id)) continue;
    const pts = [[p.x - 0.05, p.y - 0.05], [p.x + p.s + 0.05, p.y - 0.05], [p.x + p.s + 0.05, p.y + p.s + 0.05], [p.x - 0.05, p.y + p.s + 0.05]].map(([x, z]) => new THREE.Vector3(x, 0.14, z));
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffc94d }));
    R.sel.add(line);
    const glow = mesh(cached(`selglow${p.s}`, () => new THREE.PlaneGeometry(p.s + 0.3, p.s + 0.3)), new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.18, depthWrite: false }), p.x + p.s / 2, 0.12, p.y + p.s / 2, false);
    glow.rotation.x = -Math.PI / 2;
    R.sel.add(glow);
  }
}

/** Scenery: trees and a road around the farm, kept clear of fields and buildings. */
function syncDeco(R: Rig, L: Layout) {
  const sig = `${L.maxX},${L.maxY},${L.roadY},${L.plots.length},${L.lots.length}`;
  if (sig === R.sig.deco) return;
  R.sig.deco = sig;
  clear(R.deco);
  const road = mesh(cached(`road${L.maxX}`, () => new THREE.BoxGeometry(L.maxX + 80, 0.04, 1.1)), mat(0xb9a37c, { rough: 1 }), L.maxX / 2, 0, L.roadY + 0.5, false);
  R.deco.add(road);
  const busy = (x: number, z: number) =>
    (z > L.roadY - 0.8 && z < L.roadY + 1.8) ||
    L.lots.some((l) => x > l.x - 0.8 && x < l.x + l.w + 0.8 && z > l.y - 0.8 && z < l.y + l.d + 0.8) ||
    L.plots.some((p) => x > p.x - 0.8 && x < p.x + p.s + 0.8 && z > p.y - 0.8 && z < p.y + p.s + 0.8) ||
    (L.buy !== null && x > L.buy.x - 0.8 && x < L.buy.x + 2.8 && z > L.buy.y - 0.8 && z < L.buy.y + 2.8);
  let placed = 0;
  for (let i = 0; i < 1600 && placed < (graphicsQuality() === 'low' ? 40 : 80); i++) {
    const x = -14 + hash(i * 3.1) * (L.maxX + 30), z = -12 + hash(i * 7.7 + 1) * (L.maxY + 26);
    if (busy(x, z)) continue;
    // keep the inner farm airy: fewer trees inside the yard band
    if (x > -1 && x < L.maxX + 1 && z > -1 && z < L.maxY + 1 && hash(i * 13.3) > 0.12) continue;
    const t = tree(0.7 + hash(i * 5.3) * 0.7, R.crownMat);
    t.position.set(x, 0, z);
    t.rotation.y = hash(i) * 6;
    R.deco.add(t);
    placed++;
  }
}

// ---------------------------------------------------------------- live things

function animateNeighbours(R: Rig, L: Layout, s: GameState, time: number) {
  const homes = L.lots.filter(l => l.key.startsWith('community:'));
  const count = R.region === 'heartland' && communityOf(s).active && homes.length ? Math.min(8, Math.ceil(Math.max(0, population(s) - residentWorkers(s)) / 2)) : 0;
  while(R.neighbours.length > count) R.units.remove(R.neighbours.pop()!);
  while(R.neighbours.length < count) { const i = R.neighbours.length, p = person(SHIRTS[i % SHIRTS.length], false); if(i % 2) p.scale.setScalar(0.75); R.neighbours.push(p); R.units.add(p); }
  const t = reducedMotionQuery?.matches ? 0 : time;
  R.neighbours.forEach((p, i) => { const home = homes[i % homes.length], stride = Math.sin(t * 0.35 + i * 1.7); p.position.set(home.x + 1.5 + stride * 1.2, 0.03, home.y + home.d + 0.45); p.rotation.y = Math.cos(t * 0.35 + i * 1.7) > 0 ? Math.PI / 2 : -Math.PI / 2; });
}

function animateUnits(R: Rig, L: Layout, s: GameState, t: number) {
  const r = R.region;
  const plotOf = (id: number) => L.plots.find((p) => p.field.id === id);
  const house = L.lots[0];
  // people
  // everyone working is out in the fields; only a few idle hands loiter in the yard (the rest are indoors)
  let idle = 0;
  const people = s.workers.filter((w) => w.region === r && (w.task || idle++ < 8)).slice(0, 150);
  const seen = new Set<number>();
  people.forEach((w, i) => {
    seen.add(w.id);
    let o = R.people.get(w.id);
    if (!o) { o = person(SHIRTS[w.id % SHIRTS.length], w.role === 'manager'); R.units.add(o); R.people.set(w.id, o); }
    const p = w.task ? plotOf(w.task) : undefined;
    let x: number, z: number;
    if (p) {
      o.scale.y = 1;
      const lane = (w.id * 7) % Math.max(1, p.s - 1);
      x = p.x + 0.35 + ((t * 0.18 + hash(w.id) * p.s) % (p.s - 0.7));
      z = p.y + 0.4 + lane;
      o.position.y = Math.abs(Math.sin(t * 7 + i)) * 0.03;
      o.rotation.y = Math.PI / 2;
    } else {
      x = house.x + house.w + 0.4 + (i % 6) * 0.35 + Math.sin(t * 0.5 + i) * 0.05;
      z = house.y + 1 + Math.floor(i / 6) * 0.35;
      o.position.y = .15;
      o.scale.y = .75;
      o.rotation.y = 0;
    }
    o.position.x = x; o.position.z = z;
  });
  for (const [id, o] of R.people) if (!seen.has(id)) { R.units.remove(o); R.people.delete(id); }
  // machines
  const ms = s.machines.filter((m) => m.region === r && m.type !== 'truck').slice(0, 60);
  const seenM = new Set<number>();
  ms.forEach((m, i) => {
    seenM.add(m.id);
    let o = R.machines.get(m.id);
    if (!o) { o = vehicle(m.type); R.units.add(o); R.machines.set(m.id, o); }
    const p = m.task && !m.broken ? plotOf(m.task) : undefined;
    if (p) {
      const lap = (t * 0.12 + hash(m.id)) % 2;
      const along = lap < 1 ? lap : 2 - lap;
      o.position.set(p.x + 0.4 + along * (p.s - 0.8), 0.1, p.y + 0.5 + ((m.id * 3) % Math.max(1, p.s - 1)));
      o.rotation.y = lap < 1 ? 0 : Math.PI;
    } else {
      o.position.set((L.lots[1]?.x ?? 3) + (i % 8) * 0.8, 0, L.roadY - 0.55 - Math.floor(i / 8) * 0.6);
      o.rotation.y = Math.PI / 2;
    }
  });
  for (const [id, o] of R.machines) if (!seenM.has(id)) { R.units.remove(o); R.machines.delete(id); }
  // trucks leave along the road when goods are hauled to market
  const haul = s.regions[r].haulToday + s.regions[r].truckToday;
  if (R.lastHaul >= 0 && haul > R.lastHaul && R.trucks.length < 5) {
    const o = vehicle('truck');
    R.units.add(o);
    R.trucks.push({ obj: o, t0: t });
  }
  R.lastHaul = haul;
  R.trucks = R.trucks.filter((k) => {
    const x = -4 + (t - k.t0) * 3;
    if (x > L.maxX + 30) { R.units.remove(k.obj); return false; }
    k.obj.position.set(x, 0.02, L.roadY + 0.3);
    return true;
  });
  // animals wander inside their pens
  const seenH = new Set<string>();
  for (const h of s.herds) {
    if (h.region !== r) continue;
    const m = R.models.find((x) => x.lot.type === ANIMAL_BUILDING[h.animal]);
    if (!m?.model.pen) continue;
    const key = h.animal;
    seenH.add(key);
    const want = Math.max(1, Math.min(h.animal === 'chickens' ? 18 : 10, Math.round(h.count / (h.animal === 'chickens' ? 6 : 2))));
    let list = R.herds.get(key) ?? [];
    while (list.length < want) { const o = animal(h.animal); R.units.add(o); list.push(o); }
    while (list.length > want) R.units.remove(list.pop()!);
    R.herds.set(key, list);
    const pen = m.model.pen;
    list.forEach((o, i) => {
      const sp = h.animal === 'chickens' ? 0.25 : 0.08;
      const fx = 0.5 + 0.45 * Math.sin(t * sp + i * 2.3 + hash(i) * 6), fz = 0.5 + 0.45 * Math.cos(t * sp * 0.8 + i * 1.7);
      o.position.set(m.lot.x + pen.x0 + (pen.x1 - pen.x0) * fx, 0, m.lot.y + pen.z0 + (pen.z1 - pen.z0) * fz);
      o.rotation.y = Math.atan2(Math.cos(t * sp + i * 2.3), -Math.sin(t * sp * 0.8 + i * 1.7));
      o.scale.setScalar(h.health < 0.5 ? 0.85 : 1);
    });
  }
  for (const [k, list] of R.herds) if (!seenH.has(k)) { list.forEach((o) => R.units.remove(o)); R.herds.delete(k); }
}

function atmosphere(R: Rig, s: GameState, t: number) {
  const hour = getSpeed() >= 10 ? 13 : (s.tick % 24) + 0.5; // at 10×+ a day flashes past in ~2s, so hold the light at early afternoon
  const dayIdx = Math.floor(s.tick / 24);
  const season = SEASONS[Math.floor((((dayIdx % 120) + 120) % 120) / 30)];
  const r = R.region;
  // sun arc: rises at 6, sets at 18
  const k = Math.sin(((hour - 6) / 12) * Math.PI);
  const elev = Math.max(-0.2, k);
  const az = ((hour - 6) / 12) * Math.PI;
  R.sun.position.set(R.target.x + Math.cos(az) * 40, 18 + Math.max(0.25, Math.abs(elev)) * 45, R.target.z - 25 + Math.sin(az) * 10);
  R.sun.target.position.copy(R.target);
  const day = Math.max(0, Math.min(1, elev * 2.5 + 0.2));
  // by night a cool moonlight keeps the farm readable
  R.sun.intensity = 0.55 + 1.9 * day;
  R.sun.color.set(day < 0.15 ? 0x9fb4e8 : day < 0.6 ? 0xffb37a : 0xfff1d6);
  R.hemi.intensity = 0.7 + 0.35 * day;
  R.hemi.color.set(day < 0.3 ? 0xa9bce6 : 0xfff4e0);
  const sky = day > 0.5 ? 0xbfdbe6 : lerpC(0x1b2638, 0xf0b48a, day * 2).getHex();
  R.scene.background = new THREE.Color(sky);
  (R.ground.material as THREE.MeshStandardMaterial).color.set(REGION_GROUND[r] && season !== 'Winter' ? REGION_GROUND[r]! : r === 'tropics' ? 0x5ea849 : SEASON_GROUND[season]);
  R.crownMat.color.set(r === 'tropics' ? 0x3f8a3a : CROWN[season]);
  // windows glow at night
  const lit = day < 0.35;
  for (const m of R.models) for (const w of m.model.windows) w.material = lit ? mat(PAL.windowLit, { emissive: 0xffb84d }) : mat(PAL.window);
  // sails turn while the mill works
  for (const m of R.models) if (m.model.sails) m.model.sails.rotation.z = m.lot.buildings.some((b) => b.active && b.util > 0.05) ? t * 1.2 : m.model.sails.rotation.z;
  // chimney smoke from working buildings (the farmhouse always)
  for (const sp of R.smoke) {
    const lot = sp.userData.lot as Lot;
    const on = lot.type === 'house' || lot.buildings.some((b) => b.active && b.util > 0.05);
    sp.visible = on;
    if (!on) continue;
    const ph = (t * 0.25 + sp.userData.phase) % 1;
    const o = sp.userData.origin as THREE.Vector3;
    sp.position.set(o.x + ph * 0.6, o.y + ph * 1.8, o.z - ph * 0.3);
    sp.scale.setScalar(0.25 + ph * 0.9);
    (sp.material as THREE.SpriteMaterial).opacity = 0.55 * (1 - ph);
  }
  // rain and snow
  const rain = s.regions[r].rainToday;
  const wet = rain > 0.8;
  R.rain.visible = wet;
  if (wet) {
    const snow = season === 'Winter' && s.regions[r].temp < 3;
    const pm = R.rain.material as THREE.PointsMaterial;
    pm.color.set(snow ? 0xffffff : 0xbcd4e6);
    pm.size = snow ? 0.12 : 0.05;
    const pos = R.rain.geometry.attributes.position as THREE.BufferAttribute;
    const n = Math.min(1500, Math.round((rain - 0.6) * 1500));
    const speed = snow ? 1.2 : 9;
    for (let i = 0; i < pos.count; i++) {
      if (i >= n) { pos.setXYZ(i, 0, -50, 0); continue; }
      const x = R.target.x + (hash(i * 1.3) - 0.5) * 40, z = R.target.z + (hash(i * 2.7) - 0.5) * 40;
      const y = 12 - ((t * speed + hash(i * 4.1) * 12) % 12);
      pos.setXYZ(i, x + (snow ? Math.sin(t + i) * 0.3 : 0), y, z);
    }
    pos.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- HTML overlay (crisp labels and markers)

function overlayLabels(R: Rig, L: Layout, s: GameState, W: number, H: number, el: HTMLDivElement | null, t: number, selected: number[], plantLabel?: string, selectedLot?: string) {
  if (!el) return;
  const want: { key: string; x: number; y: number; html: string; cls: string; action?: string }[] = [];
  const v = new THREE.Vector3();
  const project = (x: number, y: number, z: number) => { v.set(x, y, z).project(R.camera); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H] as const; };
  // "+49 wheat" pops up wherever a harvest just happened (by hand or by the crew)
  for (const p of L.plots) {
    const h = p.field.lastHarvest;
    if (!h || R.seenHarvest.get(p.field.id) === h) continue;
    R.seenHarvest.set(p.field.id, h);
    if (R.popsReady && R.pops.length < 30) R.pops.push({ key: `p${p.field.id}-${t}`, text: `+${num(h.units)} ${GOODS[h.crop].name.toLowerCase()}`, x: p.x + p.s / 2, z: p.y + p.s / 2, t0: t });
  }
  if(t-R.lastCoin>1){
    const delta=s.cash-R.lastCash;
    if(Math.abs(delta)>=1){const at=L.lots.find(l=>l.key==='market')??L.lots[0];R.pops.push({key:`coin-${t}`,text:`${delta>0?'+':'−'}$${num(Math.abs(delta))}`,x:at.x,z:at.y,t0:t,tone:delta>0?'coin-in':'coin-out'});}
    R.lastCash=s.cash;R.lastCoin=t;
  }
  R.popsReady = true; // harvests that existed when the farm loaded don't pop
  R.pops = R.pops.filter((p) => t - p.t0 < 1.8);
  for (const p of R.pops) {
    const [x, y] = project(p.x, 1.2 + (t - p.t0) * 0.9, p.z);
    want.push({ key: p.key, x, y, html: p.text, cls: `wl-pop ${p.tone ?? ''}` });
  }
  const button = (action: string, label: string) => `<button data-action="${action}" type="button"${label==='ⓘ'?' aria-label="Inspect selected item"':''}>${label}</button>`;
  if (selected.length === 1) {
    const p = L.plots.find(q=>q.field.id===selected[0]);
    if(p){
      const ready=isReady(s,p.field), id=p.field.id;
      const [px,py]=project(p.x+p.s/2,1.5,p.y+p.s/2);
      const primary=p.field.ha<=1 ? ready?button(`harvest:${id}`,'🌾 Harvest'):!p.field.crop&&plantLabel?button(`plant:${id}`,'🌱 Plant'):'' : '';
      const plan=stageAtLeast(s,'farm-business')?button(`plan:${id}`,'🌱 Plan'):'';
      want.push({key:'act',x:Math.max(115,Math.min(W-115,px)),y:Math.max(80,Math.min(H-30,py)),html:primary+plan+button(`inspect:${id}`,'ⓘ'),cls:'wl-radial'});
    }
  }
  if(selectedLot){
    const lot=L.lots.find(x=>x.key===selectedLot);
    if(lot){const [px,py]=project(lot.x+lot.w/2,2.5,lot.y+lot.d/2);
      const label=lot.key.startsWith('civic:')?'🏛 Town':lot.key.startsWith('community:')?'🏠 Families':lot.key==='crew'?'👒 Crew':lot.key==='office'?'⚙ Policies':lot.key==='market'?'🪙 Trade':lot.type==='house'||lot.type==='shed'?'📖 Books':BUILDINGS[lot.type].category==='storage'?'📦 Store':'⚙ Manage';
      want.push({key:'place-act',x:Math.max(100,Math.min(W-100,px)),y:Math.max(80,Math.min(H-30,py)),html:button('place:0',label)+button('inspect:0','ⓘ'),cls:'wl-radial'});
    }
  }
  const st=stored(s,R.region), store=L.lots.find(l=>l.type!=='house'&&l.type!=='shed'&&BUILDINGS[l.type].category==='storage');
  if(store&&st.dry>=st.cap.dry*.99){const [x,y]=project(store.x+store.w/2,2,store.y);want.push({key:'full',x,y,html:'📦 FULL',cls:'wl-ready'});}
  const zoomed = R.zoom > 0.45;
  for (const p of L.plots) {
    if (!isReady(s, p.field) || (selected.length === 1 && selected[0] === p.field.id && p.field.ha <= 1)) continue;
    const [x, y] = project(p.x + p.s / 2, 1.1 + Math.sin(t * 3) * 0.06, p.y + p.s / 2);
    if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
    want.push({ key: `r${p.field.id}`, x, y, html: '!', cls: 'wl-ready' });
  }
  if (zoomed) for (const m of R.models) {
    const lot = m.lot;
    const [x, y] = project(lot.x + lot.w / 2, 0, lot.y + lot.d + 0.3);
    if (x < -60 || y < -20 || x > W + 60 || y > H + 20) continue;
    const name = lot.key.startsWith('civic:') ? (lot.key==='civic:hall'?'Town hall':SERVICE_DEFS[lot.key.split(':')[1] as ServiceType].name) : lot.key.startsWith('community:') ? ({cottage:'Cottage',terrace:'Terrace',apartment:'Apartments'}[lot.key.split(':')[1]] ?? 'Neighbourhood') : lot.key === 'crew' ? 'Bunkhouse' : lot.key === 'office' ? 'Farm office' : lot.key === 'market' ? 'Village trader' : lot.type === 'house' ? 'Farmhouse' : lot.type === 'shed' ? 'Office' : BUILDINGS[lot.type].name;
    const lvl = Math.max(1, ...lot.buildings.map((b) => b.level));
    const warn = !!(lot.service?.active && !lot.service.funded) || lot.buildings.some((b) => b.active && /Not enough|full|Disease/.test(b.reason));
    want.push({ key: `l${lot.key}`, x, y, html: `${warn ? '⚠ ' : lot.service && !lot.service.active ? '○ ' : ''}${name}${lot.service && lot.service.count>1?` ×${lot.service.count}`:''}${lot.buildings.length > 1 ? ` ×${lot.buildings.length}` : ''}${lvl > 1 ? ` · L${lvl}` : ''}`, cls: 'wl-name' });
  }
  if (L.buy) {
    const [x, y] = project(L.buy.x + 1, 0.9, L.buy.y + 1);
    want.push({ key: 'buy', x, y, html: 'For sale', cls: 'wl-name' });
  }
  // reconcile pooled elements by key
  const have = new Map<string, HTMLElement>();
  for (const ch of [...el.children] as HTMLElement[]) have.set(ch.dataset.k!, ch);
  for (const w of want) {
    let d = have.get(w.key);
    if (!d) { d = document.createElement('div'); d.dataset.k = w.key; el.appendChild(d); }
    have.delete(w.key);
    if (d.className !== w.cls) d.className = w.cls;
    if (d.innerHTML !== w.html) d.innerHTML = w.html;
    if ((d.dataset.action ?? '') !== (w.action ?? '')) w.action ? (d.dataset.action = w.action, d.setAttribute('role', 'button')) : (delete d.dataset.action, d.removeAttribute('role'));
    d.style.transform = `translate(${w.x}px, ${w.y}px) translate(-50%, -100%)`;
  }
  for (const d of have.values()) d.remove();
}

// ---------------------------------------------------------------- text

function plotText(s: GameState, p: Plot) {
  const f = p.field;
  const lines = [`Field ${f.id} · ${num(f.ha)} ha${f.greenhouse ? ' · greenhouse' : ''}`];
  if (f.crop) {
    const c = CROPS[f.crop];
    if (c.perennial && !isMature(s, f)) lines.push(`${GOODS[f.crop].name} — young trees, ${Math.floor(growth(s, f) * 100)}% to first fruit`);
    else lines.push(`${GOODS[f.crop].name} — ${isReady(s, f) ? 'ready to harvest' : `${Math.floor(growth(s, f) * 100)}% grown`}`);
  } else lines.push(f.plan ? `Fallow · plan: ${GOODS[f.plan].name}` : 'Fallow');
  lines.push(`Fertility ${pct0(fertility(f))}${f.irrigated ? ' · irrigated' : ''}${f.pest > 0.3 ? ' · pests!' : ''}${f.frost > 0 ? ` · frost damage ${pct0(f.frost)}` : ''}`);
  return lines;
}
function lotText(s: GameState, lot: Lot) {
  if(lot.key==='civic:hall')return ['Town hall','Schools, healthcare and the public treasury'];
  if(lot.service){const b=lot.service,d=SERVICE_DEFS[b.type];return [d.name,`${b.staffed}/${d.jobs*b.count} staff`,!b.active?'Paused':b.funded?'Working':'Needs funding or staff'];}
  if(lot.key.startsWith('community:'))return ['Families',`${population(s)} residents`];
  if (lot.type === 'house') return ['Farmhouse', s.workers.length ? `${s.workers.length} people on the payroll` : 'Home'];
  if (lot.type === 'shed') return ['Regional office'];
  const d = BUILDINGS[lot.type];
  const animal = (Object.keys(ANIMAL_BUILDING) as AnimalId[]).find((a) => ANIMAL_BUILDING[a] === lot.type);
  if (animal) {
    const h = s.herds.find((x) => x.animal === animal && x.region === lot.buildings[0]?.region);
    return [`${d.name}${lot.buildings.length > 1 ? ` ×${lot.buildings.length}` : ''}`, h ? `${Math.floor(h.count)} ${ANIMALS[animal].name.toLowerCase()} · health ${pct0(h.health)}` : 'Empty — buy animals', ''];
  }
  const running = lot.buildings.filter((b) => b.active).length;
  const util = lot.buildings.reduce((a, b) => a + b.util, 0) / lot.buildings.length;
  return [`${d.name}${lot.buildings.length > 1 ? ` ×${lot.buildings.length}` : ''}`, d.recipe ? `${running} running · ${pct0(util)} utilised` : d.blurb, lot.buildings.find((b) => b.reason && b.reason !== 'Paused')?.reason ?? ''];
}

// ---------------------------------------------------------------- procedural textures

function grassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const v = 215 + Math.floor(hash(i * 3.3) * 40);
    x.fillStyle = `rgb(${v},${v},${v})`;
    x.fillRect(hash(i * 1.7) * 128, hash(i * 9.1) * 128, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let furrows: THREE.CanvasTexture | null = null;
function furrowTexture() {
  if (furrows) return furrows;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#b08460';
  x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#7d5a3c';
  for (let i = 0; i < 4; i++) x.fillRect(0, i * 16 + 10, 64, 5);
  for (let i = 0; i < 160; i++) { x.fillStyle = hash(i) > 0.5 ? '#9c7350' : '#c19670'; x.fillRect(hash(i * 2.1) * 64, hash(i * 5.3) * 64, 2, 2); }
  furrows = new THREE.CanvasTexture(c);
  furrows.wrapS = furrows.wrapT = THREE.RepeatWrapping;
  furrows.colorSpace = THREE.SRGBColorSpace;
  return furrows;
}

let puff: THREE.CanvasTexture | null = null;
function puffTexture() {
  if (puff) return puff;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const gr = x.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  puff = new THREE.CanvasTexture(c);
  return puff;
}

function syncStorage(R: Rig,L: Layout,s: GameState){
  if(R.lastStockTick===s.tick)return;R.lastStockTick=s.tick;
  const st=stored(s,R.region), n=Math.min(12,Math.ceil(st.dry/Math.max(1,st.cap.dry)*12));
  const at=L.lots.find(l=>l.type!=='house'&&l.type!=='shed'&&BUILDINGS[l.type].category==='storage')??L.lots.find(l=>l.key==='market');
  if(!at)return;
  const signature=`${at.key}:${at.x}:${at.y}:${n}`;
  if(R.storageProps.userData.signature===signature)return;
  R.storageProps.userData.signature=signature;R.storageProps.clear();
  for(let i=0;i<n;i++)R.storageProps.add(box(.32,.27,.32,PAL.wood,at.x+(i%4)*.36,.05+Math.floor(i/4)*.27,at.y+at.d+.4));
}
