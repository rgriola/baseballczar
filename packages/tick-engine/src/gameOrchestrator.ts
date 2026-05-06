// Last touched by agent: 2026-05-05T08:18:00Z
/**
 * Full-game orchestrator for the tick engine.
 *
 * Chains all at-bats, inning transitions, strategic decisions,
 * tactical decisions, and pitching changes into a single continuous
 * simulation. Each team has its own AI Manager with an independent
 * ManagerProfile that tunes every decision.
 *
 * This is the top-level entry point for a complete game in sim-lab-2.
 *
 * Flow per at-bat:
 *   1. Strategic Manager: evaluate pitching changes, pinch plays
 *   2. Tactical Manager: defensive alignment, pitch call
 *   3. Tick Engine: simulate the at-bat with physics
 *   4. Post-AB: update bases, outs, score, pitch count
 *   5. If 3 outs: inning transition, swap sides
 */
import type { AtBatRecord, Player, Team, GameResult, Position } from '@baseballczar/sim-engine';
import { throwVelocityMph } from '@baseballczar/sim-engine';
import type { WorldSnapshot, FielderEntity, RunnerEntity } from './entities';
import { simulateAtBatTick, type TickSimOptions } from './tickEngine';
import { BASE_POS } from './runnerAI';
import {
  computeDefensiveAlignment,
  type GameSituation,
} from './aiManager';
import {
  createStrategicState,
  evaluateInningTransition,
} from './strategicManager';
import {
  type ManagerProfile,
  MANAGER_PROFILES,
  shouldShift,
} from './managerProfiles';
import { FIELDER_POSITIONS_FT } from '@baseballczar/sim-engine';
import { normalizeStarterIndex, syncPitcherFromAtBat } from './pitchingPlayback';
import { getRunnerOnBasePoint } from './fieldGeometry';

// ─── Full-game simulation ────────────────────────────────────────

export interface FullGameOptions extends TickSimOptions {
  /** Manager profile for the home team. Default: balanced. */
  homeProfile?: ManagerProfile;
  /** Manager profile for the away team. Default: balanced. */
  awayProfile?: ManagerProfile;
  /** Rotation slot to use as the home starter for this game. */
  homeStarterIndex?: number;
  /** Rotation slot to use as the away starter for this game. */
  awayStarterIndex?: number;
  /** Max at-bats to simulate (for debugging). 0 = full game. */
  maxAtBats?: number;
}

export interface FullGameResult {
  /** All snapshots for playback. */
  snapshots: WorldSnapshot[];
  /** Strategic decisions made during the game. */
  strategicLog: StrategicLogEntry[];
  /** Game summary stats. */
  totalAtBats: number;
  totalSnapshots: number;
  totalDurationSec: number;
}

export interface StrategicLogEntry {
  inning: number;
  half: 'top' | 'bottom';
  abIndex: number;
  type: 'pitching-change' | 'pinch-hit' | 'pinch-run' | 'defensive-shift' | 'manager-signal';
  detail: string;
  team: 'home' | 'away';
}

/**
 * Simulate a full game with the tick engine.
 *
 * Takes a pre-rolled GameResult (from the existing sim-engine) and
 * replays every at-bat through the tick engine with physics,
 * spatial collision, and AI Manager decisions.
 */
export function simulateFullGame(
  gameResult: GameResult,
  homeTeam: Team,
  awayTeam: Team,
  opts: FullGameOptions = {},
): FullGameResult {
  const homeProfile = opts.homeProfile ?? MANAGER_PROFILES.balanced;
  const awayProfile = opts.awayProfile ?? MANAGER_PROFILES.balanced;
  const homeStarterIndex = normalizeStarterIndex(opts.homeStarterIndex ?? 0, homeTeam.rotation.length);
  const awayStarterIndex = normalizeStarterIndex(opts.awayStarterIndex ?? 0, awayTeam.rotation.length);
  const homeStartingPitcher = homeTeam.rotation[homeStarterIndex] ?? homeTeam.rotation[0];
  const awayStartingPitcher = awayTeam.rotation[awayStarterIndex] ?? awayTeam.rotation[0];
  const maxABs = opts.maxAtBats ?? 0;

  // Build defense rosters
  const homeDefense = buildDefenseMap(homeTeam);
  const awayDefense = buildDefenseMap(awayTeam);

  // Initialize strategic state for both teams
  const homeStrategic = createStrategicState(homeTeam, homeStartingPitcher, homeStarterIndex);
  const awayStrategic = createStrategicState(awayTeam, awayStartingPitcher, awayStarterIndex);

  // Build resting-state fielder arrays so every snapshot has visible fielders.
  // Top of 1st: away team bats, home team fields.
  const homeFielders = buildRestingFielders(homeDefense, 0x1e5631);
  const awayFielders = buildRestingFielders(awayDefense, 0x2a3a6e);
  let currentFielders = homeFielders;  // home fields first (top 1st)

  const allSnapshots: WorldSnapshot[] = [];
  const strategicLog: StrategicLogEntry[] = [];
  let timeOffset = 0;

  // Track game state across at-bats
  let currentInning = 1;
  let currentHalf: 'top' | 'bottom' = 'top';
  let outs = 0;
  let homeScore = 0;
  let awayScore = 0;
  let runnersOnBase: { player: Player; base: 'first' | 'second' | 'third' }[] = [];
  let pitchCount = 0;

  const abs = gameResult.atBats;
  const limit = maxABs > 0 ? Math.min(maxABs, abs.length) : abs.length;

  for (let i = 0; i < limit; i++) {
    const ab = abs[i];

    // Keep strategic context current for inning/score-based decisions.
    homeStrategic.score = { us: homeScore, them: awayScore };
    awayStrategic.score = { us: awayScore, them: homeScore };
    homeStrategic.inning = ab.inning;
    awayStrategic.inning = ab.inning;
    homeStrategic.half = ab.half;
    awayStrategic.half = ab.half;

    // Detect inning changes
    if (ab.inning !== currentInning || ab.half !== currentHalf) {
      // Inning transition — evaluate strategic decisions
      const isHomeBatting = ab.half === 'bottom';
      const defensiveTeam = isHomeBatting ? awayTeam : homeTeam;
      const defensiveStrategic = isHomeBatting ? awayStrategic : homeStrategic;
      const opposingStrategic = isHomeBatting ? homeStrategic : awayStrategic;

      // Evaluate inning transition
      const transition = evaluateInningTransition(
        defensiveStrategic,
        0,  // runsAllowedThisInning from previous half
        getUpcomingBatters(abs, i),
        opposingStrategic.currentPitcher,
        defensiveTeam.lineup,
      );

      // Log strategic decisions
      for (const note of transition.strategicNotes) {
        strategicLog.push({
          inning: ab.inning,
          half: ab.half,
          abIndex: i,
          type: 'manager-signal',
          detail: note,
          team: isHomeBatting ? 'away' : 'home',
        });
      }

      // In pre-rolled playback, AB records are the source of truth for pitching changes.
      // Keep transition decisions as advisory notes only.
      if (transition.pitchingChange) {
        strategicLog.push({
          inning: ab.inning,
          half: ab.half,
          abIndex: i,
          type: 'manager-signal',
          detail: `Pitching recommendation: ${transition.pitchingChange.remove.lastName} → ${transition.pitchingChange.bring.lastName}`,
          team: isHomeBatting ? 'away' : 'home',
        });
      }

      // Swap fielders when sides change (always, not just on pitching changes)
      currentFielders = isHomeBatting ? awayFielders : homeFielders;

      // Emit inning change snapshot with fielders visible
      allSnapshots.push({
        time: timeOffset,
        ball: { pos: { x: 0, y: 61, z: 5 }, state: { type: 'idle' } },
        fielders: currentFielders,
        runners: [],
        events: [{
          type: 'inning-change',
          inning: ab.inning,
          half: ab.half,
        }],
      });
      timeOffset += 1;

      // Reset inning state
      currentInning = ab.inning;
      currentHalf = ab.half;
      outs = 0;
      runnersOnBase = [];
    }

    // ── Pre-AB tactical decisions ────────────────────
    const isHomeBatting = ab.half === 'bottom';
    const defensiveTeamTag: 'home' | 'away' = isHomeBatting ? 'away' : 'home';
    const defensiveStrategic = isHomeBatting ? awayStrategic : homeStrategic;
    const defensiveProfile = isHomeBatting ? awayProfile : homeProfile;
    const defenseMap = isHomeBatting ? awayDefense : homeDefense;
    const teamColor = isHomeBatting ? 0x1e5631 : 0x2a3a6e;

    const pitchingChangeDetail = syncPitcherFromAtBat(defensiveStrategic, ab.pitcher);
    if (pitchingChangeDetail) {
      strategicLog.push({
        inning: ab.inning,
        half: ab.half,
        abIndex: i,
        type: 'pitching-change',
        detail: pitchingChangeDetail,
        team: defensiveTeamTag,
      });
    }

    const situation: GameSituation = {
      outs: ab.outs,
      inning: ab.inning,
      half: ab.half,
      scoreDiff: isHomeBatting ? homeScore - awayScore : awayScore - homeScore,
    };

    // Defensive alignment
    if (shouldShift(ab.batter.skills.power, defensiveProfile)) {
      const alignment = computeDefensiveAlignment(
        ab.batter.hand,
        ab.batter.skills,
        situation,
        runnersOnBase.map(r => r.base),
      );
      if (alignment.shifts.size > 0) {
        strategicLog.push({
          inning: ab.inning,
          half: ab.half,
          abIndex: i,
          type: 'defensive-shift',
          detail: alignment.description,
          team: defensiveTeamTag,
        });
      }
    }

    // ── Build at-bat-start event ─────────────────────
    const batterName = playerTag(ab.batter);
    const pitcherPlayer = defensiveStrategic.currentPitcher;
    defenseMap.set('P', pitcherPlayer);
    const pitcherName = playerTag(pitcherPlayer);
    const activeBases = runnersOnBase.map(r => r.base);

    const abStartEvent: import('./entities').TickEvent = {
      type: 'at-bat-start',
      batter: {
        id: ab.batter.id,
        name: batterName,
        hand: ab.batter.hand ?? 'R',
        avg: ab.batter.skills.avg,
        power: ab.batter.skills.power,
        eye: ab.batter.skills.eye,
        speed: ab.batter.skills.speed,
      },
      pitcher: {
        id: pitcherPlayer.id,
        name: pitcherName,
        hand: pitcherPlayer.hand ?? 'R',
        ctrl: pitcherPlayer.skills.eye ?? 5,
        stam: pitcherPlayer.skills.stamina ?? 5,
        throwing: pitcherPlayer.skills.throwing ?? 5,
      },
      inning: ab.inning,
      half: ab.half,
      outs: ab.outs,
      homeScore,
      awayScore,
      homeName: homeTeam.name,
      awayName: awayTeam.name,
      bases: activeBases,
    };

    // Skip non-batted-ball at-bats for the tick engine (walks, strikeouts, HBP)
    if (!ab.battedBall) {
      // Update pitch count
      pitchCount += ab.pitches.length;
      defensiveStrategic.pitchCount += ab.pitches.length;

      const gsBase: import('./entities').GameState = {
        inning: ab.inning, half: ab.half, outs: ab.outs,
        homeScore, awayScore,
        basesOccupied: {
          first: runnersOnBase.some(r => r.base === 'first'),
          second: runnersOnBase.some(r => r.base === 'second'),
          third: runnersOnBase.some(r => r.base === 'third'),
        },
        batter: batterName, pitcher: pitcherName, abIndex: i,
      };
      const pitchRunners = buildPitchRunners(runnersOnBase, ab.batter);

      for (let pi = 0; pi < ab.pitches.length; pi++) {
        const p = ab.pitches[pi];
        const isFirst = pi === 0;
        const isLast = pi === ab.pitches.length - 1;

        const pitchEvents: import('./entities').TickEvent[] = [];
        if (isFirst) pitchEvents.push(abStartEvent);

        pitchEvents.push(...buildPitchTickEvents(p, pitcherPlayer, ab.batter));

        if (isLast) {
          pitchEvents.push({ type: 'at-bat-end', result: ab.result, batterId: ab.batter.id, batterName, rbis: ab.rbis });
        }

        timeOffset = emitPitchSnapshots(
          allSnapshots, timeOffset, currentFielders, pitchEvents,
          isFirst ? gsBase : undefined,
          pitchRunners,
        );
      }

      timeOffset += 0.5;  // brief pause after at-bat

      const stateUpdate = updateGameState(ab, runnersOnBase, outs);
      runnersOnBase = stateUpdate.runners;
      outs = stateUpdate.outs;
      homeScore += isHomeBatting ? ab.runsScored : 0;
      awayScore += isHomeBatting ? 0 : ab.runsScored;
      continue;
    }

    // Build game state for HUD overlay (needed by both pre-contact pitches and tick snapshots)
    const gameState: import('./entities').GameState = {
      inning: ab.inning,
      half: ab.half,
      outs: ab.outs,
      homeScore,
      awayScore,
      basesOccupied: {
        first: runnersOnBase.some(r => r.base === 'first'),
        second: runnersOnBase.some(r => r.base === 'second'),
        third: runnersOnBase.some(r => r.base === 'third'),
      },
      batter: batterName,
      pitcher: pitcherName,
      abIndex: i,
    };

    // ── Pre-contact pitches (count buildup) ────────────
    // Animate each pitch before the final contact pitch.
    const preContactPitches = ab.pitches.slice(0, -1);
    const pitchRunners = buildPitchRunners(runnersOnBase, ab.batter);

    for (let pi = 0; pi < preContactPitches.length; pi++) {
      const p = preContactPitches[pi];
      const isFirst = pi === 0;

      const pitchEvents: import('./entities').TickEvent[] = [];
      if (isFirst) pitchEvents.push(abStartEvent);

      pitchEvents.push(...buildPitchTickEvents(p, pitcherPlayer, ab.batter));

      timeOffset = emitPitchSnapshots(
        allSnapshots, timeOffset, currentFielders, pitchEvents,
        isFirst ? gameState : undefined,
        pitchRunners,
      );
    }

    // ── Tick simulation (contact pitch + fielding) ───
    const abSnapshots = simulateAtBatTick(ab, defenseMap, teamColor, {
      ...opts,
      runners: runnersOnBase,
      situation,
    });

    // Inject the CONTACT PITCH's PBP events into the tick engine's first snapshot
    // so every pitch shows in the play-by-play, including the one that was hit.
    if (abSnapshots.length > 0) {
      const contactPitch = ab.pitches[ab.pitches.length - 1];
      const contactPitchEvents = buildPitchTickEvents(contactPitch, pitcherPlayer, ab.batter);

      // Prepend: at-bat-start (if no pre-contact pitches) → pitch → pitch-result → existing events
      const injected: import('./entities').TickEvent[] = [];
      if (preContactPitches.length === 0) {
        injected.push(abStartEvent);
      }
      injected.push(...contactPitchEvents);
      abSnapshots[0].events = [...injected, ...abSnapshots[0].events];

      // Set gameState on first snapshot if not already set via pre-contact pitches
      if (preContactPitches.length === 0) {
        abSnapshots[0].gameState = gameState;
      }
    }

    // Build fielded-by label for at-bat-end from actual tick involvement first.
    let fieldedByLabel = inferFieldedByLabelFromSnapshots(abSnapshots, defenseMap);
    if (!fieldedByLabel && ab.fieldedBy) {
      const fPlayer = defenseMap.get(ab.fieldedBy);
      if (fPlayer) {
        const displayPos = displayPosition(ab.fieldedBy);
        fieldedByLabel = `${playerTag(fPlayer)} (${displayPos})`;
      }
    }

    // Inject at-bat-end into the last snapshot's events
    if (abSnapshots.length > 0) {
      const lastSnap = abSnapshots[abSnapshots.length - 1];
      lastSnap.events = [
        ...lastSnap.events.filter(e => e.type !== 'play-complete'),
        { type: 'at-bat-end', result: ab.result, batterId: ab.batter.id, batterName, rbis: ab.rbis, fieldedBy: fieldedByLabel },
        { type: 'play-complete' },
      ];
    }

    // Offset timestamps for continuous playback
    // Stamp gameState only on the FIRST snapshot (HUD caches last-seen state)
    for (let si = 0; si < abSnapshots.length; si++) {
      const snap = abSnapshots[si];
      snap.time += timeOffset;
      if (si === 0) snap.gameState = gameState;
      allSnapshots.push(snap);
    }

    if (abSnapshots.length > 0) {
      timeOffset = abSnapshots[abSnapshots.length - 1].time;
    }

    // ── 1-second mound breather ──────────────────────
    // Pitcher gets the ball back, everyone resets — give the game a breath
    const MOUND_PAUSE_SEC = 1.0;
    const idleSnap: WorldSnapshot = {
      time: timeOffset + 0.5,
      ball: { pos: { x: 0, y: 61, z: 5 }, state: { type: 'idle' } },
      fielders: currentFielders,
      runners: [],
      events: [],
    };
    allSnapshots.push(idleSnap);
    timeOffset += MOUND_PAUSE_SEC + 0.5;

    // Update pitch count
    pitchCount += ab.pitches.length;
    defensiveStrategic.pitchCount += ab.pitches.length;

    // Update game state from the at-bat result
    const stateUpdate = updateGameState(ab, runnersOnBase, outs);
    runnersOnBase = stateUpdate.runners;
    outs = stateUpdate.outs;
    homeScore += isHomeBatting ? ab.runsScored : 0;
    awayScore += isHomeBatting ? 0 : ab.runsScored;
  }

  return {
    snapshots: allSnapshots,
    strategicLog,
    totalAtBats: limit,
    totalSnapshots: allSnapshots.length,
    totalDurationSec: timeOffset,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function playerTag(player: Player): string {
  return `#${player.id} ${player.lastName}`;
}

function displayPosition(pos: string): string {
  return pos.replace(/^B(\d)/, '$1B');
}

function formatFieldingActorLabel(
  positionCode: string,
  opts: { playerId?: number; playerName?: string },
  defenseMap: Map<Position, Player>,
): string | undefined {
  const displayPos = displayPosition(positionCode);

  if (opts.playerName) {
    return `${opts.playerName} (${displayPos})`;
  }

  if (opts.playerId != null && opts.playerId > 0) {
    const rosterPlayer = defenseMap.get(positionCode as Position);
    if (rosterPlayer && rosterPlayer.id === opts.playerId) {
      return `${playerTag(rosterPlayer)} (${displayPos})`;
    }
    return `#${opts.playerId} (${displayPos})`;
  }

  const rosterPlayer = defenseMap.get(positionCode as Position);
  return rosterPlayer ? `${playerTag(rosterPlayer)} (${displayPos})` : undefined;
}

function inferFieldedByLabelFromSnapshots(
  snapshots: WorldSnapshot[],
  defenseMap: Map<Position, Player>,
): string | undefined {
  const findLabel = (
    match: (event: import('./entities').TickEvent) => string | undefined,
  ): string | undefined => {
    for (const snap of snapshots) {
      for (const event of snap.events) {
        const label = match(event);
        if (label) return label;
      }
    }
    return undefined;
  };

  const directFielding = findLabel((event) => {
    if (event.type === 'ball-caught' || event.type === 'ball-fielded') {
      return formatFieldingActorLabel(
        event.by,
        { playerId: event.playerId, playerName: event.playerName },
        defenseMap,
      );
    }
    return undefined;
  });
  if (directFielding) return directFielding;

  const throwOrigin = findLabel((event) => {
    if (event.type === 'throw-released') {
      return formatFieldingActorLabel(
        event.from,
        { playerId: event.fromId, playerName: event.fromName },
        defenseMap,
      );
    }
    return undefined;
  });
  if (throwOrigin) return throwOrigin;

  return findLabel((event) => {
    if (event.type === 'ball-received') {
      return formatFieldingActorLabel(
        event.by,
        { playerId: event.playerId, playerName: event.playerName },
        defenseMap,
      );
    }
    return undefined;
  });
}

function turnRateFromAg(ag: number): number {
  const clamped = Math.max(1, Math.min(10, ag));
  return ((90 + (clamped - 1) * 30) * Math.PI) / 180;
}

function facingToPoint(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.atan2(-(to.y - from.y), to.x - from.x);
}

/** Map spray angle to human-readable direction label. */
function sprayDirectionLabel(angleDeg: number): string {
  const a = Math.abs(angleDeg);
  const side = angleDeg < 0 ? 'LF' : angleDeg > 0 ? 'RF' : 'CF';
  if (a < 10) return 'CF';
  if (a < 20) return angleDeg < 0 ? 'LCF' : 'RCF';
  if (a < 35) return side;
  if (a < 50) return `${side}-line`;
  return `foul ${side}`;
}

/** Compute pitch type label from intent zone and variation. */
function pitchTypeLabel(zone: 'in' | 'edge' | 'off'): string {
  switch (zone) {
    case 'in': return 'Four-seam';
    case 'edge': return 'Slider';
    case 'off': return 'Changeup';
  }
}

/** Build rich pitch + pitch-result tick events from a sim-engine PitchEvent. */
function buildPitchTickEvents(
  p: import('@baseballczar/sim-engine').PitchEvent,
  pitcher: Player,
  batter: Player,
): import('./entities').TickEvent[] {
  const events: import('./entities').TickEvent[] = [];

  // Compute real pitch velocity from pitcher's throwing skill
  const baseMph = throwVelocityMph('P', pitcher.skills.throwing ?? 5);
  // Offspeed pitches are ~12-15% slower than the heater
  const mph = p.intentZone === 'off' ? Math.round(baseMph * 0.86) : Math.round(baseMph);

  events.push({
    type: 'pitch',
    pitchNum: p.pitchNum,
    batterId: batter.id,
    batterName: playerTag(batter),
    pitcherId: pitcher.id,
    pitcherName: playerTag(pitcher),
    zone: p.intentZone,
    actualInZone: p.actualInZone,
    speed: pitchTypeLabel(p.intentZone),
    mph,
    swung: p.swung,
  });

  // Build contact data for fouls and fair balls so pitch-result PBP has EV/LA/spray.
  let foulBall: { exitVeloMph: number; launchAngleDeg: number; distanceFt: number; sprayDirection: string; peakHeightFt?: number } | undefined;
  let inPlayBall: { exitVeloMph: number; launchAngleDeg: number; distanceFt: number; sprayDirection: string; peakHeightFt?: number } | undefined;
  if (p.battedBall) {
    const contact = {
      exitVeloMph: p.battedBall.exitVeloMph,
      launchAngleDeg: p.battedBall.launchAngleDeg,
      distanceFt: p.battedBall.distanceFt,
      sprayDirection: sprayDirectionLabel(p.battedBall.sprayAngleDeg),
      peakHeightFt: p.battedBall.peakHeightFt,
    };

    if (p.battedBall.isFoul) {
      foulBall = contact;
    } else {
      inPlayBall = contact;
    }
  }

  events.push({
    type: 'pitch-result',
    outcome: p.outcome,
    balls: p.balls,
    strikes: p.strikes,
    batterId: batter.id,
    batterName: playerTag(batter),
    pitcherId: pitcher.id,
    pitcherName: playerTag(pitcher),
    foulBall,
    inPlayBall,
  });

  return events;
}

/**
 * Emit 3 snapshots for a single pitch to animate the ball mound → plate:
 *  1. t+0.00: ball at pitcher (visible, in-flight), PBP events fire
 *  2. t+0.35: ball at plate  (visible, arrives at catcher)
 *  3. t+0.70: ball back idle (hidden, pause before next pitch)
 * Returns the new timeOffset after the pitch cycle.
 */
function emitPitchSnapshots(
  snapshots: WorldSnapshot[],
  t: number,
  fielders: FielderEntity[],
  events: import('./entities').TickEvent[],
  gameState?: import('./entities').GameState,
  runners: RunnerEntity[] = [],
): number {
  const mound = FIELDER_POSITIONS_FT.P;
  const plate = { x: 0, y: 0 };
  const flightVel = { x: 0, y: -135, z: -8 };  // ~92 mph toward plate

  // 1. Ball leaves pitcher's hand — events fire here
  snapshots.push({
    time: t,
    ball: { pos: { x: mound.x, y: mound.y, z: 5.5 }, state: { type: 'in-flight', vel: flightVel } },
    fielders,
    runners: cloneRunnersForSnapshot(runners),
    events,
    gameState,
  });

  // 2. Ball arrives at plate (catcher)
  snapshots.push({
    time: t + 0.35,
    ball: { pos: { x: plate.x, y: plate.y, z: 3 }, state: { type: 'in-flight', vel: { x: 0, y: -20, z: -2 } } },
    fielders,
    runners: cloneRunnersForSnapshot(runners),
    events: [],
  });

  // 3. Ball back in pitcher's glove (idle — hidden)
  snapshots.push({
    time: t + 0.70,
    ball: { pos: { x: mound.x, y: mound.y, z: 5 }, state: { type: 'idle' } },
    fielders,
    runners: cloneRunnersForSnapshot(runners),
    events: [],
  });

  return t + 0.85;  // total pitch cycle
}

/** Build static runner entities for pitch snapshots between balls in play. */
function buildPitchRunners(
  runnersOnBase: { player: Player; base: 'first' | 'second' | 'third' }[],
  batter?: Player,
): RunnerEntity[] {
  const runners: RunnerEntity[] = runnersOnBase.map((r): RunnerEntity => {
    const pos = getRunnerOnBasePoint(r.base);
    return {
      id: r.player.id,
      pos,
      state: { type: 'on-base', base: r.base },
      speedFps: 22 + (Math.max(1, r.player.skills.speed) - 1) * 1.0,
      agility: r.player.skills.ag,
      facingRad: facingToPoint(pos, BASE_POS.home),
      turnRateRad: turnRateFromAg(r.player.skills.ag),
    };
  });

  if (!batter) return runners;

  const batterAg = batter.skills.ag ?? 5;
  const batterStart = {
    x: batter.hand === 'L' ? 5 : -5,
    y: 0,
  };

  runners.push({
    id: batter.id,
    pos: batterStart,
    state: { type: 'on-base', base: 'first' },
    speedFps: 22 + (Math.max(1, batter.skills.speed) - 1) * 1.0,
    agility: batterAg,
    facingRad: facingToPoint(batterStart, FIELDER_POSITIONS_FT.P),
    turnRateRad: turnRateFromAg(batterAg),
  });

  return runners;
}

/** Clone runner entities so snapshots don't share mutable object references. */
function cloneRunnersForSnapshot(runners: RunnerEntity[]): RunnerEntity[] {
  return runners.map((r) => ({
    id: r.id,
    pos: { ...r.pos },
    state: { ...r.state } as RunnerEntity['state'],
    speedFps: r.speedFps,
    agility: r.agility,
    facingRad: r.facingRad,
    turnRateRad: r.turnRateRad,
  }));
}

/** Build a resting-state fielder array (all 9 at home positions, state idle). */
function buildRestingFielders(
  defenseMap: Map<Position, Player>,
  teamColor: number,
): FielderEntity[] {
  const positions: Position[] = ['P', 'C', 'B1', 'B2', 'SS', 'B3', 'LF', 'CF', 'RF'];
  return positions.map(pos => {
    const home = FIELDER_POSITIONS_FT[pos];
    const player = defenseMap.get(pos);
    return {
      position: pos,
      pos: { ...home },
      homePos: { ...home },
      state: { type: 'idle' as const },
      speedFps: 22 + (Math.max(1, player?.skills.speed ?? 5) - 1) * 1.0,
      agility: player?.skills.ag ?? 5,
      facingRad: facingToPoint(home, BASE_POS.home),
      turnRateRad: turnRateFromAg(player?.skills.ag ?? 5),
      throwVeloFps: 0,
      defense: player?.skills.fielding ?? 5,
      playerId: player?.id ?? -1,
      teamColor,
    };
  });
}

function buildDefenseMap(team: Team): Map<Position, Player> {
  const map = new Map<Position, Player>();
  const positions: Position[] = ['P', 'C', 'B1', 'B2', 'SS', 'B3', 'LF', 'CF', 'RF'];
  for (let i = 0; i < positions.length && i < team.roster.length; i++) {
    map.set(positions[i], team.roster[i]);
  }
  return map;
}

function getUpcomingBatters(abs: AtBatRecord[], currentIdx: number): Player[] {
  const upcoming: Player[] = [];
  for (let i = currentIdx; i < Math.min(currentIdx + 3, abs.length); i++) {
    upcoming.push(abs[i].batter);
  }
  return upcoming;
}

function isOutResult(result: string): boolean {
  return [
    'ground-out', 'fly-out', 'line-out', 'pop-out',
    'foul-out', 'strikeout', 'double-play', 'sac-fly',
    'fielders-choice',
  ].includes(result);
}

interface GameStateUpdate {
  runners: { player: Player; base: 'first' | 'second' | 'third' }[];
  outs: number;
}

/**
 * Update the base/out state after an at-bat resolves.
 * Simplified version — the real engine tracks this precisely,
 * but for the orchestrator we derive it from the AtBatRecord.
 */
function updateGameState(
  ab: AtBatRecord,
  prevRunners: { player: Player; base: 'first' | 'second' | 'third' }[],
  prevOuts: number,
): GameStateUpdate {
  const newRunners: { player: Player; base: 'first' | 'second' | 'third' }[] = [];
  let newOuts = prevOuts;

  switch (ab.result) {
    case 'single':
      // Advance runners, batter to first
      for (const r of prevRunners) {
        if (r.base === 'third') {
          // Scores
        } else if (r.base === 'second') {
          newRunners.push({ player: r.player, base: 'third' });
        } else if (r.base === 'first') {
          newRunners.push({ player: r.player, base: 'second' });
        }
      }
      newRunners.push({ player: ab.batter, base: 'first' });
      break;

    case 'double':
      for (const r of prevRunners) {
        // All runners score from 2B/3B
        if (r.base === 'first') {
          newRunners.push({ player: r.player, base: 'third' });
        }
      }
      newRunners.push({ player: ab.batter, base: 'second' });
      break;

    case 'triple':
      // All runners score
      newRunners.push({ player: ab.batter, base: 'third' });
      break;

    case 'home-run':
      // Everyone scores, bases empty
      break;

    case 'walk':
    case 'hbp':
      // Force runners forward
      for (const r of prevRunners) {
        if (r.base === 'first') {
          newRunners.push({ player: r.player, base: 'second' });
        } else {
          newRunners.push(r);
        }
      }
      newRunners.push({ player: ab.batter, base: 'first' });
      break;

    case 'ground-out':
    case 'fly-out':
    case 'line-out':
    case 'pop-out':
    case 'foul-out':
    case 'strikeout':
      newOuts++;
      // Runners stay (simplified)
      newRunners.push(...prevRunners);
      break;

    case 'sac-fly':
      newOuts++;
      // Runner on 3B scores, others hold
      for (const r of prevRunners) {
        if (r.base !== 'third') {
          newRunners.push(r);
        }
      }
      break;

    case 'double-play':
      newOuts += 2;
      // Remove lead runner + batter
      for (const r of prevRunners) {
        if (r.base !== 'first') {
          newRunners.push(r);
        }
      }
      break;

    case 'fielders-choice':
      newOuts++;
      // Lead runner out, batter safe at first
      for (const r of prevRunners) {
        if (r.base !== 'first') {
          newRunners.push(r);
        }
      }
      newRunners.push({ player: ab.batter, base: 'first' });
      break;

    case 'reached-on-error':
      // Batter reaches, runners advance
      for (const r of prevRunners) {
        if (r.base === 'third') {
          // Scores
        } else if (r.base === 'second') {
          newRunners.push({ player: r.player, base: 'third' });
        } else if (r.base === 'first') {
          newRunners.push({ player: r.player, base: 'second' });
        }
      }
      newRunners.push({ player: ab.batter, base: 'first' });
      break;

    default:
      newRunners.push(...prevRunners);
      break;
  }

  return { runners: newRunners, outs: Math.min(3, newOuts) };
}
