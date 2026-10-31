import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TowerDef } from '../../../shared/data/classes';
import type { EnemyDef } from '../../../shared/data/enemies';

// ------------------------------------------------------------------ static geometry baking (fewer draw calls)

type Baked = { geo: THREE.BufferGeometry; mat: THREE.Material; cast: boolean }[];
const bakeCache = new Map<string, Baked>();

function prepGeo(mesh: THREE.Mesh, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  geo.applyMatrix4(matrix);
  for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
  return geo;
}

function mergeByMaterial(items: { geo: THREE.BufferGeometry; mat: THREE.Material; cast: boolean }[]): Baked {
  const groups = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>();
  for (const it of items) {
    const key = it.mat.uuid + (it.cast ? '|c' : '');
    if (!groups.has(key)) groups.set(key, { mat: it.mat, cast: it.cast, geos: [] });
    groups.get(key)!.geos.push(it.geo);
  }
  const out: Baked = [];
  for (const g of groups.values()) {
    const geo = mergeGeometries(g.geos);
    g.geos.forEach((x) => x.dispose());
    if (geo) out.push({ geo, mat: g.mat, cast: g.cast });
  }
  return out;
}

/** Replaces the non-animated direct child meshes of `container` with one merged mesh per material. */
function bakeStatic(container: THREE.Object3D, keep: Set<THREE.Object3D>, cacheKey: string) {
  const statics = container.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && !keep.has(c));
  let baked = bakeCache.get(cacheKey);
  if (!baked) {
    baked = mergeByMaterial(statics.map((m) => {
      m.updateMatrix();
      return { geo: prepGeo(m, m.matrix), mat: m.material as THREE.Material, cast: m.castShadow };
    }));
    bakeCache.set(cacheKey, baked);
  }
  for (const m of statics) container.remove(m);
  for (const b of baked) {
    const mesh = new THREE.Mesh(b.geo, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = true;
    container.add(mesh);
  }
}

/** Merges a list of static world objects into a few meshes (used for the forest). */
export function mergeWorldObjects(objects: THREE.Object3D[]): THREE.Group {
  const items: { geo: THREE.BufferGeometry; mat: THREE.Material; cast: boolean }[] = [];
  for (const o of objects) {
    o.updateMatrixWorld(true);
    o.traverse((c) => {
      if (c instanceof THREE.Mesh) items.push({ geo: prepGeo(c, c.matrixWorld), mat: c.material as THREE.Material, cast: c.castShadow });
    });
  }
  const g = new THREE.Group();
  for (const b of mergeByMaterial(items)) {
    const mesh = new THREE.Mesh(b.geo, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

// ------------------------------------------------------------------ shared geometry & materials

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  cylT: new THREE.CylinderGeometry(0.7, 1, 1, 10),
  cone: new THREE.ConeGeometry(1, 1, 10),
  pyr: new THREE.ConeGeometry(1, 1, 4),
  sph: new THREE.SphereGeometry(1, 14, 10),
  lowSph: new THREE.SphereGeometry(1, 7, 5),
  oct: new THREE.OctahedronGeometry(1, 0),
  ico: new THREE.IcosahedronGeometry(1, 0),
  dod: new THREE.DodecahedronGeometry(1, 0),
  torus: new THREE.TorusGeometry(1, 0.12, 6, 20),
  plane: new THREE.PlaneGeometry(1, 1),
};
export type GeoKey = keyof typeof G;

const matCache = new Map<string, THREE.Material>();
export function mat(color: number, o: { glow?: number; opacity?: number; metal?: number; rough?: number; side?: THREE.Side } = {}): THREE.Material {
  const key = `${color}|${o.glow ?? 0}|${o.opacity ?? 1}|${o.metal ?? 0}|${o.rough ?? 0.8}|${o.side ?? 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, flatShading: true, roughness: o.rough ?? 0.8, metalness: o.metal ?? 0,
      emissive: o.glow ? color : 0x000000, emissiveIntensity: o.glow ?? 0,
      transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide,
      depthWrite: (o.opacity ?? 1) >= 1,
    });
    matCache.set(key, m);
  }
  return m;
}

function P(g: GeoKey, m: THREE.Material, s: [number, number, number], p: [number, number, number] = [0, 0, 0], r: [number, number, number] = [0, 0, 0], shadow = true) {
  const mesh = new THREE.Mesh(G[g], m);
  mesh.scale.set(...s);
  mesh.position.set(...p);
  mesh.rotation.set(...r);
  mesh.castShadow = shadow;
  mesh.receiveShadow = shadow;
  return mesh;
}

const STONE = 0x9a958c, DSTONE = 0x5f5b55, WOOD = 0x7a5230, DWOOD = 0x4a321e, GOLD = 0xe8c050, LEAF = 0x3f8f3a, METAL = 0x8a9099;

export interface Animated { anim?: (t: number, dt: number) => void }

// ------------------------------------------------------------------ towers

export interface TowerModel extends THREE.Group { userData: { muzzle: THREE.Vector3; turret?: THREE.Object3D; anim?: (t: number) => void; pickId?: string } }

export function createTowerModel(def: TowerDef, level: number, owner: number): TowerModel {
  const g = new THREE.Group() as TowerModel;
  const c = def.color;
  const team = mat(owner, { glow: 0.25 });
  const spin: { o: THREE.Object3D; speed: number; axis?: 'x' | 'y' | 'z' }[] = [];
  const bob: { o: THREE.Object3D; base: number; amp: number; speed: number }[] = [];
  let muzzleY = 2;
  let turret: THREE.Object3D | undefined;

  // Foundation with team colour trim (like WC3 team colours).
  g.add(P('box', mat(DSTONE), [1.75, 0.25, 1.75], [0, 0.125, 0]));
  g.add(P('box', team, [1.9, 0.12, 1.9], [0, 0.16, 0]));

  const add = (...m: THREE.Object3D[]) => m.forEach((x) => g.add(x));

  switch (def.shape) {
    case 'watchtower': {
      add(P('cylT', mat(STONE), [0.55, 2.2, 0.55], [0, 1.4, 0]),
        P('box', mat(WOOD), [1.2, 0.15, 1.2], [0, 2.55, 0]),
        P('pyr', mat(0x3b5fa0), [0.95, 0.9, 0.95], [0, 3.1, 0], [0, Math.PI / 4, 0]),
        P('cyl', mat(DWOOD), [0.03, 0.9, 0.03], [0, 3.8, 0]), P('box', team, [0.45, 0.28, 0.02], [0.24, 4.05, 0]));
      for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) add(P('box', mat(WOOD), [0.1, 0.5, 0.1], [x, 2.85, z]));
      muzzleY = 2.8; break;
    }
    case 'cannon': {
      add(P('cyl', mat(STONE), [0.75, 1.2, 0.75], [0, 0.9, 0]));
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; add(P('box', mat(STONE), [0.25, 0.3, 0.25], [Math.cos(a) * 0.65, 1.6, Math.sin(a) * 0.65])); }
      const tur = new THREE.Group(); tur.position.y = 1.6;
      tur.add(P('cyl', mat(0x2a2a2a, { metal: 0.6, rough: 0.4 }), [0.18, 1.2, 0.18], [0, 0.15, 0.35], [Math.PI / 2 - 0.3, 0, 0]));
      tur.add(P('sph', mat(0x333333, { metal: 0.5 }), [0.3, 0.3, 0.3], [0, 0, 0]));
      add(tur); turret = tur; muzzleY = 1.9; break;
    }
    case 'arcane': {
      add(P('cylT', mat(0xb8b0d0), [0.4, 2.4, 0.4], [0, 1.4, 0]),
        P('cone', mat(0x5a3fbf), [0.5, 0.8, 0.5], [0, 2.9, 0]));
      const orb = P('oct', mat(c, { glow: 1.2 }), [0.35, 0.45, 0.35], [0, 3.7, 0], [0, 0, 0], false);
      add(orb); spin.push({ o: orb, speed: 1.5 }); bob.push({ o: orb, base: 3.7, amp: 0.15, speed: 2 });
      muzzleY = 3.7; break;
    }
    case 'church': {
      add(P('box', mat(c), [1.2, 1.1, 1.4], [0, 0.85, 0]),
        P('pyr', mat(0x3b6fd6), [0.95, 0.7, 1.05], [0, 1.75, 0], [0, Math.PI / 4, 0]),
        P('box', mat(c), [0.45, 1.6, 0.45], [0, 1.6, -0.45]),
        P('cone', mat(GOLD, { metal: 0.6, rough: 0.3 }), [0.3, 0.8, 0.3], [0, 2.8, -0.45]));
      const halo = P('torus', mat(0xfff2a0, { glow: 1, opacity: 0.6 }), [0.9, 0.9, 0.9], [0, 0.4, 0], [Math.PI / 2, 0, 0], false);
      add(halo); spin.push({ o: halo, speed: 0.6, axis: 'z' });
      muzzleY = 2.5; break;
    }
    case 'gryphon': {
      add(P('cylT', mat(STONE), [0.6, 1.6, 0.6], [0, 1.1, 0]),
        P('torus', mat(DWOOD), [0.55, 0.55, 0.9], [0, 2.0, 0], [Math.PI / 2, 0, 0]));
      const bird = new THREE.Group(); bird.position.y = 2.35;
      bird.add(P('sph', mat(GOLD), [0.3, 0.25, 0.45]), P('sph', mat(0xffffff), [0.15, 0.15, 0.15], [0, 0.2, 0.35]),
        P('box', mat(0xd9b860), [1.2, 0.05, 0.35], [0, 0.1, 0], [0, 0, 0.2]));
      add(bird); turret = bird; bob.push({ o: bird, base: 2.35, amp: 0.08, speed: 3 });
      muzzleY = 2.4; break;
    }
    case 'mage': {
      add(P('cylT', mat(0x9fb3d9), [0.6, 3.2, 0.6], [0, 1.9, 0]),
        P('cone', mat(0x2a4fbf), [0.75, 1.3, 0.75], [0, 4.1, 0]));
      const orb = P('sph', mat(c, { glow: 1.5 }), [0.35, 0.35, 0.35], [0, 5.1, 0], [0, 0, 0], false);
      const r1 = P('torus', mat(GOLD, { glow: 0.4 }), [0.6, 0.6, 0.6], [0, 5.1, 0], [Math.PI / 2, 0, 0], false);
      const r2 = P('torus', mat(GOLD, { glow: 0.4 }), [0.5, 0.5, 0.5], [0, 5.1, 0], [0, 0, 0], false);
      add(orb, r1, r2); spin.push({ o: r1, speed: 1.2, axis: 'x' }, { o: r2, speed: -1.6, axis: 'y' });
      muzzleY = 5.1; break;
    }
    case 'spear': {
      add(P('cylT', mat(WOOD), [0.55, 1.8, 0.55], [0, 1.15, 0]),
        P('box', mat(DWOOD), [1.2, 0.15, 1.2], [0, 2.1, 0]));
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; add(P('cone', mat(0xe0d6c0), [0.08, 0.6, 0.08], [Math.cos(a) * 0.7, 1.2, Math.sin(a) * 0.7], [Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8])); }
      add(P('cone', mat(0xc0392b), [0.6, 0.7, 0.6], [0, 2.55, 0]));
      muzzleY = 2.3; break;
    }
    case 'catapult': {
      add(P('box', mat(WOOD), [1.2, 0.3, 1.4], [0, 0.45, 0]));
      for (const x of [-0.7, 0.7]) for (const z of [-0.5, 0.5]) add(P('cyl', mat(DWOOD), [0.25, 0.12, 0.25], [x, 0.4, z], [0, 0, Math.PI / 2]));
      const arm = new THREE.Group(); arm.position.y = 0.9;
      arm.add(P('box', mat(WOOD), [0.15, 0.15, 1.6], [0, 0.3, -0.2], [0.5, 0, 0]), P('sph', mat(DWOOD), [0.25, 0.15, 0.25], [0, 0.7, -0.8]));
      add(arm, P('box', mat(DWOOD), [0.15, 0.9, 0.15], [-0.4, 0.9, 0]), P('box', mat(DWOOD), [0.15, 0.9, 0.15], [0.4, 0.9, 0]));
      turret = arm; muzzleY = 1.6; break;
    }
    case 'drum': {
      add(P('cyl', mat(0x8b4513), [0.7, 0.8, 0.7], [0, 0.75, 0]), P('cyl', mat(0xd9c39a), [0.72, 0.05, 0.72], [0, 1.17, 0]));
      for (const x of [-0.75, 0.75]) {
        add(P('box', mat(DWOOD), [0.1, 2.2, 0.1], [x, 1.3, 0.6]), P('box', mat(0xc0392b), [0.5, 0.6, 0.03], [x + (x < 0 ? 0.25 : -0.25), 2.1, 0.6]));
      }
      const pulse = P('torus', mat(0xff6040, { glow: 1, opacity: 0.5 }), [1, 1, 1], [0, 0.35, 0], [Math.PI / 2, 0, 0], false);
      add(pulse); bob.push({ o: pulse, base: 0.35, amp: 0.05, speed: 6 });
      muzzleY = 1.3; break;
    }
    case 'shaman': {
      add(P('cone', mat(0x8b5a2b), [0.85, 1.4, 0.85], [0, 1.0, 0]), P('cyl', mat(DWOOD), [0.12, 2.4, 0.12], [0.6, 1.4, 0.4]));
      add(P('box', mat(0xc0392b), [0.3, 0.3, 0.3], [0.6, 2.3, 0.4]));
      const orb = P('ico', mat(c, { glow: 1.4 }), [0.25, 0.25, 0.25], [0, 2.2, 0], [0, 0, 0], false);
      add(orb); bob.push({ o: orb, base: 2.2, amp: 0.15, speed: 2.5 }); spin.push({ o: orb, speed: 2 });
      muzzleY = 2.2; break;
    }
    case 'wyvern': {
      add(P('cylT', mat(WOOD), [0.4, 2.4, 0.4], [0, 1.45, 0]), P('box', mat(DWOOD), [1.1, 0.12, 1.1], [0, 2.6, 0]));
      const w = new THREE.Group(); w.position.y = 2.9;
      w.add(P('sph', mat(c), [0.25, 0.22, 0.5]), P('box', mat(0x6b2a20), [1.3, 0.04, 0.4], [0, 0.1, 0]), P('cone', mat(c), [0.1, 0.4, 0.1], [0, 0.05, 0.55], [Math.PI / 2, 0, 0]));
      add(w); turret = w; bob.push({ o: w, base: 2.9, amp: 0.1, speed: 3 });
      muzzleY = 2.9; break;
    }
    case 'fortress': {
      add(P('box', mat(c), [1.6, 1.4, 1.6], [0, 1.0, 0]));
      for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
        add(P('cyl', mat(0x3a1a10), [0.3, 2.2, 0.3], [x, 1.3, z]), P('cone', mat(0xd0c0a0), [0.15, 0.6, 0.15], [x, 2.7, z]));
      }
      const core = P('ico', mat(0xff3300, { glow: 1.5 }), [0.4, 0.4, 0.4], [0, 2.1, 0], [0, 0, 0], false);
      add(core); spin.push({ o: core, speed: 1 });
      muzzleY = 2; break;
    }
    case 'ziggurat': {
      for (let i = 0; i < 3; i++) add(P('pyr', mat(i % 2 ? 0x4a3f63 : c), [1.1 - i * 0.25, 0.7, 1.1 - i * 0.25], [0, 0.6 + i * 0.6, 0], [0, Math.PI / 4, 0]));
      const orb = P('sph', mat(0x7fff7f, { glow: 1.3 }), [0.25, 0.25, 0.25], [0, 2.6, 0], [0, 0, 0], false);
      add(orb); bob.push({ o: orb, base: 2.6, amp: 0.15, speed: 2 });
      muzzleY = 2.6; break;
    }
    case 'plague': {
      add(P('cyl', mat(0x3a3a3a, { metal: 0.4 }), [0.7, 0.8, 0.7], [0, 0.75, 0]),
        P('cyl', mat(c, { glow: 0.9 }), [0.62, 0.05, 0.62], [0, 1.16, 0]));
      for (let i = 0; i < 3; i++) {
        const b = P('sph', mat(c, { glow: 0.8, opacity: 0.7 }), [0.15, 0.15, 0.15], [Math.cos(i * 2) * 0.3, 1.3, Math.sin(i * 2) * 0.3], [0, 0, 0], false);
        add(b); bob.push({ o: b, base: 1.3 + i * 0.2, amp: 0.3, speed: 1.5 + i });
      }
      muzzleY = 1.4; break;
    }
    case 'frost': {
      add(P('cylT', mat(0xd0e8f0), [0.45, 1.2, 0.45], [0, 0.85, 0]));
      const crystal = P('oct', mat(c, { glow: 0.6, opacity: 0.85, rough: 0.2 }), [0.4, 1.0, 0.4], [0, 2.3, 0], [0, 0, 0], true);
      add(crystal); spin.push({ o: crystal, speed: 0.7 });
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; add(P('oct', mat(c, { opacity: 0.8, rough: 0.2 }), [0.15, 0.45, 0.15], [Math.cos(a) * 0.55, 0.6, Math.sin(a) * 0.55], [Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4])); }
      muzzleY = 2.3; break;
    }
    case 'wagon': {
      add(P('box', mat(c), [1.0, 0.5, 1.4], [0, 0.7, 0]));
      for (const x of [-0.6, 0.6]) for (const z of [-0.45, 0.45]) add(P('cyl', mat(0x3a2a1a), [0.3, 0.1, 0.3], [x, 0.45, z], [0, 0, Math.PI / 2]));
      const arm = new THREE.Group(); arm.position.y = 1.0;
      arm.add(P('box', mat(0xd8d0c0), [0.12, 0.12, 1.3], [0, 0.3, -0.1], [0.5, 0, 0]), P('sph', mat(0x8a3030), [0.22, 0.18, 0.22], [0, 0.6, -0.6]));
      add(arm); turret = arm; muzzleY = 1.6; break;
    }
    case 'obelisk': {
      add(P('pyr', mat(c, { rough: 0.3, metal: 0.3 }), [0.55, 3.2, 0.55], [0, 1.85, 0], [0, Math.PI / 4, 0]));
      for (let i = 0; i < 3; i++) add(P('box', mat(0xa040ff, { glow: 1.2 }), [0.62 - i * 0.12, 0.05, 0.62 - i * 0.12], [0, 0.8 + i * 0.6, 0], [0, Math.PI / 4, 0], false));
      muzzleY = 3; break;
    }
    case 'throne': {
      add(P('box', mat(0xa8d8f0, { rough: 0.3 }), [1.3, 0.6, 1.1], [0, 0.55, 0]), P('box', mat(0xa8d8f0, { rough: 0.3 }), [1.3, 2.0, 0.3], [0, 1.6, -0.45]));
      for (let i = -2; i <= 2; i++) add(P('oct', mat(c, { glow: 0.5, opacity: 0.85 }), [0.14, 0.6 + (2 - Math.abs(i)) * 0.25, 0.14], [i * 0.28, 2.8 + (2 - Math.abs(i)) * 0.1, -0.45]));
      const orb = P('ico', mat(c, { glow: 1.5 }), [0.3, 0.3, 0.3], [0, 1.4, 0.2], [0, 0, 0], false);
      add(orb); spin.push({ o: orb, speed: 1.5 }); bob.push({ o: orb, base: 1.4, amp: 0.15, speed: 2 });
      muzzleY = 1.6; break;
    }
    case 'ancient': {
      add(P('cylT', mat(0x5a3d22), [0.45, 1.8, 0.45], [0, 1.1, 0]));
      add(P('ico', mat(LEAF), [0.9, 0.7, 0.9], [0, 2.3, 0]), P('ico', mat(0x5aa84a), [0.6, 0.5, 0.6], [0.2, 2.9, 0.1]));
      add(P('sph', mat(0xffe080, { glow: 1 }), [0.07, 0.07, 0.07], [-0.15, 1.6, 0.42], [0, 0, 0], false), P('sph', mat(0xffe080, { glow: 1 }), [0.07, 0.07, 0.07], [0.15, 1.6, 0.42], [0, 0, 0], false));
      muzzleY = 2.2; break;
    }
    case 'moonwell': {
      add(P('cyl', mat(0xd0d0e0), [0.8, 0.5, 0.8], [0, 0.55, 0]), P('cyl', mat(c, { glow: 1, opacity: 0.85 }), [0.65, 0.05, 0.65], [0, 0.82, 0], [0, 0, 0], false));
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; add(P('box', mat(0xd0d0e0), [0.15, 1.3, 0.15], [Math.cos(a) * 0.75, 1.1, Math.sin(a) * 0.75])); }
      const moon = P('sph', mat(0xeef6ff, { glow: 1 }), [0.2, 0.2, 0.2], [0, 1.8, 0], [0, 0, 0], false);
      add(moon); bob.push({ o: moon, base: 1.8, amp: 0.15, speed: 1.5 });
      muzzleY = 1.8; break;
    }
    case 'vines': {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(P('cone', mat(i % 2 ? c : 0x1b5e20), [0.18, 1.6 + (i % 3) * 0.3, 0.18], [Math.cos(a) * 0.35, 1.0, Math.sin(a) * 0.35], [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3]));
      }
      add(P('ico', mat(0xe04060, { glow: 0.5 }), [0.25, 0.25, 0.25], [0, 1.5, 0]));
      muzzleY = 1.5; break;
    }
    case 'dryad': {
      for (const [x, z, s] of [[-0.4, -0.3, 1], [0.45, -0.2, 0.8], [0, 0.45, 0.9]]) {
        add(P('cyl', mat(0x6a4a2a), [0.1, 1.0 * s, 0.1], [x, 0.75 * s, z]), P('ico', mat(c), [0.4 * s, 0.5 * s, 0.4 * s], [x, 1.4 * s, z]));
      }
      muzzleY = 1.5; break;
    }
    case 'nest': {
      add(P('cylT', mat(0x5a3d22), [0.5, 2.0, 0.5], [0, 1.2, 0]), P('torus', mat(0x8a6a3a), [0.6, 0.6, 1.2], [0, 2.3, 0], [Math.PI / 2, 0, 0]));
      const bird = new THREE.Group(); bird.position.y = 2.6;
      bird.add(P('sph', mat(c), [0.25, 0.22, 0.4]), P('box', mat(0xc0b0e0), [1.0, 0.04, 0.3], [0, 0.1, 0]));
      add(bird); turret = bird; bob.push({ o: bird, base: 2.6, amp: 0.1, speed: 2.5 });
      muzzleY = 2.6; break;
    }
    case 'worldtree': {
      add(P('cylT', mat(0x5a3d22), [0.5, 3.6, 0.5], [0, 2, 0]));
      for (let i = 0; i < 3; i++) add(P('ico', mat(i === 1 ? 0x2ecc71 : LEAF), [1.1 - i * 0.25, 0.7, 1.1 - i * 0.25], [0, 3.4 + i * 0.6, 0]));
      const glow = P('sph', mat(0xb0ffb0, { glow: 1.2, opacity: 0.5 }), [0.3, 0.3, 0.3], [0, 4.2, 0.9], [0, 0, 0], false);
      add(glow); bob.push({ o: glow, base: 4.2, amp: 0.2, speed: 1.2 });
      muzzleY = 4; break;
    }
    case 'fire': case 'water': case 'air': {
      add(P('cylT', mat(0xb0a898), [0.4, 1.6, 0.4], [0, 1.05, 0]), P('cyl', mat(0x8a8070), [0.6, 0.2, 0.6], [0, 1.9, 0]));
      if (def.shape === 'fire') {
        const f1 = P('cone', mat(0xff5722, { glow: 1.5 }), [0.4, 0.9, 0.4], [0, 2.4, 0], [0, 0, 0], false);
        const f2 = P('cone', mat(0xffc107, { glow: 1.5 }), [0.22, 0.6, 0.22], [0, 2.35, 0], [0, 0, 0], false);
        add(f1, f2); bob.push({ o: f1, base: 2.4, amp: 0.06, speed: 9 }); spin.push({ o: f1, speed: 3 });
      } else if (def.shape === 'water') {
        const orb = P('sph', mat(c, { glow: 0.4, opacity: 0.75, rough: 0.1 }), [0.45, 0.45, 0.45], [0, 2.5, 0], [0, 0, 0], false);
        add(orb); bob.push({ o: orb, base: 2.5, amp: 0.12, speed: 2 });
      } else {
        for (let i = 0; i < 3; i++) {
          const r = P('torus', mat(0xffffff, { opacity: 0.7, glow: 0.3 }), [0.5 - i * 0.1, 0.5 - i * 0.1, 0.5 - i * 0.1], [0, 2.2 + i * 0.3, 0], [Math.PI / 2, 0, 0], false);
          add(r); spin.push({ o: r, speed: 2 + i, axis: 'z' });
        }
      }
      muzzleY = 2.4; break;
    }
    case 'earth': {
      add(P('dod', mat(0x8d6e63), [0.75, 0.6, 0.75], [0, 0.75, 0]), P('dod', mat(0x6d4c41), [0.5, 0.55, 0.5], [0.3, 1.5, -0.1]), P('dod', mat(0xa1887f), [0.35, 0.4, 0.35], [-0.25, 2.0, 0.15]));
      muzzleY = 2; break;
    }
    case 'magma': {
      add(P('cone', mat(0x3a2a2a), [0.95, 1.8, 0.95], [0, 1.15, 0]), P('cyl', mat(0xff6d00, { glow: 1.6 }), [0.3, 0.1, 0.3], [0, 2.0, 0], [0, 0, 0], false));
      const lava = P('sph', mat(0xff3d00, { glow: 1.5 }), [0.2, 0.2, 0.2], [0, 2.3, 0], [0, 0, 0], false);
      add(lava); bob.push({ o: lava, base: 2.3, amp: 0.2, speed: 3 });
      muzzleY = 2.2; break;
    }
    case 'vortex': {
      add(P('cylT', mat(0x605870), [0.5, 1.2, 0.5], [0, 0.85, 0]));
      const core = P('oct', mat(0xffffff, { glow: 1.5 }), [0.3, 0.5, 0.3], [0, 2.4, 0], [0, 0, 0], false);
      add(core); spin.push({ o: core, speed: 2 });
      const orbit = new THREE.Group(); orbit.position.y = 2.4;
      [0xff5722, 0x2196f3, 0x8d6e63, 0xb2ebf2].forEach((col, i) => {
        const a = (i / 4) * Math.PI * 2;
        orbit.add(P('sph', mat(col, { glow: 1.2 }), [0.17, 0.17, 0.17], [Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8], [0, 0, 0], false));
      });
      add(orbit); spin.push({ o: orbit, speed: 1.6 });
      muzzleY = 2.4; break;
    }
    case 'gun': {
      add(P('box', mat(METAL, { metal: 0.5, rough: 0.5 }), [1.1, 0.8, 1.1], [0, 0.65, 0]));
      const tur = new THREE.Group(); tur.position.y = 1.25;
      tur.add(P('box', mat(0x5a5a5a, { metal: 0.6 }), [0.6, 0.4, 0.6]));
      for (const x of [-0.12, 0.12]) tur.add(P('cyl', mat(0x222222, { metal: 0.8 }), [0.07, 0.9, 0.07], [x, 0, 0.6], [Math.PI / 2, 0, 0]));
      add(tur); turret = tur; muzzleY = 1.3; break;
    }
    case 'rocket': {
      add(P('cyl', mat(METAL, { metal: 0.5 }), [0.6, 0.9, 0.6], [0, 0.7, 0]));
      const tur = new THREE.Group(); tur.position.y = 1.4;
      tur.add(P('box', mat(0x555555), [0.9, 0.5, 0.7], [0, 0, 0], [-0.4, 0, 0]));
      for (const x of [-0.25, 0.25]) for (const y of [-0.1, 0.12]) tur.add(P('cone', mat(c), [0.08, 0.35, 0.08], [x, y + 0.15, 0.45], [Math.PI / 2 - 0.4, 0, 0]));
      add(tur); turret = tur; muzzleY = 1.6; break;
    }
    case 'tesla': {
      add(P('cyl', mat(0x606a70, { metal: 0.6 }), [0.15, 2.2, 0.15], [0, 1.3, 0]));
      for (let i = 0; i < 4; i++) add(P('torus', mat(0xb87333, { metal: 0.8, rough: 0.3 }), [0.45 - i * 0.07, 0.45 - i * 0.07, 0.9], [0, 0.7 + i * 0.4, 0], [Math.PI / 2, 0, 0]));
      const ball = P('sph', mat(c, { glow: 1.6 }), [0.3, 0.3, 0.3], [0, 2.5, 0], [0, 0, 0], false);
      add(ball); bob.push({ o: ball, base: 2.5, amp: 0.04, speed: 12 });
      muzzleY = 2.5; break;
    }
    case 'mines': {
      add(P('box', mat(0x795548), [1.3, 0.9, 1.1], [0, 0.7, 0]), P('pyr', mat(0x5d4037), [1.0, 0.5, 0.85], [0, 1.4, 0], [0, Math.PI / 4, 0]),
        P('cyl', mat(0x444444), [0.12, 0.8, 0.12], [0.4, 1.6, 0.3]));
      for (const x of [-0.5, -0.2]) add(P('cyl', mat(0xb71c1c), [0.15, 0.35, 0.15], [x, 0.45, 0.65]));
      muzzleY = 1.4; break;
    }
    case 'bank': {
      add(P('box', mat(0xefe0b0), [1.4, 1.0, 1.2], [0, 0.75, 0]), P('pyr', mat(GOLD, { metal: 0.6, rough: 0.3 }), [1.1, 0.6, 0.95], [0, 1.55, 0], [0, Math.PI / 4, 0]));
      for (const x of [-0.5, 0, 0.5]) add(P('cyl', mat(0xffffff), [0.08, 0.9, 0.08], [x, 0.7, 0.65]));
      const coin = P('cyl', mat(GOLD, { glow: 0.6, metal: 0.8, rough: 0.2 }), [0.35, 0.06, 0.35], [0, 2.3, 0], [Math.PI / 2, 0, 0], false);
      add(coin); spin.push({ o: coin, speed: 2, axis: 'z' }); bob.push({ o: coin, base: 2.3, amp: 0.1, speed: 2 });
      muzzleY = 2; break;
    }
    case 'block': {
      // Maze wall: chunky blocks in the class colour with a snow cap.
      add(P('box', mat(c), [1.7, 0.9, 1.7], [0, 0.65, 0]),
        P('box', mat(c), [1.3, 0.5, 1.3], [0.1, 1.3, -0.05], [0, 0.3, 0]),
        P('box', mat(0xf4f8ff), [1.35, 0.12, 1.35], [0.1, 1.6, -0.05], [0, 0.3, 0]));
      muzzleY = 1.2; break;
    }
    case 'zeppelin': {
      add(P('cyl', mat(METAL, { metal: 0.5 }), [0.2, 2.6, 0.2], [0, 1.5, 0]), P('box', mat(0x5d4037), [1.2, 0.2, 1.2], [0, 0.4, 0]));
      const zep = new THREE.Group(); zep.position.y = 3.3;
      zep.add(P('sph', mat(c), [0.5, 0.45, 1.1]), P('box', mat(0x5d4037), [0.3, 0.2, 0.5], [0, -0.5, 0]), P('box', mat(c), [0.05, 0.4, 0.3], [0, 0.1, -1.0]));
      add(zep); turret = zep; bob.push({ o: zep, base: 3.3, amp: 0.15, speed: 1.2 });
      muzzleY = 2.9; break;
    }
  }

  // Level decorations.
  if (level >= 1) g.add(P('torus', mat(GOLD, { metal: 0.7, rough: 0.3 }), [0.95, 0.95, 0.6], [0, 0.32, 0], [Math.PI / 2, 0, 0], false));
  if (level >= 2) {
    const crown = P('oct', mat(GOLD, { glow: 1 }), [0.12, 0.2, 0.12], [0, muzzleY + 0.9, 0], [0, 0, 0], false);
    g.add(crown);
    spin.push({ o: crown, speed: 2 });
    bob.push({ o: crown, base: muzzleY + 0.9, amp: 0.1, speed: 2 });
  }
  const sc = 1 + level * 0.1;
  bakeStatic(g, new Set([...spin.map((s) => s.o), ...bob.map((b) => b.o)]), `t|${def.id}|${level}|${owner}`);
  g.scale.setScalar(sc);
  g.userData.muzzle = new THREE.Vector3(0, muzzleY * sc, 0);
  g.userData.turret = turret;
  g.userData.anim = (t: number) => {
    for (const s of spin) s.o.rotation[s.axis ?? 'y'] = t * s.speed;
    for (const b of bob) b.o.position.y = b.base + Math.sin(t * b.speed) * b.amp;
  };
  return g;
}

// ------------------------------------------------------------------ enemies

export interface EnemyModel extends THREE.Group { userData: { anim: (t: number) => void; height: number; body: THREE.Object3D } }

export function createEnemyModel(def: EnemyDef, ghost = false): EnemyModel {
  const g = new THREE.Group() as EnemyModel;
  const body = new THREE.Group();
  g.add(body);
  const gh = ghost ? { opacity: 0.3 } : {};
  const c1 = mat(def.color, gh), c2 = mat(def.color2, gh);
  const eye = mat(def.boss ? 0xff2020 : 0xffee88, { glow: 1.5 });
  const legs: THREE.Object3D[] = [];
  const wings: THREE.Object3D[] = [];
  let height = 1.2;
  const add = (...m: THREE.Object3D[]) => m.forEach((x) => body.add(x));

  switch (def.shape) {
    case 'biped': case 'demon': {
      const big = def.shape === 'demon';
      add(P('sph', c1, [0.32, 0.42, 0.25], [0, 0.85, 0]), P('sph', c2, [0.2, 0.2, 0.2], [0, 1.38, 0.03]),
        P('sph', eye, [0.04, 0.04, 0.04], [-0.07, 1.42, 0.18], [0, 0, 0], false), P('sph', eye, [0.04, 0.04, 0.04], [0.07, 1.42, 0.18], [0, 0, 0], false));
      for (const x of [-0.38, 0.38]) add(P('box', c1, [0.12, 0.5, 0.12], [x, 0.9, 0], [0, 0, x > 0 ? 0.3 : -0.3]));
      for (const x of [-0.13, 0.13]) { const l = P('box', c2, [0.13, 0.5, 0.13], [x, 0.3, 0]); add(l); legs.push(l); }
      if (big) {
        for (const x of [-0.12, 0.12]) add(P('cone', mat(0x222222), [0.05, 0.3, 0.05], [x, 1.6, 0], [0, 0, x > 0 ? -0.5 : 0.5]));
        for (const x of [-1, 1]) { const w = P('box', mat(def.color2, { ...gh, side: THREE.DoubleSide }), [0.9, 0.04, 0.5], [x * 0.5, 1.1, -0.25], [0, 0, x * 0.3]); add(w); wings.push(w); }
      }
      height = 1.7; break;
    }
    case 'beast': {
      add(P('sph', c1, [0.25, 0.25, 0.5], [0, 0.6, 0]), P('sph', c1, [0.18, 0.18, 0.24], [0, 0.78, 0.5]),
        P('sph', eye, [0.035, 0.035, 0.035], [-0.08, 0.84, 0.7], [0, 0, 0], false), P('sph', eye, [0.035, 0.035, 0.035], [0.08, 0.84, 0.7], [0, 0, 0], false),
        P('cone', c2, [0.05, 0.4, 0.05], [0, 0.65, -0.55], [-1.1, 0, 0]));
      for (const x of [-0.15, 0.15]) for (const z of [-0.3, 0.3]) { const l = P('box', c2, [0.08, 0.4, 0.08], [x, 0.25, z]); add(l); legs.push(l); }
      height = 1.1; break;
    }
    case 'spider': {
      add(P('sph', c1, [0.4, 0.3, 0.5], [0, 0.5, -0.2]), P('sph', c2, [0.22, 0.2, 0.22], [0, 0.45, 0.35]),
        P('sph', eye, [0.04, 0.04, 0.04], [-0.07, 0.52, 0.55], [0, 0, 0], false), P('sph', eye, [0.04, 0.04, 0.04], [0.07, 0.52, 0.55], [0, 0, 0], false));
      for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
        const l = P('box', c1, [0.6, 0.05, 0.05], [s * 0.4, 0.35, 0.3 - i * 0.2], [0, (i - 1.5) * 0.3 * s, -s * 0.5]); add(l); legs.push(l);
      }
      height = 0.9; break;
    }
    case 'flyer': case 'dragon': {
      const dragon = def.shape === 'dragon';
      add(P('sph', c1, [0.25, 0.22, dragon ? 0.6 : 0.3], [0, 0, 0]), P('sph', c1, [0.15, 0.15, 0.18], [0, 0.1, dragon ? 0.65 : 0.3]),
        P('sph', eye, [0.03, 0.03, 0.03], [-0.06, 0.15, dragon ? 0.8 : 0.45], [0, 0, 0], false), P('sph', eye, [0.03, 0.03, 0.03], [0.06, 0.15, dragon ? 0.8 : 0.45], [0, 0, 0], false));
      if (dragon) add(P('cone', c1, [0.1, 0.8, 0.1], [0, 0, -0.9], [-Math.PI / 2, 0, 0]));
      for (const s of [-1, 1]) {
        const pivot = new THREE.Group(); pivot.position.set(s * 0.15, 0.05, 0);
        pivot.add(P('box', mat(def.color2, { ...gh, side: THREE.DoubleSide }), [dragon ? 1.1 : 0.7, 0.03, dragon ? 0.6 : 0.4], [s * (dragon ? 0.55 : 0.35), 0, 0]));
        add(pivot); wings.push(pivot);
      }
      body.position.y = 2.2;
      height = 2.6; break;
    }
    case 'golem': {
      add(P('dod', c1, [0.45, 0.5, 0.35], [0, 1.0, 0]), P('dod', c2, [0.22, 0.22, 0.22], [0, 1.6, 0.05]),
        P('sph', eye, [0.04, 0.04, 0.04], [-0.08, 1.64, 0.2], [0, 0, 0], false), P('sph', eye, [0.04, 0.04, 0.04], [0.08, 1.64, 0.2], [0, 0, 0], false));
      for (const x of [-0.55, 0.55]) add(P('dod', c2, [0.2, 0.35, 0.2], [x, 0.9, 0.05]));
      for (const x of [-0.2, 0.2]) { const l = P('box', c2, [0.2, 0.55, 0.2], [x, 0.3, 0]); add(l); legs.push(l); }
      height = 1.9; break;
    }
    case 'blob': {
      add(P('sph', mat(def.color, { opacity: 0.8, glow: 0.2, rough: 0.2 }), [0.45, 0.35, 0.45], [0, 0.35, 0]), P('sph', mat(def.color2), [0.15, 0.15, 0.15], [0, 0.35, 0]),
        P('sph', eye, [0.05, 0.05, 0.05], [-0.12, 0.5, 0.38], [0, 0, 0], false), P('sph', eye, [0.05, 0.05, 0.05], [0.12, 0.5, 0.38], [0, 0, 0], false));
      height = 0.9; break;
    }
    case 'fish': {
      add(P('sph', c1, [0.3, 0.38, 0.28], [0, 0.6, 0]), P('sph', c1, [0.22, 0.2, 0.22], [0, 1.0, 0.08]),
        P('cone', c2, [0.05, 0.4, 0.2], [0, 1.15, -0.1], [0.3, 0, 0]),
        P('sph', eye, [0.05, 0.05, 0.05], [-0.1, 1.05, 0.25], [0, 0, 0], false), P('sph', eye, [0.05, 0.05, 0.05], [0.1, 1.05, 0.25], [0, 0, 0], false));
      for (const x of [-0.12, 0.12]) { const l = P('box', c2, [0.1, 0.35, 0.1], [x, 0.2, 0]); add(l); legs.push(l); }
      height = 1.3; break;
    }
  }
  if (def.boss) {
    const aura = P('torus', mat(0xff3030, { glow: 1, opacity: 0.6 }), [0.7, 0.7, 0.7], [0, 0.05, 0], [Math.PI / 2, 0, 0], false);
    g.add(aura);
  }
  bakeStatic(body, new Set([...legs, ...wings]), `e|${def.id}|${ghost}`);
  const S = def.scale * 1.6;
  g.scale.setScalar(S);
  const phase = Math.random() * 10;
  const baseY = body.position.y;
  g.userData = {
    height: height * S,
    body,
    anim: (t: number) => {
      const tt = t + phase;
      legs.forEach((l, i) => { l.rotation.x = Math.sin(tt * 10 + i * Math.PI) * 0.5; });
      wings.forEach((w, i) => { w.rotation.z = Math.sin(tt * 8) * 0.5 * (i % 2 ? -1 : 1); });
      body.position.y = baseY + Math.abs(Math.sin(tt * 10)) * 0.05 + (wings.length && baseY > 0 ? Math.sin(tt * 2) * 0.15 : 0);
    },
  };
  return g;
}

// ------------------------------------------------------------------ misc props

export function createTree(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const h = 1.5 + rand() * 1.5;
  g.add(P('cyl', mat(0x4a3322), [0.15, h * 0.5, 0.15], [0, h * 0.25, 0]));
  // Snowy pines (Wintermaul).
  for (let i = 0; i < 3; i++) {
    const w = 0.9 - i * 0.22, y = h * 0.5 + i * h * 0.25;
    g.add(P('cone', mat(i % 2 ? 0x1f4a33 : 0x285a3c), [w, h * 0.5, w], [0, y, 0]));
    g.add(P('cone', mat(0xf2f6fb), [w * 0.62, h * 0.2, w * 0.62], [0, y + h * 0.17, 0]));
  }
  g.rotation.y = rand() * Math.PI;
  const s = 0.8 + rand() * 0.6;
  g.scale.setScalar(s);
  return g;
}

export function createRock(rand: () => number): THREE.Mesh {
  const s = 0.3 + rand() * 0.6;
  return P('dod', mat(rand() > 0.5 ? 0x8a93a0 : 0x6f7884), [s, s * 0.7, s], [0, s * 0.3, 0], [rand(), rand(), rand()]);
}

/** Ice cliff chunk filling one blocked cell. */
export function createIceCliff(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const h = 1.6 + rand() * 1.8;
  g.add(P('dod', mat(rand() > 0.5 ? 0xbcd6ea : 0xa6c4dc, { rough: 0.35 }), [1.25, h, 1.25], [0, h * 0.35, 0], [rand(), rand() * 3, rand() * 0.3]));
  g.add(P('dod', mat(0xf4f8ff, { rough: 0.6 }), [0.95, 0.4, 0.95], [0, h * 0.95, 0], [0, rand() * 3, 0]));
  return g;
}

export function createPortal(): THREE.Group {
  const g = new THREE.Group();
  g.add(P('torus', mat(0x9b30ff, { glow: 1.5 }), [1.4, 1.4, 1.4], [0, 1.5, 0], [0, Math.PI / 2, 0], false));
  const inner = P('sph', mat(0x6020c0, { glow: 1.0, opacity: 0.6 }), [0.1, 1.3, 1.3], [0, 1.5, 0], [0, 0, 0], false);
  g.add(inner);
  for (const z of [-1.6, 1.6]) g.add(P('box', mat(0x333040), [0.4, 3, 0.4], [0, 1.5, z]));
  g.userData.anim = (t: number) => { inner.rotation.x = t; inner.scale.y = 1.3 + Math.sin(t * 3) * 0.1; };
  return g;
}

export function createBase(): THREE.Group {
  const g = new THREE.Group();
  g.add(P('box', mat(STONE), [3, 2, 3], [0, 1, 0]));
  for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) {
    g.add(P('cyl', mat(STONE), [0.6, 3.5, 0.6], [x, 1.75, z]), P('cone', mat(0x2a5fbf), [0.75, 1.2, 0.75], [x, 4.1, z]));
  }
  g.add(P('box', mat(DSTONE), [1, 1.4, 0.2], [1.55, 0.7, 0], [0, Math.PI / 2, 0]));
  g.add(P('cyl', mat(0x8a8a8a), [0.05, 2, 0.05], [0, 3, 0]), P('box', mat(0xffcc00, { glow: 0.4, side: THREE.DoubleSide }), [0.9, 0.6, 0.02], [0.45, 3.6, 0]));
  return g;
}

export function createMine(): THREE.Group {
  const g = new THREE.Group();
  g.add(P('cyl', mat(0x333333, { metal: 0.6 }), [0.25, 0.1, 0.25], [0, 0.05, 0]));
  const light = P('sph', mat(0xff2020, { glow: 2 }), [0.07, 0.07, 0.07], [0, 0.13, 0], [0, 0, 0], false);
  g.add(light);
  g.userData.anim = (t: number) => { light.visible = Math.sin(t * 6) > 0; };
  return g;
}
