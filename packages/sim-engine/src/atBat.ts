/**
 * At-bat: pitch loop using agents + batted-ball resolution.
 * Returns a complete record of every pitch and the final result.
 */
import type { Player, PitchEvent, AtBatRecord, BattedBall, AtBatResult } from './types';
import type { Position } from './config';
import { CONFIG } from './config';
import {
  pitcherDecideIntent, executePitch, batterDecideSwing, resolvePitch,
} from './agents';
import { rollBattedBall, resolveBattedBall } from './battedBall';
import type { Rng } from './rng';

export interface AtBatContext {
  inning: number;
  half: 'top' | 'bottom';
  outs: number;
  defense: Map<Position, Player>;
  pitcherPitchCount: number;     // for fatigue calc
}

export function simulateAtBat(
  batter: Player,
  pitcher: Player,
  ctx: AtBatContext,
  rng: Rng,
): AtBatRecord {
  let balls = 0;
  let strikes = 0;
  let pitchNum = 0;
  const pitches: PitchEvent[] = [];
  let battedBall: BattedBall | undefined;
  let fieldedBy: Position | undefined;
  let result: AtBatResult | null = null;

  while (pitchNum < CONFIG.pitch.maxPitchesPerAB) {
    pitchNum++;
    const fatigueRatio = Math.max(0, Math.min(1,
      (ctx.pitcherPitchCount + pitchNum - 70) / 50));

    const intent = pitcherDecideIntent(pitcher, balls, strikes, fatigueRatio, rng);
    const exec = executePitch(pitcher, intent, fatigueRatio, rng);

    // HBP check: pitcher missed badly inside (low pitchIntel + fatigue raises chance).
    // Only when intent was 'in' or 'edge' and the pitch is now out of zone (i.e. drifted).
    const hbpChance = CONFIG.pitch.hbpProb
      * (1 + (5 - pitcher.skills.pitchIntel) * 0.10)
      * (1 + fatigueRatio * 0.5);
    if ((intent.zone === 'in' || intent.zone === 'edge')
        && !exec.actualInZone
        && rng.bool(hbpChance)) {
      pitches.push({
        pitchNum, balls, strikes,
        intentZone: intent.zone,
        actualInZone: false,
        swung: false,
        outcome: 'hbp',
      });
      result = 'hbp';
      break;
    }

    const swing = batterDecideSwing(batter, exec, balls, strikes, rng);
    const pitchRes = resolvePitch(pitcher, batter, exec, swing, balls, strikes, rng);

    pitches.push({
      pitchNum,
      balls, strikes,
      intentZone: intent.zone,
      actualInZone: exec.actualInZone,
      swung: swing.swung,
      outcome: pitchRes.outcome === 'in-play' ? 'in-play' : pitchRes.outcome,
    });

    switch (pitchRes.outcome) {
      case 'ball':
        balls++;
        if (balls >= 4) { result = 'walk'; }
        break;
      case 'called-strike':
      case 'swinging-strike':
        strikes++;
        if (strikes >= 3) { result = 'strikeout'; }
        break;
      case 'foul':
        // 2-strike fouls don't add a strike
        if (strikes < 2 || !CONFIG.pitch.twoStrikeFoulRetains) {
          strikes = Math.min(2, strikes + 1);
        }
        break;
      case 'in-play': {
        battedBall = rollBattedBall(batter, pitcher, rng);
        // Foul ball discovered in flight is treated like a foul (not contact out)
        if (battedBall.isFoul) {
          if (strikes < 2) strikes++;
          break;
        }
        const res = resolveBattedBall(battedBall, batter, ctx.defense, rng);
        result = res.result;
        fieldedBy = res.fieldedBy;
        break;
      }
    }
    if (result) break;
  }

  if (!result) {
    // Safety: max pitches reached without resolution → call it a walk
    result = balls >= strikes ? 'walk' : 'strikeout';
  }

  return {
    inning: ctx.inning,
    half: ctx.half,
    outs: ctx.outs,
    batter,
    pitcher,
    pitches,
    result,
    battedBall,
    fieldedBy,
    rbis: 0,
    runsScored: 0,
  };
}
