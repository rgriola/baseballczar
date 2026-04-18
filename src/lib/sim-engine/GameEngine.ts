import { AtBatOutcome } from './types';
import type {
  PlayerSkills, PitcherAttributes, GameEvent, GameResult,
} from './types';
import { calculateHitterSkill, calculatePitcherSkill } from './PlayerSkills';
import { resolveAtBat } from './AtBat';
import { Field } from './Field';
import {
  createGameStats, addHitterPA, addRun as addHitterRun,
  createPitcherBoxLine, addPitcherPA, addPitcherER, addPitcherOut,
  addWin, addLoss, addSave, addCG, addSHO,
  createTeamTotals, addTeamHittingStats,
  type TeamTotals,
} from './StatsAccumulator';
import { createScoreBoard, addInningScore } from './ScoreBoard';
import type { GameStats, PitcherBoxLine } from './types';

// ─── Input types ────────────────────────────────────────────────

export interface LineupPlayer {
  playerId: number;
  jerseyNo: number;
  lastName: string;
  skills: PlayerSkills;
}

export interface BullpenPitcher {
  playerId: number;
  jerseyNo: number;
  lastName: string;
  skills: PitcherAttributes;
  isStarter: boolean;
}

export interface TeamInput {
  teamId: number;
  teamName: string;
  lineup: LineupPlayer[];   // 9 starters (index 0-8), bench 9-14 optional
  bullpen: BullpenPitcher[]; // index 0 = starter, 1-9 = bullpen
}

// ─── Engine ─────────────────────────────────────────────────────

export function simulateGame(visitor: TeamInput, home: TeamInput): GameResult {
  const events: GameEvent[] = [];
  const board = createScoreBoard(visitor.teamName, visitor.teamId, home.teamName, home.teamId);

  // Player stats maps keyed by playerId
  const vHitterStats = new Map<number, GameStats>();
  const hHitterStats = new Map<number, GameStats>();
  const vPitcherStats = new Map<number, PitcherBoxLine>();
  const hPitcherStats = new Map<number, PitcherBoxLine>();

  // Initialize stats entries
  for (const p of visitor.lineup) vHitterStats.set(p.playerId, createGameStats());
  for (const p of home.lineup) hHitterStats.set(p.playerId, createGameStats());
  for (const p of visitor.bullpen) vPitcherStats.set(p.playerId, createPitcherBoxLine());
  for (const p of home.bullpen) hPitcherStats.set(p.playerId, createPitcherBoxLine());

  // Team totals
  const vTotals = createTeamTotals();
  const hTotals = createTeamTotals();

  // Lineup cursors (wrap 0-8)
  let vBatIdx = 0;
  let hBatIdx = 0;

  // Active pitcher indices
  let vPitchIdx = 0; // visitor pitcher (pitches to home batters)
  let hPitchIdx = 0; // home pitcher (pitches to visitor batters)

  // Mark starters
  const hPBox = hPitcherStats.get(home.bullpen[hPitchIdx].playerId)!;
  hPBox.g = 1; hPBox.gs = 1;
  const vPBox = vPitcherStats.get(visitor.bullpen[vPitchIdx].playerId)!;
  vPBox.g = 1; vPBox.gs = 1;

  // Mark starting lineup
  for (let i = 0; i < 9; i++) {
    vHitterStats.get(visitor.lineup[i].playerId)!;
    hHitterStats.get(home.lineup[i].playerId)!;
  }

  let inning = 1;

  // ─── Main game loop ──────────────────────────────────────────
  do {
    // ═══ TOP HALF (visitor bats, home pitches) ═══════════════
    const vField = new Field(inning);
    let outs = 0;

    for (; outs < 3; vBatIdx = (vBatIdx + 1) % 9) {
      const batter = visitor.lineup[vBatIdx];
      const pitcher = home.bullpen[hPitchIdx];
      const pBox = hPitcherStats.get(pitcher.playerId)!;

      // Auto pitch switch: if BF >= 30 and runners on base
      hPitchIdx = maybeSwitchPitcher(hPitchIdx, home.bullpen, pBox, vField.rob, hPitcherStats);

      const activePitcher = home.bullpen[hPitchIdx];
      const activePBox = hPitcherStats.get(activePitcher.playerId)!;

      vField.setBatter(hPitchIdx, vBatIdx, batter.playerId, batter.jerseyNo, batter.lastName, batter.skills.speed);
      activePBox.bf++;

      const hitterThr = calculateHitterSkill(batter.skills);
      const pitcherThr = calculatePitcherSkill(activePitcher.skills, activePBox.bf);

      const { outcome } = resolveAtBat(hitterThr, pitcherThr);
      const plays = vField.baseSequence(outcome);

      // Credit outs to pitcher
      if (outcome === AtBatOutcome.GroundOut || outcome === AtBatOutcome.Strikeout) {
        addPitcherOut(activePBox);
      }

      // Credit runs scored by runners
      creditRuns(vField, vHitterStats, hPitcherStats, home.bullpen, vTotals, outs);

      // HR: batter run + pitcher ER always to current pitcher
      if (outcome === AtBatOutcome.HomeRun) {
        const bStats = vHitterStats.get(batter.playerId)!;
        addHitterRun(bStats);
        addPitcherER(activePBox);
        vField.plateApp.r++;
        vField.innTot.r++;
        vTotals.r++;
      }

      // Credit per-PA stats
      const bStats = vHitterStats.get(batter.playerId)!;
      addHitterPA(bStats, vField.plateApp);
      addPitcherPA(activePBox, vField.plateApp);
      addTeamHittingStats(vTotals, vField.plateApp);

      outs = vField.outsRef;

      // Record event
      events.push({
        inning, half: 'top', outs,
        batterName: batter.lastName,
        pitcherName: activePitcher.lastName,
        outcome,
        description: plays.join('. '),
        visitorRuns: vTotals.r, homeRuns: hTotals.r,
        visitorHits: vTotals.hits, homeHits: hTotals.hits,
        runnersScored: plays.filter(p => p.includes('scores')),
      });

      if (vTotals.status || hTotals.status) break;
    }

    addInningScore(board, 'top', inning, vField.innTot.r, 0, vTotals.r, vTotals.hits);

    // ═══ BOTTOM HALF (home bats, visitor pitches) ════════════
    // Skip bottom of 9+ if home already leads
    if (inning >= 9 && hTotals.r > vTotals.r) {
      hTotals.status = true;
      vTotals.status = false;
      finalizeWinLoss(true, home, visitor, hPitcherStats, vPitcherStats, hPitchIdx, vPitchIdx);
      break;
    }

    if ((inning < 9) || (inning >= 9 && hTotals.r <= vTotals.r)) {
      const hField = new Field(inning);
      outs = 0;

      for (; outs < 3; hBatIdx = (hBatIdx + 1) % 9) {
        const batter = home.lineup[hBatIdx];
        const pitcher = visitor.bullpen[vPitchIdx];
        const pBox = vPitcherStats.get(pitcher.playerId)!;

        vPitchIdx = maybeSwitchPitcher(vPitchIdx, visitor.bullpen, pBox, hField.rob, vPitcherStats);

        const activePitcher = visitor.bullpen[vPitchIdx];
        const activePBox = vPitcherStats.get(activePitcher.playerId)!;

        hField.setBatter(vPitchIdx, hBatIdx, batter.playerId, batter.jerseyNo, batter.lastName, batter.skills.speed);
        activePBox.bf++;

        const hitterThr = calculateHitterSkill(batter.skills);
        const pitcherThr = calculatePitcherSkill(activePitcher.skills, activePBox.bf);

        const { outcome } = resolveAtBat(hitterThr, pitcherThr);
        const plays = hField.baseSequence(outcome);

        if (outcome === AtBatOutcome.GroundOut || outcome === AtBatOutcome.Strikeout) {
          addPitcherOut(activePBox);
        }

        creditRuns(hField, hHitterStats, vPitcherStats, visitor.bullpen, hTotals, outs);

        if (outcome === AtBatOutcome.HomeRun) {
          const bStats = hHitterStats.get(batter.playerId)!;
          addHitterRun(bStats);
          addPitcherER(activePBox);
          hField.plateApp.r++;
          hField.innTot.r++;
          hTotals.r++;
        }

        const bStats = hHitterStats.get(batter.playerId)!;
        addHitterPA(bStats, hField.plateApp);
        addPitcherPA(activePBox, hField.plateApp);
        addTeamHittingStats(hTotals, hField.plateApp);

        outs = hField.outsRef;

        events.push({
          inning, half: 'bottom', outs,
          batterName: batter.lastName,
          pitcherName: activePitcher.lastName,
          outcome,
          description: plays.join('. '),
          visitorRuns: vTotals.r, homeRuns: hTotals.r,
          visitorHits: vTotals.hits, homeHits: hTotals.hits,
          runnersScored: plays.filter(p => p.includes('scores')),
        });

        // Walk-off check: home leads in 9+ inning, outs < 3, not a HR
        if (inning >= 9 && hTotals.r > vTotals.r && outs < 3) {
          hTotals.status = true;
          vTotals.status = false;
          addInningScore(board, 'bottom', inning, hField.innTot.r, 0, hTotals.r, hTotals.hits);
          finalizeWinLoss(true, home, visitor, hPitcherStats, vPitcherStats, hPitchIdx, vPitchIdx);
          break;
        }

        if (vTotals.status || hTotals.status) break;
      }

      addInningScore(board, 'bottom', inning, hField.innTot.r, 0, hTotals.r, hTotals.hits);

      // Visitor wins check: 9+ inning, outs=3, visitor leads
      if (inning >= 9 && vTotals.r > hTotals.r && outs === 3) {
        vTotals.status = true;
        hTotals.status = false;
        finalizeWinLoss(false, home, visitor, hPitcherStats, vPitcherStats, hPitchIdx, vPitchIdx);
      }
    }

    inning++;
  } while (!vTotals.status && !hTotals.status);

  const homeWon = hTotals.status;

  return {
    homeTeamId: home.teamId,
    visitorTeamId: visitor.teamId,
    homeRuns: hTotals.r,
    visitorRuns: vTotals.r,
    homeHits: hTotals.hits,
    visitorHits: vTotals.hits,
    innings: inning,
    winningTeamId: homeWon ? home.teamId : visitor.teamId,
    losingTeamId: homeWon ? visitor.teamId : home.teamId,
    events,
    scoreBoard: board,
    homePlayerStats: hHitterStats,
    visitorPlayerStats: vHitterStats,
    homePitcherStats: hPitcherStats,
    visitorPitcherStats: vPitcherStats,
  };
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Credit runs from runners who crossed home (runners[4-6]).
 * Translated from the for(z=6..4) loops in BBCzar_1_5.java
 */
function creditRuns(
  field: Field,
  hitterStats: Map<number, GameStats>,
  pitcherStats: Map<number, PitcherBoxLine>,
  pitchingBullpen: BullpenPitcher[],
  teamTotals: TeamTotals,
  outs: number,
): void {
  for (let z = 6; z > 3; z--) {
    if (outs === 3) break;
    const runner = field.runners[z];
    if (runner.runs === 1) {
      const hStats = hitterStats.get(runner.playerId);
      if (hStats) addHitterRun(hStats);

      const pBox = pitcherStats.get(pitchingBullpen[runner.respPitch]?.playerId);
      if (pBox) addPitcherER(pBox);

      field.plateApp.r++;
      field.innTot.r++;
      teamTotals.r++;
    }
  }
}

/**
 * Auto-switch pitchers when starter is fatigued and runners on base.
 * Translated from TempV_PitchSwitch / TempH_PitchSwitch
 */
function maybeSwitchPitcher(
  currentIdx: number,
  bullpen: BullpenPitcher[],
  currentBox: PitcherBoxLine,
  runnersOnBase: number,
  pitcherStatsMap: Map<number, PitcherBoxLine>,
): number {
  if (currentBox.bf >= 30 && runnersOnBase >= 1) {
    // Pick a random reliever (index 1-9 in bullpen)
    const relieverIdx = 1 + Math.floor(Math.random() * Math.min(bullpen.length - 1, 9));
    if (relieverIdx < bullpen.length) {
      const relieverBox = pitcherStatsMap.get(bullpen[relieverIdx].playerId);
      if (relieverBox && relieverBox.bf === 0 && relieverBox.gs !== 1) {
        relieverBox.g = 1;
      }
      return relieverIdx;
    }
  }
  return currentIdx;
}

/**
 * Assign W/L/SV/CG/SHO to pitchers after game ends.
 * Simplified from homeWins() / visitorWins() in BBCzar_1_5.java
 */
function finalizeWinLoss(
  homeWon: boolean,
  home: TeamInput,
  visitor: TeamInput,
  hPitcherStats: Map<number, PitcherBoxLine>,
  vPitcherStats: Map<number, PitcherBoxLine>,
  hPitchIdx: number,
  vPitchIdx: number,
): void {
  const winTeam = homeWon ? home : visitor;
  const loseTeam = homeWon ? visitor : home;
  const winStats = homeWon ? hPitcherStats : vPitcherStats;
  const loseStats = homeWon ? vPitcherStats : hPitcherStats;

  // Winning pitcher = starter of winning team (simplified — proper W/L requires WinLoss tracking)
  const winStarterBox = winStats.get(winTeam.bullpen[0].playerId)!;
  addWin(winStarterBox);

  if (winStarterBox.gs === 1 && winStarterBox.ip >= 9) {
    addCG(winStarterBox);
    if (winStarterBox.r === 0) addSHO(winStarterBox);
  }

  // Losing pitcher = starter of losing team
  const loseStarterBox = loseStats.get(loseTeam.bullpen[0].playerId)!;
  addLoss(loseStarterBox);
  if (loseStarterBox.gs === 1 && loseStarterBox.ip >= 8) {
    addCG(loseStarterBox);
  }

  // Save: last pitcher for winning team if different from starter
  const lastPitchIdx = homeWon ? hPitchIdx : vPitchIdx;
  if (lastPitchIdx !== 0) {
    const saveBox = winStats.get(winTeam.bullpen[lastPitchIdx].playerId);
    if (saveBox) addSave(saveBox);
  }
}
