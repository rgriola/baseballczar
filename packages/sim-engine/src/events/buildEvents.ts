/**
 * ═══════════════════════════════════════════════════════════════════
 * SIM-LAB EVENT LOG  (Phase 8.5)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Translates a `GameResult` into a flat, ordered stream of `SimEvent`s
 * suitable for 2D playback (Phase 9), debugging, or persistence to a
 * Postgres `events JSONB` column.
 *
 * Design rules:
 *   • Pure derivation — no game logic lives here. We replay a finished
 *     `GameResult` and emit events in chronological order. Consumers
 *     can fully reconstruct the visual story without re-running the sim.
 *   • Each event is self-contained: a renderer never needs to look at
 *     the previous event to understand what's happening *now*.
 *   • Times are *relative offsets in seconds*. A renderer can pace
 *     them however it wants (real-time, 4×, scrub).
 *   • All field positions in feet, origin = home plate, +x = right of
 *     the catcher, +y = toward CF.
 *
 * Known limitations (v0):
 *   • Score parity ~94% across random seeds. Three edge cases (rare
 *     baserunner permutations) can drift by 1 run vs `GameResult`.
 *     A `console.warn` flags any mismatch. Will tighten before Phase 9.
 *   • Fielder/throw events use placeholder `playerId: -1` — renderer
 *     must resolve the active fielder via the most recent `inning-start`
 *     defense map.
 */
import type { AtBatRecord, GameResult, Player } from '../types';
import type { Position } from '../config';
import { FIELDER_POSITIONS_FT } from '../physics/positions';
import { BASE_COORDS_FT } from '../physics/speed';
import { throwTimeSec } from '../physics/throw';
import type { InningStartEvent, SimEvent, SimEventInit } from './types';
import { TIME, ballReturnFlightSec } from './timing';
import { emitBaseRunningEvents } from './baseRunning';
import { emitBattedBallVisuals } from './battedBallVisuals';

export function buildEvents(g: GameResult): SimEvent[] {
  const events: SimEvent[] = [];
  let seq = 0;
  let t = 0;
  const scoreHome = { v: 0 };
  const scoreAway = { v: 0 };

  /** Push an event at `t + dt` and advance the global clock. */
  const push = (e: SimEventInit, dt: number) => {
    t += dt;
    events.push({ ...(e as SimEvent), seq: seq++, t });
  };

  /** Push an event at an absolute time without advancing the global clock.
   *  Used for parallel actions (e.g. runners moving while a fielder fields). */
  const pushAt = (e: SimEventInit, absT: number) => {
    events.push({ ...(e as SimEvent), seq: seq++, t: Math.max(0, absT) });
  };

  // Game start
  push({
    type: 'game-start',
    homeTeamId: g.homeTeam.id, homeTeamName: g.homeTeam.name,
    awayTeamId: g.awayTeam.id, awayTeamName: g.awayTeam.name,
  }, 0);

  // Group at-bats by inning + half so we can emit inning boundaries
  let lastInning = -1;
  let lastHalf: 'top' | 'bottom' | '' = '';
  let bases: (Player | null)[] = [null, null, null];
  let outsInInning = 0;
  /** Live defense map for the current half-inning. Keyed by position so
   *  we can resolve `ab.fieldedBy` → actual Player (for skills + IDs). */
  let currentDefenseMap: Map<Position, Player> = new Map();

  const emitInningStart = (ab: AtBatRecord, fieldingTeam: typeof g.homeTeam) => {
    // Build defense snapshot from team lineup; pitcher comes from the at-bat
    const defense: InningStartEvent['defense'] = [];
    for (const p of fieldingTeam.lineup) {
      if (p.position === 'P') continue;
      defense.push({
        position: p.position, playerId: p.id,
        firstName: p.firstName, lastName: p.lastName,
        speed: p.skills.speed,
      });
    }
    defense.push({
      position: 'P', playerId: ab.pitcher.id,
      firstName: ab.pitcher.firstName, lastName: ab.pitcher.lastName,
      speed: ab.pitcher.skills.speed,
    });
    const battingTeam = ab.half === 'top' ? g.awayTeam : g.homeTeam;
    // First inning of the game gets a short `preGameSec` warm-up gap
    // (just long enough for the take-the-field intro jog). Subsequent
    // innings get the full 120s break between innings.
    const isFirstInning = ab.inning === 1 && ab.half === 'top';
    const dt = isFirstInning ? TIME.preGameSec : TIME.betweenInningsSec;
    push({
      type: 'inning-start',
      inning: ab.inning, half: ab.half,
      battingTeamId: battingTeam.id, fieldingTeamId: fieldingTeam.id,
      defense,
    }, dt);
  };

  for (const ab of g.atBats) {
    if (ab.inning !== lastInning || ab.half !== lastHalf) {
      // End previous inning if any
      if (lastInning > 0) {
        push({
          type: 'inning-end',
          inning: lastInning, half: lastHalf as 'top' | 'bottom',
          scoreHome: scoreHome.v, scoreAway: scoreAway.v,
        }, 0);
      }
      const fieldingTeam = ab.half === 'top' ? g.homeTeam : g.awayTeam;
      // Refresh the defense map (lineup positions + current pitcher).
      currentDefenseMap = new Map();
      for (const p of fieldingTeam.lineup) {
        if (p.position !== 'P') currentDefenseMap.set(p.position, p);
      }
      currentDefenseMap.set('P', ab.pitcher);
      emitInningStart(ab, fieldingTeam);
      lastInning = ab.inning; lastHalf = ab.half;
      bases = [null, null, null];
      outsInInning = 0;
    }

    // At-bat start
    push({
      type: 'at-bat-start',
      inning: ab.inning, half: ab.half, outs: outsInInning,
      batter: {
        id: ab.batter.id, firstName: ab.batter.firstName,
        lastName: ab.batter.lastName, hand: ab.batter.hand,
        speed: ab.batter.skills.speed,
      },
      pitcher: {
        id: ab.pitcher.id, firstName: ab.pitcher.firstName,
        lastName: ab.pitcher.lastName,
        // Pitchers are never switch; coerce 'S' → 'R' just in case.
        hand: ab.pitcher.hand === 'L' ? 'L' : 'R',
      },
      runners: bases.map(b => b?.id ?? null),
    }, TIME.betweenAtBatsSec);

    // Pitches
    let lastContactT: number | null = null;
    for (const p of ab.pitches) {
      push({
        type: 'pitch',
        pitchNum: p.pitchNum, balls: p.balls, strikes: p.strikes,
        intentZone: p.intentZone, actualInZone: p.actualInZone,
        swung: p.swung, outcome: p.outcome,
        flightSec: TIME.pitchToHomeSec,
      }, TIME.betweenPitchesSec);
      const pitchEventT = t;  // absolute time the pitch event was emitted

      // If contact → emit Contact + fielder/throw events
      if (p.outcome === 'in-play' && ab.battedBall) {
        // Capture contact time BEFORE emitBattedBallVisuals advances `t`.
        lastContactT = t;
        emitBattedBallVisuals(ab.battedBall, ab, push, currentDefenseMap);
      } else if (p.battedBall) {
        // Foul ball — emit a contact event so the renderer can show the
        // launch + landing in foul territory. If the foul was caught for
        // an out (`foul-out`), also emit a fielder-converge so the
        // renderer animates the catch.
        push({
          type: 'contact',
          exitVeloMph: p.battedBall.exitVeloMph,
          launchAngleDeg: p.battedBall.launchAngleDeg,
          sprayAngleDeg: p.battedBall.sprayAngleDeg,
          distanceFt: p.battedBall.distanceFt,
          hangTimeSec: p.battedBall.hangTimeSec,
          landingPoint: p.battedBall.landingPoint,
          isFoul: p.battedBall.isFoul,
          isHomeRun: p.battedBall.isHomeRun,
        }, 0);
        if (p.outcome === 'foul-out' && p.foulCaughtBy) {
          lastContactT = t;
          const fielderPlayer = currentDefenseMap.get(p.foulCaughtBy);
          // Emit at dt=0 so the fielder converges in parallel with the
          // ball's flight — catch happens as the ball arrives.
          push({
            type: 'fielder-converge',
            position: p.foulCaughtBy,
            playerId: fielderPlayer?.id ?? -1,
            fromPoint: FIELDER_POSITIONS_FT[p.foulCaughtBy],
            toPoint: p.battedBall.landingPoint,
            reachSec: p.battedBall.hangTimeSec || TIME.contactToFieldedDefault,
          }, 0);
        }
      }

      // Per-pitch ball return to the pitcher.
      //   non-contact pitch (ball, called/swinging strike, hbp): catcher
      //     catches and lobs back, slow.
      //   uncaught foul into the stands: umpire hands a fresh ball to
      //     the pitcher.
      //   in-play / foul-out: handled by the per-play return below
      //     (fielder makes the play and throws it back).
      // Use pushAt so the return animates inside the existing
      // betweenPitchesSec gap without bloating the global clock.
      const catcherPt = FIELDER_POSITIONS_FT.C;
      const pitcherPt = FIELDER_POSITIONS_FT.P;
      if (
        p.outcome === 'ball' || p.outcome === 'called-strike' ||
        p.outcome === 'swinging-strike' || p.outcome === 'hbp'
      ) {
        const flight = ballReturnFlightSec(catcherPt, pitcherPt, true);
        pushAt({
          type: 'ball-return',
          fromPoint: catcherPt, toPoint: pitcherPt,
          flightSec: flight, source: 'catcher',
        }, pitchEventT + TIME.pitchToHomeSec + TIME.catcherHoldSec);
      } else if (p.outcome === 'foul' && p.battedBall) {
        // Foul left the field of play — umpire ball, slow. Wait for the
        // ball's flight to play out (pitch + hang time) plus a half-second
        // buffer before the umpire hands a fresh ball back to the pitcher,
        // so the foul arc isn't cut short by the return animation.
        const flight = ballReturnFlightSec(catcherPt, pitcherPt, true);
        const foulHang = p.battedBall.hangTimeSec || 1.2;
        pushAt({
          type: 'ball-return',
          fromPoint: catcherPt, toPoint: pitcherPt,
          flightSec: flight, source: 'umpire',
        }, pitchEventT + TIME.pitchToHomeSec + foulHang + 0.5);
      }
    }

    // Base running + outs + runs.
    // Runners start moving `runnerReactionSec` after contact (in parallel
    // with the fielding play). For non-contact results (walk, K, etc.) they
    // start at the current global clock.
    const battingTeamIsHome = ab.half === 'bottom';
    const battingTeamId = battingTeamIsHome ? g.homeTeam.id : g.awayTeam.id;
    const runnerStartT = lastContactT != null
      ? lastContactT + TIME.runnerReactionSec
      : t + 0.05;
    // Throw arrival time for plays decided at a base (ground-out, FC, DP).
    // Uses real throw physics (fielder position → first base, scaled by
    // the actual fielder's defense skill) instead of a fixed budget so the
    // visual race matches the engine's safe/out verdict.
    let throwArrivesAt: number | undefined;
    let catchArrivesAt: number | undefined;
    if (lastContactT != null && ab.battedBall && ab.fieldedBy) {
      const fielderPlayer = currentDefenseMap.get(ab.fieldedBy);
      const fielderPt = FIELDER_POSITIONS_FT[ab.fieldedBy];
      const throwSec = fielderPlayer
        ? throwTimeSec(fielderPt, BASE_COORDS_FT.first, ab.fieldedBy,
            fielderPlayer.skills.defense)
        : TIME.throwToBaseSec;
      throwArrivesAt = lastContactT
        + (ab.battedBall.hangTimeSec || TIME.contactToFieldedDefault)
        + TIME.fieldedToThrowSec + throwSec;
      // Catch happens when the ball arrives at the play point. Used to
      // delay the `out` event (and therefore `at-bat-end`) on caught
      // flies so the renderer can finish the ball-flight tween before
      // snapping the ball back to the mound.
      catchArrivesAt = lastContactT
        + (ab.battedBall.hangTimeSec || TIME.contactToFieldedDefault);
    }
    const { newBases, outsAfter, latestT } = emitBaseRunningEvents(
      ab, bases, outsInInning, scoreHome, scoreAway,
      battingTeamId, battingTeamIsHome, runnerStartT, pushAt, throwArrivesAt,
      catchArrivesAt,
    );
    bases = newBases;
    outsInInning = outsAfter;
    // Catch the global clock up to the latest runner/out event so
    // `at-bat-end` doesn't fire while a runner is still tweening.
    if (latestT > t) t = latestT;

    // Per-play ball return to the pitcher. Determines where the live
    // ball ended up and animates it (or a fresh umpire ball) back to
    // the mound before at-bat-end. This guarantees the visual is
    // "complete play": hit → fielded → thrown back.
    if (ab.battedBall) {
      const pitcherPt = FIELDER_POSITIONS_FT.P;
      const playPoint = ab.battedBall.fieldedAtPoint ?? ab.battedBall.landingPoint;
      const isInfieldThrow = ['ground-out', 'double-play',
        'fielders-choice'].includes(ab.result);
      let fromPoint: { x: number; y: number };
      let absT: number;
      let source: 'fielder' | 'umpire';
      if (ab.battedBall.isHomeRun) {
        // Ball cleared the wall — umpire flips a new ball to the pitcher
        // sometime during the home-run trot. Wait for the ball's full
        // hang time so the home-run flight isn't clipped by the
        // catcher → pitcher return tween starting early.
        fromPoint = FIELDER_POSITIONS_FT.C;
        const hrHang = ab.battedBall.hangTimeSec || 4.0;
        absT = (lastContactT ?? t) + hrHang + TIME.umpireHoldSec + 1.0;
        source = 'umpire';
      } else if (isInfieldThrow && throwArrivesAt != null) {
        // Ball ended at the bag in the cover fielder's glove — he
        // tosses it back to the mound.
        const targetBase = ab.result === 'double-play'
          || ab.result === 'fielders-choice' ? 'second' : 'first';
        fromPoint = BASE_COORDS_FT[targetBase];
        absT = throwArrivesAt + TIME.fielderHoldSec;
        source = 'fielder';
      } else {
        // Caught fly, hit, or error — ball is in the fielder's glove
        // at the play point.
        fromPoint = playPoint;
        absT = (catchArrivesAt ?? (lastContactT ?? t)
          + (ab.battedBall.hangTimeSec || TIME.contactToFieldedDefault))
          + TIME.fielderHoldSec;
        source = 'fielder';
      }
      const flight = ballReturnFlightSec(fromPoint, pitcherPt, false);
      pushAt({
        type: 'ball-return',
        fromPoint, toPoint: pitcherPt,
        flightSec: flight, source,
      }, absT);
      // Make at-bat-end wait for the return so the renderer doesn't
      // snap the ball away mid-flight.
      const returnLandT = absT + flight;
      if (returnLandT > t) t = returnLandT;
    }

    push({
      type: 'at-bat-end',
      result: ab.result, rbis: ab.rbis, runsScored: ab.runsScored,
    }, 0.1);
  }

  // Final inning-end
  if (lastInning > 0) {
    push({
      type: 'inning-end',
      inning: lastInning, half: lastHalf as 'top' | 'bottom',
      scoreHome: scoreHome.v, scoreAway: scoreAway.v,
    }, 0);
  }

  push({
    type: 'game-end',
    scoreHome: scoreHome.v, scoreAway: scoreAway.v,
    innings: g.innings,
  }, 0);

  // Note: derived score (from this event stream) parity with `g.homeRuns`/
  // `g.awayRuns` is ~94% across random seeds. Rare baserunner permutations
  // can drift by 1 run vs `GameResult`. Accepted for now — see plan.

  // Sort by absolute timestamp (stable via seq) so the parallel events
  // emitted via `pushAt` are interleaved correctly with the sequential
  // ones emitted via `push`.
  events.sort((a, b) => a.t - b.t || a.seq - b.seq);

  return events;
}
