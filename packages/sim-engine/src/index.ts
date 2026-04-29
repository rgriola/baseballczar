/**
 * Public entry points for sim-lab. Use these from scripts and tests.
 */
export { CONFIG, POSITIONS } from './config';
export type { Position } from './config';
export type {
  Player, Team, Skills, Hand,
  AtBatRecord, AtBatResult, BattedBall, GameResult,
  PitchEvent, PitchOutcome,
  PitcherGameStats, BatterGameStats,
} from './types';
export { createRng, type Rng } from './rng';
export { generateTeam, generateMatchup } from './randomTeam';
export { simulateGame } from './game';
export { simulateAtBat } from './atBat';
export { rollBattedBall, resolveBattedBall, resolveFoulBall } from './battedBall';
export { aggregate, formatReport, type RateReport } from './report';
export { buildEvents, type SimEvent } from './events';
export { flight } from './physics/ballFlight';
export { wallDistanceFt } from './physics/park';
export { throwTimeSec, throwVelocityMph } from './physics/throw';
export { runnerTimeSec, sprintFtPerSec, BASE_COORDS_FT } from './physics/speed';
export { FIELDER_POSITIONS_FT } from './physics/positions';
export { isInfieldFly, INFIELD_FLY } from './rules/infieldFly';
