// Last touched by agent: 2026-05-12T09:19:00Z
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
import type { AtBatRecord, AtBatResult, Player, Team, GameResult, Position, ManagerState } from '@baseballczar/sim-engine';
import { throwVelocityMph, sprintFtPerSec, simulateAtBat, CONFIG, shouldPullPitcher, pickReliever } from '@baseballczar/sim-engine';
import type { Rng } from '@baseballczar/sim-engine';
import type { WorldSnapshot, FielderEntity, RunnerEntity } from './entities';
import { simulateAtBatTick, type TickSimOptions } from './tickEngine';
import { extractTickOutcome } from './tickAuthority';
import { StatsAccumulator, isHitResult, isOutResult } from './statsAccumulator';
import { BASE_POS, nextBase, tickRunner, commandRunner } from './runnerAI';
import {
  computeDefensiveAlignment,
  evaluateSignal,
  resolveStealAttempt,
  evaluatePickoff,
  evaluateWildPitchOrPassedBall,
  leadDistanceFt,
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
import { normalizeStarterIndex } from './pitchingPlayback';
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
  /** DEPRECATED: pre-rolled GameResult. If provided, falls back to legacy replay. */
  preRolled?: GameResult;
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
  /** Complete GameResult with stats — used by box score, season accumulators, etc. */
  gameResult: GameResult;
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
 * The orchestrator OWNS the game loop. It calls simulateAtBat() from the
 * sim-engine per at-bat to get pitch sequences and batted-ball physics,
 * then runs them through tick-engine physics to determine outcomes.
 * The tick engine is the SOLE AUTHORITY on batted-ball results.
 *
 * @param rng         Seeded random number generator.
 * @param homeTeam    Home team roster.
 * @param awayTeam    Away team roster.
 * @param opts        Options (profiles, starter indices, etc.).
 */
export function simulateFullGame(
  rng: Rng,
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

  // ── Team uniform colors (consistent across the entire game) ─────
  // Home = blue, Away = red. These are used for both fielders and runners.
  const HOME_COLOR = 0x2563eb;  // vibrant blue
  const AWAY_COLOR = 0xdc2626;  // vibrant red

  // Build resting-state fielder arrays so every snapshot has visible fielders.
  // Top of 1st: away team bats, home team fields.
  const homeFielders = buildRestingFielders(homeDefense, HOME_COLOR);
  const awayFielders = buildRestingFielders(awayDefense, AWAY_COLOR);
  let currentFielders = homeFielders;  // home fields first (top 1st)

  const allSnapshots: WorldSnapshot[] = [];
  const strategicLog: StrategicLogEntry[] = [];
  let timeOffset = 0;

  // Track game state across at-bats
  let homeScore = 0;
  let awayScore = 0;
  let totalPitchCount = 0;
  let abIndex = 0;

  // ── Stats accumulator (single source of truth) ──────────────────
  const acc = new StatsAccumulator(homeTeam, awayTeam, homeDefense, awayDefense);
  const atBatRecords: AtBatRecord[] = [];
  // Current inning number to compute per-inning scoring in GameResult
  let totalInningsPlayed = 9;

  // Initialize starting pitchers in the accumulator
  acc.initPitcher(homeStartingPitcher.id);
  acc.initPitcher(awayStartingPitcher.id);

  // Batting order indices
  let homeBattingIdx = 0;
  let awayBattingIdx = 0;

  // Pitcher manager state
  let homePitcherState: ManagerState = {
    pitcherId: homeStartingPitcher.id, pitchCount: 0, battersFaced: 0,
    runsAllowed: 0, hitsAllowed: 0, isStarter: true, bullpenUsed: new Set(),
  };
  let awayPitcherState: ManagerState = {
    pitcherId: awayStartingPitcher.id, pitchCount: 0, battersFaced: 0,
    runsAllowed: 0, hitsAllowed: 0, isStarter: true, bullpenUsed: new Set(),
  };
  let homeCurrentPitcher = homeStartingPitcher;
  let awayCurrentPitcher = awayStartingPitcher;

  const maxInnings = CONFIG.game.maxInnings ?? 12;

  // ── MAIN GAME LOOP ─────────────────────────────────────────────
  for (let inning = 1; inning <= maxInnings; inning++) {
    for (const half of ['top', 'bottom'] as const) {
      // Walk-off: skip bottom of inning if home is ahead after top of 9+
      if (half === 'bottom' && inning >= 9 && homeScore > awayScore) break;

      const isHomeBatting = half === 'bottom';
      const battingTeam = isHomeBatting ? homeTeam : awayTeam;
      const fieldingTeam = isHomeBatting ? awayTeam : homeTeam;
      const defenseMap = isHomeBatting ? awayDefense : homeDefense;
      const fieldingStrategic = isHomeBatting ? awayStrategic : homeStrategic;
      const offensiveProfile = isHomeBatting ? homeProfile : awayProfile;
      const defensiveProfile = isHomeBatting ? awayProfile : homeProfile;
      const battingTeamColor = isHomeBatting ? HOME_COLOR : AWAY_COLOR;
      const fieldingTeamColor = isHomeBatting ? AWAY_COLOR : HOME_COLOR;
      const defensiveTeamTag: 'home' | 'away' = isHomeBatting ? 'away' : 'home';

      // Swap fielders
      currentFielders = isHomeBatting ? awayFielders : homeFielders;

      // Get current pitcher + state
      let currentPitcher = isHomeBatting ? awayCurrentPitcher : homeCurrentPitcher;
      let pitcherState = isHomeBatting ? awayPitcherState : homePitcherState;

      // Evaluate pitching change at inning start
      const scoreDiff = isHomeBatting
        ? awayScore - homeScore   // fielding team's perspective
        : homeScore - awayScore;
      if (shouldPullPitcher(pitcherState, fieldingTeam, inning, scoreDiff)) {
        const next = pickReliever(fieldingTeam, pitcherState.bullpenUsed, inning, scoreDiff);
        if (next) {
          pitcherState.bullpenUsed.add(next.id);
          currentPitcher = next;
          pitcherState = {
            pitcherId: next.id, pitchCount: 0, battersFaced: 0,
            runsAllowed: 0, hitsAllowed: 0, isStarter: false,
            bullpenUsed: pitcherState.bullpenUsed,
          };
          defenseMap.set('P', next);
          fieldingStrategic.currentPitcher = next;
          strategicLog.push({
            inning, half, abIndex,
            type: 'pitching-change',
            detail: `Pitching change: ${next.lastName} enters`,
            team: defensiveTeamTag,
          });
        }
      }

      // Update fielder entities with current pitcher
      const pitcherFielder = currentFielders.find(f => f.position === 'P');
      if (pitcherFielder) {
        pitcherFielder.playerId = currentPitcher.id;
        pitcherFielder.jerseyNumber = currentPitcher.jerseyNumber ?? 0;
        pitcherFielder.speedFps = sprintFtPerSec(currentPitcher.skills.speed);
        pitcherFielder.agility = currentPitcher.skills.ag ?? 5;
        pitcherFielder.turnRateRad = turnRateFromAg(currentPitcher.skills.ag ?? 5);
        pitcherFielder.throwVeloFps = throwVelocityMph('P', currentPitcher.skills.throwing ?? 5) * MPH_TO_FPS;
        pitcherFielder.throwingSkill = currentPitcher.skills.throwing ?? 5;
        pitcherFielder.defense = currentPitcher.skills.fielding ?? 5;
        pitcherFielder.playIntelligence = currentPitcher.skills.playIntelligence ?? 5;
      }

      // Emit inning change snapshot
      allSnapshots.push({
        time: timeOffset,
        ball: { pos: { x: 0, y: 61, z: 5 }, state: { type: 'idle' }, bounceCount: 0 },
        fielders: currentFielders,
        runners: [],
        events: [{ type: 'inning-change', inning, half }],
        gameState: {
          inning, half, outs: 0,
          homeScore, awayScore,
          basesOccupied: { first: false, second: false, third: false },
          batter: '', pitcher: '',
          abIndex,
          homeName: homeTeam.name, awayName: awayTeam.name,
          homeAbbrev: homeTeam.abbrev, awayAbbrev: awayTeam.abbrev,
        },
      });
      timeOffset += 1;

      let outs = 0;
      let runnersOnBase: { player: Player; base: 'first' | 'second' | 'third' }[] = [];
      let pitchCount = 0;

      // ── HALF-INNING LOOP (tick-engine authority) ────────────────
      while (outs < 3) {
        if (maxABs > 0 && abIndex >= maxABs) break;

        // Get next batter from lineup
        const battingIdx = isHomeBatting ? homeBattingIdx : awayBattingIdx;
        const batter = battingTeam.lineup[battingIdx % battingTeam.lineup.length];
        if (isHomeBatting) homeBattingIdx++; else awayBattingIdx++;

        // Generate at-bat inputs via sim-engine
        const ab = simulateAtBat(batter, currentPitcher, {
          inning, half, outs,
          defense: defenseMap,
          pitcherPitchCount: pitcherState.pitchCount,
        }, rng);

        // Update pitch count tracking
        pitcherState.pitchCount += ab.pitches.length;
        pitcherState.battersFaced++;
        pitchCount += ab.pitches.length;
        totalPitchCount += ab.pitches.length;
        fieldingStrategic.pitchCount += ab.pitches.length;

        // Keep strategic context current
        homeStrategic.score = { us: homeScore, them: awayScore };
        awayStrategic.score = { us: awayScore, them: homeScore };
        homeStrategic.inning = inning;
        awayStrategic.inning = inning;
        homeStrategic.half = half;
        awayStrategic.half = half;

        const i = abIndex;

    // ── Inning/half already managed by outer loop ─────────────
    // ab is already generated above via simulateAtBat()
    // ab.inning/half/outs are set by the AtBatContext we passed in

    // ── Pre-AB tactical decisions ────────────────────
    // isHomeBatting, defensiveTeamTag, defenseMap, battingTeamColor,
    // fieldingTeamColor, defensiveProfile, offensiveProfile are all
    // defined in the outer half-inning loop.
    const teamColor = fieldingTeamColor;  // defensive team's color for fielder sprites

    const situation: GameSituation = {
      outs,
      inning,
      half,
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
          inning,
          half,
          abIndex: i,
          type: 'defensive-shift',
          detail: alignment.description,
          team: defensiveTeamTag,
        });
      }
    }

    const batterName = playerTag(ab.batter);
    const pitcherPlayer = currentPitcher;

    const pitcherName = playerTag(pitcherPlayer);

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
      inning,
      half,
      outs,
      homeScore,
      awayScore,
      homeName: homeTeam.name,
      awayName: awayTeam.name,
      bases: runnersOnBase.map(r => r.base),
    };

    // Skip non-batted-ball at-bats for the tick engine (walks, strikeouts, HBP)
    if (!ab.battedBall) {
      // Update pitch count
      pitchCount += ab.pitches.length;
      fieldingStrategic.pitchCount += ab.pitches.length;

      const gsBase: import('./entities').GameState = {
        inning, half, outs,
        homeScore, awayScore,
        basesOccupied: {
          first: runnersOnBase.some(r => r.base === 'first'),
          second: runnersOnBase.some(r => r.base === 'second'),
          third: runnersOnBase.some(r => r.base === 'third'),
        },
        batter: batterName, pitcher: pitcherName, abIndex: i,
        homeName: homeTeam.name, awayName: awayTeam.name,
          homeAbbrev: homeTeam.abbrev, awayAbbrev: awayTeam.abbrev,
      };
      const pitchRunners = buildPitchRunners(runnersOnBase, ab.batter, battingTeamColor);

      let abOuts = outs;
      let abEndedEarly = false;

      for (let pi = 0; pi < ab.pitches.length; pi++) {
        const p = ab.pitches[pi];
        const isFirst = pi === 0;
        const isLast = pi === ab.pitches.length - 1;

        const pitchEvents: import('./entities').TickEvent[] = [];
        if (isFirst) pitchEvents.push(abStartEvent);

        // Pre-pitch baserunning: pickoff, steal, WP/PB
        const prePitch = processPrePitchBaserunning({
          runnersOnBase,
          pitcherPlayer,
          batterPlayer: ab.batter,
          defenseMap,
          situation,
          balls: p.balls,
          strikes: p.strikes,
          pitchIntent: p.intentZone,
          offensiveProfile,
        });
        pitchEvents.push(...prePitch.events);

        // Track SB/CS stats via accumulator
        for (const su of prePitch.statUpdates) {
          if (su.sb) for (let i = 0; i < su.sb; i++) acc.recordStealAttempt(su.playerId, true);
          if (su.cs) for (let i = 0; i < su.cs; i++) acc.recordStealAttempt(su.playerId, false);
        }

        // Apply state changes (runner advancement, outs)
        const ppResult = applyPrePitchResults(prePitch, runnersOnBase, abOuts);
        if (isHomeBatting) homeScore += ppResult.runsScored;
        else awayScore += ppResult.runsScored;
        abOuts += prePitch.outsAdded;
        outs += prePitch.outsAdded;
        const ended = ppResult.ended;

        if (ended) {
          pitchEvents.push({ type: 'play-complete' });
          abEndedEarly = true;
        }

        pitchEvents.push(...buildPitchTickEvents(p, pitcherPlayer, ab.batter, pitchCount));

        if (isLast && !abEndedEarly) {
          pitchEvents.push({ type: 'at-bat-end', result: ab.result, batterId: ab.batter.id, batterName, rbis: ab.rbis });
        }

        timeOffset = emitPitchSnapshots(
          allSnapshots, timeOffset, currentFielders, pitchEvents,
          isFirst ? gsBase : undefined,
          pitchRunners,
          p.mph,
        );

        if (abEndedEarly) break;
      }

      timeOffset += 0.5;  // brief pause after at-bat

      // For walks/HBP, animate the batter jogging to first base
      // and any forced runners advancing
      if (ab.result === 'walk' || ab.result === 'hbp') {
        const JOG_SPEED_FPS = 14; // casual jog — reaches 1B in ~6.5 sec
        const JOG_DT = 1 / 15;    // 15 fps for jog animation
        const JOG_MAX_SECS = 8;   // enough time to cover 90 ft at jog pace

        // Build runner entities with the batter starting at home
        const jogRunners: RunnerEntity[] = runnersOnBase.map((r): RunnerEntity => {
          const pos = getRunnerOnBasePoint(r.base);
          return {
            id: r.player.id,
            pos: { ...pos },
            state: { type: 'on-base', base: r.base },
            speedFps: JOG_SPEED_FPS,
            agility: 5,
            playIntelligence: 5,
            facingRad: facingToPoint(pos, BASE_POS.home),
            turnRateRad: 4,
            teamColor: battingTeamColor,
          };
        });

        // Batter starts at home plate
        const batterStart = { x: ab.batter.hand === 'L' ? 3 : -3, y: 0 };
        const batterJogger: RunnerEntity = {
          id: ab.batter.id,
          pos: { ...batterStart },
          state: { type: 'running', from: { ...batterStart }, to: BASE_POS.first },
          speedFps: JOG_SPEED_FPS,
          agility: 5,
          playIntelligence: 5,
          facingRad: facingToPoint(batterStart, BASE_POS.first),
          turnRateRad: 4,
          teamColor: battingTeamColor,
        };
        jogRunners.push(batterJogger);

        // Force runners ahead of the batter to advance (walk forces)
        const hasR1 = runnersOnBase.some(r => r.base === 'first');
        const hasR2 = runnersOnBase.some(r => r.base === 'second');
        for (const jr of jogRunners) {
          if (jr.id === ab.batter.id) continue;
          if (jr.state.type !== 'on-base') continue;
          // Walk forces: R1 must advance if batter takes first
          // R2 must advance if R1 was forced, etc.
          if (jr.state.base === 'first') {
            commandRunner(jr, { type: 'advance', targetBase: 'second' });
            jr.speedFps = JOG_SPEED_FPS;
          } else if (jr.state.base === 'second' && hasR1) {
            commandRunner(jr, { type: 'advance', targetBase: 'third' });
            jr.speedFps = JOG_SPEED_FPS;
          } else if (jr.state.base === 'third' && hasR1 && hasR2) {
            commandRunner(jr, { type: 'advance', targetBase: 'home' });
            jr.speedFps = JOG_SPEED_FPS;
          }
        }

        // Simulate jog animation
        let jogTime = 0;
        let jogFrame = 0;
        while (jogTime < JOG_MAX_SECS) {
          for (const jr of jogRunners) {
            tickRunner(jr, JOG_DT);
          }
          jogTime += JOG_DT;
          jogFrame++;

          // Capture every other frame (7.5 fps output)
          if (jogFrame % 2 === 0) {
            allSnapshots.push({
              time: timeOffset + jogTime,
              ball: { pos: { x: 0, y: 61, z: 5 }, state: { type: 'idle' }, bounceCount: 0 },
              fielders: currentFielders,
              runners: cloneRunnersForSnapshot(jogRunners.filter(r => r.state.type !== 'scored')),
              events: [],
            });
          }

          // Stop when the batter reaches first
          if (batterJogger.state.type === 'on-base' || batterJogger.state.type === 'scored') break;
        }
        timeOffset += jogTime;
      }

      // Save runners BEFORE state update so we can identify who scored
      const preUpdateRunners = [...runnersOnBase];

      const stateUpdate = updateGameState(ab, runnersOnBase, outs);
      runnersOnBase = stateUpdate.runners;
      outs = stateUpdate.outs;
      homeScore += isHomeBatting ? ab.runsScored : 0;
      awayScore += isHomeBatting ? 0 : ab.runsScored;

      // ── STATS for non-batted-ball ABs (K, BB, HBP) ──────────────
      // Delegated to StatsAccumulator to avoid stat bugs from `continue`.
      const postRunnerIds = new Set(runnersOnBase.map(r => r.player.id));
      postRunnerIds.add(ab.batter.id); // batter is now on base
      acc.recordNonBattedBallAB(
        ab,
        currentPitcher.id,
        ab.runsScored,
        preUpdateRunners.map(r => r.player.id),
        postRunnerIds,
      );

      // Push the at-bat record so the box score includes this AB
      atBatRecords.push({
        ...ab,
        result: ab.result,
        runsScored: ab.runsScored,
        rbis: ab.runsScored,
      });

      totalInningsPlayed = inning;
      abIndex++;

      // Emit post-AB HUD update so the scoreboard reflects runs scored / outs
      allSnapshots.push({
        time: timeOffset,
        ball: { pos: { x: 0, y: 61, z: 5 }, state: { type: 'idle' }, bounceCount: 0 },
        fielders: currentFielders,
        runners: cloneRunnersForSnapshot(
          buildPitchRunners(runnersOnBase, undefined, battingTeamColor),
        ),
        events: [],
        gameState: {
          inning,
          half,
          outs,
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
          homeName: homeTeam.name, awayName: awayTeam.name,
          homeAbbrev: homeTeam.abbrev, awayAbbrev: awayTeam.abbrev,
        },
      });
      timeOffset += 0.5;
      continue;
    }

    // Build game state for HUD overlay (needed by both pre-contact pitches and tick snapshots)
    const gameState: import('./entities').GameState = {
      inning,
      half,
      outs,
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
      homeName: homeTeam.name, awayName: awayTeam.name,
          homeAbbrev: homeTeam.abbrev, awayAbbrev: awayTeam.abbrev,
    };

    // ── Pre-contact pitches (count buildup) ────────────
    // Animate each pitch before the final contact pitch.
    const preContactPitches = ab.pitches.slice(0, -1);
    const pitchRunners = buildPitchRunners(runnersOnBase, ab.batter, battingTeamColor);


    for (let pi = 0; pi < preContactPitches.length; pi++) {
      const p = preContactPitches[pi];
      const isFirst = pi === 0;

      const pitchEvents: import('./entities').TickEvent[] = [];
      if (isFirst) pitchEvents.push(abStartEvent);

      // Pre-pitch baserunning: pickoff, steal, WP/PB
      const prePitch = processPrePitchBaserunning({
        runnersOnBase,
        pitcherPlayer,
        batterPlayer: ab.batter,
        defenseMap,
        situation,
        balls: p.balls,
        strikes: p.strikes,
        pitchIntent: p.intentZone,
        offensiveProfile,
      });
      pitchEvents.push(...prePitch.events);

      // Track SB/CS stats via accumulator
      for (const su of prePitch.statUpdates) {
        if (su.sb) for (let i = 0; i < su.sb; i++) acc.recordStealAttempt(su.playerId, true);
        if (su.cs) for (let i = 0; i < su.cs; i++) acc.recordStealAttempt(su.playerId, false);
      }

      // Apply state changes
      const ppResult2 = applyPrePitchResults(prePitch, runnersOnBase, outs);
      if (isHomeBatting) homeScore += ppResult2.runsScored;
      else awayScore += ppResult2.runsScored;
      outs += prePitch.outsAdded;

      pitchEvents.push(...buildPitchTickEvents(p, pitcherPlayer, ab.batter, pitchCount));

      timeOffset = emitPitchSnapshots(
        allSnapshots, timeOffset, currentFielders, pitchEvents,
        isFirst ? gameState : undefined,
        pitchRunners,
        p.mph,
      );
    }

    // ── Tick simulation (contact pitch + fielding) ───
    const abSnapshots = simulateAtBatTick(ab, defenseMap, teamColor, {
      ...opts,
      runners: runnersOnBase,
      situation,
      errorType: ab.errorType,
      errorBy: ab.fielding?.errorBy,
      battingTeamColor,
    });

    // Inject the CONTACT PITCH's PBP events into the tick engine's first snapshot
    // so every pitch shows in the play-by-play, including the one that was hit.
    if (abSnapshots.length > 0) {
      const contactPitch = ab.pitches[ab.pitches.length - 1];
      const contactPitchEvents = buildPitchTickEvents(contactPitch, pitcherPlayer, ab.batter, pitchCount);

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

    // ── HR TROT CONTINUATION ───────────────────────────────────────
    // The tick engine caps at MAX_PLAY_SECS (8s), but a home run trot
    // takes ~15-20s. Extend the simulation by jogging any remaining
    // runners (including the batter) around the bases to home.
    if (ab.battedBall?.isHomeRun && abSnapshots.length > 0) {
      const lastTick = abSnapshots[abSnapshots.length - 1];
      const HR_JOG_FPS = 18;   // HR trot pace — relaxed but visible
      const HR_JOG_DT = 1 / 15;
      const HR_JOG_MAX = 20;   // enough for a full lap around the diamond

      // Build jog runners from the last snapshot's runner positions
      const jogRunners: RunnerEntity[] = lastTick.runners
        .filter(r => r.state.type !== 'scored' && r.state.type !== 'out')
        .map(r => ({
          id: r.id,
          pos: { ...r.pos },
          state: r.state.type === 'on-base'
            ? { type: 'on-base' as const, base: r.state.base }
            : r.state.type === 'running'
              ? { type: 'running' as const, from: { ...r.state.from }, to: { ...r.state.to } }
              : r.state,
          speedFps: HR_JOG_FPS,
          agility: 5,
          playIntelligence: 5,
          facingRad: r.facingRad,
          turnRateRad: 4,
          teamColor: battingTeamColor,
        }));

      // Command all on-base runners to advance to next base
      for (const r of jogRunners) {
        if (r.state.type === 'on-base') {
          commandRunner(r, { type: 'advance', targetBase: nextBase(r.state.base) });
        }
      }

      // Run the jog loop until all runners have scored
      let jogTime = 0;
      let jogFrame = 0;
      const jogStartTime = lastTick.time;
      const hrScoredEmitted = new Set<number>();
      while (jogTime < HR_JOG_MAX) {
        for (const jr of jogRunners) {
          const result = tickRunner(jr, HR_JOG_DT);
          // When a runner arrives at a base, command to next base (HR trot)
          if (result.arrivedAtBase && jr.state.type === 'on-base') {
            commandRunner(jr, { type: 'advance', targetBase: nextBase(jr.state.base) });
          }
        }
        jogTime += HR_JOG_DT;
        jogFrame++;

        // Capture every other frame (7.5 fps)
        if (jogFrame % 2 === 0) {
          // Include ALL runners in snapshot (scored runners stay visible
          // at home plate so the trot looks correct — they don't vanish)
          const snapshotRunners = jogRunners.map(r => {
            if (r.state.type === 'scored') {
              // Show scored runners standing at home plate
              return { ...r, pos: { x: 0, y: 0 } };
            }
            return r;
          });
          // Emit runner-scored events for runners who just scored this frame
          const frameEvents: import('./entities').TickEvent[] = [];
          for (const jr of jogRunners) {
            if (jr.state.type === 'scored' && !hrScoredEmitted.has(jr.id)) {
              frameEvents.push({ type: 'runner-scored', runnerId: jr.id });
              frameEvents.push({ type: 'runner-safe', runnerId: jr.id, base: 'home' });
              hrScoredEmitted.add(jr.id);
            }
          }

          abSnapshots.push({
            time: jogStartTime + jogTime,
            ball: { pos: { x: 0, y: 200, z: 0 }, state: { type: 'idle' }, bounceCount: 0 },
            fielders: currentFielders,
            runners: cloneRunnersForSnapshot(snapshotRunners),
            events: frameEvents,
          });
        }

        // Done when all runners have scored
        if (jogRunners.every(r => r.state.type === 'scored')) break;
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

    // ── TICK-ENGINE IS THE SINGLE SOURCE OF TRUTH ────────────────
    // Extract the authoritative outcome from the SAME snapshots used
    // for visual playback. No second run, no band-aids — one run,
    // one truth. The tick-engine's physics determines hit vs out.
    let tickResult = ab.result;   // fallback for non-batted-ball ABs
    let tickRunsScored = ab.runsScored;
    let tickOutsRecorded = 0;
    let tickRunnersAfter: { runnerId: number; base: 'first' | 'second' | 'third' }[] | null = null;
    if (ab.battedBall && abSnapshots.length > 0) {
      const tickOutcome = extractTickOutcome(
        abSnapshots, ab.batter.id, ab.battedBall, runnersOnBase, outs,
      );
      tickResult = tickOutcome.outcome;
      tickRunsScored = tickOutcome.statDeltas.runsScored;
      tickOutsRecorded = tickOutcome.statDeltas.outsRecorded;
      tickRunnersAfter = tickOutcome.runnersAfter;
    }

    // Inject at-bat-end into the last snapshot's events
    if (abSnapshots.length > 0) {
      const lastSnap = abSnapshots[abSnapshots.length - 1];
      lastSnap.events = [
        ...lastSnap.events.filter(e => e.type !== 'play-complete'),
        { type: 'at-bat-end', result: tickResult, batterId: ab.batter.id, batterName, rbis: tickRunsScored, fieldedBy: fieldedByLabel },
        { type: 'play-complete' },
      ];
    }

    // Offset timestamps for continuous playback
    // Stamp gameState on EVERY snapshot so the HUD always has current data
    // regardless of which snapshot the binary search lands on.
    for (let si = 0; si < abSnapshots.length; si++) {
      const snap = abSnapshots[si];
      snap.time += timeOffset;
      snap.gameState = gameState;
      allSnapshots.push(snap);
    }

    if (abSnapshots.length > 0) {
      timeOffset = abSnapshots[abSnapshots.length - 1].time;
    }

    // Update pitch count
    pitchCount += ab.pitches.length;
    fieldingStrategic.pitchCount += ab.pitches.length;

    // ── Update game state ─────────────────────────────────────────
    // For batted-ball plays, use the tick-engine's authoritative runner
    // positions. For non-batted-ball ABs (K, BB, HBP), use the static
    // heuristic since there's no physics simulation.
    if (tickRunnersAfter) {
      // Build a player lookup from current + batter for runnerId → Player mapping
      const playerById = new Map<number, Player>();
      for (const r of runnersOnBase) playerById.set(r.player.id, r.player);
      playerById.set(ab.batter.id, ab.batter);

      runnersOnBase = tickRunnersAfter
        .map(r => {
          const player = playerById.get(r.runnerId);
          return player ? { player, base: r.base } : null;
        })
        .filter((r): r is { player: Player; base: 'first' | 'second' | 'third' } => r !== null);
      outs += tickOutsRecorded;
      outs = Math.min(3, outs);  // clamp: can't exceed 3 outs per half-inning
    } else {
      const stateUpdate = updateGameState(
        { ...ab, result: tickResult } as AtBatRecord,
        runnersOnBase, outs,
      );
      runnersOnBase = stateUpdate.runners;
      outs = stateUpdate.outs;
    }
    homeScore += isHomeBatting ? tickRunsScored : 0;
    awayScore += isHomeBatting ? 0 : tickRunsScored;

    // ── RECORD STATS ──────────────────────────────────────────────
    // Identify which runners scored this AB (need this for run-charging)
    let scoredRunnerIds: number[] = [];
    if (ab.battedBall && abSnapshots.length > 0) {
      const tickOutcomeStat = extractTickOutcome(
        abSnapshots, ab.batter.id, ab.battedBall, runnersOnBase, outs,
      );
      scoredRunnerIds = tickOutcomeStat.scoredRunnerIds;
    } else if (tickRunsScored > 0 && tickResult === 'home-run') {
      // Solo HR with no snapshots
      scoredRunnerIds = [ab.batter.id, ...runnersOnBase.map(r => r.player.id)];
    } else if (tickRunsScored > 0) {
      // Non-batted-ball run (walk w/ bases loaded, etc.)
      for (const r of runnersOnBase) {
        if (r.base === 'third') {
          scoredRunnerIds = [r.player.id];
          break;
        }
      }
    }

    // ── Stats for batted-ball ABs — delegated to StatsAccumulator ─
    acc.recordBattedBallAB(
      ab,
      currentPitcher.id,
      tickResult,
      tickRunsScored,
      scoredRunnerIds,
      defenseMap,
    );

    // Collect the at-bat record with tick-authoritative result
    atBatRecords.push({
      ...ab,
      result: tickResult,
      runsScored: tickRunsScored,
      rbis: tickRunsScored,
    });

    // Track innings played for the GameResult
    totalInningsPlayed = inning;

    // ── 1-second mound breather ──────────────────────
    // Pitcher gets the ball back, everyone resets — give the game a breath
    const MOUND_PAUSE_SEC = 1.0;
    const breathRunners = buildPitchRunners(runnersOnBase, undefined, battingTeamColor);
    const postAbGameState: import('./entities').GameState = {
      inning,
      half,
      outs,
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
      homeName: homeTeam.name, awayName: awayTeam.name,
          homeAbbrev: homeTeam.abbrev, awayAbbrev: awayTeam.abbrev,
    };
    const idleSnap: WorldSnapshot = {
      time: timeOffset + 0.5,
      ball: { pos: { x: 0, y: 61, z: 5 }, state: { type: 'idle' }, bounceCount: 0 },
      fielders: currentFielders,
      runners: cloneRunnersForSnapshot(breathRunners),
      events: [],
      gameState: postAbGameState,
    };
    allSnapshots.push(idleSnap);
    timeOffset += MOUND_PAUSE_SEC + 0.5;

    // Retroactively stamp the LAST play snapshot with the post-AB state
    // so the HUD updates (outs, score, runners) as soon as the play ends,
    // not just when the breather snapshot is reached.
    const lastPlaySnapIdx = allSnapshots.length - 2; // -1 is the idle snap we just pushed
    if (lastPlaySnapIdx >= 0) {
      allSnapshots[lastPlaySnapIdx].gameState = postAbGameState;
    }

    abIndex++;

    // Mid-inning pitching change check
    if (outs < 3) {
      const midScoreDiff = isHomeBatting
        ? awayScore - homeScore
        : homeScore - awayScore;
      if (shouldPullPitcher(pitcherState, fieldingTeam, inning, midScoreDiff)) {
        const next = pickReliever(fieldingTeam, pitcherState.bullpenUsed, inning, midScoreDiff);
        if (next) {
          pitcherState.bullpenUsed.add(next.id);
          currentPitcher = next;
          pitcherState = {
            pitcherId: next.id, pitchCount: 0, battersFaced: 0,
            runsAllowed: 0, hitsAllowed: 0, isStarter: false,
            bullpenUsed: pitcherState.bullpenUsed,
          };
          defenseMap.set('P', next);
          fieldingStrategic.currentPitcher = next;

          // Update fielder sprite
          const pf = currentFielders.find(f => f.position === 'P');
          if (pf) {
            pf.playerId = next.id;
            pf.jerseyNumber = next.jerseyNumber ?? 0;
            pf.speedFps = sprintFtPerSec(next.skills.speed);
            pf.throwVeloFps = throwVelocityMph('P', next.skills.throwing ?? 5) * MPH_TO_FPS;
            pf.throwingSkill = next.skills.throwing ?? 5;
            pf.defense = next.skills.fielding ?? 5;
            pf.playIntelligence = next.skills.playIntelligence ?? 5;
          }
        }
      }
    }

    // Walk-off detection (bottom of 9+)
    if (isHomeBatting && inning >= 9 && homeScore > awayScore) {
      break;  // walk-off: end the half-inning immediately
    }

      } // end while (outs < 3)

      // Write back pitcher state to team-level tracking
      if (isHomeBatting) {
        awayPitcherState = pitcherState;
        awayCurrentPitcher = currentPitcher;
      } else {
        homePitcherState = pitcherState;
        homeCurrentPitcher = currentPitcher;
      }

      if (maxABs > 0 && abIndex >= maxABs) break;
    } // end for (half)

    // Check if game is over after a full inning (9+)
    if (inning >= 9 && homeScore !== awayScore) break;
    if (maxABs > 0 && abIndex >= maxABs) break;
  } // end for (inning)
  // SB/CS already tracked directly in the accumulator — no flush needed.

  return {
    snapshots: allSnapshots,
    strategicLog,
    totalAtBats: abIndex,
    totalSnapshots: allSnapshots.length,
    totalDurationSec: timeOffset,
    gameResult: acc.toGameResult(homeTeam, awayTeam, totalInningsPlayed, homeScore, awayScore, atBatRecords),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function playerTag(player: Player): string {
  const jersey = player.jerseyNumber > 0 ? player.jerseyNumber : player.id;
  return `#${String(jersey).padStart(2, '0')} ${player.lastName}`;
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

const MPH_TO_FPS = 5280 / 3600;

// ─── Pre-pitch baserunning processor ──────────────────────────────

interface PrePitchContext {
  runnersOnBase: { player: Player; base: 'first' | 'second' | 'third' }[];
  pitcherPlayer: Player;
  batterPlayer: Player;
  defenseMap: Map<Position, Player>;
  situation: GameSituation;
  balls: number;
  strikes: number;
  pitchIntent: 'in' | 'edge' | 'off';
  offensiveProfile: ManagerProfile;
}

interface PrePitchResult {
  events: import('./entities').TickEvent[];
  /** Runners removed due to CS / pickoff out. */
  runnersOut: number[];
  /** Runners that advanced bases (steal success / WP / PB). */
  runnersAdvanced: { runnerId: number; from: string; to: string }[];
  /** Extra outs recorded. */
  outsAdded: number;
  /** If true, a steal/pickoff/WP happened — caller may want to animate. */
  hadAction: boolean;
  /** SB/CS stats to track per player. */
  statUpdates: { playerId: number; sb?: number; cs?: number }[];
  /** If true, a hit-and-run was called on this pitch (runner breaks early). */
  hitAndRun: boolean;
}

/**
 * Process pre-pitch baserunning events: pickoff, steal signal, WP/PB.
 * Called BEFORE every pitch delivery. Mutates nothing — returns events
 * and state changes for the caller to apply.
 */
function processPrePitchBaserunning(ctx: PrePitchContext): PrePitchResult {
  const events: import('./entities').TickEvent[] = [];
  const runnersOut: number[] = [];
  const runnersAdvanced: PrePitchResult['runnersAdvanced'] = [];
  const statUpdates: PrePitchResult['statUpdates'] = [];
  let outsAdded = 0;
  let hadAction = false;
  let hitAndRun = false;

  if (ctx.runnersOnBase.length === 0) {
    return { events, runnersOut, runnersAdvanced, outsAdded, hadAction, statUpdates, hitAndRun };
  }

  const pitcherHand = ctx.pitcherPlayer.hand === 'L' ? 'L' as const : 'R' as const;
  const catcher = ctx.defenseMap.get('C' as Position);
  const catcherTH = catcher?.skills.throwing ?? 5;
  const catcherFLD = catcher?.skills.fielding ?? 5;
  const pitcherName = playerTag(ctx.pitcherPlayer);

  // Build runner info for baserunning functions
  const runnerInfos = ctx.runnersOnBase.map(r => ({
    id: r.player.id,
    base: r.base,
    speedSkill: r.player.skills.speed,
    piSkill: r.player.skills.playIntelligence ?? 5,
    name: playerTag(r.player),
  }));

  // 1. Pickoff attempt
  const pickoff = evaluatePickoff(runnerInfos, pitcherHand);
  if (pickoff) {
    hadAction = true;
    events.push({ type: 'pickoff-attempt', base: pickoff.base, pitcherName });
    if (pickoff.out) {
      events.push({ type: 'pickoff-out', runnerId: pickoff.runnerId, runnerName: pickoff.runnerName, at: pickoff.base });
      runnersOut.push(pickoff.runnerId);
      outsAdded++;
    } else {
      events.push({ type: 'pickoff-safe', runnerId: pickoff.runnerId, runnerName: pickoff.runnerName, at: pickoff.base });
    }
    // After a pickoff attempt, skip steal/WP for this pitch
    return { events, runnersOut, runnersAdvanced, outsAdded, hadAction, statUpdates, hitAndRun };
  }

  // 2. Evaluate steal / hit-and-run signal
  const signal = evaluateSignal(
    // Build minimal RunnerEntity-like objects for evaluateSignal
    ctx.runnersOnBase.map(r => ({
      id: r.player.id,
      pos: { x: 0, y: 0 },
      state: { type: 'on-base' as const, base: r.base },
      speedFps: sprintFtPerSec(r.player.skills.speed),
      agility: r.player.skills.ag ?? 5,
      playIntelligence: r.player.skills.playIntelligence ?? 5,
      facingRad: 0,
      turnRateRad: 4,
      teamColor: 0,
    })),
    {
      power: ctx.batterPlayer.skills.power,
      avg: ctx.batterPlayer.skills.avg,
      speed: ctx.batterPlayer.skills.speed,
      hand: ctx.batterPlayer.hand,
    },
    ctx.situation,
    ctx.balls,
    ctx.strikes,
    pitcherHand,
    ctx.offensiveProfile.stealAggression,
    ctx.offensiveProfile.hitAndRunFreq,
  );

  if (signal.type === 'steal' && signal.stealFrom && signal.stealTo && signal.runner != null) {
    hadAction = true;
    const runnerInfo = runnerInfos.find(r => r.id === signal.runner);
    if (runnerInfo) {
      const result = resolveStealAttempt(
        runnerInfo,
        signal.stealFrom,
        signal.stealTo,
        pitcherHand,
        catcherTH,
      );

      if (result.success) {
        events.push({ type: 'stolen-base', runnerId: result.runnerId, runnerName: result.runnerName, base: result.toBase });
        runnersAdvanced.push({ runnerId: result.runnerId, from: result.fromBase, to: result.toBase });
        statUpdates.push({ playerId: result.runnerId, sb: 1 });
      } else {
        events.push({ type: 'caught-stealing', runnerId: result.runnerId, runnerName: result.runnerName, at: result.toBase });
        runnersOut.push(result.runnerId);
        outsAdded++;
        statUpdates.push({ playerId: result.runnerId, cs: 1 });
      }
    }
  } else if (signal.type === 'hit-and-run' && signal.runner != null) {
    hitAndRun = true;
    const runnerInfo = runnerInfos.find(r => r.id === signal.runner);
    if (runnerInfo) {
      events.push({ type: 'hit-and-run', runnerId: signal.runner, runnerName: runnerInfo.name });
    }
  }

  // 3. Wild pitch / passed ball
  if (!hadAction) {
    const wp = evaluateWildPitchOrPassedBall(
      ctx.pitcherPlayer.skills.eye,
      catcherFLD,
      ctx.pitchIntent,
      runnerInfos,
    );

    if (wp) {
      hadAction = true;
      if (wp.type === 'wild-pitch') {
        events.push({ type: 'wild-pitch', pitcherName });
      } else {
        const catcherName = catcher ? playerTag(catcher) : 'Catcher';
        events.push({ type: 'passed-ball', catcherName });
      }

      for (const adv of wp.advancingRunners) {
        events.push({
          type: 'advanced-on-wild-pitch',
          runnerId: adv.runnerId,
          runnerName: adv.runnerName,
          from: adv.from,
          to: adv.to,
        });
        runnersAdvanced.push(adv);
      }
    }
  }

  return { events, runnersOut, runnersAdvanced, outsAdded, hadAction, statUpdates, hitAndRun };
}

/**
 * Apply pre-pitch results to the mutable runnersOnBase array.
 * Returns { ended: boolean, runsScored: number }.
 */
function applyPrePitchResults(
  prePitch: PrePitchResult,
  runnersOnBase: { player: Player; base: 'first' | 'second' | 'third' }[],
  currentOuts: number,
): { ended: boolean; runsScored: number } {
  let runsScored = 0;

  // Remove runners who were out (CS / pickoff)
  for (const id of prePitch.runnersOut) {
    const idx = runnersOnBase.findIndex(r => r.player.id === id);
    if (idx >= 0) runnersOnBase.splice(idx, 1);
  }

  // Advance runners who moved (steal success / WP / PB)
  for (const adv of prePitch.runnersAdvanced) {
    const runner = runnersOnBase.find(r => r.player.id === adv.runnerId);
    if (runner) {
      if (adv.to === 'home') {
        runnersOnBase.splice(runnersOnBase.indexOf(runner), 1);
        runsScored++;
      } else {
        runner.base = adv.to as 'first' | 'second' | 'third';
      }
    }
  }

  const ended = currentOuts + prePitch.outsAdded >= 3;
  return { ended, runsScored };
}


/** Build rich pitch + pitch-result tick events from a sim-engine PitchEvent. */
function buildPitchTickEvents(
  p: import('@baseballczar/sim-engine').PitchEvent,
  pitcher: Player,
  batter: Player,
  pitchCount: number = 0,
): import('./entities').TickEvent[] {
  const events: import('./entities').TickEvent[] = [];

  // Use the authoritative mph and pitchType from the sim-engine PitchEvent.
  // The sim-engine computes these from pitcher.skills.throwing + fatigue + pitch type.
  const mph = p.mph;

  events.push({
    type: 'pitch',
    pitchNum: p.pitchNum,
    batterId: batter.id,
    batterName: playerTag(batter),
    pitcherId: pitcher.id,
    pitcherName: playerTag(pitcher),
    zone: p.intentZone,
    actualInZone: p.actualInZone,
    speed: p.pitchType,
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
  pitchMph: number = 85,
): number {
  const mound = FIELDER_POSITIONS_FT.P;
  const plate = { x: 0, y: 0 };

  // Compute flight velocity from actual pitch speed (skill-derived)
  const pitchFps = pitchMph * MPH_TO_FPS;
  const dx = plate.x - mound.x;
  const dy = plate.y - mound.y;
  const dist = Math.hypot(dx, dy);  // ~61 ft mound to plate
  const flightTimeSec = dist / pitchFps;  // ~0.44s at 95 mph, ~0.52s at 80 mph
  // Normalize direction vector and scale to pitch speed
  const dirX = dx / dist;
  const dirY = dy / dist;
  const flightVel = { x: dirX * pitchFps, y: dirY * pitchFps, z: -8 };

  // 1. Ball leaves pitcher's hand — events fire here
  snapshots.push({
    time: t,
    ball: { pos: { x: mound.x, y: mound.y, z: 5.5 }, state: { type: 'in-flight', vel: flightVel }, bounceCount: 0 },
    fielders,
    runners: cloneRunnersForSnapshot(runners),
    events,
    gameState,
  });

  // 2. Ball arrives at plate (catcher) — time based on real pitch speed
  const arrivalVel = { x: dirX * pitchFps * 0.15, y: dirY * pitchFps * 0.15, z: -2 };
  snapshots.push({
    time: t + flightTimeSec,
    ball: { pos: { x: plate.x, y: plate.y, z: 3 }, state: { type: 'in-flight', vel: arrivalVel }, bounceCount: 0 },
    fielders,
    runners: cloneRunnersForSnapshot(runners),
    events: [],
  });

  // 3. Ball back in pitcher's glove (idle — hidden)
  const returnDelay = flightTimeSec + 0.35;  // brief pause after catch
  snapshots.push({
    time: t + returnDelay,
    ball: { pos: { x: mound.x, y: mound.y, z: 5 }, state: { type: 'idle' }, bounceCount: 0 },
    fielders,
    runners: cloneRunnersForSnapshot(runners),
    events: [],
  });

  return t + returnDelay + 0.15;  // total pitch cycle
}

/** Build static runner entities for pitch snapshots between balls in play. */
function buildPitchRunners(
  runnersOnBase: { player: Player; base: 'first' | 'second' | 'third' }[],
  batter?: Player,
  teamColor?: number,
): RunnerEntity[] {
  const runners: RunnerEntity[] = runnersOnBase.map((r): RunnerEntity => {
    const pos = getRunnerOnBasePoint(r.base);
    return {
      id: r.player.id,
      pos,
      state: { type: 'on-base', base: r.base },
      speedFps: sprintFtPerSec(r.player.skills.speed),
      agility: r.player.skills.ag,
      playIntelligence: r.player.skills.playIntelligence ?? 5,
      facingRad: facingToPoint(pos, BASE_POS.home),
      turnRateRad: turnRateFromAg(r.player.skills.ag),
      teamColor,
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
    speedFps: sprintFtPerSec(batter.skills.speed),
    agility: batterAg,
    playIntelligence: batter.skills.playIntelligence ?? 5,
    facingRad: facingToPoint(batterStart, FIELDER_POSITIONS_FT.P),
    turnRateRad: turnRateFromAg(batterAg),
    teamColor,
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
    playIntelligence: r.playIntelligence,
    facingRad: r.facingRad,
    turnRateRad: r.turnRateRad,
    teamColor: r.teamColor,
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
      speedFps: sprintFtPerSec(player?.skills.speed ?? 5),
      agility: player?.skills.ag ?? 5,
      facingRad: facingToPoint(home, BASE_POS.home),
      turnRateRad: turnRateFromAg(player?.skills.ag ?? 5),
      throwVeloFps: throwVelocityMph(pos, player?.skills.throwing ?? 5) * MPH_TO_FPS,
      throwingSkill: player?.skills.throwing ?? 5,
      defense: player?.skills.fielding ?? 5,
      playIntelligence: player?.skills.playIntelligence ?? 5,
      playerId: player?.id ?? -1,
      jerseyNumber: player?.jerseyNumber ?? 0,
      teamColor,
    };
  });
}

function buildDefenseMap(team: Team): Map<Position, Player> {
  const map = new Map<Position, Player>();
  // Map each lineup player to their assigned defensive position.
  // DH maps to 'P' in the sim engine (excluded from field defense);
  // the actual pitcher is set separately via defenseMap.set('P', pitcher).
  for (const p of team.lineup) {
    if (p.position !== 'P') {
      map.set(p.position, p);
    }
  }
  // Fallback: if rotation has a starter, seed 'P' so the map is never empty
  if (!map.has('P') && team.rotation.length > 0) {
    map.set('P', team.rotation[0]);
  }
  return map;
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
    case 'base-hit':
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
    case 'hbp': {
      // Walk forcing is a chain: batter→1B forces R1→2B→R2→3B→R3→home.
      // Only runners who are "forced" (no open base behind them) advance.
      const hasR1 = prevRunners.some(r => r.base === 'first');
      const hasR2 = prevRunners.some(r => r.base === 'second');
      const hasR3 = prevRunners.some(r => r.base === 'third');

      for (const r of prevRunners) {
        if (r.base === 'first') {
          // R1 always forced by batter taking 1B
          newRunners.push({ player: r.player, base: 'second' });
        } else if (r.base === 'second' && hasR1) {
          // R2 forced only when R1 was on (chain: batter→1B→R1→2B→R2→3B)
          newRunners.push({ player: r.player, base: 'third' });
        } else if (r.base === 'third' && hasR1 && hasR2) {
          // R3 forced only with bases loaded (chain reaches home)
          // Runner scores — don't add to newRunners
        } else {
          // Not forced — stays put
          newRunners.push(r);
        }
      }
      newRunners.push({ player: ab.batter, base: 'first' });
      break;
    }

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
