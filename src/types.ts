export interface TownView {
  id: number;
  p: number;
  n: string;
  o: number;
  pop: number;
  lon: number;
  lat: number;
  tax: number;
  growth: number;
  elder: number;
  tr: number;
  mo: number;
  ca: number;
  co: number;
  fa: number;
  in: number;
  po: number;
  cp: number;
  sp: number;
  fo: number;
  sc: number;
}

export interface PrefView {
  id: number;
  name: string;
  owner: number;
  stars: number;
  cap: number;
}

export interface FactionView {
  id: number;
  name: string;
  budget: number;
  food: number;
  equip: number;
  ships: number;
  air: number;
  airTech: number;
  troops: number;
  morale: number;
  support: number;
  personality: number;
  alive: number;
  towns: number;
  momentum: number;
  chaos: number;
  vassal: number;
  gained: number;
  lost: number;
  captured: number;
}

export interface NewsView {
  turn: number;
  kind: number;
  text: string;
}

export interface OrderView {
  id: number;
  owner: number;
  from: number;
  to: number;
  troops: number;
  eta: number;
  sea: number;
}

export interface Odds {
  ok: number;
  link: number;
  attack: string;
  defense: string;
  odds: string;
  label: string;
  max: number;
}

export interface Snapshot {
  v: number;
  seed: number;
  turn: number;
  year: number;
  month: number;
  season: number;
  player: number;
  difficulty: number;
  length: number;
  ap: number;
  apMax: number;
  result: number;
  rank: number;
  ok: number;
  msg: string;
  report: string;
  self: {
    budget: number;
    food: number;
    equip: number;
    ships: number;
    air: number;
    airTech: number;
    morale: number;
    support: number;
    momentum: number;
    chaos: number;
    towns: number;
    pop: number;
  };
  towns: TownView[];
  prefs: PrefView[];
  factions: FactionView[];
  orders: OrderView[];
  news: NewsView[];
  proposals: number[];
  rel: number[];
  treaty: number[];
  treatyTurns: number[];
  rankIds: number[];
}

export type CallArgs = [number, number, number, number];

export interface SaveData {
  version: number;
  setup: CallArgs;
  calls: Array<{ name: "cmd" | "nextMonth"; args: CallArgs }>;
  savedAt: string;
}
