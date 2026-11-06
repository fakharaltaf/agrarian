// Bounded, renderer-only art cache. Failed assets leave the procedural farm playable.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
export const ART_IDS = ['house','barn','shed','coop','silo','mill','cow','sheep','tree'] as const;
export type ArtId = typeof ART_IDS[number];
const cache = new Map<ArtId, THREE.Group>();
let loading: Promise<void> | null = null;
let revision = 0;
export const artRevision = () => revision;
export function preloadArt(): Promise<void> {
  return loading ??= Promise.all(ART_IDS.map(async id => {
    try {
      const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/quaternius/${id}.glb`);
      gltf.scene.traverse(o => { if(o instanceof THREE.Mesh) {o.castShadow=true;o.receiveShadow=true;} });
      cache.set(id, gltf.scene); revision++;
    } catch { /* Model missing/unsupported: the procedural model remains. */ }
  })).then(()=>undefined);
}
/** Uniformly fit X/Z into a footprint and place its base at zero. Preserve authored proportions. */
export function artModel(id: ArtId, width: number, depth: number, centered = false): THREE.Group | null {
  const source=cache.get(id); if(!source)return null;
  const model=clone(source);
  const bounds=new THREE.Box3().setFromObject(model), size=bounds.getSize(new THREE.Vector3());
  const scale=Math.min(width/Math.max(.001,size.x),depth/Math.max(.001,size.z),Math.max(width,depth)*1.35/Math.max(.001,size.y));
  const center=bounds.getCenter(new THREE.Vector3());
  const inner=new THREE.Group();inner.add(model);
  inner.position.set(-center.x,-bounds.min.y,-center.z);
  const result=new THREE.Group();result.add(inner);result.scale.setScalar(scale);
  if(!centered)result.position.set(width/2,0,depth/2);
  result.userData.art=id;
  return result;
}
