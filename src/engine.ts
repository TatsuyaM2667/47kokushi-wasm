import type { CallArgs, SaveData, Snapshot } from "./types";

interface WasmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  boot(seed: number, pref: number, difficulty: number, length: number): number;
  cmd(kind: number, a: number, b: number, c: number): number;
  nextMonth(): number;
  state(): number;
  odds(from: number, to: number, troops: number): number;
}

const SAVE_KEY = "47kokushi-wasm-save-v1";
const decoder = new TextDecoder("utf-16le");

export class GameEngine {
  private readonly exports: WasmExports;
  private recording = true;
  private setup: CallArgs = [0, 13, 1, 1];
  private calls: SaveData["calls"] = [];

  private constructor(exports: WasmExports) {
    this.exports = exports;
  }

  static async create(): Promise<GameEngine> {
    const url = new URL("engine.wasm", document.baseURI);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`engine.wasm の読み込みに失敗しました (${response.status})`);
    const bytes = await response.arrayBuffer();
    const imports: WebAssembly.Imports = {
      env: {
        abort(): void {
          throw new Error("Wasmエンジンが異常終了しました");
        },
      },
    };
    const { instance } = await WebAssembly.instantiate(bytes, imports);
    return new GameEngine(instance.exports as unknown as WasmExports);
  }

  private readString(ptr: number): string {
    const view = new DataView(this.exports.memory.buffer);
    const bytes = view.getUint32(ptr - 4, true);
    return decoder.decode(new Uint8Array(this.exports.memory.buffer, ptr, bytes));
  }

  private invoke(name: "boot" | "cmd" | "nextMonth" | "state", args: number[]): Snapshot {
    const ptr = (this.exports[name] as (...values: number[]) => number)(...args);
    return JSON.parse(this.readString(ptr)) as Snapshot;
  }

  boot(seed: number, pref: number, difficulty: number, length: number): Snapshot {
    this.setup = [seed, pref, difficulty, length];
    this.calls = [];
    this.recording = true;
    return this.invoke("boot", this.setup);
  }

  cmd(kind: number, a = 0, b = 0, c = 0): Snapshot {
    const args: CallArgs = [kind, a, b, c];
    if (this.recording) this.calls.push({ name: "cmd", args });
    return this.invoke("cmd", args);
  }

  nextMonth(): Snapshot {
    if (this.recording) this.calls.push({ name: "nextMonth", args: [0, 0, 0, 0] });
    return this.invoke("nextMonth", []);
  }

  odds(from: number, to: number, troops: number) {
    const ptr = this.exports.odds(from, to, troops);
    return JSON.parse(this.readString(ptr)) as {
      ok: number;
      link: number;
      attack: string;
      defense: string;
      odds: string;
      label: string;
      max: number;
    };
  }

  exportSave(): SaveData {
    return {
      version: 1,
      setup: this.setup,
      calls: this.calls,
      savedAt: new Date().toISOString(),
    };
  }

  hasSave(): SaveData | null {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as SaveData;
      return data.version === 1 && Array.isArray(data.calls) ? data : null;
    } catch {
      return null;
    }
  }

  saveLocal(): void {
    localStorage.setItem(SAVE_KEY, JSON.stringify(this.exportSave()));
  }

  replay(data: SaveData): Snapshot {
    this.setup = data.setup;
    this.calls = data.calls.slice();
    this.recording = false;
    let snap = this.invoke("boot", this.setup);
    for (const call of this.calls) {
      snap = call.name === "cmd" ? this.invoke("cmd", call.args) : this.invoke("nextMonth", []);
    }
    this.recording = true;
    return snap;
  }
}
