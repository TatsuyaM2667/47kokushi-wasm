import { newGame, command, endMonth, snapshot, estimate, game, adjacent } from "./game";

export function boot(seed: i32, pref: i32, difficulty: i32, length: i32): string {
  newGame(seed, pref, difficulty, length);
  return snapshot();
}

export function cmd(kind: i32, a: i32, b: i32, c: i32): string {
  return command(kind, a, b, c);
}

export function nextMonth(): string {
  return endMonth();
}

export function state(): string {
  return snapshot();
}

export function odds(from: i32, to: i32, troops: i32): string {
  return estimate(from, to, troops);
}

