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
import { rollBattedBall, resolveBattedBall, resolveFoulBall } from './battedBall';
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
  let errorType: 'fielding' | 'throw' | undefined;
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

    const pitch: PitchEvent = {
      pitchNum,
      balls, strikes,
      intentZone: intent.zone,
      actualInZone: exec.actualInZone,
      swung: swing.swung,
      outcome: pitchRes.outcome === 'in-play' ? 'in-play' : pitchRes.outcome,
    };
    pitches.push(pitch);

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
      case 'foul': {
        // Even simple fouls have physics now — roll a forced-foul
        // batted ball so the renderer can show the launch + landing,
        // and check whether a fielder can run it down for a foul-out.
        const fb = rollBattedBall(batter, pitcher, rng, { forceFoul: true });
        pitch.battedBall = fb;
        const caught = resolveFoulBall(fb, ctx.defense);
        if (caught) {
          pitch.outcome = 'foul-out';
          pitch.foulCaughtBy = caught.position;
          battedBall = fb;
          fieldedBy = caught.position;
          result = 'foul-out';
          break;
        }
        // Not caught — standard foul behaviour (2-strike fouls don't add).
        if (strikes < 2 || !CONFIG.pitch.twoStrikeFoulRetains) {
          strikes = Math.min(2, strikes + 1);
        }
        break;
      }
      case 'in-play': {
        battedBall = rollBattedBall(batter, pitcher, rng);
        pitch.battedBall = battedBall;
        // Foul ball discovered in flight: try to catch it for a
        // foul-out, otherwise it just adds a strike (if <2).
        if (battedBall.isFoul) {
          const caught = resolveFoulBall(battedBall, ctx.defense);
          if (caught) {
            pitch.outcome = 'foul-out';
            pitch.foulCaughtBy = caught.position;
            fieldedBy = caught.position;
            result = 'foul-out';
            break;
          }
          // Reclassify the pitch as a foul so PBP shows "Foul" and the
          // event emitter uses p.battedBall for the foul visualization
          // (otherwise events.ts re-emits ab.battedBall on every pitch
          // whose outcome is still 'in-play', causing duplicate Contact
          // lines with identical EV/LA/distance).
          pitch.outcome = 'foul';
          // The downstream `pitchRes.outcome` (still 'in-play') would
          // otherwise leave `pitch.outcome` overwritten to 'in-play' by
          // the assignment three lines above this case — but that
          // assignment ran BEFORE we reached this branch, so the
          // override here sticks. Battery stat (foulsPerPa) and the
          // event stream both pick up `pitch.outcome === 'foul'`.
          battedBall = undefined;  // don't carry it as the at-bat result
          if (strikes < 2 || !CONFIG.pitch.twoStrikeFoulRetains) {
            strikes = Math.min(2, strikes + 1);
          }
          break;
        }
        const res = resolveBattedBall(battedBall, batter, ctx.defense, rng);
        result = res.result;
        fieldedBy = res.fieldedBy;
        errorType = res.errorType;
        break;
      }
    }
    if (result) break;
  }

  if (!result) {
    // Safety: max pitches reached without resolution → call it a walk
    result = balls >= strikes ? 'walk' : 'strikeout';
  }

  // Derive fielding credits (PO/A/E) from result + fieldedBy. Convention:
  // the fielder who actually records the out is the putout; everyone who
  // touched the ball before that gets an assist. ROE = error on the
  // fielder who muffed the play (we use fieldedBy as a proxy until the
  // emergent-play model gives us a true error source).
  const fielding: AtBatRecord['fielding'] = (() => {
    switch (result) {
      case 'strikeout':
        // Catcher records the putout on a swinging/called K.
        return { putoutBy: 'C' };
      case 'foul-out':
        // Catcher most often, but lacking detail credit fieldedBy if known.
        return { putoutBy: fieldedBy ?? 'C' };
      case 'fly-out':
      case 'line-out':
      case 'pop-out':
      case 'sac-fly':
        return fieldedBy ? { putoutBy: fieldedBy } : undefined;
      case 'ground-out': {
        if (!fieldedBy) return undefined;
        // Fielder throws to the cover man at first; cover gets PO, fielder assist.
        // If the ball was fielded right at first base, the B1 records it
        // unassisted.
        if (fieldedBy === 'B1') return { putoutBy: 'B1' };
        return { putoutBy: 'B1', assistBy: [fieldedBy] };
      }
      case 'fielders-choice': {
        if (!fieldedBy) return undefined;
        // Throw to second; B2 (or SS) gets the PO, fielder gets an assist.
        const cover: Position = fieldedBy === 'B2' ? 'SS' : 'B2';
        return { putoutBy: cover, assistBy: [fieldedBy] };
      }
      case 'double-play': {
        if (!fieldedBy) return undefined;
        // 6-4-3 / 4-6-3 family: fielder → pivot → first.
        const pivot: Position = fieldedBy === 'B2' ? 'SS' : 'B2';
        return {
          putoutBy: pivot,                  // forces lead runner at 2B
          assistBy: [fieldedBy, pivot],     // fielder + pivot both throw
          extraPutouts: ['B1'],             // B1 records the second PO
        };
      }
      case 'reached-on-error':
        // Charge the error to the player who would've made the play.
        return fieldedBy ? { errorBy: fieldedBy } : undefined;
      default:
        return undefined;
    }
  })();

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
    errorType,
    fielding,
    rbis: 0,
    runsScored: 0,
  };
}
