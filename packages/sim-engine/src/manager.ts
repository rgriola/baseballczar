/**
 * Manager logic — when to pull the pitcher and who to bring in.
 *
 * Decision factors:
 *   1. Pitch count fatigue — starters pulled at ~95-105, relievers at ~25-30
 *   2. Inning context — late innings (7+) trigger bullpen usage
 *   3. Score leverage — tight games get the closer earlier
 *   4. Performance this outing — getting shelled (3+ runs in an inning)
 *   5. Stamina skill — high-stamina pitchers can go deeper
 *   6. Bullpen availability — can't pull if nobody's left
 *
 * Reliever selection:
 *   - Closer (best arm) used in 9th with ≤3 run lead
 *   - Setup man (2nd best) used in 8th with ≤3 run lead
 *   - Long relievers used in blowouts or early exits
 *   - Lefty specialists against lefty-heavy lineups (future)
 */
import type { Player, Team } from './types';
import { CONFIG } from './config';

export interface ManagerState {
  pitcherId: number;
  pitchCount: number;
  battersFaced: number;
  /** Runs allowed by this pitcher in their current outing. */
  runsAllowed: number;
  /** Hits allowed by this pitcher in their current outing. */
  hitsAllowed: number;
  isStarter: boolean;
  bullpenUsed: Set<number>;
}

/**
 * Effective pitch limit based on the pitcher's stamina skill.
 * Stamina 1 = 75 pitches, Stamina 10 = 110 pitches for starters.
 * Relievers: 20-35 pitches based on stamina.
 */
function effectivePitchLimit(stamina: number, isStarter: boolean): number {
  const t = (Math.max(1, Math.min(10, stamina)) - 1) / 9;
  if (isStarter) {
    return Math.round(75 + t * 35);  // 75–110
  }
  return Math.round(20 + t * 15);    // 20–35
}

/**
 * Should the manager pull the current pitcher?
 *
 * Checks (in order of priority):
 *   1. Hard pitch count limit (stamina-based)
 *   2. Getting shelled: 4+ batters faced, 3+ runs allowed
 *   3. Late-inning leverage: tight game, 7th+ inning, 80+ pitches
 *   4. Soft fatigue: pitcher past 85% of their pitch limit
 */
export function shouldPullPitcher(
  state: ManagerState,
  team: Team,
  inning: number,
  scoreDiff: number,           // pos = this team is leading
): boolean {
  // Can't pull if nobody's available
  const available = team.bullpen.filter(p => !state.bullpenUsed.has(p.id));
  if (available.length === 0) return false;

  // Find the current pitcher's stamina
  const pitcher = team.roster.find(p => p.id === state.pitcherId);
  const stamina = pitcher?.skills.stamina ?? 5;
  const limit = effectivePitchLimit(stamina, state.isStarter);

  // 1. Hard pitch count limit
  if (state.pitchCount >= limit) return true;

  // 2. Getting shelled — 4+ batters faced with 3+ runs = yank immediately
  if (state.battersFaced >= 4 && state.runsAllowed >= 3) return true;

  // 3. Late-inning leverage — tight game (≤3 runs), 7th+, starter past 80 pitches
  if (state.isStarter && inning >= 7 && state.pitchCount >= 80 && Math.abs(scoreDiff) <= 3) {
    return true;
  }

  // 4. Soft fatigue: past 85% of limit and into the 6th+ inning
  if (state.isStarter && inning >= 6 && state.pitchCount >= limit * 0.85) {
    return true;
  }

  // 5. Reliever fatigue: past their limit
  if (!state.isStarter && state.pitchCount >= limit) {
    return true;
  }

  return false;
}

/**
 * Pick the best reliever for the situation.
 *
 * Real bullpen hierarchy (7 RP on roster):
 *   - Closer (CL): best arm, used only with ≤3 innings remaining AND
 *     a lead of 1–3 runs. Typically enters in the 7th–9th.
 *   - Setup (SU): 2nd-best arm, bridges from starter exit to closer.
 *   - Middle relief (MR): 3rd–5th arms, used in 5th–7th when starter
 *     exits early or in moderate-leverage spots.
 *   - Long man / mop-up: 6th–7th arms, used in blowouts or early
 *     starter exits. Lowest-skill arms used first to preserve the pen.
 *
 * Starters (rotation[]) are NEVER used in relief — the bullpen draws
 * exclusively from team.bullpen[].
 */
export function pickReliever(
  team: Team,
  used: Set<number>,
  inning: number = 5,
  scoreDiff: number = 0,
): Player | null {
  const available = team.bullpen.filter(p => !used.has(p.id));
  if (available.length === 0) return null;

  // Rank by composite pitching score: eye × 2 (control) + throwing (arm) + PI (decisions)
  const ranked = available.map(p => ({
    player: p,
    score: (p.skills.eye ?? 5) * 2 + (p.skills.throwing ?? 5) + (p.skills.playIntelligence ?? 5),
  })).sort((a, b) => b.score - a.score);

  const isCloseGame = Math.abs(scoreDiff) <= 3;
  const inningsRemaining = Math.max(0, 9 - inning + 1);

  // ── Closer: ≤3 innings left, team is leading, close game ──
  if (inningsRemaining <= 3 && scoreDiff > 0 && isCloseGame) {
    return ranked[0].player;
  }

  // ── Setup man: 7th–8th, close game (leading or tied) ──
  if (inning >= 7 && isCloseGame) {
    return (ranked[1] ?? ranked[0]).player;
  }

  // ── Middle relief: 5th–6th, moderate leverage ──
  if (inning >= 5 && isCloseGame) {
    return (ranked[2] ?? ranked[1] ?? ranked[0]).player;
  }

  // ── Long man / mop-up: early exit or blowout ──
  // Use the WORST available arm to preserve the good ones
  return ranked[ranked.length - 1].player;
}
