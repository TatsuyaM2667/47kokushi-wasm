import json
import math
import re
import subprocess
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE_DATA = ROOT / "engine" / "data.ts"
OUT_TS = ROOT / "engine" / "realdata.ts"
OUT_GEOJSON = ROOT / "public" / "data" / "municipalities.json"

POP_INDEX = "https://machi-report.com/data/index.json"
BOUNDARY_URL = (
    "https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/"
    "data/municipality/geojson/s0010/N03-21_210101.json"
)

PREF_NAMES = [
    "北海道", "青森", "岩手", "宮城", "秋田", "山形", "福島", "茨城", "栃木", "群馬",
    "埼玉", "千葉", "東京", "神奈川", "新潟", "富山", "石川", "福井", "山梨", "長野",
    "岐阜", "静岡", "愛知", "三重", "滋賀", "京都", "大阪", "兵庫", "奈良", "和歌山",
    "鳥取", "島根", "岡山", "広島", "山口", "徳島", "香川", "愛媛", "高知", "福岡",
    "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄",
]

CAPITAL_NAMES = [
    "札幌", "青森", "盛岡", "仙台", "秋田", "山形", "福島", "水戸", "宇都宮", "前橋",
    "さいたま", "千葉", "新宿", "横浜", "新潟", "富山", "金沢", "福井", "甲府", "長野",
    "岐阜", "静岡", "名古屋", "津", "大津", "京都", "大阪", "神戸", "奈良", "和歌山",
    "鳥取", "松江", "岡山", "広島", "山口", "徳島", "高松", "松山", "高知", "福岡",
    "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "那覇",
]

PORT_HINTS = ("港", "浜", "浦", "島", "津", "崎", "岬", "瀬", "戸", "湾", "岸", "船", "渡", "海", "潟", "洲")
SEA_HINTS = ("海", "港", "浜", "浦", "島", "津", "崎", "岬", "瀬", "湾", "魚", "漁")
RICE_HINTS = ("米", "田", "稲", "農", "庄", "郡")
FRUIT_HINTS = ("果", "りんご", "林檎", "みかん", "蜜柑", "葡萄", "ぶどう", "桃", "梨", "柿", "苺", "いちご")
SAKE_HINTS = ("酒", "茶", "醸", "蔵", "富士")
CRAFT_HINTS = ("工", "技", "製", "織", "陶", "金", "鉄", "紙", " Silk", "絹")
MEAT_HINTS = ("牛", "豚", "肉", "畜", "牧")
VEG_HINTS = ("野菜", "畑", "菜", "根", "芋", "豆")
SIGHT_HINTS = ("温泉", "湯", "寺", "社", "城", "公園", "湖", "山", "岳", "峡")


def fetch_json(url: str):
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.load(response)


def normalize_pref(name: str) -> str:
    return re.sub(r"(都|府|県)$", "", name)


def parse_i32_array(name: str) -> list[int]:
    text = ENGINE_DATA.read_text(encoding="utf-8")
    match = re.search(rf"export const {name}: i32\[\] = \[(.*?)\];", text, re.S)
    if not match:
        raise RuntimeError(f"{name} を {ENGINE_DATA} から読み取れませんでした")
    return [int(value) for value in re.findall(r"-?\d+", match.group(1))]


def ring_area(ring: list[list[float]]) -> float:
    total = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        total += x1 * y2 - x2 * y1
    return total / 2.0


def ring_center(ring: list[list[float]]) -> tuple[float, float]:
    area = ring_area(ring)
    if abs(area) < 1e-12:
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return sum(xs) / len(xs), sum(ys) / len(ys)
    cx = cy = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        cross = x1 * y2 - x2 * y1
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    return cx / (6.0 * area), cy / (6.0 * area)


def geometry_rings(geometry: dict) -> list[list[list[float]]]:
    kind = geometry["type"]
    if kind == "Polygon":
        return [ring for ring in geometry["coordinates"] if len(ring) >= 4]
    if kind == "MultiPolygon":
        rings: list[list[list[float]]] = []
        for polygon in geometry["coordinates"]:
            if polygon and len(polygon[0]) >= 4:
                rings.append(polygon[0])
        return rings
    return []


def geometry_center(geometry: dict) -> tuple[float, float]:
    rings = geometry_rings(geometry)
    if not rings:
        return 0.0, 0.0
    main = max(rings, key=lambda ring: abs(ring_area(ring)))
    return ring_center(main)


def clean_ring(ring: list[list[float]], epsilon: float = 0.0006) -> list[list[float]]:
    points = [[round(float(x), 4), round(float(y), 4)] for x, y in ring]
    deduped: list[list[float]] = []
    for point in points:
        if not deduped or deduped[-1] != point:
            deduped.append(point)
    if len(deduped) > 1 and deduped[0] == deduped[-1]:
        deduped.pop()
    if len(deduped) < 3:
        return []
    return simplify_ring(deduped, epsilon)


def perpendicular_distance(point: list[float], start: list[float], end: list[float]) -> float:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    if dx == 0 and dy == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy))


def simplify_ring(points: list[list[float]], epsilon: float) -> list[list[float]]:
    if len(points) <= 4:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        max_distance = -1.0
        index = -1
        for i in range(first + 1, last):
            distance = perpendicular_distance(points[i], points[first], points[last])
            if distance > max_distance:
                max_distance = distance
                index = i
        if index >= 0 and max_distance > epsilon:
            keep[index] = True
            stack.append((first, index))
            stack.append((index, last))
    output = [point for point, selected in zip(points, keep) if selected]
    return output if len(output) >= 3 else points


def clean_geometry(geometry: dict) -> dict | None:
    if geometry["type"] == "Polygon":
        rings = [clean_ring(ring) for ring in geometry["coordinates"]]
        rings = [ring for ring in rings if ring]
        if not rings:
            return None
        rings.append(rings[0][:])
        return {"type": "Polygon", "coordinates": rings}
    if geometry["type"] == "MultiPolygon":
        polygons: list[list[list[list[float]]]] = []
        for polygon in geometry["coordinates"]:
            rings = [clean_ring(ring) for ring in polygon]
            rings = [ring for ring in rings if ring]
            if rings:
                rings.append(rings[0][:])
                polygons.append(rings)
        if not polygons:
            return None
        return {"type": "MultiPolygon", "coordinates": polygons}
    return None


def haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = math.radians(a[1]), math.radians(a[0])
    lat2, lon2 = math.radians(b[1]), math.radians(b[0])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0 * 2.0 * math.asin(math.sqrt(value))


def is_port(pref: int, name: str, pop: int, rank: int) -> int:
    if pref not in COASTAL:
        return 0
    if any(hint in name for hint in PORT_HINTS):
        return 1
    return 1 if rank <= 4 else 0


def specialty_of(name: str) -> int:
    if any(hint in name for hint in SEA_HINTS):
        return 2
    if any(hint in name for hint in RICE_HINTS):
        return 1
    if any(hint in name for hint in FRUIT_HINTS):
        return 3
    if any(hint in name for hint in VEG_HINTS):
        return 4
    if any(hint in name for hint in MEAT_HINTS):
        return 5
    if any(hint in name for hint in SAKE_HINTS):
        return 6
    if any(hint in name for hint in CRAFT_HINTS):
        return 7
    if any(hint in name for hint in SIGHT_HINTS):
        return 9
    return 0


def as_string_array(name: str, values: list[str]) -> str:
    items = ",".join(json.dumps(value, ensure_ascii=False) for value in values)
    return f"export const {name}: string[] = [{items}];"


def as_number_array(name: str, kind: str, values: list) -> str:
    items = ",".join(str(value) for value in values)
    return f"export const {name}: {kind}[] = [{items}];"


def main() -> None:
    land_pairs = parse_i32_array("LAND_PAIRS")
    sea_pairs = parse_i32_array("SEA_PAIRS")
    global COASTAL, NAVAL
    COASTAL = set(parse_i32_array("COASTAL"))
    NAVAL = set(parse_i32_array("NAVAL"))

    print("人口データを取得しています…")
    index = fetch_json(POP_INDEX)
    population_rows: list[dict] = []
    for entry in index["prefectures"]:
        data = fetch_json("https://machi-report.com" + entry["json"])
        population_rows.extend(city for city in data["cities"] if city["classType"] != "seirei-ku")

    pref_order = {name: i + 1 for i, name in enumerate(PREF_NAMES)}
    for row in population_rows:
        row["pref"] = normalize_pref(row["pref"])
    population_rows = [row for row in population_rows if row["pref"] in pref_order]
    population_rows.sort(key=lambda row: (pref_order[row["pref"]], row["code"]))
    print(f"人口データ: {len(population_rows)} 市区町村")

    print("行政界データを取得しています…")
    boundary = fetch_json(BOUNDARY_URL)
    geometry_by_code: dict[str, dict] = {}
    for feature in boundary["features"]:
        code = str(feature["properties"].get("N03_007") or "")
        if code and code not in geometry_by_code:
            geometry_by_code[code] = feature["geometry"]
    for row in population_rows:
        code = row["code"]
        if code in geometry_by_code:
            continue
        ward_geometries = [
            geometry_by_code[ward_code]
            for ward_code in geometry_by_code
            if ward_code != code and ward_code.startswith(code[:4])
        ]
        if not ward_geometries:
            continue
        polygons: list[list[list[list[float]]]] = []
        for geometry in ward_geometries:
            if geometry["type"] == "Polygon":
                polygons.append(geometry["coordinates"])
            elif geometry["type"] == "MultiPolygon":
                polygons.extend(geometry["coordinates"])
        geometry_by_code[code] = {"type": "MultiPolygon", "coordinates": polygons}
    print(f"行政界データ: {len(geometry_by_code)} 市区町村")

    towns: list[dict] = []
    missing_geometry = 0
    for row in population_rows:
        code = row["code"]
        geometry = geometry_by_code.get(code)
        if geometry is None:
            missing_geometry += 1
            continue
        lon, lat = geometry_center(geometry)
        pref = pref_order[row["pref"]]
        towns.append({
            "code": code,
            "name": row["name"],
            "pref": pref,
            "pop": int(row["pop"] or 0),
            "tax": float(row["avgTaxableIncomeRecurring"] or 8000),
            "growth": float(row["popChange"] or 0),
            "elder": float(row["elderRate"] or 25),
            "lon": lon,
            "lat": lat,
            "geometry": geometry,
        })
    if missing_geometry:
        print(f"行政界が見つからない {missing_geometry} 町を除外しました")
    print(f"利用する市区町村: {len(towns)}")

    pop_by_pref = [0] * (len(PREF_NAMES) + 1)
    for town in towns:
        pop_by_pref[town["pref"]] += max(1, town["pop"])

    rank_by_pref: dict[int, list[int]] = {p: [] for p in range(1, len(PREF_NAMES) + 1)}
    for ordered in sorted(range(len(towns)), key=lambda i: -towns[i]["pop"]):
        rank_by_pref[towns[ordered]["pref"]].append(ordered)
    rank_map = {index: rank + 1 for pref, ids in rank_by_pref.items() for rank, index in enumerate(ids)}

    capitals = [0] * len(PREF_NAMES)
    for pref, capital_name in enumerate(CAPITAL_NAMES, start=1):
        candidates = rank_by_pref[pref]
        match = next((i for i in candidates if towns[i]["name"] == capital_name), -1)
        if match < 0:
            match = next((i for i in candidates if towns[i]["name"].startswith(capital_name)), -1)
        if match < 0:
            match = next((i for i in candidates if capital_name.startswith(towns[i]["name"])), -1)
        capitals[pref - 1] = match if match >= 0 else candidates[0]

    ports: list[int] = []
    specialties: list[int] = []
    for index, town in enumerate(towns):
        ports.append(is_port(town["pref"], town["name"], town["pop"], rank_map[index]))
        specialties.append(specialty_of(town["name"]))

    land_adj: dict[int, set[int]] = {i: set() for i in range(len(towns))}
    land_adj_set = set()
    for a in range(0, len(land_pairs), 2):
        land_adj_set.add((land_pairs[a], land_pairs[a + 1]))
        land_adj_set.add((land_pairs[a + 1], land_pairs[a]))

    for i, town in enumerate(towns):
        same: list[tuple[float, int]] = []
        cross: list[tuple[float, int]] = []
        for j, other in enumerate(towns):
            if i == j:
                continue
            pref_pair = (town["pref"], other["pref"])
            distance = haversine((town["lon"], town["lat"]), (other["lon"], other["lat"]))
            if town["pref"] == other["pref"]:
                same.append((distance, j))
            elif pref_pair in land_adj_set and distance < 90.0:
                cross.append((distance, j))
        same.sort()
        cross.sort()
        for _, j in same[:6]:
            land_adj[i].add(j)
            land_adj[j].add(i)
        for _, j in cross[:2]:
            land_adj[i].add(j)
            land_adj[j].add(i)

    land_edges: set[tuple[int, int]] = set()
    for i, neighbors in land_adj.items():
        for j in neighbors:
            land_edges.add((min(i, j), max(i, j)))

    sea_edges: set[tuple[int, int]] = set()
    for a in range(0, len(sea_pairs), 2):
        pref_a, pref_b = sea_pairs[a], sea_pairs[a + 1]
        group_a = [i for i, town in enumerate(towns) if town["pref"] == pref_a and ports[i]]
        group_b = [i for i, town in enumerate(towns) if town["pref"] == pref_b and ports[i]]
        pairs: list[tuple[float, int, int]] = []
        for i in group_a:
            for j in group_b:
                distance = haversine((towns[i]["lon"], towns[i]["lat"]), (towns[j]["lon"], towns[j]["lat"]))
                if distance < 420.0:
                    pairs.append((distance, i, j))
        pairs.sort()
        used_a: dict[int, int] = {}
        used_b: dict[int, int] = {}
        for _, i, j in pairs:
            if used_a.get(i, 0) >= 2 or used_b.get(j, 0) >= 2:
                continue
            used_a[i] = used_a.get(i, 0) + 1
            used_b[j] = used_b.get(j, 0) + 1
            edge = (min(i, j), max(i, j))
            if edge not in land_edges:
                sea_edges.add(edge)

    print(f"陸路 {len(land_edges)} 辺 / 海路 {len(sea_edges)} 辺")

    ts_lines = [
        "// Generated by scripts/generate-data.py. Do not edit manually.",
        f"export const REAL_TOWN_COUNT: i32 = {len(towns)};",
        as_string_array("REAL_NAMES", [town["name"] for town in towns]),
        as_string_array("REAL_CODES", [town["code"] for town in towns]),
        as_number_array("REAL_PREF", "i32", [town["pref"] for town in towns]),
        as_number_array("REAL_POP", "f64", [round(town["pop"] / 10000.0, 3) for town in towns]),
        as_number_array("REAL_LON", "f64", [round(town["lon"], 4) for town in towns]),
        as_number_array("REAL_LAT", "f64", [round(town["lat"], 4) for town in towns]),
        as_number_array("REAL_TAX", "f64", [round(town["tax"], 1) for town in towns]),
        as_number_array("REAL_GROWTH", "f64", [round(town["growth"], 2) for town in towns]),
        as_number_array("REAL_ELDER", "f64", [round(town["elder"], 2) for town in towns]),
        as_number_array("REAL_CAPITAL", "i32", capitals),
        as_number_array("REAL_PORT", "i32", ports),
        as_number_array("REAL_SPECIAL", "i32", specialties),
        as_number_array("REAL_LAND_EDGES", "i32", [value for edge in sorted(land_edges) for value in edge]),
        as_number_array("REAL_SEA_EDGES", "i32", [value for edge in sorted(sea_edges) for value in edge]),
        as_number_array("REAL_PREF_POP", "f64", [round(value / 10000.0, 3) for value in pop_by_pref]),
    ]
    OUT_TS.write_text("\n".join(ts_lines) + "\n", encoding="utf-8")

    features = []
    for index, town in enumerate(towns):
        geometry = clean_geometry(town["geometry"])
        if geometry is None:
            continue
        features.append({
            "type": "Feature",
            "properties": {
                "id": index,
                "code": town["code"],
                "name": town["name"],
                "pref": town["pref"],
                "pop": town["pop"],
            },
            "geometry": geometry,
        })

    meta = {
        "boundary": "国土数値情報 行政区域データ（N03-21, 2021）を smartnews-smri/japan-topography の簡素化データから生成",
        "boundaryLicense": "CC BY 4.0 / 国土交通省",
        "population": "街の通信簿 (https://machi-report.com) の市区町村別統計（令和7年国勢調査・総務省等に由来）",
        "populationLicense": "出典表示＋リンク",
        "tiles": "国土地理院 地理院タイル",
        "generatedTowns": len(features),
        "simplifiedWith": "mapshaper 8% keep-shapes",
    }
    geojson = {"type": "FeatureCollection", "meta": meta, "features": features}
    with tempfile.TemporaryDirectory() as temporary:
        raw_path = Path(temporary) / "raw.json"
        output_path = Path(temporary) / "simplified.json"
        raw_path.write_text(json.dumps(geojson, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        subprocess.run(
            ["npx", "--yes", "mapshaper", str(raw_path), "-simplify", "8%", "keep-shapes",
             "-o", "format=geojson", str(output_path)],
            check=True,
        )
        simplified = json.loads(output_path.read_text(encoding="utf-8"))
        simplified["meta"] = meta
        OUT_GEOJSON.write_text(
            json.dumps(simplified, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
    print(f"{OUT_TS} と {OUT_GEOJSON} を生成しました")


if __name__ == "__main__":
    main()
