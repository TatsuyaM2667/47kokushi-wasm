import {
  PREF_COUNT, PREF_NAMES, SPECIALS, PERSONALITIES,
  NAVAL, REGIONS, REGION_NAMES, STARS,
} from "./data";
import {
  REAL_TOWN_COUNT, REAL_NAMES, REAL_PREF, REAL_POP, REAL_LON, REAL_LAT,
  REAL_TAX, REAL_GROWTH, REAL_ELDER, REAL_CAPITAL, REAL_PORT, REAL_SPECIAL,
  REAL_LAND_EDGES, REAL_SEA_EDGES, REAL_PREF_POP,
} from "./realdata";

export class Town {
  id: i32 = 0;
  pref: i32 = 0;
  name: string = "";
  owner: i32 = 0;
  pop: f64 = 0;
  lon: f64 = 0;
  lat: f64 = 0;
  tax: f64 = 0;
  growth: f64 = 0;
  elder: f64 = 0;
  troops: i32 = 0;
  morale: i32 = 60;
  castle: i32 = 0;
  commerce: i32 = 0;
  farm: i32 = 0;
  industry: i32 = 0;
  port: i32 = 0;
  capitalTown: i32 = 0;
  specialty: i32 = -1;
  fortify: i32 = 0;
  supplyCut: i32 = 0;
  initialOwner: i32 = 0;
}

export class Faction {
  id: i32 = 0;
  name: string = "";
  capitalTown: i32 = 0;
  budget: f64 = 0;
  food: i32 = 0;
  equip: i32 = 0;
  ships: i32 = 0;
  morale: i32 = 60;
  moraleBase: i32 = 60;
  support: f64 = 60;
  momentum: i32 = 0;
  goodMonths: i32 = 0;
  personality: i32 = 0;
  alive: i32 = 1;
  chaos: i32 = 0;
  towns: i32 = 0;
  pop: f64 = 0;
  gained: i32 = 0;
  vassalOf: i32 = 0;
  captured: i32 = 0;
  lost: i32 = 0;
}

export class Order {
  id: i32 = 0;
  owner: i32 = 0;
  from: i32 = 0;
  to: i32 = 0;
  troops: i32 = 0;
  eta: i32 = 0;
  sea: i32 = 0;
}

export class News {
  turn: i32 = 0;
  kind: i32 = 0;
  text: string = "";
}

export class Game {
  seed: i32 = 0;
  turn: i32 = 0;
  difficulty: i32 = 1;
  length: i32 = 1;
  player: i32 = 13;
  ap: i32 = 0;
  apMax: i32 = 0;
  result: i32 = 0;
  rng: u32 = 1;
  lastOk: i32 = 1;
  lastMsg: string = "";
  towns: Town[] = [];
  neighborStart: i32[] = [];
  neighborTo: i32[] = [];
  neighborKind: i32[] = [];
  factions: Faction[] = [];
  orders: Order[] = [];
  news: News[] = [];
  rel: i32[] = [];
  treaty: i32[] = [];
  treatyTurns: i32[] = [];
  proposals: i32[] = [];
  battleReport: string = "";
  orderSeq: i32 = 0;
  rank: i32[] = [];
  brand: i32[] = [];
}

export let game: Game = new Game();

function clamp(v: f64, lo: f64, hi: f64): f64 {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function clampI(v: i32, lo: i32, hi: i32): i32 {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function rnd(): u32 {
  let x: u32 = game.rng;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  game.rng = x;
  return x;
}

function rndInt(n: i32): i32 {
  if (n <= 0) return 0;
  return <i32>(rnd() % <u32>n);
}

function rndF(): f64 {
  return <f64>rnd() / 4294967296.0;
}

function f1(v: f64): string {
  let n = Math.round(v * 10.0) / 10.0;
  if (n == 0) return "0";
  return n.toString();
}

function q(s: string): string {
  let out = "\"";
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c == 34) out += "\\\"";
    else if (c == 92) out += "\\\\";
    else if (c == 10) out += "\\n";
    else if (c == 13) out += "\\r";
    else if (c == 9) out += "\\t";
    else out += s.charAt(i);
  }
  return out + "\"";
}

function field(buf: string, name: string, value: string, comma: bool): string {
  if (comma) buf += ",";
  buf += q(name) + ":" + value;
  return buf;
}

export function faction(id: i32): Faction {
  return game.factions[id - 1];
}

export function playerFaction(): Faction {
  return faction(game.player);
}

export function town(id: i32): Town {
  return game.towns[id];
}

function idx(a: i32, b: i32): i32 {
  return a * (PREF_COUNT + 1) + b;
}

function naval(p: i32): bool {
  for (let i = 0; i < NAVAL.length; i++) if (NAVAL[i] == p) return true;
  return false;
}

function region(p: i32): i32 {
  if (p >= 1 && p <= PREF_COUNT) return REGIONS[p - 1];
  return 0;
}

function regionName(p: i32): string {
  return REGION_NAMES[region(p)];
}

function hasTreaty(a: i32, b: i32, bit: i32): bool {
  if (a == b) return false;
  let k = idx(a, b);
  return (game.treaty[k] & bit) != 0 && game.treatyTurns[k] > 0;
}

function setTreaty(a: i32, b: i32, bit: i32, months: i32): void {
  let k = idx(a, b);
  game.treaty[k] |= bit;
  game.treatyTurns[k] = <i32>Math.max(<f64>game.treatyTurns[k], <f64>months);
  let k2 = idx(b, a);
  game.treaty[k2] |= bit;
  game.treatyTurns[k2] = <i32>Math.max(<f64>game.treatyTurns[k2], <f64>months);
}

function adjustRel(a: i32, b: i32, delta: i32): void {
  let k = idx(a, b);
  game.rel[k] = clampI(game.rel[k] + delta, -100, 100);
  game.rel[idx(b, a)] = game.rel[k];
}

function buildNeighbors(): void {
  let count = REAL_TOWN_COUNT;
  game.neighborStart = new Array<i32>(count + 1);
  let counts = new Array<i32>(count);
  let i: i32;
  for (i = 0; i < count; i++) counts[i] = 0;
  for (i = 0; i < REAL_LAND_EDGES.length; i += 2) {
    counts[REAL_LAND_EDGES[i]]++;
    counts[REAL_LAND_EDGES[i + 1]]++;
  }
  for (i = 0; i < REAL_SEA_EDGES.length; i += 2) {
    counts[REAL_SEA_EDGES[i]]++;
    counts[REAL_SEA_EDGES[i + 1]]++;
  }
  game.neighborStart[0] = 0;
  for (i = 0; i < count; i++) game.neighborStart[i + 1] = game.neighborStart[i] + counts[i];
  let total = game.neighborStart[count];
  game.neighborTo = new Array<i32>(total);
  game.neighborKind = new Array<i32>(total);
  let cursor = new Array<i32>(count);
  for (i = 0; i < count; i++) cursor[i] = game.neighborStart[i];
  for (i = 0; i < REAL_LAND_EDGES.length; i += 2) {
    let a = REAL_LAND_EDGES[i];
    let b = REAL_LAND_EDGES[i + 1];
    let pa = cursor[a]++;
    game.neighborTo[pa] = b;
    game.neighborKind[pa] = 1;
    let pb = cursor[b]++;
    game.neighborTo[pb] = a;
    game.neighborKind[pb] = 1;
  }
  for (i = 0; i < REAL_SEA_EDGES.length; i += 2) {
    let a = REAL_SEA_EDGES[i];
    let b = REAL_SEA_EDGES[i + 1];
    if (REAL_PORT[a] == 0 || REAL_PORT[b] == 0) continue;
    let pa = cursor[a]++;
    game.neighborTo[pa] = b;
    game.neighborKind[pa] = 2;
    let pb = cursor[b]++;
    game.neighborTo[pb] = a;
    game.neighborKind[pb] = 2;
  }
}

export function adjacent(from: i32, to: i32): i32 {
  if (from == to || from < 0 || to < 0 || from >= REAL_TOWN_COUNT || to >= REAL_TOWN_COUNT) return 0;
  for (let k = game.neighborStart[from]; k < game.neighborStart[from + 1]; k++) {
    if (game.neighborTo[k] == to) return game.neighborKind[k];
  }
  return 0;
}

function addNews(kind: i32, text: string): void {
  game.news.unshift(new News());
  game.news[0].turn = game.turn;
  game.news[0].kind = kind;
  game.news[0].text = text;
  if (game.news.length > 40) game.news.pop();
}

function message(ok: bool, text: string): void {
  game.lastOk = ok ? 1 : 0;
  game.lastMsg = text;
  if (!ok) addNews(5, text);
}

export function newGame(seed: i32, playerPref: i32, difficulty: i32, length: i32): void {
  game = new Game();
  for (let i = 0; i < (PREF_COUNT + 1) * SPECIALS.length; i++) game.brand.push(0);
  game.seed = seed;
  game.rng = <u32>(seed * 2654435761 + 12345) | 1;
  game.player = clampI(playerPref, 1, PREF_COUNT);
  game.difficulty = clampI(difficulty, 0, 2);
  game.length = clampI(length, 1, 3);
  game.turn = 0;

  for (let i = 0; i <= PREF_COUNT; i++) {
    for (let j = 0; j <= PREF_COUNT; j++) {
      game.rel.push(0);
      game.treaty.push(0);
      game.treatyTurns.push(0);
    }
  }
  for (let i = 0; i <= PREF_COUNT; i++) {
    game.factions.push(new Faction());
  }

  for (let p = 1; p <= PREF_COUNT; p++) {
    let f = faction(p);
    f.id = p;
    f.name = PREF_NAMES[p - 1];
    f.capitalTown = REAL_CAPITAL[p - 1];
    f.budget = 70.0 + REAL_PREF_POP[p - 1] * 0.12;
    f.food = <i32>(REAL_PREF_POP[p - 1] * 1.4);
    f.equip = <i32>(REAL_PREF_POP[p - 1] * 0.3);
    f.ships = naval(p) ? 3 : 0;
    f.morale = 60;
    f.moraleBase = 60;
    f.support = 62.0;
    f.personality = (p * 7 + <i32>(seed % 11)) % 5;
    f.alive = 1;
    f.gained = 0;
  }

  for (let i = 0; i < REAL_TOWN_COUNT; i++) {
    let t = new Town();
    t.id = i;
    t.pref = REAL_PREF[i];
    t.name = REAL_NAMES[i];
    t.owner = t.pref;
    t.initialOwner = t.pref;
    t.pop = REAL_POP[i];
    t.lon = REAL_LON[i];
    t.lat = REAL_LAT[i];
    t.tax = REAL_TAX[i];
    t.growth = REAL_GROWTH[i];
    t.elder = REAL_ELDER[i];
    t.troops = <i32>(t.pop * (80.0 + rndF() * 30.0));
    t.morale = 62 + rndInt(12);
    t.capitalTown = i == REAL_CAPITAL[t.pref - 1] ? 1 : 0;
    t.castle = t.capitalTown == 1 ? 2 : (t.pop > 80.0 ? 1 : 0);
    t.commerce = clampI(<i32>(t.tax / 6000.0), 0, 4) + t.capitalTown;
    t.farm = clampI(<i32>(t.elder / 30.0), 0, 2) + (REAL_SPECIAL[i] == 1 ? 1 : 0);
    t.industry = clampI(<i32>(t.tax / 9000.0), 0, 4);
    t.port = REAL_PORT[i];
    t.specialty = REAL_SPECIAL[i];
    game.towns.push(t);
  }

  buildNeighbors();
  recount();
  game.apMax = apFor(playerFaction());
  game.ap = game.apMax;
  game.rank = ranking();
  addNews(0, "「" + PREF_NAMES[game.player - 1] + "」で天下取りが始まった。まずは地固めを。");
  addNews(1, "開幕から半年はどの勢力も攻めてこない。");
  game.lastMsg = "都道府県を選んだ。月を進めて天下を目指そう。";
}

function recount(): void {
  for (let i = 0; i < game.brand.length; i++) game.brand[i] = 0;
  for (let i = 1; i <= PREF_COUNT; i++) {
    let f = faction(i);
    f.towns = 0;
    f.pop = 0;
  }
  for (let i = 0; i < game.towns.length; i++) {
    let t = game.towns[i];
    let f = faction(t.owner);
    f.towns++;
    f.pop += t.pop;
    if (t.specialty >= 0 && t.specialty < SPECIALS.length) {
      game.brand[t.owner * SPECIALS.length + t.specialty]++;
    }
  }
  for (let i = 1; i <= PREF_COUNT; i++) {
    let f = faction(i);
    if (f.towns == 0 && f.alive == 1) {
      f.alive = 0;
      addNews(4, f.name + "勢が滅んだ。");
    }
    if (f.towns > 0) f.alive = 1;
  }
}

function apFor(f: Faction): i32 {
  let ap = 3 + <i32>Math.floor(f.pop / 120.0) + <i32>Math.floor(<f64>f.towns / 30.0);
  if (f.chaos > 0) ap = <i32>Math.floor(<f64>ap / 2.0);
  let regions: i32[] = [];
  for (let i = 0; i < game.towns.length; i++) {
    let t = game.towns[i];
    if (t.owner != f.id) continue;
    let r = region(t.pref);
    let seen = false;
    for (let j = 0; j < regions.length; j++) if (regions[j] == r) seen = true;
    if (!seen && r != 0 && REGION_NAMES[r].length > 0) {
      let all = true;
      for (let p = 1; p <= PREF_COUNT; p++) {
        if (region(p) != r) continue;
        for (let k = 0; k < game.towns.length; k++) {
          if (game.towns[k].pref == p && game.towns[k].owner != f.id) all = false;
        }
      }
      if (all) regions.push(r);
    }
  }
  ap += clampI(regions.length, 0, 2);
  return clampI(ap, 2, 12);
}

function ranking(): i32[] {
  let ids: i32[] = [];
  for (let i = 1; i <= PREF_COUNT; i++) ids.push(i);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      let a = faction(ids[i]);
      let b = faction(ids[j]);
      let av = a.alive == 1 ? a.pop + <f64>a.gained * 3.0 : -1.0;
      let bv = b.alive == 1 ? b.pop + <f64>b.gained * 3.0 : -1.0;
      if (bv > av) {
        let tmp = ids[i];
        ids[i] = ids[j];
        ids[j] = tmp;
      }
    }
  }
  return ids;
}

function playerRank(): i32 {
  for (let i = 0; i < game.rank.length; i++) if (game.rank[i] == game.player) return i + 1;
  return PREF_COUNT;
}

function ownedTowns(fid: i32): i32[] {
  let out: i32[] = [];
  for (let i = 0; i < game.towns.length; i++) if (game.towns[i].owner == fid) out.push(i);
  return out;
}

function brandLevel(fid: i32, sp: i32): i32 {
  let k = fid * SPECIALS.length + sp;
  if (k < 0 || k >= game.brand.length) return 0;
  return clampI(game.brand[k] / 3, 0, 3);
}

function moraleFactor(m: i32): f64 {
  return 0.7 + <f64>m / 200.0;
}

function terrainPenalty(from: i32, to: i32, season: i32): f64 {
  let a = town(from);
  let b = town(to);
  let diff = Math.abs(a.lat - b.lat) + Math.abs(a.lon - b.lon) * 0.6;
  let penalty = clamp(diff * 0.05, 0.0, 0.3);
  if (season == 3 && diff > 2.0) penalty += 0.08;
  return 1.0 - penalty;
}

export function season(): i32 {
  let m = ((game.turn + 3) % 12) + 1;
  return <i32>Math.floor((<f64>m - 1.0) / 3.0);
}

export function year(): i32 {
  return 2027 + <i32>Math.floor(<f64>game.turn / 12.0);
}

export function month(): i32 {
  return ((game.turn + 3) % 12) + 1;
}

export function estimate(from: i32, to: i32, troops: i32): string {
  if (from < 0 || to < 0 || from >= game.towns.length || to >= game.towns.length) return "{\"ok\":0}";
  let a = town(from);
  let b = town(to);
  let link = adjacent(from, to);
  let f = faction(a.owner);
  let sent = clampI(troops, 0, a.troops);
  let need = <f64>sent / 400.0;
  let eratio = need <= 0 ? 1.0 : clamp(<f64>f.equip / need, 0.0, 1.0);
  let atk = <f64>sent * moraleFactor(f.morale) * (1.0 + <f64>brandLevel(f.id, 5) * 0.01)
    * (f.momentum == 1 ? 1.1 : 1.0) * terrainPenalty(from, to, season())
    * (link == 2 ? 0.8 : 1.0) * (0.6 + 0.4 * eratio);
  let def = <f64>b.troops * (1.0 + <f64>b.castle * 0.25) * moraleFactor(b.morale)
    * (b.fortify > 0 ? 1.0 + <f64>b.fortify * 0.25 : 1.0)
    * (b.supplyCut == 1 ? 0.85 : 1.0);
  let odds = clamp(atk / (atk + def + 1.0), 0.02, 0.98);
  let label = "不利";
  if (odds >= 0.8) label = "ほぼ確実";
  else if (odds >= 0.65) label = "大勝";
  else if (odds >= 0.53) label = "有利";
  else if (odds >= 0.42) label = "五分";
  let s = "{";
  s = field(s, "ok", link == 0 ? "0" : "1", false);
  s = field(s, "link", link.toString(), true);
  s = field(s, "attack", q(f1(atk)), true);
  s = field(s, "defense", q(f1(def)), true);
  s = field(s, "odds", q(f1(odds * 100.0)), true);
  s = field(s, "label", q(label), true);
  s = field(s, "max", a.troops.toString(), true);
  s += "}";
  return s;
}

function canAct(f: Faction): bool {
  return f.alive == 1 && game.ap > 0 && game.result == 0;
}

function spend(fid: i32): void {
  if (fid == game.player) game.ap--;
}

function pay(f: Faction, amount: f64): bool {
  if (f.budget < amount) return false;
  f.budget -= amount;
  return true;
}

export function command(kind: i32, a: i32, b: i32, c: i32): string {
  let f = playerFaction();
  if (game.result != 0) {
    message(false, "このゲームは終わっている。");
    return snapshot();
  }
  if (game.ap <= 0) {
    message(false, "行動力が足りない。月を進めよう。");
    return snapshot();
  }
  let t: Town;
  switch (kind) {
    case 0:
    case 1:
    case 2:
    case 4:
    case 5:
    case 6:
    case 7:
      t = town(a);
      if (t.owner != game.player) { message(false, "自領の町を選んでほしい。"); break; }
      doDevelop(kind, t, f, b);
      break;
    case 3:
      t = town(a);
      if (t.owner != game.player) { message(false, "自領の町を選んでほしい。"); break; }
      if (f.food < 20) { message(false, "兵糧が足りない。"); break; }
      f.food -= 20;
      t.morale = clampI(t.morale + 16, 0, 100);
      f.morale = clampI(f.morale + 3, 10, 100);
      spend(game.player);
      message(true, t.name + "で祭りを開いた。民心が上がった。");
      break;
    case 8:
      doAttack(a, b, c, f, game.player);
      break;
    case 9:
      t = town(a);
      if (t.owner != game.player || town(b).owner != game.player) { message(false, "自領どうしでしか移動できない。"); break; }
      if (adjacent(a, b) == 0) { message(false, "隣り合っていない。"); break; }
      let amount = clampI(c, 0, t.troops);
      t.troops -= amount;
      town(b).troops += amount;
      spend(game.player);
      message(true, f1(<f64>amount) + "兵を" + town(b).name + "へ移した。");
      break;
    case 10:
      doGather(a, f);
      break;
    case 11:
      doDiplomacy(b, c, f);
      break;
    case 12:
      doProposal(a, b, f);
      break;
    case 13:
      if (b < 1 || b > PREF_COUNT) { message(false, "勢力を選んでほしい。"); break; }
      spend(game.player);
      let ef = faction(b);
      let intel = "物見：" + ef.name + " 兵約" + f1(<f64>totalTroops(b)) + " 予算約" + f1(ef.budget)
        + " 兵糧約" + f1(<f64>ef.food) + " 気質" + PERSONALITIES[ef.personality];
      message(true, intel);
      break;
    case 14:
      doTotalOffensive(f);
      break;
    case 15:
      if (f.budget < 30) { message(false, "予算が足りない。"); break; }
      f.budget -= 30;
      f.food += 200;
      spend(game.player);
      message(true, "兵糧を200買い入れた。");
      break;
    default:
      message(false, "不明な命令。");
  }
  recount();
  game.apMax = apFor(playerFaction());
  game.rank = ranking();
  return snapshot();
}

function doDevelop(kind: i32, t: Town, f: Faction, level: i32): void {
  let mult = clampI(level, 1, 3);
  let cost: f64 = 0;
  let eq: i32 = 0;
  let food: i32 = 0;
  let name = "";
  let isMax = false;
  if (kind == 0) {
    cost = (12.0 + t.pop * 0.06) * <f64>mult;
    name = "商業";
    if (t.commerce >= 5) isMax = true;
    else t.commerce += mult;
  } else if (kind == 1) {
    cost = 14.0 * <f64>mult;
    name = "開墾";
    if (t.farm >= 5) isMax = true;
    else t.farm = clampI(t.farm + mult, 0, 5);
  } else if (kind == 2) {
    cost = (22.0 + t.pop * 0.05) * <f64>mult;
    name = "殖産";
    if (t.industry >= 5) isMax = true;
    else t.industry = clampI(t.industry + mult, 0, 5);
  } else if (kind == 4) {
    cost = 28.0 * <f64>mult;
    eq = 4 * mult;
    name = "築城";
    if (t.castle >= 3) isMax = true;
    else t.castle = clampI(t.castle + mult, 0, 3);
  } else if (kind == 5) {
    let n = clampI(<i32>(t.pop * 1.2), 300, 6000) * mult;
    cost = 8.0 * <f64>mult;
    eq = mult * 2;
    name = "徴兵";
    if (isMax) {}
    t.troops += n;
    t.morale = clampI(t.morale - 6 * mult, 0, 100);
    if (f.equip < eq) {
      cost += <f64>(eq - f.equip) * 4.0;
      eq = 0;
    }
    spend(game.player);
    f.equip -= eq;
    if (!pay(f, cost)) { message(false, "予算が足りない。"); return; }
    message(true, t.name + "で" + f1(<f64>n) + "兵を徴兵した。民心が下がった。");
    return;
  } else if (kind == 6) {
    let n = 4000 * mult;
    cost = 50.0 * <f64>mult;
    food = 60 * mult;
    name = "募兵";
    t.troops += n;
    if (f.food < food) {
      cost += <f64>(food - f.food) * 0.8;
      food = 0;
    }
    spend(game.player);
    f.food -= food;
    if (!pay(f, cost)) { message(false, "予算が足りない。"); return; }
    message(true, t.name + "で" + f1(<f64>n) + "兵を雇った。");
    return;
  } else if (kind == 7) {
    if (t.port != 1) { message(false, "港の町でしか造船できない。"); return; }
    cost = naval(f.id) ? 24.0 : 35.0;
    eq = 10;
    name = "造船";
    f.ships++;
  }
  if (isMax) { message(false, name + "はこれ以上上げられない。"); return; }
  if (f.budget < cost || f.equip < eq) { message(false, "予算か装備が足りない（要 " + f1(cost) + " / 装備" + eq.toString() + "）。"); return; }
  f.budget -= cost;
  f.equip -= eq;
  spend(game.player);
  message(true, t.name + "で" + name + "を行った（-" + f1(cost) + "予算）。");
}

function doGather(target: i32, f: Faction): void {
  let t = town(target);
  if (t.owner != game.player) { message(false, "自領の町を選んでほしい。"); return; }
  let gathered = 0;
  let used: i32[] = [];
  for (let i = 0; i < game.towns.length; i++) {
    let s = game.towns[i];
    if (s.id == target || s.owner != game.player) continue;
    if (adjacent(s.id, target) != 1) continue;
    let enemyNear = false;
    for (let j = 0; j < game.towns.length; j++) {
      let e = game.towns[j];
      if (e.owner == game.player) continue;
      if (adjacent(s.id, e.id) > 0) enemyNear = true;
    }
    if (enemyNear) continue;
    let n = <i32>(<f64>s.troops * 0.6);
    if (n <= 500) continue;
    s.troops -= 500;
    n -= 500;
    gathered += n;
    used.push(s.id);
  }
  if (gathered < 1000) { message(false, "集められる兵が足りない。"); return; }
  let cost = <f64>gathered / 1500.0;
  if (f.budget < cost) { message(false, "予算が足りない。"); return; }
  f.budget -= cost;
  t.troops += gathered;
  spend(game.player);
  message(true, used.length.toString() + "か所から" + f1(<f64>gathered) + "兵を集結した。");
}

function totalTroops(fid: i32): i32 {
  let n = 0;
  for (let i = 0; i < game.towns.length; i++) if (game.towns[i].owner == fid) n += game.towns[i].troops;
  for (let i = 0; i < game.orders.length; i++) if (game.orders[i].owner == fid) n += game.orders[i].troops;
  return n;
}

function queueOrder(owner: i32, from: i32, to: i32, troops: i32, eta: i32, sea: i32): void {
  let o = new Order();
  o.id = ++game.orderSeq;
  o.owner = owner;
  o.from = from;
  o.to = to;
  o.troops = troops;
  o.eta = eta;
  o.sea = sea;
  game.orders.push(o);
}

function doAttack(from: i32, to: i32, troops: i32, f: Faction, fid: i32): bool {
  let a = town(from);
  let b = town(to);
  if (a.owner != fid || b.owner == fid) { message(false, "出陣できない町だ。"); return false; }
  let link = adjacent(from, to);
  if (link == 0) { message(false, "隣り合っていない。"); return false; }
  if (hasTreaty(fid, b.owner, 1) || hasTreaty(fid, b.owner, 2)) {
    message(false, "約束があるので攻められない。");
    return false;
  }
  let sent = clampI(troops, 100, a.troops);
  if (sent < 100) { message(false, "兵が足りない。"); return false; }
  let eta = 0;
  let ships = 0;
  if (link == 2) {
    ships = 1;
    if (a.lat < 33.8 && (month() == 8 || month() == 9)) eta = 1;
    if (season() == 3 && rndF() < 0.2) eta = 1;
    if (f.ships < ships) { message(false, "船が足りない。"); return false; }
    f.ships -= ships;
  }
  a.troops -= sent;
  queueOrder(fid, from, to, sent, eta, link == 2 ? 1 : 0);
  spend(fid);
  let est = estimate(from, to, sent);
  let odds = "?";
  let p = est.indexOf("\"odds\":\"");
  if (p >= 0) {
    let s = est.substring(p + 8);
    let e = s.indexOf("\"");
    if (e > 0) odds = s.substring(0, e);
  }
  let label = "五分";
  if (est.indexOf("ほぼ確実") >= 0) label = "ほぼ確実";
  else if (est.indexOf("大勝") >= 0) label = "大勝";
  else if (est.indexOf("有利") >= 0) label = "有利";
  else if (est.indexOf("不利") >= 0) label = "不利";
  if (fid == game.player) message(true, a.name + "から" + b.name + "へ" + f1(<f64>sent) + "兵出陣（" + label + " 勝算" + odds + "%）。");
  return true;
}

function doTotalOffensive(f: Faction): void {
  let count = 0;
  let report = "";
  for (let i = 0; i < game.towns.length && count < 8; i++) {
    let a = game.towns[i];
    if (a.owner != game.player || a.troops < 1200) continue;
    let best = -1;
    let bestOdds = 0.0;
    for (let j = 0; j < game.towns.length; j++) {
      let b = game.towns[j];
      if (b.owner == game.player || adjacent(a.id, b.id) == 0) continue;
      if (hasTreaty(game.player, b.owner, 1) || hasTreaty(game.player, b.owner, 2)) continue;
      let est = estimate(a.id, b.id, a.troops);
      let p = est.indexOf("\"odds\":\"");
      if (p < 0) continue;
      let s = est.substring(p + 8);
      let e = s.indexOf("\"");
      if (e < 0) continue;
      let odds = <f64>parseFloat(s.substring(0, e)) / 100.0;
      if (odds > bestOdds) { bestOdds = odds; best = j; }
    }
    if (best >= 0 && bestOdds >= 0.58) {
      let sent = <i32>(<f64>a.troops * 0.8);
      if (doAttack(a.id, best, sent, f, game.player)) {
        count++;
        report += game.towns[best].name + " ";
      }
    }
  }
  if (count == 0) { message(false, "有利な攻め先がない。"); return; }
  game.ap = <i32>Math.max(<f64>(game.ap - <i32>Math.ceil(<f64>count / 2.0)), 0.0);
  message(true, "総攻め！ " + report + "へ出陣した。");
}

function doDiplomacy(target: i32, type: i32, f: Faction): void {
  if (target < 1 || target > PREF_COUNT || target == game.player) { message(false, "相手を選んでほしい。"); return; }
  let ef = faction(target);
  if (ef.alive == 0) { message(false, "すでに滅んだ勢力だ。"); return; }
  let cost = 0.0;
  if (type == 0) cost = 20.0;
  else if (type == 1) cost = 10.0;
  else if (type == 3) cost = 30.0;
  else if (type == 4) cost = 0.0;
  else cost = 0.0;
  if (f.budget < cost) { message(false, "予算が足りない。"); return; }
  if (type == 4) {
    let k = idx(game.player, target);
    game.treaty[k] = 0;
    game.treatyTurns[k] = 0;
    let k2 = idx(target, game.player);
    game.treaty[k2] = 0;
    game.treatyTurns[k2] = 0;
    adjustRel(game.player, target, -14);
    spend(game.player);
    message(true, ef.name + "との約束を破った。周囲の信用が下がった。");
    return;
  }
  let rel = game.rel[idx(game.player, target)];
  let chance = 0.28 + <f64>rel / 260.0 + <f64>brandLevel(game.player, 6) * 0.05;
  if (ef.personality == 2) chance += 0.12;
  if (ef.personality == 3) chance += 0.06;
  if (ef.personality == 4) chance -= 0.08;
  if (type == 1) chance -= 0.08;
  if (type == 0) chance -= 0.12;
  if (ef.chaos > 0) chance -= 0.12;
  chance = clamp(chance, 0.06, 0.92);
  f.budget -= cost;
  spend(game.player);
  if (rndF() < chance) {
    if (type == 0) setTreaty(game.player, target, 1, 12);
    else if (type == 1) setTreaty(game.player, target, 2, 6);
    else if (type == 2) setTreaty(game.player, target, 4, 12);
    adjustRel(game.player, target, 12);
    let label = type == 0 ? "同盟" : type == 1 ? "停戦" : type == 2 ? "交易" : "友好";
    message(true, ef.name + "と" + label + "を結んだ。");
  } else {
    adjustRel(game.player, target, -4);
    message(false, ef.name + "に断られた。行動力は戻らない。");
  }
}

function doProposal(a: i32, accept: i32, f: Faction): void {
  if (a < 0 || a >= game.proposals.length) { message(false, "申し出がない。"); return; }
  let code = game.proposals[a];
  let from = <i32>Math.floor(<f64>code / 10.0);
  let type = code % 10;
  game.proposals.splice(a, 1);
  if (accept == 1) {
    if (type == 0) setTreaty(game.player, from, 1, 12);
    else if (type == 1) setTreaty(game.player, from, 2, 6);
    else setTreaty(game.player, from, 4, 12);
    adjustRel(game.player, from, 15);
    let label = type == 0 ? "同盟" : type == 1 ? "停戦" : "交易";
    message(true, faction(from).name + "との" + label + "を受けた。");
  } else {
    adjustRel(game.player, from, -8);
    message(true, faction(from).name + "の申し出を断った。");
  }
}

function resolveBattles(): string {
  let report = "";
  let survivors: Order[] = [];
  for (let oi = 0; oi < game.orders.length; oi++) {
    let o = game.orders[oi];
    if (o.eta > 0) {
      o.eta--;
      survivors.push(o);
      continue;
    }
    let from = town(o.from);
    let to = town(o.to);
    let f = faction(o.owner);
    if (from.owner != o.owner || to.owner == o.owner || f.alive == 0) continue;
    let sent = clampI(o.troops, 0, from.troops);
    from.troops -= sent;
    if (sent <= 0) continue;
    let need = <f64>sent / 400.0;
    let eratio = need <= 0 ? 1.0 : clamp(<f64>f.equip / need, 0.0, 1.0);
    if (f.equip >= <i32>need) f.equip -= <i32>need;
    else f.equip = 0;
    let atk = <f64>sent * moraleFactor(f.morale) * (1.0 + <f64>brandLevel(f.id, 5) * 0.01)
      * (f.momentum == 1 ? 1.1 : 1.0) * terrainPenalty(from.pref, to.pref, season())
      * (o.sea == 1 ? 0.8 : 1.0) * (0.6 + 0.4 * eratio) * (0.92 + rndF() * 0.16);
    let fort = to.fortify > 0 ? 1.0 + <f64>to.fortify * 0.25 : 1.0;
    let def = <f64>to.troops * (1.0 + <f64>to.castle * 0.25) * moraleFactor(to.morale)
      * fort * (to.supplyCut == 1 ? 0.85 : 1.0) * (0.92 + rndF() * 0.16);
    if (o.sea == 1 && rndF() < 0.12) {
      let lost = <i32>(<f64>sent * 0.35);
      sent -= lost;
      atk *= 0.6;
      addNews(2, f.name + "の船団が時化に遭い、" + f1(<f64>lost) + "兵を失った。");
    }
    let odds = clamp(atk / (atk + def + 1.0), 0.03, 0.97);
    let win = rndF() < odds;
    let atkLoss = clampI(<i32>(<f64>sent * (win ? 0.24 : 0.38)), 0, sent);
    let defLoss = clampI(<i32>(<f64>to.troops * (win ? 0.62 : 0.4)), 0, to.troops);
    let outcome = f.name + " " + from.name + "→" + to.name + " " + f1(atk) + "対" + f1(def);
    if (win) {
      let oldOwner = to.owner;
      let oldf = faction(oldOwner);
      to.troops = sent - atkLoss;
      to.owner = o.owner;
      to.morale = 40;
      to.castle = <i32>Math.max(<f64>(to.castle - 1), 0.0);
      to.fortify = 4;
      f.captured++;
      oldf.lost++;
      f.morale = clampI(f.morale + 7, 5, 100);
      oldf.morale = clampI(oldf.morale - 9, 5, 100);
      adjustRel(o.owner, oldOwner, -6);
      outcome += " 占領";
      addNews(2, f.name + "が" + to.name + "を占領した！（" + f1(atk) + "対" + f1(def) + "）");
      if (to.capitalTown == 1 && oldf.capitalTown == to.id) {
        let alt = -1;
        for (let i = 0; i < game.towns.length; i++) {
          let c = game.towns[i];
          if (c.owner == oldOwner && c.fortify == 0) { alt = i; break; }
        }
        if (alt >= 0) {
          oldf.capitalTown = alt;
          game.towns[alt].capitalTown = 1;
          oldf.chaos = 3;
          addNews(4, oldf.name + "の県庁が陥落！ " + game.towns[alt].name + "へ移った。");
        }
      }
    } else {
      to.troops = <i32>Math.max(<f64>(to.troops - defLoss), 0.0);
      from.troops += sent - atkLoss;
      let df = faction(to.owner);
      df.morale = clampI(df.morale + 5, 5, 100);
      f.morale = clampI(f.morale - 5, 5, 100);
      outcome += " 撃退";
      addNews(2, to.name + "の守りが" + f.name + "を撃退した。（" + f1(atk) + "対" + f1(def) + "）");
    }
    if (o.owner == game.player || to.owner == game.player || from.owner == game.player) {
      report += outcome + " / ";
    }
  }
  game.orders = survivors;
  return report;
}

function supplyUpdate(): void {
  for (let i = 0; i < game.towns.length; i++) game.towns[i].supplyCut = 0;
  for (let fid = 1; fid <= PREF_COUNT; fid++) {
    let f = faction(fid);
    if (f.alive == 0 || f.towns == 0) continue;
    let seen: i32[] = [];
    let queue: i32[] = [f.capitalTown];
    if (town(f.capitalTown).owner != fid) continue;
    seen.push(f.capitalTown);
    while (queue.length > 0) {
      let cur = queue.shift();
      for (let k = game.neighborStart[cur]; k < game.neighborStart[cur + 1]; k++) {
        let next = game.neighborTo[k];
        let t = game.towns[next];
        if (t.owner != fid || seen.indexOf(next) >= 0) continue;
        seen.push(next);
        queue.push(next);
      }
    }
    for (let i = 0; i < game.towns.length; i++) {
      let t = game.towns[i];
      if (t.owner == fid && seen.indexOf(t.id) < 0) t.supplyCut = 1;
    }
  }
}

function economyTurn(): void {
  let diffMul = game.difficulty == 0 ? 1.25 : game.difficulty == 2 ? 0.9 : 1.0;
  for (let fid = 1; fid <= PREF_COUNT; fid++) {
    let f = faction(fid);
    if (f.alive == 0 || f.towns == 0) continue;
    let income = 0.0;
    let harvest = 0.0;
    let equipGain = 4.0;
    for (let i = 0; i < game.towns.length; i++) {
      let t = game.towns[i];
      if (t.owner != fid) continue;
      income += 1.0 + <f64>t.commerce * 1.4 + t.pop * 0.010;
      if (t.specialty >= 0) income += 1.2;
      if (month() == 10) harvest += t.pop * (<f64>t.farm * 0.10 + 0.15);
      equipGain += <f64>t.industry * 0.9;
      if (t.supplyCut == 1) {
        t.morale = clampI(t.morale - 2, 0, 100);
        for (let k = game.neighborStart[t.id]; k < game.neighborStart[t.id + 1]; k++) {
          let e = game.towns[game.neighborTo[k]];
          if (e.owner != fid && rndF() < 0.03 && f.chaos == 0) {
            e.owner = fid;
            e.troops += t.troops / 2;
            t.troops /= 2;
            e.morale = 40;
            e.fortify = 2;
            addNews(2, t.name + "が補給線を絶たれ、" + e.name + "側へ降った。");
            break;
          }
        }
      }
      t.morale = clampI(t.morale + (70 - t.morale) / 12, 0, 100);
      if (t.fortify > 0) t.fortify--;
    }
    income *= diffMul * (1.0 + <f64>brandLevel(fid, 0) * 0.04);
    income += <f64>brandLevel(fid, 2) * 3.0 + <f64>brandLevel(fid, 8) * 2.0;
    if (hasTreaty(fid, game.player, 4)) income += 2.0;
    for (let p = 1; p <= PREF_COUNT; p++) {
      if (p == fid || !hasTreaty(fid, p, 4)) continue;
      let n = 0;
      for (let i = 0; i < game.towns.length; i++) {
        if (game.towns[i].owner == p && game.towns[i].specialty >= 0) n++;
      }
      income += Math.min(n, 6) * 1.5;
    }
    let troops = totalTroops(fid);
    let salary = <f64>troops * 0.0011;
    let foodNeed = <f64>troops * 0.0022 * (brandLevel(fid, 4) > 0 ? 0.95 : 1.0);
    if (month() == 10) {
      harvest *= 1.0 + <f64>brandLevel(fid, 1) * 0.06 + <f64>brandLevel(fid, 3) * 0.04;
      f.food += <i32>harvest;
    }
    let deficit = foodNeed - <f64>f.food;
    if (deficit > 0) {
      f.budget -= deficit * 0.6;
      f.food = 0;
      f.morale = clampI(f.morale - 5, 5, 100);
      troops = <i32>(<f64>troops * 0.98);
      for (let i = 0; i < game.towns.length; i++) if (game.towns[i].owner == fid) game.towns[i].troops = <i32>(<f64>game.towns[i].troops * 0.98);
      if (fid == game.player) addNews(5, "兵糧が尽きた！ 予算で買い入れ、兵が逃げた。");
    } else {
      f.food -= <i32>foodNeed;
    }
    f.budget += income - salary;
    equipGain *= 1.0 + <f64>brandLevel(fid, 7) * 0.1;
    f.equip += <i32>equipGain;
    if (f.chaos > 0) f.chaos--;
    f.moraleBase = 60 + brandLevel(fid, 5) * 3;
    f.morale = clampI(f.morale + (f.moraleBase - f.morale) / 8 + (f.momentum == 1 ? 1 : 0), 5, 100);
    let gained = f.captured - f.lost;
    if (gained > 0) {
      f.goodMonths++;
      if (f.goodMonths >= 3 && f.momentum == 0) {
        f.momentum = 1;
        f.morale = clampI(f.morale + 12, 5, 100);
        if (fid == game.player) addNews(4, "勢いに乗った！ 攻めが強くなる。");
      }
    } else if (gained < 0) {
      f.goodMonths = 0;
      f.momentum = 0;
    }
    f.captured = 0;
    f.lost = 0;
  }
}

function updateSupport(): void {
  let f = playerFaction();
  let total = 0.0;
  let owned = 0.0;
  let moraleSum = 0.0;
  for (let i = 0; i < game.towns.length; i++) {
    let t = game.towns[i];
    if (t.pref != game.player) continue;
    total += t.pop;
    if (t.owner == game.player) {
      owned += t.pop;
      moraleSum += t.pop * <f64>t.morale;
    }
  }
  let base = total > 0 ? owned / total * 100.0 : 0.0;
  let mor = owned > 0 ? moraleSum / owned : 0.0;
  let val = base * 0.68 + mor * 0.32;
  val += <f64>brandLevel(game.player, 9) * 1.5;
  if (game.difficulty == 0) val += 5.0;
  if (game.difficulty == 2) val -= 3.0;
  if (f.chaos > 0) val -= 8.0;
  f.support = clamp(val, 0.0, 100.0);
}

function cpuTurn(): void {
  if (game.turn < 6) return;
  for (let fid = 1; fid <= PREF_COUNT; fid++) {
    if (fid == game.player) continue;
    let f = faction(fid);
    if (f.alive == 0 || f.towns == 0) continue;
    let own = ownedTowns(fid);
    if (own.length == 0) continue;
    let ap = clampI(apFor(f), 1, 6);
    let attacks = 0;
    while (ap > 0) {
      ap--;
      let t = own[rndInt(own.length)];
      let tw = game.towns[t];
      let threshold = f.personality == 0 ? 0.5 : f.personality == 4 ? 0.55 : f.personality == 3 ? 0.64 : f.personality == 2 ? 0.72 : 0.68;
      if (game.difficulty == 0) threshold += 0.12;
      if (game.difficulty == 2) threshold -= 0.06;
      let bestTarget = -1;
      let bestOdds = 0.0;
      for (let k = game.neighborStart[t]; k < game.neighborStart[t + 1]; k++) {
        let j = game.neighborTo[k];
        let b = game.towns[j];
        if (b.owner == fid || game.neighborKind[k] == 0) continue;
        if (hasTreaty(fid, b.owner, 1) || hasTreaty(fid, b.owner, 2)) continue;
        if (game.turn < 18 && b.owner == game.player) continue;
        let sent = <i32>(<f64>tw.troops * 0.75);
        if (sent < 800) continue;
        let est = estimate(t, j, sent);
        let p = est.indexOf("\"odds\":\"");
        if (p < 0) continue;
        let s = est.substring(p + 8);
        let e = s.indexOf("\"");
        if (e < 0) continue;
        let odds = <f64>parseFloat(s.substring(0, e)) / 100.0;
        if (odds > bestOdds) { bestOdds = odds; bestTarget = j; }
      }
      if (bestTarget >= 0 && bestOdds >= threshold + 0.05 && tw.troops > 2500 && attacks < 1) {
        let sent = <i32>(<f64>tw.troops * 0.75);
        if (doAttackCpu(fid, t, bestTarget, sent)) {
          attacks++;
          continue;
        }
      }
      if (f.budget < 45 && tw.commerce < 5) {
        f.budget -= 12.0;
        tw.commerce++;
      } else if (f.food < troopsOf(fid) * 2 && tw.farm < 5 && month() < 10) {
        f.budget -= 14.0;
        tw.farm++;
      } else if (tw.troops < 2500 && f.budget > 60) {
        let n = clampI(<i32>(tw.pop * 1.2), 300, 6000);
        tw.troops += n;
        tw.morale = clampI(tw.morale - 4, 0, 100);
        f.budget -= 8.0;
      } else if (tw.castle < 2 && f.budget > 100) {
        f.budget -= 28.0;
        f.equip -= <i32>Math.min(<f64>f.equip, 4.0);
        tw.castle++;
      } else if (f.budget > 100 && tw.industry < 4) {
        f.budget -= 22.0;
        tw.industry++;
      }
    }
    if (game.turn >= 12 && game.turn % 9 == 0 && rndF() < 0.22 && f.alive == 1) {
      let type = f.personality == 2 ? 2 : rndInt(2);
      game.proposals.push(fid * 10 + type);
      addNews(3, faction(fid).name + "から使者が来た。書状が届いている。");
    }
  }
}

function troopsOf(fid: i32): i32 {
  let n = 0;
  for (let i = 0; i < game.towns.length; i++) if (game.towns[i].owner == fid) n += game.towns[i].troops;
  return n;
}

function doAttackCpu(fid: i32, from: i32, to: i32, sent: i32): bool {
  let a = town(from);
  let b = town(to);
  let f = faction(fid);
  let link = adjacent(from, to);
  if (link == 0 || a.owner != fid || b.owner == fid) return false;
  let eta = 0;
  if (link == 2) {
    if (f.ships < 1) return false;
    f.ships--;
    eta = (a.lat < 33.8 && (month() == 8 || month() == 9)) ? 1 : 0;
  }
  a.troops -= sent;
  queueOrder(fid, from, to, sent, eta, link == 2 ? 1 : 0);
  return true;
}

function checkEvents(): void {
  if (game.turn > 0 && game.turn % 48 == 0) {
    updateSupport();
    if (playerFaction().support < 50.0) {
      game.result = 2;
      addNews(4, "知事選に落選した。天下取りはここまで。");
    } else {
      playerFaction().morale = clampI(playerFaction().morale + 6, 5, 100);
      addNews(4, "知事選に勝った！ 支持は" + f1(playerFaction().support) + "%。");
    }
  }
  let pf = playerFaction();
  let ownedAll = true;
  for (let i = 0; i < game.towns.length; i++) if (game.towns[i].owner != game.player) ownedAll = false;
  if (ownedAll) {
    game.result = 1;
    addNews(4, "天下統一！ 47県を一つにまとめた。");
  } else if (pf.alive == 0 || pf.towns == 0) {
    game.result = 2;
    addNews(4, "本拠を失い、勢力は滅んだ。");
  } else {
    let limit = game.length == 1 ? 120 : game.length == 2 ? 240 : -1;
    if (limit > 0 && game.turn >= limit) {
      game.result = 3;
      addNews(4, playerRank() == 1 ? "年代が終わった。見事1位！" : ("年代が終わった。順位は" + playerRank().toString() + "位。"));
    }
  }
}

export function endMonth(): string {
  if (game.result != 0) {
    message(false, "ゲームは終わっている。");
    return snapshot();
  }
  let report = resolveBattles();
  recount();
  supplyUpdate();
  economyTurn();
  cpuTurn();
  recount();
  supplyUpdate();
  updateSupport();
  game.turn++;
  for (let i = 0; i < game.treatyTurns.length; i++) {
    if (game.treatyTurns[i] > 0) {
      game.treatyTurns[i]--;
      if (game.treatyTurns[i] == 0) game.treaty[i] = 0;
    }
  }
  game.apMax = apFor(playerFaction());
  game.ap = game.apMax;
  game.rank = ranking();
  checkEvents();
  let prefix = year().toString() + "年" + month().toString() + "月：";
  if (report.length > 0) message(true, prefix + report);
  else message(true, prefix + "特に大きな動きはなかった。");
  game.battleReport = report;
  return snapshot();
}

function numArray(nums: i32[]): string {
  let parts: string[] = [];
  for (let i = 0; i < nums.length; i++) parts.push(nums[i].toString());
  return "[" + parts.join(",") + "]";
}

function f64Array(nums: f64[]): string {
  let parts: string[] = [];
  for (let i = 0; i < nums.length; i++) parts.push(f1(nums[i]));
  return "[" + parts.join(",") + "]";
}

export function snapshot(): string {
  let s = "{";
  s = field(s, "v", "1", false);
  s = field(s, "seed", game.seed.toString(), true);
  s = field(s, "turn", game.turn.toString(), true);
  s = field(s, "year", year().toString(), true);
  s = field(s, "month", month().toString(), true);
  s = field(s, "season", season().toString(), true);
  s = field(s, "player", game.player.toString(), true);
  s = field(s, "difficulty", game.difficulty.toString(), true);
  s = field(s, "length", game.length.toString(), true);
  s = field(s, "ap", game.ap.toString(), true);
  s = field(s, "apMax", game.apMax.toString(), true);
  s = field(s, "result", game.result.toString(), true);
  s = field(s, "rank", playerRank().toString(), true);
  s = field(s, "ok", game.lastOk.toString(), true);
  s = field(s, "msg", q(game.lastMsg), true);
  s = field(s, "report", q(game.battleReport), true);

  let pf = playerFaction();
  let sfield = ",\"self\":{";
  sfield = field(sfield, "budget", f1(pf.budget), false);
  sfield = field(sfield, "food", pf.food.toString(), true);
  sfield = field(sfield, "equip", pf.equip.toString(), true);
  sfield = field(sfield, "ships", pf.ships.toString(), true);
  sfield = field(sfield, "morale", pf.morale.toString(), true);
  sfield = field(sfield, "support", f1(pf.support), true);
  sfield = field(sfield, "momentum", pf.momentum.toString(), true);
  sfield = field(sfield, "chaos", pf.chaos.toString(), true);
  sfield = field(sfield, "towns", pf.towns.toString(), true);
  sfield = field(sfield, "pop", f1(pf.pop), true);
  sfield += "}";
  s += sfield;

  let tparts: string[] = [];
  for (let i = 0; i < game.towns.length; i++) {
    let t = game.towns[i];
    let o = "{";
    o = field(o, "id", t.id.toString(), false);
    o = field(o, "p", t.pref.toString(), true);
    o = field(o, "n", q(t.name), true);
    o = field(o, "o", t.owner.toString(), true);
    o = field(o, "pop", f1(t.pop), true);
    o = field(o, "lon", f1(t.lon), true);
    o = field(o, "lat", f1(t.lat), true);
    o = field(o, "tax", f1(t.tax), true);
    o = field(o, "growth", f1(t.growth), true);
    o = field(o, "elder", f1(t.elder), true);
    o = field(o, "tr", t.troops.toString(), true);
    o = field(o, "mo", t.morale.toString(), true);
    o = field(o, "ca", t.castle.toString(), true);
    o = field(o, "co", t.commerce.toString(), true);
    o = field(o, "fa", t.farm.toString(), true);
    o = field(o, "in", t.industry.toString(), true);
    o = field(o, "po", t.port.toString(), true);
    o = field(o, "cp", t.capitalTown.toString(), true);
    o = field(o, "sp", t.specialty.toString(), true);
    o = field(o, "fo", t.fortify.toString(), true);
    o = field(o, "sc", t.supplyCut.toString(), true);
    o += "}";
    tparts.push(o);
  }
  s += ",\"towns\":[" + tparts.join(",") + "]";

  let prefs: string[] = [];
  for (let p = 1; p <= PREF_COUNT; p++) {
    let cap = faction(p).capitalTown;
    let owner = town(cap).owner;
    let o = "{";
    o = field(o, "id", p.toString(), false);
    o = field(o, "name", q(PREF_NAMES[p - 1]), true);
    o = field(o, "owner", owner.toString(), true);
    o = field(o, "stars", STARS[p - 1].toString(), true);
    o = field(o, "cap", cap.toString(), true);
    o += "}";
    prefs.push(o);
  }
  s += ",\"prefs\":[" + prefs.join(",") + "]";

  let fs: string[] = [];
  for (let i = 1; i <= PREF_COUNT; i++) {
    let f = faction(i);
    let o = "{";
    o = field(o, "id", f.id.toString(), false);
    o = field(o, "name", q(f.name), true);
    o = field(o, "budget", f1(f.budget), true);
    o = field(o, "food", f.food.toString(), true);
    o = field(o, "equip", f.equip.toString(), true);
    o = field(o, "ships", f.ships.toString(), true);
    o = field(o, "troops", troopsOf(f.id).toString(), true);
    o = field(o, "morale", f.morale.toString(), true);
    o = field(o, "support", f1(f.support), true);
    o = field(o, "personality", f.personality.toString(), true);
    o = field(o, "alive", f.alive.toString(), true);
    o = field(o, "towns", f.towns.toString(), true);
    o = field(o, "momentum", f.momentum.toString(), true);
    o = field(o, "chaos", f.chaos.toString(), true);
    o = field(o, "vassal", f.vassalOf.toString(), true);
    o = field(o, "gained", f.gained.toString(), true);
    o = field(o, "lost", f.lost.toString(), true);
    o = field(o, "captured", f.captured.toString(), true);
    o += "}";
    fs.push(o);
  }
  s += ",\"factions\":[" + fs.join(",") + "]";

  let orders: string[] = [];
  for (let i = 0; i < game.orders.length; i++) {
    let o = game.orders[i];
    let x = "{";
    x = field(x, "id", o.id.toString(), false);
    x = field(x, "owner", o.owner.toString(), true);
    x = field(x, "from", o.from.toString(), true);
    x = field(x, "to", o.to.toString(), true);
    x = field(x, "troops", o.troops.toString(), true);
    x = field(x, "eta", o.eta.toString(), true);
    x = field(x, "sea", o.sea.toString(), true);
    x += "}";
    orders.push(x);
  }
  s += ",\"orders\":[" + orders.join(",") + "]";

  let news: string[] = [];
  for (let i = 0; i < game.news.length; i++) {
    let n = game.news[i];
    let o = "{";
    o = field(o, "turn", n.turn.toString(), false);
    o = field(o, "kind", n.kind.toString(), true);
    o = field(o, "text", q(n.text), true);
    o += "}";
    news.push(o);
  }
  s += ",\"news\":[" + news.join(",") + "]";
  s += ",\"proposals\":" + numArray(game.proposals);
  s += ",\"rel\":" + numArray(game.rel);
  s += ",\"treaty\":" + numArray(game.treaty);
  s += ",\"treatyTurns\":" + numArray(game.treatyTurns);
  s += ",\"rankIds\":" + numArray(game.rank);
  s += "}";
  return s;
}
