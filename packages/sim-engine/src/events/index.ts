/**
 * Public barrel for the event subsystem. The package's `index.ts`
 * re-exports `buildEvents` and `SimEvent` from here; the individual
 * event interfaces are also exported for consumers that want to
 * narrow against a specific variant.
 */
export { buildEvents } from './buildEvents';
export type {
  BaseEvent, SimEvent, SimEventInit,
  GameStartEvent, InningStartEvent, AtBatStartEvent,
  PitchEvt, ContactEvent, FielderConvergeEvent, ThrowEvent,
  CoverBaseEvent, FielderDiveEvent, BallReturnEvent,
  RunnerAdvanceEvent, OutEvent, RunScoredEvent,
  AtBatEndEvent, InningEndEvent, GameEndEvent,
} from './types';
