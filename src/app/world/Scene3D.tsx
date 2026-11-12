import { SERVICE_DEFS, SERVICE_GROUPS, serviceJobs, serviceRadius, townOf, UTILITY_OF, heatAt, HEAT_FADE } from '../../simulation/town-state';
import type { ServiceType } from '../../simulation/types';
import { communityOf, population, residentWorkers } from '../../simulation/community-state';
// The 3D farm. A live, lit, low-poly picture of the simulation: everything shown is read from game state.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ANIMALS, BUILDINGS, CROPS, GOODS, REGIONS, SEASONS, SUNRISE, SUNSET, type AnimalId, type CropId, type RegionId } from '../../simulation/config';
import { fieldMovable, timingFactor, fertility, growth, isMature, isReady } from '../../simulation/engine';
import { priceUsd, stored } from '../../simulation/core';
import { spreadNeed } from '../../simulation/agriculture';
import type { GameState } from '../../simulation/types';
import { getGame, getSpeed, moveGhost, placementUse, startZoning, stopZoning, zoneHover, zoneTap, type Zoning, prospectHover, prospectTap, roadHover, roadTap, startProspect, startRoads, startPipes, stopProspect, stopRoads, type Placement, type Roading , getPage } from '../../stores/game';
import { featureEra, stageAtLeast } from '../../simulation/stages';
import { preloadArt, artRevision, artModel, playClip } from './art';
import { money, num, pct0 } from '../format';
import { layoutRegion, type Layout, type Lot, type Plot } from './layout';
import { CHUNK, CHUNKS_X, CHUNKS_Y, CLEAR_HOURS, LAND_HA_PER_PATCH, MAP, hasAccess, riverTiles, riverX, tileId, roadRoute, roadStretch, pipeRoute, pipeStretch, plotSide, fieldWater, wetTiers, SMOKE_R, linesOf, NET_TOP, UTILITY_NETS, netReach, doorstep, footprintOf, type NetKind, type UtilityNet, tileAt, forSaleAround, landCost, ownedSet, ROAD_H, ROAD_Y, chunkAt, chunkOrigin, clearCost, clearedSet, isRoad, patchesAround, placeProblem, worldOf } from '../../simulation/world';
import { animal, buildCivic, buildCommunityHome, buildLot, box, cached, cyl, farmhand, hauler, mat, mesh, PAL, person, tree, vehicle, type Model } from './models';
import { haulOf, MARKET_X, marketRoute } from '../../simulation/hauling';
import { oilOf, oilReading, struckFields, SURVEY_R, surveyedAt } from '../../simulation/oil';

/** Graphics quality chosen in Settings (per browser). Low turns off shadows and high-DPI rendering. */
export const graphicsQuality = (): 'high' | 'low' => {
  try { return localStorage.getItem('agrarian.ui.graphics') === '"low"' ? 'low' : 'high'; } catch { return 'high'; }
};

export type WorldPick = { kind: 'field'; id: number; multi: boolean } | { kind: 'lot'; lot: Lot } | { kind: 'buy' } | { kind: 'forest'; x: number; y: number } | { kind: 'none' };

const SEASON_GROUND: Record<string, number> = { Spring: 0x88ba5c, Summer: 0x93b14f, Autumn: 0xb3a253, Winter: 0xe4eaec };
const REGION_GROUND: Partial<Record<RegionId, number>> = { arid: 0xd3bd86, tropics: 0x5ea849 };
const CROWN: Record<string, number> = { Spring: 0x5f9a45, Summer: 0x4f8a3c, Autumn: 0xd08a3a, Winter: 0xf0f3f4 };
const reducedMotionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const SHIRTS = [0xc9553f, 0x3f6fc9, 0xe0b23a, 0x4c9a5a, 0x8a5ac9, 0xd07a2f];
const ANIMAL_BUILDING: Record<AnimalId, Lot['type']> = { chickens: 'coop', pigs: 'pigsty', cows: 'cowshed', sheep: 'sheepfold' };
const hash = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
const lerpC = (a: number, b: number, k: number) => new THREE.Color(a).lerp(new THREE.Color(b), Math.max(0, Math.min(1, k)));

type Shape = 'grain' | 'paddy' | 'stalk' | 'cane' | 'mound' | 'bush' | 'shrub' | 'cone' | 'trunk' | 'crown' | 'dot';
type CropShape = Exclude<Shape, 'trunk' | 'crown' | 'dot'> | 'tree';
const SHAPE: Record<CropId, CropShape> = {
  wheat: 'grain', rice: 'paddy', corn: 'stalk', sugarcane: 'cane', potatoes: 'mound', soybeans: 'bush', cotton: 'shrub', coffee: 'cone', apples: 'tree', grapes: 'tree',
};
/** Small fruit/boll accents: colour and from what growth they show. */
const ACCENT: Partial<Record<CropId, { color: number; from: number; n: number }>> = {
  cotton: { color: 0xf8f6ef, from: 0.6, n: 3 }, coffee: { color: 0xb8392f, from: 0.7, n: 4 }, apples: { color: 0xd2402f, from: 0.75, n: 5 }, grapes: { color: 0x6b3a7e, from: 0.75, n: 4 },
};
const merged = (...parts: THREE.BufferGeometry[]) => mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g))!;
/** One blob of foliage, shaded as part of a single soft canopy centred at height cy rather than as hard facets. */
function blob(r: number, x: number, y: number, z: number, cy: number, sy = 1) {
  const g = new THREE.IcosahedronGeometry(r, 1), p = g.getAttribute('position'), n = g.getAttribute('normal'), a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    a.fromBufferAttribute(p, i).normalize();
    b.fromBufferAttribute(p, i).add(new THREE.Vector3(x, y - cy, z)).normalize();
    a.lerp(b, 0.6).normalize(); n.setXYZ(i, a.x, a.y, a.z);
  }
  return g.scale(1, sy, 1).translate(x, y, z);
}
export const SOFT_PINE = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
const RIPE: Partial<Record<CropId, number>> = { wheat: 0xe0b23f, rice: 0xd9c46a, corn: 0xcfae4a, sugarcane: 0x8fbf55, potatoes: 0x8a9a3a, soybeans: 0xb6a24a, cotton: 0xf6f3ec, coffee: 0xb8392f, apples: 0xd2402f, grapes: 0x6b3a7e };

interface Rig {
  cohortsSeen?: number; oilSeen?: string; glide?: { x: number; z: number; zoom: number }; page?: string;
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera; target: THREE.Vector3; yaw: number; yawTo: number; zoom: number;
  sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; ground: THREE.Mesh;
  lots: THREE.Group; fields: THREE.Group; units: THREE.Group; deco: THREE.Group; fx: THREE.Group; sel: THREE.Group; ghost: THREE.Group; ghostSig: string;
  models: { lot: Lot; model: Model; hit: THREE.Mesh }[]; pick: THREE.Object3D[];
  crops: Partial<Record<Shape, THREE.InstancedMesh>>; sig: { lots: string; fields: string; crops: string; sel: string; deco: string };
  neighbours: THREE.Group[]; people: Map<number, THREE.Group>; machines: Map<number, THREE.Group>; trucks: { obj: THREE.Group; t0: number }[]; herds: Map<string, THREE.Group[]>;
  storageProps: THREE.Group; lastStockTick: number; lastCash: number; lastCoin: number;
  rain: THREE.Points; smoke: THREE.Sprite[]; pops: { key: string; text: string; x: number; z: number; t0: number; tone?: string }[]; seenHarvest: Map<number, object>; popsReady: boolean; crownMat: THREE.MeshStandardMaterial; lastHaul: number; layout: Layout | null; region: RegionId; animT?: number; dt: number;
  roadsG: THREE.Group; roadSig: string; roadPrev: THREE.Group; roadPrevSig: string;
  haulers: Map<string, THREE.Group>; tickSeen: number; tickAt: number;
  riverG: THREE.Group; riverSig: string; foam?: { im: THREE.InstancedMesh; pts: [number, number][]; phase: number[] }; fall?: THREE.Texture;
  oilG: THREE.Group; oilSig: string; zoneG: THREE.Group; zoneSig: string;
  felling?: { chunk: number; trees: THREE.Group[]; fallAt: number[]; extras: THREE.Group };
}

export type WorldAction = 'harvest' | 'plant' | 'inspect' | 'plan' | 'place' | 'fertilise' | 'irrigate' | 'pipes' | 'move' | 'movelot' | 'placeok' | 'placecancel' | 'clear1' | 'clear9' | 'buy1' | 'buy9';

export function Scene3D({ region, selected, onPick, plantLabel, onAction, selectedLot, placing, forestAt, placeCost, roading, prospect, zoning }: { region: RegionId; selected: number[]; onPick: (p: WorldPick) => void; plantLabel?: string; selectedLot?: string; onAction?: (kind: WorldAction, fieldId: number) => void; placing?: Placement | null; forestAt?: [number, number] | null; placeCost?: number; roading?: Roading | null; prospect?: { region: RegionId; hover?: [number, number] } | null; zoning?: Zoning | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const rig = useRef<Rig | null>(null);
  const live = useRef({ region, selected, onPick, plantLabel, onAction, selectedLot, placing, forestAt, placeCost, roading, prospect, zoning });
  live.current = { region, selected, onPick, plantLabel, onAction, selectedLot, placing, forestAt, placeCost, roading, prospect, zoning };
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
      lots: g(), fields: g(), units: g(), deco: g(), fx: g(), sel: g(), ghost: g(), ghostSig: '', models: [], pick: [], crops: {}, sig: { lots: '', fields: '', crops: '', sel: '', deco: '' },
      storageProps: g(), lastStockTick:-1, lastCash:getGame().cash, lastCoin:0,
      neighbours: [], people: new Map(), machines: new Map(), trucks: [], herds: new Map(), rain, smoke: [], pops: [], seenHarvest: new Map(), popsReady: false, crownMat: Object.assign(mat(CROWN.Spring).clone(), { flatShading: false }), lastHaul: -1, layout: null, region, dt: 0,
      roadsG: g(), roadSig: '', roadPrev: g(), roadPrevSig: '', haulers: new Map(), tickSeen: -1, tickAt: 0, riverG: g(), riverSig: '', oilG: g(), oilSig: '', zoneG: g(), zoneSig: '',
    };
    rig.current = R;
    // ?at=x,z (and &zoom=) points the camera somewhere on the map: handy for screenshots and sharing a spot
    const q = new URLSearchParams(location.search), urlAt = q.get('at')?.split(',').map(Number), urlZoom = Number(q.get('zoom'));
    let raf = 0, framed = false, lastCrops = 0, viewSize = '', artVersion = artRevision();
    void preloadArt();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if(artVersion!==artRevision()){
        artVersion=artRevision(); c.dataset.art=String(artVersion); R.sig.lots=''; R.sig.deco='';
        for(const animals of R.herds.values())for(const a of animals)R.units.remove(a);
        R.herds.clear();
        // people, carts and the market were drawn before the models arrived: build them again
        for(const o of [...R.people.values(),...R.haulers.values(),...R.neighbours])R.units.remove(o);
        R.people.clear();R.haulers.clear();R.neighbours.length=0;
        const mk=R.units.getObjectByName('village-market');if(mk)R.units.remove(mk);R.lastStockTick=-1;
      }
      const W = c.clientWidth, H = c.clientHeight;
      if (!W || !H) return;
      const size=`${W}:${H}`;
      if(size!==viewSize){viewSize=size;framed=false;}
      if (c.width !== Math.round(W * renderer.getPixelRatio()) || c.height !== Math.round(H * renderer.getPixelRatio())) renderer.setSize(W, H, false);
      const s = getGame();
      if (R.region !== live.current.region) { R.region = live.current.region; R.sig = { lots: '', fields: '', crops: '', sel: '', deco: '' }; R.roadSig = ''; framed = false; R.lastHaul = -1; }
      const L = layoutRegion(s, R.region);
      R.layout = L;
      if (!framed) {
        frameCamera(R, L, live.current.selected, live.current.selectedLot); framed = true;
        if (urlAt?.length === 2 && urlAt.every(Number.isFinite)) R.target.set(urlAt[0], 0, urlAt[1]); // ?at=x,z points the camera somewhere (screenshots, sharing a spot)
        if (urlZoom > 0) R.zoom = Math.max(0.3, Math.min(4, urlZoom));
      }
      const pg = getPage();
      if (pg !== R.page) { R.page = pg; if (pg === 'community' || pg === 'town') focusCivic(R, L, pg, W, H); }
      if (R.glide) { // ease towards a spot the game wants to show
        const k = 0.12; R.target.x += (R.glide.x - R.target.x) * k; R.target.z += (R.glide.z - R.target.z) * k; R.zoom += (R.glide.zoom - R.zoom) * k;
        if (Math.abs(R.glide.x - R.target.x) + Math.abs(R.glide.z - R.target.z) < 0.02 && Math.abs(R.glide.zoom - R.zoom) < 0.005) R.glide = undefined;
      }
      syncLots(R, L);
      syncFields(R, L);
      if (now - lastCrops > 400) { syncCrops(R, L, s); lastCrops = now; }
      syncSelection(R, L, live.current.selected);
      syncGhost(R, s, live.current.placing ?? null, live.current.forestAt ?? null);
      syncDeco(R, L, s);
      syncRoads(R, s);
      syncRoadPreview(R, s, live.current.roading ?? null);
      syncOil(R, s, live.current.prospect ?? null);
      syncZones(R, s, live.current.zoning ?? null);
      syncStorage(R,L,s);
      animateUnits(R, L, s, now / 1000);
      animateFelling(R, s, now / 1000);
      animateHaul(R, s, now / 1000);
      syncRiver(R);
      animateRiver(R, now / 1000);
      animateNeighbours(R, L, s, now / 1000);
      atmosphere(R, s, now / 1000);
      updateCamera(R, W, H);
      renderer.render(scene, camera);
      overlayLabels(R, L, s, W, H, overlay.current, now / 1000, live.current.selected, live.current.plantLabel, live.current.selectedLot, live.current.placing ?? null, live.current.forestAt ?? null, live.current.placeCost ?? 0);
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
    const groundAt = (sx: number, sy: number) => {
      const R = rig.current;
      if (!R) return null;
      const r = c.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((sx / r.width) * 2 - 1, -(sy / r.height) * 2 + 1), R.camera);
      const hit = ray.intersectObject(R.ground, false)[0];
      return hit ? [Math.floor(hit.point.x), Math.floor(hit.point.z)] as [number, number] : null;
    };
    const ghostTo = (sx: number, sy: number) => {
      const P = live.current.placing, g = groundAt(sx, sy);
      if (P && g) moveGhost([g[0] - Math.floor(P.w / 2), g[1] - Math.floor(P.d / 2)]);
    };
    const pan = (dx: number, dy: number) => {
      if (rig.current) rig.current.glide = undefined; // the player takes the camera back
      const R = rig.current;
      if (!R) return;
      const k = (R.camera.top - R.camera.bottom) / c.clientHeight;
      const right = new THREE.Vector3(Math.cos(R.yaw), 0, -Math.sin(R.yaw));
      const fwd = new THREE.Vector3(-Math.sin(R.yaw), 0, -Math.cos(R.yaw));
      R.target.addScaledVector(right, -dx * k).addScaledVector(fwd, (dy * k) / Math.sin(0.62));
      // stay over the map
      R.target.x = Math.max(MAP.x0 + 10, Math.min(MAP.x0 + MAP.w - 10, R.target.x)); R.target.z = Math.max(MAP.y0 + 10, Math.min(MAP.y0 + MAP.h - 10, R.target.z));
    };
    const zoomBy = (f: number) => { if (rig.current) rig.current.glide = undefined; if (rig.current) rig.current.zoom = Math.max(0.3, Math.min(4, rig.current.zoom * f)); };
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
        if (live.current.placing && e.pointerType === 'mouse') { ghostTo(e.clientX - r.left, e.clientY - r.top); return; }
        if (live.current.roading) { roadHover(groundAt(e.clientX - r.left, e.clientY - r.top)); return; }
        if (live.current.prospect) { prospectHover(groundAt(e.clientX - r.left, e.clientY - r.top)); return; }
        if (live.current.zoning) { zoneHover(groundAt(e.clientX - r.left, e.clientY - r.top)); return; }
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
      if (pts.size === 1 && moved <= 4 && live.current.zoning) { const g = groundAt(e.clientX - r.left, e.clientY - r.top); zoneHover(g); zoneTap(g); pts.delete(e.pointerId); return; }
      if (pts.size === 1 && moved <= 4 && live.current.prospect) { const g = groundAt(e.clientX - r.left, e.clientY - r.top); if (e.pointerType === 'mouse' || (live.current.prospect.hover?.[0] === g?.[0] && live.current.prospect.hover?.[1] === g?.[1])) prospectTap(g); else prospectHover(g); pts.delete(e.pointerId); return; } // on touch: first tap shows the odds, second drills
      if (pts.size === 1 && moved <= 4 && live.current.roading) { const g = groundAt(e.clientX - r.left, e.clientY - r.top); roadHover(g); roadTap(g); pts.delete(e.pointerId); return; }
      if (pts.size === 1 && moved <= 4 && live.current.placing) {
        ghostTo(e.clientX - r.left, e.clientY - r.top);
        // with a mouse, a click on a valid spot places it; on touch the tap only positions the ghost
        if (e.pointerType === 'mouse') requestAnimationFrame(() => live.current.onAction?.('placeok', 0));
        pts.delete(e.pointerId); return;
      }
      if (pts.size === 1 && moved <= 4) {
        const u = pickAt(e.clientX - r.left, e.clientY - r.top);
        const L = rig.current?.layout;
        const multi = e.shiftKey || e.ctrlKey || e.metaKey;
        if (u?.kind === 'field') { live.current.onPick({ kind: 'field', id: u.id, multi }); if(performance.now()-downAt>500)live.current.onAction?.('inspect',u.id); }
        else if (u?.kind === 'lot' && L) { const lot = L.lots.find((q) => q.key === u.key); if (lot) {live.current.onPick({ kind: 'lot', lot });if(performance.now()-downAt>500)live.current.onAction?.('inspect',0);} }
        else if (u?.kind === 'buy') live.current.onPick({ kind: 'buy' });
        else {
          const g = groundAt(e.clientX - r.left, e.clientY - r.top), R = rig.current;
          const forest = g && R && !isRoad(g[1]) && !clearedSet(worldOf(getGame(), R.region)).has(chunkAt(g[0], g[1]));
          live.current.onPick(forest && g ? { kind: 'forest', x: g[0], y: g[1] } : { kind: 'none' });
        }
        setHover(null);
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
        {featureEra(getGame(), 4) && <button data-coach="zones-btn" className={`icon-btn${zoning ? ' on' : ''}`} aria-label="Zones" title="Zones: residential and industrial land" onClick={() => zoning ? stopZoning() : startZoning(region)}>🏘</button>}
        {featureEra(getGame(), 4) && <button className={`icon-btn${prospect ? ' on' : ''}`} aria-label="Oil" title="Oil: survey and drill" onClick={() => prospect ? stopProspect() : startProspect(region)}>🛢</button>}
        <button data-coach="roads-btn" className={`icon-btn${roading && !roading.pipe ? ' on' : ''}`} aria-label="Roads" title="Roads: draw, upgrade or remove" onClick={() => roading && !roading.pipe ? stopRoads() : startRoads(region)}>🛤</button>
        {townOf(getGame()).active && <button className={`icon-btn${roading?.pipe && roading.pipe !== 'irrigation' ? ' on' : ''}`} aria-label="Utilities" title="Town utilities: power, water and sewage lines" onClick={() => roading?.pipe && roading.pipe !== 'irrigation' ? stopRoads() : startPipes(region, 'power')}>🔌</button>}
        {featureEra(getGame(), 2) && <button className={`icon-btn${roading?.pipe === 'irrigation' ? ' on' : ''}`} aria-label="Water lines" title="Water lines: dig ditches, upgrade them to pipes and bury them" onClick={() => roading?.pipe === 'irrigation' ? stopRoads() : startPipes(region)}>💧</button>}
      </div>
    </div>
  );
}

/** A field that needs care: tired soil, or dry ground that irrigation would fix. Only once these tools are open. */
export function fieldNeeds(s: GameState, f: GameState['fields'][number]) {
  const open = s.legacyProgression ? s.era >= 2 : stageAtLeast(s, 'farm-business');
  if (!open || f.greenhouse) return { fertilise: false, irrigate: false, water: null };
  const wat = f.irrigated && !s.legacyProgression ? fieldWater(s, f.region, `field:${f.id}`) : null;
  return {
    fertilise: fertility(f) < 0.5 && !f.spreading,
    irrigate: !f.irrigated && !!f.crop && f.moisture < CROPS[f.crop].water * 0.6,
    /** irrigated, but too few water lines meet it (none at all, or fewer than its size needs) */
    water: wat && wat.points < wat.need ? wat : null,
  };
}

/** How the Fertilise button will feed this plot: free manure first, then fertiliser in store, then buy what is missing. */
export function fertilisePlan(s: GameState, f: GameState['fields'][number]) {
  const inv = s.regions[f.region].inventory, manure = spreadNeed(s, f, 'manure'), fert = spreadNeed(s, f, 'fertilizer');
  if (inv.manure >= manure) return { source: 'manure' as const, buy: 0, cost: 0 };
  if (inv.fertilizer >= fert) return { source: 'fertilizer' as const, buy: 0, cost: 0 };
  const buy = Math.ceil(fert - inv.fertilizer);
  return { source: 'fertilizer' as const, buy, cost: buy * priceUsd(s, f.region, 'fertilizer') };
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

/** Opening Community or Town glides the camera to the homes and services, framed in the part of the map the panel leaves free. */
function focusCivic(R: Rig, L: Layout, page: string, W: number, H: number) {
  const lots = L.lots.filter((l) => l.key.startsWith('community:') || (page === 'town' && l.key.startsWith('civic:')));
  if (!lots.length) return;
  const x0 = Math.min(...lots.map((l) => l.x)), x1 = Math.max(...lots.map((l) => l.x + l.w)), z0 = Math.min(...lots.map((l) => l.y)), z1 = Math.max(...lots.map((l) => l.y + l.d));
  const phone = W <= 900, span = Math.max(x1 - x0, z1 - z0) + 6;
  const zoom = Math.max(0.35, Math.min(1.2, (phone ? 11 : 16) / span));
  const perPx = (2 * 9 / zoom) / H, rx = Math.cos(R.yaw), rz = -Math.sin(R.yaw), bx = Math.sin(R.yaw), bz = Math.cos(R.yaw);
  // desktop: the panel covers the right 480px, so aim right of the homes; phone: the sheet covers the bottom 62%, so aim below them
  const right = phone ? 0 : 240 * perPx, down = phone ? (0.31 * H * perPx) / Math.sin(0.62) : 0;
  R.glide = { x: (x0 + x1) / 2 + rx * right + bx * down, z: (z0 + z1) / 2 + rz * right + bz * down, zoom };
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

/** What a lot is called on the map and when moving it. */
export const lotName = (lot: Lot) => lot.key.startsWith('civic:') ? (lot.key==='civic:hall'?'Town hall':SERVICE_DEFS[lot.key.split(':')[1] as ServiceType].name) : lot.key.startsWith('community:') ? ({cottage:'Cottage',terrace:'Terrace',apartment:'Apartments'}[lot.key.split(':')[1]] ?? 'Neighbourhood') : lot.key === 'crew' ? 'Bunkhouse' : lot.key === 'office' ? 'Farm office' : lot.key === 'market' ? 'Village trader' : lot.type === 'house' ? 'Farmhouse' : lot.type === 'shed' ? 'Office' : BUILDINGS[lot.type].name;
/** A point in a lot's own (unturned) frame, carried round with the lot's turn; returns lot-relative map coordinates. */
function turnPoint(l: Lot, x: number, z: number): [number, number] {
  const bw = l.rot % 2 ? l.d : l.w, bd = l.rot % 2 ? l.w : l.d, a = (l.rot * Math.PI) / 2, dx = x - bw / 2, dz = z - bd / 2;
  return [l.w / 2 + dx * Math.cos(a) + dz * Math.sin(a), l.d / 2 - dx * Math.sin(a) + dz * Math.cos(a)];
}
function syncLots(R: Rig, L: Layout) {
  const sig = L.lots.map((l) => `${l.key}:${l.type}@${l.x},${l.y}r${l.rot}:${l.buildings.length}:${l.buildings.map((b) => b.level).join('')}`).join('|');
  if (sig === R.sig.lots) return;
  R.sig.lots = sig;
  clear(R.lots);
  R.models = [];
  R.pick = R.pick.filter((o) => o.userData.kind !== 'lot');
  for (const lot of L.lots) {
    const bw = lot.rot % 2 ? lot.d : lot.w, bd = lot.rot % 2 ? lot.w : lot.d; // built unturned, then turned about its centre
    const model = lot.key.startsWith('civic:') ? buildCivic(lot.key.split(':')[1], bw, bd) : lot.key.startsWith('community:') ? buildCommunityHome(lot.key.split(':')[1], bw, bd, lot.key) : buildLot(lot.type, bw, bd, lot.key === 'crew' || lot.key === 'office' || lot.key === 'market' ? lot.key : '');
    const inner = new THREE.Group(); inner.add(...model.group.children); inner.position.set(-bw / 2, 0, -bd / 2); model.group.add(inner);
    model.group.position.set(lot.x + lot.w / 2, 0, lot.y + lot.d / 2); model.group.rotation.y = (lot.rot * Math.PI) / 2;
    model.smoke = model.smoke.map((p) => { const [x, z] = turnPoint(lot, p.x, p.z); return new THREE.Vector3(x, p.y, z); });
    if (model.pen) { const [ax, az] = turnPoint(lot, model.pen.x0, model.pen.z0), [bx, bz] = turnPoint(lot, model.pen.x1, model.pen.z1); model.pen = { x0: Math.min(ax, bx), z0: Math.min(az, bz), x1: Math.max(ax, bx), z1: Math.max(az, bz) }; }
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
    const n = shape === 'tree' ? Math.max(2, Math.min(16, Math.round(p.s * 0.75))) : Math.max(3, Math.min(graphicsQuality() === 'low' ? 14 : 22, Math.round(p.s * 1.7)));
    const step = (p.s - 0.4) / n;
    // big fields: fewer, larger plants so they still read as a crop from afar
    const big = shape === 'tree' ? 1 : Math.min(2.2, Math.max(1, step / 0.55));
    const wilt = ready ? 1-timingFactor(s,f) : 0;
    const scaleBase = perennial ? (mature ? 1 : 0.35 + 0.65 * g) : 0.25 + 0.75 * g;
    let col = lerpC(0x9fd46b, shape === 'grain' ? 0x7fae45 : 0x4f8f3a, perennial ? (mature ? 1 : g) : g);
    // crops that show fruit or bolls stay green; the accents carry the ripe colour
    if (ready) col = ACCENT[c] ? new THREE.Color(0x3f7f35) : new THREE.Color(RIPE[c] ?? GOODS[c].color);
    if (f.pest > 0.35) col.lerp(new THREE.Color(0x8a7a3a), Math.min(0.7, f.pest));
    if(wilt>0)col.lerp(new THREE.Color(0x766044),wilt);
    if (f.frost > 0) col.lerp(new THREE.Color(0xa7b3b6), f.frost);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const jx = (hash(f.id * 97 + i * 13 + j) - 0.5) * step * 0.35, jz = (hash(f.id * 31 + i * 7 + j * 3) - 0.5) * step * 0.35;
      const x = p.x + 0.2 + step * (i + 0.5) + jx, z = p.y + 0.2 + step * (j + 0.5) + jz;
      const k = big * scaleBase * (0.85 + 0.3 * hash(i * 17 + j * 5 + f.id));
      q.setFromAxisAngle(up, hash(i + j * 9 + f.id) * Math.PI * 2);
      if (shape === 'tree') {
        const ts = (c === 'grapes' ? 0.55 : 1) * k;
        items.push({ shape: 'trunk', m: new THREE.Matrix4().compose(new THREE.Vector3(x, 0.1, z), q, new THREE.Vector3(ts, ts, ts)), c: new THREE.Color(PAL.woodDark) });
        const crownCol = ready && !ACCENT[c] ? lerpC(0x4f8a3c, RIPE[c]!, 0.55) : lerpC(0x9fd46b, 0x4f8a3c, mature ? 1 : g);
        items.push({ shape: 'crown', m: new THREE.Matrix4().compose(new THREE.Vector3(x, 0.1 + 0.62 * ts, z), q, new THREE.Vector3(ts * (c === 'grapes' ? 1.4 : 1), ts * (c === 'grapes' ? 0.7 : 1), ts)), c: crownCol });
      } else items.push({ shape, m: new THREE.Matrix4().compose(new THREE.Vector3(x, 0.1, z), q, new THREE.Vector3(k, k*(1-wilt*.6), k)), c: col });
      const acc = ACCENT[c], shown = perennial ? (mature ? (ready ? 1 : 0.85) : 0) : g;
      if (acc && shown >= acc.from && wilt < 0.6) {
        const tall = shape === 'tree' ? (c === 'grapes' ? 0.55 : 1) * k : k;
        const cy = shape === 'tree' ? 0.1 + (0.62 + 0.3) * tall : shape === 'cone' ? 0.35 * k : 0.22 * k;
        const spread = shape === 'tree' ? 0.36 * tall : shape === 'cone' ? 0.12 * k : 0.14 * k;
        const accCol = new THREE.Color(ready || c === 'cotton' ? acc.color : 0x6f9a3a);
        for (let a = 0; a < acc.n; a++) {
          const ang = hash(f.id * 3 + i * 11 + j * 5 + a) * Math.PI * 2, h = (hash(a * 7 + i + j * 3 + f.id) - 0.5) * spread;
          const ds = shape === 'tree' ? tall : k;
          items.push({ shape: 'dot', m: new THREE.Matrix4().compose(new THREE.Vector3(x + Math.cos(ang) * spread, cy + h, z + Math.sin(ang) * spread), q, new THREE.Vector3(ds, ds, ds)), c: accCol });
        }
      }
    }
  }
  const sig = `${items.length}:${L.plots.map((p) => `${p.field.crop}${Math.round(growth(s, p.field) * 12)}${isReady(s, p.field) ? 'r' : ''}${p.field.pest > 0.35 ? 'p' : ''}${Math.round(p.field.frost * 4)}${Math.round(timingFactor(s,p.field)*8)}`).join('')}`;
  if (sig === R.sig.crops) return;
  R.sig.crops = sig;
  const geos: Record<Shape, () => THREE.BufferGeometry> = {
    // wheat: a tuft of three blades with seed heads
    grain: () => merged(...[-0.35, 0.05, 0.4].map((a, n) => new THREE.ConeGeometry(0.035, 0.46 - n * 0.04, 4).translate(0, 0.23, 0).rotateZ(a * 0.35).rotateY(n * 2.1).translate(Math.sin(n * 2.1) * 0.04, 0, Math.cos(n * 2.1) * 0.04))),
    // rice: lower, wider tuft of arching leaves
    paddy: () => merged(...[0, 1, 2, 3].map(n => new THREE.ConeGeometry(0.03, 0.32, 4).translate(0, 0.16, 0).rotateZ(0.45).rotateY(n * Math.PI / 2))),
    // corn: tall stem with two leaves and a cob
    stalk: () => merged(new THREE.CylinderGeometry(0.025, 0.04, 0.85, 5).translate(0, 0.42, 0), new THREE.BoxGeometry(0.34, 0.015, 0.07).translate(0.15, 0.4, 0).rotateZ(-0.35), new THREE.BoxGeometry(0.3, 0.015, 0.07).translate(-0.13, 0.58, 0).rotateZ(0.4).rotateY(1.2), new THREE.CylinderGeometry(0.035, 0.04, 0.14, 5).translate(0.05, 0.5, 0)),
    // sugarcane: a clump of tall jointed canes
    cane: () => merged(...[0, 1, 2].map(n => new THREE.CylinderGeometry(0.022, 0.026, 0.95 - n * 0.1, 5).translate(Math.cos(n * 2.1) * 0.05, 0.47 - n * 0.05, Math.sin(n * 2.1) * 0.05)), new THREE.ConeGeometry(0.12, 0.2, 5).translate(0, 0.95, 0)),
    // potatoes: low leafy mounds
    mound: () => new THREE.IcosahedronGeometry(0.16, 0).scale(1.2, 0.45, 1.2).translate(0, 0.06, 0),
    // soybeans: round bushy plants
    bush: () => new THREE.IcosahedronGeometry(0.14, 1).scale(1, 0.85, 1).translate(0, 0.12, 0),
    // cotton: taller open shrub
    shrub: () => merged(new THREE.CylinderGeometry(0.015, 0.02, 0.2, 4).translate(0, 0.1, 0), new THREE.IcosahedronGeometry(0.13, 0).scale(1, 1.2, 1).translate(0, 0.24, 0)),
    // coffee: conical glossy shrub
    cone: () => new THREE.ConeGeometry(0.16, 0.5, 7).translate(0, 0.25, 0),
    trunk: () => new THREE.CylinderGeometry(0.05, 0.07, 0.6, 6).translate(0, 0.3, 0),
    crown: () => new THREE.IcosahedronGeometry(0.34, 1).translate(0, 0.3, 0),
    dot: () => new THREE.IcosahedronGeometry(0.07, 0),
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

/** The placement ghost (green where it fits, red where it does not) and the forest patches about to be cleared. */
function syncGhost(R: Rig, s: GameState, P: Placement | null, forest: [number, number] | null) {
  const sig = P ? `${P.region}:${P.at}:${P.w}x${P.d}r${P.rot ?? 0}:${P.key ?? ''}:${worldOf(s, P.region).cleared.length}` : forest ? `f${forest}:${worldOf(s, R.region).queue.length}` : '';
  if (sig === R.ghostSig) return;
  R.ghostSig = sig;
  clear(R.ghost);
  if (P) {
    const ok = !placeProblem(s, P.region, P.at[0], P.at[1], { w: P.w, d: P.d }, P.key, P.kind === 'move' ? undefined : placementUse(P));
    const box = mesh(new THREE.BoxGeometry(P.w, 0.25, P.d), new THREE.MeshBasicMaterial({ color: ok ? 0x6fd36a : 0xe0533d, transparent: true, opacity: 0.45, depthWrite: false }), P.at[0] + P.w / 2, 0.13, P.at[1] + P.d / 2, false);
    R.ghost.add(box);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(P.w, 0.25, P.d)), new THREE.LineBasicMaterial({ color: ok ? 0x2f8f3a : 0xa02a1a }));
    edge.position.set(P.at[0] + P.w / 2, 0.13, P.at[1] + P.d / 2);
    R.ghost.add(edge);
    if (!P.key?.startsWith('field:') && P.action.type !== 'buyPlot' && P.action.type !== 'buyParcel') { // an arrow out of the front door: the track starts here
      const r = P.rot ?? 0, [fx, fz] = [[P.w / 2, P.d], [P.w, P.d / 2], [P.w / 2, 0], [0, P.d / 2]][r], [ox, oz] = [[0, 1], [1, 0], [0, -1], [-1, 0]][r];
      const arrow = mesh(cached('doorarrow', () => new THREE.ConeGeometry(0.32, 0.55, 3).rotateX(Math.PI / 2).scale(1, 0.15, 1)), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }), P.at[0] + fx + ox * 0.45, 0.28, P.at[1] + fz + oz * 0.45, false);
      arrow.rotation.y = Math.atan2(ox, oz); R.ghost.add(arrow);
    }
    // a refinery shows how far its smoke reaches: homes inside it lose health
    const refining = (P.action.type === 'build' && P.action.building === 'refinery') || (P.key?.startsWith('b:') && s.buildings.find((b) => `b:${b.id}` === P.key)?.type === 'refinery');
    if (refining) {
      R.ghost.add(mesh(new THREE.RingGeometry(SMOKE_R - 0.25, SMOKE_R, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xc0392b, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }), P.at[0] + P.w / 2, 0.06, P.at[1] + P.d / 2, false));
      R.ghost.add(mesh(new THREE.CircleGeometry(SMOKE_R, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7a6a5a, transparent: true, opacity: 0.12, depthWrite: false }), P.at[0] + P.w / 2, 0.05, P.at[1] + P.d / 2, false));
    }
    // a town service shows its reach as a heat map (full in the middle, fading to its edge), with the others of its kind; utilities reach homes by their lines instead
    const svc = P.key?.startsWith('svc:') ? townOf(s).services.find((b) => `svc:${b.id}` === P.key) : undefined;
    const svcType = P.action.type === 'buildService' ? P.action.service : svc?.type;
    const rad = svcType && !UTILITY_OF[svcType] && svcType !== 'road' ? serviceRadius(svc ?? { type: svcType }) : undefined;
    if (svcType && rad) {
      const group = Object.values(SERVICE_GROUPS).find((g) => (g as readonly string[]).includes(svcType)) as readonly string[] | undefined ?? [svcType];
      const glow = (x: number, z: number, r: number, strong: boolean) => { const m = mesh(cached('heat-disc', () => new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: strong ? 0x2f86c8 : 0x6aa8d4, map: heatTexture(), transparent: true, opacity: strong ? 0.75 : 0.4, depthWrite: false }), x, strong ? 0.06 : 0.05, z, false); m.scale.set(r * (1 + HEAT_FADE), 1, r * (1 + HEAT_FADE)); R.ghost.add(m); };
      const gx = P.at[0] + P.w / 2, gz = P.at[1] + P.d / 2, pos = worldOf(s, P.region).pos, heats: [number, number, number][] = [[gx, gz, rad]];
      glow(gx, gz, rad, true);
      for (const b of townOf(s).services) if (group.includes(b.type) && `svc:${b.id}` !== P.key) { const q = pos[`svc:${b.id}`]; if (q) { const r2 = serviceRadius(b); glow(q[0] + 1.5, q[1] + 1.5, r2, false); heats.push([q[0] + 1.5, q[1] + 1.5, r2]); } }
      // a marker over every home: green when fully served, amber at the fading edge, red when nothing reaches it
      const pin = cached('reach-pin', () => new THREE.OctahedronGeometry(0.32, 0));
      for (const [k, q] of Object.entries(pos)) {
        if (!k.startsWith('home:')) continue;
        const hx = q[0] + 1.5, hz = q[1] + 1.5, v = Math.max(...heats.map(([x, z, r2]) => heatAt(Math.hypot(hx - x, hz - z), r2)));
        R.ghost.add(mesh(pin, new THREE.MeshBasicMaterial({ color: v >= 0.99 ? 0x4cc35a : v > 0 ? 0xf2b82c : 0xe0533d }), hx, 2.6, hz, false));
      }
    }
    return;
  }
  // owned forest: the patches the crew would clear; land beyond the fence: the patches for sale
  if (forest) for (const c of ownedSet(worldOf(s, R.region)).has(chunkAt(forest[0], forest[1])) ? patchesAround(s, R.region, forest[0], forest[1], 3) : forSaleAround(s, R.region, forest[0], forest[1], 3)) {
    const [ox, oy] = chunkOrigin(c), center = c === chunkAt(forest[0], forest[1]);
    // a glowing tile over the patch, drawn through the trees so the player sees exactly what they would buy or clear
    const tile = mesh(cached('patch-hl', () => new THREE.PlaneGeometry(CHUNK - 0.15, CHUNK - 0.15).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: center ? 0xffc94d : 0xf2dc9a, transparent: true, opacity: center ? 0.42 : 0.26, depthTest: false, depthWrite: false }), ox + CHUNK / 2, 0.2, oy + CHUNK / 2, false);
    tile.renderOrder = 5; R.ghost.add(tile);
    const pts = [[ox, oy], [ox + CHUNK, oy], [ox + CHUNK, oy + CHUNK], [ox, oy + CHUNK]].map(([x, z]) => new THREE.Vector3(x, 0.2, z));
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: center ? 0xffc94d : 0xd8b46a, transparent: true, opacity: center ? 1 : 0.7, depthTest: false }));
    line.renderOrder = 6; R.ghost.add(line);
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

type Gate = { a: [number, number]; b: [number, number]; inX: number; inZ: number };
const GATE_WOOD = 0xb38d5c, GATE_POST = 0x7a5536;
/** One leaf of a five-bar field gate, hinged at the origin and reaching along +x: stiles, rails and the diagonal brace. */
function gateLeaf(len: number) {
  return cached(`gateleaf${len.toFixed(2)}`, () => {
    const parts = [new THREE.BoxGeometry(0.05, 0.46, 0.05).translate(0.04, 0.27, 0), new THREE.BoxGeometry(0.04, 0.42, 0.04).translate(len - 0.03, 0.25, 0)];
    for (const [y, h] of [[0.09, 0.03], [0.17, 0.03], [0.25, 0.03], [0.33, 0.03], [0.43, 0.05]] as const) parts.push(new THREE.BoxGeometry(len - 0.04, h, 0.03).translate(len / 2, y, 0));
    const run = len - 0.12, rise = 0.32, brace = new THREE.BoxGeometry(Math.hypot(run, rise), 0.03, 0.025);
    parts.push(brace.rotateZ(Math.atan2(rise, run)).translate(0.06 + run / 2, 0.09 + rise / 2, 0.02));
    parts.push(new THREE.BoxGeometry(0.07, 0.04, 0.07).translate(len - 0.02, 0.3, 0)); // the latch
    return merged(...parts);
  });
}
/** Stout gateposts either side of a road through the fence, the gate (two leaves on a wide road) swung open against the verge. */
function farmGate({ a, b, inX, inZ }: Gate) {
  const g = new THREE.Group(), dx = Math.sign(b[0] - a[0]), dz = Math.sign(b[1] - a[1]), width = Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (const [px, pz] of [a, b]) {
    g.add(mesh(cached('gatepost', () => new THREE.BoxGeometry(0.12, 0.62, 0.12).translate(0, 0.31, 0)), mat(GATE_POST), px, 0, pz));
    g.add(mesh(cached('gatecap', () => new THREE.ConeGeometry(0.1, 0.07, 4).rotateY(Math.PI / 4).translate(0, 0.655, 0)), mat(PAL.woodDark), px, 0, pz));
  }
  const leaves: [[number, number], number][] = width > 1.5 ? [[a, 1], [b, -1]] : [[a, 1]];
  for (const [[hx, hz]] of leaves) {
    const len = (width > 1.5 ? width / 2 : width) - 0.1, leaf = mesh(gateLeaf(len), mat(GATE_WOOD), hx + inX * 0.06 + dx * 0.06 * (hx === a[0] && hz === a[1] ? 1 : -1), 0, hz + inZ * 0.06 + dz * 0.06 * (hx === a[0] && hz === a[1] ? 1 : -1));
    leaf.rotation.y = Math.atan2(-inZ, inX) + (hx === a[0] && hz === a[1] ? -1 : 1) * 0.12; // swung right back, nearly against the verge
    g.add(leaf);
  }
  return g;
}

type TreeSpot = { x: number; z: number; k: number; ky: number; rot: number; kind: 0 | 1 | 2 }; // 0 oak, 1 pine, 2 birch
/** The trees of one forest patch: an uneven number, scattered with a little spacing, a mix of oak, pine and birch. */
function patchTrees(c: number, ox: number, oy: number, n: number): TreeSpot[] {
  const spots: TreeSpot[] = [];
  for (let tries = 0; spots.length < n && tries < n * 4; tries++) {
    const x = ox + 0.3 + hash(c * 7.1 + tries * 3.3) * (CHUNK - 0.6), z = oy + 0.3 + hash(c * 3.7 + tries * 5.9 + 1) * (CHUNK - 0.6);
    if (spots.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 0.45)) continue;
    if (isRoad(Math.floor(z)) || isRoad(Math.floor(z + 0.6)) || isRoad(Math.floor(z - 0.6))) continue;
    const k = 0.7 + hash(c * 1.3 + tries) * 0.9;
    const kind = hash(c * 2.9 + tries) < 0.3 + 0.3 * hash(c * 0.11) ? 1 : hash(c * 5.3 + tries) < 0.22 ? 2 : 0;
    spots.push({ x, z, k, ky: k * (0.9 + hash(c + tries) * 0.3), rot: hash(c + tries * 11) * 6.28, kind });
  }
  return spots;
}
const seasonOf = (s: GameState) => SEASONS[Math.floor((((Math.floor(s.tick / 24) % 120) + 120) % 120) / 30)];

/** Scenery: the road and the forest. Every patch not yet cleared is woodland, drawn with a few instanced meshes. */
function syncDeco(R: Rig, L: Layout, s: GameState) {
  const w = worldOf(s, R.region);
  // Only woods near the view are drawn; the set is rebuilt when the camera moves or zooms far enough.
  const reach = Math.min(150, 9 / R.zoom * 3 + 12), step = Math.max(6, reach / 4);
  const cx = Math.round(R.target.x / step) * step, cz = Math.round(R.target.z / step) * step, rb = Math.ceil(reach / 6) * 6;
  const bare = seasonOf(s) === 'Winter' && R.region !== 'tropics';
  const sig = `${R.region}:${w.cleared.length}:${w.owned.length}:${Object.keys(w.roads).length}:${w.queue.map((j) => j.chunk).join(',')}:${cx},${cz},${rb}:${R.zoom < 0.5}:${bare}`;
  if (sig === R.sig.deco) return;
  R.sig.deco = sig;
  clear(R.deco);
  const cleared = clearedSet(w), felling = w.queue[0]?.chunk, waiting = new Set(w.queue.slice(1).map((j) => j.chunk));
  const trunks: THREE.Matrix4[] = [], trunkCol: THREE.Color[] = [], oaks: THREE.Matrix4[] = [], oakCol: THREE.Color[] = [], birches: THREE.Matrix4[] = [], birchCol: THREE.Color[] = [], pines: THREE.Matrix4[] = [], pineCol: THREE.Color[] = [], ribbons: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  // the woods stay just as thick at every zoom; far out each tree is drawn with fewer faces instead (low graphics thins them)
  const sparse = graphicsQuality() === 'low', far = R.zoom < 0.5;
  const BARK = new THREE.Color(PAL.woodDark), BIRCH = new THREE.Color(0xe8e4da);
  // Walk the patches around the view; beyond the map edge the woods simply continue (scenery, never cleared).
  const gx0 = Math.floor((cx - rb - MAP.x0) / CHUNK) - 1, gx1 = Math.ceil((cx + rb - MAP.x0) / CHUNK) + 1;
  const gy0 = Math.floor((cz - rb - MAP.y0) / CHUNK) - 1, gy1 = Math.ceil((cz + rb - MAP.y0) / CHUNK) + 1;
  for (let gy = gy0; gy <= gy1; gy++) for (let gxx = gx0; gxx <= gx1; gxx++) {
    const inside = gxx >= 0 && gy >= 0 && gxx < CHUNKS_X && gy < CHUNKS_Y;
    const c = inside ? gy * CHUNKS_X + gxx : 100000 + (gy + 500) * 2000 + (gxx + 500); // stable id for scenery patches
    if (inside && (cleared.has(c) || c === felling)) continue; // the patch being felled is drawn tree by tree
    const ox = MAP.x0 + gxx * CHUNK, oy = MAP.y0 + gy * CHUNK;
    const src = riverSource(R.region);
    if (ox + CHUNK > MARKET_X - 6 && ox < MARKET_X + 4 && oy + CHUNK > ROAD_Y - 6 && oy < ROAD_Y) continue; // the village market's clearing
    const dense = hash(c * 0.37 + 5), n = Math.round(sparse ? 3 + dense * 3 : 6 + dense * 6);
    const river = riverTiles(R.region);
    for (const p of patchTrees(c, ox, oy, n)) {
      if (inside && [-2, -1, 0, 1, 2].some((d) => river.has(tileId(Math.floor(p.x) + d, Math.floor(p.z))))) continue; // keep the banks clear
      if (p.z >= MAP.y0 + MAP.h && Math.abs(p.x - riverX(R.region, Math.floor(p.z)) - 1) < 3.5) continue; // and where it flows on past the map
      let ty = 0;
      if (p.z < MAP.y0) { // on the mountains: trees thin out up the slopes, none on rock or in the gorge
        ty = mountainH(p.x, p.z, src);
        const slope = Math.abs(mountainH(p.x + 0.6, p.z, src) - ty) + Math.abs(mountainH(p.x, p.z - 0.6, src) - ty);
        if (ty > 6.5 || slope > 1.1 || hash(p.x * 1.7 + p.z) < ty / 8 || Math.abs(p.x - gorgeX(src, MAP.y0 - p.z)) < 2.5) continue;
      }
      q.setFromAxisAngle(up, p.rot);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, ty, p.z), q, new THREE.Vector3(p.k, p.ky, p.k));
      const shade = 0.82 + hash(p.x * 3.1 + p.z) * 0.3;
      trunks.push(p.kind === 2 ? m.clone().multiply(new THREE.Matrix4().makeScale(0.75, 1.5, 0.75)) : m); trunkCol.push(p.kind === 2 ? BIRCH : BARK);
      if (p.kind === 1) { pines.push(m); pineCol.push(new THREE.Color().setScalar(shade)); }
      else if (p.kind === 2) { birches.push(m); birchCol.push(new THREE.Color(shade * 1.08, shade * 1.12, shade * 0.8)); }
      else { oaks.push(m); oakCol.push(new THREE.Color().setScalar(shade)); }
    }
    if (inside && waiting.has(c)) { // a red ribbon marks patches waiting for the crew
      const r = hash(c * 9.7) * 6.28;
      ribbons.push(new THREE.Matrix4().makeTranslation(ox + CHUNK / 2 + Math.cos(r) * 1.4, 0, oy + CHUNK / 2 + Math.sin(r) * 1.4));
    }
  }
  // the farm's boundary: low posts and a rail wherever land you own meets land you don't
  const gates: Gate[] = [], owned = ownedSet(w), rails: THREE.Matrix4[] = [], posts: THREE.Matrix4[] = [], turn = new THREE.Quaternion().setFromAxisAngle(up, Math.PI / 2), flat = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  for (let gy = Math.max(0, gy0); gy <= Math.min(CHUNKS_Y - 1, gy1); gy++) for (let gxx = Math.max(0, gx0); gxx <= Math.min(CHUNKS_X - 1, gx1); gxx++) {
    const c = gy * CHUNKS_X + gxx;
    if (!owned.has(c)) continue;
    const ox = MAP.x0 + gxx * CHUNK, oy = MAP.y0 + gy * CHUNK;
    const edge = (nx: number, ny: number) => nx < 0 || ny < 0 || nx >= CHUNKS_X || ny >= CHUNKS_Y || !owned.has(ny * CHUNKS_X + nx);
    // a tile of road or track on either side of the line leaves a gap: the fence never crosses or runs along a road
    const open = (tx: number, ty: number) => isRoad(ty) || w.roads[tileId(tx, ty)] !== undefined;
    const side = (x: number, z: number, along: boolean, inX: number, inZ: number) => {
      let run = -1; // where a road crosses: stout posts either side and a five-bar gate swung open into the farm
      for (let i = 0; i <= CHUNK; i++) {
        const tx = along ? x - CHUNK / 2 + i : x, ty = along ? z : z - CHUNK / 2 + i;
        const crossing = i < CHUNK && (along ? open(tx, ty - 1) && open(tx, ty) : open(tx - 1, ty) && open(tx, ty));
        if (crossing && run < 0) run = i;
        if (!crossing && run >= 0) {
          const width = i - run, at = (k: number): [number, number] => (along ? [x - CHUNK / 2 + k, z] : [x, z - CHUNK / 2 + k]);
          if (width <= 3) gates.push({ a: at(run), b: at(i), inX, inZ });
          run = -1;
        }
        if (i === CHUNK) break;
        if (along ? open(tx, ty - 1) || open(tx, ty) : open(tx - 1, ty) || open(tx, ty)) continue;
        for (const ry of [0.13, 0.27]) rails.push(new THREE.Matrix4().compose(new THREE.Vector3(along ? tx + 0.5 : x, ry, along ? z : ty + 0.5), along ? flat : turn, one));
        posts.push(new THREE.Matrix4().makeTranslation(along ? tx : x, 0, along ? z : ty));
        if (i === CHUNK - 1 || (along ? open(tx + 1, ty - 1) || open(tx + 1, ty) : open(tx - 1, ty + 1) || open(tx, ty + 1))) posts.push(new THREE.Matrix4().makeTranslation(along ? tx + 1 : x, 0, along ? z : ty + 1));
      }
    };
    if (edge(gxx, gy - 1)) side(ox + CHUNK / 2, oy, true, 0, 1);
    if (edge(gxx, gy + 1)) side(ox + CHUNK / 2, oy + CHUNK, true, 0, -1);
    if (edge(gxx - 1, gy)) side(ox, oy + CHUNK / 2, false, 1, 0);
    if (edge(gxx + 1, gy)) side(ox + CHUNK, oy + CHUNK / 2, false, -1, 0);
  }
  for (const gt of gates) R.deco.add(farmGate(gt));
  const inst = (geo: THREE.BufferGeometry, material: THREE.Material, list: THREE.Matrix4[], cols?: THREE.Color[]) => {
    const im = new THREE.InstancedMesh(geo, material, Math.max(1, list.length));
    list.forEach((m, i) => { im.setMatrixAt(i, m); if (cols) im.setColorAt(i, cols[i]); });
    im.count = list.length; im.castShadow = false; im.receiveShadow = false; im.frustumCulled = false;
    R.deco.add(im);
  };
  inst(cached('forest-trunk', () => new THREE.CylinderGeometry(0.06, 0.1, 0.6, 6).translate(0, 0.3, 0)), mat(0xffffff), trunks, trunkCol);
  if (bare) {
    // winter: broadleaf trees stand bare
    inst(cached('forest-bare', () => merged(...[0, 1, 2, 3].map((n) => new THREE.CylinderGeometry(0.015, 0.035, 0.55, 4).translate(0, 0.27, 0).rotateZ(0.55).rotateY(n * 1.6 + 0.3).translate(0, 0.55, 0)))), mat(PAL.woodDark), [...oaks, ...birches]);
  } else {
    inst(far ? cached('forest-leafy-far', () => new THREE.IcosahedronGeometry(0.5, 0).scale(1.1, 0.9, 1.1).translate(0, 0.82, 0).toNonIndexed()) : cached('forest-leafy-soft', () => merged(blob(0.4, 0, 0.92, 0, 0.8), blob(0.32, 0.26, 0.74, 0.08, 0.8), blob(0.3, -0.22, 0.76, -0.14, 0.8), blob(0.27, 0.02, 0.7, 0.28, 0.8))), R.crownMat, oaks, oakCol);
    inst(cached('forest-birch-soft', () => merged(blob(0.3, 0, 1.18, 0, 1.0, 1.45), blob(0.22, 0.13, 0.88, 0.05, 1.0, 1.35))), R.crownMat, birches, birchCol);
  }
  inst(far ? cached('forest-pine-far', () => merged(new THREE.ConeGeometry(0.42, 0.75, 6).translate(0, 0.62, 0), new THREE.ConeGeometry(0.26, 0.55, 6).translate(0, 1.05, 0))) : cached('forest-pine-soft', () => merged(new THREE.ConeGeometry(0.42, 0.55, 10).translate(0, 0.55, 0), new THREE.ConeGeometry(0.33, 0.48, 10).translate(0, 0.85, 0), new THREE.ConeGeometry(0.22, 0.4, 10).translate(0, 1.12, 0))), SOFT_PINE, pines, pineCol.map((c) => c.clone().multiply(new THREE.Color(0x3f6b45))));
  inst(cached('bound-rail-1', () => new THREE.BoxGeometry(1, 0.04, 0.04)), mat(0xc9a46a), rails);
  inst(cached('bound-post', () => new THREE.BoxGeometry(0.07, 0.36, 0.07).translate(0, 0.18, 0)), mat(PAL.wood), posts);
  inst(cached('ribbon', () => merged(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 5).translate(0, 0.45, 0), new THREE.BoxGeometry(0.28, 0.14, 0.02).translate(0.15, 0.8, 0))), mat(0xd23c2c), ribbons);
  void L;
}

/** The patch the crew is clearing: a woodcutter fells its trees one by one, leaving stumps and a log pile. */
function animateFelling(R: Rig, s: GameState, t: number) {
  const job = worldOf(s, R.region).queue[0];
  if (!job) { if (R.felling) { R.units.remove(R.felling.extras); R.felling.trees.forEach((o) => R.units.remove(o)); R.felling = undefined; } return; }
  if (R.felling?.chunk !== job.chunk) {
    if (R.felling) { R.units.remove(R.felling.extras); R.felling.trees.forEach((o) => R.units.remove(o)); }
    const [ox, oy] = chunkOrigin(job.chunk), dense = hash(job.chunk * 0.37 + 5);
    const trees = patchTrees(job.chunk, ox, oy, Math.round(6 + dense * 6)).map((p) => {
      const g = new THREE.Group(), pivot = new THREE.Group(), tr = tree(1, R.crownMat, p.kind === 1 ? 1 : 0);
      pivot.add(tr); g.add(pivot);
      if (seasonOf(s) === 'Winter') tr.traverse((o) => { if (o.userData.crown) o.visible = false; });
      g.position.set(p.x, 0, p.z); g.rotation.y = p.rot; tr.scale.set(p.k, p.ky, p.k);
      g.userData.stump = cyl(0.08 * p.k, 0.1, PAL.wood, 0, 0, 0, 7); g.userData.stump.visible = false; g.add(g.userData.stump);
      R.units.add(g); return g;
    });
    const extras = new THREE.Group(), cutter = person(0x8a3b2b, false), axe = new THREE.Group();
    axe.add(box(0.03, 0.34, 0.03, PAL.wood, 0, 0, 0), box(0.1, 0.07, 0.03, PAL.metal, 0.04, 0.3, 0));
    axe.position.set(0.1, 0.3, 0); cutter.add(axe); cutter.userData.axe = axe;
    const pile = new THREE.Group(); pile.position.set(ox + 0.4, 0, oy + CHUNK - 0.4);
    extras.add(cutter, pile); extras.userData = { cutter, pile };
    R.units.add(extras);
    R.felling = { chunk: job.chunk, trees, fallAt: trees.map(() => -1), extras };
  }
  const F = R.felling!, n = F.trees.length;
  // trees down so far: the crew works through the patch over CLEAR_HOURS game hours
  const due = Math.min(n, Math.ceil(((CLEAR_HOURS - job.hours + 1) / CLEAR_HOURS) * n));
  const started = F.fallAt.filter((x) => x >= 0).length;
  for (let i = started; i < due; i++) F.fallAt[i] = t + (i - started) * 0.35; // staggered, one after another
  let logs = 0;
  F.trees.forEach((g, i) => {
    const at = F.fallAt[i], pivot = g.children[0];
    if (at < 0 || t < at) { pivot.rotation.x = 0; return; }
    const k = Math.min(1, (t - at) / 0.8);
    pivot.rotation.x = k * k * (Math.PI / 2 - 0.08); // topples, speeding up as it falls
    if (t - at > 2.2) { pivot.visible = false; g.userData.stump.visible = true; logs++; } // hauled off, a stump left behind
  });
  // the woodcutter stands at the next tree and swings
  const next = F.trees.find((_, i) => F.fallAt[i] < 0 || t < F.fallAt[i]) ?? F.trees[n - 1];
  const { cutter, pile } = F.extras.userData as { cutter: THREE.Group; pile: THREE.Group };
  if (next) { cutter.position.set(next.position.x - 0.35, 0, next.position.z + 0.1); cutter.rotation.y = 0; }
  playClip(cutter, 'Idle'); (cutter.userData.mixer as THREE.AnimationMixer | undefined)?.update(R.dt);
  (cutter.userData.axe as THREE.Group).rotation.z = -0.4 - Math.max(0, Math.sin(t * 6)) * 1.4;
  while (pile.children.length < Math.min(9, logs)) {
    const i = pile.children.length, log = cyl(0.07, 0.55, PAL.wood, 0, 0, 0, 7);
    log.rotation.z = Math.PI / 2; log.position.set(0, 0.07 + Math.floor(i / 3) * 0.12, (i % 3) * 0.15 - (Math.floor(i / 3) % 2) * 0.07);
    pile.add(log);
  }
}

const ROAD_COL = [0, 0xc19a64, 0xb9b3a6, 0x5f6266], RUT_COL = [0, 0x8a6840, 0x8c877d, 0], VERGE_COL = [0, 0x8a8a4c, 0x868a66, 0x80866a], SHOULDER_COL = [0, 0xb08c5a, 0xa8a295, 0x55575b];
type Band = [number, THREE.Color, number]; // offset (or radius), colour, opacity
/** Flat ground decals (no sides, so nothing reads as cut card): ribbons along segments and round joints, with soft, fading edges. */
/** Smooth noise in about −1…1 over the ground, so neighbouring pieces of road agree on where an edge wanders. */
const wn = (x: number, z: number) => Math.sin(x * 1.9 + z * 0.7) * 0.5 + Math.sin(x * 0.63 - z * 1.3 + 1.7) * 0.35 + Math.sin(x * 3.7 + z * 2.9) * 0.15;
/** step: cut the ribbon every so far; edge: how far the outer edges wander; meander: the whole ribbon wanders sideways; fade: how patchy its opacity is along the way. */
type Wobble = { step?: number; edge?: number; meander?: number; fade?: number; /** fade in over this far from the start, and out over this far before the end */ ends?: [number, number] };
class Decal {
  pos: number[] = []; col: number[] = []; uv: number[] = [];
  constructor(public y: number) {}
  private vx(x: number, z: number, c: THREE.Color, a: number) { this.pos.push(x, this.y, z); this.col.push(c.r, c.g, c.b, a); this.uv.push(x * 0.5, z * 0.5); } // the texture lies in world space, so joints and junctions match
  private v(x: number, z: number, [, c, a]: Band) { this.vx(x, z, c, a); }
  /** A ribbon from a to b; each band edge runs alongside the centre line, wandering as asked. */
  seg(ax: number, az: number, bx: number, bz: number, bands: Band[], o: Wobble = {}) {
    const l = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / l, nz = (bx - ax) / l, n = o.step ? Math.max(1, Math.ceil(l / o.step)) : 1;
    const outer = Math.max(...bands.map((b) => Math.abs(b[0]))) || 1;
    const at = (t: number, b: Band) => {
      const cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
      let off = b[0] + (o.meander ? o.meander * wn(cx * 0.8, cz * 0.8) : 0);
      if (o.edge) off += Math.sign(b[0]) * o.edge * (Math.abs(b[0]) / outer) ** 4 * wn(cx + nx * b[0] * 2, cz + nz * b[0] * 2);
      const ramp = (d: number, r: number) => (r > 0 ? Math.min(1, d / r) ** 2 * (3 - 2 * Math.min(1, d / r)) : 1);
      const a = b[2] * (o.fade ? 1 - o.fade * (0.5 + 0.5 * wn(cx * 1.3 + 5, cz * 1.3 - 2)) : 1) * (o.ends ? ramp(t * l, o.ends[0]) * ramp((1 - t) * l, o.ends[1]) : 1);
      this.vx(cx + nx * off, cz + nz * off, b[1], a);
    };
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      for (let i = 0; i < bands.length - 1; i++) {
        const p = bands[i], q = bands[i + 1];
        at(t0, p); at(t1, p); at(t1, q);
        at(t0, p); at(t1, q); at(t0, q);
      }
    }
  }
  /** A round patch: rings out from the centre (fills corners and junctions); the outer rings wander like a ribbon's edges. */
  disc(x: number, z: number, rings: Band[], edge = 0, sides = 20) {
    const outer = rings[rings.length - 1][0] || 1;
    const p = (r: Band, c: number, s: number) => { const px = x + c * r[0], pz = z + s * r[0], k = edge * (r[0] / outer) ** 4 * wn(px * 1, pz * 1); return [x + c * (r[0] + k), z + s * (r[0] + k)] as const; };
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * Math.PI * 2, a1 = ((k + 1) / sides) * Math.PI * 2, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const r0 = rings[0], A = p(r0, c0, s0), B = p(r0, c1, s1);
      this.v(x, z, r0); this.v(A[0], A[1], r0); this.v(B[0], B[1], r0);
      for (let i = 0; i < rings.length - 1; i++) {
        const P = rings[i], Q = rings[i + 1], p0 = p(P, c0, s0), q0 = p(Q, c0, s0), q1 = p(Q, c1, s1), p1 = p(P, c1, s1);
        this.v(p0[0], p0[1], P); this.v(q0[0], q0[1], Q); this.v(q1[0], q1[1], Q);
        this.v(p0[0], p0[1], P); this.v(q1[0], q1[1], Q); this.v(p1[0], p1[1], P);
      }
    }
  }
  mesh(transparent: boolean, map?: THREE.Texture) {
    const P = this.pos, Cc = this.col, n = P.length / 3;
    for (let i = 0; i < n; i += 3) { // every face up, so the sun lights it from above
      const ux = P[i * 3 + 3] - P[i * 3], uz = P[i * 3 + 5] - P[i * 3 + 2], vx = P[i * 3 + 6] - P[i * 3], vz = P[i * 3 + 8] - P[i * 3 + 2];
      if (uz * vx - ux * vz >= 0) continue;
      for (let k = 0; k < 3; k++) [P[i * 3 + 3 + k], P[i * 3 + 6 + k]] = [P[i * 3 + 6 + k], P[i * 3 + 3 + k]];
      for (let k = 0; k < 4; k++) [Cc[i * 4 + 4 + k], Cc[i * 4 + 8 + k]] = [Cc[i * 4 + 8 + k], Cc[i * 4 + 4 + k]];
      for (let k = 0; k < 2; k++) [this.uv[i * 2 + 2 + k], this.uv[i * 2 + 4 + k]] = [this.uv[i * 2 + 4 + k], this.uv[i * 2 + 2 + k]];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(n).fill([0, 1, 0]).flat(), 3));
    // pulled toward the camera in the depth test, so the ground never flickers through at the edges (layers stack by height)
    const lift = -1 - Math.round(this.y * 400);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, transparent, depthWrite: !transparent, polygonOffset: true, polygonOffsetFactor: lift, polygonOffsetUnits: lift, map: map ?? null }));
    m.receiveShadow = true; m.frustumCulled = false;
    return m;
  }
}
/** Roads: the main road and every track, by grade (dirt, gravel, paved), as one soft-edged surface. */
function syncRoads(R: Rig, s: GameState) {
  const w = worldOf(s, R.region), ids = Object.keys(w.roads);
  const cids = Object.keys(w.canals), nsig = UTILITY_NETS.map((k) => { const o = w.nets?.[k] ?? {}; return Object.keys(o).reduce((a, id) => a + ((Number(id) * 13) % 100019) * o[Number(id)], 0); }).join(',');
  const sig = `${R.region}:${w.main}:${ids.length}:${ids.reduce((a, k) => a + ((Number(k) * 31) % 1000003) * w.roads[Number(k)], 0)}:${cids.length}:${cids.reduce((a, k) => a + ((Number(k) * 17) % 100003) * w.canals[Number(k)], 0)}:${s.fields.length}:${nsig}:${townOf(s).services.length}:${communityOf(s).homes.length}`;
  if (sig === R.roadSig) return;
  R.roadSig = sig;
  clear(R.roadsG);
  const C = (h: number) => new THREE.Color(h), GRASS = C(0x8d9a4c);
  const verge = new Decal(0.004), surface = new Decal(0.009), grass = new Decal(0.011), marks = new Decal(0.014), mouths: [number, number, number][] = [];
  // a cross-section: a verge of worn grass, the surface fading in over a darker shoulder (no hard edge), and on farm tracks grass down the middle
  const road = (g: number, half: number): { v: Band[]; s: Band[] } => {
    const sh = C(SHOULDER_COL[g]), rd = C(ROAD_COL[g]), soft = g === 3 ? 0.03 : 0.07;
    return {
      v: [[-half - 0.2, C(VERGE_COL[g]), 0], [-half, C(VERGE_COL[g]), 0.3], [half, C(VERGE_COL[g]), 0.3], [half + 0.2, C(VERGE_COL[g]), 0]],
      s: [[-half - soft, sh, 0], [-half + soft, sh, 1], [-half + 0.2, rd, 1], [half - 0.2, rd, 1], [half - soft, sh, 1], [half + soft, sh, 0]],
    };
  };
  const ROADSIDE: Wobble = { step: 0.35, edge: 0.06 }, PAVED: Wobble = { step: 0.5 };
  // wheel ruts: soft, darker, compacted paths that wander a little and come and go, not painted lines
  const rut = (g: number, o: number, wd: number): Band[] => { const c = C(RUT_COL[g]); return [[o - wd, c, 0], [o - wd * 0.3, c, 0.6], [o + wd * 0.3, c, 0.6], [o + wd, c, 0]]; };
  const RUTS: Wobble = { step: 0.3, meander: 0.03, fade: 0.55 };
  // the main road
  const g = w.main, cz = ROAD_Y + ROAD_H / 2, x0 = MAP.x0 - 300, x1 = MAP.x0 + MAP.w + 300, M = road(g, ROAD_H / 2 - 0.1);
  verge.seg(x0, cz, x1, cz, M.v, g === 3 ? PAVED : ROADSIDE); surface.seg(x0, cz, x1, cz, M.s, g === 3 ? PAVED : ROADSIDE);
  if (g < 3) for (const o of [-0.42, 0.42]) marks.seg(x0, cz, x1, cz, rut(g, o, 0.2), RUTS);
  else {
    for (const o of [-(ROAD_H / 2 - 0.3), ROAD_H / 2 - 0.3]) marks.seg(x0, cz, x1, cz, [[o - 0.03, C(0xe9e4d6), 1], [o + 0.03, C(0xe9e4d6), 1]]);
    for (let x = x0; x < x1; x += 2) marks.seg(x, cz, x + 0.9, cz, [[-0.04, C(0xf2d77a), 1], [0.04, C(0xf2d77a), 1]]);
  }
  // tracks: a ribbon between each pair of neighbouring tiles (and onto the main road); a round patch only where they turn, meet or end
  const at = (x: number, y: number) => (isRoad(y) ? -1 : w.roads[tileId(x, y)] ?? 0);
  const HALF = 0.36, STEPS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  const linksAt = (x: number, y: number) => STEPS4.filter(([dx, dy]) => at(x + dx, y + dy) !== 0);
  const straight = (x: number, y: number) => { const d = linksAt(x, y); return d.length === 2 && d[0][0] === -d[1][0] && d[0][1] === -d[1][1]; };
  const through = (x: number, y: number) => linksAt(x, y).length === 1 || straight(x, y); // ruts run on through it
  for (const k of ids) {
    const id = Number(k), [x, y] = tileAt(id), gr = w.roads[id], ax = x + 0.5, az = y + 0.5;
    const dirs = linksAt(x, y);
    if (!straight(x, y)) {
      verge.disc(ax, az, [[HALF, C(VERGE_COL[gr]), 0.3], [HALF + 0.2, C(VERGE_COL[gr]), 0]], 0.06);
      surface.disc(ax, az, [[HALF - 0.2, C(ROAD_COL[gr]), 1], [HALF - 0.07, C(SHOULDER_COL[gr]), 1], [HALF + 0.07, C(SHOULDER_COL[gr]), 0]], gr === 3 ? 0 : 0.06);
    }
    for (const [dx, dy] of dirs) {
      const n = at(x + dx, y + dy);
      if (n > 0 && (dx < 0 || dy < 0)) continue; // each pair once, from its west or north tile
      const main = n === -1, sg = n > 0 ? Math.min(gr, n) : gr, len = main ? 0.5 + 0.35 : 1; // onto the main road, up to its ruts
      const S = road(sg, HALF), wob = sg === 3 ? PAVED : ROADSIDE;
      const bx = ax + dx * len, bz = az + dy * len;
      verge.seg(ax, az, bx, bz, S.v, wob); surface.seg(ax, az, bx, bz, S.s, wob);
      if (main) mouths.push([ax + dx * 0.5, az + dy * 0.5, sg]);
      if (sg < 3) { // ruts and the grass between them run on through straight tiles and fade out at bends, junctions and ends
        const in0 = through(x, y), in1 = !main && through(x + dx, y + dy), s0 = in0 ? 0 : 0.15, s1 = main ? 0.55 : in1 ? len : len - 0.15;
        const ends: [number, number] = [in0 ? 0 : 0.3, in1 ? 0 : 0.3], p0x = ax + dx * s0, p0z = az + dy * s0, p1x = ax + dx * s1, p1z = az + dy * s1;
        for (const o of [-0.15, 0.15]) marks.seg(p0x, p0z, p1x, p1z, rut(sg, o, 0.1), { ...RUTS, ends });
        if (sg === 1 && !main) grass.seg(p0x, p0z, p1x, p1z, [[-0.08, GRASS, 0], [-0.03, GRASS, 0.85], [0.03, GRASS, 0.85], [0.08, GRASS, 0]], { step: 0.3, fade: 0.35, ends });
      }
    }
  }
  // where a track meets the main road its mouth widens into a soft rounded fan, so the corners are not cut square
  for (const [mx, mz, mg] of mouths) surface.disc(mx, mz, [[0.5, C(ROAD_COL[Math.min(mg, g)]), 1], [0.82, C(ROAD_COL[Math.min(mg, g)]), 0]], 0.05, 24);
  const layers = [verge.mesh(true), surface.mesh(true, roadGrain()), grass.mesh(true, roadGrain()), marks.mesh(true, roadGrain())];
  layers.forEach((m, i) => { m.renderOrder = i; }); // drawn in order, each blending over the one below
  R.roadsG.add(...layers, roadsideTufts(w, riverTiles(R.region)));
  R.roadsG.add(pipeworks(s, R.region), utilityworks(s, R.region));
}
/** Water lines: a ditch is a thin wet cut in the soil; a pipe is one thin pipe on low posts; both run from the river bank to each field's edge. Buried pipe (and any line under a road) is not drawn. */
function pipeworks(s: GameState, r: RegionId) {
  const w = worldOf(s, r), river = riverTiles(r), g = new THREE.Group();
  const fieldTiles = new Set<number>();
  for (const f of s.fields) { const p = w.pos[`field:${f.id}`]; if (f.region !== r || !p) continue; const n = plotSide(f.ha); for (let y = p[1]; y < p[1] + n; y++) for (let x = p[0]; x < p[0] + n; x++) fieldTiles.add(tileId(x, y)); }
  const shown = (x: number, y: number) => !isRoad(y) && !w.roads[tileId(x, y)];
  const kind = (x: number, y: number) => (shown(x, y) ? w.canals[tileId(x, y)] ?? 0 : 0); // 1 ditch, 2 pipe, else not drawn here
  /** A line running along the river or a field joins it once, at the first tile of the run, not at every tile it passes. */
  const firstAlong = (x: number, y: number, dx: number, dy: number, has: (id: number) => boolean) => { const px = x - (dy ? 1 : 0), py = y - (dx ? 1 : 0); return !(w.canals[tileId(px, py)] && has(tileId(px + dx, py + dy))); };
  const ditch = new Decal(0.012), bank = new THREE.Color(0x7a5a36), mud = new THREE.Color(0x4a3420), wet = new THREE.Color(0x5b93ad), cut: Band[] = [[-0.12, bank, 0], [-0.085, bank, 0.85], [-0.055, mud, 1], [-0.025, wet, 1], [0.025, wet, 1], [0.055, mud, 1], [0.085, bank, 0.85], [0.12, bank, 0]];
  const runs: THREE.Matrix4[] = [], posts: THREE.Matrix4[] = [], caps: THREE.Matrix4[] = [], q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), H = 0.13;
  const run = (ax: number, az: number, bx: number, bz: number) => { const len = Math.hypot(bx - ax, bz - az); q.setFromAxisAngle(Y, -Math.atan2(bz - az, bx - ax)); runs.push(new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, H, (az + bz) / 2), q, new THREE.Vector3(len, 1, 1))); };
  for (const k of Object.keys(w.canals)) {
    const id = Number(k), [x, y] = tileAt(id);
    const t = kind(x, y);
    if (t !== 1 && t !== 2) continue;
    const cx = x + 0.5, cz = y + 0.5, D = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
    const same = D.filter(([dx, dy]) => kind(x + dx, y + dy) === t).length;
    if (t === 2) posts.push(new THREE.Matrix4().makeTranslation(cx, 0, cz));
    else ditch.disc(cx, cz, [[0.025, wet, 1], [0.055, mud, 1], [0.085, bank, 0.85], [0.12, bank, 0]]);
    let joins = 0;
    for (const [dx, dy] of D) {
      const nid = tileId(x + dx, y + dy);
      // how far toward this neighbour the line reaches: its own kind meets in the middle; another kind of line only where one of them ends (no ladder between parallel lines); the river and fields once per run
      const reach = kind(x + dx, y + dy) === t ? 0.5 : w.canals[nid] ? (same < 2 ? 0.5 : 0) : river.has(nid) ? (firstAlong(x, y, dx, dy, (i) => river.has(i)) ? 0.75 : 0) : fieldTiles.has(nid) ? (firstAlong(x, y, dx, dy, (i) => fieldTiles.has(i)) ? 0.55 : 0) : 0;
      if (!reach) continue;
      joins++;
      if (t === 1) { ditch.seg(cx, cz, cx + dx * reach, cz + dy * reach, cut, { step: 0.25, edge: 0.02 }); continue; }
      if (kind(x + dx, y + dy) === 2) { if (dx > 0 || dy > 0) run(cx, cz, cx + dx, cz + dy); continue; } // each pair once
      run(cx, cz, cx + dx * reach, cz + dy * reach); caps.push(new THREE.Matrix4().makeTranslation(cx + dx * reach, H, cz + dy * reach)); // into the ground, the bank or the field
    }
    if (t === 2 && joins !== 2) caps.push(new THREE.Matrix4().makeTranslation(cx, H, cz)); // a joint at bends, tees and ends
  }
  const inst = (geo: THREE.BufferGeometry, m: THREE.Material, list: THREE.Matrix4[]) => { if (!list.length) return; const im = new THREE.InstancedMesh(geo, m, list.length); list.forEach((x, i) => im.setMatrixAt(i, x)); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; g.add(im); };
  const PIPE = mat(0x7d98a6, { rough: 0.55, metal: 0.2 });
  inst(cached('pipe-run', () => new THREE.CylinderGeometry(0.045, 0.045, 1, 8).rotateZ(Math.PI / 2)), PIPE, runs);
  inst(cached('pipe-joint', () => new THREE.CylinderGeometry(0.065, 0.065, 0.12, 10)), mat(0x5f7a88, { rough: 0.5, metal: 0.25 }), caps);
  if (ditch.pos.length) { const m = ditch.mesh(true); m.renderOrder = 1; g.add(m); }
  inst(cached('pipe-post', () => merged(new THREE.BoxGeometry(0.05, H, 0.05).translate(0, H / 2, 0), new THREE.BoxGeometry(0.14, 0.03, 0.05).translate(0, H - 0.05, 0))), mat(PAL.woodDark), posts);
  return g;
}
/** A soft disc for a service's reach: solid out to its full reach, then fading to nothing. */
let heatTex: THREE.Texture | null = null;
function heatTexture() {
  if (heatTex) return heatTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!, g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  const full = 1 / (1 + HEAT_FADE); // solid to the full reach, then fading out
  g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(full, 'rgba(255,255,255,0.8)'); g.addColorStop(full + (1 - full) * 0.5, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return (heatTex = new THREE.CanvasTexture(c));
}
const NET_COLOUR: Record<NetKind, number> = { irrigation: 0x3f8fc8, power: 0xf2b82c, water: 0x5ab4e0, sewer: 0x8a7a4a };
/** Where a utility network starts: the doorstep of each of its working buildings. */
function netSources(s: GameState, kind: UtilityNet) {
  const w = worldOf(s, 'heartland'), out: [number, number][] = [];
  for (const b of townOf(s).services) { if (UTILITY_OF[b.type] !== kind) continue; const p = w.pos[`svc:${b.id}`], fp = footprintOf(s, `svc:${b.id}`); if (p && fp) out.push(...doorstep(p[0], p[1], fp)); }
  return out;
}
/** Line tiles joined to one of the network's buildings. */
const liveLines = (s: GameState, kind: UtilityNet) => netReach(worldOf(s, 'heartland'), kind, netSources(s, kind)).tier;
/** The town's utility lines. Power: wires on lattice pylons. Water: a pipe along the ground. Sewage: a murky ditch, then a concrete drain. Their top tier is underground and not drawn. */
function utilityworks(s: GameState, r: RegionId) {
  const g = new THREE.Group();
  if (r !== 'heartland' || !townOf(s).active) return g;
  const w = worldOf(s, r), homeTiles = new Set<number>();
  for (const h of communityOf(s).homes) { const p = w.pos[`home:${h.id}`], fp = footprintOf(s, `home:${h.id}`); if (p && fp) for (let y = p[1]; y < p[1] + fp.d; y++) for (let x = p[0]; x < p[0] + fp.w; x++) homeTiles.add(tileId(x, y)); }
  const D = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const, q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  const inst = (geo: THREE.BufferGeometry, m: THREE.Material, list: THREE.Matrix4[], shadow = true) => { if (!list.length) return; const im = new THREE.InstancedMesh(geo, m, list.length); list.forEach((x, i) => im.setMatrixAt(i, x)); im.castShadow = shadow; im.receiveShadow = true; im.frustumCulled = false; g.add(im); };
  const rod = (list: THREE.Matrix4[], h: number) => (ax: number, az: number, bx: number, bz: number) => { q.setFromAxisAngle(Y, -Math.atan2(bz - az, bx - ax)); list.push(new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, h, (az + bz) / 2), q, new THREE.Vector3(Math.hypot(bx - ax, bz - az), 1, 1))); };
  const ditch = new Decal(0.013);
  for (const kind of UTILITY_NETS) {
    const own = w.nets?.[kind]; if (!own) continue;
    const top = NET_TOP[kind], facTiles = new Set<number>();
    for (const b of townOf(s).services) { if (UTILITY_OF[b.type] !== kind) continue; const p = w.pos[`svc:${b.id}`], fp = footprintOf(s, `svc:${b.id}`); if (p && fp) for (let y = p[1]; y < p[1] + fp.d; y++) for (let x = p[0]; x < p[0] + fp.w; x++) facTiles.add(tileId(x, y)); }
    const onRoad = (x: number, y: number) => isRoad(y) || !!w.roads[tileId(x, y)];
    const shown = (x: number, y: number) => { const t = own[tileId(x, y)]; return t && t < top && (kind === 'power' || !onRoad(x, y)) ? t : 0; }; // overhead wires cross roads; pipes and ditches go under them
    const runs: THREE.Matrix4[] = [], joints: THREE.Matrix4[] = [], posts: THREE.Matrix4[] = [];
    const H = kind === 'power' ? 1.55 : kind === 'water' ? 0.07 : 0.08, line = rod(runs, H);
    for (const k of Object.keys(own)) {
      const id = Number(k), [x, y] = tileAt(id), t = shown(x, y);
      if (!t) continue;
      const cx = x + 0.5, cz = y + 0.5, same = D.filter(([dx, dy]) => shown(x + dx, y + dy) === t).length;
      const ditchy = kind === 'sewer' && t === 1;
      if (ditchy) { const bank = new THREE.Color(0x6e5a3a), mud = new THREE.Color(0x3e3a26), slop = new THREE.Color(0x5d6440); ditch.disc(cx, cz, [[0.03, slop, 1], [0.06, mud, 1], [0.1, bank, 0.85], [0.14, bank, 0]]); }
      let joins = 0;
      for (const [dx, dy] of D) {
        const nid = tileId(x + dx, y + dy), nt = shown(x + dx, y + dy);
        const reach = nt === t ? 0.5 : own[nid] ? (same < 2 ? 0.5 : 0) : (homeTiles.has(nid) || facTiles.has(nid)) && same < 2 ? 0.5 : 0;
        if (!reach) continue;
        joins++;
        if (ditchy) { const bank = new THREE.Color(0x6e5a3a), mud = new THREE.Color(0x3e3a26), slop = new THREE.Color(0x5d6440); ditch.seg(cx, cz, cx + dx * reach, cz + dy * reach, [[-0.14, bank, 0], [-0.1, bank, 0.85], [-0.06, mud, 1], [-0.03, slop, 1], [0.03, slop, 1], [0.06, mud, 1], [0.1, bank, 0.85], [0.14, bank, 0]], { step: 0.25, edge: 0.02 }); continue; }
        if (nt === t) { if (dx > 0 || dy > 0) line(cx, cz, cx + dx, cz + dy); continue; }
        line(cx, cz, cx + dx * reach, cz + dy * reach); joints.push(new THREE.Matrix4().makeTranslation(cx + dx * reach, H, cz + dy * reach));
      }
      if (ditchy) continue;
      if (kind === 'power') { if (!onRoad(x, y) && (joins !== 2 || same < 2 || (x + y) % 3 === 0)) posts.push(new THREE.Matrix4().makeTranslation(cx, 0, cz)); else if (onRoad(x, y) && (x + y) % 3 === 0) posts.push(new THREE.Matrix4().makeTranslation(x + 0.06, 0, y + 0.06)); } // over a road the pylon stands at the roadside // a pylon at bends, ends and every third tile
      else if (joins !== 2) joints.push(new THREE.Matrix4().makeTranslation(cx, H, cz));
    }
    if (kind === 'power') {
      inst(cached('wire', () => new THREE.CylinderGeometry(0.012, 0.012, 1, 4).rotateZ(Math.PI / 2)), mat(0x2a2a2a), runs, false);
      inst(cached('pylon', () => merged(new THREE.CylinderGeometry(0.03, 0.09, 1.6, 4).translate(0, 0.8, 0), new THREE.BoxGeometry(0.5, 0.04, 0.04).translate(0, 1.5, 0), new THREE.BoxGeometry(0.36, 0.03, 0.03).translate(0, 1.3, 0))), mat(0x8c9196, { metal: 0.3, rough: 0.6 }), posts);
    } else {
      const r0 = kind === 'water' ? 0.05 : 0.07, col = kind === 'water' ? 0x9fb8c8 : 0xa09f98;
      inst(cached(`upipe${r0}`, () => new THREE.CylinderGeometry(r0, r0, 1, 8).rotateZ(Math.PI / 2)), mat(col, { rough: 0.6 }), runs);
      inst(cached(`ujoint${r0}`, () => new THREE.CylinderGeometry(r0 * 1.4, r0 * 1.4, r0 * 2, 10)), mat(col - 0x101010, { rough: 0.6 }), joints);
    }
  }
  if (ditch.pos.length) { const m = ditch.mesh(true); m.renderOrder = 1; g.add(m); }
  return g;
}
/** Road mode: the route a new road would take, or the stretch that would be upgraded or removed. */
function syncRoadPreview(R: Rig, s: GameState, Rd: Roading | null) {
  const sig = Rd ? `${Rd.tool}:${Rd.from}:${Rd.hover}:${R.roadSig}` : '';
  if (sig === R.roadPrevSig) return;
  R.roadPrevSig = sig;
  clear(R.roadPrev);
  if (!Rd) return;
  const w = worldOf(s, R.region);
  const kind = Rd.pipe, own = kind ? linesOf(w, kind) : null;
  if (kind && own) { // every line of this network shows while the tool is open, underground ones too, as a dashed line
    const d = new Decal(0.03), col = new THREE.Color(NET_COLOUR[kind]);
    for (const k of Object.keys(own)) { const [x, y] = tileAt(Number(k)); if (own[Number(k)] < NET_TOP[kind] && !isRoad(y) && !w.roads[Number(k)]) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) if (own[tileId(x + dx, y + dy)]) for (let t = 0; t < 1; t += 0.34) d.seg(x + 0.5 + dx * t, y + 0.5 + dy * t, x + 0.5 + dx * (t + 0.2), y + 0.5 + dy * (t + 0.2), [[-0.05, col, 0.9], [0.05, col, 0.9]]);
      d.disc(x + 0.5, y + 0.5, [[0.07, col, 0.9]]); }
    const live = kind === 'irrigation' ? wetTiers(s, R.region) : liveLines(s, kind), dry = new THREE.Color(0xe0533d);
    for (const k of Object.keys(own)) if (!live.has(Number(k))) { const [x, y] = tileAt(Number(k)); d.disc(x + 0.5, y + 0.5, [[0.16, dry, 0.75], [0.24, dry, 0]]); } // a dead line: not joined to its source
    if (d.pos.length) { const m = d.mesh(true); m.renderOrder = 2; R.roadPrev.add(m); }
  }
  let tiles: [number, number][] = [], ok = true;
  if (Rd.tool === 'draw') {
    if (Rd.from && Rd.hover) { const r = kind ? pipeRoute(s, R.region, Rd.from, Rd.hover, kind) : roadRoute(s, R.region, Rd.from, Rd.hover); ok = !!r; tiles = r ?? [Rd.hover]; }
    else if (Rd.hover) tiles = [Rd.hover];
    if (Rd.from) { const m = mesh(cached('road-start', () => new THREE.CylinderGeometry(0.3, 0.3, 0.6, 12)), mat(0xffc94d, { emissive: 0x403000 }), Rd.from[0] + 0.5, 0.3, Rd.from[1] + 0.5, false); R.roadPrev.add(m); }
  } else if (Rd.hover) { // on the main road: the whole road, since that is what an upgrade covers
    tiles = kind ? pipeStretch(w, Rd.hover[0], Rd.hover[1], kind).map(tileAt) : isRoad(Rd.hover[1]) ? (Rd.tool === 'remove' ? [] : Array.from({ length: MAP.w * 2 }, (_, i) => [MAP.x0 + (i >> 1), ROAD_Y + (i & 1)] as [number, number])) : roadStretch(w, Rd.hover[0], Rd.hover[1]).map(tileAt);
    ok = tiles.length > 0;
  }
  // the planned road as one soft ribbon, the same shape the road will take: gold to build, blue to upgrade, red to remove or blocked
  const col = new THREE.Color(!ok || Rd.tool === 'remove' ? 0xe0533d : Rd.tool === 'upgrade' ? (kind ? 0x7d98a6 : 0x4aa0d0) : kind ? NET_COLOUR[kind] : 0xffc94d);
  const half = Rd.pipe ? 0.14 : 0.3; // a pipe plans as a narrow line, a road as its full width
  const plan = new Set(tiles.map(([x, y]) => tileId(x, y))), d = new Decal(0.03), band: Band[] = [[-half - 0.1, col, 0], [-half, col, 1], [half, col, 1], [half + 0.1, col, 0]]; // solid core, so overlaps don't show
  const linked = (x: number, y: number) => plan.has(tileId(x, y)) || (Rd.tool === 'draw' && (kind && own ? !!own[tileId(x, y)] || (kind === 'irrigation' && riverTiles(R.region).has(tileId(x, y))) : isRoad(y) || !!w.roads[tileId(x, y)]));
  for (const [x, y] of tiles) {
    d.disc(x + 0.5, y + 0.5, [[half, col, 1], [half + 0.1, col, 0]]);
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) if (linked(x + dx, y + dy) && !(plan.has(tileId(x + dx, y + dy)) && (dx < 0 || dy < 0))) d.seg(x + 0.5, y + 0.5, x + 0.5 + dx, y + 0.5 + dy, band);
  }
  if (tiles.length) { const m = d.mesh(true); (m.material as THREE.MeshStandardMaterial).emissive.copy(col).multiplyScalar(0.5); m.renderOrder = 2; R.roadPrev.add(m); }
}

/** Carts and trucks on their way to the village market and back, and the market itself. */
function animateHaul(R: Rig, s: GameState, t: number) {
  if (R.region !== 'heartland') return;
  if (s.tick !== R.tickSeen) { R.tickSeen = s.tick; R.tickAt = t; }
  const part = Math.min(0.999, (t - R.tickAt) * Math.max(0, getSpeed())); // smooth motion between game hours
  const H = haulOf(s), route = H.trips.length ? marketRoute(s) : [], seen = new Set<string>();
  for (const trip of H.trips) {
    const key = `${trip.vehicle}@${trip.depart}`;
    seen.add(key);
    let o = R.haulers.get(key);
    if (!o) { o = hauler(trip.kind); playClip(o, 'Walk'); R.units.add(o); R.haulers.set(key, o); }
    (o.userData.mixer as THREE.AnimationMixer | undefined)?.update(R.dt);
    const now = s.tick + part, out = now < trip.arrive;
    const f = out ? (now - trip.depart) / Math.max(1, trip.arrive - trip.depart) : 1 - (now - trip.arrive) / Math.max(1, trip.back - trip.arrive);
    const k = Math.max(0, Math.min(route.length - 1, f * (route.length - 1))), i = Math.floor(k), j = Math.min(route.length - 1, i + 1), u = k - i;
    if (!route.length) continue;
    const [x0, z0] = route[i], [x1, z1] = route[j];
    o.position.set(x0 + 0.5 + (x1 - x0) * u, 0.02, z0 + 0.5 + (z1 - z0) * u + (out ? -0.25 : 0.25)); // keep to their side of the road
    const dx = (x1 - x0) * (out ? 1 : -1), dz = (z1 - z0) * (out ? 1 : -1);
    if (dx || dz) o.rotation.y = Math.atan2(-dz, dx);
    if (!o.userData.mixer) o.position.y = 0.02 + Math.abs(Math.sin(t * 9)) * 0.01;
  }
  for (const [k, o] of R.haulers) if (!seen.has(k)) { R.units.remove(o); R.haulers.delete(k); }
  if (!R.units.getObjectByName('village-market')) { // the market: a few stalls and a sign by the road
    const m = new THREE.Group(); m.name = 'village-market';
    for (const [dx, i] of [[-3, 0], [0, 1], [3, 2]] as const) { const st = buildLot('shed', 2, 2, 'market').group; st.position.set(MARKET_X + dx - 1, 0, ROAD_Y - 3.2 - (i % 2) * 0.4); m.add(st); }
    // between the stalls: a vendor's cart, a second stand, lamps and stacked goods
    const put = (id: Parameters<typeof artModel>[0], w: number, x: number, z: number, rot = 0) => { const a = artModel(id, w, w, true); if (a) { a.position.set(x, 0, z); a.rotation.y = rot; m.add(a); } };
    put('stall2', 1.3, MARKET_X - 1.5, ROAD_Y - 2.4, 0.2); put('cart', 1.1, MARKET_X + 1.6, ROAD_Y - 1.9, -0.5);
    for (const x of [MARKET_X - 4.2, MARKET_X + 4.6]) put('lamp', 1.6, x, ROAD_Y - 1.3);
    put('barrel', 0.3, MARKET_X - 0.3, ROAD_Y - 1.7); put('crate', 0.3, MARKET_X + 0.2, ROAD_Y - 1.75, 0.4); put('sacks', 0.45, MARKET_X + 3.3, ROAD_Y - 1.8); put('haybale', 0.35, MARKET_X - 3.4, ROAD_Y - 1.8);
    m.add(box(0.1, 1.4, 0.1, PAL.woodDark, MARKET_X - 5, 0, ROAD_Y - 0.6), box(1.2, 0.4, 0.06, PAL.roofGreen, MARKET_X - 5, 1.1, ROAD_Y - 0.6));
    R.units.add(m);
  }
}

/** Oil: dry holes always show; in oil mode, the survey's heat map and the spot under the cursor with its odds. */
function syncOil(R: Rig, s: GameState, P: { region: RegionId; hover?: [number, number]; survey?: boolean } | null) {
  const O = oilOf(s), dry = O.dry[R.region] ?? [], areas = O.surveys[R.region] ?? [], known = areas.length > 0;
  const sig = `${R.region}:${dry.length}:${!!P}:${areas.length}:${P?.hover}:${P?.survey}:${s.buildings.length}`;
  if (sig === R.oilSig) return;
  R.oilSig = sig;
  clear(R.oilG);
  for (const [x, y] of dry) { const m = mesh(cached('dryhole', () => new THREE.CylinderGeometry(0.12, 0.2, 0.25, 8)), mat(0x6b6b6b), x + 1, 0.12, y + 1); R.oilG.add(m); }
  if (!P) return;
  for (const [cx, cy] of areas) R.oilG.add(mesh(cached('surveyring', () => new THREE.RingGeometry(SURVEY_R - 0.25, SURVEY_R, 96).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: 0x8a6a3a, transparent: true, opacity: 0.5, depthWrite: false }), cx, 0.05, cy, false)); // where each survey reads
  if (known) { // heat map of the survey readings: warmer patches are likelier, but the readings are rough
    const list: THREE.Matrix4[] = [], cols: THREE.Color[] = [];
    for (let y = MAP.y0; y < MAP.y0 + MAP.h; y += CHUNK) for (let x = MAP.x0; x < MAP.x0 + MAP.w; x += CHUNK) {
      if (!surveyedAt(s, R.region, x + 2, y + 2)) continue;
      const c = oilReading(R.region, x + 2, y + 2);
      if (c < 0.15) continue;
      list.push(new THREE.Matrix4().makeTranslation(x + 2, 0.06, y + 2)); cols.push(new THREE.Color().setHSL(0.08 - c * 0.08, 0.7, 0.55 - c * 0.35));
    }
    const im = new THREE.InstancedMesh(cached('oilheat', () => new THREE.BoxGeometry(CHUNK * 0.96, 0.02, CHUNK * 0.96)), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }), Math.max(1, list.length));
    list.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, cols[i]); }); im.count = list.length; im.frustumCulled = false; R.oilG.add(im);
    // the surveyor's stakes: a tall marker on each promising patch, seen above the trees, taller and darker the better the odds
    for (let y = MAP.y0; y < MAP.y0 + MAP.h; y += CHUNK) for (let x = MAP.x0; x < MAP.x0 + MAP.w; x += CHUNK) {
      if (!surveyedAt(s, R.region, x + 2, y + 2)) continue;
      const c = oilReading(R.region, x + 2, y + 2);
      if (c < 0.5) continue;
      const h = 1.4 + c * 2.6, col = new THREE.Color().setHSL(0.07 - c * 0.07, 0.8, 0.5 - c * 0.2);
      const pole = mesh(cached('oilpole', () => new THREE.CylinderGeometry(0.06, 0.06, 1, 6).translate(0, 0.5, 0)), mat(0x5a4632), x + 2, 0, y + 2, false); pole.scale.y = h; R.oilG.add(pole);
      R.oilG.add(mesh(cached('oilflag', () => new THREE.OctahedronGeometry(0.45, 0)), new THREE.MeshBasicMaterial({ color: col }), x + 2, h + 0.35, y + 2, false));
    }
  }
  if (P.hover && P.survey) R.oilG.add(mesh(cached('surveypick', () => new THREE.CircleGeometry(SURVEY_R, 96).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.18, depthWrite: false }), P.hover[0], 0.07, P.hover[1], false));
  else if (P.hover) {
    const [hx, hy] = P.hover, ok = !placeProblem(s, R.region, hx - 1, hy - 1, { w: 2, d: 2 });
    R.oilG.add(mesh(cached('oilspot', () => new THREE.BoxGeometry(2, 0.05, 2)), new THREE.MeshBasicMaterial({ color: ok ? 0xffc94d : 0xd04a3a, transparent: true, opacity: 0.6, depthWrite: false }), hx, 0.08, hy, false));
  }
}

const ZONE_COL = { res: 0xf2c94c, ind: 0x8f86c9 } as const;
/** Zoned land is tinted: residential gold, industrial violet; brighter in zone mode, with the patch under the cursor outlined. */
function syncZones(R: Rig, s: GameState, Z: Zoning | null) {
  const w = worldOf(s, R.region), keys = Object.keys(w.zones);
  const sig = `${R.region}:${keys.map((k) => k + w.zones[Number(k)]).join(',')}:${!!Z}:${Z?.zone}:${Z?.hover}`;
  if (sig === R.zoneSig) return;
  R.zoneSig = sig;
  clear(R.zoneG);
  for (const z of ['res', 'ind'] as const) {
    const list = keys.filter((k) => w.zones[Number(k)] === z).map((k) => { const [x, y] = chunkOrigin(Number(k)); return new THREE.Matrix4().makeTranslation(x + CHUNK / 2, 0.02, y + CHUNK / 2); });
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(Z ? cached('zonetile', () => new THREE.BoxGeometry(CHUNK - 0.1, 0.01, CHUNK - 0.1)) : cached('zonearea', () => new THREE.PlaneGeometry(CHUNK, CHUNK).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: ZONE_COL[z], transparent: true, opacity: Z ? 0.38 : 0.16, depthWrite: false }), list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m)); im.frustumCulled = false; R.zoneG.add(im);
  }
  if (Z?.hover) {
    const c = chunkAt(Z.hover[0], Z.hover[1]);
    if (c >= 0) { const [x, y] = chunkOrigin(c), mine = ownedSet(w).has(c); R.zoneG.add(mesh(cached('zonehover', () => new THREE.BoxGeometry(CHUNK, 0.03, CHUNK)), new THREE.MeshBasicMaterial({ color: !mine ? 0xd04a3a : Z.zone === 'farm' ? 0x7fb26a : ZONE_COL[Z.zone], transparent: true, opacity: 0.55, depthWrite: false }), x + CHUNK / 2, 0.03, y + CHUNK / 2, false)); }
  }
}

/** Where the river comes over the falls (x at the top of the map). */
const sources = new Map<RegionId, number>();
const riverSource = (r: RegionId) => { const hit = sources.get(r); if (hit !== undefined) return hit; let best = 0, by = Infinity; for (const id of riverTiles(r)) { const [x, y] = tileAt(id); if (y < by) { by = y; best = x; } } sources.set(r, best + 1); return best + 1; };
// ---- the mountains along the top edge of the map, and the gorge the river comes down through
const vh = (x: number, y: number) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), u0 = x - xi, v0 = y - yi, u = u0 * u0 * (3 - 2 * u0), v = v0 * v0 * (3 - 2 * v0);
  const a = vh(xi, yi), b = vh(xi + 1, yi), c = vh(xi, yi + 1), d = vh(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function ridged(x: number, y: number) { let s = 0, amp = 0.55, f = 1; for (let i = 0; i < 5; i++) { const n = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1); s += n * n * amp; amp *= 0.5; f *= 2.03; } return s; }
const smooth = (a: number, b: number, t: number) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
/** The gorge's centre line, d tiles beyond the top edge. */
const gorgeX = (sx: number, d: number) => sx + 1.8 * Math.sin(d * 0.22) * smooth(1, 4, d);
/** Height of the water in the gorge: a lip over the falls, then a gentle climb upstream. */
const gorgeFloor = (d: number) => (d < 1 ? 0 : 5.2 + Math.max(0, d - 1.3) * 0.22);
/** Terrain height past the top edge: foothills right at the edge, a ridged range behind, an escarpment around the falls and a gorge cut through it. */
function mountainH(x: number, z: number, sx: number) {
  const d = MAP.y0 - z;
  if (d <= 0) return 0;
  const near = Math.exp(-(((x - sx) / 16) ** 2));
  const h = smooth(0, 3, d) * (1.5 + 2 * vnoise(x * 0.18, z * 0.18)) + smooth(2, 28, d) * (2 + 19 * ridged(x * 0.045 + 3.1, z * 0.045)) * (1 + 0.5 * smooth(25, 55, d)) + near * smooth(0.4, 1.4, d) * 6.5;
  const gw = 1.5 + d * 0.12, g = Math.exp(-(((x - gorgeX(sx, d)) / gw) ** 2));
  return h * (1 - g) + Math.min(h, gorgeFloor(d)) * g;
}
/** A strip along a path of [x, y, z] points; each cross-section is a list of [offset, lift, colour]. */
function strip(path: [number, number, number][], profile: (i: number) => [number, number, THREE.Color][], vScale = 0.25) {
  const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
  let len = 0;
  const k = profile(0).length;
  path.forEach(([x, y, z], i) => {
    const [ax, , az] = path[Math.max(0, i - 1)], [bx, , bz] = path[Math.min(path.length - 1, i + 1)];
    const tx = bx - ax, tz = bz - az, tl = Math.hypot(tx, tz) || 1, nx = -tz / tl, nz = tx / tl;
    if (i) len += Math.hypot(x - path[i - 1][0], z - path[i - 1][2]);
    profile(i).forEach(([o, lift, c], j) => { pos.push(x + nx * o, y + lift, z + nz * o); col.push(c.r, c.g, c.b); uv.push(j / (k - 1), len * vScale); });
    if (i) for (let j = 0; j < k - 1; j++) { const a0 = (i - 1) * k + j, b0 = i * k + j; idx.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0); }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  return geo;
}
/** Bold stripes that scroll down the falls. */
function fallsTexture() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 32; const g2 = c.getContext('2d')!;
  g2.fillStyle = '#9fd3e0'; g2.fillRect(0, 0, 16, 32);
  g2.fillStyle = '#eef8fb';
  for (const [x, y, h] of [[1, 2, 10], [6, 14, 12], [11, 4, 9], [3, 20, 8], [13, 22, 7]]) g2.fillRect(x, y, 2, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t;
}
/** The river: a smooth channel with muddy, pebbly banks, flowing water, a timber bridge, and a waterfall where it leaves a gorge in the mountains along the top of the map. */
function syncRiver(R: Rig) {
  if (R.riverSig === R.region) return;
  R.riverSig = R.region;
  clear(R.riverG);
  const rows = new Map<number, number[]>();
  for (const id of riverTiles(R.region)) { const [x, y] = tileAt(id); (rows.get(y) ?? rows.set(y, []).get(y)!).push(x); }
  let line = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([y, xs]) => [(Math.min(...xs) + Math.max(...xs) + 1) / 2, y + 0.5] as [number, number]);
  if (line.length < 2) return;
  for (let y = MAP.y0 + MAP.h; y < MAP.y0 + MAP.h + 90; y++) line.push([riverX(R.region, y) + 1, y + 0.5]); // on past the bottom edge, out of the farm
  for (let pass = 0; pass < 3; pass++) line = line.map(([, z], i) => { let sx = 0, n = 0; for (let k = -3; k <= 3; k++) { const p = line[i + k]; if (p) { sx += p[0]; n++; } } return [sx / n, z] as [number, number]; }); // ease the tile steps into curves
  const sx = riverSource(R.region), top = MAP.y0, C = (h: number) => new THREE.Color(h);
  // upstream in the gorge, then down the map
  const up: [number, number, number][] = [];
  for (let d = 40; d >= 1.3; d -= 0.7) up.push([gorgeX(sx, d), gorgeFloor(d) + 0.06, top - d]);
  const down: [number, number, number][] = [[line[0][0], 0, top + 0.6], ...line.filter(([, z]) => z > top + 1).map(([x, z]) => [x, 0, z] as [number, number, number])];
  const W = (z: number) => 1.45 * (1 + 0.14 * Math.sin(z * 0.27) + 0.08 * Math.sin(z * 0.71));
  const MUD = C(0x8a7a5a), SAND = C(0xc2ae80), GRASS = C(0x7aa956), SHALLOW = C(0x7cc4cc), DEEP = C(0x4a9bbd);
  const bankProfile = (pts: [number, number, number][]) => (i: number): [number, number, THREE.Color][] => { const w = W(pts[i][2]); return [[-w - 1.1, 0.004, GRASS], [-w - 0.45, 0.008, SAND], [-w + 0.1, 0.01, MUD], [w - 0.1, 0.01, MUD], [w + 0.45, 0.008, SAND], [w + 1.1, 0.004, GRASS]]; };
  const waterProfile = (pts: [number, number, number][], scale: number) => (i: number): [number, number, THREE.Color][] => { const w = W(pts[i][2]) * scale; return [[-w, 0.02, SHALLOW], [-w * 0.72, 0.022, SHALLOW], [-w * 0.6, 0.024, DEEP], [w * 0.6, 0.024, DEEP], [w * 0.72, 0.022, SHALLOW], [w, 0.02, SHALLOW]]; };
  const bankMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const waterMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true }); // flat colour bands, like the rest of the art
  const addStrip = (geo: THREE.BufferGeometry, m: THREE.Material) => { const o = new THREE.Mesh(geo, m); o.receiveShadow = true; R.riverG.add(o); };
  addStrip(strip(down, bankProfile(down)), bankMat); addStrip(strip(down, waterProfile(down, 1)), waterMat);
  addStrip(strip(up, waterProfile(up, 0.6)), waterMat);
  // pebbles and reeds along the banks
  const stones: THREE.Matrix4[] = [], reeds: THREE.Matrix4[] = [], q = new THREE.Quaternion(), upV = new THREE.Vector3(0, 1, 0);
  down.forEach(([x, , z], i) => {
    if (i % 2 || isRoad(Math.floor(z)) || isRoad(Math.floor(z) + 1) || isRoad(Math.floor(z) - 1)) return;
    for (const side of [-1, 1]) {
      const r = vh(i, side), w = W(z) + 0.2 + r * 0.5;
      q.setFromAxisAngle(upV, r * 6);
      if (r < 0.55) stones.push(new THREE.Matrix4().compose(new THREE.Vector3(x + side * w, 0.02, z + r - 0.5), q, new THREE.Vector3(0.18 + r * 0.25, 0.1 + r * 0.08, 0.15 + r * 0.2)));
      else reeds.push(new THREE.Matrix4().compose(new THREE.Vector3(x + side * (w - 0.1), 0, z), q, new THREE.Vector3(1, 0.7 + r * 0.6, 1)));
    }
  });
  const inst = (geo: THREE.BufferGeometry, m: THREE.Material, list: THREE.Matrix4[]) => { if (!list.length) return; const im = new THREE.InstancedMesh(geo, m, list.length); list.forEach((x, i) => im.setMatrixAt(i, x)); im.castShadow = true; im.frustumCulled = false; R.riverG.add(im); };
  inst(cached('pebble', () => new THREE.IcosahedronGeometry(1, 0)), mat(0x9a948a, { rough: 1 }), stones);
  inst(cached('reed', () => new THREE.ConeGeometry(0.12, 0.6, 4).translate(0, 0.3, 0)), mat(0x6f8f3f, { rough: 1 }), reeds);
  // a timber bridge where the main road crosses
  const cross = line.find(([, z]) => isRoad(Math.floor(z)));
  if (cross) {
    const [bx] = cross, bz = ROAD_Y + ROAD_H / 2;
    R.riverG.add(box(5.2, 0.12, ROAD_H + 0.2, PAL.wood, bx, 0.06, bz));
    for (const dz of [-ROAD_H / 2 - 0.05, ROAD_H / 2 + 0.05]) { R.riverG.add(box(5.2, 0.06, 0.06, PAL.woodDark, bx, 0.45, bz + dz)); for (let i = -2; i <= 2; i++) R.riverG.add(box(0.08, 0.42, 0.08, PAL.woodDark, bx + i * 1.2, 0.06, bz + dz)); }
  }
  // the mountains: a heightfield along the whole top edge, flat-shaded rock, scrub and snow
  const xs: number[] = [];
  for (let x = MAP.x0 - 60; x <= MAP.x0 + MAP.w + 60; x += Math.abs(x - sx) < 6 ? 0.75 : 1.5) xs.push(x);
  const ds = [0, 0.3, 0.6, 0.9, 1.0, 1.08, 1.3, 1.6, 2, 2.5, 3, 3.6, 4.3, 5];
  for (let d = 6; d <= 62; d += 1.5) ds.push(d);
  const H = (x: number, d: number) => mountainH(x, top - d, sx);
  const pos: number[] = [], col: number[] = [], c = new THREE.Color();
  const ROCK = [C(0x9a9283), C(0xa29a8a), C(0x938b7d)], SNOW = C(0xeef1f4), SCRUB = C(0x56703f), MEADOW = C(0x7c8c58), FOOT = C(0x88ba5c);
  const tri = (a: number[], b: number[], cc: number[]) => {
    const e1 = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), e2 = new THREE.Vector3(cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]), n = e1.cross(e2).normalize();
    const ny = Math.abs(n.y), h = (a[1] + b[1] + cc[1]) / 3, r = vh(a[0] * 0.7, a[2] * 0.7);
    if (h > 13 + 3 * vnoise(a[0] * 0.1, a[2] * 0.1) && ny > 0.45) c.copy(SNOW);
    else if ((ny < 0.62 && h > 3.8) || ny < 0.4 || h > 10) c.copy(ROCK[Math.floor(r * 3)]); // the low bank at the foot stays grassy; rock starts higher up
    else if (h < 0.35) c.copy(FOOT);
    else if (h < 6.5) c.copy(SCRUB).lerp(MEADOW, r * 0.4).lerp(ROCK[1], ny < 0.75 && h > 3.8 ? 0.45 : 0);
    else c.copy(MEADOW).lerp(ROCK[0], r);
    for (const p of [a, b, cc]) { pos.push(p[0], p[1], p[2]); col.push(c.r, c.g, c.b); }
  };
  for (let j = 0; j < ds.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) {
    const p = (ii: number, jj: number) => [xs[ii], H(xs[ii], ds[jj]), top - ds[jj]];
    const a = p(i, j), b = p(i + 1, j), e = p(i, j + 1), f = p(i + 1, j + 1);
    tri(a, b, e); tri(b, f, e);
  }
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); mg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); mg.computeVertexNormals();
  const mtn = new THREE.Mesh(mg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide })); mtn.receiveShadow = true; mtn.castShadow = true; R.riverG.add(mtn);
  // the falls: water pouring off the gorge's lip into a foaming pool
  const fallTex = fallsTexture(); fallTex.repeat.set(1, 1.5); R.fall = fallTex;
  const lip = gorgeFloor(1.3) + 0.06, fallPath: [number, number, number][] = [];
  for (let k = 0; k <= 8; k++) { const t = k / 8; fallPath.push([sx, lip * (1 - t * t) + 0.02, top - 1.3 + 0.5 * t + 0.6 * t * t]); }
  const t2 = (k: number) => k / 8;
  const fallGeo = new THREE.BufferGeometry(), fp: number[] = [], fu: number[] = [], fi: number[] = [];
  fallPath.forEach(([x, y, z], k) => { for (const [o, u] of [[-1.05, 0], [1.05, 1]]) { fp.push(x + o * (1 + t2(k) * 0.35), y, z); fu.push(u, k / 8); } if (k) fi.push((k - 1) * 2, k * 2, (k - 1) * 2 + 1, (k - 1) * 2 + 1, k * 2, k * 2 + 1); });
  fallGeo.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); fallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2)); fallGeo.setIndex(fi); fallGeo.computeVertexNormals();
  R.riverG.add(new THREE.Mesh(fallGeo, new THREE.MeshStandardMaterial({ map: fallTex, emissive: 0x52666c, emissiveMap: fallTex, roughness: 0.6, side: THREE.DoubleSide }))); // lit, so it darkens at night like everything else
  const FOAM = mat(0xf4fafb, { rough: 0.9, emissive: 0x3a4446 });
  const lipFoam = mesh(cached('lipfoam', () => new THREE.BoxGeometry(2.3, 0.18, 0.35)), FOAM, sx, lip + 0.02, top - 1.3, false); R.riverG.add(lipFoam); // white water spilling over the lip
  const pool = mesh(cached('pool', () => new THREE.CircleGeometry(2.2, 10)), new THREE.MeshStandardMaterial({ color: 0x4a9bbd, roughness: 0.7 }), sx, 0.018, top + 0.5, false); pool.rotation.x = -Math.PI / 2; R.riverG.add(pool);
  for (let i = 0; i < 9; i++) { const m = mesh(cached('splash', () => new THREE.IcosahedronGeometry(1, 0)), FOAM, sx - 1.4 + (i % 5) * 0.7, 0.05, top + 0.15 + (i > 4 ? 0.55 : 0) + vh(i, 7) * 0.3, false); m.scale.set(0.4 + vh(i, 9) * 0.25, 0.22, 0.4 + vh(i, 9) * 0.25); m.name = 'mist'; R.riverG.add(m); } // chunky white splash at the foot
  // rocks in the stream with white water breaking round them
  const ring = cached('foamring', () => new THREE.RingGeometry(0.32, 0.55, 7).rotateX(-Math.PI / 2));
  for (let i = 8; i < line.length - 2; i += 13) {
    const [x, z] = line[i], o = (vh(i, 3) - 0.5) * 1.4;
    if (isRoad(Math.floor(z)) || isRoad(Math.floor(z) + 2) || isRoad(Math.floor(z) - 2)) continue;
    const rk = mesh(cached('boulder', () => new THREE.DodecahedronGeometry(1, 0)), mat(0x8a847a, { rough: 1 }), x + o, 0, z); rk.scale.set(0.3, 0.2, 0.28); rk.rotation.y = i; R.riverG.add(rk);
    R.riverG.add(mesh(ring, FOAM, x + o, 0.035, z, false));
  }
  for (let i = 0; i < 6; i++) { const rk = mesh(cached('boulder', () => new THREE.DodecahedronGeometry(1, 0)), mat(i % 2 ? 0x77716a : 0x8a847a, { rough: 1 }), sx + (i < 3 ? -1 : 1) * (1.9 + (i % 3) * 0.55), 0.15, top + 0.2 + (i % 3) * 0.6); rk.scale.set(0.5 + (i % 3) * 0.15, 0.4 + (i % 2) * 0.2, 0.45); rk.rotation.y = i; R.riverG.add(rk); }
  // foam flecks that drift downstream
  const n = Math.min(480, line.length * 2.4 | 0);
  const im = new THREE.InstancedMesh(cached('foam', () => new THREE.BoxGeometry(0.3, 0.01, 0.08)), FOAM, n);
  im.frustumCulled = false; R.riverG.add(im);
  R.foam = { im, pts: line, phase: Array.from({ length: n }, (_, i) => vh(i, 300)) };
}
function animateRiver(R: Rig, t: number) {
  if (!R.foam) return;
  const { im, pts, phase } = R.foam, m = new THREE.Matrix4(), L = pts.length - 1;
  phase.forEach((p0, i) => {
    // a quarter of the foam churns in the white water below the falls; the rest drifts the whole way down
    const span = i % 4 ? L : Math.min(L, 14), f = ((p0 + t * (i % 4 ? 0.012 : 0.05)) % 1) * span, k = Math.floor(f), u = f - k, [x0, z0] = pts[k], [x1, z1] = pts[Math.min(L, k + 1)];
    const side = ((i * 0.618) % 1 - 0.5) * (i % 4 ? 1.9 : 2.4), len = 0.6 + ((i * 0.381) % 1) * 1.6;
    m.makeRotationY(-Math.atan2(z1 - z0, x1 - x0)).scale(new THREE.Vector3(len, 1, 1)).setPosition(x0 + (x1 - x0) * u + side, 0.03, z0 + (z1 - z0) * u);
    im.setMatrixAt(i, m);
  });
  im.instanceMatrix.needsUpdate = true;
  if (R.fall) R.fall.offset.y = t * 1.4; // the waterfall pours
  R.riverG.children.forEach((c) => { if (c.name === 'mist') c.position.y = 0.05 + 0.08 * Math.abs(Math.sin(t * 3 + c.position.x * 2)); });
}

// ---------------------------------------------------------------- live things

function animateNeighbours(R: Rig, L: Layout, s: GameState, time: number) {
  const homes = L.lots.filter(l => l.key.startsWith('community:'));
  const count = R.region === 'heartland' && communityOf(s).active && homes.length ? Math.min(8, Math.ceil(Math.max(0, population(s) - residentWorkers(s)) / 2)) : 0;
  while(R.neighbours.length > count) R.units.remove(R.neighbours.pop()!);
  while(R.neighbours.length < count) { const i = R.neighbours.length, p = person(SHIRTS[(i * 3 + 1) % SHIRTS.length], false); if(i % 3 === 2) p.scale.setScalar(0.7); playClip(p, 'Walk', hash(i)); R.neighbours.push(p); R.units.add(p); }
  const t = reducedMotionQuery?.matches ? 0 : time;
  R.neighbours.forEach((p, i) => { const home = homes[i % homes.length], stride = Math.sin(t * 0.35 + i * 1.7); p.position.set(home.x + 1.5 + stride * 1.2, 0.03, home.y + home.d + 0.45); p.rotation.y = Math.cos(t * 0.35 + i * 1.7) > 0 ? 0 : Math.PI; (p.userData.mixer as THREE.AnimationMixer | undefined)?.update(R.dt * 0.6); });
}

function animateUnits(R: Rig, L: Layout, s: GameState, t: number) {
  const r = R.region;
  R.dt = Math.min(0.1, Math.max(0, t - (R.animT ?? t))); R.animT = t;
  const plotOf = (id: number) => L.plots.find((p) => p.field.id === id);
  const house = L.lots[0];
  // people
  // everyone working is out in the fields; only a few idle hands loiter in the yard (the rest are indoors)
  let idle = 0;
  const people = s.workers.filter((w) => w.region === r && (w.task || idle++ < 8)).slice(0, 60); // modelled people are heavier: a field shows a few, not every hand
  const seen = new Set<number>();
  const crews = new Map<number, number[]>(); // who works each field, so each hand takes a row of their own
  for (const w of people) if (w.task) (crews.get(w.task) ?? crews.set(w.task, []).get(w.task)!).push(w.id);
  people.forEach((w, i) => {
    seen.add(w.id);
    let o = R.people.get(w.id);
    if (!o) { o = (w.role === 'manager' ? null : farmhand(w.id)) ?? person(SHIRTS[w.id % SHIRTS.length], w.role === 'manager'); R.units.add(o); R.people.set(w.id, o); }
    const p = w.task ? plotOf(w.task) : undefined;
    let x: number, z: number;
    const folk = !!o.userData.folk, mixer = o.userData.mixer as THREE.AnimationMixer | undefined;
    if (p && folk) {
      // work their row: a few steps, then hoe the ground (or scythe a ripe crop) for a while; turn at the end of the row
      const crew = crews.get(p.field.id)!, k = crew.indexOf(w.id), m = crew.length, L = Math.max(0.5, p.s - 0.8);
      const c = t / 4.5 + hash(w.id) * 7, stepN = Math.floor(c), ph = c - stepN, walking = ph < 0.28;
      const lap = ((stepN + Math.min(1, ph / 0.28)) * 0.5) % (2 * L), fwd = lap < L, ripe = isReady(s, p.field);
      x = p.x + 0.4 + (fwd ? lap : 2 * L - lap);
      z = p.y + 0.4 + ((k + 0.5) / m) * L;
      o.rotation.y = fwd ? 0 : Math.PI;
      o.position.y = 0; o.scale.y = 1;
      playClip(o, walking ? 'Walk' : ripe ? 'Sword_Slash' : 'Interact', hash(w.id));
      if (o.userData.hoe) { o.userData.hoe.visible = !ripe; o.userData.scythe.visible = ripe; }
      mixer?.update(R.dt);
    } else if (p) {
      o.scale.y = 1;
      const lane = (w.id * 7) % Math.max(1, p.s - 1);
      x = p.x + 0.35 + ((t * 0.18 + hash(w.id) * p.s) % (p.s - 0.7));
      z = p.y + 0.4 + lane;
      o.position.y = Math.abs(Math.sin(t * 7 + i)) * 0.03;
      o.rotation.y = Math.PI / 2;
    } else {
      if (folk) { playClip(o, 'Idle', hash(w.id)); if (o.userData.hoe) { o.userData.hoe.visible = true; o.userData.scythe.visible = false; } mixer?.update(R.dt); }
      x = house.x + house.w + 0.4 + (i % 6) * 0.35 + Math.sin(t * 0.5 + i) * 0.05;
      z = house.y + 1 + Math.floor(i / 6) * 0.35;
      o.position.y = folk ? 0 : .15;
      o.scale.y = folk ? 1 : .75;
      o.rotation.y = folk ? hash(w.id + 5) * 6 : 0; // standing about, chatting
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
      // parked in a neat row on the path in front of the barn (or the farmhouse), noses out
      const yard = L.lots.find((l) => l.type === 'barn') ?? house;
      o.position.set(yard.x + 0.45 + (i % 5) * 0.95, 0, yard.y + yard.d + 0.5 + Math.floor(i / 5) * 0.75);
      o.rotation.y = -Math.PI / 2;
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
  // animals wander inside their pens, spread across every pen of their kind
  const dt = R.dt;
  const seenH = new Set<string>();
  for (const h of s.herds) {
    if (h.region !== r) continue;
    const pens = R.models.filter((x) => x.lot.type === ANIMAL_BUILDING[h.animal] && x.model.pen);
    if (!pens.length) continue;
    const key = h.animal;
    seenH.add(key);
    const per = h.animal === 'chickens' ? 6 : 2, cap = (h.animal === 'chickens' ? 18 : 10) * pens.length;
    const want = Math.max(1, Math.min(cap, Math.round(h.count / per)));
    let list = R.herds.get(key) ?? [];
    while (list.length < want) {
      const o = animal(h.animal);
      const clip = o.userData.clips && THREE.AnimationClip.findByName(o.userData.clips, o.userData.play);
      if (clip) { const mixer = new THREE.AnimationMixer(o.userData.rig); const act = mixer.clipAction(clip); act.time = hash(list.length) * clip.duration; act.play(); o.userData.mixer = mixer; }
      R.units.add(o); list.push(o);
    }
    while (list.length > want) R.units.remove(list.pop()!);
    R.herds.set(key, list);
    list.forEach((o, i) => {
      const m = pens[i % pens.length], pen = m.model.pen!, j = Math.floor(i / pens.length);
      const sp = h.animal === 'chickens' ? 0.25 : 0.08;
      const a = t * sp + j * 2.3 + hash(i) * 6, b = t * sp * 0.8 + j * 1.7 + hash(i + 7) * 3;
      o.position.set(m.lot.x + pen.x0 + (pen.x1 - pen.x0) * (0.5 + 0.45 * Math.sin(a)), 0, m.lot.y + pen.z0 + (pen.z1 - pen.z0) * (0.5 + 0.45 * Math.cos(b)));
      o.rotation.y = Math.atan2(0.8 * Math.sin(b) * (pen.z1 - pen.z0), Math.cos(a) * (pen.x1 - pen.x0)); // face the way it walks (models look along +x)
      o.scale.setScalar(h.health < 0.5 ? 0.85 : 1);
      (o.userData.mixer as THREE.AnimationMixer | undefined)?.update(dt);
    });
  }
  // cattle in the ranch and dairy yards: more of them the busier the place is, none when it stands idle
  for (const m of R.models) {
    if ((m.lot.type !== 'ranch' && m.lot.type !== 'dairy') || !m.model.pen) continue;
    const running = m.lot.buildings.filter((b) => b.active), util = running.reduce((a, b) => a + b.util, 0) / Math.max(1, running.length);
    const key = `yard:${m.lot.x},${m.lot.y}`, want = running.length ? Math.round(2 + 4 * util) : 0, pen = m.model.pen;
    let list = R.herds.get(key) ?? [];
    while (list.length < want) {
      const o = animal('cows');
      const clip = o.userData.clips && THREE.AnimationClip.findByName(o.userData.clips, o.userData.play);
      if (clip) { const mixer = new THREE.AnimationMixer(o.userData.rig); const act = mixer.clipAction(clip); act.time = hash(list.length + 3) * clip.duration; act.play(); o.userData.mixer = mixer; }
      R.units.add(o); list.push(o);
    }
    while (list.length > want) R.units.remove(list.pop()!);
    if (list.length) { R.herds.set(key, list); seenH.add(key); }
    list.forEach((o, i) => {
      const a = t * 0.06 + i * 2.3 + hash(i + m.lot.x) * 6, b = t * 0.05 + i * 1.7 + hash(i + 7 + m.lot.y) * 3;
      o.position.set(m.lot.x + pen.x0 + (pen.x1 - pen.x0) * (0.5 + 0.42 * Math.sin(a)), 0, m.lot.y + pen.z0 + (pen.z1 - pen.z0) * (0.5 + 0.42 * Math.cos(b)));
      o.rotation.y = Math.atan2(0.8 * Math.sin(b) * (pen.z1 - pen.z0), Math.cos(a) * (pen.x1 - pen.x0));
      (o.userData.mixer as THREE.AnimationMixer | undefined)?.update(dt);
    });
  }
  for (const [k, list] of R.herds) if (!seenH.has(k)) { list.forEach((o) => R.units.remove(o)); R.herds.delete(k); }
}

function atmosphere(R: Rig, s: GameState, t: number) {
  const hour = getSpeed() >= 10 ? 13 : (s.tick % 24) + 0.5; // at 10×+ a day flashes past in ~2s, so hold the light at early afternoon
  const dayIdx = Math.floor(s.tick / 24);
  const season = SEASONS[Math.floor((((dayIdx % 120) + 120) % 120) / 30)];
  const r = R.region;
  // sun arc: rises at SUNRISE, sets at SUNSET
  const k = Math.sin(((hour - SUNRISE) / (SUNSET - SUNRISE)) * Math.PI);
  const elev = Math.max(-0.2, k);
  const az = ((hour - SUNRISE) / (SUNSET - SUNRISE)) * Math.PI;
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
  for (const m of R.models) for (const w of m.model.windows) w.material = lit && (!m.lot.service || m.lot.service.active && m.lot.service.funded) ? mat(PAL.windowLit, { emissive: 0xffb84d }) : mat(PAL.window);
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

function overlayLabels(R: Rig, L: Layout, s: GameState, W: number, H: number, el: HTMLDivElement | null, t: number, selected: number[], plantLabel?: string, selectedLot?: string, placing: Placement | null = null, forestAt: [number, number] | null = null, placeCost = 0) {
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
  // a family moving in: their name floats up over a home in the neighbourhood
  const cohorts = communityOf(s).cohorts;
  if (R.popsReady && cohorts.length > (R.cohortsSeen ?? cohorts.length)) {
    const homes = L.lots.filter((l) => l.key.startsWith('community:'));
    // the newest homes are the free ones
    cohorts.slice(R.cohortsSeen).forEach((g, k, arr) => { const h = homes[Math.max(0, homes.length - arr.length + k)]; if (h) R.pops.push({ key: `fam${g.id}`, text: `🏠 ${g.name.replace(' (newcomers)', '')} moved in`, x: h.x + h.w / 2, z: h.y + h.d / 2, t0: t, tone: 'family' }); });
  }
  R.cohortsSeen = cohorts.length;
  R.popsReady = true; // harvests that existed when the farm loaded don't pop
  R.pops = R.pops.filter((p) => t - p.t0 < (p.tone === 'family' ? 3.5 : 1.8));
  for (const p of R.pops) {
    const [x, y] = project(p.x, (p.tone === 'family' ? 2.4 : 1.2) + (t - p.t0) * (p.tone === 'family' ? 0.35 : 0.9), p.z);
    want.push({ key: p.key, x, y, html: p.text, cls: `wl-pop ${p.tone ?? ''}` });
  }
  const button = (action: string, label: string) => `<button data-action="${action}" type="button"${label==='ⓘ'?' aria-label="Inspect selected item"':''}>${label}</button>`;
  void placeCost;
  if (placing) {
    // placement controls live in a fixed bar (Hud), so they never chase the ghost
  } else if (forestAt) {
    const [px, py] = project(forestAt[0] + 0.5, 1.6, forestAt[1] + 0.5), at = { key: 'forest', x: Math.max(150, Math.min(W - 150, px)), y: Math.max(80, Math.min(H - 30, py)), cls: 'wl-radial' };
    if (ownedSet(worldOf(s, R.region)).has(chunkAt(forestAt[0], forestAt[1]))) {
      const one = patchesAround(s, R.region, forestAt[0], forestAt[1], 1).length, nine = patchesAround(s, R.region, forestAt[0], forestAt[1], 3).length;
      want.push({ ...at, html: one || nine ? (one ? button('clear1:0', `🪓 Clear patch · $${num(clearCost(s))}`) : '') + (nine > 1 ? button('clear9:0', `🪓 Clear ${nine} · $${num(clearCost(s) * nine)}`) : '') + button('placecancel:0', '✕') : `<span class="wl-grow">Already being cleared</span>${button('placecancel:0', '✕')}` });
    } else {
      // land beyond the farm's boundary: buy it first (it must join land you own)
      const one = forSaleAround(s, R.region, forestAt[0], forestAt[1], 1).length, nine = forSaleAround(s, R.region, forestAt[0], forestAt[1], 3).length;
      want.push({ ...at, html: one || nine ? (one ? button('buy1:0', `🏷 Buy ${LAND_HA_PER_PATCH} ha · $${num(landCost(s, R.region, 1))}`) : '') + (nine > 1 ? button('buy9:0', `🏷 Buy ${nine * LAND_HA_PER_PATCH} ha · $${num(landCost(s, R.region, nine))}`) : '') + button('placecancel:0', '✕') : `<span class="wl-grow">Not for sale yet: buy the land next to yours first</span>${button('placecancel:0', '✕')}` });
    }
  }
  const queue = worldOf(s, R.region).queue;
  if (queue.length) {
    const [ox, oy] = chunkOrigin(queue[0].chunk), [qx, qy] = project(ox + CHUNK / 2, 1.4, oy + CHUNK / 2);
    want.push({ key: 'felling', x: qx, y: qy, cls: 'wl-name', html: `🪓 ${queue.length} patch${queue.length === 1 ? '' : 'es'} · ${queue.reduce((n, j) => n + j.hours, 0)}h` });
  }
  if (selected.length === 1 && !placing) {
    const p = L.plots.find(q=>q.field.id===selected[0]);
    if(p){
      const ready=isReady(s,p.field), id=p.field.id;
      const [px,py]=project(p.x+p.s/2,1.5,p.y+p.s/2);
      const hand=p.field.ha<=1;
      const primary=hand ? ready?button(`harvest:${id}`,'🌾 Harvest'):!p.field.crop&&plantLabel?button(`plant:${id}`,`🌱 ${plantLabel}`):p.field.crop?`<span class="wl-grow">⏳ ${Math.floor(growth(s,p.field)*100)}%</span>`:'' : '';
      const plan=!hand&&stageAtLeast(s,'farm-business')?button(`plan:${id}`,'📋 Crop plan'):'';
      const need=fieldNeeds(s,p.field);
      const fp=need.fertilise?fertilisePlan(s,p.field):null;
      const care=(fp?button(`fertilise:${id}`,fp.source==='manure'?'🌿 Spread manure':fp.buy?`🌿 Fertilise · buy ${money(fp.cost)}`:'🌿 Fertilise'):'')+(need.irrigate?button(`irrigate:${id}`,'💧 Irrigate'):'')+(need.water?button(`pipes:${id}`,need.water.points?`🚰 Water ${need.water.points}/${need.water.need}`:'🚰 Connect water'):'');
      const mv=fieldMovable(p.field)?button(`move:${id}`,'✥ Move'):'';
      want.push({key:'act',x:Math.max(115,Math.min(W-115,px)),y:Math.max(80,Math.min(H-30,py)),html:primary+care+plan+mv+button(`inspect:${id}`,'ⓘ'),cls:'wl-radial'});
    }
  }
  if(selectedLot && !placing){
    const lot=L.lots.find(x=>x.key===selectedLot);
    if(lot){const [px,py]=project(lot.x+lot.w/2,2.5,lot.y+lot.d/2);
      const label=lot.service&&(UTILITY_OF[lot.service.type]||['school','clinic','well'].includes(lot.service.type))?'⚙ Manage':lot.service?.type==='barracks'?'⚔ Nation':lot.service?.type==='watchtower'?'🗼 Region':lot.service&&['sanitation','lighting','police'].includes(lot.service.type)?'🛡 City':lot.key.startsWith('civic:')?'🏛 Town':lot.key.startsWith('community:')?'🏠 Families':lot.key==='crew'?'👒 Crew':lot.key==='office'?'⚙ Policies':lot.key==='market'?'🪙 Trade':lot.type==='house'||lot.type==='shed'?'📖 Books':BUILDINGS[lot.type].category==='storage'?'📦 Store':'⚙ Manage';
      want.push({key:'place-act',x:Math.max(100,Math.min(W-100,px)),y:Math.max(80,Math.min(H-30,py)),html:button('place:0',label)+(lot.type==='oilWell'?'':button('movelot:0','✥ Move'))+button('inspect:0','ⓘ'),cls:'wl-radial'});
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
  for (const p of L.plots) {
    if (isReady(s, p.field) || selected.includes(p.field.id)) continue;
    const need = fieldNeeds(s, p.field);
    if (!need.fertilise && !need.irrigate && !need.water) continue;
    const [x, y] = project(p.x + p.s / 2, 1.1, p.y + p.s / 2);
    if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
    want.push({ key: `n${p.field.id}`, x, y, html: need.fertilise ? '🌿' : need.water ? '🚰' : '💧', cls: 'wl-need' });
  }
  for (const f of struckFields(s, R.region)) { // each struck oil field: what is left, over its wells
    const ps = f.wells.map((b) => worldOf(s, R.region).pos[`b:${b.id}`]).filter(Boolean);
    if (!ps.length) continue;
    const [x, y] = project(ps.reduce((a, p) => a + p[0], 0) / ps.length + 1, 3.2, ps.reduce((a, p) => a + p[1], 0) / ps.length + 1);
    if (x < -60 || y < -20 || x > W + 60 || y > H + 20) continue;
    want.push({ key: `oil${f.i}`, x, y, cls: 'wl-name', html: `🛢 ${f.left >= 1000 ? `${Math.round(f.left / 1000)}k` : Math.round(f.left)} bbl left${f.wells.length > f.balanced ? ` · ⚠ ${f.wells.length}/${f.balanced} wells` : ''}` });
  }
  if (zoomed) for (const m of R.models) {
    const lot = m.lot;
    if (lot.key.startsWith('community:')) continue; // rows of homes read at a glance; a label on each is just clutter
    const [x, y] = project(lot.x + lot.w / 2, 0, lot.y + lot.d + 0.3);
    if (x < -60 || y < -20 || x > W + 60 || y > H + 20) continue;
    const name = lotName(lot);
    const lvl = Math.max(1, ...lot.buildings.map((b) => b.level));
    const noRoad = !hasAccess(s, R.region, lot.place);
    const warn = noRoad || !!(lot.service?.active && !lot.service.funded) || lot.buildings.some((b) => b.active && /Not enough|full|Disease/.test(b.reason));
    want.push({ key: `l${lot.key}`, x, y, html: `${warn ? '⚠ ' : lot.service && !lot.service.active ? '○ ' : ''}${noRoad ? 'No road · ' : ''}${name}${lot.service && lot.service.count>1?` ×${lot.service.count}`:''}${lot.buildings.length > 1 ? ` ×${lot.buildings.length}` : ''}${lvl > 1 ? ` · L${lvl}` : ''}`, cls: 'wl-name' });
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
    // Compare against the source string we last wrote: the browser re-serialises innerHTML (& → &amp;), which would rebuild nodes every frame.
    if (d.dataset.html !== w.html) { d.innerHTML = w.html; d.dataset.html = w.html; }
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
  if(lot.service){const b=lot.service,d=SERVICE_DEFS[b.type];return [d.name,`${b.staffed}/${serviceJobs(s,b.type)*b.count} staff`,!b.active?'Paused':b.funded?'Working':'Needs funding or staff'];}
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

/** Packed dirt seen from above: soft worn patches, fine grit and scattered pebbles with their shadows. Light grey, so it tints whatever road colour lies under it. Tiles seamlessly. */
let grain: THREE.CanvasTexture | null = null;
function roadGrain() {
  if (grain) return grain;
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d')!;
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const wrap = (px: number, py: number, r: number, draw: (X: number, Y: number) => void) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) if (px + ox > -r && px + ox < S + r && py + oy > -r && py + oy < S + r) draw(px + ox, py + oy); };
  x.fillStyle = '#ededed'; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) { // worn and packed patches
    const px = rnd() * S, py = rnd() * S, r = 14 + rnd() * 46, l = Math.round(200 + rnd() * 70), a = 0.18 + rnd() * 0.2;
    wrap(px, py, r, (X, Y) => { const g = x.createRadialGradient(X, Y, 0, X, Y, r); g.addColorStop(0, `rgba(${l},${l - 4},${l - 10},${a})`); g.addColorStop(1, `rgba(${l},${l - 4},${l - 10},0)`); x.fillStyle = g; x.fillRect(X - r, Y - r, r * 2, r * 2); });
  }
  const img = x.getImageData(0, 0, S, S), d = img.data; // fine grit
  for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 26; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.9; }
  x.putImageData(img, 0, 0);
  for (let i = 0; i < 900; i++) { // pebbles: a shadow below, the stone, a lit top
    const px = rnd() * S, py = rnd() * S, r = 1.2 + rnd() * rnd() * 5.5, rot = rnd() * 3, l = Math.round(150 + rnd() * 105), warm = rnd() * 18;
    wrap(px, py, r + 3, (X, Y) => {
      x.fillStyle = 'rgba(70,58,44,0.45)'; x.beginPath(); x.ellipse(X + r * 0.35, Y + r * 0.45, r * 1.05, r * 0.8, rot, 0, 7); x.fill();
      x.fillStyle = `rgb(${l + warm},${l + warm * 0.6},${l})`; x.beginPath(); x.ellipse(X, Y, r, r * 0.75, rot, 0, 7); x.fill();
      x.fillStyle = 'rgba(255,255,255,0.35)'; x.beginPath(); x.ellipse(X - r * 0.25, Y - r * 0.25, r * 0.45, r * 0.3, rot, 0, 7); x.fill();
    });
  }
  for (let i = 0; i < 1400; i++) { const px = rnd() * S, py = rnd() * S; x.fillStyle = `rgba(80,66,50,${0.2 + rnd() * 0.3})`; x.fillRect(px, py, 1 + rnd() * 1.5, 1 + rnd() * 1.5); } // dark grit
  grain = new THREE.CanvasTexture(c);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping; grain.colorSpace = THREE.SRGBColorSpace; grain.anisotropy = 4;
  return grain;
}

/** Tufts of grass along the road edges, so the road sits in the field instead of being painted on it. */
function roadsideTufts(w: ReturnType<typeof worldOf>, river: Set<number>) {
  const list: THREE.Matrix4[] = [], cols: THREE.Color[] = [], q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const put = (x: number, z: number, k: number) => {
    q.setFromAxisAngle(up, hash(x * 3.1 + z * 7.7) * 6.28);
    const sc = 0.5 + hash(x * 1.7 - z) * 0.55;
    list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(sc, sc * (0.8 + hash(x + z * 9) * 0.6), sc)));
    cols.push(new THREE.Color().setHSL(0.21 + hash(k) * 0.07, 0.55, 0.26 + hash(k * 3.3) * 0.1));
  };
  const cz = ROAD_Y + ROAD_H / 2, half = ROAD_H / 2 - 0.1;
  for (let x = MAP.x0; x < MAP.x0 + MAP.w; x += 0.16) for (const sd of [-1, 1]) {
    const k = x * 13 + sd, ty = sd < 0 ? ROAD_Y - 1 : ROAD_Y + ROAD_H;
    if (hash(k) < 0.3 || w.roads[tileId(Math.floor(x), ty)] || [-2, -1, 0, 1, 2].some((o) => river.has(tileId(Math.floor(x) + o, ty)))) continue; // gaps where tracks join and at the bridge
    put(x + hash(k * 1.3) * 0.1, cz + sd * (half + 0.02 + hash(k * 2.1) * hash(k * 5.1) * 0.22), k);
  }
  for (const id of Object.keys(w.roads)) {
    const [tx, ty] = tileAt(Number(id));
    for (let i = 0; i < 11; i++) {
      const k = Number(id) * 7 + i, a = hash(k) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      const nx = Math.round(dx * 0.75), nz = Math.round(dz * 0.75); // skip the sides where the track runs on
      if ((nx || nz) && (w.roads[tileId(tx + nx, ty + nz)] !== undefined || isRoad(ty + nz))) continue;
      const r = 0.38 + hash(k * 1.9) * hash(k * 4.3) * 0.2;
      put(tx + 0.5 + dx * r, ty + 0.5 + dz * r, k);
    }
  }
  const im = new THREE.InstancedMesh(cached('tuft', () => merged(...[0, 1, 2, 3, 4].map((i) => new THREE.ConeGeometry(0.022, 0.13 + (i % 3) * 0.03, 3).translate(0, 0.065, 0).rotateZ((i - 2) * 0.28).rotateY(i * 1.3).translate(Math.cos(i * 1.3) * 0.025, 0, Math.sin(i * 1.3) * 0.025)))), SOFT_PINE, Math.max(1, list.length));
  list.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, cols[i]); });
  im.count = list.length; im.frustumCulled = false;
  return im;
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
  const at=L.lots.find(l=>l.type!=='house'&&l.type!=='shed'&&BUILDINGS[l.type].category==='storage')??L.lots.find(l=>l.key==='market');
  if(!at)return;
  // stock is counted once a game hour, but the crates follow their building at once when it moves (even while paused)
  const tickKey=s.tick*100003+at.x*317+at.y;if(R.lastStockTick===tickKey)return;R.lastStockTick=tickKey;
  const st=stored(s,R.region), n=Math.min(12,Math.ceil(st.dry/Math.max(1,st.cap.dry)*12));
  const signature=`${at.key}:${at.x}:${at.y}:${n}:${artRevision()}`;
  if(R.storageProps.userData.signature===signature)return;
  R.storageProps.userData.signature=signature;R.storageProps.clear();
  for(let i=0;i<n;i++){const x=at.x+(i%4)*.36,y=.05+Math.floor(i/4)*.3,z=at.y+at.d+.4,c=artModel('crate',.3,.3,true);
    if(c){c.position.set(x,y,z);c.rotation.y=(i*.7)%.3;R.storageProps.add(c);}else R.storageProps.add(box(.32,.27,.32,PAL.wood,x,y,z));}
}
