/**
 * Player generation logic — translated from Java's NumberMaker.java + Add_Player.java.
 *
 * Original algorithm:
 * - 11 skill attributes start in [0, 6] (uniform random)
 * - Max potentials: if start <= 4 → max ∈ [4, 10]; if start > 4 → max ∈ [start, 10]
 * - 20 hitters + 20 pitchers per team = 40 total
 * - Positions assigned from fixed arrays
 * - Names drawn randomly from pools
 */

import {
  FIRST_NAMES,
  LAST_NAMES,
  TEAM_CITIES,
  TEAM_NICKNAMES,
  HITTER_POSITIONS,
  HITTER_BATT_ORDER,
  PITCHER_ROTATION_SLOTS,
} from './data';

// ---------- Random helpers ----------

/** Original: NumberMaker.StartValue() → nextInt(7) → [0, 6] */
function startValue(): number {
  return Math.floor(Math.random() * 7);
}

/**
 * Original: NumberMaker.MaxValue(start)
 *   if start <= 4 → min=4, range=7  → result ∈ [4, 10]
 *   if start > 4  → min=start, range=(11-start) → result ∈ [start, 10]
 */
function maxValue(start: number): number {
  if (start <= 4) {
    return Math.floor(Math.random() * 7) + 4;
  }
  return Math.floor(Math.random() * (11 - start)) + start;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------- Types ----------

export interface GeneratedPlayer {
  first_name: string;
  last_name: string;
  jersey_no: number;
  position: string;
  roster_status: 'active' | 'reserve';
  fielder: boolean;
  batt_order: number;
  rotation_slot: number;
  age: number;
  salary: number;
  contract: number;
  height: number;
  weight: number;
  hand_throw: number;   // 1=R, 2=L
  hand_batting: number;  // 1=R, 2=L, 3=S
  speed: number;
  stamina: number;
  ag: number;
  eye: number;
  avg: number;
  strength: number;
  dhr: number;
  play_intel: number;
  bunting: number;
  fielding: number;
  throw: number;
  karma: number;
  improve_factor: number;
  max_speed: number;
  max_stamina: number;
  range_ag: number;
  max_eye: number;
  max_avg: number;
  max_strength: number;
  range_dhr: number;
  max_play_intel: number;
  max_bunting: number;
  max_fielding: number;
  max_throw: number;
  training_slot: number;
}

// ---------- Attribute generation ----------

function generateSkills() {
  const speed = startValue();
  const stamina = startValue();
  const ag = startValue();
  const eye = startValue();
  const avg = startValue();
  const strength = startValue();
  const dhr = startValue();
  const play_intel = startValue();
  const bunting = startValue();
  const fielding = startValue();
  const throwSkill = startValue();

  return {
    speed, stamina, ag, eye, avg, strength, dhr,
    play_intel, bunting, fielding, throw: throwSkill,
    max_speed: maxValue(speed),
    max_stamina: maxValue(stamina),
    range_ag: maxValue(ag),
    max_eye: maxValue(eye),
    max_avg: maxValue(avg),
    max_strength: maxValue(strength),
    range_dhr: maxValue(dhr),
    max_play_intel: maxValue(play_intel),
    max_bunting: maxValue(bunting),
    max_fielding: maxValue(fielding),
    max_throw: maxValue(throwSkill),
  };
}

function generateDemographics() {
  const age = Math.floor(Math.random() * 6) + 18; // 18-23
  const handThrowRoll = Math.floor(Math.random() * 10);
  const handBatRoll = Math.floor(Math.random() * 40);

  return {
    age,
    salary: 2500,
    contract: 24 - age,
    height: Math.floor(Math.random() * 18) + 65,  // 65-82 inches
    weight: Math.floor(Math.random() * 115) + 165, // 165-279 lbs
    hand_throw: handThrowRoll < 7 ? 1 : 2,         // 70% R, 30% L
    hand_batting: handBatRoll <= 1 ? 3 : handBatRoll <= 18 ? 2 : 1, // ~5% S, ~42.5% L, ~52.5% R
  };
}

// ---------- Public API ----------

/** Generate 20 hitters for a team. */
export function generateHitters(): GeneratedPlayer[] {
  return HITTER_POSITIONS.map((pos, i) => {
    const isNonRoster = i >= 15;
    const isBench = i >= 9 && i < 15;
    return {
      first_name: pick(FIRST_NAMES),
      last_name: pick(LAST_NAMES),
      jersey_no: i + 1,
      position: pos,
      roster_status: isNonRoster ? 'reserve' as const : 'active' as const,
      fielder: true,
      batt_order: HITTER_BATT_ORDER[i],
      rotation_slot: 0,
      ...generateDemographics(),
      ...generateSkills(),
      karma: 9,
      improve_factor: 0,
      training_slot: 0,
    };
  });
}

/** Generate 20 pitchers for a team. */
export function generatePitchers(): GeneratedPlayer[] {
  return PITCHER_ROTATION_SLOTS.map((rot, i) => {
    const isNonRoster = rot === 0;
    return {
      first_name: pick(FIRST_NAMES),
      last_name: pick(LAST_NAMES),
      jersey_no: i + 26,
      position: 'P',
      roster_status: isNonRoster ? 'reserve' as const : 'active' as const,
      fielder: false,
      batt_order: 0,
      rotation_slot: rot,
      ...generateDemographics(),
      ...generateSkills(),
      karma: 9,
      improve_factor: 0,
      training_slot: 0,
    };
  });
}

/** Generate a full 40-player roster: 20 hitters + 20 pitchers. */
export function generateRoster(): GeneratedPlayer[] {
  return [...generateHitters(), ...generatePitchers()];
}

/** Generate a random team name from city + nickname pools. */
export function generateTeamName(): string {
  return `${pick(TEAM_CITIES)} ${pick(TEAM_NICKNAMES)}`;
}
