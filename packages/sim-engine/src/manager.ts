/**
 * Manager logic v1 — when to pull the pitcher.
 * Bigger decisions (pinch hit, IBB, bunt) are stubs for now.
 */
import type { Player, Team } from './types';
import { CONFIG } from './config';

export interface ManagerState {
  pitcherId: number;
  pitchCount: number;
  battersFaced: number;
  isStarter: boolean;
  bullpenUsed: Set<number>;
}

export function shouldPullPitcher(
  state: ManagerState,
  team: Team,
  inning: number,
  scoreDiff: number,            // pos = leading
): boolean {
  const cfg = CONFIG.manager;
  const max = state.isStarter ? cfg.starterMaxPitches : cfg.relieverMaxPitches;
  if (state.pitchCount >= max) return true;

  // Late innings, narrow lead, starter past 80 pitches → pull
  if (state.isStarter
      && inning >= 7
      && state.pitchCount >= 80
      && Math.abs(scoreDiff) <= 3) {
    return true;
  }

  // Out of bullpen — keep going
  const available = team.bullpen.filter(p => !state.bullpenUsed.has(p.id));
  if (available.length === 0) return false;

  return false;
}

/** Pick the next reliever — simplest: best available by avg skill. */
export function pickReliever(team: Team, used: Set<number>): Player | null {
  const available = team.bullpen.filter(p => !used.has(p.id));
  if (available.length === 0) return null;
  // Save the highest-skill arm for later innings — pick the lowest-skill first
  available.sort((a, b) => {
    const sa = a.skills.ag + a.skills.avg + a.skills.pitchIntel;
    const sb = b.skills.ag + b.skills.avg + b.skills.pitchIntel;
    return sa - sb;
  });
  return available[0];
}
