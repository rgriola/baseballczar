/**
 * AI Manager — thin re-export barrel.
 *
 * The AI logic has been split into focused modules under ai/:
 *   - ai/types.ts           — GameSituation, shared helpers
 *   - ai/throwDecision.ts   — decideThrowTarget, decideCutoff
 *   - ai/runnerCommands.ts  — commandRunners, reevaluateRunners, commandTagUpRunners, evaluateExtraBaseAdvance
 *   - ai/fieldCoverage.ts   — reassignFielderRoles, updatePredictedTracking
 *   - ai/pitchSelection.ts  — selectPitch
 *   - ai/defensiveShifts.ts — getDefensiveAlignment, computeDefensiveAlignment
 *   - ai/prePitchActions.ts — leadDistanceFt, resolveStealAttempt, evaluatePickoff, etc.
 *
 * This file re-exports everything so existing callers don't need
 * to update their import paths.
 */
export {
  // Types & helpers
  type GameSituation,
  closestBaseTo,
  baseIndex,

  // Throw decisions
  decideThrowTarget,
  decideCutoff,
  type CutoffDecision,

  // Runner commands
  commandRunners,
  reevaluateRunners,
  commandTagUpRunners,
  evaluateExtraBaseAdvance,

  // Field coverage
  reassignFielderRoles,
  updatePredictedTracking,

  // Pitch selection
  selectPitch,
  type PitchCall,

  // Defensive shifts
  getDefensiveAlignment,
  computeDefensiveAlignment,
  type BatterHand,
  type DefensiveAlignment,

  // Pre-pitch actions
  leadDistanceFt,
  resolveStealAttempt,
  evaluatePickoff,
  evaluateWildPitchOrPassedBall,
  evaluateSignal,
  shouldIntentionallyWalk,
  type StealAttemptResult,
  type PickoffResult,
  type WildPitchResult,
  type ManagerSignal,
} from './ai';
