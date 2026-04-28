import { AtBatOutcome } from './types';
import type {
  PlayerSkills, PitcherAttributes, GameEvent, GameResult,
} from './types';
import { calculateHitterSkill, calculatePitcherSkill } from './PlayerSkills';
import { resolveAtBat } from './AtBat';
import { pickHitZone } from './HitZone';
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

// ─── Save tracking ──────────────────────────────────────────────
interface PitcherEntryState {
  /** Pitching team's run lead when this pitcher entered (positive = leading). */
  leadAtEntry: number;
  /** Runners on base (0-3) for the opposing team when this pitcher entered. */
  runnersAtEntry: number;
}

// ─── Input types ─────────────────────────────────────────────────

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
  isCloser?: boolean;
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

  // Track pitcher entry state for save calculations
  const hPitcherEntry = new Map<number, PitcherEntryState>();
  const vPitcherEntry = new Map<number, PitcherEntryState>();
  // Starters enter at 0-0, bases empty
  hPitcherEntry.set(home.bullpen[0].playerId, { leadAtEntry: 0, runnersAtEntry: 0 });
  vPitcherEntry.set(visitor.bullpen[0].playerId, { leadAtEntry: 0, runnersAtEntry: 0 });

  // MLB W/L tracking: pitcher of record when their team last assumed the lead.
  // hWinCandidateIdx = home pitcher "in the game" when home last took the lead.
  // vLossCandidateIdx = visitor pitcher on mound when home last took the lead (gave up lead).
  // (Symmetric for visitor leading.)
  let prevLeadIsHome = false;
  let prevLeadIsVisitor = false;
  let hWinCandidateIdx = 0;
  let vWinCandidateIdx = 0;
  let hLossCandidateIdx = 0;
  let vLossCandidateIdx = 0;

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

      // Auto pitch switch: fatigue, closer logic
      const prevHPIdx = hPitchIdx;
      hPitchIdx = maybeSwitchPitcher(hPitchIdx, home.bullpen, pBox, vField.rob, hPitcherStats, inning, hTotals.r > vTotals.r);
      if (hPitchIdx !== prevHPIdx) {
        hPitcherEntry.set(home.bullpen[hPitchIdx].playerId, {
          leadAtEntry: hTotals.r - vTotals.r,
          runnersAtEntry: vField.rob,
        });
        // If home is leading, decide whether to transfer the W candidate.
        // Starter must have ≥5 innings (15 outs) to keep the W; relievers need ≥1 out.
        // If the outgoing pitcher doesn’t qualify, the incoming pitcher inherits candidacy.
        if (hTotals.r > vTotals.r) {
          const outBox = hPitcherStats.get(home.bullpen[prevHPIdx].playerId)!;
          const qualifies = prevHPIdx === 0 ? outBox.om >= 15 : outBox.om >= 1;
          if (!qualifies) hWinCandidateIdx = hPitchIdx;
        }
      }

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
      const topGoAheadPitch = creditRuns(vField, vHitterStats, hPitcherStats, home.bullpen, vTotals, outs, hTotals.r);

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

      // W/L candidate update: check if the lead just changed hands
      { const hl = hTotals.r > vTotals.r, vl = vTotals.r > hTotals.r;
        if (hl && !prevLeadIsHome) { hWinCandidateIdx = hPitchIdx; vLossCandidateIdx = vPitchIdx; }
        if (vl && !prevLeadIsVisitor) {
          vWinCandidateIdx = vPitchIdx;
          // Use the responsible pitcher (who put the go-ahead runner on base), not the current active pitcher
          hLossCandidateIdx = topGoAheadPitch >= 0 ? topGoAheadPitch : hPitchIdx;
        }
        prevLeadIsHome = hl; prevLeadIsVisitor = vl; }

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
        hitZone: pickHitZone(outcome),
      });

      if (vTotals.status || hTotals.status) break;
    }

    addInningScore(board, 'top', inning, vField.innTot.r, 0, vTotals.r, vTotals.hits);

    // ═══ BOTTOM HALF (home bats, visitor pitches) ════════════
    // Skip bottom of 9+ if home already leads
    if (inning >= 9 && hTotals.r > vTotals.r) {
      hTotals.status = true;
      vTotals.status = false;
      finalizeWinLoss(true, home, visitor, hPitcherStats, vPitcherStats, hPitchIdx, vPitchIdx, hPitcherEntry, vPitcherEntry, hWinCandidateIdx, vWinCandidateIdx, hLossCandidateIdx, vLossCandidateIdx);
      break;
    }

    if ((inning < 9) || (inning >= 9 && hTotals.r <= vTotals.r)) {
      const hField = new Field(inning);
      outs = 0;

      for (; outs < 3; hBatIdx = (hBatIdx + 1) % 9) {
        const batter = home.lineup[hBatIdx];
        const pitcher = visitor.bullpen[vPitchIdx];
        const pBox = vPitcherStats.get(pitcher.playerId)!;

        const prevVPIdx = vPitchIdx;
        vPitchIdx = maybeSwitchPitcher(vPitchIdx, visitor.bullpen, pBox, hField.rob, vPitcherStats, inning, vTotals.r > hTotals.r);
        if (vPitchIdx !== prevVPIdx) {
          vPitcherEntry.set(visitor.bullpen[vPitchIdx].playerId, {
            leadAtEntry: vTotals.r - hTotals.r,
            runnersAtEntry: hField.rob,
          });
          // Same W-candidate transfer logic for visitor
          if (vTotals.r > hTotals.r) {
            const outBox = vPitcherStats.get(visitor.bullpen[prevVPIdx].playerId)!;
            const qualifies = prevVPIdx === 0 ? outBox.om >= 15 : outBox.om >= 1;
            if (!qualifies) vWinCandidateIdx = vPitchIdx;
          }
        }

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

        const botGoAheadPitch = creditRuns(hField, hHitterStats, vPitcherStats, visitor.bullpen, hTotals, outs, vTotals.r);

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

        // W/L candidate update: check if the lead just changed hands
        { const hl = hTotals.r > vTotals.r, vl = vTotals.r > hTotals.r;
          if (hl && !prevLeadIsHome) {
            hWinCandidateIdx = hPitchIdx;
            // Use the responsible pitcher (who put the go-ahead runner on base), not the current active pitcher
            vLossCandidateIdx = botGoAheadPitch >= 0 ? botGoAheadPitch : vPitchIdx;
          }
          if (vl && !prevLeadIsVisitor) { vWinCandidateIdx = vPitchIdx; hLossCandidateIdx = hPitchIdx; }
          prevLeadIsHome = hl; prevLeadIsVisitor = vl; }

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
          hitZone: pickHitZone(outcome),
        });

        // Walk-off check: home leads in 9+ inning, outs < 3, not a HR
        if (inning >= 9 && hTotals.r > vTotals.r && outs < 3) {
          hTotals.status = true;
          vTotals.status = false;
          addInningScore(board, 'bottom', inning, hField.innTot.r, 0, hTotals.r, hTotals.hits);
          finalizeWinLoss(true, home, visitor, hPitcherStats, vPitcherStats, hPitchIdx, vPitchIdx, hPitcherEntry, vPitcherEntry, hWinCandidateIdx, vWinCandidateIdx, hLossCandidateIdx, vLossCandidateIdx);
          break;
        }

        if (vTotals.status || hTotals.status) break;
      }

      addInningScore(board, 'bottom', inning, hField.innTot.r, 0, hTotals.r, hTotals.hits);

      // Visitor wins check: 9+ inning, outs=3, visitor leads
      if (inning >= 9 && vTotals.r > hTotals.r && outs === 3) {
        vTotals.status = true;
        hTotals.status = false;
        finalizeWinLoss(false, home, visitor, hPitcherStats, vPitcherStats, hPitchIdx, vPitchIdx, hPitcherEntry, vPitcherEntry, hWinCandidateIdx, vWinCandidateIdx, hLossCandidateIdx, vLossCandidateIdx);
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
  oppRuns: number,
): number { // returns bullpen index of pitcher responsible for go-ahead run, or -1
  let goAheadRespPitch = -1;
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

      // First run that gives the batting team the lead — that pitcher takes the loss
      if (goAheadRespPitch === -1 && teamTotals.r > oppRuns) {
        goAheadRespPitch = runner.respPitch;
      }
    }
  }
  return goAheadRespPitch;
}

/**
 * Auto-switch pitchers when starter is fatigued and runners on base.
 * In late innings (7+), bring in the closer if available and fresh.
 * Translated from TempV_PitchSwitch / TempH_PitchSwitch
 */
function maybeSwitchPitcher(
  currentIdx: number,
  bullpen: BullpenPitcher[],
  currentBox: PitcherBoxLine,
  runnersOnBase: number,
  pitcherStatsMap: Map<number, PitcherBoxLine>,
  inning: number,
  teamLeads: boolean,
): number {
  // Late-game closer logic: bring in the closer in 8th+ inning when team leads
  if (inning >= 8 && teamLeads) {
    const closerIdx = bullpen.findIndex((p) => p.isCloser);
    if (closerIdx !== -1 && closerIdx !== currentIdx) {
      const closerBox = pitcherStatsMap.get(bullpen[closerIdx].playerId);
      if (closerBox && closerBox.bf === 0) {
        closerBox.g = 1;
        return closerIdx;
      }
    }
  }

  if (currentBox.bf >= 30 && runnersOnBase >= 1) {
    // Pick a random reliever (skip starter at idx 0, and skip closer)
    const relieverCandidates = bullpen
      .map((p, i) => i)
      .filter((i) => i !== 0 && i !== currentIdx && !bullpen[i].isCloser);
    if (relieverCandidates.length > 0) {
      const relieverIdx = relieverCandidates[Math.floor(Math.random() * relieverCandidates.length)];
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
  hPitcherEntry: Map<number, PitcherEntryState>,
  vPitcherEntry: Map<number, PitcherEntryState>,
  hWinCandidateIdx: number,
  vWinCandidateIdx: number,
  hLossCandidateIdx: number,
  vLossCandidateIdx: number,
): void {
  const winTeam = homeWon ? home : visitor;
  const loseTeam = homeWon ? visitor : home;
  const winStats = homeWon ? hPitcherStats : vPitcherStats;
  const loseStats = homeWon ? vPitcherStats : hPitcherStats;
  const winEntry = homeWon ? hPitcherEntry : vPitcherEntry;

  // ── Win ─────────────────────────────────────────────────────────────
  // Win candidate = pitcher pitching for the winning team when they last took (or held) the lead,
  // accounting for pitcher switches: the candidacy transfers to the incoming pitcher only when the
  // outgoing pitcher fails to qualify (starter: <15 outs; reliever: <1 out).
  // This means a reliever who records 1 out and then departs while their team leads keeps the W.
  const winCandidateIdx = homeWon ? hWinCandidateIdx : vWinCandidateIdx;
  const winCandidateBox = winStats.get(winTeam.bullpen[winCandidateIdx].playerId)!;
  let winBox: PitcherBoxLine;
  if (winCandidateBox.om >= 1) {
    winBox = winCandidateBox;
  } else {
    // Edge case: candidate recorded 0 outs (e.g. walked first batter then replaced).
    // Scan back from the last pitcher to find the most recent one with ≥1 out.
    const finalPitchIdx = homeWon ? hPitchIdx : vPitchIdx;
    winBox = winCandidateBox; // safe fallback
    for (let i = finalPitchIdx; i >= 0; i--) {
      const box = winStats.get(winTeam.bullpen[i]?.playerId);
      if (box && box.om >= 1) { winBox = box; break; }
    }
  }
  addWin(winBox);

  // CG/SHO still tracked on the starter
  const winStarterBox = winStats.get(winTeam.bullpen[0].playerId)!;
  if (winStarterBox.gs === 1 && winStarterBox.ip >= 9) {
    addCG(winStarterBox);
    if (winStarterBox.r === 0) addSHO(winStarterBox);
  }

  // ── Loss ────────────────────────────────────────────────────────────
  // Loss candidate = pitcher on the mound for the losing team when the winning
  // team scored the run that gave them the lead they never relinquished.
  const lossCandidateIdx = homeWon ? vLossCandidateIdx : hLossCandidateIdx;
  const lossBox = loseStats.get(loseTeam.bullpen[lossCandidateIdx].playerId)!;
  addLoss(lossBox);

  // CG still tracked on the losing starter
  const loseStarterBox = loseStats.get(loseTeam.bullpen[0].playerId)!;
  if (loseStarterBox.gs === 1 && loseStarterBox.ip >= 8) {
    addCG(loseStarterBox);
  }

  // Save: last relief pitcher for winning team, meeting official MLB save criteria.
  // Base requirements: not the starter, pitched at least 1 out (om >= 1), did not earn the win.
  // Plus ONE of:
  //   Cond 1 — entered with a lead of 1-3 runs AND pitched at least 1 full inning (3 outs)
  //   Cond 2 — entered with the tying run on base, at-bat, or on-deck
  //             (lead <= runnersAtEntry + 2, where +1 = batter, +2 = on-deck)
  //   Cond 3 — pitched at least 3 innings (9 outs)
  const lastPitchIdx = homeWon ? hPitchIdx : vPitchIdx;
  if (lastPitchIdx !== 0) {
    const lastPitcher = winTeam.bullpen[lastPitchIdx];
    const saveBox = winStats.get(lastPitcher.playerId);
    if (saveBox && saveBox.om >= 1 && saveBox.w === 0) {
      const entry = winEntry.get(lastPitcher.playerId);
      if (entry) {
        const lead = entry.leadAtEntry;
        const runners = entry.runnersAtEntry;
        const cond1 = lead >= 1 && lead <= 3 && saveBox.om >= 3;
        const cond2 = lead >= 1 && lead <= runners + 2;
        const cond3 = saveBox.om >= 9;
        if (cond1 || cond2 || cond3) {
          addSave(saveBox);
        }
      }
    }
  }
}
