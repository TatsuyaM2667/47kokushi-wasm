import * as THREE from "three/webgpu";
import {
  color,
  float,
  mix,
  pass,
  positionLocal,
  sin,
  smoothstep,
  time,
  uniform,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import { Application, Graphics } from "pixi.js";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { animate as motionAnimate } from "motion";
import "./intro.css";

export interface IntroHandle {
  dispose(): void;
}

interface PrefFeature {
  properties: { pref: number };
  geometry: unknown;
}

const SCALE = 0.92;

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function tokenColor(name: string): number {
  return new THREE.Color(token(name)).getHex();
}

function isSoftwareRenderer(): boolean {
  const gl = document.createElement("canvas").getContext("webgl2");
  const debug = gl?.getExtension("WEBGL_debug_renderer_info") as
    | { UNMASKED_RENDERER_WEBGL: number }
    | null;
  const label = debug ? String(gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "";
  return /swiftshader|llvmpipe|software/i.test(label);
}

function ringToShape(ring: number[][], target: THREE.Shape | THREE.Path): void {
  if (ring.length < 3) return;
  target.moveTo(ring[0][0] * SCALE, ring[0][1] * SCALE);
  for (let i = 1; i < ring.length; i++) {
    target.lineTo(ring[i][0] * SCALE, ring[i][1] * SCALE);
  }
  target.closePath();
}

function polygonToShape(rings: number[][][]): THREE.Shape {
  const shape = new THREE.Shape();
  ringToShape(rings[0] ?? [], shape);
  for (let i = 1; i < rings.length; i++) {
    const hole = new THREE.Path();
    ringToShape(rings[i], hole);
    shape.holes.push(hole);
  }
  return shape;
}

function geometryToShapes(geometry: unknown): THREE.Shape[] {
  const source = geometry as {
    type: string;
    coordinates: number[][][] | number[][][][];
  };
  if (source.type === "Polygon") {
    return [polygonToShape(source.coordinates as number[][][])];
  }
  if (source.type === "MultiPolygon") {
    return (source.coordinates as number[][][][]).map(polygonToShape);
  }
  return [];
}

function createParticles(count: number): THREE.Points {
  let seed = 73647;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (random() - 0.5) * 90;
    positions[i * 3 + 1] = random() * 22 - 4;
    positions[i * 3 + 2] = (random() - 0.5) * 90;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: token("--color-accent-bright"),
    size: 0.085,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geometry, material);
}

async function loadPrefFeatures(): Promise<PrefFeature[]> {
  const response = await fetch("/data/prefectures.json");
  const topology = (await response.json()) as Topology;
  const collection = feature(
    topology,
    topology.objects.raw as Parameters<typeof feature>[1],
  ) as unknown as { features: PrefFeature[] };
  return collection.features;
}

export async function createIntro(): Promise<IntroHandle> {
  const start = document.getElementById("start") as HTMLElement;
  const pin = start.querySelector<HTMLElement>(".intro-pin") as HTMLElement;
  const track = start.querySelector<HTMLElement>(".intro-track") as HTMLElement;
  const shell = start.querySelector<HTMLElement>(".start-shell") as HTMLElement;
  const canvas = document.getElementById("introCanvas") as HTMLCanvasElement;
  const fxCanvas = document.getElementById("introFx") as HTMLCanvasElement;
  const skip = document.getElementById("introSkip") as HTMLButtonElement;
  const copies = Array.from(start.querySelectorAll<HTMLElement>(".intro-copy"));
  const steps = Array.from(start.querySelectorAll<HTMLElement>(".intro-progress i"));

  gsap.registerPlugin(ScrollTrigger);
  const lenis = new Lenis({
    wrapper: start,
    content: start.firstElementChild as HTMLElement,
    lerp: 0.085,
    smoothWheel: true,
    autoRaf: false,
  });
  const tick = (value: number): void => lenis.raf(value * 1000);
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
  ScrollTrigger.defaults({ scroller: start });

  const software = isSoftwareRenderer();
  const renderScale = software ? 0.46 : 1;
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: !software, alpha: false });
  renderer.setPixelRatio(software ? 1 : Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(
    Math.round(pin.clientWidth * renderScale),
    Math.round(pin.clientHeight * renderScale),
    false,
  );
  renderer.setClearColor(token("--color-intro-deep"), 1);
  await renderer.init();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(token("--color-intro-deep"));
  scene.fog = new THREE.FogExp2(token("--color-intro-deep"), 0.014);

  const camera = new THREE.PerspectiveCamera(40, pin.clientWidth / pin.clientHeight, 0.1, 220);
  camera.position.set(0, 17, 34);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(token("--color-text-muted"), 1.25));
  const key = new THREE.DirectionalLight(token("--color-accent-bright"), 2.4);
  key.position.set(-18, 26, 20);
  scene.add(key);
  const rim = new THREE.DirectionalLight(token("--color-friend"), 1.5);
  rim.position.set(22, 14, -24);
  scene.add(rim);

  const glow = uniform(0.035);
  const low = tokenColor("--color-surface-3");
  const high = tokenColor("--color-accent");
  const accent = tokenColor("--color-accent-bright");
  const materials = Array.from({ length: 5 }, (_, index) => {
    const material = new THREE.MeshStandardNodeMaterial();
    const tint = mix(color(low), color(high), float(index / 4));
    const shimmer = sin(time.mul(0.45).add(positionLocal.x.mul(0.18))).mul(0.045);
    material.colorNode = mix(
      tint,
      color(accent),
      smoothstep(float(0.05), float(1.1), positionLocal.y.add(shimmer)),
    );
    material.emissiveNode = color(accent).mul(glow);
    material.metalness = 0.28;
    material.roughness = 0.58;
    material.side = THREE.DoubleSide;
    return material;
  });

  const features = await loadPrefFeatures();
  const group = new THREE.Group();
  const geometries: THREE.ExtrudeGeometry[] = [];
  for (const pref of features) {
    const shapes = geometryToShapes(pref.geometry);
    if (!shapes.length) continue;
    const depth = 0.32 + (pref.properties.pref % 7) * 0.17;
    const geometry = new THREE.ExtrudeGeometry(shapes, {
      depth,
      steps: 1,
      curveSegments: 1,
      bevelEnabled: !software,
      bevelThickness: 0.045,
      bevelSize: 0.045,
      bevelSegments: software ? 1 : 2,
    });
    geometry.rotateX(-Math.PI / 2);
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, materials[pref.properties.pref % materials.length]);
    group.add(mesh);
  }
  const bounds = new THREE.Box3().setFromObject(group);
  const center = bounds.getCenter(new THREE.Vector3());
  group.position.set(-center.x, 0, -center.z);
  group.scale.setScalar(1.12);
  scene.add(group);

  const grid = new THREE.GridHelper(96, 48, tokenColor("--color-surface-3"), tokenColor("--color-surface-2"));
  const gridMaterial = grid.material as THREE.Material;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.22;
  grid.position.y = -0.62;
  scene.add(grid);

  const particles = createParticles(software ? 120 : 1100);
  scene.add(particles);

  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode("output");
  pipeline.outputNode = software
    ? sceneColor
    : sceneColor.add(bloom(sceneColor, 0.42, 0.28, 0.82));

  const pixi = new Application();
  await pixi.init({
    canvas: fxCanvas,
    backgroundAlpha: 0,
    resizeTo: pin,
    antialias: true,
    preference: "webgl",
  });
  const overlay = new Graphics();
  pixi.stage.addChild(overlay);
  const gridInk = tokenColor("--color-text");
  const sweepInk = tokenColor("--color-accent-bright");
  let overlayFrame = 0;
  pixi.ticker.add(() => {
    if (start.classList.contains("hidden")) return;
    overlayFrame++;
    if (overlayFrame % 2) return;
    const width = pixi.renderer.width;
    const height = pixi.renderer.height;
    overlay.clear();
    for (let i = 1; i < 14; i++) {
      const y = (i / 14) * height + Math.sin(progress * 6 + i * 0.8) * 7;
      overlay.moveTo(0, y).lineTo(width, y + Math.sin(progress * 4 + i) * 12);
      overlay.stroke({ width: 1, color: gridInk, alpha: 0.055 });
    }
    for (let i = 0; i < 4; i++) {
      const y = height * (0.22 + i * 0.18) + Math.sin(progress * 8 + i) * 18;
      const x = ((progress * (width + 320) + i * 280) % (width + 320)) - 160;
      overlay.moveTo(x - 150, y);
      overlay.lineTo(x, y - 26);
      overlay.lineTo(x + 150, y);
      overlay.stroke({ width: 2, color: sweepInk, alpha: 0.28 });
    }
  });

  const cameraState = { progress: 0 };
  let progress = 0;
  const setProgress = (value: number): void => {
    progress = value;
    cameraState.progress = value;
    start.style.setProperty("--intro-progress", `${Math.round(value * 100)}`);
    steps.forEach((step, index) => {
      step.classList.toggle("active", Math.abs(value - index / (steps.length - 1)) < 0.19);
    });
  };

  const timeline = gsap.timeline({
    scrollTrigger: {
      id: "intro-cinematic",
      trigger: track,
      start: "top top",
      end: "bottom bottom",
      scrub: 1,
      onUpdate: (self) => setProgress(self.progress),
    },
  });
  if (copies[0]) timeline.to(copies[0], { autoAlpha: 0, y: -48, duration: 0.26 }, 0.12);
  if (copies[1]) {
    timeline.fromTo(copies[1], { autoAlpha: 0, y: 56 }, { autoAlpha: 1, y: 0, duration: 0.3 }, 0.2);
    timeline.to(copies[1], { autoAlpha: 0, y: -48, duration: 0.26 }, 0.52);
  }
  if (copies[2]) {
    timeline.fromTo(copies[2], { autoAlpha: 0, y: 56 }, { autoAlpha: 1, y: 0, duration: 0.3 }, 0.6);
  }
  timeline.to(group.rotation, { y: 0.55, duration: 1, ease: "none" }, 0);

  motionAnimate(copies[0]?.querySelectorAll(".intro-kicker, h2, p") ?? [], {
    opacity: [0, 1],
    y: [20, 0],
  }, { duration: 0.9, delay: 0.12, ease: [0.16, 1, 0.3, 1] });

  const onResize = (): void => {
    const width = pin.clientWidth;
    const height = pin.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(Math.round(width * renderScale), Math.round(height * renderScale), false);
  };
  window.addEventListener("resize", onResize);

  const onSkip = (): void => {
    lenis.scrollTo(shell, { duration: 1.1 });
  };
  skip.addEventListener("click", onSkip);

  const clock = new THREE.Clock();
  let disposed = false;
  renderer.setAnimationLoop(() => {
    if (disposed || start.classList.contains("hidden")) return;
    const elapsed = clock.getElapsedTime();
    const p = cameraState.progress;
    const angle = -0.42 + p * 1.28;
    const radius = 30 - p * 7;
    camera.position.set(
      Math.sin(angle) * radius,
      13 + Math.sin(p * Math.PI) * 6 + Math.sin(elapsed * 0.24) * 0.35,
      Math.cos(angle) * radius,
    );
    camera.lookAt(0, 0.4 + p * 1.2, 0);
    glow.value = 0.035 + p * 0.055;
    particles.rotation.y = elapsed * 0.012;
    grid.position.y = -0.62 + Math.sin(elapsed * 0.35) * 0.12;
    void pipeline.render();
  });

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      renderer.setAnimationLoop(null);
      window.removeEventListener("resize", onResize);
      skip.removeEventListener("click", onSkip);
      timeline.scrollTrigger?.kill();
      timeline.kill();
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
      pixi.destroy(false, { children: true });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      (particles.geometry as THREE.BufferGeometry).dispose();
      (particles.material as THREE.Material).dispose();
      grid.geometry.dispose();
      gridMaterial.dispose();
      const disposable = pipeline as unknown as { dispose?: () => void };
      disposable.dispose?.();
      renderer.dispose();
    },
  };
}
