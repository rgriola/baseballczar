import type { GameStats, PitcherBoxLine } from './types';

/** Accumulate hitter stats across plate appearances. */
export function createGameStats(): GameStats {
  return { ab: 0, r: 0, b1: 0, b2: 0, b3: 0, hr: 0, rbi: 0, bb: 0, so: 0, hits: 0 };
}

export function addHitterPA(gs: GameStats, pa: {
  ab: number; b1: number; b2: number; b3: number;
  hr: number; rbi: number; bb: number; so: number;
}): void {
  gs.ab += pa.ab;
  gs.b1 += pa.b1;
  gs.b2 += pa.b2;
  gs.b3 += pa.b3;
  gs.hr += pa.hr;
  gs.rbi += pa.rbi;
  gs.bb += pa.bb;
  gs.so += pa.so;
  gs.hits += pa.b1 + pa.b2 + pa.b3 + pa.hr;
}

export function addRun(gs: GameStats): void {
  gs.r++;
}

/** Create a fresh pitcher box line. */
export function createPitcherBoxLine(): PitcherBoxLine {
  return {
    g: 0, gs: 0, w: 0, l: 0, sv: 0, cg: 0, sho: 0,
    ip: 0, om: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0,
  };
}

export function addPitcherPA(box: PitcherBoxLine, pa: {
  ab: number; b1: number; b2: number; b3: number;
  hr: number; bb: number; so: number;
}): void {
  box.h += pa.b1 + pa.b2 + pa.b3 + pa.hr;
  box.hr += pa.hr;
  box.bb += pa.bb;
  box.so += pa.so;
}

export function addPitcherER(box: PitcherBoxLine): void {
  box.er++;
  box.r++;
}

export function addPitcherOut(box: PitcherBoxLine): void {
  box.om++;
  // Baseball notation: 3 outs = 1.0, 4 outs = 1.1, 5 outs = 1.2, 6 = 2.0
  box.ip = Math.floor(box.om / 3) + (box.om % 3) * 0.1;
}

export function addWin(box: PitcherBoxLine): void { box.w++; }
export function addLoss(box: PitcherBoxLine): void { box.l++; }
export function addSave(box: PitcherBoxLine): void { box.sv++; }

export function addCG(box: PitcherBoxLine): void { box.cg++; }
export function addSHO(box: PitcherBoxLine): void { box.sho++; }

/**
 * Team totals for one side.
 * Translated from Totals.java
 */
export interface TeamTotals {
  ab: number;
  r: number;
  b1: number;
  b2: number;
  b3: number;
  hr: number;
  hits: number;
  rbi: number;
  bb: number;
  so: number;
  status: boolean; // true = this team's result is final (won or lost)
}

export function createTeamTotals(): TeamTotals {
  return { ab: 0, r: 0, b1: 0, b2: 0, b3: 0, hr: 0, hits: 0, rbi: 0, bb: 0, so: 0, status: false };
}

export function addTeamHittingStats(tt: TeamTotals, pa: {
  ab: number; b1: number; b2: number; b3: number;
  hr: number; rbi: number; bb: number; so: number;
}): void {
  tt.ab += pa.ab;
  tt.b1 += pa.b1;
  tt.b2 += pa.b2;
  tt.b3 += pa.b3;
  tt.hr += pa.hr;
  tt.hits += pa.b1 + pa.b2 + pa.b3 + pa.hr;
  tt.rbi += pa.rbi;
  tt.bb += pa.bb;
  tt.so += pa.so;
}
