/**
 * AI Manager — barrel re-export.
 *
 * All AI modules are organized under ai/:
 *   - types.ts:           GameSituation, shared helpers
 *   - throwDecision.ts:   decideThrowTarget, decideCutoff
 *   - runnerCommands.ts:  commandRunners, reevaluateRunners, commandTagUpRunners, evaluateExtraBaseAdvance
 *   - fieldCoverage.ts:   reassignFielderRoles, updatePredictedTracking
 *   - pitchSelection.ts:  selectPitch
 *   - defensiveShifts.ts: getDefensiveAlignment, computeDefensiveAlignment
 *   - prePitchActions.ts: leadDistanceFt, resolveStealAttempt, evaluatePickoff, evaluateWildPitchOrPassedBall, evaluateSignal, shouldIntentionallyWalk
 */

// Types & helpers
export type { GameSituation } from './types';
export { closestBaseTo, baseIndex } from './types';

// Throw decisions
export { decideThrowTarget, decideCutoff } from './throwDecision';
export type { CutoffDecision } from './throwDecision';

// Runner commands
export {
  commandRunners,
  reevaluateRunners,
  commandTagUpRunners,
  evaluateExtraBaseAdvance,
} from './runnerCommands';

// Field coverage
export {
  reassignFielderRoles,
  updatePredictedTracking,
} from './fieldCoverage';

// Pitch selection
export { selectPitch } from './pitchSelection';
export type { PitchCall } from './pitchSelection';

// Defensive shifts
export {
  getDefensiveAlignment,
  computeDefensiveAlignment,
} from './defensiveShifts';
export type { BatterHand, DefensiveAlignment } from './defensiveShifts';

// Pre-pitch actions
export {
  leadDistanceFt,
  resolveStealAttempt,
  evaluatePickoff,
  evaluateWildPitchOrPassedBall,
  evaluateSignal,
  shouldIntentionallyWalk,
} from './prePitchActions';
export type {
  StealAttemptResult,
  PickoffResult,
  WildPitchResult,
  ManagerSignal,
} from './prePitchActions';
