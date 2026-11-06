// Small isometric portraits of a building, rendered once from the same low-poly model the farm uses.
import * as THREE from 'three';
import type { Lot } from './layout';
import { FOOTPRINT } from './layout';
import type { ServiceType } from '../../simulation/types';
import { buildCivic, buildLot } from './models';
import { artRevision } from './art';
let cachedRevision=-1;

const SIZE = 192;
type PortraitType = Lot['type'] | `civic:${ServiceType | 'hall'}`;
const cache = new Map<PortraitType, string>();
let renderer: THREE.WebGLRenderer | null = null;
let idle = 0;

/** A PNG data URL of the building, or '' when WebGL isn't available (callers show a fallback). */
export function portrait(type: PortraitType): string {
  if(cachedRevision!==artRevision()){cache.clear();cachedRevision=artRevision();}
  const hit = cache.get(type);
  if (hit !== undefined) return hit;
  let url = '';
  try {
    renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    sun.position.set(-4, 10, 6);
    scene.add(new THREE.HemisphereLight(0xfff4e0, 0xb59a70, 0.9), sun);
    const civic=type.startsWith('civic:');
    const [w, d] = civic ? [3,3] : FOOTPRINT[type as Lot['type']];
    const model = (civic ? buildCivic(type.slice(6),w,d) : buildLot(type as Lot['type'], w, d)).group;
    scene.add(model);
    // frame the model from the farm's own isometric angle
    const box = new THREE.Box3().setFromObject(model);
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getBoundingSphere(new THREE.Sphere()).radius * 1.05;
    const cam = new THREE.OrthographicCamera(-r, r, r, -r, -100, 100);
    cam.position.set(c.x + 10, c.y + 8.2, c.z + 10);
    cam.lookAt(c);
    renderer.render(scene, cam);
    url = renderer.domElement.toDataURL('image/png');
  } catch {
    url = '';
  }
  cache.set(type, url);
  // free the extra WebGL context once the page has drawn its portraits
  clearTimeout(idle);
  idle = window.setTimeout(() => { renderer?.dispose(); renderer?.forceContextLoss(); renderer = null; }, 2000);
  return url;
}
