import * as THREE from "three";
import type L from "leaflet";
import type { Snapshot } from "./types";
import { colorOf } from "./map";

interface UnitEntry {
  id: number;
  owner: number;
  sea: boolean;
  baseScale: number;
  group: THREE.Group;
}

export class Units3D {
  private readonly map: L.Map;
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly entries: UnitEntry[] = [];
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly geometry = {
    body: new THREE.BoxGeometry(9, 13, 6),
    head: new THREE.SphereGeometry(3.4, 8, 6),
    helmet: new THREE.CylinderGeometry(4.1, 4.1, 2.6, 8),
    rifle: new THREE.BoxGeometry(1.5, 14, 1.5),
    hull: new THREE.BoxGeometry(22, 6, 8),
    tower: new THREE.BoxGeometry(6, 7, 5),
    shadow: new THREE.CircleGeometry(14, 20),
    ring: new THREE.RingGeometry(15, 19, 24),
  };
  private readonly shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 });
  private readonly ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffd35c, side: THREE.DoubleSide });
  private readonly skinMaterial = new THREE.MeshStandardMaterial({ color: 0xd8b18a, roughness: 0.9 });
  private lastTowns: Map<number, { lat: number; lon: number }> | null = null;
  private visible = true;

  constructor(map: L.Map, container: HTMLElement) {
    this.map = map;
    this.container = container;
    const canvas = document.createElement("canvas");
    canvas.className = "units3d-layer";
    container.appendChild(canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 2000);
    this.camera.position.z = 1000;
    this.scene.add(new THREE.HemisphereLight(0xf4e7c8, 0x30362f, 1.5));
    const sun = new THREE.DirectionalLight(0xfff3d6, 1.4);
    sun.position.set(-200, 300, 500);
    this.scene.add(sun);
    this.map.on("move zoom resize", () => this.sync());
    this.resize();
    this.animate();
  }

  private material(color: string): THREE.MeshStandardMaterial {
    let material = this.materials.get(color);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.12 });
      this.materials.set(color, material);
    }
    return material;
  }

  private soldier(color: string, soldiers: number, selected: boolean): THREE.Group {
    const group = new THREE.Group();
    const shadow = new THREE.Mesh(this.geometry.shadow, this.shadowMaterial);
    shadow.position.z = -4;
    shadow.scale.set(1.5, 0.55, 1);
    group.add(shadow);
    if (selected) {
      const ring = new THREE.Mesh(this.geometry.ring, this.ringMaterial);
      ring.position.z = -3;
      ring.scale.set(1.5, 0.62, 1);
      group.add(ring);
    }
    const count = Math.min(3, Math.max(1, soldiers));
    const material = this.material(color);
    for (let i = 0; i < count; i++) {
      const unit = new THREE.Group();
      unit.position.set((i - (count - 1) / 2) * 11, Math.abs(i - 1) * -2, i * 1.5);
      const body = new THREE.Mesh(this.geometry.body, material);
      body.position.y = 2;
      unit.add(body);
      const head = new THREE.Mesh(this.geometry.head, this.skinMaterial);
      head.position.y = 11;
      unit.add(head);
      const helmet = new THREE.Mesh(this.geometry.helmet, material);
      helmet.position.y = 12.6;
      unit.add(helmet);
      const rifle = new THREE.Mesh(this.geometry.rifle, this.material("#3a3d38"));
      rifle.position.set(6.5, 3.5, 2.5);
      rifle.rotation.z = -0.42;
      unit.add(rifle);
      unit.rotation.set(0.1, -0.32, 0);
      group.add(unit);
    }
    return group;
  }

  private ship(color: string, selected: boolean): THREE.Group {
    const group = new THREE.Group();
    const shadow = new THREE.Mesh(this.geometry.shadow, this.shadowMaterial);
    shadow.position.z = -4;
    shadow.scale.set(1.8, 0.6, 1);
    group.add(shadow);
    if (selected) {
      const ring = new THREE.Mesh(this.geometry.ring, this.ringMaterial);
      ring.position.z = -3;
      ring.scale.set(1.8, 0.7, 1);
      group.add(ring);
    }
    const hull = new THREE.Mesh(this.geometry.hull, this.material(color));
    hull.position.y = -2;
    group.add(hull);
    const tower = new THREE.Mesh(this.geometry.tower, this.material(color));
    tower.position.set(-3, 5, 2);
    group.add(tower);
    const gun = new THREE.Mesh(this.geometry.rifle, this.material("#30332f"));
    gun.position.set(7, 4, 3);
    gun.rotation.z = Math.PI / 2.3;
    group.add(gun);
    group.rotation.set(0.14, -0.28, 0);
    return group;
  }

  clear(): void {
    for (const entry of this.entries) this.scene.remove(entry.group);
    this.entries.length = 0;
  }

  update(snap: Snapshot, selectedTown: number): void {
    this.clear();
    this.lastTowns = new Map(snap.towns.map((town) => [town.id, { lat: town.lat, lon: town.lon }]));
    const towns = snap.towns
      .filter((town) => town.tr >= 1200 || town.id === selectedTown)
      .sort((a, b) => b.tr - a.tr)
      .slice(0, 140);
    if (!towns.some((town) => town.id === selectedTown)) {
      const selected = snap.towns[selectedTown];
      if (selected) towns.push(selected);
    }
    for (const town of towns) {
      const color = colorOf(town.o);
      const sea = town.po === 1 && town.tr >= 3000 && town.id % 3 === 0;
      const group = sea ? this.ship(color, town.id === selectedTown) : this.soldier(color, Math.round(town.tr / 2800), town.id === selectedTown);
      this.scene.add(group);
      this.entries.push({
        id: town.id,
        owner: town.o,
        sea,
        baseScale: Math.min(1.35, 0.8 + Math.log10(1 + town.tr) / 12),
        group,
      });
    }
    this.sync();
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
    this.sync();
  }

  sync(): void {
    const height = this.container.clientHeight;
    const zoom = this.map.getZoom();
    const zoomScale = Math.min(1.75, Math.max(0.62, 0.66 + (Number.isFinite(zoom) ? zoom - 5 : 0) * 0.17));
    for (const entry of this.entries) {
      const town = this.lastTowns?.get(entry.id);
      if (!town) continue;
      const point = this.map.latLngToContainerPoint([town.lat, town.lon]);
      entry.group.position.x = point.x;
      entry.group.position.y = height - point.y;
      entry.group.scale.setScalar(entry.baseScale * zoomScale);
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.container.classList.toggle("hide-units3d", !visible);
  }

  private animate = (): void => {
    const time = performance.now() / 1000;
    if (this.visible) {
      for (const entry of this.entries) {
        entry.group.position.z = Math.sin(time * 1.6 + entry.id * 0.7) * 1.4;
      }
      this.renderer.render(this.scene, this.camera);
    }
    requestAnimationFrame(this.animate);
  };
}
