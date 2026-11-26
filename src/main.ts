import "./style.css";
import { GameEngine } from "./engine";
import type { Odds, Snapshot } from "./types";
import { LAND_PAIRS, SEA_PAIRS, LON, LAT, PREF_NAMES, SPECIALS, STARS } from "../engine/data";

const $ = <T extends Element = HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`要素が見つかりません: ${selector}`);
  return found;
};

const html = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const NUM = (value: number): string => Math.round(value).toLocaleString("ja-JP");

const DIFFICULTY_NAMES = ["イージー", "ノーマル", "ハード"];
const LENGTH_NAMES: Record<number, string> = { 1: "10年", 2: "20年", 3: "期限なし" };
const PERSONALITY_NAMES = ["好戦的", "慎重", "商人気質", "義理堅い", "野心家"];
const LEFT_TABS = [
  { id: "news", label: "報せ" },
  { id: "rank", label: "順位" },
  { id: "diplo", label: "外交" },
  { id: "brand", label: "名産" },
  { id: "menu", label: "メニュー" },
];

let engine: GameEngine;
let snap: Snapshot;
let selectedPref = 13;
let selectedTown = 0;
let selectedLength = 1;
let selectedDifficulty = 1;
let leftTab = "news";
let attackFrom = -1;
let attackTroops = 0;
let lastResult = 0;

function colorOf(id: number): string {
  const hue = (id * 137 + 18) % 360;
  const saturation = 38 + (id % 4) * 7;
  const lightness = 35 + (id % 5) * 5;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function project(pref: number): { x: number; y: number } {
  const x = 40 + ((LON[pref - 1] - 126.3) / 18.3) * 920;
  const y = 30 + ((44.4 - LAT[pref - 1]) / 18.8) * 690;
  return { x, y };
}

function hexPoints(x: number, y: number, r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    points.push(`${(x + Math.cos(angle) * r).toFixed(1)},${(y + Math.sin(angle) * r).toFixed(1)}`);
  }
  return points.join(" ");
}

function townById(id: number) {
  return snap.towns.find((t) => t.id === id);
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

function renderStartOptions(): void {
  const grid = $("#prefGrid");
  grid.innerHTML = PREF_NAMES.map((name, i) => {
    const id = i + 1;
    const stars = "★".repeat(STARS[i]);
    return `<button class="pref-button${id === selectedPref ? " selected" : ""}" data-action="selectPref" data-pref="${id}">
      <span>${html(name)}</span><span class="stars">${stars}</span>
    </button>`;
  }).join("");

  $("#lengthOptions").innerHTML = [1, 2, 3].map((value) =>
    `<button class="${value === selectedLength ? "selected" : ""}" data-action="selectLength" data-value="${value}">${LENGTH_NAMES[value]}</button>`
  ).join("");

  $("#difficultyOptions").innerHTML = [0, 1, 2].map((value) =>
    `<button class="${value === selectedDifficulty ? "selected" : ""}" data-action="selectDifficulty" data-value="${value}">${DIFFICULTY_NAMES[value]}</button>`
  ).join("");

  const saved = engine.hasSave();
  $("#continueBtn").toggleAttribute("disabled", !saved);
}

function renderHud(): void {
  const self = snap.self;
  const supportWarn = self.support < 52;
  const stat = (label: string, value: string, cls = ""): string =>
    `<div class="stat ${cls}">${label}<b>${value}</b></div>`;

  $("#hud").innerHTML = `
    <div class="hud-title">47国志<small>${DIFFICULTY_NAMES[snap.difficulty]}・${LENGTH_NAMES[snap.length]}</small></div>
    ${stat("年月", `${snap.year}/${String(snap.month).padStart(2, "0")}`)}
    ${stat("予算", NUM(self.budget))}
    ${stat("兵糧", NUM(self.food), self.food < 200 ? "warn" : "")}
    ${stat("装備", NUM(self.equip))}
    ${stat("船", String(self.ships))}
    ${stat("士気", String(self.morale))}
    ${stat("支持", `${Math.round(self.support)}%`, supportWarn ? "warn" : "good")}
    ${stat("行動力", `${snap.ap}/${snap.apMax}`)}
    ${stat("順位", `${snap.rank}/47`)}
    ${stat("勢い", self.momentum ? "乗る" : "—", self.momentum ? "good" : "")}
    <div class="hud-spacer"></div>
    <div class="hud-actions">
      <button data-action="leftTab" data-tab="menu" class="small">メニュー</button>
    </div>`;

  const latest = snap.news[0];
  $("#ticker").innerHTML = `<span class="ticker-label">速報</span>
    <span class="ticker-text">${latest ? html(latest.text) : "報せはまだない"}</span>`;

  $("#bottomInfo").innerHTML = `<strong>${html(snap.msg)}</strong>`;
  const nextButton = $<HTMLButtonElement>('[data-action="next"]');
  nextButton.disabled = snap.result !== 0;
  nextButton.textContent = snap.result === 0 ? "月を進める ▶" : "決着がついた";
}

function renderMap(): void {
  const parts: string[] = [];
  const townsByPref = new Map<number, typeof snap.towns>();
  for (const t of snap.towns) {
    const list = townsByPref.get(t.p) ?? [];
    list.push(t);
    townsByPref.set(t.p, list);
  }

  for (let i = 0; i < LAND_PAIRS.length; i += 2) {
    const a = project(LAND_PAIRS[i]);
    const b = project(LAND_PAIRS[i + 1]);
    parts.push(`<line class="land-edge" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`);
  }
  for (let i = 0; i < SEA_PAIRS.length; i += 2) {
    const a = project(SEA_PAIRS[i]);
    const b = project(SEA_PAIRS[i + 1]);
    parts.push(`<line class="sea-edge" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`);
  }

  for (let p = 1; p <= 47; p++) {
    const { x, y } = project(p);
    const owner = snap.prefs[p - 1].owner;
    const selected = p === selectedPref;
    parts.push(`<polygon class="pref-shape${selected ? " selected" : ""}" points="${hexPoints(x, y, 24)}"
      fill="${colorOf(owner)}" data-action="pref" data-pref="${p}" />`);
    parts.push(`<text class="pref-label" x="${x}" y="${y - 29}">${html(PREF_NAMES[p - 1])}</text>`);
    const towns = townsByPref.get(p) ?? [];
    towns.forEach((t, idx) => {
      const angle = (Math.PI * 2 * idx) / Math.max(towns.length, 1) - Math.PI / 2;
      const radius = idx === 0 ? 0 : towns.length > 6 ? 14 : 12;
      const tx = x + Math.cos(angle) * radius;
      const ty = y + Math.sin(angle) * radius;
      const march = snap.orders.some((o) => o.to === t.id || o.from === t.id);
      const cls = `town-dot${t.id === selectedTown ? " selected" : ""}${march ? " marching" : ""}`;
      const stroke = t.o === snap.player ? "#e9c35f" : "rgba(255,255,255,0.75)";
      parts.push(`<circle class="${cls}" cx="${tx}" cy="${ty}" r="${idx === 0 ? 5 : 3.6}"
        fill="${colorOf(t.o)}" stroke="${stroke}" data-action="town" data-town="${t.id}" data-pref="${p}" />`);
    });
  }

  for (const order of snap.orders) {
    const from = townById(order.from);
    const to = townById(order.to);
    if (!from || !to) continue;
    const a = project(from.p);
    const b = project(to.p);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2 - 42;
    parts.push(`<path class="order-line" d="M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}" />`);
    parts.push(`<text class="order-label" x="${mx}" y="${my - 3}" text-anchor="middle">${NUM(order.troops)}</text>`);
  }

  $("#map").innerHTML = parts.join("");
  $("#mapTitle").textContent = `${PREF_NAMES[selectedPref - 1]}県`;
  const selected = townById(selectedTown);
  $("#mapFooter").textContent = selected
    ? `選択中：${selected.n}（${PREF_NAMES[selected.p - 1]}）`
    : "都道府県を押して町を選ぶ";
}

function renderNewsPanel(): string {
  const items = snap.news.slice(0, 18).map((n) =>
    `<li class="k${n.kind}"><em>${dateOf(n.turn)}</em>${html(n.text)}</li>`
  ).join("");
  return `<div class="panel-section"><h3>報せ</h3><ul class="news-list">${items || "<li>まだ報せはない。</li>"}</ul></div>`;
}

function renderRankPanel(): string {
  const rows = snap.rankIds.slice(0, 16).map((id, i) => {
    const f = factionById(id);
    return `<tr class="${id === snap.player ? "mine" : ""}"><td>${i + 1}</td><td>${html(f.name)}</td>
      <td class="num">${f.towns}</td><td class="num">${NUM(f.troops)}</td></tr>`;
  }).join("");
  return `<div class="panel-section"><h3>順位（勢力）</h3>
    <table class="table"><thead><tr><th>#</th><th>勢力</th><th>町</th><th>兵</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderDiplomacyPanel(): string {
  const proposals = snap.proposals.map((code, i) => {
    const from = Math.floor(code / 10);
    const type = code % 10;
    const label = type === 0 ? "同盟" : type === 1 ? "停戦" : "交易";
    return `<div class="panel-section"><h3>${html(factionById(from).name)}から書状</h3>
      <p>${label}の申し出が届いている。</p>
      <div class="row"><button class="small primary" data-action="proposal" data-index="${i}" data-accept="1">受ける</button>
      <button class="small" data-action="proposal" data-index="${i}" data-accept="0">断る</button></div></div>`;
  }).join("");

  const seen = new Set<number>();
  const rows: string[] = [];
  for (const t of snap.towns) {
    if (t.o === snap.player || seen.has(t.o)) continue;
    let adjacent = false;
    for (const own of snap.towns) {
      if (own.o !== snap.player) continue;
      if (adjacentTown(own, t)) adjacent = true;
    }
    if (!adjacent) continue;
    seen.add(t.o);
    const f = factionById(t.o);
    const rel = relationAt(snap.player, t.o);
    rows.push(`<tr><td>${html(f.name)}</td><td>${PERSONALITY_NAMES[f.personality]}</td><td class="num">${rel > 0 ? "+" : ""}${rel}</td>
      <td>${treatyNames(snap.player, t.o)}</td>
      <td><button class="small" data-action="diplo" data-target="${t.o}" data-type="0">同盟</button>
      <button class="small" data-action="diplo" data-target="${t.o}" data-type="1">停戦</button>
      <button class="small" data-action="diplo" data-target="${t.o}" data-type="2">交易</button></td></tr>`);
  }

  return `${proposals}<div class="panel-section"><h3>外交（行動力1）</h3>
    <table class="table"><thead><tr><th>勢力</th><th>気質</th><th>関係</th><th>約束</th><th></th></tr></thead>
    <tbody>${rows.join("") || "<tr><td colspan='5'>隣り合う勢力がない。</td></tr>"}</tbody></table>
    <p class="hint">同盟20・停戦10・交易0・贈り物30。断られても行動力は戻らない。</p>
    <div class="row"><span class="grow">贈り物を送る相手は下の隣接勢力から選ぶ。</span><button class="small" data-action="giftToMenu">贈り物 (30)</button></div>
    </div>`;
}

function renderBrandPanel(): string {
  const counts = SPECIALS.map((_, i) => snap.towns.filter((t) => t.o === snap.player && t.sp === i).length);
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
      <p class="hint">パラメータと合戦判定はすべて WebAssembly（AssemblyScript）で計算しています。</p>
    </div>`;
}

function renderLeft(): void {
  $("#leftTabs").innerHTML = LEFT_TABS.map((tab) =>
    `<button class="${tab.id === leftTab ? "selected" : ""}" data-action="leftTab" data-tab="${tab.id}">${tab.label}</button>`
  ).join("");
  const renderers: Record<string, () => string> = {
    news: renderNewsPanel,
    rank: renderRankPanel,
    diplo: renderDiplomacyPanel,
    brand: renderBrandPanel,
    menu: renderMenuPanel,
  };
  $("#leftPanel").innerHTML = renderers[leftTab]();
}

function commandButton(label: string, note: string, kind: number, a: number, b = 1): string {
  return `<button data-action="cmd" data-kind="${kind}" data-a="${a}" data-b="${b}">${label}<small>${note}</small></button>`;
}

function prepareAttack(): void {
  const target = townById(selectedTown);
  if (!target || target.o === snap.player) {
    attackFrom = -1;
    attackTroops = 0;
    return;
  }
  const candidates = snap.towns.filter((t) => t.o === snap.player && adjacentTown(t, target));
  const current = candidates.find((t) => t.id === attackFrom);
  if (!current) {
    candidates.sort((a, b) => b.tr - a.tr);
    attackFrom = candidates[0]?.id ?? -1;
  }
  const from = townById(attackFrom);
  attackTroops = from ? Math.max(500, Math.floor(from.tr * 0.75 / 100) * 100) : 0;
}

function isPair(pairs: number[], a: number, b: number): boolean {
  return pairs.some((v, i) => i % 2 === 0 &&
    ((v === a && pairs[i + 1] === b) || (v === b && pairs[i + 1] === a)));
}

function adjacentTown(a: { p: number; po: number }, b: { p: number; po: number }): boolean {
  if (a.p === b.p) return true;
  if (isPair(LAND_PAIRS, a.p, b.p)) return true;
  return isPair(SEA_PAIRS, a.p, b.p) && a.po === 1 && b.po === 1;
}

function renderEstimate(): string {
  if (attackFrom < 0 || selectedTown < 0) return "<div class='estimate'>出陣できる自領の町がない。</div>";
  const odds: Odds = engine.odds(attackFrom, selectedTown, attackTroops);
  if (!odds.ok) return "<div class='estimate'>隣り合っていないか、港が必要。</div>";
  return `<div class="estimate">
    <div class="row"><span>勝算</span><strong class="grow">${html(odds.label)} ${Number(odds.odds).toFixed(1)}%</strong></div>
    <div>攻め ${html(odds.attack)} ／ 守り ${html(odds.defense)}</div>
    <div class="hint">送れる兵の上限 ${NUM(odds.max)}。月末に結果が出る。</div>
  </div>`;
}

function renderRight(): void {
  const t = townById(selectedTown);
  if (!t) {
    $("#rightPanel").innerHTML = "<p>地図の都道府県、または町を押して命令を選ぶ。</p>";
    return;
  }
  const pref = PREF_NAMES[t.p - 1];
  const owner = factionById(t.o);
  const own = t.o === snap.player;
  const flags: string[] = [];
  if (t.cp) flags.push(`<span class="badge red">県庁</span>`);
  if (t.po) flags.push(`<span class="badge blue">港</span>`);
  if (t.fo) flags.push(`<span class="badge">陣 ×${t.fo}</span>`);
  if (t.sc) flags.push(`<span class="badge red">補給線なし</span>`);
  if (t.sp >= 0) flags.push(`<span class="badge">${html(SPECIALS[t.sp])}</span>`);

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
      </div></div>`;
  } else {
    const sources = snap.towns.filter((s) => s.o === snap.player && adjacentTown(s, t));
    const options = sources.map((s) =>
      `<option value="${s.id}"${s.id === attackFrom ? " selected" : ""}>${html(s.n)}（${NUM(s.tr)}兵）</option>`
    ).join("");
    const max = townById(attackFrom)?.tr ?? 0;
    commands = `<div class="panel-section"><h3>出陣（行動力1）</h3>
      ${sources.length ? `
        <div class="row"><select id="fromTown" class="grow">${options}</select></div>
        <div class="row"><span>兵</span><input id="troopsRange" class="grow" type="range" min="100" max="${Math.max(100, max)}" step="100" value="${Math.min(attackTroops, Math.max(100, max))}" />
          <span id="troopsValue">${NUM(attackTroops)}</span></div>
        <div id="estimateBox">${renderEstimate()}</div>
        <div class="row" style="margin-top:8px"><button class="primary grow" data-action="attack">出陣する</button>
        <button data-action="scout" data-target="${t.o}">物見</button></div>
      ` : "<p>この町へ出陣できる自領の町がない。</p>"}
      <p class="hint">総攻めは「報せ」以外のタブからは実行できません。メニューの戦果で確認。</p>
    </div>`;
  }

  const townList = (townsByPref.get(t.p) ?? []).map((item) =>
    `<button class="${item.id === selectedTown ? "selected" : ""}" data-action="town" data-town="${item.id}" data-pref="${t.p}">
      <span>${html(item.n)}</span><span>${PREF_NAMES[item.o - 1]} ${NUM(item.tr)}</span>
    </button>`
  ).join("");

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
      </div>
    </div>
    ${commands}
    <div class="panel-section"><h3>${html(pref)}の市町村</h3><div class="town-list">${townList}</div></div>`;
}

let townsByPref = new Map<number, Snapshot["towns"]>();

function renderAll(): void {
  townsByPref = new Map();
  for (const t of snap.towns) {
    const list = townsByPref.get(t.p) ?? [];
    list.push(t);
    townsByPref.set(t.p, list);
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
    2: snap.self.towns === 0 ? "すべての町を失った。" : "知事選に落ちた。民の心を取り戻せなかった。",
    3: `${snap.rank}位で年代を終えた。増やした町の数が評価される。`,
  };
  showModal(titles[snap.result], `<p>${bodies[snap.result]}</p><p class="hint">${html(snap.msg)}</p>
    <button data-action="restart" class="primary">はじめから遊ぶ</button>`);
}

function showModal(title: string, body: string): void {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = body;
  $("#modal").classList.remove("hidden");
}

function hideModal(): void {
  $("#modal").classList.add("hidden");
}

function startGame(seed: number, pref: number, difficulty: number, length: number): void {
  apply(engine.boot(seed, pref, difficulty, length));
  selectedPref = pref;
  selectedTown = snap.prefs[pref - 1].cap;
  lastResult = 0;
  renderAll();
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

function handleAction(action: string, el: Element): void {
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
      $("#start").classList.add("hidden");
      $("#app").classList.remove("hidden");
      startGame(Math.floor(Math.random() * 1000000000), selectedPref, selectedDifficulty, selectedLength);
      break;
    case "continue": {
      const saved = engine.hasSave();
      if (!saved) return;
      $("#start").classList.add("hidden");
      $("#app").classList.remove("hidden");
      lastResult = 0;
      apply(engine.replay(saved));
      selectedPref = snap.player;
      selectedTown = snap.prefs[snap.player - 1].cap;
      renderAll();
      break;
    }
    case "pref":
      selectedPref = attr("data-pref");
      selectedTown = snap.prefs[selectedPref - 1].cap;
      renderAll();
      break;
    case "town":
      selectedTown = attr("data-town");
      selectedPref = attr("data-pref");
      renderAll();
      break;
    case "leftTab":
      leftTab = el.getAttribute("data-tab") ?? "news";
      renderLeft();
      break;
    case "next":
      apply(engine.nextMonth());
      if (snap.report && snap.result === 0) {
        showModal(`${snap.year}年${snap.month}月の戦果`, `<p>${html(snap.report)}</p>
          <p class="hint">${html(snap.news.slice(0, 4).map((n) => n.text).join("／"))}</p>`);
      }
      break;
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
      $("#rightPanel").insertAdjacentHTML("afterbegin",
        `<div class="panel-section"><h3>${html(factionById(target).name)}への申し出</h3>
          <div class="row"><button class="small primary" data-action="diploSend" data-target="${target}" data-type="${attr("data-type")}">送る（予算は成功時のみ）</button>
          <button class="small" data-action="giftTo" data-target="${target}">贈り物（30）</button></div></div>`);
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
      showModal("贈り物", "<p>下の隣接勢力の「贈り物」ボタンから相手を選んで送る。関係が上がり、同盟が通りやすくなる。</p>");
      break;
    case "proposal":
      apply(engine.cmd(12, attr("data-index"), attr("data-accept"), 0));
      break;
    case "saveLocal":
      engine.saveLocal();
      showModal("セーブ", "<p>この端末にセーブした。次回は「つづきから」で再開できる。</p>");
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
      break;
    case "closeModal":
      hideModal();
      break;
  }
}

async function main(): Promise<void> {
  engine = await GameEngine.create();
  snap = engine.boot(1, 13, 1, 1);
  selectedTown = snap.prefs[12].cap;
  renderStartOptions();
  $("#loading").classList.add("hidden");
  $("#start").classList.remove("hidden");
}

document.addEventListener("click", (event) => {
  const el = (event.target as Element).closest<Element>("[data-action]");
  if (!el) return;
  handleAction(el.getAttribute("data-action") ?? "", el);
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
});

$("#fileInput").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text()) as import("./types").SaveData;
    if (data.version !== 1 || !Array.isArray(data.calls)) throw new Error("形式が違う");
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
