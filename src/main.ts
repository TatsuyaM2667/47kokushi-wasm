import "./tokens.css";
import "./style.css";
import "./start.css";
import "./console.css";
import "./map-ui.css";
import "./cinema.css";
import { GameEngine } from "./engine";
import { JapanMap, colorOf } from "./map";
import type { TileMode } from "./map";
import type { Units3D } from "./units3d";
import { animate, stagger } from "animejs";
import type { Odds, Snapshot, TownView } from "./types";
import { PREF_NAMES, SPECIALS, STARS } from "../engine/data";

const $ = <T extends Element = HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`要素が見つかりません: ${selector}`);
  return found;
};

const html = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );

const NUM = (value: number): string =>
  Math.round(value).toLocaleString("ja-JP");

interface PrefProfile {
  name: string;
  flag: string;
}

const PREF_PROFILE_KEY = "47kokushi.prefProfiles.v1";

function defaultPrefProfile(pref: number): PrefProfile {
  return { name: PREF_NAMES[pref - 1] ?? `県${pref}`, flag: "" };
}

function cleanPrefProfile(value: unknown, pref: number): PrefProfile {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const name = typeof source.name === "string" ? source.name.trim().slice(0, 12) : "";
  const flag = typeof source.flag === "string" ? source.flag.trim().slice(0, 8) : "";
  return { name: name || defaultPrefProfile(pref).name, flag };
}

function loadPrefProfiles(): PrefProfile[] {
  const defaults = PREF_NAMES.map((_, i) => defaultPrefProfile(i + 1));
  try {
    const raw = localStorage.getItem(PREF_PROFILE_KEY);
    if (!raw) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaults;
    return defaults.map((_, i) => cleanPrefProfile(parsed[i], i + 1));
  } catch {
    return defaults;
  }
}

let prefProfiles = loadPrefProfiles();

function savePrefProfiles(): void {
  try {
    localStorage.setItem(PREF_PROFILE_KEY, JSON.stringify(prefProfiles));
  } catch {
    return;
  }
}

function prefLabel(pref: number): string {
  const profile = prefProfiles[pref - 1] ?? defaultPrefProfile(pref);
  return profile.flag ? `${profile.flag} ${profile.name}` : profile.name;
}

function applyPrefProfiles(): void {
  savePrefProfiles();
  japanMap.setPrefLabels(prefProfiles.map((_, i) => prefLabel(i + 1)));
  renderAll();
}

const DIFFICULTY_NAMES = ["イージー", "ノーマル", "ハード"];
const LENGTH_NAMES: Record<number, string> = {
  1: "10年",
  2: "20年",
  3: "期限なし",
};
const PERSONALITY_NAMES = ["好戦的", "慎重", "商人気質", "義理堅い", "野心家"];
const LEFT_TABS = [
  { id: "news", label: "報せ" },
  { id: "report", label: "戦果" },
  { id: "rank", label: "順位" },
  { id: "diplo", label: "外交" },
  { id: "talent", label: "人材" },
  { id: "brand", label: "名産" },
  { id: "flag", label: "旗" },
  { id: "menu", label: "メニュー" },
];

let engine: GameEngine;
let japanMap: JapanMap;
let units3d: Units3D | undefined;
let intro: { dispose(): void } | undefined;
let introLoading: Promise<void> | undefined;
let snap: Snapshot;
let selectedPref = 13;
let selectedTown = 0;
let selectedLength = 1;
let selectedDifficulty = 1;
let leftTab = "news";
let attackFrom = -1;
let attackTroops = 0;
let lastResult = 0;
let townsByPref = new Map<number, TownView[]>();
let townIndexKey = "";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let startAnimated = false;

function townById(id: number): TownView | undefined {
  return snap.towns[id];
}

function factionById(id: number) {
  return snap.factions[id - 1];
}

function dateOf(turn: number): string {
  const year = 2027 + Math.floor(turn / 12);
  const month = ((turn + 3) % 12) + 1;
  return `${year}年${month}月`;
}

function relationAt(a: number, b: number): number {
  return snap.rel[a * 48 + b] ?? 0;
}

function treatyAt(a: number, b: number): number {
  return snap.treaty[a * 48 + b] ?? 0;
}

function treatyNames(a: number, b: number): string {
  const bits = treatyAt(a, b);
  const labels: string[] = [];
  if (bits & 1) labels.push("同盟");
  if (bits & 2) labels.push("停戦");
  if (bits & 4) labels.push("交易");
  return labels.join("・") || "なし";
}

const adjacencyCache = new Map<number, number>();
function adjacentTown(a: TownView, b: TownView): boolean {
  const key = a.id * 4096 + b.id;
  let value = adjacencyCache.get(key);
  if (value === undefined) {
    value = engine.adjacent(a.id, b.id);
    adjacencyCache.set(key, value);
  }
  return value > 0;
}

function renderStartOptions(): void {
  const grid = $("#prefGrid");
  grid.innerHTML = PREF_NAMES.map((_, i) => {
    const id = i + 1;
    const stars = "★".repeat(STARS[i]);
    return `<button class="pref-button${id === selectedPref ? " selected" : ""}" data-action="selectPref" data-pref="${id}">
      <span>${html(prefLabel(id))}</span><span class="stars">${stars}</span>
    </button>`;
  }).join("");

  $("#lengthOptions").innerHTML = [1, 2, 3]
    .map(
      (value) =>
        `<button class="${value === selectedLength ? "selected" : ""}" data-action="selectLength" data-value="${value}">${LENGTH_NAMES[value]}</button>`,
    )
    .join("");

  $("#difficultyOptions").innerHTML = [0, 1, 2]
    .map(
      (value) =>
        `<button class="${value === selectedDifficulty ? "selected" : ""}" data-action="selectDifficulty" data-value="${value}">${DIFFICULTY_NAMES[value]}</button>`,
    )
    .join("");

  $("#continueBtn").toggleAttribute("disabled", !engine.hasSave());
  if (!startAnimated) {
    startAnimated = true;
    if (!reduceMotion) {
      animate(".pref-button", {
        opacity: [0, 1],
        translateY: [12, 0],
        duration: 520,
        delay: stagger(7, { from: "first" }),
        ease: "outExpo",
      });
    }
  }
}

function renderHud(): void {
  const self = snap.self;
  const supportWarn = self.support < 52;
  const stat = (label: string, value: string, cls = ""): string =>
    `<div class="stat ${cls}"><span>${label}</span><b>${value}</b></div>`;

  $("#hud").innerHTML = `
    <div class="hud-identity">
      <span class="hud-crest">47</span>
      <div><span class="hud-kicker">NATIONAL COMMAND</span><strong>47国志</strong>
      <small>${DIFFICULTY_NAMES[snap.difficulty]} / ${LENGTH_NAMES[snap.length]}</small></div>
    </div>
    <div class="hud-date"><span>CAMPAIGN DATE</span><strong>${snap.year}<i>/</i>${String(snap.month).padStart(2, "0")}</strong></div>
    <div class="hud-resources">
      ${stat("予算", NUM(self.budget))}
      ${stat("兵糧", NUM(self.food), self.food < 200 ? "warn" : "")}
      ${stat("装備", NUM(self.equip))}
      ${stat("船", String(self.ships))}
      ${stat("航空", `${self.air}機 / T${self.airTech}`)}
      ${stat("士気", String(self.morale))}
      ${stat("支持", `${Math.round(self.support)}%`, supportWarn ? "warn" : "good")}
      ${stat("行動力", `${snap.ap}/${snap.apMax}`, "ap")}
    </div>
    <div class="hud-status">
      ${stat("領土", `${self.towns}/${snap.towns.length}`)}
      ${stat("順位", `${snap.rank}/47`)}
      <span class="hud-chip${self.momentum ? " hot" : ""}">${self.momentum ? "MOMENTUM" : "STABLE"}</span>
    </div>
    <div class="hud-actions"><button data-action="leftTab" data-tab="menu">MENU</button></div>`;

  const latest = snap.news[0];
  $("#ticker").innerHTML = `<span class="ticker-label">INTEL</span>
    <span class="ticker-text">${latest ? html(latest.text) : "報せはまだない"}</span>
    <span class="ticker-turn">T${String(snap.turn).padStart(3, "0")}</span>`;

  $("#bottomInfo").innerHTML = `<span class="bottom-label">ORDERS</span><strong>${html(snap.msg)}</strong>`;
  const nextButton = $<HTMLButtonElement>('[data-action="next"]');
  nextButton.disabled = snap.result !== 0;
  nextButton.textContent = snap.result === 0 ? "月を進める ▶" : "決着がついた";
}

function renderMap(): void {
  japanMap.update(snap, selectedTown);
  units3d?.update(snap, selectedTown);
  const selected = townById(selectedTown);
  const flagOwner = selected?.o ?? snap.player;
  units3d?.setFlagLabel(
    prefProfiles[flagOwner - 1]?.flag ?? "",
    colorOf(flagOwner),
  );
  $("#mapTitle").textContent = selected
    ? `${prefLabel(selected.p)}／${selected.n}`
    : prefLabel(selectedPref);
  $("#mapFooter").textContent = selected
    ? `選択中：${selected.n}／人口 ${selected.pop.toFixed(1)}万人／${NUM(selected.tr)}兵`
    : "市町村を押して命令を選ぶ";
  $("#mapReadout").textContent = selected
    ? `${selected.lat.toFixed(2)}°N  ${selected.lon.toFixed(2)}°E`
    : "35.68°N  139.69°E";

  const rivals = snap.factions.filter((faction) => faction.alive && faction.id !== snap.player).slice(0, 5);
  const powers = [factionById(snap.player), ...rivals];
  const swatches = powers.map((faction) =>
    `<span class="legend-item"><i style="background:${colorOf(faction.id)}"></i>${html(faction.name)}</span>`
  ).join("");
  $("#mapLegend").innerHTML = `<span class="legend-title">POWERS</span>${swatches}
    <span class="legend-item legend-border"><i></i>行政界</span>
    <span class="legend-item legend-highway"><i></i>高速</span>
    <span class="legend-item legend-shinkansen"><i></i>新幹線</span>
    <span class="legend-item legend-rail"><i></i>在来線</span>
    <span class="legend-item legend-order"><i></i>出陣</span>`;
}

function advice(): string {
  const self = snap.self;
  const tips: string[] = [];
  if (self.food < 300)
    tips.push("兵糧が少ない。十月の収穫まで「祭り」と「開墾」でしのぐ。");
  if (self.budget < 60)
    tips.push("財源が苦しい。商業都市を priority に内政を回す。");
  if (self.support < 55)
    tips.push("支持が低下している。祭りと勝戦で民心を戻す。");
  if (snap.orders.length > 0)
    tips.push(
      `出陣中 ${snap.orders.length} 件。補給線が切れていないか確認する。`,
    );
  if (tips.length === 0)
    tips.push("領内は安定している。隣接する弱い町から逐步で広げる好機。");
  return `<div class="panel-section"><h3>参謀の進言</h3><ul class="advice-list">${tips
    .map((tip) => `<li>${html(tip)}</li>`)
    .join("")}</ul></div>`;
}

function renderNewsPanel(): string {
  const items = snap.news
    .slice(0, 20)
    .map(
      (n) =>
        `<li class="k${n.kind}"><em>${dateOf(n.turn)}</em>${html(n.text)}</li>`,
    )
    .join("");
  return `${advice()}<div class="panel-section"><h3>報せ</h3><ul class="news-list">${items || "<li>まだ報せはない。</li>"}</ul></div>`;
}

function renderReportPanel(): string {
  const rows = snap.factions
    .filter((f) => f.alive || f.towns > 0)
    .map(
      (f) =>
        `<tr class="${f.id === snap.player ? "mine" : ""}"><td>${html(f.name)}</td>
      <td class="num">+${f.gained}</td><td class="num">-${f.lost}</td><td class="num">${f.captured}</td></tr>`,
    )
    .join("");
  return `<div class="panel-section"><h3>今月の戦果</h3>
    <p>${snap.report ? html(snap.report) : "大きな合戦はなかった。"}</p></div>
    <div class="panel-section"><h3>天下の戦果</h3>
    <table class="table"><thead><tr><th>勢力</th><th>得</th><th>失</th><th>攻略</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderRankPanel(): string {
  const rows = snap.rankIds
    .slice(0, 20)
    .map((id, i) => {
      const f = factionById(id);
      return `<tr class="${id === snap.player ? "mine" : ""}"><td>${i + 1}</td><td>${html(f.name)}</td>
      <td class="num">${f.towns}</td><td class="num">${NUM(f.troops)}</td></tr>`;
    })
    .join("");
  return `<div class="panel-section"><h3>順位（勢力）</h3>
    <table class="table"><thead><tr><th>#</th><th>勢力</th><th>町</th><th>兵</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderDiplomacyPanel(): string {
  const proposals = snap.proposals
    .map((code, i) => {
      const from = Math.floor(code / 10);
      const type = code % 10;
      const label = type === 0 ? "同盟" : type === 1 ? "停戦" : "交易";
      return `<div class="panel-section"><h3>${html(factionById(from).name)}から書状</h3>
      <p>${label}の申し出が届いている。</p>
      <div class="row"><button class="small primary" data-action="proposal" data-index="${i}" data-accept="1">受ける</button>
      <button class="small" data-action="proposal" data-index="${i}" data-accept="0">断る</button></div></div>`;
    })
    .join("");

  const own = snap.towns.filter((t) => t.o === snap.player);
  const seen = new Set<number>();
  const rows: string[] = [];
  for (const target of snap.towns) {
    if (target.o === snap.player || seen.has(target.o)) continue;
    if (!own.some((t) => adjacentTown(t, target))) continue;
    seen.add(target.o);
    const f = factionById(target.o);
    const rel = relationAt(snap.player, target.o);
    rows.push(`<tr><td>${html(f.name)}</td><td>${PERSONALITY_NAMES[f.personality]}</td><td class="num">${rel > 0 ? "+" : ""}${rel}</td>
      <td>${treatyNames(snap.player, target.o)}</td>
      <td><button class="small" data-action="diplo" data-target="${target.o}" data-type="0">同盟</button>
      <button class="small" data-action="diplo" data-target="${target.o}" data-type="1">停戦</button>
      <button class="small" data-action="diplo" data-target="${target.o}" data-type="2">交易</button></td></tr>`);
  }

  return `${proposals}<div class="panel-section"><h3>外交（行動力1）</h3>
    <table class="table"><thead><tr><th>勢力</th><th>気質</th><th>関係</th><th>約束</th><th></th></tr></thead>
    <tbody>${rows.join("") || "<tr><td colspan='5'>隣り合う勢力がない。</td></tr>"}</tbody></table>
    <p class="hint">同盟20・停戦10・交易0・贈り物30。断られても行動力は戻らない。</p>
    <div class="row"><span class="grow">贈り物を送る相手は下の隣接勢力から選ぶ。</span><button class="small" data-action="giftToMenu">贈り物 (30)</button></div>
    </div>`;
}

function renderTalentPanel(): string {
  const own = snap.towns.filter((t) => t.o === snap.player);
  const leaders = [...own]
    .sort((a, b) => b.pop * (1 + b.co * 0.1) - a.pop * (1 + a.co * 0.1))
    .slice(0, 10);
  const scouts = [...own].sort((a, b) => b.growth - a.growth).slice(0, 6);
  const leaderRows = leaders
    .map(
      (
        t,
        i,
      ) => `<tr class="${t.id === selectedTown ? "mine" : ""}"><td>${i + 1}</td>
    <td><button class="link-button" data-action="town" data-town="${t.id}" data-pref="${t.p}">${html(t.n)}</button></td>
    <td class="num">${t.pop.toFixed(1)}</td><td>${SPECIALS[t.sp] ?? "—"}</td></tr>`,
    )
    .join("");
  const scoutRows = scouts
    .map(
      (t) =>
        `<li>${html(t.n)}（人口増 ${t.growth > 0 ? "+" : ""}${t.growth}%）</li>`,
    )
    .join("");
  return `<div class="panel-section"><h3>人材（有力都市）</h3>
    <table class="table"><thead><tr><th>#</th><th>町</th><th>万人</th><th>名産</th></tr></thead><tbody>${leaderRows}</tbody></table></div>
    <div class="panel-section"><h3>伸展する町</h3><ul class="news-list">${scoutRows}</ul>
    <p class="hint">人材は都市の人口・商業・伸びから判断する。登用は内政の効果を高める。</p></div>`;
}

function renderBrandPanel(): string {
  const counts = SPECIALS.map(
    (_, i) =>
      snap.towns.filter((t) => t.o === snap.player && t.sp === i).length,
  );
  const rows = SPECIALS.map((name, i) => {
    const level = Math.min(Math.floor(counts[i] / 3), 3);
    return `<tr><td>${html(name)}</td><td class="num">${counts[i]}</td><td class="num">${"●".repeat(level)}${"○".repeat(3 - level)}</td></tr>`;
  }).join("");
  return `<div class="panel-section"><h3>名産とブランド</h3>
    <p class="hint">同じ種類を3・6・10町でLv1・2・3。効果は重なる。</p>
    <table class="table"><thead><tr><th>種類</th><th>町</th><th>Lv</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderMenuPanel(): string {
  return `<div class="panel-section"><h3>メニュー</h3>
    <div class="row" style="flex-direction:column;align-items:stretch">
      <button data-action="saveLocal">セーブする（自動保存もあり）</button>
      <button data-action="loadLocal">セーブを読みこむ</button>
      <button data-action="exportSave">セーブをJSONで書き出す</button>
      <button data-action="importSave">セーブをJSONで読みこむ</button>
      <button data-action="restart" class="danger">はじめから</button>
    </div></div>
    <div class="panel-section"><h3>遊び方（概要）</h3>
      <p>毎月、行動力を使って内政・徴兵・出陣・外交を行う。月を進めると合戦と収入が解決し、CPU勢力も動く。</p>
      <p>4年ごとの知事選で支持が50%を切ると落選。全ての町を取れば天下統一。10年／20年では期限の順位も評価される。</p>
      <p class="hint">地図は国土数値情報の行政界と国土地理院タイル、人口は国勢調査に基づく実データ。計算はすべて WebAssembly で行う。</p>
    </div>
    <div class="panel-section"><h3>データ出典</h3>
      <p class="hint">行政界：国土交通省 国土数値情報 N03（CC BY 4.0）／人口：総務省 令和7年国勢調査を街の通信簿が整理したデータ／背景：国土地理院 地理院タイル</p>
      <div class="swatches">${Array.from({ length: 12 }, (_, i) => `<span class="swatch" style="background:${colorOf(i + 1)}"></span>`).join("")}</div>
    </div>`;
}

function renderFlagPanel(): string {
  const profile = prefProfiles[selectedPref - 1] ?? defaultPrefProfile(selectedPref);
  const options = PREF_NAMES.map((_, i) => {
    const id = i + 1;
    return `<option value="${id}"${id === selectedPref ? " selected" : ""}>${html(prefLabel(id))}</option>`;
  }).join("");
  return `<div class="panel-section"><h3>県旗と県名</h3>
    <p class="hint"> flag は絵文字や短い文字列で表現する。変更はこの端末に保存され、地図・ツールチップ・3D旗に反映される。リプレイには含まれない。</p>
    <div class="pref-editor">
      <label>対象の県<select id="prefProfileSelect">${options}</select></label>
      <label>表示名<input id="prefNameInput" maxlength="12" value="${html(profile.name)}"></label>
      <label>旗<input id="prefFlagInput" maxlength="8" value="${html(profile.flag)}" placeholder="🏯 など"></label>
      <div class="pref-flag-preview" style="--flag-color:${colorOf(selectedPref)}">
        <span>${html(profile.flag || "◈")}</span><strong>${html(profile.name)}</strong>
      </div>
    </div>
    <div class="row">
      <button class="primary" data-action="savePrefProfile">地図に反映</button>
      <button data-action="resetPrefProfile">この県を元に戻す</button>
      <button data-action="resetAllPrefProfiles">すべて元に戻す</button>
    </div>
  </div>`;
}

function renderLeft(): void {
  $("#leftTabs").innerHTML = LEFT_TABS.map(
    (tab) =>
      `<button class="${tab.id === leftTab ? "selected" : ""}" data-action="leftTab" data-tab="${tab.id}">${tab.label}</button>`,
  ).join("");
  const renderers: Record<string, () => string> = {
    news: renderNewsPanel,
    report: renderReportPanel,
    rank: renderRankPanel,
    diplo: renderDiplomacyPanel,
    talent: renderTalentPanel,
    brand: renderBrandPanel,
    flag: renderFlagPanel,
    menu: renderMenuPanel,
  };
  $("#leftPanel").innerHTML = renderers[leftTab]();
}

function commandButton(
  label: string,
  note: string,
  kind: number,
  a: number,
  b = 1,
): string {
  return `<button data-action="cmd" data-kind="${kind}" data-a="${a}" data-b="${b}">${label}<small>${note}</small></button>`;
}

function prepareAttack(): void {
  const target = townById(selectedTown);
  if (!target || target.o === snap.player) {
    attackFrom = -1;
    attackTroops = 0;
    return;
  }
  const candidates = snap.towns.filter(
    (t) => t.o === snap.player && adjacentTown(t, target),
  );
  const current = candidates.find((t) => t.id === attackFrom);
  if (!current) {
    candidates.sort((a, b) => b.tr - a.tr);
    attackFrom = candidates[0]?.id ?? -1;
  }
  const from = townById(attackFrom);
  attackTroops = from
    ? Math.max(100, Math.floor((from.tr * 0.75) / 100) * 100)
    : 0;
}

function renderEstimate(): string {
  if (attackFrom < 0 || selectedTown < 0)
    return "<div class='estimate'>出陣できる自領の町がない。</div>";
  const odds: Odds = engine.odds(attackFrom, selectedTown, attackTroops);
  if (!odds.ok)
    return "<div class='estimate'>隣り合っていないか、港が必要。</div>";
  return `<div class="estimate">
    <div class="row"><span>勝算</span><strong class="grow">${html(odds.label)} ${Number(odds.odds).toFixed(1)}%</strong></div>
    <div>攻め ${html(odds.attack)} ／ 守り ${html(odds.defense)}</div>
    <div class="hint">送れる兵の上限 ${NUM(odds.max)}。月末に結果が出る。</div>
  </div>`;
}

function renderRight(): void {
  const t = townById(selectedTown);
  if (!t) {
    $("#rightPanel").innerHTML =
      "<p>地図の市町村、または左の列表から町を選んで命令を選ぶ。</p>";
    return;
  }
  const pref = prefLabel(t.p);
  const owner = factionById(t.o);
  const own = t.o === snap.player;
  const flags: string[] = [];
  if (t.cp) flags.push(`<span class="badge red">県庁</span>`);
  if (t.po) flags.push(`<span class="badge blue">港</span>`);
  if (t.fo) flags.push(`<span class="badge">陣 ×${t.fo}</span>`);
  if (t.sc) flags.push(`<span class="badge red">補給線なし</span>`);
  if (t.sp >= 0)
    flags.push(`<span class="badge">${html(SPECIALS[t.sp])}</span>`);
  if (t.growth > 20)
    flags.push(`<span class="badge">人口増 ${t.growth}%</span>`);

  let commands = "";
  if (own) {
    commands = `<div class="panel-section"><h3>内政・軍令（行動力1）</h3>
      <div class="command-grid">
        ${commandButton("商業 +1", `予算 ${(12 + t.pop * 0.06).toFixed(1)}`, 0, t.id)}
        ${commandButton("商業 +3", `予算 ${((12 + t.pop * 0.06) * 3).toFixed(1)}`, 0, t.id, 3)}
        ${commandButton("開墾 +1", "予算 14", 1, t.id)}
        ${commandButton("開墾 +3", "予算 42", 1, t.id, 3)}
        ${commandButton("殖産 +1", `予算 ${(22 + t.pop * 0.05).toFixed(1)}`, 2, t.id)}
        ${commandButton("殖産 +3", `予算 ${((22 + t.pop * 0.05) * 3).toFixed(1)}`, 2, t.id, 3)}
        ${commandButton("祭り", "兵糧20・民心+", 3, t.id)}
        ${commandButton("築城 +1", "予算30・装備5", 4, t.id)}
        ${commandButton("徴兵", "予算8・装備2・民心-6", 5, t.id)}
        ${commandButton("募兵", "予算50・兵糧60・4000兵", 6, t.id)}
        ${t.po ? commandButton("造船", "予算35・装備10", 7, t.id) : ""}
        ${commandButton("集結", "奥の町から兵を集める", 10, t.id)}
      </div></div>
      <div class="panel-section"><h3>調達・航空（行動力1）</h3>
        <div class="command-grid">
          ${commandButton("武器 +40", "予算 32", 16, 4, 0)}
          ${commandButton("戦闘機 +3", "予算 54", 16, 3, 1)}
          ${snap.self.airTech < 3
            ? commandButton(
                `航空技術 T${snap.self.airTech + 1}`,
                `予算 ${(snap.self.airTech + 1) * 45}`,
                17,
                snap.self.airTech + 1,
              )
            : `<div class="command-button disabled"><strong>航空技術 最高</strong><span>T3</span></div>`}
        </div></div>`;
  } else {
    const sources = snap.towns.filter(
      (s) => s.o === snap.player && adjacentTown(s, t),
    );
    const options = sources
      .map(
        (s) =>
          `<option value="${s.id}"${s.id === attackFrom ? " selected" : ""}>${html(s.n)}（${NUM(s.tr)}兵）</option>`,
      )
      .join("");
    const max = townById(attackFrom)?.tr ?? 0;
    commands = `<div class="panel-section"><h3>出陣（行動力1）</h3>
      ${
        sources.length
          ? `
        <div class="row"><select id="fromTown" class="grow">${options}</select></div>
        <div class="row"><span>兵</span><input id="troopsRange" class="grow" type="range" min="100" max="${Math.max(100, max)}" step="100" value="${Math.min(attackTroops, Math.max(100, max))}" />
          <span id="troopsValue">${NUM(attackTroops)}</span></div>
        <div id="estimateBox">${renderEstimate()}</div>
        <div class="row" style="margin-top:8px"><button class="primary grow" data-action="attack">出陣する</button>
        <button data-action="scout" data-target="${t.o}">物見</button></div>
      `
          : "<p>この町へ出陣できる自領の町がない。</p>"
      }
      <p class="hint">総攻めは「報せ」以外のタブからは実行できません。戦果タブで確認。</p>
    </div>`;
  }

  const list = townsByPref.get(t.p) ?? [];
  const townList = list
    .slice(0, 80)
    .map(
      (item) =>
        `<button class="${item.id === selectedTown ? "selected" : ""}" data-action="town" data-town="${item.id}" data-pref="${t.p}">
      <span>${html(item.n)}</span><span>${html(prefLabel(item.o))} ${NUM(item.tr)}</span>
    </button>`,
    )
    .join("");

  $("#rightPanel").innerHTML = `
    <div class="panel-section">
      <div class="town-head"><strong>${html(t.n)}</strong><span>${html(pref)}</span></div>
      <div>${flags.join("")}</div>
      <div class="kv">
        <span>支配</span><b>${html(owner.name)}</b>
        <span>人口</span><b>${t.pop.toFixed(1)}万人</b>
        <span>兵</span><b>${NUM(t.tr)}</b>
        <span>民心 / 士気</span><b>${t.mo}</b>
        <span>城 / 商業 / 農 / 工</span><b>${t.ca} / ${t.co} / ${t.fa} / ${t.in}</b>
        <span>税 / 伸び</span><b>${NUM(t.tax)} / ${t.growth}%</b>
      </div>
    </div>
    ${commands}
    <div class="panel-section"><h3>${html(pref)}の市町村（${list.length}）</h3><div class="town-list">${townList}</div>
      ${list.length > 80 ? `<p class="hint">上位80町を表示。地図を拡大して残りを選ぶ。</p>` : ""}</div>`;
}

function renderAll(): void {
  const key = `${snap.towns.length}:${snap.player}`;
  if (key !== townIndexKey) {
    townIndexKey = key;
    townsByPref = new Map();
    for (const t of snap.towns) {
      const list = townsByPref.get(t.p) ?? [];
      list.push(t);
      townsByPref.set(t.p, list);
    }
  }
  renderHud();
  renderMap();
  renderLeft();
  prepareAttack();
  renderRight();
}

function apply(next: Snapshot): void {
  snap = next;
  renderAll();
  try {
    engine.saveLocal();
  } catch {
    // 保存できない環境でもゲームは続けられる
  }
  if (snap.result !== 0 && snap.result !== lastResult) {
    lastResult = snap.result;
    showResult();
  }
}

function showResult(): void {
  const titles: Record<number, string> = {
    1: "天下統一",
    2: "天下取りの終わり",
    3: "年代の決着",
  };
  const bodies: Record<number, string> = {
    1: "47県をひとつにまとめた。日本の主はあなただ。",
    2:
      snap.self.towns === 0
        ? "すべての町を失った。"
        : "知事選に落ちた。民の心を取り戻せなかった。",
    3: `${snap.rank}位で年代を終えた。増やした町の数が評価される。`,
  };
  showModal(
    titles[snap.result],
    `<p>${bodies[snap.result]}</p><p class="hint">${html(snap.msg)}</p>
    <button data-action="restart" class="primary">はじめから遊ぶ</button>`,
    true,
  );
}

function showModal(title: string, body: string, cutin = false): void {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = body;
  $("#modal").classList.toggle("cutin", cutin);
  $("#modal").classList.remove("hidden");
  if (reduceMotion) return;
  animate(".modal-card", {
    opacity: [0, 1],
    translateY: [28, 0],
    scale: [0.965, 1],
    duration: 560,
    ease: "outExpo",
  });
  animate("#modalTitle", {
    opacity: [0, 1],
    translateX: [-18, 0],
    duration: 480,
    ease: "outExpo",
  });
  if (cutin) {
    animate(".cutin-mark", {
      opacity: [0, 1],
      translateX: [-24, 0],
      rotate: [-6, 0],
      duration: 520,
      ease: "outExpo",
    });
    animate(".cutin-line", {
      opacity: [0, 1],
      translateY: [14, 0],
      duration: 560,
      delay: 120,
      ease: "outExpo",
    });
  }
}

function hideModal(): void {
  $("#modal").classList.add("hidden");
  $("#modal").classList.remove("cutin");
}

async function ensureIntro(): Promise<void> {
  if (intro || introLoading || reduceMotion) return;
  introLoading = (async () => {
    const { createIntro } = await import("./intro");
    intro = await createIntro();
  })();
  await introLoading;
}

function disposeIntro(): void {
  intro?.dispose();
  intro = undefined;
  introLoading = undefined;
}

async function ensureUnits3D(): Promise<void> {
  if (units3d) return;
  const { Units3D: Units3DClass } = await import("./units3d");
  units3d = await Units3DClass.create(japanMap.getMap(), $("#map"));
}

async function startGame(
  seed: number,
  pref: number,
  difficulty: number,
  length: number,
): Promise<void> {
  await ensureUnits3D();
  apply(engine.boot(seed, pref, difficulty, length));
  selectedPref = pref;
  selectedTown = snap.prefs[pref - 1].cap;
  lastResult = 0;
  japanMap.resize();
  units3d?.resize();
  japanMap.resetView();
  japanMap.focusTown(selectedTown);
  japanMap.invalidate();
}

function downloadSave(): void {
  const data = JSON.stringify(engine.exportSave(), null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `47kokushi-${snap.year}${String(snap.month).padStart(2, "0")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function handleAction(action: string, el: Element): Promise<void> {
  const attr = (name: string): number => Number(el.getAttribute(name) ?? 0);
  switch (action) {
    case "selectPref":
      selectedPref = attr("data-pref");
      renderStartOptions();
      break;
    case "selectLength":
      selectedLength = attr("data-value");
      renderStartOptions();
      break;
    case "selectDifficulty":
      selectedDifficulty = attr("data-value");
      renderStartOptions();
      break;
    case "start":
      disposeIntro();
      $("#start").classList.add("hidden");
      $("#app").classList.remove("hidden");
      await startGame(
        Math.floor(Math.random() * 1000000000),
        selectedPref,
        selectedDifficulty,
        selectedLength,
      );
      break;
    case "continue": {
      const saved = engine.hasSave();
      if (!saved) return;
      disposeIntro();
      $("#start").classList.add("hidden");
      $("#app").classList.remove("hidden");
      lastResult = 0;
      await ensureUnits3D();
      apply(engine.replay(saved));
      selectedPref = snap.player;
      selectedTown = snap.prefs[snap.player - 1].cap;
      japanMap.resize();
      units3d?.resize();
      japanMap.resetView();
      japanMap.focusTown(selectedTown);
      japanMap.invalidate();
      renderAll();
      break;
    }
    case "pref":
      selectedPref = attr("data-pref");
      selectedTown = snap.prefs[selectedPref - 1].cap;
      japanMap.focusPref(selectedPref);
      renderAll();
      break;
    case "town":
      selectedTown = attr("data-town");
      selectedPref = attr("data-pref");
      japanMap.focusTown(selectedTown);
      renderAll();
      break;
    case "mapReset":
      japanMap.resetView();
      break;
    case "mapFocus":
      japanMap.focusTown(selectedTown);
      break;
    case "tile": {
      const mode = el.getAttribute("data-mode") as TileMode;
      japanMap.setTileMode(mode);
      document
        .querySelectorAll("[data-action='tile']")
        .forEach((button) =>
          button.classList.toggle(
            "selected",
            button.getAttribute("data-mode") === mode,
          ),
        );
      break;
    }
    case "units3d": {
      const button = el as HTMLElement;
      const next = !button.classList.contains("selected");
      button.classList.toggle("selected", next);
      units3d?.setVisible(next);
      break;
    }
    case "leftTab":
      leftTab = el.getAttribute("data-tab") ?? "news";
      renderLeft();
      break;
    case "next": {
      const previousTowns = snap.self.towns;
      apply(engine.nextMonth());
      const gained = snap.self.towns - previousTowns;
      if (snap.report && snap.result === 0) {
        const cutin = gained > 0 || /落とし|制圧|天下/.test(snap.report);
        showModal(
          `${snap.year}年${snap.month}月の戦果${gained > 0 ? ` ＋${gained}町` : ""}`,
          `<span class="cutin-mark">戦果報告 / AFTER ACTION REPORT</span>
           <p class="cutin-line">${html(snap.report)}</p>
           <p class="hint">${html(
             snap.news
               .slice(0, 4)
               .map((n) => n.text)
               .join("／"),
           )}</p>`,
          cutin,
        );
      }
      break;
    }
    case "cmd":
      apply(engine.cmd(attr("data-kind"), attr("data-a"), attr("data-b"), 0));
      break;
    case "attack":
      apply(engine.cmd(8, attackFrom, selectedTown, attackTroops));
      break;
    case "scout":
      apply(engine.cmd(13, 0, attr("data-target"), 0));
      break;
    case "diplo": {
      const target = attr("data-target");
      $("#rightPanel").insertAdjacentHTML(
        "afterbegin",
        `<div class="panel-section"><h3>${html(factionById(target).name)}への申し出</h3>
          <div class="row"><button class="small primary" data-action="diploSend" data-target="${target}" data-type="${attr("data-type")}">送る（予算は成功時のみ）</button>
          <button class="small" data-action="giftTo" data-target="${target}">贈り物（30）</button></div></div>`,
      );
      break;
    }
    case "diploSend":
      apply(engine.cmd(11, 0, attr("data-target"), attr("data-type")));
      break;
    case "giftTo":
      apply(engine.cmd(11, 0, attr("data-target"), 3));
      break;
    case "gift":
    case "giftToMenu":
      leftTab = "diplo";
      renderLeft();
      showModal(
        "贈り物",
        "<p>下の隣接勢力の「贈り物」ボタンから相手を選んで送る。関係が上がり、同盟が通りやすくなる。</p>",
      );
      break;
    case "proposal":
      apply(engine.cmd(12, attr("data-index"), attr("data-accept"), 0));
      break;
    case "saveLocal":
      engine.saveLocal();
      showModal(
        "セーブ",
        "<p>この端末にセーブした。次回は「つづきから」で再開できる。</p>",
      );
      break;
    case "loadLocal": {
      const saved = engine.hasSave();
      if (saved) {
        lastResult = 0;
        apply(engine.replay(saved));
        hideModal();
      } else showModal("セーブ", "<p>セーブが見つからない。</p>");
      break;
    }
    case "exportSave":
      downloadSave();
      break;
    case "importSave":
      $("#fileInput").click();
      break;
    case "restart":
      hideModal();
      $("#app").classList.add("hidden");
      $("#start").classList.remove("hidden");
      lastResult = 0;
      renderStartOptions();
      void ensureIntro();
      break;
    case "savePrefProfile": {
      const nameInput = $<HTMLInputElement>("#prefNameInput");
      const flagInput = $<HTMLInputElement>("#prefFlagInput");
      prefProfiles[selectedPref - 1] = cleanPrefProfile(
        { name: nameInput.value, flag: flagInput.value },
        selectedPref,
      );
      applyPrefProfiles();
      break;
    }
    case "resetPrefProfile":
      prefProfiles[selectedPref - 1] = defaultPrefProfile(selectedPref);
      applyPrefProfiles();
      break;
    case "resetAllPrefProfiles":
      prefProfiles = PREF_NAMES.map((_, i) => defaultPrefProfile(i + 1));
      applyPrefProfiles();
      break;
    case "closeModal":
      hideModal();
      break;
  }
}

async function main(): Promise<void> {
  japanMap = new JapanMap("map", {
    onTown: (id) => {
      selectedTown = id;
      const town = snap?.towns[id];
      if (town) selectedPref = town.p;
    },
    onPref: (pref) => {
      selectedPref = pref;
    },
  });
  engine = await GameEngine.create();
  await japanMap.load();
  japanMap.setPrefLabels(prefProfiles.map((_, i) => prefLabel(i + 1)));
  snap = engine.boot(1, 13, 1, 1);
  selectedTown = snap.prefs[12].cap;
  selectedPref = 13;
  renderStartOptions();
  $("#loading").classList.add("hidden");
  $("#start").classList.remove("hidden");
  void ensureIntro();
}

document.addEventListener("click", (event) => {
  const el = (event.target as Element).closest<Element>("[data-action]");
  if (!el) return;
  void handleAction(el.getAttribute("data-action") ?? "", el);
});

document.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement;
  if (target.id === "troopsRange") {
    attackTroops = Number(target.value);
    const label = $("#troopsValue");
    if (label) label.textContent = NUM(attackTroops);
    const box = $("#estimateBox");
    if (box) box.innerHTML = renderEstimate();
  }
  if (target.id === "fromTown") {
    attackFrom = Number(target.value);
    const from = townById(attackFrom);
    attackTroops = from
      ? Math.max(100, Math.floor((from.tr * 0.75) / 100) * 100)
      : 0;
    const range = $<HTMLInputElement>("#troopsRange");
    range.max = String(Math.max(100, from?.tr ?? 100));
    range.value = String(Math.min(attackTroops, Number(range.max)));
    const box = $("#estimateBox");
    if (box) box.innerHTML = renderEstimate();
  }
});

document.addEventListener("change", (event) => {
  const target = event.target as HTMLSelectElement;
  if (target.id === "prefProfileSelect") {
    selectedPref = Number(target.value);
    renderLeft();
  }
});

$("#fileInput").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text()) as import("./types").SaveData;
    if (data.version !== 1 || !Array.isArray(data.calls))
      throw new Error("形式が違う");
    lastResult = 0;
    apply(engine.replay(data));
    hideModal();
  } catch (error) {
    showModal("読み込み失敗", `<p>${html(String(error))}</p>`);
  }
  input.value = "";
});

main().catch((error: unknown) => {
  $("#loading").textContent = `起動に失敗しました: ${String(error)}`;
});
