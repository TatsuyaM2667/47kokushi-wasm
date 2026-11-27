import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type L from "leaflet";
import type { Snapshot } from "./types";
import { colorOf } from "./map";

type UnitKind = "infantry" | "ship";

interface UnitEntry {
  id: number;
  kind: UnitKind;
  color: string;
  baseScale: number;
  phase: number;
  instanceIndex: number;
  targetX: number;
  targetY: number;
  targetScale: number;
  currentX: number;
  currentY: number;
  currentScale: number;
}

interface MarchEntry {
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  color: string;
  phase: number;
  speed: number;
}

const MAX_UNITS = 28;
const MAX_MARCHERS = 18;

function placed(
  geometry: THREE.BufferGeometry,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
): THREE.BufferGeometry {
  const result = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(1, 1, 1),
  );
  result.applyMatrix4(matrix);
  return result;
}

function tinted(
  geometry: THREE.BufferGeometry,
  color: number,
): THREE.BufferGeometry {
  const result = geometry.clone();
  const count = result.attributes.position.count;
  const values = new Float32Array(count * 3);
  const value = new THREE.Color(color);
  for (let i = 0; i < count; i++) {
    values[i * 3] = value.r;
    values[i * 3 + 1] = value.g;
    values[i * 3 + 2] = value.b;
  }
  result.setAttribute("color", new THREE.BufferAttribute(values, 3));
  return result;
}

function join(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geometry = mergeGeometries(parts);
  if (!geometry) throw new Error("3Dモデルの結合に失敗しました");
  return geometry;
}

export class Units3D {
  private readonly map: L.Map;
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly clock = new THREE.Clock();
  private readonly entries: UnitEntry[] = [];
  private readonly marches: MarchEntry[] = [];
  private readonly marchPoints: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
  }[] = [];
  private cachedZoomScale = 1;
  private lastFrame = 0;
  private dirty = true;
  private lastDataKey = "";
  private readonly infantryColor: THREE.InstancedMesh;
  private readonly infantryDetail: THREE.InstancedMesh;
  private readonly shipColor: THREE.InstancedMesh;
  private readonly shipDetail: THREE.InstancedMesh;
  private readonly shadows: THREE.InstancedMesh;
  private readonly marchers: THREE.InstancedMesh;
  private readonly ring: THREE.Mesh;
  private readonly flag: THREE.Mesh;
  private readonly flagCanvas = document.createElement("canvas");
  private readonly flagTexture = new THREE.CanvasTexture(this.flagCanvas);
  private readonly ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd35c,
    transparent: true,
    opacity: 0.82,
    side: THREE.DoubleSide,
  });
  private readonly flagMaterial = new THREE.MeshBasicMaterial({
    map: this.flagTexture,
    transparent: true,
    side: THREE.DoubleSide,
  });
  private flagLabel = "";
  private flagColor = "";
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private selectedId = -1;
  private lastTowns: Map<number, { lat: number; lon: number }> | null = null;
  private readonly reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  private visible = true;

  private constructor(
    map: L.Map,
    container: HTMLElement,
    renderer: THREE.WebGLRenderer,
  ) {
    this.map = map;
    this.container = container;
    this.renderer = renderer;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 0.5));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 2000);
    this.camera.position.z = 1000;

    const torso = new RoundedBoxGeometry(9, 13, 6, 3, 1.6);
    const pack = new RoundedBoxGeometry(6, 8, 4, 2, 1.2);
    const leg = new RoundedBoxGeometry(2.6, 8, 3, 2, 0.7);
    const head = new THREE.SphereGeometry(3.2, 10, 8);
    const helmet = new THREE.SphereGeometry(
      4.1,
      10,
      7,
      0,
      Math.PI * 2,
      0,
      Math.PI / 2,
    );
    const rimRing = new THREE.TorusGeometry(3.75, 0.55, 5, 12);
    const rifle = new RoundedBoxGeometry(1.4, 15, 1.4, 2, 0.5);
    const infantryColorGeometry = join([
      placed(torso, [0, 2, 0]),
      placed(pack, [0, 2, -4]),
      placed(leg, [-2.2, -5, -0.5]),
      placed(leg, [2.2, -5, -0.5]),
      placed(helmet, [0, 11.8, 0]),
      placed(rimRing, [0, 11.9, 0], [Math.PI / 2, 0, 0]),
    ]);
    const infantryDetailGeometry = join([
      placed(tinted(head, 0xd7b18d), [0, 10.5, 0]),
      placed(tinted(rifle, 0x333a37), [6.5, 3.5, 2.6], [0, 0, -0.42]),
    ]);
    infantryColorGeometry.rotateX(0.06);
    infantryColorGeometry.rotateY(-0.3);
    infantryDetailGeometry.rotateX(0.06);
    infantryDetailGeometry.rotateY(-0.3);

    const hull = new RoundedBoxGeometry(24, 6, 9, 3, 2);
    const deck = new RoundedBoxGeometry(12, 3, 7, 2, 1);
    const tower = new RoundedBoxGeometry(7, 8, 6, 3, 1.4);
    const gun = new RoundedBoxGeometry(2, 14, 2, 2, 0.6);
    const mast = new THREE.CylinderGeometry(0.45, 0.45, 14, 6);
    const shipColorGeometry = join([
      placed(hull, [0, -2, 0]),
      placed(deck, [0, 3, 0]),
      placed(tower, [-3, 7, 3]),
    ]);
    const shipDetailGeometry = join([
      placed(tinted(gun, 0x333a37), [8, 5, 4], [0, 0, Math.PI / 2.3]),
      placed(tinted(mast, 0xd8c9a6), [-3, 17, 4]),
    ]);
    shipColorGeometry.rotateX(0.1);
    shipColorGeometry.rotateY(-0.28);
    shipDetailGeometry.rotateX(0.1);
    shipDetailGeometry.rotateY(-0.28);

    const colorMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const detailMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
    });
    this.infantryColor = new THREE.InstancedMesh(
      infantryColorGeometry,
      colorMaterial,
      MAX_UNITS,
    );
    this.infantryDetail = new THREE.InstancedMesh(
      infantryDetailGeometry,
      detailMaterial,
      MAX_UNITS,
    );
    this.shipColor = new THREE.InstancedMesh(
      shipColorGeometry,
      colorMaterial,
      MAX_UNITS,
    );
    this.shipDetail = new THREE.InstancedMesh(
      shipDetailGeometry,
      detailMaterial,
      MAX_UNITS,
    );
    this.shadows = new THREE.InstancedMesh(
      new THREE.CircleGeometry(15, 12),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
      MAX_UNITS,
    );
    this.marchers = new THREE.InstancedMesh(
      new RoundedBoxGeometry(4, 6, 3, 2, 1),
      colorMaterial,
      MAX_MARCHERS,
    );
    for (const mesh of [
      this.infantryColor,
      this.infantryDetail,
      this.shipColor,
      this.shipDetail,
      this.shadows,
      this.marchers,
    ]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.scene.add(mesh);
    }
    this.ring = new THREE.Mesh(new THREE.RingGeometry(16, 20, 32), this.ringMaterial);
    this.ring.visible = false;
    this.scene.add(this.ring);
    this.flagCanvas.width = 256;
    this.flagCanvas.height = 128;
    const flagGeometry = new THREE.PlaneGeometry(11, 6);
    this.flag = new THREE.Mesh(flagGeometry, this.flagMaterial);
    this.flag.visible = false;
    this.scene.add(this.flag);
    this.map.on("move zoom resize", () => this.sync(true));
    this.resize();
    this.animate();
  }

  static async create(map: L.Map, container: HTMLElement): Promise<Units3D> {
    const canvas = document.createElement("canvas");
    canvas.className = "units3d-layer";
    container.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
    });
    return new Units3D(map, container, renderer);
  }

  clear(): void {
    this.entries.length = 0;
    this.marches.length = 0;
    this.selectedId = -1;
    this.dirty = true;
  }

  setFlagLabel(label: string, color: string): void {
    const text = label.trim().slice(0, 8);
    if (text === this.flagLabel && color === this.flagColor) return;
    this.flagLabel = text;
    this.flagColor = color;
    const ctx = this.flagCanvas.getContext("2d");
    if (!ctx) return;
    const styles = getComputedStyle(document.documentElement);
    const ink = styles.getPropertyValue("--color-accent-bright").trim();
    const font = styles.getPropertyValue("--font-display").trim();
    ctx.clearRect(0, 0, 256, 128);
    ctx.fillStyle = color || styles.getPropertyValue("--color-surface-3").trim();
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(0, 96, 256, 32);
    ctx.globalAlpha = 1;
    ctx.font = `700 64px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text || "◈", 128, 60, 224);
    this.flagTexture.needsUpdate = true;
    this.dirty = true;
  }

  update(snap: Snapshot, selectedTown: number): void {
    let hash = 0;
    for (const town of snap.towns) {
      hash = (Math.imul(hash, 31) + town.o * 7 + town.tr) | 0;
    }
    const ordersKey = snap.orders
      .map((order) => `${order.from}:${order.to}:${order.eta}`)
      .join(",");
    const dataKey = `${snap.turn}|${hash}|${ordersKey}`;
    if (dataKey !== this.lastDataKey) {
      this.lastDataKey = dataKey;
      const previous = new Map(
        this.entries.map((entry) => [
          entry.id,
          { x: entry.currentX, y: entry.currentY, scale: entry.currentScale },
        ]),
      );
      this.clear();
      this.lastTowns = new Map(
        snap.towns.map((town) => [town.id, { lat: town.lat, lon: town.lon }]),
      );
      const towns = snap.towns
        .filter((town) => town.tr >= 1200 || town.id === selectedTown)
        .sort((a, b) => b.tr - a.tr)
        .slice(0, MAX_UNITS);
      if (!towns.some((town) => town.id === selectedTown)) {
        const selected = snap.towns[selectedTown];
        if (selected) towns.push(selected);
      }
      let infantryIndex = 0;
      let shipIndex = 0;
      for (const town of towns) {
        const kind: UnitKind =
          town.po === 1 && town.tr >= 3000 && town.id % 3 === 0
            ? "ship"
            : "infantry";
        const instanceIndex = kind === "ship" ? shipIndex++ : infantryIndex++;
        const entry: UnitEntry = {
          id: town.id,
          kind,
          color: colorOf(town.o),
          baseScale: Math.min(1.35, 0.8 + Math.log10(1 + town.tr) / 12),
          phase: town.id * 0.37,
          instanceIndex,
          targetX: 0,
          targetY: 0,
          targetScale: 1,
          currentX: 0,
          currentY: 0,
          currentScale: 1,
        };
        this.entries.push(entry);
        this.color.set(entry.color);
        if (kind === "ship") this.shipColor.setColorAt(instanceIndex, this.color);
        else this.infantryColor.setColorAt(instanceIndex, this.color);
      }
      this.infantryColor.count = Math.min(infantryIndex, MAX_UNITS);
      this.infantryDetail.count = this.infantryColor.count;
      this.shipColor.count = Math.min(shipIndex, MAX_UNITS);
      this.shipDetail.count = this.shipColor.count;
      this.shadows.count = Math.min(this.entries.length, MAX_UNITS);
      if (this.infantryColor.instanceColor)
        this.infantryColor.instanceColor.needsUpdate = true;
      if (this.shipColor.instanceColor)
        this.shipColor.instanceColor.needsUpdate = true;

      let marchIndex = 0;
      for (const [index, order] of snap.orders.slice(0, 6).entries()) {
        const from = snap.towns[order.from];
        const to = snap.towns[order.to];
        if (!from || !to) continue;
        const march: MarchEntry = {
          from: { lat: from.lat, lon: from.lon },
          to: { lat: to.lat, lon: to.lon },
          color: colorOf(from.o),
          phase: (index * 0.19) % 1,
          speed: order.sea ? 0.09 : 0.13,
        };
        this.marches.push(march);
        this.color.set(march.color);
        for (let i = 0; i < 3; i++)
          this.marchers.setColorAt(marchIndex++, this.color);
      }
      this.marchers.count = Math.min(marchIndex, MAX_MARCHERS);
      if (this.marchers.instanceColor) this.marchers.instanceColor.needsUpdate = true;

      this.sync();
      for (const entry of this.entries) {
        const old = previous.get(entry.id);
        entry.currentX = old?.x ?? entry.targetX;
        entry.currentY = old?.y ?? entry.targetY;
        entry.currentScale = old?.scale ?? entry.targetScale;
      }
    }
    this.selectedId = -1;
    for (const entry of this.entries) {
      if (entry.id === selectedTown) this.selectedId = entry.id;
    }
    this.sync();
    this.dirty = true;
  }

  resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.left = 0;
    this.camera.right = width;
    this.camera.top = height;
    this.camera.bottom = 0;
    this.camera.updateProjectionMatrix();
    this.sync(true);
  }

  sync(snapToTarget = false): void {
    const height = this.container.clientHeight;
    const zoom = this.map.getZoom();
    const zoomScale = Math.min(
      1.8,
      Math.max(0.66, 0.7 + (Number.isFinite(zoom) ? zoom - 5 : 0) * 0.18),
    );
    this.cachedZoomScale = zoomScale;
    for (const entry of this.entries) {
      const town = this.lastTowns?.get(entry.id);
      if (!town) continue;
      const point = this.map.latLngToContainerPoint([town.lat, town.lon]);
      entry.targetX = point.x;
      entry.targetY = height - point.y;
      entry.targetScale = entry.baseScale * zoomScale;
      if (snapToTarget) {
        entry.currentX = entry.targetX;
        entry.currentY = entry.targetY;
        entry.currentScale = entry.targetScale;
      }
    }
    this.marchPoints.length = 0;
    for (const march of this.marches) {
      const from = this.map.latLngToContainerPoint([
        march.from.lat,
        march.from.lon,
      ]);
      const to = this.map.latLngToContainerPoint([march.to.lat, march.to.lon]);
      this.marchPoints.push({
        fromX: from.x,
        fromY: height - from.y,
        toX: to.x,
        toY: height - to.y,
      });
    }
    this.dirty = true;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) {
      this.lastFrame = 0;
      this.clock.getDelta();
    }
    this.container.classList.toggle("hide-units3d", !visible);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    if (!this.visible) return;
    const now = performance.now();
    if (now - this.lastFrame < 1000 / 24) return;
    this.lastFrame = now;
    const settling = this.entries.some(
      (entry) =>
        Math.abs(entry.targetX - entry.currentX) > 0.25 ||
        Math.abs(entry.targetY - entry.currentY) > 0.25 ||
        Math.abs(entry.targetScale - entry.currentScale) > 0.002,
    );
    if (!this.dirty && !settling && this.marches.length === 0) return;
    const delta = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.elapsedTime;
    const damping = this.reduceMotion ? 1 : 1 - Math.exp(-delta * 14);
    let infantry = 0;
    let ships = 0;
    let shadowIndex = 0;
    for (const entry of this.entries) {
      entry.currentX += (entry.targetX - entry.currentX) * damping;
      entry.currentY += (entry.targetY - entry.currentY) * damping;
      entry.currentScale += (entry.targetScale - entry.currentScale) * damping;
      this.position.set(entry.currentX, entry.currentY, 0);
      this.euler.set(0, 0, 0);
      this.quaternion.setFromEuler(this.euler);
      this.scale.setScalar(entry.currentScale);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      if (entry.kind === "ship") {
        this.shipColor.setMatrixAt(ships, this.matrix);
        this.shipDetail.setMatrixAt(ships, this.matrix);
        ships++;
      } else {
        this.infantryColor.setMatrixAt(infantry, this.matrix);
        this.infantryDetail.setMatrixAt(infantry, this.matrix);
        infantry++;
      }
      this.position.z = -6;
      this.scale.set(entry.currentScale * 1.5, entry.currentScale * 0.58, 1);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.shadows.setMatrixAt(shadowIndex++, this.matrix);
    }
    if (this.infantryColor.count) this.infantryColor.instanceMatrix.needsUpdate = true;
    if (this.infantryDetail.count) this.infantryDetail.instanceMatrix.needsUpdate = true;
    if (this.shipColor.count) this.shipColor.instanceMatrix.needsUpdate = true;
    if (this.shipDetail.count) this.shipDetail.instanceMatrix.needsUpdate = true;
    if (this.shadows.count) this.shadows.instanceMatrix.needsUpdate = true;

    const selected = this.entries.find((entry) => entry.id === this.selectedId);
    this.ring.visible = Boolean(selected);
    this.flag.visible = Boolean(selected);
    if (selected) {
      this.ring.position.set(selected.currentX, selected.currentY, -4);
      this.ring.scale.set(1.5, 0.62, 1);
      this.flag.position.set(
        selected.currentX - 8 * selected.currentScale,
        selected.currentY + 17 * selected.currentScale,
        4.5,
      );
      this.flag.scale.setScalar(selected.currentScale);
    }

    let marchIndex = 0;
    for (const [index, march] of this.marches.entries()) {
      const point = this.marchPoints[index];
      if (!point) break;
      const progress = (time * march.speed + march.phase) % 1;
      const eased = progress * progress * (3 - 2 * progress);
      const x = point.fromX + (point.toX - point.fromX) * eased;
      const y = point.fromY + (point.toY - point.fromY) * eased;
      const angle = Math.atan2(point.toY - point.fromY, point.toX - point.fromX);
      const fade = Math.min(1, Math.sin(Math.PI * progress) * 3);
      this.euler.set(0, 0, angle);
      this.quaternion.setFromEuler(this.euler);
      this.scale.setScalar(this.cachedZoomScale * 0.72 * fade);
      for (let i = 0; i < 3; i++) {
        this.position.set(
          x + Math.cos(angle + Math.PI / 2) * (i - 1) * 5,
          y + Math.sin(angle + Math.PI / 2) * (i - 1) * 5,
          9,
        );
        this.matrix.compose(this.position, this.quaternion, this.scale);
        this.marchers.setMatrixAt(marchIndex++, this.matrix);
      }
    }
    if (this.marchers.count) this.marchers.instanceMatrix.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    this.dirty = false;
  };
}
