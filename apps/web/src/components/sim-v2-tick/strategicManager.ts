/**
 * Strategic Manager — Tier 1 AI decisions.
 *
 * Per-game and per-inning level decisions:
 *   - Bullpen management (when to pull the starter, who to bring in)
 *   - Pinch-hit / pinch-run decisions
 *   - Lineup optimization (handedness matchups)
 *   - Mound visit tracking
 *
 * These decisions happen BETWEEN at-bats or between innings,
 * not during live-ball situations (that's Tier 3 Reactive).
 *
 * The strategic manager maintains a persistent game state that
 * tracks pitcher fatigue, bullpen usage, bench availability,
 * and score leverage throughout the entire game.
 */
import type { Player, Team, Skills } from '@baseballczar/sim-engine';
import type { GameSituation } from './aiManager';

// ─── Persistent game state ──────────────────────────────────────

export interface StrategicState {
  /** Current pitcher. */
  currentPitcher: Player;
  /** Pitch count for the current pitcher. */
  pitchCount: number;
  /** Pitchers who have already been used (can't re-enter). */
  usedPitchers: Set<number>;
  /** Bench players still available. */
  availableBench: Player[];
  /** Bullpen arms still available. */
  availableBullpen: Player[];
  /** Number of mound visits used (max 5 per game in MLB). */
  moundVisits: number;
  /** Pinch hitters already used this game. */
  pinchHittersUsed: Set<number>;
  /** Runs scored by each team. */
  score: { us: number; them: number };
  /** Current inning + half. */
  inning: number;
  half: 'top' | 'bottom';
  /** Is this a save situation? */
  isSaveSituation: boolean;
}

/** Initialize strategic state from team roster. */
export function createStrategicState(
  team: Team,
  startingPitcher: Player,
): StrategicState {
  return {
    currentPitcher: startingPitcher,
    pitchCount: 0,
    usedPitchers: new Set([startingPitcher.id]),
    availableBench: [...team.bench],
    availableBullpen: [...team.bullpen],
    moundVisits: 0,
    pinchHittersUsed: new Set(),
    score: { us: 0, them: 0 },
    inning: 1,
    half: 'top',
    isSaveSituation: false,
  };
}

// ─── Bullpen management ──────────────────────────────────────────

export interface PitchingChange {
  remove: Player;
  bring: Player;
  reasoning: string;
  /** Priority: 0 = keep starter, higher = more urgent to change. */
  urgency: number;
}

/**
 * Evaluate whether to pull the current pitcher.
 *
 * Factors:
 *   - Pitch count vs stamina (high-stamina pitchers last longer)
 *   - Recent performance (runs allowed this inning)
 *   - Score differential (protect leads, extend in blowouts)
 *   - Handedness matchup (L/R advantage for upcoming batters)
 *   - Inning (7th+ = bridge, 8th = setup, 9th = closer)
 *   - Save situation detection
 */
export function evaluatePitchingChange(
  state: StrategicState,
  runsAllowedThisInning: number,
  upcomingBatters: Player[],
): PitchingChange | null {
  const pitcher = state.currentPitcher;
  const stamina = pitcher.skills.stamina;
  const pitchIntel = pitcher.skills.eye;

  // Pitch count thresholds by stamina:
  //   Stamina 1 = pull at 60 pitches
  //   Stamina 5 = pull at 85 pitches
  //   Stamina 10 = pull at 110 pitches
  const pitchThreshold = 55 + stamina * 5.5;
  const fatigueRatio = Math.max(0, (state.pitchCount - 70) / 50);

  let urgency = 0;
  const reasons: string[] = [];

  // ── Pitch count ────────────────────────────────
  if (state.pitchCount >= pitchThreshold) {
    urgency += 3;
    reasons.push(`pitch count ${state.pitchCount} (threshold ${pitchThreshold.toFixed(0)})`);
  } else if (state.pitchCount >= pitchThreshold * 0.85) {
    urgency += 1;
    reasons.push(`approaching pitch limit`);
  }

  // ── Fatigue degradation ────────────────────────
  if (fatigueRatio > 0.6) {
    urgency += 2;
    reasons.push(`fatigue ${(fatigueRatio * 100).toFixed(0)}%`);
  }

  // ── Big inning (giving up runs) ────────────────
  if (runsAllowedThisInning >= 3) {
    urgency += 3;
    reasons.push(`${runsAllowedThisInning} runs this inning`);
  } else if (runsAllowedThisInning >= 2) {
    urgency += 1;
    reasons.push(`${runsAllowedThisInning} runs this inning`);
  }

  // ── Late innings with a lead ───────────────────
  const scoreDiff = state.score.us - state.score.them;
  if (state.inning >= 7 && scoreDiff > 0 && scoreDiff <= 3) {
    // Protect the lead — get to the bullpen
    if (state.inning >= 9) {
      urgency += 4;
      reasons.push('9th inning — closer time');
    } else if (state.inning >= 8) {
      urgency += 2;
      reasons.push('8th inning — setup time');
    } else {
      urgency += 1;
      reasons.push('7th inning — bridging');
    }
  }

  // ── Blowout conservation ───────────────────────
  if (Math.abs(scoreDiff) >= 6 && state.pitchCount < pitchThreshold * 0.7) {
    // Don't waste the bullpen in a blowout if the starter can go
    urgency = Math.max(0, urgency - 2);
  }

  // ── Decision ───────────────────────────────────
  if (urgency < 3 || state.availableBullpen.length === 0) {
    return null;  // Keep the starter
  }

  // Pick the best reliever
  const reliever = selectReliever(state, upcomingBatters, scoreDiff);
  if (!reliever) return null;

  return {
    remove: pitcher,
    bring: reliever,
    reasoning: reasons.join(', '),
    urgency,
  };
}

/**
 * Select the best available reliever based on game situation.
 *
 * Matching logic:
 *   - 9th with lead ≤ 3: best closer (highest pitchIntel + defense combo)
 *   - Handedness advantage: prefer same-hand vs upcoming batter
 *   - Fresh arms preferred over recently-used ones
 */
function selectReliever(
  state: StrategicState,
  upcomingBatters: Player[],
  scoreDiff: number,
): Player | null {
  if (state.availableBullpen.length === 0) return null;

  const candidates = state.availableBullpen.map(p => {
    let score = 0;

    // Base quality: pitchIntel + defense combined
    score += p.skills.eye * 1.5 + p.skills.fielding;

    // Closer bonus: best arm for the 9th
    if (state.inning >= 9 && scoreDiff > 0 && scoreDiff <= 3) {
      score += p.skills.eye * 2;  // double weight on closing ability
    }

    // Handedness matchup: same hand as upcoming batter = advantage
    if (upcomingBatters.length > 0) {
      const nextBatter = upcomingBatters[0];
      if (nextBatter.hand === p.hand || nextBatter.hand === 'S') {
        score += 3;  // same-side advantage
      }
    }

    // Stamina bonus for long-relief situations (early/middle innings)
    if (state.inning <= 6) {
      score += p.skills.stamina;  // need someone who can go multiple innings
    }

    return { player: p, score };
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.player ?? null;
}

/** Execute a pitching change — update the strategic state. */
export function executePitchingChange(
  state: StrategicState,
  change: PitchingChange,
): void {
  state.usedPitchers.add(change.bring.id);
  state.availableBullpen = state.availableBullpen.filter(
    p => p.id !== change.bring.id,
  );
  state.currentPitcher = change.bring;
  state.pitchCount = 0;
  state.moundVisits++;
}

// ─── Pinch hit / pinch run ──────────────────────────────────────

export interface PinchDecision {
  type: 'pinch-hit' | 'pinch-run' | 'none';
  remove?: Player;
  substitute?: Player;
  reasoning: string;
}

/**
 * Evaluate whether to use a pinch hitter or pinch runner.
 *
 * Pinch hit:
 *   - Weak batter (avg < 4) in a high-leverage spot
 *   - Pitcher's spot in a close game
 *   - Handedness advantage (switch hitter or opposite-hand)
 *
 * Pinch run:
 *   - Slow runner on base in a tie/close game, late innings
 *   - Speed differential must be meaningful (≥ 3 skill points)
 */
export function evaluatePinchDecision(
  currentBatter: Player,
  runnersOnBase: { player: Player; base: string }[],
  state: StrategicState,
  isPitcherBatting: boolean,
): PinchDecision {
  const scoreDiff = state.score.us - state.score.them;
  const isCloseGame = Math.abs(scoreDiff) <= 2;
  const isLateGame = state.inning >= 7;

  // ── Pinch hit for the pitcher ──────────────────
  if (isPitcherBatting && isCloseGame && state.availableBench.length > 0) {
    const bestBat = findBestPinchHitter(state.availableBench, currentBatter);
    if (bestBat) {
      return {
        type: 'pinch-hit',
        remove: currentBatter,
        substitute: bestBat,
        reasoning: `Pinch hitting for ${currentBatter.lastName} — pitcher's spot, close game`,
      };
    }
  }

  // ── Pinch hit for weak batters in leverage ──────
  if (
    isCloseGame &&
    isLateGame &&
    currentBatter.skills.avg < 4 &&
    state.availableBench.length > 0
  ) {
    const bestBat = findBestPinchHitter(state.availableBench, currentBatter);
    if (bestBat && bestBat.skills.avg > currentBatter.skills.avg + 2) {
      return {
        type: 'pinch-hit',
        remove: currentBatter,
        substitute: bestBat,
        reasoning: `Pinch hitting — weak batter in high leverage (${currentBatter.skills.avg} avg vs ${bestBat.skills.avg})`,
      };
    }
  }

  // ── Pinch run ──────────────────────────────────
  if (isCloseGame && isLateGame && runnersOnBase.length > 0) {
    for (const r of runnersOnBase) {
      if (r.base === 'first' || r.base === 'second') {
        const bestRunner = findBestPinchRunner(state.availableBench, r.player);
        if (bestRunner && bestRunner.skills.speed > r.player.skills.speed + 3) {
          return {
            type: 'pinch-run',
            remove: r.player,
            substitute: bestRunner,
            reasoning: `Pinch running for ${r.player.lastName} — speed upgrade ${r.player.skills.speed}→${bestRunner.skills.speed}`,
          };
        }
      }
    }
  }

  return { type: 'none', reasoning: 'No pinch play warranted' };
}

function findBestPinchHitter(bench: Player[], forBatter: Player): Player | null {
  if (bench.length === 0) return null;

  const rated = bench.map(p => ({
    player: p,
    score: p.skills.avg * 2 + p.skills.power * 1.5 + p.skills.eye,
  }));

  rated.sort((a, b) => b.score - a.score);
  return rated[0]?.player ?? null;
}

function findBestPinchRunner(bench: Player[], forRunner: Player): Player | null {
  if (bench.length === 0) return null;

  const faster = bench
    .filter(p => p.skills.speed > forRunner.skills.speed)
    .sort((a, b) => b.skills.speed - a.skills.speed);

  return faster[0] ?? null;
}

/** Execute a pinch decision — update the strategic state. */
export function executePinchDecision(
  state: StrategicState,
  decision: PinchDecision,
): void {
  if (decision.type === 'none' || !decision.substitute) return;
  state.pinchHittersUsed.add(decision.substitute.id);
  state.availableBench = state.availableBench.filter(
    p => p.id !== decision.substitute!.id,
  );
}

// ─── Lineup optimization ────────────────────────────────────────

export interface LineupAdvice {
  suggestion: string;
  advantage: 'platoon' | 'speed' | 'power' | 'none';
}

/**
 * Provide lineup optimization advice based on opponent pitcher.
 *
 * MLB platoon advantage:
 *   - RHP → load lefty bats (.020-.030 OBP advantage)
 *   - LHP → load righty bats
 *   - Switch hitters are always neutral
 */
export function analyzeLineupMatchup(
  lineup: Player[],
  opposingPitcher: Player,
): LineupAdvice {
  const pitcherHand = opposingPitcher.hand;
  let platoonAdvantage = 0;
  let disadvantage = 0;

  for (const batter of lineup) {
    if (batter.hand === 'S') continue;  // switch hitters are neutral
    if (
      (pitcherHand === 'R' && batter.hand === 'L') ||
      (pitcherHand === 'L' && batter.hand === 'R')
    ) {
      platoonAdvantage++;
    } else {
      disadvantage++;
    }
  }

  if (platoonAdvantage >= 5) {
    return {
      suggestion: `Strong platoon advantage: ${platoonAdvantage}/9 batters have the opposite hand vs ${pitcherHand}HP`,
      advantage: 'platoon',
    };
  }

  if (disadvantage >= 5) {
    return {
      suggestion: `Platoon disadvantage: ${disadvantage}/9 batters are same-hand as ${pitcherHand}HP — consider bench bats`,
      advantage: 'none',
    };
  }

  return {
    suggestion: `Balanced lineup against ${pitcherHand}HP`,
    advantage: 'none',
  };
}

// ─── Save situation detection ────────────────────────────────────

/**
 * MLB Rule 10.19 — Save situation:
 *   - Pitcher enters with a lead of ≤ 3 runs and pitches at least 1 inning
 *   - Pitcher enters with the tying run on base, at bat, or on deck
 *   - Pitcher pitches at least 3 effective innings
 */
export function isSaveSituation(
  scoreDiff: number,
  inning: number,
  runnersOnBase: number,
): boolean {
  if (scoreDiff <= 0) return false;
  if (inning < 9) return false;

  // Lead of 3 or fewer in the 9th
  if (scoreDiff <= 3) return true;

  // Tying run on base, at bat, or on deck
  const tyingRunDistance = scoreDiff - runnersOnBase;
  if (tyingRunDistance <= 2) return true;

  return false;
}

// ─── Inning transition ──────────────────────────────────────────

export interface InningTransition {
  pitchingChange?: PitchingChange;
  pinchDecisions: PinchDecision[];
  lineupAdvice?: LineupAdvice;
  strategicNotes: string[];
}

/**
 * Make all between-inning strategic decisions.
 * Called at the end of each half-inning before the next one starts.
 */
export function evaluateInningTransition(
  state: StrategicState,
  runsAllowedThisInning: number,
  upcomingBatters: Player[],
  opposingPitcher: Player,
  lineup: Player[],
): InningTransition {
  const result: InningTransition = {
    pinchDecisions: [],
    strategicNotes: [],
  };

  // Evaluate pitching change
  const pitchChange = evaluatePitchingChange(state, runsAllowedThisInning, upcomingBatters);
  if (pitchChange) {
    result.pitchingChange = pitchChange;
    result.strategicNotes.push(`🔄 Pitching change: ${pitchChange.reasoning}`);
  }

  // Lineup analysis
  result.lineupAdvice = analyzeLineupMatchup(lineup, opposingPitcher);
  if (result.lineupAdvice.advantage !== 'none') {
    result.strategicNotes.push(`📊 ${result.lineupAdvice.suggestion}`);
  }

  // Save situation detection
  const scoreDiff = state.score.us - state.score.them;
  if (isSaveSituation(scoreDiff, state.inning, 0)) {
    state.isSaveSituation = true;
    result.strategicNotes.push(`💾 Save situation — ${scoreDiff} run lead in the ${state.inning}th`);
  }

  // Update inning
  if (state.half === 'top') {
    state.half = 'bottom';
  } else {
    state.half = 'top';
    state.inning++;
  }

  return result;
}
