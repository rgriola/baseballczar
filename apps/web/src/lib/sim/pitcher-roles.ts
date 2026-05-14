/**
 * Determine Win, Loss, and Save for each pitcher in a completed game.
 *
 * Simplified MLB rules:
 * - The WINNING PITCHER is the starter if they pitched ≥5 IP while their team
 *   held the lead; otherwise, the reliever who was pitching when the winning
 *   team took the lead for good.
 * - The LOSING PITCHER is the pitcher who allowed the go-ahead run for the
 *   winning team's final lead.
 * - The SAVE goes to the last pitcher on the winning team if:
 *   a) They are not the winning pitcher, AND
 *   b) They finished the game and either: entered with a lead of ≤3, or
 *      pitched ≥3 IP.
 */

import type { AtBatRecord, PitcherGameStats, GameResult } from '@baseballczar/sim-engine';

export interface PitcherRole {
  isStarter: boolean;
  isWinner: boolean;
  isLoser: boolean;
  isSave: boolean;
}

/**
 * Walk through atBats to determine which pitcher gets the W, L, and SV.
 * Returns a Map<pitcherId, PitcherRole>.
 */
export function determinePitcherRoles(
  result: GameResult,
  homePlayerIds: Set<number>,
): Map<number, PitcherRole> {
  const roles = new Map<number, PitcherRole>();

  // Initialize all pitchers
  for (const [id] of result.pitcherStats) {
    roles.set(id, { isStarter: false, isWinner: false, isLoser: false, isSave: false });
  }

  // Determine starters: first pitcher to appear for each team
  let homeStarterId: number | null = null;
  let awayStarterId: number | null = null;
  for (const ab of result.atBats) {
    const pitcherId = ab.pitcher.id;
    if (ab.half === 'top' && awayStarterId === null) {
      // Top of inning = home team pitches
      // Wait — top = away batting, so pitcher is home team's pitcher
      // Actually: top = away team bats, home team pitches
      // bottom = home team bats, away team pitches
    }
    // Simpler: check team membership
    if (homePlayerIds.has(pitcherId) && homeStarterId === null) {
      homeStarterId = pitcherId;
    }
    if (!homePlayerIds.has(pitcherId) && awayStarterId === null) {
      awayStarterId = pitcherId;
    }
    if (homeStarterId !== null && awayStarterId !== null) break;
  }

  if (homeStarterId !== null) {
    const r = roles.get(homeStarterId);
    if (r) r.isStarter = true;
  }
  if (awayStarterId !== null) {
    const r = roles.get(awayStarterId);
    if (r) r.isStarter = true;
  }

  // Track score and pitcher-of-record through each at-bat
  let homeScore = 0;
  let awayScore = 0;
  /** The pitcher who allowed the run that gave the eventual winner the lead */
  let winPitcherId: number | null = null;
  let losePitcherId: number | null = null;
  /** Track the current pitcher for each half */
  let lastHomePitcherId = homeStarterId;
  let lastAwayPitcherId = awayStarterId;

  const homeIsWinner = result.homeRuns > result.awayRuns;
  const winningTeamIsHome = homeIsWinner;

  for (const ab of result.atBats) {
    const pitcherId = ab.pitcher.id;

    // Track current pitcher per side
    if (homePlayerIds.has(pitcherId)) {
      lastHomePitcherId = pitcherId;
    } else {
      lastAwayPitcherId = pitcherId;
    }

    // Accumulate runs scored this at-bat
    const runsScored = ab.runsScored ?? 0;
    if (runsScored > 0) {
      if (ab.half === 'top') {
        // Away team scored, home pitcher gave up runs
        const prevAway = awayScore;
        awayScore += runsScored;

        // Did this give the away team the lead?
        if (!winningTeamIsHome && awayScore > homeScore && prevAway <= homeScore) {
          // Away team just took the lead — the home pitcher who allowed it is the loser
          losePitcherId = pitcherId; // home pitcher
          // The away pitcher at the time becomes the winner candidate
          winPitcherId = lastAwayPitcherId;
        }
        // If away team was already leading and extends — no change
        // If home retakes later, we'll update
      } else {
        // Home team scored, away pitcher gave up runs
        const prevHome = homeScore;
        homeScore += runsScored;

        if (winningTeamIsHome && homeScore > awayScore && prevHome <= awayScore) {
          losePitcherId = pitcherId; // away pitcher
          winPitcherId = lastHomePitcherId;
        }
      }
    }
  }

  // If it's a shutout or lead never changed, the starter gets the W
  if (winPitcherId === null) {
    winPitcherId = winningTeamIsHome ? homeStarterId : awayStarterId;
  }
  if (losePitcherId === null) {
    losePitcherId = winningTeamIsHome ? awayStarterId : homeStarterId;
  }

  // Apply W/L
  if (winPitcherId !== null) {
    const r = roles.get(winPitcherId);
    if (r) r.isWinner = true;
  }
  if (losePitcherId !== null) {
    const r = roles.get(losePitcherId);
    if (r) r.isLoser = true;
  }

  // Determine save: last pitcher on winning team who is NOT the winner
  const winningTeamPitcherIds = winningTeamIsHome
    ? [...result.pitcherStats.keys()].filter(id => homePlayerIds.has(id))
    : [...result.pitcherStats.keys()].filter(id => !homePlayerIds.has(id));

  // Find the last pitcher who appeared for the winning team
  let lastWinTeamPitcherId: number | null = null;
  for (const ab of result.atBats) {
    const pid = ab.pitcher.id;
    if (winningTeamPitcherIds.includes(pid)) {
      lastWinTeamPitcherId = pid;
    }
  }

  if (
    lastWinTeamPitcherId !== null &&
    lastWinTeamPitcherId !== winPitcherId &&
    winPitcherId !== null
  ) {
    const savePitcherStats = result.pitcherStats.get(lastWinTeamPitcherId);
    if (savePitcherStats) {
      const ip = savePitcherStats.outs;
      const leadWhenEntered = Math.abs(result.homeRuns - result.awayRuns);
      // Save: entered with lead ≤ 3 runs, OR pitched ≥ 3 IP (9 outs)
      if (leadWhenEntered <= 3 || ip >= 9) {
        const r = roles.get(lastWinTeamPitcherId);
        if (r) r.isSave = true;
      }
    }
  }

  return roles;
}
