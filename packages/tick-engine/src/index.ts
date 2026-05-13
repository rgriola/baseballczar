// Last touched by agent: 2026-05-05T13:12:00Z
/**
 * @baseballczar/tick-engine — Frame-by-frame simulation engine.
 *
 * Provides GameSession (incremental per-AB API) and all tick-based
 * physics for the baseball simulation. Platform-agnostic — no DOM,
 * no Pixi, no React. Can run in Web Workers, Node, or Hermes (iOS).
 *
 * Renderers (Pixi.js, SpriteKit) consume WorldSnapshot[] from this package.
 */

// ── Core types ───────────────────────────────────────────────────
export type {
  WorldSnapshot,
  TickEvent,
  BallEntity,
  FielderEntity,
  RunnerEntity,
  GameState,
  Point2D,
  Point3D,
  BallState,
  FielderState,
  RunnerState,
} from './entities';

// ── Tick engine (per-AB simulation) ──────────────────────────────
export { simulateAtBatTick } from './tickEngine';
export type { TickSimOptions } from './tickEngine';

// ── Tick authority (headless result authority) ──────────────────
export { resolveAtBatHeadless, extractTickOutcome, createResolvePlayBridge } from './tickAuthority';
export type {
  HeadlessAtBatResolution,
  HeadlessAtBatStatDeltas,
  HeadlessRunnerState,
  HeadlessTickResolveOptions,
} from './tickAuthority';

// ── Game orchestrator (full-game batch) ──────────────────────────
export { simulateFullGame } from './gameOrchestrator';
export type {
  FullGameOptions,
  FullGameResult,
  StrategicLogEntry,
} from './gameOrchestrator';

// ── AI Manager (tactical decisions) ─────────────────────────────
export {
  computeDefensiveAlignment,
  evaluateSignal,
  selectPitch,
} from './aiManager';
export type { GameSituation, PitchCall } from './aiManager';

// ── Strategic Manager (pitching changes, pinch plays) ────────────
export {
  createStrategicState,
  evaluatePitchingChange,
  evaluatePinchDecision,
  executePitchingChange,
  executePinchDecision,
  evaluateInningTransition,
} from './strategicManager';
export type { StrategicState } from './strategicManager';

// ── Manager Profiles ─────────────────────────────────────────────
export {
  MANAGER_PROFILES,
  adjustedPitchThreshold,
  shouldShift,
} from './managerProfiles';
export type { ManagerProfile } from './managerProfiles';

// ── PBP Formatter ────────────────────────────────────────────────
export { formatTickEvents } from './formatPbp';
export type { PbpEntry } from './formatPbp';

// ── GameSession (stateful, incremental API) ──────────────────────
export { GameSession } from './GameSession';
export type {
  SessionMode,
  GameSessionConfig,
  ManagerDecisions,
  AtBatResult,
  GameSessionState,
} from './GameSession';
