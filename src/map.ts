import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Snapshot } from "./types";
import { PREF_NAMES } from "../engine/data";

export function colorOf(id: number): string {
  const hue = (id * 137 + 18) % 360;
  const saturation = 38 + (id % 4) * 7;
  const lightness = 35 + (id % 5) * 5;
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
    color: selected ? "#ffd35c" : marching ? "#f0a45a" : "rgba(38, 44, 39, 0.75)",
    weight: selected ? 3 : marching ? 2 : 0.7,
    opacity: 0.95,
    fillColor: colorOf(owner),
    fillOpacity: selected ? 0.86 : 0.62,
  };
}

export class JapanMap {
  private readonly map: L.Map;
  private readonly callbacks: MapCallbacks;
  private readonly orderLayer: L.LayerGroup;
  private readonly layers: L.Path[] = [];
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
    L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", {
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
      maxZoom: 13,
      crossOrigin: true,
    }).addTo(this.map);
    this.orderLayer = L.layerGroup().addTo(this.map);
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
          if (id !== this.selectedTown) (path as L.Path).setStyle({ weight: 1.8, fillOpacity: 0.76 });
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
      const line = L.polyline([[from.lat, from.lon], [to.lat, to.lon]], {
        color: "#8e2c20",
        weight: 3,
        opacity: 0.85,
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
