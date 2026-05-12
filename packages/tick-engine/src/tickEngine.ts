// Last touched by agent: 2026-05-05T06:39:42Z
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
  type FieldContext,
} from './fielderAI';
import { tickRunner, BASE_POS, commandRunner, nextBase, resolveBaseCollisions } from './runnerAI';
import { COLLIDERS, separateBodyColliders, reflectVelocity, dist2D } from './spatial';
import {
  decideThrowTarget,
  commandRunners,
  commandTagUpRunners,
  evaluateExtraBaseAdvance,
  reevaluateRunners,
  reassignFielderRoles,
  updatePredictedTracking,
  getDefensiveAlignment,
  type GameSituation,
  type BatterHand,
} from './aiManager';
import {
  FIELDER_POSITIONS_FT,
  CONFIG,
  wallDistanceFt,
  sprintFtPerSec,
  throwVelocityMph,
  type Position,
} from '@baseballczar/sim-engine';
import type { AtBatRecord, Player } from '@baseballczar/sim-engine';
import { getRunnerOnBasePoint } from './fieldGeometry';

const TICK_RATE = 60;
const DT = 1 / TICK_RATE;
const MAX_PLAY_SECS = 8;    // safety cap per at-bat
const PLAYER_COLLISION_PASSES = 2;
const BALL_BODY_COLLISION_MAX_Z_FT = 8;
const BALL_BODY_MIN_SPEED_FPS = 2;

// ─── Helpers ─────────────────────────────────────────────────────
// Speed and throw formulas are imported from @baseballczar/sim-engine:
//   sprintFtPerSec(speedSkill) — same body, same speed for fielding + running
//   throwVelocityMph(position, throwingSkill) — position-aware arm strength
//
// MPH → ft/s conversion constant
const MPH_TO_FPS = 5280 / 3600;  // 1.467

/** Turn rate in radians/sec from AG skill (1-10). */
function turnRateFromAg(ag: number): number {
  const clamped = Math.max(1, Math.min(10, ag));
  const degPerSec = 90 + (clamped - 1) * 30;
  return (degPerSec * Math.PI) / 180;
}

function facingToPoint(from: Point2D, to: Point2D): number {
  return Math.atan2(-(to.y - from.y), to.x - from.x);
}

function playerTag(player: Player): string {
  const jersey = player.jerseyNumber > 0 ? player.jerseyNumber : player.id;
  const jerseyStr = String(jersey).padStart(2, '0');
  return `#${jerseyStr} ${player.lastName}`;
}

/**
 * Check if a fielder who just received a throw at a base should
 * record a force-out or tag-out on a runner.
 *
 * Returns the runner entity that is out (or null if no out).
 */
function resolveForceOut(
  receiverPos: Point2D,
  runners: RunnerEntity[],
  ball: BallEntity,
): RunnerEntity | null {
  // Which base did the fielder receive at?
  let receiverBase = 'home';
  let receiverBaseDist = Infinity;
  for (const [name, pos] of Object.entries(BASE_POS)) {
    const d = dist2D(receiverPos, pos);
    if (d < receiverBaseDist) {
      receiverBaseDist = d;
      receiverBase = name;
    }
  }
  // Fielder must be close to a base (within 10ft)
  if (receiverBaseDist > 10) return null;

  // Find a runner who is heading TO this base and hasn't arrived yet
  for (const r of runners) {
    if (r.state.type !== 'running') continue;

    // Where is the runner heading?
    let targetBase = 'first';
    let targetDist = Infinity;
    for (const [name, pos] of Object.entries(BASE_POS)) {
      const d = dist2D(r.state.to, pos);
      if (d < targetDist) {
        targetDist = d;
        targetBase = name;
      }
    }

    if (targetBase !== receiverBase) continue;

    // The runner is heading to this base. Did the fielder beat them?
    const runnerDistToBase = dist2D(r.pos, BASE_POS[receiverBase]);
    if (runnerDistToBase > COLLIDERS.runnerOnBase + 2) {
      // Runner hasn't reached the base yet — OUT
      return r;
    }
  }

  return null;
}

function enforcePlayerBodySeparation(
  fielders: FielderEntity[],
  runners: RunnerEntity[],
): void {
  const activeRunners = runners.filter(
    r => r.state.type !== 'out' && r.state.type !== 'scored',
  );

  // Keep bodies separated within each team first.
  const fielderColliders: Array<{
    pos: Point2D;
    radiusFt: number;
    lockPosition?: boolean;
  }> = fielders.map((f) => ({
    pos: f.pos,
    radiusFt: COLLIDERS.fielderBody,
  }));

  const runnerColliders: Array<{
    pos: Point2D;
    radiusFt: number;
    lockPosition?: boolean;
  }> = activeRunners.map((r) => ({
    pos: r.pos,
    radiusFt: COLLIDERS.runnerBody,
  }));

  separateBodyColliders(fielderColliders, PLAYER_COLLISION_PASSES);
  separateBodyColliders(runnerColliders, PLAYER_COLLISION_PASSES);

  // Runner right-of-way: fielders must clear runner lanes and avoid interference.
  const runnerPriorityColliders: Array<{
    pos: Point2D;
    radiusFt: number;
    lockPosition?: boolean;
  }> = [];

  for (const f of fielders) {
    runnerPriorityColliders.push({ pos: f.pos, radiusFt: COLLIDERS.fielderBody });
  }

  for (const r of activeRunners) {
    runnerPriorityColliders.push({
      pos: r.pos,
      radiusFt: COLLIDERS.runnerBody,
      lockPosition: true,
    });
  }

  separateBodyColliders(runnerPriorityColliders, PLAYER_COLLISION_PASSES);
}

function ballVelocity2D(ball: BallEntity): Point2D | null {
  switch (ball.state.type) {
    case 'in-flight':
    case 'thrown':
      return { x: ball.state.vel.x, y: ball.state.vel.y };
    case 'rolling':
      return { x: ball.state.vel.x, y: ball.state.vel.y };
    default:
      return null;
  }
}

function applyBallBodyDeflection(
  ball: BallEntity,
  fielders: FielderEntity[],
  runners: RunnerEntity[],
): boolean {
  if (ball.state.type === 'idle' || ball.state.type === 'held') return false;
  if (ball.pos.z > BALL_BODY_COLLISION_MAX_Z_FT) return false;

  const velocity2D = ballVelocity2D(ball);
  if (!velocity2D) return false;

  const speed = Math.hypot(velocity2D.x, velocity2D.y);
  if (speed < BALL_BODY_MIN_SPEED_FPS) return false;

  const actors: Array<{ pos: Point2D; radiusFt: number }> = [];
  for (const f of fielders) {
    actors.push({ pos: f.pos, radiusFt: COLLIDERS.fielderBody });
  }
  for (const r of runners) {
    if (r.state.type === 'out' || r.state.type === 'scored') continue;
    actors.push({ pos: r.pos, radiusFt: COLLIDERS.runnerBody });
  }

  let hitActor: { pos: Point2D; radiusFt: number } | null = null;
  let hitDist = Infinity;

  for (const actor of actors) {
    // Ignore actors behind the ball's current movement direction.
    // This prevents immediate false collisions at contact near home plate
    // (e.g., catcher overlap when the ball is launched toward the field).
    const toActorX = actor.pos.x - ball.pos.x;
    const toActorY = actor.pos.y - ball.pos.y;
    const motionDot = velocity2D.x * toActorX + velocity2D.y * toActorY;
    if (motionDot <= 0) continue;

    const dx = ball.pos.x - actor.pos.x;
    const dy = ball.pos.y - actor.pos.y;
    const dist = Math.hypot(dx, dy);
    const minDist = actor.radiusFt + COLLIDERS.ballRadius;
    if (dist > minDist) continue;
    if (dist < hitDist) {
      hitActor = actor;
      hitDist = dist;
    }
  }

  if (!hitActor) return false;

  let nx = ball.pos.x - hitActor.pos.x;
  let ny = ball.pos.y - hitActor.pos.y;
  let nLen = Math.hypot(nx, ny);

  if (nLen < 1e-5) {
    nx = velocity2D.x;
    ny = velocity2D.y;
    nLen = Math.hypot(nx, ny);
    if (nLen < 1e-5) {
      nx = 1;
      ny = 0;
      nLen = 1;
    }
  }

  nx /= nLen;
  ny /= nLen;

  const targetDist = hitActor.radiusFt + COLLIDERS.ballRadius + 0.02;
  ball.pos.x = hitActor.pos.x + nx * targetDist;
  ball.pos.y = hitActor.pos.y + ny * targetDist;

  const restitution = ball.state.type === 'rolling' ? 0.24 :
    ball.state.type === 'thrown' ? 0.28 :
    0.18;
  const reflected = reflectVelocity(velocity2D, { x: nx, y: ny }, restitution);

  if (ball.state.type === 'rolling') {
    ball.state.vel.x = reflected.x;
    ball.state.vel.y = reflected.y;
    return true;
  }

  if (ball.state.type === 'in-flight') {
    ball.state.vel.x = reflected.x;
    ball.state.vel.y = reflected.y;
    ball.state.vel.z *= 0.65;
    if (ball.pos.z < 1.5) {
      ball.pos.z = 0;
      ball.state = {
        type: 'rolling',
        vel: {
          x: reflected.x * 0.8,
          y: reflected.y * 0.8,
        },
      };
    }
    return true;
  }

  if (ball.state.type === 'thrown') {
    if (ball.pos.z <= 3.5) {
      ball.pos.z = 0;
      ball.state = {
        type: 'rolling',
        vel: {
          x: reflected.x * 0.75,
          y: reflected.y * 0.75,
        },
      };
    } else {
      ball.state.vel.x = reflected.x;
      ball.state.vel.y = reflected.y;
      ball.state.vel.z *= 0.55;
    }
    return true;
  }

  return false;
}

function buildPlayerLabelMap(
  ab: AtBatRecord,
  defenseRoster: Map<Position, Player>,
  existingRunners?: { player: Player; base: 'first' | 'second' | 'third' }[],
): Map<number, string> {
  const labels = new Map<number, string>();
  const addPlayer = (player: Player | undefined) => {
    if (!player) return;
    labels.set(player.id, playerTag(player));
  };

  addPlayer(ab.batter);
  addPlayer(ab.pitcher);

  for (const player of defenseRoster.values()) {
    addPlayer(player);
  }

  if (existingRunners) {
    for (const r of existingRunners) {
      addPlayer(r.player);
    }
  }

  return labels;
}

function enrichEventsWithPlayerTags(
  events: TickEvent[],
  fielders: FielderEntity[],
  playerLabels: Map<number, string>,
): TickEvent[] {
  for (const event of events) {
    switch (event.type) {
      case 'ball-caught':
      case 'ball-fielded':
      case 'ball-received': {
        let playerId = event.playerId;
        if (playerId == null) {
          const fielder = fielders.find(f => f.position === event.by);
          if (fielder && fielder.playerId > 0) {
            playerId = fielder.playerId;
            event.playerId = playerId;
          }
        }
        if (!event.playerName && playerId != null && playerId > 0) {
          const fielder = fielders.find(f => f.playerId === playerId);
          const jersey = fielder && fielder.jerseyNumber > 0 ? fielder.jerseyNumber : playerId;
          event.playerName = playerLabels.get(playerId) ?? `#${String(jersey).padStart(2, '0')} ${displayPos(event.by)}`;
        }
        break;
      }

      case 'throw-released': {
        let fromId = event.fromId;
        if (fromId == null) {
          const fielder = fielders.find(f => f.position === event.from);
          if (fielder && fielder.playerId > 0) {
            fromId = fielder.playerId;
            event.fromId = fromId;
          }
        }
        if (!event.fromName && fromId != null && fromId > 0) {
          const fielder = fielders.find(f => f.playerId === fromId);
          const jersey = fielder && fielder.jerseyNumber > 0 ? fielder.jerseyNumber : fromId;
          event.fromName = playerLabels.get(fromId) ?? `#${String(jersey).padStart(2, '0')} ${displayPos(event.from)}`;
        }
        break;
      }

      case 'runner-safe':
      case 'runner-out':
      case 'runner-scored': {
        if (!event.runnerName && event.runnerId > 0) {
          event.runnerName = playerLabels.get(event.runnerId) ?? `#${event.runnerId} Runner`;
        }
        break;
      }

      default:
        break;
    }
  }

  return events;
}

function displayPos(pos: string): string {
  return pos.replace(/^B(\d)/, '$1B');
}

// ─── Entity factories ────────────────────────────────────────────

function makeFielder(
  pos: Position,
  player: Player | undefined,
  teamColor: number,
): FielderEntity {
  const home = FIELDER_POSITIONS_FT[pos];
  const speed = player?.skills.speed ?? 5;
  const ag = player?.skills.ag ?? 5;
  const defense = player?.skills.fielding ?? 5;
  const th = player?.skills.throwing ?? 5;
  return {
    position: pos,
    pos: { ...home },
    homePos: { ...home },
    state: { type: 'idle' },
    speedFps: sprintFtPerSec(speed),
    agility: ag,
    facingRad: facingToPoint(home, BASE_POS.home),
    turnRateRad: turnRateFromAg(ag),
    throwVeloFps: throwVelocityMph(pos, th) * MPH_TO_FPS,
    throwingSkill: th,
    defense,
    playIntelligence: player?.skills.playIntelligence ?? 5,
    playerId: player?.id ?? -1,
    jerseyNumber: player?.jerseyNumber ?? 0,
    teamColor,
  };
}

function makeRunner(
  player: Player,
  base: 'first' | 'second' | 'third',
  teamColor: number,
): RunnerEntity {
  const pos = getRunnerOnBasePoint(base);
  const ag = player.skills.ag ?? 5;
  return {
    id: player.id,
    pos: { ...pos },
    state: { type: 'on-base', base },
    speedFps: sprintFtPerSec(player.skills.speed),
    agility: ag,
    playIntelligence: player.skills.playIntelligence ?? 5,
    facingRad: facingToPoint(pos, BASE_POS.home),
    turnRateRad: turnRateFromAg(ag),
  };
}

function makeBatterRunner(
  player: Player,
): RunnerEntity {
  const ag = player.skills.ag ?? 5;
  const start: Point2D = {
    // Batter starts in the box by handedness.
    x: player.hand === 'L' ? 5 : -5, // do not change. 
    y: 0,
  };
  return {
    id: player.id,
    pos: start,  // batter box
    state: { type: 'on-base', base: 'first' },  // will be commanded to advance
    speedFps: sprintFtPerSec(player.skills.speed),
    agility: ag,
    playIntelligence: player.skills.playIntelligence ?? 5,
    facingRad: facingToPoint(start, FIELDER_POSITIONS_FT.P),
    turnRateRad: turnRateFromAg(ag),
  };
}

function makeBall(): BallEntity {
  return {
    pos: { x: 0, y: 61, z: 5 },  // pitcher's hand
    state: { type: 'idle' },
    bounceCount: 0,
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
  /** Pre-determined error from the sim engine. */
  errorType?: 'fielding' | 'throw';
  /** Position charged with the error (e.g., 'SS', 'B3'). */
  errorBy?: string;
  /** Batter hand for defensive alignment ('L' or 'R'). */
  batterHand?: BatterHand;
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
  const hrWallDistanceFt = wallDistanceFt(battedBall.sprayAngleDeg);
  const hrSprayRad = (battedBall.sprayAngleDeg * Math.PI) / 180;
  const hrWallCrossPoint: Point2D = {
    x: hrWallDistanceFt * Math.sin(hrSprayRad),
    y: hrWallDistanceFt * Math.cos(hrSprayRad),
  };

  // Create runner entities from existing baserunners + batter
  const runners: RunnerEntity[] = [];
  if (opts.runners) {
    for (const r of opts.runners) {
      runners.push(makeRunner(r.player, r.base, teamColor));
    }
  }
  // Batter becomes a runner on contact
  const batterRunner = makeBatterRunner(ab.batter);
  const preContactBatter = makeBatterRunner(ab.batter);
  const playerLabels = buildPlayerLabelMap(ab, defenseRoster, opts.runners);

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

  // ─── Error flags (pre-determined by sim engine) ─────────────
  // These are consumed once: when the error-committing fielder
  // would normally make the play, the error fires instead.
  let pendingFieldingError = opts.errorType === 'fielding';
  let pendingThrowError = opts.errorType === 'throw';
  const errorByPosition = opts.errorBy ?? '';

  // ─── Fielder awareness context ──────────────────────────────
  // Tracks which fielder is the primary ("I got it!") so others yield.
  let primaryPosition = '';

  // ─── Pitch phase: ball travels from mound to plate ──────────
  const PITCH_DUR = 0.45;
  const pitcherPos = FIELDER_POSITIONS_FT.P;
  const platePos: Point2D = { x: 0, y: 0 };
  let pitchT = 0;

  // Track how many throws have been made (end play after reasonable count)
  let throwCount = 0;
  const MAX_THROWS = 3;

  // Accumulate events across ticks so that events firing on non-capture
  // frames aren't silently dropped. Flushed into each captured snapshot.
  let pendingEvents: TickEvent[] = [];

  while (!playComplete && time < MAX_PLAY_SECS) {
    // Events accumulated since the last captured snapshot.
    // Flushed into the snapshot on capture frames (see below).
    const events: TickEvent[] = [...pendingEvents];
    pendingEvents.length = 0;

    switch (phase) {
      case 'pitch': {
        pitchT += DT;
        const u = Math.min(1, pitchT / PITCH_DUR);
        ball.pos.x = pitcherPos.x + (platePos.x - pitcherPos.x) * u;
        ball.pos.y = pitcherPos.y + (platePos.y - pitcherPos.y) * u;
        ball.pos.z = 6 + (3 - 6) * u;

        // Pre-contact alignment: fielders shift to situational positions
        if (pitchT <= PITCH_DUR) {
          const alignment = getDefensiveAlignment(situation, runners, opts.batterHand);
          for (const f of fielders) {
            const shiftedPos = alignment.positions[f.position];
            if (shiftedPos) {
              // Update homePos so fielders return to shifted positions
              f.homePos = { ...shiftedPos };
              // Walk toward shifted position during the pitch
              moveToward(f, shiftedPos, DT, f.speedFps * 0.5);
            }
          }
        }

        if (u >= 1) {
          // Contact!
          const targetDistanceFt = battedBall.isHomeRun
            ? Math.max(battedBall.distanceFt, hrWallDistanceFt + 8)
            : battedBall.distanceFt;

          launchBall(
            ball,
            battedBall.exitVeloMph,
            battedBall.launchAngleDeg,
            battedBall.sprayAngleDeg,
            {
              targetDistanceFt,
              targetHangTimeSec: battedBall.hangTimeSec > 0 ? battedBall.hangTimeSec : undefined,
              targetPeakHeightFt: battedBall.peakHeightFt,
              minPeakHeightFt: battedBall.isHomeRun ? CONFIG.park.wallHeightFt + 1.5 : undefined,
            },
          );
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
            batterId: ab.batter.id,
            batterName: playerLabels.get(ab.batter.id),
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
            primaryPosition = assignFielderRoles(fielders, ball, landing, battedBall.sprayAngleDeg, runners);
          }

          // Add batter as a runner heading to first
          if (!batterAdded) {
            runners.push(batterRunner);
            commandRunner(batterRunner, { type: 'advance', targetBase: 'first' });
            batterAdded = true;
          }

          // Command existing runners to advance
          if (battedBall.isHomeRun) {
            // Home run — all runners go home immediately
            for (const r of runners) {
              if (r.id === batterRunner.id) continue;
              if (r.state.type === 'scored' || r.state.type === 'out') continue;
              commandRunner(r, { type: 'advance', targetBase: 'home' });
            }
          } else {
            // On high fly balls (LA >= 20°), runners hold at their base
            // instead of advancing. They'll advance via tag-up if caught
            // or via reevaluation when the ball drops.
            const isProbableFly = (battedBall.launchAngleDeg ?? 0) >= 20;
            commandRunners(runners, ball, situation, false, isProbableFly);
          }

          phase = 'flight';
        }
        break;
      }

      case 'flight': {
        // Tick ball physics
        const ballResult = tickBall(ball, DT);

        if (ballResult.landed && !battedBall.isHomeRun) {
          events.push({ type: 'ball-landed', at: ballResult.landingPoint! });

          // If runners were holding on a fly ball and the ball dropped,
          // they can now advance — it's a live base hit, not a catch.
          if ((ball.bounceCount ?? 0) === 1) {
            for (const r of runners) {
              if (r.state.type === 'on-base' && r.id !== batterRunner.id) {
                commandRunner(r, { type: 'advance', targetBase: nextBase(r.state.base) });
              }
            }
          }
        }
        if (ballResult.homeRun || (battedBall.isHomeRun && ballResult.landed)) {
          const wallCrossPoint = ballResult.wallHitPoint ?? hrWallCrossPoint;
          const wallCrossHeightFt = ballResult.wallCrossHeightFt ?? ball.pos.z;
          events.push({ type: 'wall-cleared', at: wallCrossPoint, heightFt: wallCrossHeightFt });

          // All runners (including batter) score instantly on a HR —
          // they don't visually trot the bases, they just disappear.
          for (const r of runners) {
            if (r.state.type !== 'scored' && r.state.type !== 'out') {
              r.state = { type: 'scored' };
              events.push({ type: 'runner-scored', runnerId: r.id });
            }
          }

          events.push({ type: 'play-complete' });
          phase = 'done';
          playComplete = true;
          break;
        }

        // Tick all fielders concurrently
        for (const f of fielders) {
          // Predictive tracking: continuously update target
          updatePredictedTracking(f, ball);

          const fResult = tickFielder(f, ball, DT, {
            allFielders: fielders,
            runners,
            situation,
            primaryPosition,
          });
          if (fResult.event) events.push(fResult.event as TickEvent);
          if (fResult.caught) {
            // Check for pre-determined fielding error (dropped fly)
            if (pendingFieldingError && (errorByPosition === '' || f.position === errorByPosition)) {
              pendingFieldingError = false;  // consumed
              // Dropped fly — ball bounces off the glove and rolls away
              const bounceAngle = Math.atan2(f.pos.y, f.pos.x) + 0.3;  // deterministic
              const bounceSpeed = 6 + (10 - (f.defense ?? 5)) * 1.0;
              ball.state = {
                type: 'rolling',
                vel: { x: Math.cos(bounceAngle) * bounceSpeed, y: Math.sin(bounceAngle) * bounceSpeed },
              };
              ball.pos.z = 1;  // near ground after the drop
              events.push({
                type: 'fielding-error',
                by: f.position,
                playerId: f.playerId > 0 ? f.playerId : undefined,
                errorType: 'fielding',
                at: { ...f.pos },
              });
              // Fielder needs to re-chase the dropped ball
              f.state = { type: 'chasing', target: { x: ball.pos.x, y: ball.pos.y } };
              // Don't mark as caught fly — runners don't need to tag up
              phase = 'fielding';
            } else {
              // Clean catch — true fly out (ball never hit the ground)
              isCaughtFly = true;
              flyCaughtThisTick = true;

              // AI Manager: decide tag-up runners
              commandTagUpRunners(runners, f, situation);

              // Stop all non-tag-up runners
              for (const r of runners) {
                if (r.state.type === 'running' && r !== batterRunner) {
                  // Runners who went on contact should retreat to their origin base.
                  let retreatBase = 'first';
                  let retreatDist = Infinity;
                  for (const [baseName, basePos] of Object.entries(BASE_POS)) {
                    if (baseName === 'home') continue;
                    const d = Math.hypot(r.state.from.x - basePos.x, r.state.from.y - basePos.y);
                    if (d < retreatDist) {
                      retreatDist = d;
                      retreatBase = baseName;
                    }
                  }
                  commandRunner(r, { type: 'retreat', targetBase: retreatBase });
                }
              }

              // Batter is out on a caught fly
              batterRunner.state = { type: 'out' };
              events.push({ type: 'runner-out', runnerId: batterRunner.id, at: 'first' });

              // AI Manager: decide throw target for tag-up plays
              const throwTarget = decideThrowTarget(f, runners, situation);
              if (throwTarget.priority > 0) {
                f.state = {
                  type: 'has-ball',
                  decideSec: 0.5,
                  throwTarget: throwTarget.point,
                  throwBase: throwTarget.base,
                };
              } else {
                // No tag-up play — hold the ball
                f.state = { type: 'has-ball', decideSec: 0 };
              }

              phase = 'throw';
            }
          }

          // Ball bounced before being collected — ground-ball play.
          // Fielder must throw to a base; this is NOT a fly out.
          // Runners stay running (force plays are active).
          if (fResult.fielded) {
            if (pendingFieldingError && (errorByPosition === '' || f.position === errorByPosition)) {
              pendingFieldingError = false;
              const bounceAngle = Math.atan2(ball.pos.y - f.pos.y, ball.pos.x - f.pos.x)
                + (f.pos.x > 0 ? 0.5 : -0.5);
              const bounceSpeed = 8 + (10 - (f.defense ?? 5)) * 1.5;
              ball.state = {
                type: 'rolling',
                vel: { x: Math.cos(bounceAngle) * bounceSpeed, y: Math.sin(bounceAngle) * bounceSpeed },
              };
              events.push({
                type: 'fielding-error',
                by: f.position,
                playerId: f.playerId > 0 ? f.playerId : undefined,
                errorType: 'fielding',
                at: { ...f.pos },
              });
              f.state = { type: 'chasing', target: { x: ball.pos.x, y: ball.pos.y } };
              phase = 'fielding';
            } else {
              // Clean fielding — resolve force-out or throw to base
              const fieldedOutRunner = resolveForceOut(f.pos, runners, ball);
              if (fieldedOutRunner) {
                fieldedOutRunner.state = { type: 'out' };
                let outBase = 'first';
                let outBaseDist = Infinity;
                for (const [name, pos] of Object.entries(BASE_POS)) {
                  const d = dist2D(f.pos, pos);
                  if (d < outBaseDist) {
                    outBaseDist = d;
                    outBase = name;
                  }
                }
                events.push({
                  type: 'runner-out',
                  runnerId: fieldedOutRunner.id,
                  at: outBase,
                });
              }

              const throwTarget = decideThrowTarget(f, runners, situation);
              if (throwTarget.priority > 0) {
                f.state = {
                  type: 'has-ball',
                  decideSec: 0.3,
                  throwTarget: throwTarget.point,
                  throwBase: throwTarget.base,
                };
                phase = 'throw';
              } else {
                f.state = { type: 'has-ball', decideSec: 0 };
                phase = 'throw';
              }
            }
          }
        }

        // Tick all runners concurrently
        for (const r of runners) {
          const rResult = tickRunner(r, DT);
          if (rResult.scored) {
            events.push({ type: 'runner-safe', runnerId: r.id, base: 'home' });
          } else if (rResult.arrivedAtBase) {
            const base = r.state.type === 'on-base' ? r.state.base : 'first';

            // Only emit runner-safe if the ball has bounced (ground ball /
            // base hit). While the ball is still in flight, the runner's
            // advance is provisional — a catch would force them to retreat.
            // Emitting runner-safe now creates misleading PBP like
            // "✅ safe at 2B" followed by a caught-fly that invalidates it.
            const ballHasBounced = (ball.bounceCount ?? 0) > 0;
            if (ballHasBounced || isCaughtFly) {
              events.push({ type: 'runner-safe', runnerId: r.id, base });
            }

            if (r.state.type === 'on-base' && !playComplete) {
              if (battedBall.isHomeRun) {
                // HR trot: always advance to the next base
                commandRunner(r, { type: 'advance', targetBase: nextBase(r.state.base) });
              } else if (evaluateExtraBaseAdvance(r, ball, fielders, situation)) {
                commandRunner(r, { type: 'advance', targetBase: nextBase(r.state.base) });
              }
            }
          }
        }

        // Resolve base collisions (two runners on same base)
        resolveBaseCollisions(runners);

        // Per-tick runner re-evaluation: react to ball state
        if (!battedBall.isHomeRun) {
          reevaluateRunners(runners, ball, fielders, situation);
        }

        // Continuous extra-base: re-evaluate runners sitting on base
        if (!playComplete && !battedBall.isHomeRun) {
          for (const r of runners) {
            if (r.state.type === 'on-base' && r.state.base !== 'third') {
              if (evaluateExtraBaseAdvance(r, ball, fielders, situation)) {
                commandRunner(r, { type: 'advance', targetBase: nextBase(r.state.base) });
              }
            }
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
          const fResult = tickFielder(f, ball, DT, {
            allFielders: fielders,
            runners,
            situation,
            primaryPosition,
          });
          if (fResult.event) events.push(fResult.event as TickEvent);
          if (fResult.fielded) {
            // Check for pre-determined fielding error
            if (pendingFieldingError && (errorByPosition === '' || f.position === errorByPosition)) {
              pendingFieldingError = false;  // consumed
              // Muffed ball — bounces away from the fielder
              const bounceAngle = Math.atan2(ball.pos.y - f.pos.y, ball.pos.x - f.pos.x)
                + (f.pos.x > 0 ? 0.5 : -0.5);  // deterministic deflection
              const bounceSpeed = 8 + (10 - (f.defense ?? 5)) * 1.5;  // low FLD = bigger deflection
              ball.state = {
                type: 'rolling',
                vel: { x: Math.cos(bounceAngle) * bounceSpeed, y: Math.sin(bounceAngle) * bounceSpeed },
              };
              events.push({
                type: 'fielding-error',
                by: f.position,
                playerId: f.playerId > 0 ? f.playerId : undefined,
                errorType: 'fielding',
                at: { ...f.pos },
              });
              // Stay in fielding phase — fielder needs to re-chase
              f.state = { type: 'chasing', target: { x: ball.pos.x, y: ball.pos.y } };
            } else {
              // Clean fielding — check for force-out at this base, then decide throw
              const fieldedOutRunner = resolveForceOut(f.pos, runners, ball);
              if (fieldedOutRunner) {
                fieldedOutRunner.state = { type: 'out' };
                let outBase = 'first';
                let outBaseDist = Infinity;
                for (const [name, pos] of Object.entries(BASE_POS)) {
                  const d = dist2D(f.pos, pos);
                  if (d < outBaseDist) {
                    outBaseDist = d;
                    outBase = name;
                  }
                }
                events.push({
                  type: 'runner-out',
                  runnerId: fieldedOutRunner.id,
                  at: outBase,
                });
              }

              const throwTarget = decideThrowTarget(f, runners, situation);
              if (throwTarget.priority > 0) {
                // Throw to the target base
                f.state = {
                  type: 'has-ball',
                  decideSec: 0.3,
                  throwTarget: throwTarget.point,
                  throwBase: throwTarget.base,
                };
                phase = 'throw';
              } else {
                // No play needed (fielder is on the force-out base, or no runners)
                // Hold the ball — play will end via safety check
                f.state = { type: 'has-ball', decideSec: 0 };
                phase = 'throw';  // enter throw phase for out/end detection
              }
            }
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
            // Evaluate extra-base advance during fielding phase
            if (r.state.type === 'on-base' && !playComplete) {
              if (evaluateExtraBaseAdvance(r, ball, fielders, situation)) {
                commandRunner(r, { type: 'advance', targetBase: nextBase(r.state.base) });
              }
            }
          }
        }

        // Resolve base collisions
        resolveBaseCollisions(runners);

        // Per-tick runner re-evaluation
        reevaluateRunners(runners, ball, fielders, situation);

        // Continuous extra-base re-evaluation
        if (!playComplete) {
          for (const r of runners) {
            if (r.state.type === 'on-base' && r.state.base !== 'third') {
              if (evaluateExtraBaseAdvance(r, ball, fielders, situation)) {
                commandRunner(r, { type: 'advance', targetBase: nextBase(r.state.base) });
              }
            }
          }
        }

        // AI Manager: assign situational coverage during fielding
        reassignFielderRoles(fielders, ball, runners, situation);
        break;
      }

      case 'throw': {
        tickBall(ball, DT);

        // Tick fielders — handle throw execution
        for (const f of fielders) {
          // If a fielder has the ball and the decision timer expired,
          // the fielderAI's has-ball→throwing transition handles it.
          // But if there's no throwTarget or max throws, end the play.
          if (f.state.type === 'has-ball' && f.state.decideSec <= 0 && !f.state.throwTarget) {
            if (throwCount < MAX_THROWS) {
              // No pre-set target — ask the AI Manager now
              const mgrTarget = decideThrowTarget(f, runners, situation);
              if (mgrTarget.priority > 0) {
                f.state = {
                  type: 'has-ball',
                  decideSec: 0,
                  throwTarget: mgrTarget.point,
                  throwBase: mgrTarget.base,
                };
              } else {
                // No play to make — end
                phase = 'done';
                events.push({ type: 'play-complete' });
                playComplete = true;
                f.state = { type: 'returning' };
              }
            } else {
              // Max throws reached — end the play
              phase = 'done';
              events.push({ type: 'play-complete' });
              playComplete = true;
              f.state = { type: 'returning' };
            }
          }

          const fResult = tickFielder(f, ball, DT, {
            allFielders: fielders,
            runners,
            situation,
            primaryPosition,
          });
          if (fResult.event) events.push(fResult.event as TickEvent);
          if (fResult.threw) {
            throwCount++;
            // Check for pre-determined throwing error
            if (pendingThrowError && (errorByPosition === '' || f.position === errorByPosition)) {
              pendingThrowError = false;  // consumed
              // Wild throw — apply extreme lateral scatter to the ball
              if (ball.state.type === 'thrown') {
                const vel = ball.state.vel;
                // Add strong perpendicular deflection
                const speed = Math.hypot(vel.x, vel.y);
                if (speed > 1) {
                  const perpX = -vel.y / speed;
                  const perpY = vel.x / speed;
                  // Wild throw sails 15-25 ft off target (deterministic direction)
                  const wildScatter = 15 + (10 - (f.throwingSkill ?? 5)) * 2;
                  const direction = f.pos.x > 0 ? 1 : -1;  // deterministic side
                  vel.x += perpX * wildScatter * direction;
                  vel.y += perpY * wildScatter * direction;
                  vel.z += 3;  // tends to sail high
                }
                events.push({
                  type: 'throwing-error',
                  by: f.position,
                  playerId: f.playerId > 0 ? f.playerId : undefined,
                  at: { ...f.pos },
                  intendedBase: fResult.event?.type === 'throw-released'
                    ? (fResult.event as any).toBase ?? 'unknown'
                    : 'unknown',
                });
              }
            }
          }

          // If a fielder received a throw, check for force-out then relay
          if (fResult.event?.type === 'ball-received') {
            // ── Force-out check: did the throw beat a runner to this base? ──
            const outRunner = resolveForceOut(f.pos, runners, ball);
            if (outRunner) {
              outRunner.state = { type: 'out' };
              // Find which base the out was recorded at
              let outBase = 'first';
              let outBaseDist = Infinity;
              for (const [name, pos] of Object.entries(BASE_POS)) {
                const d = dist2D(f.pos, pos);
                if (d < outBaseDist) {
                  outBaseDist = d;
                  outBase = name;
                }
              }
              events.push({
                type: 'runner-out',
                runnerId: outRunner.id,
                at: outBase,
              });
            }

            // ── Relay check: are there other runners to throw to? ──
            const activeRunners = runners.filter(r =>
              r.state.type === 'running'
            );

            if (activeRunners.length > 0 && throwCount < MAX_THROWS) {
              const newTarget = decideThrowTarget(f, runners, situation);
              if (newTarget.priority > 0) {
                // There IS a play at another base — relay (double play attempt)
                f.state = {
                  type: 'has-ball',
                  decideSec: 0.2,
                  throwTarget: newTarget.point,
                  throwBase: newTarget.base,
                };
              }
              // If priority is 0, the fielder holds — play will end via safety check
            }
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
            // Evaluate extra-base advance during throw phase
            if (r.state.type === 'on-base' && !playComplete) {
              if (evaluateExtraBaseAdvance(r, ball, fielders, situation)) {
                commandRunner(r, { type: 'advance', targetBase: nextBase(r.state.base) });
              }
            }
          }
        }

        // Resolve base collisions
        resolveBaseCollisions(runners);

        // Per-tick runner re-evaluation during throws
        reevaluateRunners(runners, ball, fielders, situation);

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

    enforcePlayerBodySeparation(fielders, runners);
    applyBallBodyDeflection(ball, fielders, runners);

    time += DT;
    tickCount++;

    // Capture snapshot
    if (tickCount % captureEvery === 0 || playComplete) {
      const enrichedEvents = events.length > 0
        ? enrichEventsWithPlayerTags(events, fielders, playerLabels)
        : events;
      const snapshotRunners = runners
        .filter(r => r.state.type !== 'out' && r.state.type !== 'scored')
        .map(r => ({
          id: r.id,
          pos: { ...r.pos },
          state: { ...r.state } as RunnerEntity['state'],
          speedFps: r.speedFps,
          agility: r.agility,
          playIntelligence: r.playIntelligence,
          facingRad: r.facingRad,
          turnRateRad: r.turnRateRad,
        }));

      const hasBatterRunner = snapshotRunners.some(r => r.id === batterRunner.id);
      if (!hasBatterRunner) {
        snapshotRunners.push({
          id: preContactBatter.id,
          pos: { ...preContactBatter.pos },
          state: { ...preContactBatter.state } as RunnerEntity['state'],
          speedFps: preContactBatter.speedFps,
          agility: preContactBatter.agility,
          playIntelligence: preContactBatter.playIntelligence,
          facingRad: preContactBatter.facingRad,
          turnRateRad: preContactBatter.turnRateRad,
        });
      }

      const isFirst = snapshots.length === 0;
      snapshots.push({
        time,
        ball: {
          pos: { ...ball.pos },
          state: { ...ball.state } as BallEntity['state'],
          bounceCount: ball.bounceCount ?? 0,
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
              speedFps: f.speedFps,
              agility: f.agility,
              facingRad: f.facingRad,
              turnRateRad: f.turnRateRad,
              throwVeloFps: f.throwVeloFps,
              throwingSkill: f.throwingSkill,
              defense: f.defense,
              playIntelligence: f.playIntelligence,
              playerId: f.playerId,
              jerseyNumber: f.jerseyNumber,
              teamColor: f.teamColor,
            })),
        runners: snapshotRunners,
        events: enrichedEvents.length > 0 ? [...enrichedEvents] : [],
      });

      // Events were flushed into this snapshot — reset the accumulator.
      pendingEvents.length = 0;
    } else {
      // Not a capture frame — carry events forward to the next snapshot.
      pendingEvents.push(...events);
    }
  }

  // Safety: if the play timed out without a play-complete event, inject one.
  // Also flush any pending events that accumulated on non-capture ticks.
  if (!playComplete && snapshots.length > 0) {
    const lastSnap = snapshots[snapshots.length - 1];
    if (pendingEvents.length > 0) {
      const flushed = enrichEventsWithPlayerTags(pendingEvents, fielders, playerLabels);
      lastSnap.events.push(...flushed);
      pendingEvents.length = 0;
    }
    lastSnap.events.push({ type: 'play-complete' });
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
