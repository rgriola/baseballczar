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

/** Fielder index → home position. Index 0=catcher, 1=1B, 2=2B, 3=SS, 4=3B, 5=LF, 6=CF, 7=RF */
export const FIELDER_HOME: Point[] = [
  { x: FIELD.BASE.home.x, y: FIELD.BASE.home.y + 22 },
  { x: 565, y: 350 }, // 1b
  { x: 510, y: 230 }, // 2b
  { x: 300, y: 230 }, // ss
  { x: 235, y: 350 }, // 3b
  { x: 150, y: 150 }, // lf
  { x: 400, y: 100 }, // cf
  { x: 630, y: 150 }, // rf
];

/**
 * Sentinel fielder id that means "the pitcher". The pitcher isn't part of
 * `FIELDER_HOME` (he has his own sprite anchored at FIELD.MOUND), so the
 * renderer must special-case this id.
 */
export const PITCHER_ID = -1;

export type AnimationStep =
  | { type: 'event_start';    event: SimEvent }
  | { type: 'pitcher_windup' }
  | { type: 'pitch';          from: Point; to: Point }
  | { type: 'batter_swing' }
  | { type: 'contact';        pos: Point }
  | { type: 'ball_flight';    from: Point; to: Point; arc: 'line' | 'fly' | 'grounder' }
  | { type: 'fielder_move';   fielderId: number; to: Point }
  | { type: 'fielder_reset';  fielderId: number }
  | { type: 'runner_advance'; runnerId: number; from: Point; to: Point }
  | {
      type: 'runner_remove';
      runnerId: number;
      /** Optional point to trot the player to (e.g. the batting team's
       *  dugout) before destroying. If omitted the player is removed in
       *  place. */
      walkTo?: Point;
      /** Point the player starts the trot from (defaults to current). */
      from?: Point;
    }
  | { type: 'out';            pos: Point }
  | { type: 'score_update';   visitorRuns: number; homeRuns: number }
  | { type: 'sound';          effect: keyof SoundEffects }
  | {
      /** Half-inning side change: defense leaves to its dugout, new defense takes the field. */
      type: 'side_change';
      /** Which side just finished batting — i.e. which team is now going on defense. */
      newDefense: 'home' | 'visitor';
    }
  | {
      /** Run all sub-steps concurrently; resolves when the slowest finishes. */
      type: 'parallel';
      steps: AnimationStep[];
    }
  | {
      /** Run sub-steps in order. Useful inside a `parallel` group so a
       *  single "thread" (e.g. one runner touching base after base) can
       *  proceed serially while other threads run concurrently. */
      type: 'sequence';
      steps: AnimationStep[];
    }
  | { type: 'pause';          ms: number };

const B = FIELD.BASE;

function basePoint(base: 0 | 1 | 2 | 3): Point {
  return [B.home, B.first, B.second, B.third][base];
}

/**
 * Dugout point for the team currently batting in this half-inning. Out
 * batters/runners trot back here on the way off the field.
 *  - top half    → visitor is batting → visitor dugout (1B side)
 *  - bottom half → home is batting    → home dugout (3B side)
 */
function _battingDugout(half: 'top' | 'bottom'): Point {
  const d = half === 'top' ? FIELD.DUGOUT.visitor : FIELD.DUGOUT.home;
  return { x: d.x, y: d.y };
}

function pickFielder(outcome: number, ballTo: Point, zone?: HitZone): number {
  if (outcome === Outcome.GroundOut) {
    // Weak choppers / comebackers near the mound → pitcher fields it.
    const dxMound = ballTo.x - FIELD.MOUND.x;
    const dyMound = ballTo.y - FIELD.MOUND.y;
    if (Math.hypot(dxMound, dyMound) < 35) return PITCHER_ID;
    if (ballTo.x < 300) return 4;        // 3B
    if (ballTo.x < 400) return 3;        // SS
    if (ballTo.x < 500) return 2;        // 2B
    return 1;                             // 1B
  }
  // For batted balls in the outfield, the recorded hit zone tells us
  // exactly which fielder gets there. Falls back to ballTo geometry
  // for events from before zones were recorded.
  if (zone && zone !== 'INFIELD') return ZONE_FIELDER[zone];
  if (outcome === Outcome.Single) return 6;                 // CF
  if (outcome === Outcome.Double) return ballTo.x > 500 ? 7 : 5;
  if (outcome === Outcome.Triple) return ballTo.x > 400 ? 7 : 5;
  return 6;
}

function pickThrowTarget(outcome: number): Point {
  if (outcome === Outcome.GroundOut) return B.first;
  if (outcome === Outcome.Single)    return B.second;
  if (outcome === Outcome.Double)    return B.second;
  if (outcome === Outcome.Triple)    return B.third;
  return FIELD.MOUND;
}

/**
 * Fielders never throw to an empty bag — a teammate always covers it.
 * Given a throw target and the fielder making the throw, return the
 * fielder id that should break to that base, plus a point slightly inside
 * the bag where they actually receive the throw. Returns null if the bag
 * is the fielder's own home (no separate cover needed) or for the mound
 * (the pitcher is already there).
 */
function pickCover(
  throwTo: Point,
  fielderId: number,
): { coverId: number; receivePt: Point } | null {
  // Which base is the throw aimed at?
  const isHome   = throwTo.x === B.home.x   && throwTo.y === B.home.y;
  const isFirst  = throwTo.x === B.first.x  && throwTo.y === B.first.y;
  const isSecond = throwTo.x === B.second.x && throwTo.y === B.second.y;
  const isThird  = throwTo.x === B.third.x  && throwTo.y === B.third.y;

  if (isHome) {
    return { coverId: 0, receivePt: { x: B.home.x, y: B.home.y - 8 } };
  }
  if (isFirst) {
    if (fielderId === 1) return null; // 1B already there
    return { coverId: 1, receivePt: { x: B.first.x - 12, y: B.first.y + 12 } };
  }
  if (isSecond) {
    // Throws from the right side of the field (RF/1B/2B side) → SS covers.
    // Throws from the left side (LF/CF/3B/SS) → 2B covers.
    const fromRightSide = fielderId === 1 || fielderId === 2 || fielderId === 7;
    const coverId = fromRightSide ? 3 : 2;
    if (coverId === fielderId) return null;
    return { coverId, receivePt: { x: B.second.x, y: B.second.y + 8 } };
  }
  if (isThird) {
    if (fielderId === 4) return null; // 3B already there
    return { coverId: 4, receivePt: { x: B.third.x + 12, y: B.third.y + 12 } };
  }
  // Mound or anywhere else — no separate cover.
  return null;
}

// ── Hit zones ───────────────────────────────────────────────────
//
// Coarse direction the ball was hit, recorded by the sim engine on each
// batted-ball event. Used to drive both the landing point and which
// fielder makes the play, so a triple to right field actually goes to
// the right fielder (not random CF) like in real baseball.

export type HitZone =
  | 'LF_LINE'
  | 'LF'
  | 'LCF'
  | 'CF'
  | 'RCF'
  | 'RF'
  | 'RF_LINE'
  | 'INFIELD';

/**
 * Multiple landing-point candidates per zone keyed by hit type. Coordinates
 * are in 800×600 field space. The 2D playback picks one at random so
 * repeated hits to the same zone don't land on the exact same pixel.
 */
const ZONE_LOCATIONS: Record<
  Exclude<HitZone, 'INFIELD'>,
  { single: Point[]; double: Point[]; triple: Point[]; homerun: Point[] }
> = {
  LF_LINE: {
    single:  [{ x: 200, y: 300 }, { x: 220, y: 290 }],
    double:  [{ x: 120, y: 250 }, { x: 140, y: 230 }],
    triple:  [{ x: 100, y: 220 }, { x: 110, y: 200 }],
    homerun: [{ x: 90,  y: 165 }],
  },
  LF: {
    single:  [{ x: 280, y: 240 }, { x: 250, y: 220 }],
    double:  [{ x: 200, y: 180 }, { x: 220, y: 170 }],
    triple:  [{ x: 170, y: 160 }],
    homerun: [{ x: 200, y: 110 }],
  },
  LCF: {
    single:  [{ x: 330, y: 220 }, { x: 350, y: 235 }],
    double:  [{ x: 280, y: 165 }, { x: 300, y: 155 }],
    triple:  [{ x: 260, y: 130 }],
    homerun: [{ x: 300, y: 90 }],
  },
  CF: {
    single:  [{ x: 400, y: 220 }, { x: 420, y: 230 }],
    double:  [{ x: 400, y: 130 }, { x: 380, y: 140 }],
    triple:  [{ x: 380, y: 80 }],
    homerun: [{ x: 400, y: 60 }],
  },
  RCF: {
    single:  [{ x: 470, y: 220 }, { x: 450, y: 235 }],
    double:  [{ x: 520, y: 165 }, { x: 500, y: 155 }],
    triple:  [{ x: 540, y: 130 }],
    homerun: [{ x: 500, y: 90 }],
  },
  RF: {
    single:  [{ x: 520, y: 240 }, { x: 550, y: 220 }],
    double:  [{ x: 600, y: 180 }, { x: 580, y: 170 }],
    triple:  [{ x: 630, y: 160 }],
    homerun: [{ x: 600, y: 110 }],
  },
  RF_LINE: {
    single:  [{ x: 600, y: 300 }, { x: 620, y: 290 }],
    double:  [{ x: 680, y: 250 }, { x: 660, y: 230 }],
    triple:  [{ x: 700, y: 220 }, { x: 690, y: 200 }],
    homerun: [{ x: 710, y: 165 }],
  },
};

/** Fielder id who plays a ball in each zone. */
const ZONE_FIELDER: Record<HitZone, number> = {
  LF_LINE: 5,  // LF
  LF:      5,
  LCF:     5,  // LF gets the gap toward LCF more often
  CF:      6,  // CF
  RCF:     7,  // RF gets the gap toward RCF more often
  RF:      7,
  RF_LINE: 7,
  INFIELD: 6,  // (unused for hits; GroundOut uses pickFielder by ballTo)
};

function pickRandom<T>(arr: T[], rng: () => number = Math.random): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** Resolve a hit zone + outcome to a landing point. */
function zoneToPoint(zone: HitZone, outcome: number): Point {
  if (zone === 'INFIELD') return { x: 400, y: 380 };
  const pool = ZONE_LOCATIONS[zone];
  if (outcome === Outcome.Single)  return pickRandom(pool.single);
  if (outcome === Outcome.Double)  return pickRandom(pool.double);
  if (outcome === Outcome.Triple)  return pickRandom(pool.triple);
  return pickRandom(pool.homerun);
}

// Fallback zone distributions if the sim event didn't include a hit_zone
// (older replays from before zones were recorded). Mirrors the weights
// used in the sim engine so legacy games still play out reasonably.
const FALLBACK_ZONES: Record<number, HitZone[]> = {
  [Outcome.Single]:  ['LF_LINE','LF','LF','LF','LCF','LCF','LCF','CF','CF','CF','CF','RCF','RCF','RCF','RF','RF','RF','RF_LINE'],
  [Outcome.Double]:  ['LF_LINE','LF_LINE','LF_LINE','LCF','LCF','LCF','LCF','CF','CF','RCF','RCF','RCF','RCF','RF_LINE','RF_LINE','RF_LINE'],
  [Outcome.Triple]:  ['LF_LINE','LF_LINE','LF_LINE','LF_LINE','CF','CF','RF_LINE','RF_LINE','RF_LINE','RF_LINE','RF_LINE','RF_LINE','RF_LINE','RF_LINE','RF_LINE'],
  [Outcome.HomeRun]: ['LF','LF','LCF','CF','CF','CF','RCF','RF','RF'],
};

function resolveHitZone(ev: SimEvent): HitZone {
  if (ev.hit_zone) return ev.hit_zone;
  const pool = FALLBACK_ZONES[ev.outcome] ?? ['CF'];
  return pool[Math.floor(Math.random() * pool.length)];
}

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
  /** 'L' or 'R' — defaults to 'R' if not provided */
  batter_hand?: 'L' | 'R';
  /** Jersey numbers (optional) */
  batter_number?: string | number;
  pitcher_number?: string | number;
  /**
   * Coarse direction the ball was hit. Recorded by the sim engine for
   * Single/Double/Triple/HomeRun. If absent (older replays), a
   * fallback distribution is used.
   */
  hit_zone?: HitZone;
}

export function buildAnimationQueue(events: SimEvent[]): AnimationStep[] {
  const steps: AnimationStep[] = [];
  const runners = new Map<number, 1 | 2 | 3>();
  let lastVisitor = 0;
  let lastHome = 0;
  let lastHalf: 'top' | 'bottom' | null = null;
  let lastInning: number | null = null;

  for (const ev of events) {
    const o = ev.outcome;

    // Half-inning transition → side change animation.
    // Top  half: visitor batting, home defense  → next half: home goes to dugout, visitor takes field
    // Bottom half: home batting,   visitor defense → next half: visitor to dugout, home takes field
    if (lastHalf !== null && (lastHalf !== ev.half || lastInning !== ev.inning)) {
      // newDefense = the team about to take the field (opposite of who is now batting)
      const newDefense: 'home' | 'visitor' = ev.half === 'top' ? 'home' : 'visitor';
      // Clear baserunners between half-innings
      runners.clear();
      steps.push({ type: 'side_change', newDefense });
    }
    lastHalf = ev.half;
    lastInning = ev.inning;

    steps.push({ type: 'event_start', event: ev });
    steps.push({ type: 'pitcher_windup' });

    // Pitch + swing happen together — the batter times the swing to the
    // arriving ball instead of waiting for the pitch to finish first.
    const pitchAndSwing: AnimationStep = {
      type: 'parallel',
      steps: [
        { type: 'pitch', from: FIELD.MOUND, to: B.home },
        { type: 'batter_swing' },
      ],
    };

    if (o === Outcome.Strikeout) {
      // ~65% of real strikeouts are swinging, ~35% looking.
      const swinging = Math.random() < 0.65;
      steps.push(swinging ? pitchAndSwing : { type: 'pitch', from: FIELD.MOUND, to: B.home });
      steps.push({ type: 'sound', effect: 'strike' });
      steps.push({ type: 'out', pos: B.home });
      // Strikeout victim trots back to his own dugout.
      steps.push({
        type: 'runner_remove',
        runnerId: ev.seq,
        from: B.home,
        walkTo: _battingDugout(ev.half),
      });
      steps.push({ type: 'pause', ms: 250 });
      continue;
    }

    if (o === Outcome.Walk) {
      // Ball 4 — no swing.
      steps.push({ type: 'pitch', from: FIELD.MOUND, to: B.home });
      steps.push({ type: 'sound', effect: 'walk' });
      _advanceForceWalk(steps, runners);
      steps.push({ type: 'runner_advance', runnerId: ev.seq, from: B.home, to: B.first });
      runners.set(ev.seq, 1);
      _maybeScoreUpdate(steps, ev, lastVisitor, lastHome);
      lastVisitor = ev.visitor_runs;
      lastHome = ev.home_runs;
      steps.push({ type: 'pause', ms: 250 });
      continue;
    }

    if (o === Outcome.GroundOut) {
      steps.push(pitchAndSwing);
      steps.push({ type: 'sound', effect: 'crack' });
      const ballTo: Point = { x: 350 + Math.random() * 200, y: 380 };
      const fielderId = pickFielder(o, ballTo);

      const FIRST_BASEMAN = 1;
      const coverFirst: Point = {
        x: B.first.x - 12,
        y: B.first.y + 12,
      };

      // Three cases for getting the runner at 1B:
      //  A) 1B fields it close to the bag → he just steps on first himself
      //     (no throw, no separate cover).
      //  B) 1B fields it far from the bag (deep behind 1B, in the hole) →
      //     the pitcher breaks over to cover and takes the toss.
      //  C) Anyone else fields it → 1B covers the bag and takes the throw.
      const distFromFirst = Math.hypot(ballTo.x - B.first.x, ballTo.y - B.first.y);
      const firstBasemanFields = fielderId === FIRST_BASEMAN;
      const firstBasemanStepsOn =
        firstBasemanFields && distFromFirst < 45; // within ~20 ft of the bag
      const pitcherCovers =
        firstBasemanFields && !firstBasemanStepsOn;
      const fielderCovers = !firstBasemanFields; // standard 1B coverage

      // Phase 1: ball rolls to the fielder while the fielder breaks toward
      // it, the cover man breaks to first, AND the batter sprints toward
      // first — all simultaneously.
      const phase1: AnimationStep[] = [
        { type: 'ball_flight', from: B.home, to: ballTo, arc: 'grounder' },
        { type: 'fielder_move', fielderId, to: ballTo },
        { type: 'runner_advance', runnerId: ev.seq, from: B.home, to: B.first },
      ];
      if (fielderCovers) {
        phase1.push({ type: 'fielder_move', fielderId: FIRST_BASEMAN, to: coverFirst });
      } else if (pitcherCovers) {
        phase1.push({ type: 'fielder_move', fielderId: PITCHER_ID, to: coverFirst });
      }
      steps.push({ type: 'parallel', steps: phase1 });

      if (firstBasemanStepsOn) {
        // 1B fielded it right by the bag — quick stride to first, no throw.
        steps.push({ type: 'pause', ms: 200 });
        steps.push({ type: 'fielder_move', fielderId: FIRST_BASEMAN, to: coverFirst });
      } else {
        // Quick transfer (glove→hand) before the throw — a real fielder
        // releases in ~0.4–0.6s after fielding cleanly.
        steps.push({ type: 'pause', ms: 400 });
        // Throw to whoever is covering first.
        steps.push({ type: 'ball_flight', from: ballTo, to: coverFirst, arc: 'line' });
      }

      steps.push({ type: 'sound', effect: 'crowd_groan' });
      steps.push({ type: 'out', pos: B.first });
      steps.push({ type: 'fielder_reset', fielderId });
      if (fielderCovers) {
        steps.push({ type: 'fielder_reset', fielderId: FIRST_BASEMAN });
      } else if (pitcherCovers) {
        steps.push({ type: 'fielder_reset', fielderId: PITCHER_ID });
      }
      // Out batter leaves the field — trots to his own dugout.
      steps.push({
        type: 'runner_remove',
        runnerId: ev.seq,
        from: B.first,
        walkTo: _battingDugout(ev.half),
      });
      steps.push({ type: 'pause', ms: 200 });
      continue;
    }

    // Hit — swing times to the pitch, then ball jumps straight off the bat.
    steps.push(pitchAndSwing);
    steps.push({ type: 'sound', effect: 'crack' });

    let advanceBases: 1 | 2 | 3 | 4;
    let ballTo: Point;
    let arc: 'line' | 'fly' | 'grounder';

    // Resolve the hit zone — sim engine records this on every batted-ball
    // event, so playback puts the ball where the simulation said it went
    // (and routes the right fielder to it). Falls back to a weighted
    // distribution for older replays without recorded zones.
    const zone = resolveHitZone(ev);

    if (o === Outcome.Single)        { advanceBases = 1; ballTo = zoneToPoint(zone, o); arc = 'line'; }
    else if (o === Outcome.Double)   { advanceBases = 2; ballTo = zoneToPoint(zone, o); arc = 'line'; }
    else if (o === Outcome.Triple)   { advanceBases = 3; ballTo = zoneToPoint(zone, o); arc = 'fly';  }
    else /* HomeRun */               { advanceBases = 4; ballTo = zoneToPoint(zone, o); arc = 'fly';  }

    steps.push({ type: 'ball_flight', from: B.home, to: ballTo, arc });

    if (o === Outcome.HomeRun) {
      steps.push({ type: 'sound', effect: 'homeRun' });
      // All existing runners trot through remaining bases to home
      const sorted = [...runners].sort((a, b) => b[1] - a[1]);
      for (const [id, base] of sorted) {
        _runnerSequence(steps, id, base, 4);
      }
      runners.clear();
      // Batter circles all four bases
      _runnerSequence(steps, ev.seq, 0, 4);
      steps.push({ type: 'sound', effect: 'crowd_cheer' });
    } else {
      const fielderId = pickFielder(o, ballTo, zone);
      const throwTo = pickThrowTarget(o);
      const finalBase = Math.min(advanceBases, 3) as 1 | 2 | 3;
      const cover = pickCover(throwTo, fielderId);
      const receivePt = cover ? cover.receivePt : throwTo;

      // Each runner gets their OWN sequence (so they touch each base in
      // order), and all those sequences run in parallel with each other
      // and with the outfielder chasing the ball. Without sequence
      // wrapping, putting `home→1, 1→2, 2→3` directly into a parallel
      // group would start all three legs at once and the runner would
      // appear to teleport between bases.
      const runnerThreads: AnimationStep[] = [];
      _collectRunnerThreads(runnerThreads, runners, advanceBases);
      runnerThreads.push(_runnerThread(ev.seq, 0, finalBase));
      runners.set(ev.seq, finalBase);

      const phase: AnimationStep[] = [
        { type: 'fielder_move', fielderId, to: ballTo },
        ...runnerThreads,
      ];
      if (cover) {
        phase.push({ type: 'fielder_move', fielderId: cover.coverId, to: receivePt });
      }
      steps.push({ type: 'parallel', steps: phase });

      // Quick transfer before the relay throw back in.
      steps.push({ type: 'pause', ms: 400 });
      steps.push({ type: 'ball_flight', from: ballTo, to: receivePt, arc: 'line' });
      steps.push({ type: 'fielder_reset', fielderId });
      if (cover) {
        steps.push({ type: 'fielder_reset', fielderId: cover.coverId });
      }

      if (ev.runners_scored && ev.runners_scored.length > 0) {
        steps.push({ type: 'sound', effect: 'crowd_cheer' });
      }
    }

    _maybeScoreUpdate(steps, ev, lastVisitor, lastHome);
    lastVisitor = ev.visitor_runs;
    lastHome = ev.home_runs;
    steps.push({ type: 'pause', ms: 250 });
  }

  return steps;
}

function _advanceForceWalk(steps: AnimationStep[], runners: Map<number, 1 | 2 | 3>): void {
  const onFirst = [...runners].find(([, b]) => b === 1);
  const onSecond = [...runners].find(([, b]) => b === 2);
  const onThird = [...runners].find(([, b]) => b === 3);

  if (onFirst && onSecond && onThird) {
    steps.push({ type: 'runner_advance', runnerId: onThird[0], from: B.third, to: B.home });
    runners.delete(onThird[0]);
  }
  if (onFirst && onSecond) {
    steps.push({ type: 'runner_advance', runnerId: onSecond[0], from: B.second, to: B.third });
    runners.set(onSecond[0], 3);
  }
  if (onFirst) {
    steps.push({ type: 'runner_advance', runnerId: onFirst[0], from: B.first, to: B.second });
    runners.set(onFirst[0], 2);
  }
}

function _advanceExisting(steps: AnimationStep[], runners: Map<number, 1 | 2 | 3>, bases: number): void {
  // Process from highest base down so we don't overwrite
  const sorted = [...runners].sort((a, b) => b[1] - a[1]);
  for (const [id, currentBase] of sorted) {
    const newBase = currentBase + bases;
    if (newBase >= 4) {
      _runnerSequence(steps, id, currentBase, 4);
      runners.delete(id);
    } else {
      _runnerSequence(steps, id, currentBase, newBase as 1 | 2 | 3);
      runners.set(id, newBase as 1 | 2 | 3);
    }
  }
}

/**
 * Like {@link _advanceExisting}, but emits ONE `sequence` step per runner
 * so the per-runner legs run in order while different runners' threads
 * still fire concurrently inside an enclosing `parallel` group.
 */
function _collectRunnerThreads(
  out: AnimationStep[],
  runners: Map<number, 1 | 2 | 3>,
  bases: number,
): void {
  const sorted = [...runners].sort((a, b) => b[1] - a[1]);
  for (const [id, currentBase] of sorted) {
    const newBase = currentBase + bases;
    if (newBase >= 4) {
      out.push(_runnerThread(id, currentBase, 4));
      runners.delete(id);
    } else {
      out.push(_runnerThread(id, currentBase, newBase as 1 | 2 | 3));
      runners.set(id, newBase as 1 | 2 | 3);
    }
  }
}

/**
 * Build a `sequence` step that walks one runner from `fromBase` to
 * `toBase`, one base at a time. Pair with `parallel` to advance several
 * runners simultaneously while each individual runner still touches
 * every intermediate base in order.
 */
function _runnerThread(
  runnerId: number,
  fromBase: 0 | 1 | 2 | 3,
  toBase: 1 | 2 | 3 | 4,
): AnimationStep {
  const legs: AnimationStep[] = [];
  _runnerSequence(legs, runnerId, fromBase, toBase);
  return { type: 'sequence', steps: legs };
}

/**
 * Walk a runner from `fromBase` to `toBase` one base at a time so they
 * physically touch each intermediate base. toBase=4 means scoring (runs to home).
 */
function _runnerSequence(
  steps: AnimationStep[],
  runnerId: number,
  fromBase: 0 | 1 | 2 | 3,
  toBase: 1 | 2 | 3 | 4,
): void {
  let current = fromBase;
  while (current < toBase) {
    const next = (current + 1) as 1 | 2 | 3 | 4;
    const fromPt = basePoint(current);
    const toPt = next === 4 ? B.home : basePoint(next);
    steps.push({ type: 'runner_advance', runnerId, from: fromPt, to: toPt });
    current = (next === 4 ? 0 : next) as 0 | 1 | 2 | 3;
    if (next === 4) break;
  }
}

function _maybeScoreUpdate(
  steps: AnimationStep[],
  ev: SimEvent,
  lastVisitor: number,
  lastHome: number,
): void {
  if (ev.visitor_runs !== lastVisitor || ev.home_runs !== lastHome) {
    steps.push({ type: 'score_update', visitorRuns: ev.visitor_runs, homeRuns: ev.home_runs });
  }
}
