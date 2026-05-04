/**
 * Tick-based simulation engine (Phase 2).
 *
 * Takes pre-rolled AtBatRecords from simulateGame() and replays each
 * at-bat with real per-tick physics. Every entity (ball, fielders,
 * runners) moves simultaneously each tick, and interactions (catches,
 * tags, throws) are resolved spatially.
 *
 * Phase 2 additions:
 *   - Runner entities with base-path movement
 *   - AI Manager (Tier 3) for throw targets and runner commands
 *   - Predictive fielder tracking (continuously updated target)
 *   - Cutoff decisions
 *
 * Output: an array of WorldSnapshots that the renderer interpolates
 * between to draw the scene.
 */
import type {
  BallEntity,
  FielderEntity,
  RunnerEntity,
  Point2D,
  WorldSnapshot,
  TickEvent,
} from './entities';
import { launchBall, tickBall, throwBall } from './ballPhysics';
import {
  assignFielderRoles,
  predictLanding,
  tickFielder,
  moveToward,
} from './fielderAI';
import { tickRunner, BASE_POS, commandRunner } from './runnerAI';
import {
  decideThrowTarget,
  commandRunners,
  commandTagUpRunners,
  reassignFielderRoles,
  updatePredictedTracking,
  type GameSituation,
} from './aiManager';
import {
  FIELDER_POSITIONS_FT,
  type Position,
} from '@baseballczar/sim-engine';
import type { AtBatRecord, Player } from '@baseballczar/sim-engine';

const TICK_RATE = 60;
const DT = 1 / TICK_RATE;
const MAX_PLAY_SECS = 8;    // safety cap per at-bat (tighter = fewer ticks)

// ─── Helpers ─────────────────────────────────────────────────────

/** Speed in ft/s from a 1-10 skill rating. */
function speedFromSkill(skill: number): number {
  // 1 = 22 ft/s (slow), 5 = 26 ft/s (avg), 10 = 31 ft/s (elite)
  return 22 + (skill - 1) * 1.0;
}

/** Throw velocity in ft/s from a 1-10 defense skill. */
function throwVeloFromSkill(def: number): number {
  // 1 = 85 ft/s (~58 mph), 5 = 110 ft/s (~75 mph), 10 = 135 ft/s (~92 mph)
  return 85 + (def - 1) * 5.56;
}

// ─── Entity factories ────────────────────────────────────────────

function makeFielder(
  pos: Position,
  player: Player | undefined,
  teamColor: number,
): FielderEntity {
  const home = FIELDER_POSITIONS_FT[pos];
  const speed = player?.skills.speed ?? 5;
  const defense = player?.skills.fielding ?? 5;
  return {
    position: pos,
    pos: { ...home },
    homePos: { ...home },
    state: { type: 'idle' },
    speedFps: speedFromSkill(speed),
    throwVeloFps: throwVeloFromSkill(defense),
    defense,
    playerId: player?.id ?? -1,
    teamColor,
  };
}

function makeRunner(
  player: Player,
  base: 'first' | 'second' | 'third',
  teamColor: number,
): RunnerEntity {
  const pos = BASE_POS[base];
  return {
    id: player.id,
    pos: { ...pos },
    state: { type: 'on-base', base },
    speedFps: speedFromSkill(player.skills.speed),
  };
}

function makeBatterRunner(
  player: Player,
): RunnerEntity {
  return {
    id: player.id,
    pos: { x: 0, y: 0 },  // home plate
    state: { type: 'on-base', base: 'first' },  // will be commanded to advance
    speedFps: speedFromSkill(player.skills.speed),
  };
}

function makeBall(): BallEntity {
  return {
    pos: { x: 0, y: 61, z: 5 },  // pitcher's hand
    state: { type: 'idle' },
  };
}

// ─── Main simulation ─────────────────────────────────────────────

export interface TickSimOptions {
  /** Snapshot capture rate. 1 = every tick (60/s), 2 = every other, etc. */
  captureEvery?: number;
  /** Existing baserunners from previous at-bats. */
  runners?: { player: Player; base: 'first' | 'second' | 'third' }[];
  /** Game situation for AI Manager decisions. */
  situation?: GameSituation;
}

/**
 * Simulate a single at-bat with the tick engine.
 * Returns snapshots for the renderer.
 */
export function simulateAtBatTick(
  ab: AtBatRecord,
  defenseRoster: Map<Position, Player>,
  teamColor: number,
  opts: TickSimOptions = {},
): WorldSnapshot[] {
  const captureEvery = opts.captureEvery ?? 2;  // 30 fps output by default
  const snapshots: WorldSnapshot[] = [];

  // Create entities
  const ball = makeBall();
  const positions: Position[] = ['P', 'C', 'B1', 'B2', 'SS', 'B3', 'LF', 'CF', 'RF'];
  const fielders = positions.map(p => makeFielder(p, defenseRoster.get(p), teamColor));

  const battedBall = ab.battedBall;
  if (!battedBall) return snapshots;

  // Create runner entities from existing baserunners + batter
  const runners: RunnerEntity[] = [];
  if (opts.runners) {
    for (const r of opts.runners) {
      runners.push(makeRunner(r.player, r.base, teamColor));
    }
  }
  // Batter becomes a runner on contact
  const batterRunner = makeBatterRunner(ab.batter);

  const situation: GameSituation = opts.situation ?? {
    outs: ab.outs,
    inning: ab.inning,
    half: ab.half,
    scoreDiff: 0,
  };

  let time = 0;
  let tickCount = 0;
  let phase: 'pitch' | 'flight' | 'fielding' | 'throw' | 'done' = 'pitch';
  let playComplete = false;
  let batterAdded = false;
  let isCaughtFly = false;
  let flyCaughtThisTick = false;

  // ─── Pitch phase: ball travels from mound to plate ──────────
  const PITCH_DUR = 0.45;
  const pitcherPos = FIELDER_POSITIONS_FT.P;
  const platePos: Point2D = { x: 0, y: 0 };
  let pitchT = 0;

  // Track how many throws have been made (end play after reasonable count)
  let throwCount = 0;
  const MAX_THROWS = 3;

  while (!playComplete && time < MAX_PLAY_SECS) {
    const events: TickEvent[] = [];

    switch (phase) {
      case 'pitch': {
        pitchT += DT;
        const u = Math.min(1, pitchT / PITCH_DUR);
        ball.pos.x = pitcherPos.x + (platePos.x - pitcherPos.x) * u;
        ball.pos.y = pitcherPos.y + (platePos.y - pitcherPos.y) * u;
        ball.pos.z = 6 + (3 - 6) * u;

        if (u >= 1) {
          // Contact!
          launchBall(ball, battedBall.exitVeloMph, battedBall.launchAngleDeg, battedBall.sprayAngleDeg);
          const sa = battedBall.sprayAngleDeg;
          const sprayDirection =
            sa < -45 ? 'foul-L' :
            sa < -30 ? 'LF-line' :
            sa < -10 ? 'LF' :
            sa <  10 ? 'CF' :
            sa <  30 ? 'RF' :
            sa <= 45 ? 'RF-line' :
            'foul-R';
          events.push({
            type: 'contact',
            exitVeloMph: battedBall.exitVeloMph,
            launchAngleDeg: battedBall.launchAngleDeg,
            sprayAngleDeg: battedBall.sprayAngleDeg,
            sprayDirection,
            distanceFt: battedBall.distanceFt,
            peakHeightFt: battedBall.peakHeightFt,
            hangTimeSec: battedBall.hangTimeSec,
            isHomeRun: battedBall.isHomeRun,
          });

          // Assign fielder roles based on predicted landing
          const landing = predictLanding(ball);
          if (landing) {
            assignFielderRoles(fielders, ball, landing);
          }

          // Add batter as a runner heading to first
          if (!batterAdded) {
            runners.push(batterRunner);
            commandRunner(batterRunner, { type: 'advance', targetBase: 'first' });
            batterAdded = true;
          }

          // Command existing runners to advance
          commandRunners(runners, ball, situation, false);

          phase = 'flight';
        }
        break;
      }

      case 'flight': {
        // Tick ball physics
        const ballResult = tickBall(ball, DT);

        if (ballResult.landed) {
          events.push({ type: 'ball-landed', at: ballResult.landingPoint! });
        }
        if (ballResult.homeRun) {
          events.push({ type: 'play-complete' });
          phase = 'done';
          playComplete = true;
          break;
        }

        // Tick all fielders concurrently
        for (const f of fielders) {
          // Predictive tracking: continuously update target
          updatePredictedTracking(f, ball);

          const fResult = tickFielder(f, ball, DT);
          if (fResult.event) events.push(fResult.event as TickEvent);
          if (fResult.caught) {
            isCaughtFly = true;
            flyCaughtThisTick = true;

            // AI Manager: decide tag-up runners
            commandTagUpRunners(runners, f, situation);

            // Stop all non-tag-up runners
            for (const r of runners) {
              if (r.state.type === 'running' && r !== batterRunner) {
                // Runners who were going on contact need to retreat
                // (simplified: they hold)
              }
            }

            // Batter is out on a caught fly
            batterRunner.state = { type: 'out' };
            events.push({ type: 'runner-out', runnerId: batterRunner.id, at: 'first' });

            // AI Manager: decide throw target for tag-up plays
            const throwTarget = decideThrowTarget(f, runners, situation);
            f.state = { type: 'has-ball', decideSec: 0.5 };

            phase = 'throw';
          }
        }

        // Tick all runners concurrently
        for (const r of runners) {
          const rResult = tickRunner(r, DT);
          if (rResult.scored) {
            events.push({ type: 'runner-safe', runnerId: r.id, base: 'home' });
          } else if (rResult.arrivedAtBase) {
            const base = r.state.type === 'on-base' ? r.state.base : 'first';
            events.push({ type: 'runner-safe', runnerId: r.id, base });
          }
        }

        // AI Manager: reassign fielder coverage based on ball state
        reassignFielderRoles(fielders, ball, runners, situation);

        // If ball stopped or is held, transition to fielding/throw
        if (ball.state.type === 'held' && !playComplete && !isCaughtFly) {
          phase = 'throw';
        }
        if ((ball.state.type === 'rolling' || ball.state.type === 'idle') && !playComplete) {
          phase = 'fielding';
        }
        break;
      }

      case 'fielding': {
        tickBall(ball, DT);

        // Tick fielders
        for (const f of fielders) {
          const fResult = tickFielder(f, ball, DT);
          if (fResult.event) events.push(fResult.event as TickEvent);
          if (fResult.fielded) {
            // AI Manager: decide throw target
            const throwTarget = decideThrowTarget(f, runners, situation);
            // Override the fielder's default throw with the manager's decision
            f.state = { type: 'has-ball', decideSec: 0.3 };

            // Store the manager's throw decision on the fielder
            (f as any)._managerThrowTarget = throwTarget;

            phase = 'throw';
          }
        }

        // Tick runners
        for (const r of runners) {
          const rResult = tickRunner(r, DT);
          if (rResult.scored) {
            events.push({ type: 'runner-safe', runnerId: r.id, base: 'home' });
          } else if (rResult.arrivedAtBase) {
            const base = r.state.type === 'on-base' ? r.state.base : 'first';
            events.push({ type: 'runner-safe', runnerId: r.id, base });
          }
        }
        break;
      }

      case 'throw': {
        tickBall(ball, DT);

        // Tick fielders — handle throw execution
        for (const f of fielders) {
          // If a fielder has the ball and is deciding, use manager's target
          if (f.state.type === 'has-ball' && f.state.decideSec <= 0) {
            const mgrTarget = (f as any)._managerThrowTarget;
            if (mgrTarget && throwCount < MAX_THROWS) {
              // Execute the throw to the manager's chosen base
              throwBall(ball, f.pos, mgrTarget.point, f.throwVeloFps, f.position);
              throwCount++;
              events.push({ type: 'throw-released', from: f.position, toBase: mgrTarget.base });
              f.state = { type: 'returning' };
              delete (f as any)._managerThrowTarget;
            } else {
              // No target or max throws — end the play
              phase = 'done';
              events.push({ type: 'play-complete' });
              playComplete = true;
            }
          }

          const fResult = tickFielder(f, ball, DT);
          if (fResult.event) events.push(fResult.event as TickEvent);

          // If a fielder received a throw, they need to decide too
          if (fResult.event?.type === 'ball-received') {
            // AI Manager: should this fielder relay or hold?
            const activeRunners = runners.filter(r =>
              r.state.type === 'running' || r.state.type === 'on-base'
            );
            if (activeRunners.length > 0 && throwCount < MAX_THROWS) {
              const newTarget = decideThrowTarget(f, runners, situation);
              (f as any)._managerThrowTarget = newTarget;
            }
            // Otherwise the fielder will hold and the play ends
          }
        }

        // Tick runners
        for (const r of runners) {
          const rResult = tickRunner(r, DT);
          if (rResult.scored) {
            events.push({ type: 'runner-safe', runnerId: r.id, base: 'home' });
          } else if (rResult.arrivedAtBase) {
            const base = r.state.type === 'on-base' ? r.state.base : 'first';
            events.push({ type: 'runner-safe', runnerId: r.id, base });
          }
        }

        // AI Manager: reassign coverage during throws
        reassignFielderRoles(fielders, ball, runners, situation);

        // Safety: if ball is held and no one is deciding/throwing, end play
        if (phase !== 'done' && (ball.state.type === 'idle' || ball.state.type === 'held')) {
          const anyoneDeciding = fielders.some(f =>
            f.state.type === 'has-ball' || f.state.type === 'throwing'
          );
          if (!anyoneDeciding && ball.state.type === 'held') {
            phase = 'done';
            events.push({ type: 'play-complete' });
            playComplete = true;
          }
        }
        break;
      }

      case 'done': {
        // Play is complete — no wind-down, just exit.
        // Fielders will reset to home positions at the start of the next AB.
        playComplete = true;
        break;
      }
    }

    time += DT;
    tickCount++;

    // Capture snapshot
    if (tickCount % captureEvery === 0 || playComplete) {
      const isFirst = snapshots.length === 0;
      snapshots.push({
        time,
        ball: {
          pos: { ...ball.pos },
          state: { ...ball.state } as BallEntity['state'],
        },
        // First snapshot carries full fielder data (static props for sprite creation).
        // Subsequent snapshots carry only dynamic data (pos + state) to save memory.
        fielders: isFirst
          ? fielders.map(f => ({
              ...f,
              pos: { ...f.pos },
              state: { ...f.state } as FielderEntity['state'],
            }))
          : fielders.map(f => ({
              position: f.position,
              pos: { ...f.pos },
              homePos: f.homePos,
              state: { ...f.state } as FielderEntity['state'],
              speedFps: 0,       // placeholder — renderer uses first-snapshot values
              throwVeloFps: 0,
              defense: 0,
              playerId: 0,
              teamColor: 0,
            })),
        runners: runners
          .filter(r => r.state.type !== 'out')
          .map(r => ({
            id: r.id,
            pos: { ...r.pos },
            state: { ...r.state } as RunnerEntity['state'],
            speedFps: 0,
          })),
        events: events.length > 0 ? [...events] : [],
      });
    }
  }

  return snapshots;
}

/**
 * Simulate an entire game with the tick engine.
 * Takes the pre-rolled game result and replays each at-bat.
 */
export function simulateGameTick(
  atBats: AtBatRecord[],
  defenseRoster: Map<Position, Player>,
  teamColor: number,
  opts: TickSimOptions = {},
): WorldSnapshot[] {
  const allSnapshots: WorldSnapshot[] = [];
  let timeOffset = 0;

  for (const ab of atBats) {
    const abSnapshots = simulateAtBatTick(ab, defenseRoster, teamColor, opts);

    // Offset timestamps so they're continuous across the game
    for (const snap of abSnapshots) {
      snap.time += timeOffset;
      allSnapshots.push(snap);
    }

    if (abSnapshots.length > 0) {
      timeOffset = abSnapshots[abSnapshots.length - 1].time + 1;  // 1s gap between ABs
    }
  }

  return allSnapshots;
}
