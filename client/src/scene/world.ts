import * as THREE from 'three';
import { CELL_SIZE, GATE, LANES, MAP_H, MAP_W, SECTION_OF, SPAWNS, WALKABLE, cellIndex, isBuildable, lanesOf } from '../../../shared/map';
import { createBase, createIceCliff, createPortal, createRock, createTree, mergeWorldObjects } from './models';

export const PITCH = THREE.MathUtils.degToRad(56);

const ROUTE_MAT = new THREE.LineDashedMaterial({ color: 0xff5040, dashSize: 0.8, gapSize: 0.6, transparent: true, opacity: 0.75, depthWrite: false });

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
  private routeLines: THREE.Line[] = [];
  private snow!: THREE.Points;
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

    this.scene.background = new THREE.Color(0x8fa6bd);
    this.scene.fog = new THREE.Fog(0x8fa6bd, 160, 340);

    const hemi = new THREE.HemisphereLight(0xdcecff, 0x6a7a8a, 1.3);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e6, 2.0);
    sun.position.set(-40, 80, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera;
    sc.left = -75; sc.right = 75; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 220;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);

    this.mapCanvas.width = MAP_W * 24;
    this.mapCanvas.height = MAP_H * 24;
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
    octx.fillStyle = '#dfe8f1';
    octx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3000; i++) {
      const v = 200 + rand() * 50;
      octx.fillStyle = `rgba(${v - 15},${v - 5},${v + 5},0.5)`;
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
    const borderMat = new THREE.MeshStandardMaterial({ color: 0xa9c2d8, roughness: 0.6, flatShading: true });
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

    // Ice cliffs on every blocked cell inside the map.
    const cliffs: THREE.Object3D[] = [];
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (WALKABLE[cellIndex(x, y)]) continue;
        const c = createIceCliff(rand);
        toWorld(x + 0.5, y + 0.5, 0, c.position);
        cliffs.push(c);
      }
    }
    this.scene.add(mergeWorldObjects(cliffs));

    // One spawn portal per lane at the top.
    for (const sp of SPAWNS) {
      const portal = createPortal();
      toWorld(sp.x, sp.y - 0.6, 0, portal.position);
      portal.rotation.y = Math.PI / 2;
      this.scene.add(portal);
      this.animated.push(portal);
      const light = new THREE.PointLight(0x7fd0ff, 25, 14);
      light.position.copy(portal.position).add(new THREE.Vector3(0, 2, 0));
      this.scene.add(light);
    }

    // The gate the creeps try to reach.
    const base = createBase();
    toWorld(GATE.x, GATE.y + 1.2, 0, base.position);
    base.scale.setScalar(1.4);
    this.scene.add(base);

    // Snowfall.
    const flakes = 2500;
    const pos = new Float32Array(flakes * 3);
    for (let i = 0; i < flakes; i++) {
      pos[i * 3] = (rand() - 0.5) * (W + 40);
      pos[i * 3 + 1] = rand() * 60;
      pos[i * 3 + 2] = (rand() - 0.5) * (H + 40);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.snow = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, transparent: true, opacity: 0.85, depthWrite: false }));
    this.scene.add(this.snow);
  }

  private updateSnow(dt: number, t: number) {
    const a = this.snow.geometry.attributes.position as THREE.BufferAttribute;
    const p = a.array as Float32Array;
    for (let i = 0; i < p.length; i += 3) {
      p[i + 1] -= dt * (3 + (i % 7) * 0.3);
      p[i] += Math.sin(t * 0.7 + i) * dt * 0.6;
      if (p[i + 1] < 0) p[i + 1] += 60;
    }
    a.needsUpdate = true;
  }

  /** Shows the current creep routes (one polyline per lane). */
  setRoutes(routes: { x: number; y: number }[][]) {
    for (const l of this.routeLines) { this.scene.remove(l); l.geometry.dispose(); }
    this.routeLines = [];
    for (const r of routes) {
      if (r.length < 2) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(r.map((p) => toWorld(p.x, p.y, 0.12)));
      const line = new THREE.Line(geo, ROUTE_MAT);
      line.computeLineDistances();
      this.scene.add(line);
      this.routeLines.push(line);
    }
  }

  /** Paints snow, trodden lanes and the build zones of every player onto the map texture. */
  paintMap(sectionOwners: string[], colors: Map<string, number>, you: string) {
    const ctx = this.mapCanvas.getContext('2d')!;
    const S = 24;
    const rand = mulberry(42);
    const active = sectionOwners.length ? lanesOf(sectionOwners) : [0, 1, 2, 3];
    ctx.fillStyle = '#e4ecf4';
    ctx.fillRect(0, 0, this.mapCanvas.width, this.mapCanvas.height);
    for (let i = 0; i < 20000; i++) {
      const v = 205 + rand() * 45;
      ctx.fillStyle = `rgba(${v - 20},${v - 8},${v + 5},0.5)`;
      ctx.fillRect(rand() * this.mapCanvas.width, rand() * this.mapCanvas.height, 2 + rand() * 3, 2 + rand() * 2);
    }
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = cellIndex(x, y);
        if (!WALKABLE[i]) { ctx.fillStyle = 'rgba(120,150,180,0.55)'; ctx.fillRect(x * S, y * S, S, S); continue; }
        const s = SECTION_OF[i];
        if (s < 0) { ctx.fillStyle = 'rgba(150,165,185,0.28)'; ctx.fillRect(x * S, y * S, S, S); continue; }
        const owner = sectionOwners[s];
        if (!active.includes(s % LANES) || (sectionOwners.length && !owner)) {
          ctx.fillStyle = 'rgba(90,110,135,0.3)';
          ctx.fillRect(x * S, y * S, S, S);
          continue;
        }
        if (!owner) continue;
        const col = colors.get(owner) ?? 0xffffff;
        ctx.fillStyle = `rgba(${(col >> 16) & 255},${(col >> 8) & 255},${col & 255},${owner === you ? 0.2 : 0.08})`;
        ctx.fillRect(x * S, y * S, S, S);
      }
    }
    // Grid on buildable cells.
    ctx.strokeStyle = 'rgba(40,60,90,0.12)';
    ctx.lineWidth = 1;
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (isBuildable(x, y)) ctx.strokeRect(x * S + 0.5, y * S + 0.5, S - 1, S - 1);
    // Zone borders.
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const s = SECTION_OF[cellIndex(x, y)];
        if (s < 0 || !sectionOwners[s]) continue;
        const owner = sectionOwners[s];
        const col = colors.get(owner) ?? 0xffffff;
        ctx.strokeStyle = `rgba(${(col >> 16) & 255},${(col >> 8) & 255},${col & 255},${owner === you ? 0.95 : 0.5})`;
        ctx.lineWidth = owner === you ? 3 : 2;
        const same = (nx: number, ny: number) => nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H && SECTION_OF[cellIndex(nx, ny)] === s;
        ctx.beginPath();
        if (!same(x, y - 1)) { ctx.moveTo(x * S, y * S + 1); ctx.lineTo(x * S + S, y * S + 1); }
        if (!same(x, y + 1)) { ctx.moveTo(x * S, y * S + S - 1); ctx.lineTo(x * S + S, y * S + S - 1); }
        if (!same(x - 1, y)) { ctx.moveTo(x * S + 1, y * S); ctx.lineTo(x * S + 1, y * S + S); }
        if (!same(x + 1, y)) { ctx.moveTo(x * S + S - 1, y * S); ctx.lineTo(x * S + S - 1, y * S + S); }
        ctx.stroke();
      }
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
    this.updateSnow(dt, t);
    this.renderer.render(this.scene, this.camera);
  }
}
