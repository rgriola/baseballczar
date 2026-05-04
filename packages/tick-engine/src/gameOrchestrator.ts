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
import type { WorldSnapshot, TickEvent, Point2D } from './entities';
import { simulateAtBatTick, type TickSimOptions } from './tickEngine';
import {
  computeDefensiveAlignment,
  evaluateSignal,
  selectPitch,
  type GameSituation,
  type PitchCall,
} from './aiManager';
import {
  createStrategicState,
  evaluatePitchingChange,
  evaluatePinchDecision,
  executePitchingChange,
  executePinchDecision,
  evaluateInningTransition,
  type StrategicState,
} from './strategicManager';
import {
  type ManagerProfile,
  MANAGER_PROFILES,
  adjustedPitchThreshold,
  shouldShift,
} from './managerProfiles';
import { FIELDER_POSITIONS_FT } from '@baseballczar/sim-engine';

// ─── Full-game simulation ────────────────────────────────────────

export interface FullGameOptions extends TickSimOptions {
  /** Manager profile for the home team. Default: balanced. */
  homeProfile?: ManagerProfile;
  /** Manager profile for the away team. Default: balanced. */
  awayProfile?: ManagerProfile;
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
  const maxABs = opts.maxAtBats ?? 0;

  // Build defense rosters
  const homeDefense = buildDefenseMap(homeTeam);
  const awayDefense = buildDefenseMap(awayTeam);

  // Initialize strategic state for both teams
  const homeStrategic = createStrategicState(homeTeam, homeTeam.rotation[0]);
  const awayStrategic = createStrategicState(awayTeam, awayTeam.rotation[0]);

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

    // Detect inning changes
    if (ab.inning !== currentInning || ab.half !== currentHalf) {
      // Inning transition — evaluate strategic decisions
      const isHomeBatting = ab.half === 'bottom';
      const defensiveTeam = isHomeBatting ? awayTeam : homeTeam;
      const defensiveStrategic = isHomeBatting ? awayStrategic : homeStrategic;
      const defensiveProfile = isHomeBatting ? awayProfile : homeProfile;

      // Evaluate inning transition
      const transition = evaluateInningTransition(
        defensiveStrategic,
        0,  // runsAllowedThisInning from previous half
        getUpcomingBatters(abs, i),
        isHomeBatting ? homeTeam.rotation[0] : awayTeam.rotation[0],
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

      // Execute pitching change if warranted
      if (transition.pitchingChange) {
        executePitchingChange(defensiveStrategic, transition.pitchingChange);
        strategicLog.push({
          inning: ab.inning,
          half: ab.half,
          abIndex: i,
          type: 'pitching-change',
          detail: `${transition.pitchingChange.remove.lastName} → ${transition.pitchingChange.bring.lastName}`,
          team: isHomeBatting ? 'away' : 'home',
        });

        // Emit inning change event
        allSnapshots.push({
          time: timeOffset,
          ball: { pos: { x: 0, y: 61, z: 5 }, state: { type: 'idle' } },
          fielders: [],
          runners: [],
          events: [{
            type: 'inning-change',
            inning: ab.inning,
            half: ab.half,
          }],
        });
        timeOffset += 1;
      }

      // Reset inning state
      currentInning = ab.inning;
      currentHalf = ab.half;
      outs = 0;
      runnersOnBase = [];
    }

    // ── Pre-AB tactical decisions ────────────────────
    const isHomeBatting = ab.half === 'bottom';
    const battingProfile = isHomeBatting ? homeProfile : awayProfile;
    const defensiveProfile = isHomeBatting ? awayProfile : homeProfile;
    const defenseMap = isHomeBatting ? awayDefense : homeDefense;
    const teamColor = isHomeBatting ? 0x1e5631 : 0x2a3a6e;

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
          team: isHomeBatting ? 'away' : 'home',
        });
      }
    }

    // ── Build at-bat-start event ─────────────────────
    const batterName = `${ab.batter.firstName[0]}. ${ab.batter.lastName}`;
    const pitcherPlayer = isHomeBatting ? awayTeam.rotation[0] : homeTeam.rotation[0];
    const pitcherName = `${pitcherPlayer.firstName[0]}. ${pitcherPlayer.lastName}`;
    const activeBases = runnersOnBase.map(r => r.base);

    const abStartEvent: import('./entities').TickEvent = {
      type: 'at-bat-start',
      batter: {
        name: batterName,
        hand: ab.batter.hand ?? 'R',
        avg: ab.batter.skills.avg,
        power: ab.batter.skills.power,
        eye: ab.batter.skills.eye,
        speed: ab.batter.skills.speed,
      },
      pitcher: {
        name: pitcherName,
        hand: pitcherPlayer.hand ?? 'R',
        ctrl: pitcherPlayer.skills.eye ?? 5,
        stam: pitcherPlayer.skills.stamina ?? 5,
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

    // Skip non-batted-ball at-bats for the tick engine (walks, strikeouts)
    if (!ab.battedBall) {
      // Update pitch count
      pitchCount += ab.pitches.length;

      // Still emit PBP events for walks/Ks so they show in the readout
      const resultLabel =
        ab.result === 'walk' ? 'Walk' :
        ab.result === 'strikeout' ? 'Strikeout' :
        ab.result === 'hbp' ? 'Hit by pitch' :
        ab.result;
      allSnapshots.push({
        time: timeOffset,
        ball: { pos: { x: 0, y: 61, z: 5 }, state: { type: 'idle' } },
        fielders: [], runners: [],
        events: [
          abStartEvent,
          { type: 'at-bat-end', result: ab.result, batterName, rbis: ab.rbis },
        ],
        gameState: {
          inning: ab.inning, half: ab.half, outs: ab.outs,
          homeScore, awayScore,
          basesOccupied: {
            first: runnersOnBase.some(r => r.base === 'first'),
            second: runnersOnBase.some(r => r.base === 'second'),
            third: runnersOnBase.some(r => r.base === 'third'),
          },
          batter: batterName, pitcher: pitcherName, abIndex: i,
        },
      });
      timeOffset += 2; // brief pause for non-batted-ball ABs

      // Update bases/outs from the at-bat result
      const stateUpdate = updateGameState(ab, runnersOnBase, outs);
      runnersOnBase = stateUpdate.runners;
      outs = stateUpdate.outs;
      homeScore += isHomeBatting ? ab.runsScored : 0;
      awayScore += isHomeBatting ? 0 : ab.runsScored;
      continue;
    }

    // ── Tick simulation ──────────────────────────────
    const abSnapshots = simulateAtBatTick(ab, defenseMap, teamColor, {
      ...opts,
      runners: runnersOnBase,
      situation,
    });

    // Build game state for HUD overlay
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

    // Inject at-bat-start into the first snapshot's events
    if (abSnapshots.length > 0) {
      abSnapshots[0].events = [abStartEvent, ...abSnapshots[0].events];
    }

    // Build fielded-by label for at-bat-end
    let fieldedByLabel: string | undefined;
    if (ab.fieldedBy) {
      const fPlayer = defenseMap.get(ab.fieldedBy);
      if (fPlayer) {
        const displayPos = ab.fieldedBy.replace(/^B(\d)/, '$1B');
        fieldedByLabel = `${fPlayer.firstName[0]}. ${fPlayer.lastName} (${displayPos})`;
      }
    }

    // Inject at-bat-end into the last snapshot's events
    if (abSnapshots.length > 0) {
      const lastSnap = abSnapshots[abSnapshots.length - 1];
      lastSnap.events = [
        ...lastSnap.events.filter(e => e.type !== 'play-complete'),
        { type: 'at-bat-end', result: ab.result, batterName, rbis: ab.rbis, fieldedBy: fieldedByLabel },
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
      fielders: [],
      runners: [],
      events: [],
    };
    allSnapshots.push(idleSnap);
    timeOffset += MOUND_PAUSE_SEC + 0.5;

    // Update pitch count
    pitchCount += ab.pitches.length;

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
