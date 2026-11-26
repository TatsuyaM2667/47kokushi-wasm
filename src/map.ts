import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Snapshot } from "./types";
import { PREF_NAMES } from "../engine/data";

export type TileMode = "std" | "terrain" | "photo";

const TILE_URLS: Record<TileMode, string> = {
  std: "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png",
  terrain: "https://cyberjapandata.gsi.go.jp/xyz/relief/{z}/{x}/{y}.png",
  photo: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
};

export function colorOf(id: number): string {
  if (id <= 0) return "#3b4140";
  if (id === 1) return "#3f7fd0";
  const hue = Math.round((id * 137.508 + 24) % 360);
  const saturation = 54 + (id % 3) * 8;
  const lightness = 38 + (id % 4) * 5;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

interface TownFeature {
  type: "Feature";
  properties: { id: number; code: string; name: string; pref: number; pop: number };
  geometry: unknown;
}

interface MapCallbacks {
  onTown(id: number): void;
  onPref(pref: number): void;
}

function styleOf(feature: TownFeature, snap: Snapshot | null, selectedTown: number): L.PathOptions {
  const id = feature.properties.id;
  const town = snap?.towns[id];
  const owner = town?.o ?? feature.properties.pref;
  const selected = id === selectedTown;
  const marching = snap?.orders.some((order) => order.from === id || order.to === id) ?? false;
  return {
    color: selected ? "#ffd35c" : marching ? "#f4ad55" : "#080a09",
    weight: selected ? 3.6 : marching ? 2.6 : 1.5,
    opacity: 0.98,
    fillColor: colorOf(owner),
    fillOpacity: selected ? 0.9 : 0.78,
    lineJoin: "round",
  };
}

export class JapanMap {
  private readonly map: L.Map;
  private readonly callbacks: MapCallbacks;
  private readonly orderLayer: L.LayerGroup;
  private readonly layers: L.Path[] = [];
  private tileLayer: L.TileLayer;
  private tileMode: TileMode = "std";
  private bounds: L.LatLngBounds | null = null;
  private snap: Snapshot | null = null;
  private selectedTown = -1;

  constructor(elementId: string, callbacks: MapCallbacks) {
    this.callbacks = callbacks;
    this.map = L.map(elementId, {
      preferCanvas: true,
      zoomControl: true,
      attributionControl: true,
      minZoom: 4,
      maxZoom: 13,
      zoomSnap: 0.5,
      worldCopyJump: false,
    });
    this.map.setView([36.2, 138.2], 5);
    this.tileLayer = this.makeTileLayer(this.tileMode).addTo(this.map);
    this.orderLayer = L.layerGroup().addTo(this.map);
  }

  private makeTileLayer(mode: TileMode): L.TileLayer {
    return L.tileLayer(TILE_URLS[mode], {
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
      maxZoom: 13,
      crossOrigin: true,
    });
  }

  getMap(): L.Map {
    return this.map;
  }

  setTileMode(mode: TileMode): void {
    if (mode === this.tileMode) return;
    this.map.removeLayer(this.tileLayer);
    this.tileMode = mode;
    this.tileLayer = this.makeTileLayer(mode).addTo(this.map);
    this.tileLayer.bringToBack();
  }

  async load(): Promise<void> {
    const response = await fetch(new URL("data/municipalities.json", document.baseURI));
    if (!response.ok) throw new Error(`地図データの読み込みに失敗しました (${response.status})`);
    const data = (await response.json()) as { features: TownFeature[] };
    const layer = L.geoJSON(data as unknown as GeoJSON.GeoJsonObject, {
      style: (feature) => styleOf(feature as unknown as TownFeature, this.snap, this.selectedTown),
      onEachFeature: (feature, path) => {
        const townFeature = feature as unknown as TownFeature;
        const id = townFeature.properties.id;
        this.layers[id] = path as L.Path;
        path.bindTooltip(`${townFeature.properties.name}／${PREF_NAMES[townFeature.properties.pref - 1]}`, {
          sticky: true,
          direction: "top",
          opacity: 0.92,
        });
        path.on("click", () => {
          this.callbacks.onTown(id);
          this.callbacks.onPref(townFeature.properties.pref);
        });
        path.on("mouseover", () => {
          if (id !== this.selectedTown) (path as L.Path).setStyle({ weight: 2.4, fillOpacity: 0.88 });
        });
        path.on("mouseout", () => {
          if (id !== this.selectedTown && this.snap) {
            (path as L.Path).setStyle(styleOf(townFeature, this.snap, this.selectedTown));
          }
        });
      },
    }).addTo(this.map);
    this.bounds = layer.getBounds();
    if (this.bounds.isValid()) this.map.fitBounds(this.bounds, { padding: [8, 8] });
  }

  resize(): void {
    this.map.invalidateSize();
  }

  invalidate(): void {
    window.setTimeout(() => this.map.invalidateSize(), 60);
  }

  update(snap: Snapshot, selectedTown: number): void {
    this.snap = snap;
    this.selectedTown = selectedTown;
    for (let id = 0; id < this.layers.length; id++) {
      const path = this.layers[id];
      if (!path) continue;
      const feature = { properties: { id, pref: snap.towns[id]?.p ?? 1 } } as TownFeature;
      path.setStyle(styleOf(feature, snap, selectedTown));
      if (path.bringToFront && id === selectedTown) path.bringToFront();
    }
    this.orderLayer.clearLayers();
    for (const order of snap.orders) {
      const from = snap.towns[order.from];
      const to = snap.towns[order.to];
      if (!from || !to) continue;
      const points: L.LatLngTuple[] = [[from.lat, from.lon], [to.lat, to.lon]];
      L.polyline(points, { color: "#f6e6c2", weight: 6, opacity: 0.7, interactive: false }).addTo(this.orderLayer);
      const line = L.polyline(points, {
        color: "#8e2c20",
        weight: 3,
        opacity: 0.95,
        dashArray: order.sea ? "2 7" : "8 5",
      });
      line.bindTooltip(`${Math.round(order.troops).toLocaleString("ja-JP")}兵 ${order.sea ? "（海路）" : ""}`, {
        permanent: true,
        direction: "center",
        className: "order-tip",
      });
      this.orderLayer.addLayer(line);
    }
  }

  focusTown(id: number): void {
    const town = this.snap?.towns[id];
    if (!town || !Number.isFinite(town.lat) || !Number.isFinite(town.lon)) return;
    const current = this.map.getZoom();
    const zoom = Number.isFinite(current) ? current : 5;
    this.map.flyTo([town.lat, town.lon], Math.max(zoom, 8), { duration: 0.45 });
  }

  focusPref(pref: number): void {
    if (!this.snap) return;
    const capital = this.snap.prefs[pref - 1]?.cap;
    const town = capital === undefined ? undefined : this.snap.towns[capital];
    if (town) this.focusTown(town.id);
  }

  resetView(): void {
    if (this.bounds?.isValid()) this.map.fitBounds(this.bounds, { padding: [8, 8] });
  }
}
