/**
 * Schedule generation — translated from Java's AddTeamsToSched.java.
 *
 * Season: 5 weeks × 7 games/week = 35 rounds per team.
 * With 6 teams each round is 3 simultaneous games → 105 total schedule entries.
 * Uses the canonical 6-team round-robin (team[5] as fixed pivot).
 * Home/away flips every 5-round cycle for balance.
 *
 * Cadence: 35 consecutive days (Mon–Sun × 5 weeks), all games at 16:00.
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
 * Generate a 35-round schedule for 6 teams (5 weeks × 7 games/week).
 *
 * @param seasonStart - The date of the first game (opening day).
 *   Defaults to next Monday from today.
 * @returns Array of 105 ScheduleEntry objects (35 rounds × 3 games each).
 */
export function generateSchedule(
  seasonStart?: Date,
): ScheduleEntry[] {
  const start = seasonStart ?? getDefaultSeasonStart();
  const baseRounds = roundRobinPairings();
  const entries: ScheduleEntry[] = [];

  const TOTAL_ROUNDS = 35; // 5 weeks × 7 games/week

  for (let round = 0; round < TOTAL_ROUNDS; round++) {
    const gameTime = new Date(start);
    gameTime.setDate(gameTime.getDate() + round); // one game per day
    gameTime.setHours(16, 0, 0, 0);

    const pairings = baseRounds[round % 5];
    const cycle = Math.floor(round / 5); // flip home/away each 5-round cycle

    for (const [a, b] of pairings) {
      const [home, visitor] = cycle % 2 === 0 ? [a, b] : [b, a];
      entries.push({
        home_team_index: home,
        visitor_team_index: visitor,
        round: round + 1,
        game_time: new Date(gameTime),
      });
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
