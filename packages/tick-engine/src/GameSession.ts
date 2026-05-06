// Last touched by agent: 2026-05-05T08:18:00Z
/**
 * GameSession — Stateful, incremental game simulation.
 *
 * Supports three execution modes:
 *   1. **Batch Playback**: Pre-roll all ABs via simulateGame(), then replay
 *      them through the tick engine for visual playback. AI-only.
 *   2. **On-Demand Sim**: Simulate one AB at a time with AI decisions.
 *      No pre-roll — the sim-engine runs each AB as the session ticks.
 *   3. **Multiplayer 1v1**: Like On-Demand but with human ManagerDecisions
 *      injected per AB. AI fills in if the human times out.
 *
 * The session is a self-contained state machine. Callers advance it
 * one at-bat at a time via `nextAtBat()`, which returns the WorldSnapshot[]
 * for that AB. This enables:
 *   - Streaming playback (render each AB as it resolves)
 *   - Web Worker offloading (session runs in a worker, snapshots posted)
 *   - Server-authoritative multiplayer (session runs on server, snapshots
 *     broadcast via WebSocket)
 *
 * Consumers that want the old batch API can still use `simulateFullGame()`.
 */
import type { AtBatRecord, Player, Team, GameResult, Position } from '@baseballczar/sim-engine';
import { FIELDER_POSITIONS_FT } from '@baseballczar/sim-engine';
import type { WorldSnapshot, TickEvent, Point2D } from './entities';
import { simulateAtBatTick, type TickSimOptions } from './tickEngine';
import {
  computeDefensiveAlignment,
  type GameSituation,
} from './aiManager';
import {
  createStrategicState,
  evaluateInningTransition,
  type StrategicState,
} from './strategicManager';
import {
  type ManagerProfile,
  MANAGER_PROFILES,
  shouldShift,
} from './managerProfiles';
import { normalizeStarterIndex, syncPitcherFromAtBat } from './pitchingPlayback';

// ─── Public types ────────────────────────────────────────────────

export type SessionMode = 'batch' | 'on-demand' | 'multiplayer';

export interface GameSessionConfig {
  mode: SessionMode;
  homeTeam: Team;
  awayTeam: Team;
  homeProfile?: ManagerProfile;
  awayProfile?: ManagerProfile;
  /** Rotation slot to use as home starter for this game. */
  homeStarterIndex?: number;
  /** Rotation slot to use as away starter for this game. */
  awayStarterIndex?: number;
  /** Pre-rolled game result. Required for 'batch' mode; ignored otherwise. */
  preRolled?: GameResult;
  /** Tick simulation options (speed multiplier, etc.). */
  tickOpts?: TickSimOptions;
}

/** Manager decisions a human can inject in multiplayer mode. */
export interface ManagerDecisions {
  /** Override defensive shift for this AB. */
  defensiveShift?: Map<Position, Point2D>;
  /** Call a pitching change before this AB. */
  pitchingChange?: { removePlayerId: number; bringPlayerId: number };
  /** Signal to the batter (take, swing away, bunt). */
  batterSignal?: 'take' | 'swing-away' | 'bunt';
}

export interface AtBatResult {
  /** WorldSnapshots for this AB (ready for rendering). */
  snapshots: WorldSnapshot[];
  /** The underlying at-bat record from the sim-engine. */
  record: AtBatRecord;
  /** Strategic log entries generated this AB. */
  strategicNotes: string[];
}

/** Read-only game state visible to both sides. */
export interface GameSessionState {
  inning: number;
  half: 'top' | 'bottom';
  outs: number;
  homeScore: number;
  awayScore: number;
  runners: { player: Player; base: 'first' | 'second' | 'third' }[];
  abIndex: number;
  isOver: boolean;
  /** Current pitcher's pitch count. */
  pitchCount: number;
}

// ─── GameSession class ───────────────────────────────────────────

export class GameSession {
  readonly mode: SessionMode;
  readonly homeTeam: Team;
  readonly awayTeam: Team;

  // Manager profiles
  private homeProfile: ManagerProfile;
  private awayProfile: ManagerProfile;

  // Pre-rolled ABs (batch mode only)
  private preRolledABs: AtBatRecord[] | null = null;

  // Game state
  private _inning = 1;
  private _half: 'top' | 'bottom' = 'top';
  private _outs = 0;
  private _homeScore = 0;
  private _awayScore = 0;
  private _runners: { player: Player; base: 'first' | 'second' | 'third' }[] = [];
  private _abIndex = 0;
  private _isOver = false;
  private _timeOffset = 0;
  private _pitchCount = 0;

  // Strategic state per team
  private homeStrategic: StrategicState;
  private awayStrategic: StrategicState;

  // Defense maps
  private homeDefense: Map<Position, Player>;
  private awayDefense: Map<Position, Player>;

  // Tick options
  private tickOpts: TickSimOptions;

  constructor(config: GameSessionConfig) {
    this.mode = config.mode;
    this.homeTeam = config.homeTeam;
    this.awayTeam = config.awayTeam;
    this.homeProfile = config.homeProfile ?? MANAGER_PROFILES.balanced;
    this.awayProfile = config.awayProfile ?? MANAGER_PROFILES.balanced;
    this.tickOpts = config.tickOpts ?? {};

    if (config.mode === 'batch') {
      if (!config.preRolled) throw new Error('Batch mode requires preRolled GameResult');
      this.preRolledABs = config.preRolled.atBats;
    }

    this.homeDefense = this.buildDefenseMap(this.homeTeam);
    this.awayDefense = this.buildDefenseMap(this.awayTeam);
    const homeStarterIndex = normalizeStarterIndex(config.homeStarterIndex ?? 0, this.homeTeam.rotation.length);
    const awayStarterIndex = normalizeStarterIndex(config.awayStarterIndex ?? 0, this.awayTeam.rotation.length);
    const homeStartingPitcher = this.homeTeam.rotation[homeStarterIndex] ?? this.homeTeam.rotation[0];
    const awayStartingPitcher = this.awayTeam.rotation[awayStarterIndex] ?? this.awayTeam.rotation[0];
    this.homeStrategic = createStrategicState(this.homeTeam, homeStartingPitcher, homeStarterIndex);
    this.awayStrategic = createStrategicState(this.awayTeam, awayStartingPitcher, awayStarterIndex);
  }

  /** Current game state (read-only snapshot). */
  get state(): GameSessionState {
    return {
      inning: this._inning,
      half: this._half,
      outs: this._outs,
      homeScore: this._homeScore,
      awayScore: this._awayScore,
      runners: [...this._runners],
      abIndex: this._abIndex,
      isOver: this._isOver,
      pitchCount: this._pitchCount,
    };
  }

  /**
   * Advance the game by one at-bat. Returns the snapshots and metadata.
   *
   * In **batch** mode, reads from the pre-rolled AB list.
   * In **on-demand** and **multiplayer** modes, the AB is simulated
   * on the fly using the sim-engine (future: accepts ManagerDecisions).
   *
   * @param decisions  Optional human manager decisions (multiplayer only).
   * @returns AtBatResult or null if the game is over.
   */
  nextAtBat(decisions?: ManagerDecisions): AtBatResult | null {
    if (this._isOver) return null;

    // Get the next AB record
    const ab = this.getNextAB();
    if (!ab) {
      this._isOver = true;
      return null;
    }

    const strategicNotes: string[] = [];

    // Keep strategic context current for inning/score-driven decisions.
    this.homeStrategic.score = { us: this._homeScore, them: this._awayScore };
    this.awayStrategic.score = { us: this._awayScore, them: this._homeScore };
    this.homeStrategic.inning = ab.inning;
    this.awayStrategic.inning = ab.inning;
    this.homeStrategic.half = ab.half;
    this.awayStrategic.half = ab.half;

    // ── Inning transition ──────────────────────────
    if (ab.inning !== this._inning || ab.half !== this._half) {
      const isHomeBatting = ab.half === 'bottom';
      const defensiveStrategic = isHomeBatting ? this.awayStrategic : this.homeStrategic;
      const defensiveTeam = isHomeBatting ? this.awayTeam : this.homeTeam;
      const opposingStrategic = isHomeBatting ? this.homeStrategic : this.awayStrategic;

      const transition = evaluateInningTransition(
        defensiveStrategic,
        0,
        this.getUpcomingBatters(3),
        opposingStrategic.currentPitcher,
        defensiveTeam.lineup,
      );

      for (const note of transition.strategicNotes) {
        strategicNotes.push(note);
      }

      if (transition.pitchingChange) {
        strategicNotes.push(
          `Pitching recommendation: ${transition.pitchingChange.remove.lastName} → ${transition.pitchingChange.bring.lastName}`
        );
      }

      this._inning = ab.inning;
      this._half = ab.half;
      this._outs = 0;
      this._runners = [];
    }

    // ── Pre-AB tactical decisions ──────────────────
    const isHomeBatting = ab.half === 'bottom';
    const defensiveTeamTag = isHomeBatting ? 'away' : 'home';
    const defensiveStrategic = isHomeBatting ? this.awayStrategic : this.homeStrategic;
    const defensiveProfile = isHomeBatting ? this.awayProfile : this.homeProfile;
    const defenseMap = isHomeBatting ? this.awayDefense : this.homeDefense;
    const teamColor = isHomeBatting ? 0x1e5631 : 0x2a3a6e;

    const pitchingChangeDetail = syncPitcherFromAtBat(defensiveStrategic, ab.pitcher);
    if (pitchingChangeDetail) {
      strategicNotes.push(`Pitching change (${defensiveTeamTag}): ${pitchingChangeDetail}`);
    }

    const situation: GameSituation = {
      outs: ab.outs,
      inning: ab.inning,
      half: ab.half,
      scoreDiff: isHomeBatting
        ? this._homeScore - this._awayScore
        : this._awayScore - this._homeScore,
    };

    // Apply human decisions if provided (multiplayer)
    if (decisions?.defensiveShift) {
      // Future: apply custom positioning
    }

    // AI defensive shift
    if (shouldShift(ab.batter.skills.power, defensiveProfile)) {
      const alignment = computeDefensiveAlignment(
        ab.batter.hand,
        ab.batter.skills,
        situation,
        this._runners.map(r => r.base),
      );
      if (alignment.shifts.size > 0) {
        strategicNotes.push(`Defensive shift: ${alignment.description}`);
      }
    }

    // ── Build snapshot events ──────────────────────
    const batterName = playerTag(ab.batter);
    const pitcherPlayer = defensiveStrategic.currentPitcher;
    defenseMap.set('P', pitcherPlayer);
    const pitcherName = playerTag(pitcherPlayer);

    const abStartEvent: TickEvent = {
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
      homeScore: this._homeScore,
      awayScore: this._awayScore,
      homeName: this.homeTeam.name,
      awayName: this.awayTeam.name,
      bases: this._runners.map(r => r.base),
    };

    // ── Simulate via tick engine ──────────────────
    let abSnapshots: WorldSnapshot[];

    if (!ab.battedBall) {
      // Non-batted-ball AB (walk, K, HBP)
      abSnapshots = [{
        time: this._timeOffset,
        ball: { pos: { x: 0, y: 61, z: 5 }, state: { type: 'idle' } },
        fielders: [], runners: [],
        events: [
          abStartEvent,
          { type: 'at-bat-end', result: ab.result, batterId: ab.batter.id, batterName, rbis: ab.rbis },
        ],
        gameState: {
          inning: ab.inning, half: ab.half, outs: ab.outs,
          homeScore: this._homeScore, awayScore: this._awayScore,
          basesOccupied: {
            first: this._runners.some(r => r.base === 'first'),
            second: this._runners.some(r => r.base === 'second'),
            third: this._runners.some(r => r.base === 'third'),
          },
          batter: batterName, pitcher: pitcherName, abIndex: this._abIndex,
        },
      }];
      this._timeOffset += 2;
    } else {
      // Batted ball — run through tick engine
      abSnapshots = simulateAtBatTick(ab, defenseMap, teamColor, {
        ...this.tickOpts,
        runners: this._runners,
        situation,
      });

      // Inject at-bat-start into first snapshot
      if (abSnapshots.length > 0) {
        abSnapshots[0].events = [abStartEvent, ...abSnapshots[0].events];
        abSnapshots[0].gameState = {
          inning: ab.inning, half: ab.half, outs: ab.outs,
          homeScore: this._homeScore, awayScore: this._awayScore,
          basesOccupied: {
            first: this._runners.some(r => r.base === 'first'),
            second: this._runners.some(r => r.base === 'second'),
            third: this._runners.some(r => r.base === 'third'),
          },
          batter: batterName, pitcher: pitcherName, abIndex: this._abIndex,
        };
      }

      // Inject at-bat-end into last snapshot
      if (abSnapshots.length > 0) {
        let fieldedByLabel = inferFieldedByLabelFromSnapshots(abSnapshots, defenseMap);
        if (!fieldedByLabel && ab.fieldedBy) {
          const fPlayer = defenseMap.get(ab.fieldedBy);
          if (fPlayer) {
            const displayPos = displayPosition(ab.fieldedBy);
            fieldedByLabel = `${playerTag(fPlayer)} (${displayPos})`;
          }
        }
        const lastSnap = abSnapshots[abSnapshots.length - 1];
        lastSnap.events = [
          ...lastSnap.events.filter(e => e.type !== 'play-complete'),
          { type: 'at-bat-end', result: ab.result, batterId: ab.batter.id, batterName, rbis: ab.rbis, fieldedBy: fieldedByLabel },
          { type: 'play-complete' },
        ];
      }

      // Offset timestamps
      for (const snap of abSnapshots) {
        snap.time += this._timeOffset;
      }
      if (abSnapshots.length > 0) {
        this._timeOffset = abSnapshots[abSnapshots.length - 1].time;
      }

      // Mound breather
      abSnapshots.push({
        time: this._timeOffset + 0.5,
        ball: { pos: { x: 0, y: 61, z: 5 }, state: { type: 'idle' } },
        fielders: [], runners: [], events: [],
      });
      this._timeOffset += 1.5;
    }

    // ── Update game state ──────────────────────────
    this._pitchCount += ab.pitches.length;
    defensiveStrategic.pitchCount += ab.pitches.length;
    const stateUpdate = this.updateGameState(ab);
    this._runners = stateUpdate.runners;
    this._outs = stateUpdate.outs;
    this._homeScore += isHomeBatting ? ab.runsScored : 0;
    this._awayScore += isHomeBatting ? 0 : ab.runsScored;
    this._abIndex++;

    // Check if game is over
    if (this.mode === 'batch' && this._abIndex >= (this.preRolledABs?.length ?? 0)) {
      this._isOver = true;
    }

    return {
      snapshots: abSnapshots,
      record: ab,
      strategicNotes,
    };
  }

  /**
   * Run the entire game in batch mode. Convenience wrapper around
   * repeated `nextAtBat()` calls. Returns all snapshots concatenated.
   */
  runFullGame(): { snapshots: WorldSnapshot[]; strategicNotes: string[] } {
    const allSnapshots: WorldSnapshot[] = [];
    const allNotes: string[] = [];

    let result: AtBatResult | null;
    while ((result = this.nextAtBat()) !== null) {
      allSnapshots.push(...result.snapshots);
      allNotes.push(...result.strategicNotes);
    }

    return { snapshots: allSnapshots, strategicNotes: allNotes };
  }

  // ─── Private helpers ─────────────────────────────────────────

  private getNextAB(): AtBatRecord | null {
    if (this.mode === 'batch') {
      if (!this.preRolledABs || this._abIndex >= this.preRolledABs.length) return null;
      return this.preRolledABs[this._abIndex];
    }
    // Future: on-demand and multiplayer modes will generate ABs here
    return null;
  }

  private getUpcomingBatters(count: number): Player[] {
    if (!this.preRolledABs) return [];
    const upcoming: Player[] = [];
    for (let i = this._abIndex; i < Math.min(this._abIndex + count, this.preRolledABs.length); i++) {
      upcoming.push(this.preRolledABs[i].batter);
    }
    return upcoming;
  }

  private buildDefenseMap(team: Team): Map<Position, Player> {
    const map = new Map<Position, Player>();
    const positions: Position[] = ['P', 'C', 'B1', 'B2', 'SS', 'B3', 'LF', 'CF', 'RF'];
    for (let i = 0; i < positions.length && i < team.roster.length; i++) {
      map.set(positions[i], team.roster[i]);
    }
    return map;
  }

  private updateGameState(
    ab: AtBatRecord,
  ): { runners: { player: Player; base: 'first' | 'second' | 'third' }[]; outs: number } {
    const newRunners: { player: Player; base: 'first' | 'second' | 'third' }[] = [];
    let newOuts = this._outs;

    switch (ab.result) {
      case 'single':
        for (const r of this._runners) {
          if (r.base === 'third') { /* scores */ }
          else if (r.base === 'second') newRunners.push({ player: r.player, base: 'third' });
          else if (r.base === 'first') newRunners.push({ player: r.player, base: 'second' });
        }
        newRunners.push({ player: ab.batter, base: 'first' });
        break;
      case 'double':
        for (const r of this._runners) {
          if (r.base === 'first') newRunners.push({ player: r.player, base: 'third' });
        }
        newRunners.push({ player: ab.batter, base: 'second' });
        break;
      case 'triple':
        newRunners.push({ player: ab.batter, base: 'third' });
        break;
      case 'home-run':
        break; // everyone scores
      case 'walk':
      case 'hbp':
        for (const r of this._runners) {
          if (r.base === 'first') newRunners.push({ player: r.player, base: 'second' });
          else newRunners.push(r);
        }
        newRunners.push({ player: ab.batter, base: 'first' });
        break;
      case 'ground-out': case 'fly-out': case 'line-out':
      case 'pop-out': case 'foul-out': case 'strikeout':
        newOuts++;
        newRunners.push(...this._runners);
        break;
      case 'sac-fly':
        newOuts++;
        for (const r of this._runners) {
          if (r.base !== 'third') newRunners.push(r);
        }
        break;
      case 'double-play':
        newOuts += 2;
        for (const r of this._runners) {
          if (r.base !== 'first') newRunners.push(r);
        }
        break;
      case 'fielders-choice':
        newOuts++;
        for (const r of this._runners) {
          if (r.base !== 'first') newRunners.push(r);
        }
        newRunners.push({ player: ab.batter, base: 'first' });
        break;
      case 'reached-on-error':
        for (const r of this._runners) {
          if (r.base === 'third') { /* scores */ }
          else if (r.base === 'second') newRunners.push({ player: r.player, base: 'third' });
          else if (r.base === 'first') newRunners.push({ player: r.player, base: 'second' });
        }
        newRunners.push({ player: ab.batter, base: 'first' });
        break;
      default:
        newRunners.push(...this._runners);
        break;
    }

    return { runners: newRunners, outs: Math.min(3, newOuts) };
  }
}

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
    match: (event: TickEvent) => string | undefined,
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
