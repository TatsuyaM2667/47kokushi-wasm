import L from "leaflet";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import "leaflet/dist/leaflet.css";
import type { Snapshot } from "./types";
import { PREF_NAMES } from "../engine/data";

export type TileMode = "std" | "terrain" | "photo";

const DETAIL_ZOOM = 7;
let activePlayer = 1;

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const k = (n: number): number => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number): number =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (value: number): string =>
    Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(channel(0))}${hex(channel(8))}${hex(channel(4))}`;
}

export function setPlayer(id: number): void {
  activePlayer = id;
}

const TILE_URLS: Record<TileMode, string> = {
  std: "https://cyberjapandata.gsi.go.jp/xyz/relief/{z}/{x}/{y}.png",
  terrain: "https://cyberjapandata.gsi.go.jp/xyz/relief/{z}/{x}/{y}.png",
  photo: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
};

export function colorOf(id: number): string {
  if (id <= 0) return MAP_COLORS.neutral;
  if (id === activePlayer) return MAP_COLORS.player;
  const hue = Math.round((id * 137.508 + 22) % 360);
  const saturation = 23 + (id % 3) * 5;
  const lightness = 34 + (id % 4) * 3;
  return hslToHex(hue, saturation, lightness);
}

interface TownFeature {
  type: "Feature";
  properties: {
    id: number;
    code: string;
    name: string;
    pref: number;
    pop: number;
  };
  geometry: unknown;
}

interface PrefFeature {
  type: "Feature";
  properties: { pref: number };
  geometry: unknown;
}

interface RouteData {
  id: string;
  kind: "highway" | "shinkansen" | "rail";
  name: string;
  minZoom: number;
  points: [number, number][];
}

interface RoutesPayload {
  routes: RouteData[];
}

interface MapCallbacks {
  onTown(id: number): void;
  onPref(pref: number): void;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const MAP_COLORS = {
  boundary: cssVar("--color-map-boundary"),
  highlight: cssVar("--color-map-highlight"),
  march: cssVar("--color-map-march"),
  neutral: cssVar("--color-map-neutral"),
  player: cssVar("--color-map-player"),
};

function pathKey(style: L.PathOptions): string {
  return [
    style.color,
    style.weight,
    style.opacity,
    style.fillColor,
    style.fillOpacity,
  ].join("|");
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(new URL(url, document.baseURI));
  if (!response.ok) throw new Error(`地図データの読み込みに失敗しました (${response.status})`);
  return (await response.json()) as T;
}

async function readTopology(
  url: string,
): Promise<{ features: unknown[] }> {
  const topology = await fetchJson<Topology<{ raw: GeometryCollection }>>(url);
  return feature(topology, topology.objects.raw) as unknown as {
    features: unknown[];
  };
}

function townStyle(
  feature: TownFeature,
  snap: Snapshot | null,
  selectedTown: number,
  tileMode: TileMode,
  marchingIds: Set<number>,
): L.PathOptions {
  const id = feature.properties.id;
  const town = snap?.towns[id];
  const pref = town?.p ?? feature.properties.pref;
  const owner = town && town.o !== town.p ? town.o : pref;
  const selected = id === selectedTown;
  const marching = marchingIds.has(id);
  const political = tileMode === "std";
  return {
    color: selected ? MAP_COLORS.highlight : marching ? MAP_COLORS.march : MAP_COLORS.boundary,
    weight: selected ? 3.4 : marching ? 2.2 : 1.1,
    opacity: political ? 0.98 : 0.9,
    fillColor: colorOf(owner),
    fillOpacity: political ? (selected ? 0.92 : 0.86) : selected ? 0.72 : 0.42,
    lineJoin: "round",
  };
}

export class JapanMap {
  private readonly map: L.Map;
  private readonly callbacks: MapCallbacks;
  private readonly routeLayer: L.LayerGroup;
  private readonly orderLayer: L.LayerGroup;
  private readonly routes: RouteData[] = [];
  private readonly routePaths = new Map<string, L.Polyline>();
  private readonly layers: L.Path[] = [];
  private readonly layerStyleKeys: string[] = [];
  private readonly prefPaths: L.Path[] = [];
  private readonly prefStyleKeys: string[] = [];
  private prefLabels: string[] = PREF_NAMES.slice();
  private prefLayer: L.GeoJSON | null = null;
  private townLayer: L.GeoJSON | null = null;
  private detailVisible = false;
  private tileLayer: L.TileLayer;
  private tileMode: TileMode = "std";
  private bounds: L.LatLngBounds | null = null;
  private snap: Snapshot | null = null;
  private selectedTown = -1;
  private lastStyleKey = "";

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
    this.map.on("movestart", () => {
      this.map.getContainer().dataset.moving = "1";
    });
    this.map.on("moveend", () => {
      delete this.map.getContainer().dataset.moving;
    });
    this.tileLayer = this.makeTileLayer(this.tileMode).addTo(this.map);
    this.map.getContainer().dataset.layer = this.tileMode;
    this.routeLayer = L.layerGroup();
    this.orderLayer = L.layerGroup();
    this.map.on("zoomend", () => {
      this.syncDetailVisibility();
      this.syncRouteVisibility();
    });
  }

  private makeTileLayer(mode: TileMode): L.TileLayer {
    return L.tileLayer(TILE_URLS[mode], {
      attribution:
        '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
      maxZoom: 13,
      crossOrigin: true,
      opacity: mode === "std" ? 0.52 : 1,
      className: `gsi-layer-${mode}`,
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
    this.map.getContainer().dataset.layer = mode;
    this.lastStyleKey = "";
    this.refreshStyles();
  }

  private prefStyle(feature: PrefFeature): L.PathOptions {
    const pref = feature.properties.pref;
    const owner = this.snap?.prefs[pref - 1]?.owner ?? pref;
    const selected = this.snap?.towns[this.selectedTown]?.p === pref;
    const political = this.tileMode === "std";
    return {
      color: selected ? MAP_COLORS.highlight : MAP_COLORS.boundary,
      weight: selected ? 3.2 : 1.8,
      opacity: 0.98,
      fillColor: colorOf(owner),
      fillOpacity: political ? (selected ? 0.94 : 0.88) : selected ? 0.72 : 0.42,
      lineJoin: "round",
    };
  }

  private refreshStyles(): void {
    if (!this.snap) return;
    const marchingIds = new Set<number>();
    for (const order of this.snap.orders) {
      marchingIds.add(order.from);
      marchingIds.add(order.to);
    }
    for (let id = 0; id < this.layers.length; id++) {
      const path = this.layers[id];
      if (!path) continue;
      const style = townStyle(
        {
          properties: { id, pref: this.snap.towns[id]?.p ?? 1 },
        } as TownFeature,
        this.snap,
        this.selectedTown,
        this.tileMode,
        marchingIds,
      );
      const key = pathKey(style);
      if (this.layerStyleKeys[id] !== key) {
        this.layerStyleKeys[id] = key;
        path.setStyle(style);
      }
    }
    for (let pref = 1; pref < this.prefPaths.length; pref++) {
      const path = this.prefPaths[pref];
      if (!path) continue;
      const style = this.prefStyle({ properties: { pref } } as PrefFeature);
      const key = pathKey(style);
      if (this.prefStyleKeys[pref] !== key) {
        this.prefStyleKeys[pref] = key;
        path.setStyle(style);
      }
    }
  }

  private syncDetailVisibility(): void {
    const detail = this.map.getZoom() >= DETAIL_ZOOM;
    if (detail === this.detailVisible) return;
    this.detailVisible = detail;
    if (detail) {
      if (this.prefLayer) this.map.removeLayer(this.prefLayer);
      if (this.townLayer) this.townLayer.addTo(this.map);
    } else {
      if (this.townLayer) this.map.removeLayer(this.townLayer);
      if (this.prefLayer) this.prefLayer.addTo(this.map);
    }
    this.lastStyleKey = "";
    this.layerStyleKeys.length = 0;
    this.prefStyleKeys.length = 0;
    this.refreshStyles();
  }

  private routeStyle(route: RouteData): L.PolylineOptions {
    const tokens: Record<RouteData["kind"], string> = {
      highway: "--color-route-highway",
      shinkansen: "--color-route-shinkansen",
      rail: "--color-route-rail",
    };
    const widths: Record<RouteData["kind"], number> = {
      highway: 4.5,
      shinkansen: 3.2,
      rail: 3,
    };
    return {
      color: cssVar(tokens[route.kind]),
      weight: widths[route.kind],
      opacity: route.kind === "rail" ? 0.78 : 0.96,
      lineJoin: "round",
      interactive: true,
    };
  }

  private syncRouteVisibility(): void {
    const zoom = this.map.getZoom();
    for (const route of this.routes) {
      const path = this.routePaths.get(route.id);
      if (!path) continue;
      const visible = zoom >= route.minZoom;
      if (visible && !this.map.hasLayer(path)) path.addTo(this.map);
      else if (!visible && this.map.hasLayer(path)) this.map.removeLayer(path);
    }
  }

  setPrefLabels(labels: string[]): void {
    this.prefLabels = labels.slice();
    for (let pref = 1; pref <= this.prefLabels.length; pref++) {
      this.prefPaths[pref]?.setTooltipContent(this.prefLabel(pref));
    }
    this.lastStyleKey = "";
  }

  private prefLabel(pref: number): string {
    return this.prefLabels[pref - 1] ?? `県${pref}`;
  }

  async load(): Promise<void> {
    const [prefectureData, townData, routeData] = await Promise.all([
      readTopology("data/prefectures.json"),
      readTopology("data/municipalities.json"),
      fetchJson<RoutesPayload>("data/routes.json"),
    ]);
    this.routes.push(...routeData.routes);
    this.prefLayer = L.geoJSON(
      prefectureData as unknown as GeoJSON.GeoJsonObject,
      {
        style: (item) =>
          this.prefStyle(item as unknown as PrefFeature),
        onEachFeature: (item, path) => {
          const prefFeature = item as unknown as PrefFeature;
          const pref = prefFeature.properties.pref;
          this.prefPaths[pref] = path as L.Path;
          path.bindTooltip(this.prefLabel(pref), {
            sticky: true,
            direction: "top",
            opacity: 0.92,
          });
          path.on("click", () => {
            const capital = this.snap?.prefs[pref - 1]?.cap;
            if (capital !== undefined) this.callbacks.onTown(capital);
            this.callbacks.onPref(pref);
          });
        },
      },
    ).addTo(this.map);
    const emptyMarchingIds = new Set<number>();
    this.townLayer = L.geoJSON(townData as unknown as GeoJSON.GeoJsonObject, {
      style: (item) =>
        townStyle(
          item as unknown as TownFeature,
          this.snap,
          this.selectedTown,
          this.tileMode,
          emptyMarchingIds,
        ),
      onEachFeature: (item, path) => {
        const townFeature = item as unknown as TownFeature;
        const id = townFeature.properties.id;
        this.layers[id] = path as L.Path;
        path.bindTooltip(
          `${townFeature.properties.name}／${this.prefLabel(townFeature.properties.pref)}`,
          { sticky: true, direction: "top", opacity: 0.92 },
        );
        path.on("click", () => {
          this.callbacks.onTown(id);
          this.callbacks.onPref(townFeature.properties.pref);
        });
      },
    });
    for (const route of this.routes) {
      const path = L.polyline(
        route.points as L.LatLngTuple[],
        this.routeStyle(route),
      );
      path.bindTooltip(route.name, {
        sticky: true,
        direction: "top",
        opacity: 0.92,
      });
      this.routePaths.set(route.id, path);
      this.routeLayer.addLayer(path);
    }
    this.map.removeLayer(this.orderLayer);
    this.routeLayer.addTo(this.map);
    this.orderLayer.addTo(this.map);
    this.bounds = this.prefLayer.getBounds();
    if (this.bounds.isValid()) this.map.fitBounds(this.bounds, { padding: [8, 8] });
    this.syncDetailVisibility();
    this.syncRouteVisibility();
  }

  resize(): void {
    this.map.invalidateSize();
  }

  invalidate(): void {
    window.setTimeout(() => this.map.invalidateSize(), 60);
  }

  update(snap: Snapshot, selectedTown: number): void {
    const styleKey = [
      snap.turn,
      snap.player,
      selectedTown,
      this.tileMode,
      snap.orders.map((order) => `${order.from}-${order.to}`).join(","),
      snap.prefs.map((pref) => `${pref.id}:${pref.name}`).join(","),
      this.prefLabels.join(","),
    ].join("|");
    this.snap = snap;
    this.selectedTown = selectedTown;
    setPlayer(snap.player);
    if (styleKey !== this.lastStyleKey) {
      this.lastStyleKey = styleKey;
      this.refreshStyles();
    }
    this.orderLayer.clearLayers();
    for (const order of snap.orders) {
      const from = snap.towns[order.from];
      const to = snap.towns[order.to];
      if (!from || !to) continue;
      const points: L.LatLngTuple[] = [
        [from.lat, from.lon],
        [to.lat, to.lon],
      ];
      L.polyline(points, {
        color: "#efe2c4",
        weight: 5,
        opacity: 0.6,
        interactive: false,
      }).addTo(this.orderLayer);
      const line = L.polyline(points, {
        color: "#a94533",
        weight: 2.5,
        opacity: 0.95,
        dashArray: order.sea ? "2 7" : "8 5",
      });
      line.bindTooltip(
        `${Math.round(order.troops).toLocaleString("ja-JP")}兵 ${order.sea ? "（海路）" : ""}`,
        { permanent: true, direction: "center", className: "order-tip" },
      );
      this.orderLayer.addLayer(line);
    }
  }

  focusTown(id: number): void {
    const town = this.snap?.towns[id];
    if (!town || !Number.isFinite(town.lat) || !Number.isFinite(town.lon))
      return;
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
    if (this.bounds?.isValid())
      this.map.flyToBounds(this.bounds, { padding: [8, 8], duration: 0.45 });
  }
}
