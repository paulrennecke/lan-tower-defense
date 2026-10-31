import * as THREE from 'three';
import type { ProjKind } from '../../../shared/data/classes';
import { CELL_SIZE } from '../../../shared/map';

interface Effect { update(dt: number): boolean; dispose(): void }

const PROJ_COLORS: Record<ProjKind, number> = {
  arrow: 0xd8c8a0, cannon: 0x222222, orb: 0xb080ff, bolt: 0xffe080, spear: 0xc8a070, rock: 0x7a6a5a,
  lightning: 0x80d0ff, poison: 0x70ff40, frost: 0xa0e0ff, skull: 0xd0ffd0, fire: 0xff7020, water: 0x40a0ff,
  wind: 0xf0ffff, bullet: 0xffe060, rocket: 0xff4020, leaf: 0x60e060, moon: 0xe0e8ff, none: 0xffffff,
};
const ARC: Partial<Record<ProjKind, number>> = { cannon: 2.5, rock: 4, skull: 3, poison: 2.5, fire: 1.5, rocket: 1.2 };
const GLOW: Partial<Record<ProjKind, boolean>> = { orb: true, bolt: true, frost: true, fire: true, water: true, moon: true, poison: true, skull: true, lightning: true, wind: true };

const sphere = new THREE.SphereGeometry(1, 8, 6);
const stick = new THREE.CylinderGeometry(0.05, 0.05, 1, 4).rotateX(Math.PI / 2);
const cone = new THREE.ConeGeometry(0.15, 0.6, 6).rotateX(Math.PI / 2);
const cube = new THREE.BoxGeometry(1, 1, 1);

const basicCache = new Map<number, THREE.MeshBasicMaterial>();
function basic(color: number) {
  let m = basicCache.get(color);
  if (!m) { m = new THREE.MeshBasicMaterial({ color }); basicCache.set(color, m); }
  return m;
}

function projectileMesh(kind: ProjKind): THREE.Mesh {
  const col = PROJ_COLORS[kind];
  const m = GLOW[kind] ? basic(col) : new THREE.MeshStandardMaterial({ color: col, flatShading: true });
  switch (kind) {
    case 'arrow': case 'spear': case 'bolt': {
      const mesh = new THREE.Mesh(stick, m);
      mesh.scale.set(kind === 'spear' ? 1.6 : 1, kind === 'spear' ? 1.6 : 1, kind === 'spear' ? 1.4 : 0.9);
      return mesh;
    }
    case 'rocket': return new THREE.Mesh(cone, m);
    case 'bullet': { const s = new THREE.Mesh(sphere, m); s.scale.setScalar(0.08); return s; }
    case 'cannon': case 'rock': { const s = new THREE.Mesh(sphere, m); s.scale.setScalar(kind === 'rock' ? 0.35 : 0.22); return s; }
    default: { const s = new THREE.Mesh(sphere, m); s.scale.setScalar(0.2); return s; }
  }
}

export class FxManager {
  private effects: Effect[] = [];
  constructor(private scene: THREE.Scene) {}

  get count() { return this.effects.length; }

  projectile(from: THREE.Vector3, target: () => THREE.Vector3 | null, flight: number, kind: ProjKind) {
    if (kind === 'none') return;
    const mesh = projectileMesh(kind);
    mesh.position.copy(from);
    this.scene.add(mesh);
    const start = from.clone();
    let last = target()?.clone() ?? from.clone();
    const arc = (ARC[kind] ?? 0) * Math.min(1, flight * 1.5);
    let t = 0;
    const prev = new THREE.Vector3();
    this.effects.push({
      update: (dt) => {
        t += dt;
        const tp = target();
        if (tp) last.copy(tp);
        const k = Math.min(1, t / Math.max(0.01, flight));
        prev.copy(mesh.position);
        mesh.position.lerpVectors(start, last, k);
        mesh.position.y += Math.sin(k * Math.PI) * arc;
        if (mesh.position.distanceToSquared(prev) > 1e-6) mesh.lookAt(mesh.position.clone().add(mesh.position.clone().sub(prev)));
        if (kind === 'rocket' && Math.random() < 0.6) this.puff(mesh.position, 0x888888, 0.15, 0.4);
        return k < 1;
      },
      dispose: () => {
        this.scene.remove(mesh);
        if (!GLOW[kind]) (mesh.material as THREE.Material).dispose();
      },
    });
  }

  lightning(points: THREE.Vector3[], color = 0x9fe0ff) {
    if (points.length < 2) return;
    const verts: number[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const segs = 6;
      let px = a.x, py = a.y, pz = a.z;
      for (let s = 1; s <= segs; s++) {
        const k = s / segs;
        const j = s === segs ? 0 : 0.35;
        const nx = a.x + (b.x - a.x) * k + (Math.random() - 0.5) * j;
        const ny = a.y + (b.y - a.y) * k + (Math.random() - 0.5) * j;
        const nz = a.z + (b.z - a.z) * k + (Math.random() - 0.5) * j;
        verts.push(px, py, pz, nx, ny, nz);
        px = nx; py = ny; pz = nz;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
    const line = new THREE.LineSegments(geo, mat);
    this.scene.add(line);
    let t = 0;
    this.effects.push({
      update: (dt) => { t += dt; mat.opacity = 1 - t / 0.25; return t < 0.25; },
      dispose: () => { this.scene.remove(line); geo.dispose(); mat.dispose(); },
    });
  }

  explosion(pos: THREE.Vector3, radiusCells: number, color: number) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false });
    const mesh = new THREE.Mesh(sphere, mat);
    mesh.position.copy(pos);
    mesh.scale.set(0.1, 0.05, 0.1);
    this.scene.add(mesh);
    const R = radiusCells * CELL_SIZE;
    let t = 0;
    this.effects.push({
      update: (dt) => {
        t += dt;
        const k = t / 0.35;
        mesh.scale.set(R * k, R * k * 0.4, R * k);
        mat.opacity = 0.6 * (1 - k);
        return k < 1;
      },
      dispose: () => { this.scene.remove(mesh); mat.dispose(); },
    });
    for (let i = 0; i < 4; i++) this.puff(pos, color, 0.3, 0.6);
  }

  ring(pos: THREE.Vector3, color: number, radius: number, duration: number, pulses = 1) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(pos);
    mesh.position.y += 0.15;
    this.scene.add(mesh);
    let t = 0;
    this.effects.push({
      update: (dt) => {
        t += dt;
        const k = ((t / duration) * pulses) % 1;
        mesh.scale.setScalar(0.2 + radius * k);
        mat.opacity = 0.9 * (1 - k);
        return t < duration;
      },
      dispose: () => { this.scene.remove(mesh); mesh.geometry.dispose(); mat.dispose(); },
    });
  }

  puff(pos: THREE.Vector3, color: number, size: number, life: number) {
    const mesh = new THREE.Mesh(cube, basic(color));
    mesh.position.copy(pos);
    mesh.scale.setScalar(size);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3 + 1, (Math.random() - 0.5) * 3);
    this.scene.add(mesh);
    let t = 0;
    this.effects.push({
      update: (dt) => {
        t += dt;
        vel.y -= 9 * dt;
        mesh.position.addScaledVector(vel, dt);
        if (mesh.position.y < 0.05) { mesh.position.y = 0.05; vel.set(0, 0, 0); }
        mesh.scale.setScalar(size * (1 - t / life));
        mesh.rotation.x += dt * 5;
        return t < life;
      },
      dispose: () => this.scene.remove(mesh),
    });
  }

  death(pos: THREE.Vector3, color: number, big: boolean) {
    for (let i = 0; i < (big ? 24 : 7); i++) this.puff(pos, color, big ? 0.35 : 0.18, big ? 1.4 : 0.7);
  }

  /** Floating text label (gold, damage, etc.). */
  text(pos: THREE.Vector3, text: string, color = '#ffd84a') {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 30px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, 64, 34);
    ctx.fillStyle = color;
    ctx.fillText(text, 64, 34);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2.4, 0.9, 1);
    sprite.position.copy(pos);
    sprite.renderOrder = 10;
    this.scene.add(sprite);
    let t = 0;
    this.effects.push({
      update: (dt) => { t += dt; sprite.position.y += dt * 1.5; mat.opacity = 1 - t / 1.2; return t < 1.2; },
      dispose: () => { this.scene.remove(sprite); tex.dispose(); mat.dispose(); },
    });
  }

  update(dt: number) {
    if (!this.effects.length) return;
    const keep: Effect[] = [];
    for (const e of this.effects) {
      if (e.update(dt)) keep.push(e); else e.dispose();
    }
    this.effects = keep;
  }
}

export const projColor = (k: ProjKind) => PROJ_COLORS[k];
