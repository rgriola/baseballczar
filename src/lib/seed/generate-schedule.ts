/**
 * Schedule generation — translated from Java's AddTeamsToSched.java.
 *
 * Original: 50 rounds of 3 games each (for 6 teams) = 150 game records.
 * Uses the canonical 6-team round-robin with team[5] as the fixed pivot.
 * Home/away alternates each round.
 *
 * Cadence:
 * - Week 1: 5 consecutive days
 * - Weeks 2-11: Wed–Sat (4 games), then 3-day break
 * - Week 12: 5 consecutive days
 *
 * All games at 16:00 local time.
 */

interface ScheduleEntry {
  home_team_index: number;
  visitor_team_index: number;
  round: number;
  game_time: Date;
}

/**
 * Canonical 6-team round-robin pairings.
 * Team at index 5 is the pivot. Others rotate around it.
 * Returns [homeIdx, visitorIdx] pairs for each round.
 */
function roundRobinPairings(): [number, number][][] {
  // 5 rounds cover one full rotation for 6 teams
  const rounds: [number, number][][] = [
    [[5, 0], [4, 1], [2, 3]],
    [[1, 5], [0, 2], [3, 4]],
    [[5, 2], [1, 3], [4, 0]],
    [[3, 5], [2, 4], [0, 1]],
    [[5, 4], [3, 0], [1, 2]],
  ];
  return rounds;
}

/**
 * Generate a 50-round schedule for 6 teams.
 *
 * @param seasonStart - The date of the first game (opening day).
 *   Defaults to next Monday from today.
 * @returns Array of 150 ScheduleEntry objects (50 rounds × 3 games each).
 */
export function generateSchedule(
  seasonStart?: Date,
): ScheduleEntry[] {
  const start = seasonStart ?? getDefaultSeasonStart();
  const baseRounds = roundRobinPairings();
  const entries: ScheduleEntry[] = [];

  let dayOffset = 0;
  let roundNum = 0;

  // The 50-round season repeats the 5-round rotation 10 times,
  // with a cadence of 5 days on, then 2 days break per 5-round block.
  for (let block = 0; block < 10; block++) {
    for (let r = 0; r < 5; r++) {
      roundNum++;
      const gameTime = new Date(start);
      gameTime.setDate(gameTime.getDate() + dayOffset);
      gameTime.setHours(16, 0, 0, 0);

      // Alternate home/away on even blocks to balance home games
      const pairings = baseRounds[r];
      for (const [a, b] of pairings) {
        const [home, visitor] = block % 2 === 0 ? [a, b] : [b, a];
        entries.push({
          home_team_index: home,
          visitor_team_index: visitor,
          round: roundNum,
          game_time: new Date(gameTime),
        });
      }

      dayOffset++;
    }
    // 2-day break between blocks (except after the last)
    if (block < 9) {
      dayOffset += 2;
    }
  }

  return entries;
}

/** Find the next Monday from today as the default season start. */
function getDefaultSeasonStart(): Date {
  const d = new Date();
  const day = d.getDay();
  const daysUntilMonday = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
  d.setDate(d.getDate() + daysUntilMonday);
  d.setHours(16, 0, 0, 0);
  return d;
}
