/**
 * Random team generator for sandbox testing.
 * Builds two teams of 25 with realistic position distribution and
 * skill curves (most players average, a few stars and scrubs).
 */
import type { Player, Skills, Team, Hand } from './types';
import { CONFIG, POSITIONS, type Position } from './config';
import type { Rng } from './rng';

const FIRST_NAMES = [
  'Alex', 'Brian', 'Carlos', 'Diego', 'Evan', 'Felix', 'Greg', 'Hank',
  'Ivan', 'Jose', 'Kyle', 'Luis', 'Mike', 'Nate', 'Omar', 'Pete',
  'Quinn', 'Ryan', 'Sean', 'Tony', 'Umberto', 'Victor', 'Will', 'Xavier',
  'Yadier', 'Zack',
];
const LAST_NAMES = [
  'Adams', 'Brown', 'Cruz', 'Diaz', 'Edwards', 'Foster', 'Garcia', 'Hill',
  'Iverson', 'Johnson', 'King', 'Lopez', 'Miller', 'Nguyen', 'Owens', 'Perez',
  'Quinn', 'Reyes', 'Smith', 'Torres', 'Underwood', 'Vargas', 'Walker', 'Xu',
  'Young', 'Zimmer',
];

/** Generate one skill value 1..10 with bell-curve bias toward 5. */
function rollSkill(rng: Rng): number {
  const v = Math.round(rng.gaussian(5.5, 1.8));
  return Math.max(1, Math.min(10, v));
}

function rollSkills(rng: Rng, isPitcher: boolean): Skills {
  if (isPitcher) {
    return {
      ag: rollSkill(rng),
      avg: 1,                   // pitchers can't hit in this v1
      power: 1,
      eye: 1,
      dhr: 1,
      speed: rollSkill(rng),
      stamina: rollSkill(rng),
      pitchIntel: rollSkill(rng),
      defense: rollSkill(rng),
    };
  }
  return {
    ag: rollSkill(rng),
    avg: rollSkill(rng),
    power: rollSkill(rng),
    eye: rollSkill(rng),
    dhr: rollSkill(rng),
    speed: rollSkill(rng),
    stamina: 1,
    pitchIntel: 1,
    defense: rollSkill(rng),
  };
}

function rollHand(rng: Rng): Hand {
  const r = rng.next();
  if (r < 0.65) return 'R';
  if (r < 0.95) return 'L';
  return 'S';
}

let nextPlayerId = 1;

function makePlayer(rng: Rng, position: Position): Player {
  const isPitcher = position === 'P';
  return {
    id: nextPlayerId++,
    firstName: rng.pick(FIRST_NAMES),
    lastName: rng.pick(LAST_NAMES),
    hand: rollHand(rng),
    position,
    skills: rollSkills(rng, isPitcher),
  };
}

/**
 * Build a 25-man roster:
 *   - 12 pitchers (5 SP, 7 RP)
 *   - 1 backup C
 *   - 1 each starter at 1B/2B/SS/3B
 *   - 3 OF starters (LF/CF/RF)
 *   - 5 bench: backup IF, backup OF, backup C, 2 utility
 */
export function generateTeam(rng: Rng, id: number, name: string, abbrev: string): Team {
  const roster: Player[] = [];

  // Pitchers
  const rotation: Player[] = [];
  const bullpen: Player[] = [];
  for (let i = 0; i < CONFIG.game.rotationSize; i++) {
    const p = makePlayer(rng, 'P');
    // Starters get a stamina boost
    p.skills.stamina = Math.min(10, p.skills.stamina + 2);
    rotation.push(p);
    roster.push(p);
  }
  for (let i = 0; i < CONFIG.game.bullpenSize; i++) {
    const p = makePlayer(rng, 'P');
    bullpen.push(p);
    roster.push(p);
  }

  // Position starters
  const positionStarters: Position[] = ['C', 'B1', 'B2', 'SS', 'B3', 'LF', 'CF', 'RF'];
  const lineupStarters: Player[] = [];
  for (const pos of positionStarters) {
    const p = makePlayer(rng, pos);
    lineupStarters.push(p);
    roster.push(p);
  }

  // Bench: backup C, backup IF, backup OF, 2 utility
  const benchPositions: Position[] = ['C', 'SS', 'CF', 'B3', 'B2'];
  const bench: Player[] = [];
  for (const pos of benchPositions) {
    const p = makePlayer(rng, pos);
    bench.push(p);
    roster.push(p);
  }

  // Lineup = 8 position starters in optimized order (best OBP/POW first, P last with DH off in v1)
  const sortedHitters = [...lineupStarters].sort((a, b) => {
    const scoreA = a.skills.avg + a.skills.eye + a.skills.power;
    const scoreB = b.skills.avg + b.skills.eye + b.skills.power;
    return scoreB - scoreA;
  });
  const lineup: Player[] = [
    sortedHitters[2],  // 1: contact + speed
    sortedHitters[3],
    sortedHitters[0],  // 3: best hitter
    sortedHitters[1],  // 4: cleanup (power)
    sortedHitters[4],
    sortedHitters[5],
    sortedHitters[6],
    sortedHitters[7],
    rotation[0],       // 9: starter (no DH in v1)
  ];

  return { id, name, abbrev, roster, lineup, rotation, bullpen, bench };
}

/** Convenience: build a matchup of two random teams. */
export function generateMatchup(rng: Rng): { home: Team; away: Team } {
  return {
    away: generateTeam(rng, 1, 'Visitors', 'VIS'),
    home: generateTeam(rng, 2, 'Home', 'HOM'),
  };
}
