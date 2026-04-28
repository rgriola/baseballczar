import type { SoundEffects } from '../assets/SoundProvider';
import { FIELD } from '../field/drawField';

/** Outcome codes — mirror AtBatOutcome enum in sim-engine */
export const Outcome = {
  Single:    1,
  Double:    2,
  Triple:    3,
  HomeRun:   4,
  Walk:      5,
  GroundOut: 6,
  Strikeout: 7,
} as const;

export type Point = { x: number; y: number };

export type AnimationStep =
  | { type: 'pitch';          from: Point; to: Point }
  | { type: 'contact';        pos: Point }
  | { type: 'ball_flight';    from: Point; to: Point; arc: 'line' | 'fly' | 'grounder' }
  | { type: 'runner_advance'; runnerId: number; from: Point; to: Point }
  | { type: 'out';            pos: Point }
  | { type: 'sound';          effect: keyof SoundEffects }
  | { type: 'pause';          ms: number };

const B = FIELD.BASE;

/** 9 fielder placeholder positions for outs */
const FIELDER_POSITIONS: Point[] = [
  FIELD.MOUND,             // pitcher
  { x: 590, y: 450 },     // 1B
  { x: 460, y: 340 },     // 2B
  { x: 340, y: 340 },     // SS
  { x: 210, y: 450 },     // 3B
  { x: 170, y: 200 },     // LF
  { x: 400, y: 140 },     // CF
  { x: 630, y: 200 },     // RF
  B.home,                  // catcher
];

/** Map each base index (0-3) to a canvas Point */
function basePoint(base: 0 | 1 | 2 | 3): Point {
  return [B.home, B.first, B.second, B.third][base];
}

/**
 * Inning event shape — matches the `game_events` DB row / GameEvent type.
 */
export interface SimEvent {
  seq: number;
  inning: number;
  half: 'top' | 'bottom';
  outs: number;
  outcome: number;
  batter_name: string;
  pitcher_name: string;
  runners_scored: string[] | null;
  visitor_runs: number;
  home_runs: number;
}

/**
 * Convert a flat list of SimEvents into a sequential AnimationStep queue.
 * Runners are tracked with their current base index (0-3).
 */
export function buildAnimationQueue(events: SimEvent[]): AnimationStep[] {
  const steps: AnimationStep[] = [];

  // runner tracking: slot index → base index (1/2/3) or 0 = home/off
  // We use seq as a simple runner id
  const runners = new Map<number, 0 | 1 | 2 | 3>();

  for (const ev of events) {
    const batterBase = 0 as 0; // batter starts at home
    const o = ev.outcome;

    // Always start with a pitch delivery
    steps.push({ type: 'pitch', from: FIELD.MOUND, to: B.home });

    if (o === Outcome.Strikeout) {
      steps.push({ type: 'sound', effect: 'strike' });
      steps.push({ type: 'out', pos: B.home });
      steps.push({ type: 'pause', ms: 600 });
      continue;
    }

    if (o === Outcome.Walk) {
      steps.push({ type: 'sound', effect: 'walk' });
      steps.push({ type: 'runner_advance', runnerId: ev.seq, from: B.home, to: B.first });
      _advanceExisting(steps, runners, 1, 1);
      runners.set(ev.seq, 1);
      steps.push({ type: 'pause', ms: 500 });
      continue;
    }

    if (o === Outcome.GroundOut) {
      steps.push({ type: 'ball_flight', from: B.home, to: FIELDER_POSITIONS[1], arc: 'grounder' });
      steps.push({ type: 'sound', effect: 'crowd_groan' });
      steps.push({ type: 'out', pos: FIELDER_POSITIONS[1] });
      steps.push({ type: 'pause', ms: 600 });
      continue;
    }

    // Hit — contact + ball flight
    steps.push({ type: 'contact', pos: B.home });
    steps.push({ type: 'sound', effect: 'crack' });

    let advanceBases: 1 | 2 | 3 | 4;
    let ballTo: Point;
    let arc: 'line' | 'fly' | 'grounder';

    if (o === Outcome.Single)   { advanceBases = 1; ballTo = { x: 500, y: 310 }; arc = 'line'; }
    else if (o === Outcome.Double) { advanceBases = 2; ballTo = { x: 620, y: 175 }; arc = 'line'; }
    else if (o === Outcome.Triple) { advanceBases = 3; ballTo = { x: 170, y: 155 }; arc = 'fly'; }
    else /* HomeRun */           { advanceBases = 4; ballTo = { x: 400, y: 80 };  arc = 'fly'; }

    steps.push({ type: 'ball_flight', from: B.home, to: ballTo, arc });

    if (o === Outcome.HomeRun) {
      steps.push({ type: 'sound', effect: 'homeRun' });
      // All existing runners score
      for (const [id] of runners) {
        steps.push({ type: 'runner_advance', runnerId: id, from: basePoint(runners.get(id)!), to: B.home });
        runners.delete(id);
      }
      // Batter circles the bases
      steps.push({ type: 'runner_advance', runnerId: ev.seq, from: B.home, to: B.first });
      steps.push({ type: 'runner_advance', runnerId: ev.seq, from: B.first, to: B.second });
      steps.push({ type: 'runner_advance', runnerId: ev.seq, from: B.second, to: B.third });
      steps.push({ type: 'runner_advance', runnerId: ev.seq, from: B.third, to: B.home });
      steps.push({ type: 'sound', effect: 'crowd_cheer' });
    } else {
      // Advance existing runners by advanceBases
      _advanceExisting(steps, runners, advanceBases, advanceBases);
      const finalBase = Math.min(advanceBases, 3) as 1 | 2 | 3;
      steps.push({ type: 'runner_advance', runnerId: ev.seq, from: B.home, to: basePoint(finalBase) });
      runners.set(ev.seq, finalBase);

      if (ev.runners_scored && ev.runners_scored.length > 0) {
        steps.push({ type: 'sound', effect: 'crowd_cheer' });
      }
    }

    steps.push({ type: 'pause', ms: 700 });
  }

  return steps;
}

/** Advance all on-base runners forward by `bases`, scoring any that reach/pass home. */
function _advanceExisting(
  steps: AnimationStep[],
  runners: Map<number, 0 | 1 | 2 | 3>,
  bases: number,
  _advanceBases: number,
): void {
  for (const [id, currentBase] of runners) {
    const newBase = currentBase + bases;
    const from = basePoint(currentBase as 0 | 1 | 2 | 3);
    if (newBase >= 4) {
      // Scores
      steps.push({ type: 'runner_advance', runnerId: id, from, to: FIELD.BASE.home });
      runners.delete(id);
    } else {
      const to = basePoint(newBase as 1 | 2 | 3);
      steps.push({ type: 'runner_advance', runnerId: id, from, to });
      runners.set(id, newBase as 1 | 2 | 3);
    }
  }
}
