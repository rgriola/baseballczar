// Legacy sim-engine barrel — retained types are consumed by the persistence layer.
// GameEngine, PlayerSkills, StatsAccumulator, Field, HitZone, AtBat, constants
// have been retired (Phase 1 cleanup).

export { AtBatOutcome } from './types';
export type {
  GameResult, GameEvent, GameStats, PitcherBoxLine,
  ScoreBoardState, PlayerSkills, PitcherAttributes, HitZone,
} from './types';
export { calculateGameRevenue } from './GateReceipts';
export type { GameRevenue } from './GateReceipts';
