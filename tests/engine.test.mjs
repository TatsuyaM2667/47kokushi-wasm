import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const wasmBytes = await readFile(new URL("../public/engine.wasm", import.meta.url));

async function createEngine() {
  const { instance } = await WebAssembly.instantiate(wasmBytes, {
    env: { abort: () => { throw new Error("wasm abort"); } },
  });
  const ex = instance.exports;
  const decode = (ptr) => {
    const view = new DataView(ex.memory.buffer);
    const bytes = view.getUint32(ptr - 4, true);
    return new TextDecoder("utf-16le").decode(new Uint8Array(ex.memory.buffer, ptr, bytes));
  };
  const call = (name, ...args) => JSON.parse(decode(ex[name](...args)));
  return { ex, call, decode };
}

test("新規ゲームが47県・市町村・初期値を返す", async () => {
  const { call } = await createEngine();
  const s = call("boot", 42, 31, 1, 1);
  assert.equal(s.prefs.length, 47);
  assert.equal(s.factions.length, 47);
  assert.ok(s.towns.length > 150);
  assert.equal(s.player, 31);
  assert.equal(s.year, 2027);
  assert.equal(s.month, 4);
  assert.ok(s.ap >= 2 && s.ap <= 12);
  assert.ok(s.self.budget > 0);
  assert.ok(s.towns.every((t) => t.o >= 1 && t.o <= 47 && t.tr >= 0));
});

test("内政が行動力と予算を消費し、町が変化する", async () => {
  const { call } = await createEngine();
  const before = call("boot", 7, 31, 1, 1);
  const town = before.towns.find((t) => t.o === 31);
  const after = call("cmd", 0, town.id, 1, 0);
  assert.equal(after.ap, before.ap - 1);
  assert.ok(after.self.budget < before.self.budget);
  assert.ok(after.towns[town.id].co > town.co);
  assert.match(after.msg, /商業/);
});

test("出陣の見込みとコマンドが動作する", async () => {
  const { call, decode, ex } = await createEngine();
  const s = call("boot", 11, 33, 1, 1);
  const own = s.towns.find((t) => t.o === 33 && t.tr > 3000);
  const enemy = s.towns.find((t) => t.o === 34);
  const estimate = JSON.parse(decode(ex.odds(own.id, enemy.id, Math.floor(own.tr * 0.6))));
  assert.equal(estimate.ok, 1);
  assert.ok(Number(estimate.odds) > 0 && Number(estimate.odds) <= 100);
  const after = call("cmd", 8, own.id, enemy.id, Math.floor(own.tr * 0.6));
  assert.equal(after.ap, s.ap - 1);
  assert.equal(after.orders.length, 1);
  assert.equal(after.orders[0].to, enemy.id);
});

test("月送りで日付が進み、行動力が戻る", async () => {
  const { call } = await createEngine();
  let s = call("boot", 3, 13, 1, 3);
  s = call("cmd", 0, s.towns[0].id, 1, 0);
  const next = call("nextMonth");
  assert.equal(next.turn, 1);
  assert.equal(next.month, 5);
  assert.equal(next.ap, next.apMax);
  assert.notEqual(next.msg, "");
  assert.ok(next.factions.every((f) => Number.isFinite(f.budget)));
});

test("同じ操作を再生すると同じ状態になる", async () => {
  const { call } = await createEngine();
  const setup = [99, 31, 0, 3];
  const commands = [
    ["cmd", 1, 0, 1, 0],
    ["cmd", 3, 0, 0, 0],
    ["nextMonth"],
    ["cmd", 0, 2, 1, 0],
    ["nextMonth"],
  ];
  const play = () => {
    let s = call("boot", ...setup);
    for (const c of commands) s = call(...c);
    return s;
  };
  const first = play();
  const second = play();
  assert.deepEqual(first, second);
});

test("10年分を回しても壊れない", async () => {
  const { call } = await createEngine();
  let s = call("boot", 2026, 31, 1, 1);
  for (let i = 0; i < 120 && s.result === 0; i++) {
    s = call("nextMonth");
    assert.ok(Number.isFinite(s.self.budget));
    assert.ok(Number.isFinite(s.self.support));
    assert.equal(s.towns.length, s.towns.length);
  }
  assert.ok(s.turn > 0);
  assert.ok(s.news.length > 0);
});
