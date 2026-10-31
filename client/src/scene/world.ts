import * as THREE from 'three';
import { CELL_SIZE, MAP_H, MAP_W, PATH, PATH_CELLS, SECTION_OF, BASE_CELL, SPAWN_CELL, cellIndex, isBuildable } from '../../../shared/map';
import { createBase, createPortal, createRock, createTree, mergeWorldObjects } from './models';

export const PITCH = THREE.MathUtils.degToRad(56);

/** Converts logic coordinates (cells) to world position. */
export function toWorld(x: number, y: number, h = 0, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set((x - MAP_W / 2) * CELL_SIZE, h, (y - MAP_H / 2) * CELL_SIZE);
}
export function toLogic(v: THREE.Vector3): { x: number; y: number } {
  return { x: v.x / CELL_SIZE + MAP_W / 2, y: v.z / CELL_SIZE + MAP_H / 2 };
}

function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly camTarget = new THREE.Vector3(0, 0, 0);
  camDist = 55;
  private keys = new Set<string>();
  private dragging: { x: number; y: number } | null = null;
  private mouse = { x: 0, y: 0, inside: false };
  private mapCanvas = document.createElement('canvas');
  private mapTexture: THREE.CanvasTexture;
  private animated: THREE.Object3D[] = [];
  readonly hoverMesh: THREE.Mesh;
  readonly rangeRing: THREE.Mesh;
  readonly auraRing: THREE.Mesh;
  readonly selectRing: THREE.Mesh;
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private raycaster = new THREE.Raycaster();
  edgePan = true;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 600);

    this.scene.background = new THREE.Color(0x1a2a3a);
    this.scene.fog = new THREE.Fog(0x1a2a3a, 120, 260);

    const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x3a4a2a, 1.4);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d0, 2.4);
    sun.position.set(-40, 80, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera;
    sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 10; sc.far = 220;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);

    this.mapCanvas.width = MAP_W * 32;
    this.mapCanvas.height = MAP_H * 32;
    this.mapTexture = new THREE.CanvasTexture(this.mapCanvas);
    this.mapTexture.colorSpace = THREE.SRGBColorSpace;
    this.mapTexture.anisotropy = 8;
    this.paintMap([], new Map(), '');
    this.buildStatic();

    const highlight = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    this.hoverMesh = new THREE.Mesh(new THREE.BoxGeometry(CELL_SIZE * 0.95, 0.1, CELL_SIZE * 0.95), highlight(0x40ff40, 0.45));
    this.hoverMesh.visible = false;
    this.scene.add(this.hoverMesh);
    this.rangeRing = this.makeRing(0xffffff, 0.5);
    this.auraRing = this.makeRing(0xffd040, 0.35);
    this.selectRing = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.45, 32), new THREE.MeshBasicMaterial({ color: 0x40ff40, transparent: true, opacity: 0.9, depthWrite: false }));
    this.selectRing.rotation.x = -Math.PI / 2;
    this.selectRing.visible = false;
    this.scene.add(this.selectRing);

    this.bindInput();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private makeRing(color: number, opacity: number) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 72), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 72), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity * 0.15, depthWrite: false }));
    ring.add(fill);
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    this.scene.add(ring);
    return ring;
  }

  showRange(ring: THREE.Mesh, x: number, y: number, range: number) {
    toWorld(x, y, 0.08, ring.position);
    ring.scale.setScalar(Math.max(0.01, range * CELL_SIZE));
    ring.visible = range > 0;
  }

  // ------------------------------------------------------------------ static world

  private buildStatic() {
    const rand = mulberry(1337);
    const mapGeo = new THREE.PlaneGeometry(MAP_W * CELL_SIZE, MAP_H * CELL_SIZE);
    const mapMesh = new THREE.Mesh(mapGeo, new THREE.MeshStandardMaterial({ map: this.mapTexture, roughness: 0.95 }));
    mapMesh.rotation.x = -Math.PI / 2;
    mapMesh.receiveShadow = true;
    this.scene.add(mapMesh);

    // Outer terrain.
    const outerCanvas = document.createElement('canvas');
    outerCanvas.width = outerCanvas.height = 256;
    const octx = outerCanvas.getContext('2d')!;
    octx.fillStyle = '#3d5a2a';
    octx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3000; i++) {
      octx.fillStyle = `rgba(${30 + rand() * 40},${60 + rand() * 50},${20 + rand() * 30},0.5)`;
      octx.fillRect(rand() * 256, rand() * 256, 2, 2);
    }
    const outerTex = new THREE.CanvasTexture(outerCanvas);
    outerTex.wrapS = outerTex.wrapT = THREE.RepeatWrapping;
    outerTex.repeat.set(30, 30);
    outerTex.colorSpace = THREE.SRGBColorSpace;
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ map: outerTex, roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.05;
    outer.receiveShadow = true;
    this.scene.add(outer);

    // Cliff border around the play field.
    const borderMat = new THREE.MeshStandardMaterial({ color: 0x6a5f50, roughness: 1, flatShading: true });
    const W = MAP_W * CELL_SIZE, H = MAP_H * CELL_SIZE;
    for (const [w, d, x, z] of [[W + 2, 1, 0, -H / 2 - 0.5], [W + 2, 1, 0, H / 2 + 0.5], [1, H, -W / 2 - 0.5, 0], [1, H, W / 2 + 0.5, 0]] as const) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, d), borderMat);
      b.position.set(x, 0.3, z);
      b.castShadow = b.receiveShadow = true;
      this.scene.add(b);
    }

    // Forest around the map (merged into a few meshes for performance).
    const deco: THREE.Object3D[] = [];
    for (let i = 0; i < 420; i++) {
      const ang = rand() * Math.PI * 2;
      let x = (rand() - 0.5) * (W + 70), z = (rand() - 0.5) * (H + 70);
      if (Math.abs(x) < W / 2 + 2 && Math.abs(z) < H / 2 + 2) {
        if (rand() < 0.5) x = Math.sign(x || 1) * (W / 2 + 3 + rand() * 30); else z = Math.sign(z || 1) * (H / 2 + 3 + rand() * 30);
      }
      const obj = rand() < 0.85 ? createTree(rand) : createRock(rand);
      obj.position.set(x, 0, z);
      obj.rotation.y = ang;
      obj.scale.multiplyScalar(1.6);
      deco.push(obj);
    }
    this.scene.add(mergeWorldObjects(deco));

    const portal = createPortal();
    toWorld(SPAWN_CELL[0] + 0.5, SPAWN_CELL[1] + 0.5, 0, portal.position);
    portal.position.x -= 1;
    this.scene.add(portal);
    this.animated.push(portal);
    const light = new THREE.PointLight(0xa040ff, 30, 14);
    light.position.copy(portal.position).add(new THREE.Vector3(0, 2, 0));
    this.scene.add(light);

    const base = createBase();
    toWorld(BASE_CELL[0] + 0.5, BASE_CELL[1] + 0.5, 0, base.position);
    this.scene.add(base);
  }

  /** Paints grass, the path and the build sections of every player onto the map texture. */
  paintMap(sectionOwners: string[], colors: Map<string, number>, you: string) {
    const ctx = this.mapCanvas.getContext('2d')!;
    const S = 32;
    const rand = mulberry(42);
    ctx.fillStyle = '#4f7a34';
    ctx.fillRect(0, 0, this.mapCanvas.width, this.mapCanvas.height);
    for (let i = 0; i < 26000; i++) {
      const g = 90 + rand() * 60;
      ctx.fillStyle = `rgba(${40 + rand() * 40},${g},${30 + rand() * 25},0.55)`;
      ctx.fillRect(rand() * this.mapCanvas.width, rand() * this.mapCanvas.height, 2 + rand() * 2, 2 + rand() * 3);
    }
    // Section tint.
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const s = SECTION_OF[cellIndex(x, y)];
        if (s < 0 || !sectionOwners.length) continue;
        const owner = sectionOwners[s];
        const col = colors.get(owner) ?? 0xffffff;
        const mine = owner === you;
        ctx.fillStyle = `rgba(${(col >> 16) & 255},${(col >> 8) & 255},${col & 255},${mine ? 0.22 : 0.08})`;
        ctx.fillRect(x * S, y * S, S, S);
      }
    }
    // Grid on buildable cells.
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (isBuildable(x, y)) ctx.strokeRect(x * S + 0.5, y * S + 0.5, S - 1, S - 1);
    // Section borders.
    if (sectionOwners.length) {
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          const s = SECTION_OF[cellIndex(x, y)];
          if (s < 0) continue;
          const owner = sectionOwners[s];
          const col = colors.get(owner) ?? 0xffffff;
          ctx.strokeStyle = `rgba(${(col >> 16) & 255},${(col >> 8) & 255},${col & 255},${owner === you ? 0.95 : 0.5})`;
          ctx.lineWidth = owner === you ? 3 : 2;
          const check = (nx: number, ny: number) => nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H && SECTION_OF[cellIndex(nx, ny)] >= 0 && sectionOwners[SECTION_OF[cellIndex(nx, ny)]] === owner;
          ctx.beginPath();
          if (!check(x, y - 1)) { ctx.moveTo(x * S, y * S + 1); ctx.lineTo(x * S + S, y * S + 1); }
          if (!check(x, y + 1)) { ctx.moveTo(x * S, y * S + S - 1); ctx.lineTo(x * S + S, y * S + S - 1); }
          if (!check(x - 1, y)) { ctx.moveTo(x * S + 1, y * S); ctx.lineTo(x * S + 1, y * S + S); }
          if (!check(x + 1, y)) { ctx.moveTo(x * S + S - 1, y * S); ctx.lineTo(x * S + S - 1, y * S + S); }
          ctx.stroke();
        }
      }
    }
    // Dirt path.
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (!PATH_CELLS[cellIndex(x, y)]) continue;
        ctx.fillStyle = '#8a6a44';
        ctx.fillRect(x * S - 2, y * S - 2, S + 4, S + 4);
      }
    }
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (!PATH_CELLS[cellIndex(x, y)]) continue;
        for (let i = 0; i < 40; i++) {
          const v = 100 + rand() * 60;
          ctx.fillStyle = `rgba(${v + 30},${v},${v * 0.6},0.6)`;
          ctx.fillRect(x * S + rand() * S, y * S + rand() * S, 2 + rand() * 3, 2 + rand() * 3);
        }
      }
    }
    // Direction arrows along the path.
    ctx.fillStyle = 'rgba(60,40,20,0.35)';
    for (let d = 3; d < PATH.total; d += 6) {
      const p = PATH.posAt(d);
      ctx.save();
      ctx.translate(p.x * S, p.y * S);
      ctx.rotate(p.dir);
      ctx.beginPath();
      ctx.moveTo(8, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    this.mapTexture.needsUpdate = true;
  }

  addAnimated(o: THREE.Object3D) { this.animated.push(o); }
  removeAnimated(o: THREE.Object3D) {
    const i = this.animated.indexOf(o);
    if (i >= 0) this.animated.splice(i, 1);
  }

  // ------------------------------------------------------------------ camera & input

  private bindInput() {
    const el = this.renderer.domElement;
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.key);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camDist = THREE.MathUtils.clamp(this.camDist * (e.deltaY > 0 ? 1.1 : 0.9), 14, 110);
    }, { passive: false });
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1 || e.button === 2) this.dragging = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mouseup', () => { this.dragging = null; });
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (this.dragging) {
        const k = this.camDist / 600;
        this.camTarget.x -= (e.clientX - this.dragging.x) * k;
        this.camTarget.z -= (e.clientY - this.dragging.y) * k / Math.sin(PITCH);
        this.dragging = { x: e.clientX, y: e.clientY };
      }
    });
    el.addEventListener('mouseenter', () => { this.mouse.inside = true; });
    el.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  focus(x: number, y: number) {
    toWorld(x, y, 0, this.camTarget);
  }

  private updateCamera(dt: number) {
    const speed = this.camDist * 1.2 * dt;
    let dx = 0, dz = 0;
    if (this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has('ArrowUp')) dz -= 1;
    if (this.keys.has('ArrowDown')) dz += 1;
    if (this.edgePan && this.mouse.inside && document.hasFocus() && !this.dragging) {
      const m = 6;
      if (this.mouse.x <= m) dx -= 1;
      if (this.mouse.x >= window.innerWidth - m) dx += 1;
      if (this.mouse.y <= m) dz -= 1;
      if (this.mouse.y >= window.innerHeight - m) dz += 1;
    }
    this.camTarget.x += dx * speed;
    this.camTarget.z += dz * speed;
    const lx = (MAP_W * CELL_SIZE) / 2 + 5, lz = (MAP_H * CELL_SIZE) / 2 + 5;
    this.camTarget.x = THREE.MathUtils.clamp(this.camTarget.x, -lx, lx);
    this.camTarget.z = THREE.MathUtils.clamp(this.camTarget.z, -lz, lz);
    this.camera.position.set(this.camTarget.x, this.camDist * Math.sin(PITCH), this.camTarget.z + this.camDist * Math.cos(PITCH));
    this.camera.lookAt(this.camTarget);
  }

  /** Returns the cell under the given screen position. */
  pickGround(clientX: number, clientY: number): { x: number; y: number; cx: number; cy: number } | null {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    const l = toLogic(hit);
    return { x: l.x, y: l.y, cx: Math.floor(l.x), cy: Math.floor(l.y) };
  }

  pickObjects(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Object3D | null {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(objects, true);
    if (!hits.length) return null;
    let o: THREE.Object3D | null = hits[0].object;
    while (o && !o.userData.pickId) o = o.parent;
    return o;
  }

  /** Camera footprint on the ground in logic coordinates (for the minimap). */
  viewFootprint(): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      this.raycaster.setFromCamera(new THREE.Vector2(sx, sy), this.camera);
      const hit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) pts.push(toLogic(hit));
    }
    return pts;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number, t: number) {
    this.updateCamera(dt);
    for (const o of this.animated) o.userData.anim?.(t);
    this.renderer.render(this.scene, this.camera);
  }
}
