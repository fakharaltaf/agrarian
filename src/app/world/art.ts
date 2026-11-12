// Bounded, renderer-only art cache. Failed assets leave the procedural farm playable.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
export const ART_IDS = ['barn','shed','coop','silo','mill','cow','sheep','farmer','woman','woman2','man','horse','donkey','cart','stall','stall2','crate','barrel','sacks','cottage','cottage2','cottage3','townhouse','well','lamp','haybale','farmhouse'] as const;
export type ArtId = typeof ART_IDS[number];
// some models are recoloured by material name to sit in the farm's palette
const TINT: Partial<Record<ArtId, Record<string, number>>> = { farmhouse: { White: 0xf3e9d2, Grey: 0xa8473a, Brown: 0x7a5236 } };
const cache = new Map<ArtId, THREE.Group>();
const clipsOf = new Map<ArtId, THREE.AnimationClip[]>();
let loading: Promise<void> | null = null;
let revision = 0;
export const artRevision = () => revision;
export function preloadArt(): Promise<void> {
  return loading ??= Promise.all(ART_IDS.map(async id => {
    try {
      const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/quaternius/${id}.glb`);
      gltf.scene.traverse(o => { if(o instanceof THREE.Mesh) {o.castShadow=true;o.receiveShadow=true;
        // the packs ship 40% metallic, which renders dull and dark without an environment map: make them matte like the rest of the farm
        for(const m of [o.material].flat()) if(m instanceof THREE.MeshStandardMaterial){m.metalness=0;m.roughness=0.85;const c=TINT[id]?.[m.name];if(c!==undefined)m.color.set(c);}
      } });
      cache.set(id, gltf.scene); clipsOf.set(id, gltf.animations); revision++;
    } catch { /* Model missing/unsupported: the procedural model remains. */ }
  })).then(()=>undefined);
}
/** Uniformly fit X/Z into a footprint and place its base at zero. Preserve authored proportions. */
export function artModel(id: ArtId, width: number, depth: number, centered = false): THREE.Group | null {
  const source=cache.get(id); if(!source)return null;
  const model=clone(source);
  model.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(model,true), size=bounds.getSize(new THREE.Vector3()); // precise: skinned meshes measured as drawn
  const scale=Math.min(width/Math.max(.001,size.x),depth/Math.max(.001,size.z),Math.max(width,depth)*1.35/Math.max(.001,size.y));
  const center=bounds.getCenter(new THREE.Vector3());
  const inner=new THREE.Group();inner.add(model);
  inner.position.set(-center.x,-bounds.min.y,-center.z);
  const result=new THREE.Group();result.add(inner);result.scale.setScalar(scale);
  if(!centered)result.position.set(width/2,0,depth/2);
  result.userData.art=id;
  // animated models: the caller can play these clips on result.userData.rig with an AnimationMixer
  if(clipsOf.get(id)?.length){result.userData.clips=clipsOf.get(id);result.userData.rig=model;}
  return result;
}

/** Start one of an imported model's clips (matched by the end of its name, e.g. 'Walk'), at a random point so a crowd does not move in step. */
export function playClip(o: THREE.Object3D, name: string, seed = Math.random()) {
  const clips = o.userData.clips as THREE.AnimationClip[] | undefined, rig = o.userData.rig as THREE.Object3D | undefined;
  const clip = clips?.find((c) => c.name === name || c.name.endsWith('|' + name) || c.name.endsWith('_' + name));
  if (!clip || !rig) return;
  if (o.userData.playing === clip.name) return;
  const mixer: THREE.AnimationMixer = o.userData.mixer ??= new THREE.AnimationMixer(rig);
  mixer.stopAllAction();
  const a = mixer.clipAction(clip); a.time = seed * clip.duration; a.play();
  o.userData.playing = clip.name;
}

/** A character or animal scaled to a height (or, with `along`, a nose-to-tail length), centred on its feet and turned to face +x. */
export function artFigure(id: ArtId, size: number, along = false): THREE.Group | null {
  const m = artModel(id, 10, 10, true); // fit loosely, then rescale exactly below
  if (!m) return null;
  m.updateMatrixWorld(true); // bones too, or the skinned mesh is measured at a stale pose
  const b = new THREE.Box3().setFromObject(m, true), s = b.getSize(new THREE.Vector3());
  m.scale.multiplyScalar(size / Math.max(0.001, along ? s.z : s.y));
  m.rotation.y = Math.PI / 2; // the packs model everything looking along +z
  m.traverse((o) => { o.frustumCulled = false; }); // skinned meshes keep bind-pose bounds that three culls wrongly once scaled
  const g = new THREE.Group(); g.add(m);
  Object.assign(g.userData, { clips: m.userData.clips, rig: m.userData.rig, art: id });
  return g;
}
