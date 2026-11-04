import * as THREE from 'three';
import { CELL_SIZE, GATE, MAP_H, MAP_ID, MAP_W, SECTION_OF, SPAWNS, WALKABLE, WATER, cellIndex, isBuildable } from '../../../shared/map';
import type { TowerDef } from '../../../shared/data/classes';
import { createBase, createPortal, createRock, createTree, createTowerModel, mergeWorldObjects, type TowerModel } from './models';

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
  private mapTexture!: THREE.CanvasTexture;
  private staticGroup: THREE.Group | null = null;
  mapId = '';
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
  private ghost: { group: TowerModel; id: string } | null = null;
  /** Off while the keyboard build cursor uses the arrow keys. */
  arrowKeysMoveCamera = true;

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

    this.loadMap();

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

  // ------------------------------------------------------------------ build ghost

  private dim: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; mesh: THREE.Mesh; map: string } | null = null;
  private multiRings: THREE.Mesh[] = [];

  /** Greys out the cells flagged in `mask`: 1 = cannot be built on, 2 = buildable but not affordable. Null hides the overlay. */
  setDim(mask: Uint8Array | null) {
    if (!mask) { if (this.dim) this.dim.mesh.visible = false; return; }
    if (!this.dim || this.dim.map !== this.mapId) {
      if (this.dim) { this.scene.remove(this.dim.mesh); this.dim.tex.dispose(); }
      const canvas = document.createElement('canvas');
      canvas.width = MAP_W * 8; canvas.height = MAP_H * 8;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W * CELL_SIZE, MAP_H * CELL_SIZE), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.04;
      mesh.renderOrder = 1;
      this.scene.add(mesh);
      this.dim = { canvas, tex, mesh, map: this.mapId };
    }
    const ctx = this.dim.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.dim.canvas.width, this.dim.canvas.height);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const v = mask[y * MAP_W + x];
        if (!v) continue;
        ctx.fillStyle = v === 2 ? 'rgba(120,24,24,0.5)' : 'rgba(16,20,32,0.5)';
        ctx.fillRect(x * 8, y * 8, 8, 8);
      }
    }
    this.dim.tex.needsUpdate = true;
    this.dim.mesh.visible = true;
  }

  /** Rings around several selected towers. */
  setMultiRings(points: THREE.Vector3[]) {
    while (this.multiRings.length < points.length) {
      const r = new THREE.Mesh(this.selectRing.geometry, this.selectRing.material);
      r.rotation.x = -Math.PI / 2;
      this.scene.add(r);
      this.multiRings.push(r);
    }
    this.multiRings.forEach((r, i) => {
      r.visible = i < points.length;
      if (i < points.length) r.position.copy(points[i]).setY(0.1);
    });
  }

  /** Semi-transparent preview of the tower that is about to be placed. Rebuilt only when the tower type changes. */
  showGhost(def: TowerDef, owner: number, cx: number, cy: number, ok: boolean) {
    if (this.ghost?.id !== def.id) {
      this.hideGhost(true);
      const group = createTowerModel(def, 0, owner);
      group.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const m = (o.material as THREE.MeshStandardMaterial).clone();
        m.transparent = true;
        m.opacity = Math.min(m.opacity, 0.55);
        m.depthWrite = false;
        o.material = m;
        o.castShadow = false;
        o.receiveShadow = false;
      });
      this.scene.add(group);
      this.ghost = { group, id: def.id };
    }
    const g = this.ghost.group;
    toWorld(cx + 0.5, cy + 0.5, 0, g.position);
    g.visible = true;
    // Green tint when the tower can be built here, red otherwise.
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material as THREE.MeshStandardMaterial;
        m.emissive.set(ok ? 0x30ff30 : 0xff3030);
        m.emissiveIntensity = 0.45;
      }
    });
  }

  hideGhost(dispose = false) {
    if (!this.ghost) return;
    this.ghost.group.visible = false;
    if (!dispose) return;
    this.scene.remove(this.ghost.group);
    this.ghost.group.traverse((o) => { if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose(); });
    this.ghost = null;
  }

  showRange(ring: THREE.Mesh, x: number, y: number, range: number) {
    toWorld(x, y, 0.08, ring.position);
    ring.scale.setScalar(Math.max(0.01, range * CELL_SIZE));
    ring.visible = range > 0;
  }

  // ------------------------------------------------------------------ static world

  /** (Re)builds the static terrain for the active map. */
  loadMap() {
    if (this.staticGroup) {
      this.scene.remove(this.staticGroup);
      this.animated = this.animated.filter((o) => !o.userData.staticWorld);
    }
    this.staticGroup = new THREE.Group();
    this.scene.add(this.staticGroup);
    this.mapCanvas = document.createElement('canvas');
    this.mapCanvas.width = MAP_W * 24;
    this.mapCanvas.height = MAP_H * 24;
    this.mapTexture?.dispose();
    this.mapTexture = new THREE.CanvasTexture(this.mapCanvas);
    this.mapTexture.colorSpace = THREE.SRGBColorSpace;
    this.mapTexture.anisotropy = 8;
    this.paintMap();
    this.buildStatic(this.staticGroup);
    this.mapId = MAP_ID;
  }

  /** Northrend-style canyon: rock cliffs with snow caps, icy paths, frozen water and a forested plateau. */
  private buildStatic(root: THREE.Group) {
    const rand = mulberry(1337);
    const W = MAP_W * CELL_SIZE, H = MAP_H * CELL_SIZE;
    const CLIFF = 2.6;
    const mapMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: this.mapTexture, roughness: 0.9 }));
    mapMesh.rotation.x = -Math.PI / 2;
    mapMesh.receiveShadow = true;
    root.add(mapMesh);

    const snowCanvas = document.createElement('canvas');
    snowCanvas.width = snowCanvas.height = 256;
    const sctx = snowCanvas.getContext('2d')!;
    sctx.fillStyle = '#e6eef6';
    sctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3000; i++) {
      const v = 200 + rand() * 55;
      sctx.fillStyle = `rgba(${v - 18},${v - 6},${v + 4},0.5)`;
      sctx.fillRect(rand() * 256, rand() * 256, 2, 2);
    }
    const snowTex = new THREE.CanvasTexture(snowCanvas);
    snowTex.wrapS = snowTex.wrapT = THREE.RepeatWrapping;
    snowTex.repeat.set(12, 12);
    snowTex.colorSpace = THREE.SRGBColorSpace;
    const snowMat = new THREE.MeshStandardMaterial({ map: snowTex, roughness: 0.95 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4d5866, roughness: 0.9, flatShading: true });
    const rockMat2 = new THREE.MeshStandardMaterial({ color: 0x3c4552, roughness: 0.95, flatShading: true });
    const capMat = new THREE.MeshStandardMaterial({ color: 0xf2f7fc, roughness: 0.8, flatShading: true });

    // Plateau around the canyon (top at cliff height, like the raised Northrend terrain around WC3 TD maps).
    const P = 160;
    const frameMats = [rockMat, rockMat, snowMat, rockMat, rockMat, rockMat];
    for (const [w, d, x, z] of [
      [P, H + 2 * P, -W / 2 - P / 2, 0], [P, H + 2 * P, W / 2 + P / 2, 0], [W, P, 0, -H / 2 - P / 2], [W, P, 0, H / 2 + P / 2],
    ] as const) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, CLIFF, d), frameMats);
      box.position.set(x, CLIFF / 2 - 0.01, z);
      box.receiveShadow = true;
      root.add(box);
    }

    // Cliff cells: rock blocks with snow caps, boulders where they face the path.
    const box = new THREE.BoxGeometry(1, 1, 1);
    const dod = new THREE.DodecahedronGeometry(1, 0);
    const cliffs: THREE.Object3D[] = [];
    const walk = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && WALKABLE[cellIndex(x, y)] === 1;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = cellIndex(x, y);
        if (WALKABLE[i] || WATER[i]) continue;
        const h = CLIFF + (rand() - 0.5) * 0.12;
        const p = toWorld(x + 0.5, y + 0.5, 0);
        const rock = new THREE.Mesh(box, rand() < 0.5 ? rockMat : rockMat2);
        rock.scale.set(CELL_SIZE, h, CELL_SIZE);
        rock.position.set(p.x, h / 2, p.z);
        const cap = new THREE.Mesh(box, capMat);
        // Continuous snow cover on top, pulled back on the sides facing the path so the rock rim shows.
        const inset = 0.28;
        const l = walk(x - 1, y) ? inset : 0, r = walk(x + 1, y) ? inset : 0, t = walk(x, y - 1) ? inset : 0, b = walk(x, y + 1) ? inset : 0;
        cap.scale.set(CELL_SIZE + 0.002 - l - r, 0.2, CELL_SIZE + 0.002 - t - b);
        cap.position.set(p.x + (l - r) / 2, CLIFF + 0.06, p.z + (t - b) / 2);
        cliffs.push(rock, cap);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!walk(x + dx, y + dy) || rand() < 0.35) continue;
          const b = new THREE.Mesh(dod, rand() < 0.5 ? rockMat : rockMat2);
          const r = 0.5 + rand() * 0.45;
          b.scale.set(r, r * (1.2 + rand()), r);
          b.rotation.set(rand() * 3, rand() * 3, rand() * 3);
          b.position.set(p.x + dx * (CELL_SIZE * 0.5 - 0.15) + (rand() - 0.5) * 0.8, r * 0.6, p.z + dy * (CELL_SIZE * 0.5 - 0.15) + (rand() - 0.5) * 0.8);
          cliffs.push(b);
        }
        // Snowy pines on big cliff plateaus.
        const inner = !walk(x + 1, y) && !walk(x - 1, y) && !walk(x, y + 1) && !walk(x, y - 1) && !WATER[i];
        if (inner && rand() < 0.22) {
          const t = createTree(rand);
          t.position.set(p.x, h, p.z);
          cliffs.push(t);
        }
      }
    }
    root.add(mergeWorldObjects(cliffs));

    // Frozen water with ice floes.
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x3f7fb0, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 });
    const iceMat = new THREE.MeshStandardMaterial({ color: 0xe8f4ff, roughness: 0.4, flatShading: true });
    const water: THREE.Object3D[] = [];
    const plane = new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE);
    for (let i = 0; i < WATER.length; i++) {
      if (!WATER[i]) continue;
      const x = i % MAP_W, y = Math.floor(i / MAP_W);
      const w = new THREE.Mesh(plane, waterMat);
      w.rotation.x = -Math.PI / 2;
      toWorld(x + 0.5, y + 0.5, 0.12, w.position);
      water.push(w);
      if (rand() < 0.12) {
        const floe = new THREE.Mesh(dod, iceMat);
        const r = 0.3 + rand() * 0.5;
        floe.scale.set(r, 0.12, r * (0.6 + rand() * 0.6));
        floe.rotation.y = rand() * 3;
        toWorld(x + rand(), y + rand(), 0.16, floe.position);
        water.push(floe);
      }
    }
    if (water.length) root.add(mergeWorldObjects(water));

    // Forest on the whole plateau, all the way to its edge.
    const deco: THREE.Object3D[] = [];
    const outerW = W + 2 * P, outerH = H + 2 * P;
    const treeCount = Math.min(4200, Math.round((outerW * outerH - W * H) * 0.0085));
    for (let i = 0; i < treeCount; i++) {
      let x = (rand() - 0.5) * (outerW - 4), z = (rand() - 0.5) * (outerH - 4);
      if (Math.abs(x) < W / 2 + 2 && Math.abs(z) < H / 2 + 2) {
        if (rand() < 0.5) x = Math.sign(x || 1) * (W / 2 + 3 + rand() * (P - 8)); else z = Math.sign(z || 1) * (H / 2 + 3 + rand() * (P - 8));
      }
      const obj = rand() < 0.88 ? createTree(rand) : createRock(rand);
      obj.position.set(x, CLIFF, z);
      obj.rotation.y = rand() * Math.PI * 2;
      obj.scale.multiplyScalar(1.6);
      deco.push(obj);
    }
    root.add(mergeWorldObjects(deco));

    // One spawn portal per lane.
    for (const sp of SPAWNS) {
      const portal = createPortal();
      toWorld(sp.x, sp.y - 0.3, 0, portal.position);
      portal.userData.staticWorld = true;
      root.add(portal);
      this.animated.push(portal);
      const light = new THREE.PointLight(0x7fd0ff, 25, 14);
      light.position.copy(portal.position).add(new THREE.Vector3(0, 2, 0));
      root.add(light);
    }

    // The gate the creeps try to reach.
    const base = createBase();
    toWorld(GATE.x, GATE.y, 0, base.position);
    base.rotation.y = GATE.rot;
    base.scale.setScalar(1.4);
    root.add(base);

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
    root.add(this.snow);
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
  paintMap(showGrid = true) {
    const ctx = this.mapCanvas.getContext('2d')!;
    const S = 24;
    const rand = mulberry(42);
    // Snow for build zones, slick blue ice for the open paths (Northrend tiles).
    ctx.fillStyle = '#dbe6ef';
    ctx.fillRect(0, 0, this.mapCanvas.width, this.mapCanvas.height);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = cellIndex(x, y);
        if (WATER[i]) ctx.fillStyle = '#25537a';
        else if (!WALKABLE[i]) ctx.fillStyle = '#3a4552';
        else if (SECTION_OF[i] < 0) ctx.fillStyle = '#b9d6ea';
        else continue;
        ctx.fillRect(x * S, y * S, S, S);
      }
    }
    for (let i = 0; i < 20000; i++) {
      const v = 205 + rand() * 45;
      ctx.fillStyle = `rgba(${v - 20},${v - 8},${v + 5},0.45)`;
      ctx.fillRect(rand() * this.mapCanvas.width, rand() * this.mapCanvas.height, 2 + rand() * 3, 2 + rand() * 2);
    }
    // Cracks in the ice paths.
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = cellIndex(x, y);
        if (!WALKABLE[i] || SECTION_OF[i] >= 0 || rand() < 0.5) continue;
        ctx.beginPath();
        let px = x * S + rand() * S, py = y * S + rand() * S;
        ctx.moveTo(px, py);
        for (let k = 0; k < 3; k++) { px += (rand() - 0.5) * 14; py += (rand() - 0.5) * 14; ctx.lineTo(px, py); }
        ctx.stroke();
      }
    }
    // Grid on buildable cells (can be hidden by the player).
    if (showGrid) {
      ctx.strokeStyle = 'rgba(40,60,90,0.16)';
      ctx.lineWidth = 1;
      for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (isBuildable(x, y)) ctx.strokeRect(x * S + 0.5, y * S + 0.5, S - 1, S - 1);
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
      if (e.ctrlKey || e.metaKey) return;
      this.keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camDist = THREE.MathUtils.clamp(this.camDist * (e.deltaY > 0 ? 1.1 : 0.9), 14, Math.max(110, MAP_W * 1.9));
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
    const arrows = this.arrowKeysMoveCamera;
    if ((arrows && this.keys.has('ArrowLeft')) || this.keys.has('a')) dx -= 1;
    if ((arrows && this.keys.has('ArrowRight')) || this.keys.has('d')) dx += 1;
    if ((arrows && this.keys.has('ArrowUp')) || this.keys.has('w')) dz -= 1;
    if ((arrows && this.keys.has('ArrowDown')) || this.keys.has('s')) dz += 1;
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
