/**
 * Build a play-by-play log from a SimEvent stream. Each entry is tied to
 * the event time `t` so a UI can highlight the line matching the current
 * playback clock.
 */
import type { SimEvent } from '@baseballczar/sim-engine';

export type PbpKind = 'inning' | 'ab' | 'pitch' | 'play' | 'score' | 'final';

export interface PbpEntry {
  /** Index into the original events array (for highlight sync). */
  eventIdx: number;
  /** Sim time in seconds. */
  t: number;
  kind: PbpKind;
  text: string;
  /** Optional context (inning header etc) shown subtly. */
  meta?: string;
}

const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];
const halfLabel = (h: 'top' | 'bottom') => (h === 'top' ? 'Top' : 'Bot');

export function buildPbp(events: SimEvent[]): PbpEntry[] {
  const out: PbpEntry[] = [];
  let curBatter = '';
  let inningLabel = '';
  let balls = 0, strikes = 0;
  let outs = 0;
  let scoreHome = 0, scoreAway = 0;
  let homeName = 'Home', awayName = 'Away';
  /** Defense map for the current half-inning, keyed by position. */
  let defense = new Map<string, { name: string; position: string }>();
  /** Roster of every player ever introduced (used to label runners /
   *  out runners by name when only an id is present on the event). */
  const players = new Map<number, { name: string }>();
  /** Most recent fielder to converge on a batted ball, used to label
   *  the at-bat-end / out lines (e.g. "Single (fielded by S. Garcia, 2B)"). */
  let lastFielderPos: string | null = null;

  const fielderLabel = (pos: string | null | undefined) => {
    if (!pos) return '';
    const f = defense.get(pos);
    return f ? `${f.name}, ${f.position}` : pos;
  };
  const runnerLabel = (id: number | null | undefined) =>
    id != null ? (players.get(id)?.name ?? `#${id}`) : '';
  const baseShort = (b: 'home' | 'first' | 'second' | 'third') =>
    b === 'home' ? 'home' : b === 'first' ? '1B' : b === 'second' ? '2B' : '3B';
  const skillBadge = (label: string, n: number | undefined) =>
    n != null ? `${label}${n}` : '';

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    switch (e.type) {
      case 'game-start': {
        homeName = e.homeTeamName;
        awayName = e.awayTeamName;
        out.push({ eventIdx: i, t: e.t, kind: 'inning', text: `${awayName} @ ${homeName} — first pitch` });
        break;
      }
      case 'inning-start': {
        inningLabel = `${halfLabel(e.half)} ${ORD[e.inning - 1] ?? `${e.inning}th`}`;
        // Refresh defense map so subsequent plays can name the fielder.
        defense = new Map();
        for (const d of e.defense) {
          const name = `${d.firstName[0]}. ${d.lastName}`;
          defense.set(d.position, { name, position: d.position });
          players.set(d.playerId, { name });
        }
        outs = 0;
        lastFielderPos = null;
        out.push({
          eventIdx: i, t: e.t, kind: 'inning',
          text: `── ${inningLabel} — ${awayName} ${scoreAway}, ${homeName} ${scoreHome} ──`,
        });
        break;
      }
      case 'at-bat-start': {
        const batterName = `${e.batter.firstName[0]}. ${e.batter.lastName}`;
        const pitcherName = `${e.pitcher.firstName[0]}. ${e.pitcher.lastName}`;
        curBatter = batterName;
        balls = 0; strikes = 0;
        outs = e.outs;
        if (e.scoreHome != null) scoreHome = e.scoreHome;
        if (e.scoreAway != null) scoreAway = e.scoreAway;
        lastFielderPos = null;
        // Register the batter so subsequent runner-advance / out lines
        // by id can resolve to a name.
        players.set(e.batter.id, { name: batterName });
        for (let j = 0; j < e.runners.length; j++) {
          const rid = e.runners[j];
          if (rid != null && !players.has(rid)) players.set(rid, { name: `R${j + 1}` });
        }
        // Score + outs + base state header
        const baseFlags = e.runners.map(r => r != null ? '●' : '○').join('');
        const onBase = e.runners
          .map((r, j) => r != null ? `${runnerLabel(r)} on ${['1B', '2B', '3B'][j]}` : null)
          .filter(Boolean);
        const onBaseStr = onBase.length ? `, ${onBase.join('; ')}` : '';
        out.push({
          eventIdx: i, t: e.t, kind: 'ab',
          text: `${batterName} (${e.batter.hand}H) batting vs ${pitcherName} (${e.pitcher.hand}H) — ${awayName} ${scoreAway}, ${homeName} ${scoreHome}, ${e.outs} out${e.outs === 1 ? '' : 's'}, bases [${baseFlags}]${onBaseStr}`,
          meta: inningLabel,
        });
        // Skill snapshot — only emit if we have at least one skill on
        // each side (older event streams won't carry these).
        const bs = [
          skillBadge('AVG', e.batter.avg),
          skillBadge('POW', e.batter.power),
          skillBadge('EYE', e.batter.eye),
          skillBadge('SPD', e.batter.speed),
          skillBadge('PI',  e.batter.playIntelligence),
        ].filter(Boolean).join(' ');
        const ps = [
          skillBadge('CTRL', e.pitcher.eye),
          skillBadge('STAM', e.pitcher.stamina),
          skillBadge('ARM',  e.pitcher.throwing),
        ].filter(Boolean).join(' ');
        if (bs || ps) {
          out.push({
            eventIdx: i, t: e.t, kind: 'ab',
            text: `    Batter: ${bs}   |   Pitcher: ${ps}`,
          });
        }
        break;
      }
      case 'pitch': {
        switch (e.outcome) {
          case 'ball': balls++; break;
          case 'called-strike':
          case 'swinging-strike': strikes++; break;
          case 'foul': if (strikes < 2) strikes++; break;
        }
        const count = `${balls}-${strikes}`;
        const label =
          e.outcome === 'ball' ? 'Ball' :
          e.outcome === 'called-strike' ? 'Called strike' :
          e.outcome === 'swinging-strike' ? 'Swinging strike' :
          e.outcome === 'foul' ? 'Foul' :
          e.outcome === 'foul-out' ? 'Foul out' :
          e.outcome === 'hbp' ? 'Hit by pitch' :
          'In play';
        // Approximate "pitch location/quality" from the engine's
        // intent-zone + actual-in-zone signals. The engine doesn't
        // model individual pitch types yet, so this is the best
        // location proxy we have today.
        const zoneLabel =
          e.intentZone === 'in'   ? 'in zone'  :
          e.intentZone === 'edge' ? 'edge'     :
                                    'off zone';
        const inZone = e.actualInZone ? 'caught zone' : 'missed zone';
        const swing = e.swung ? ', swung' : '';
        const outsTag = `${outs} out${outs === 1 ? '' : 's'}`;
        out.push({
          eventIdx: i, t: e.t, kind: 'pitch',
          text: `  Pitch ${e.pitchNum}: ${label} — pitched ${zoneLabel} (${inZone}${swing}) — (${count}, ${outsTag})`,
        });
        break;
      }
      case 'contact': {
        const ev = Math.round(e.exitVeloMph);
        const la = Math.round(e.launchAngleDeg);
        const sa = Math.round(e.sprayAngleDeg);
        const dist = Math.round(e.distanceFt);
        // Spray convention: 0° = dead CF, -45° = LF foul line, +45° = RF.
        const side =
          sa < -45 ? 'foul-L' :
          sa < -30 ? 'LF-line' :
          sa < -10 ? 'LF' :
          sa <  10 ? 'CF' :
          sa <  30 ? 'RF' :
          sa <= 45 ? 'RF-line' :
          'foul-R';
        const tag = e.isHomeRun ? ' — HR!' : e.isFoul ? ' (foul)' : '';
        const apex = e.peakHeightFt != null ? `, apex ${Math.round(e.peakHeightFt)} ft` : '';
        const hang = `, hang ${e.hangTimeSec.toFixed(1)}s`;
        out.push({
          eventIdx: i, t: e.t, kind: 'play',
          text: `  Contact: ${ev} mph, LA ${la}°, spray ${sa > 0 ? '+' : ''}${sa}° (${side}), ${dist} ft${apex}${hang}${tag}`,
        });
        break;
      }
      case 'fielder-converge': {
        // Only show "Fielded by" for the primary fielder — the one who
        // actually catches/fields the ball. Cutoff and backup converges
        // are visible in the animation but don't need a PBP line (they
        // made it look like multiple fielders caught the same ball).
        if (e.role && e.role !== 'primary') break;
        lastFielderPos = e.position;
        const f = defense.get(e.position);
        if (f) {
          out.push({
            eventIdx: i, t: e.t, kind: 'play',
            text: `    Fielded by ${f.name} (${f.position})`,
          });
        }
        break;
      }
      case 'fielder-dive': {
        const f = defense.get(e.position);
        const who = f ? `${f.name} (${f.position})` : e.position;
        const verb = e.variant === 'leap' ? 'leaps' : 'dives';
        const result = e.successful ? '— caught!' : '— missed';
        out.push({
          eventIdx: i, t: e.t, kind: 'play',
          text: `    ${who} ${verb} ${result}`,
        });
        break;
      }
      case 'throw': {
        const fromF = defense.get(e.fromPosition);
        const fromName = fromF ? fromF.name : e.fromPosition;
        let target: string;
        if (e.isCutoffRelay && e.cutoffPosition) {
          // Relay throw to cutoff man — show who's receiving, not the
          // base, so it doesn't look like two throws to the same place.
          const cutF = defense.get(e.cutoffPosition);
          const cutName = cutF ? cutF.name : e.cutoffPosition;
          target = `cutoff ${cutName} (${e.cutoffPosition})`;
        } else {
          target = baseShort(e.toBase);
        }
        out.push({
          eventIdx: i, t: e.t, kind: 'play',
          text: `    Throw: ${fromName} (${e.fromPosition}) → ${target}`,
        });
        break;
      }
      case 'runner-advance': {
        // Skip the batter's own home→1B trip — it's implicit in the
        // at-bat result and would clutter the log.
        if (e.fromBase === 'home') break;
        const who = runnerLabel(e.runnerId);
        out.push({
          eventIdx: i, t: e.t, kind: 'play',
          text: `    Runner: ${who} ${baseShort(e.fromBase)} → ${baseShort(e.toBase)}`,
        });
        break;
      }
      case 'out': {
        outs = e.outNum;
        const r =
          e.reason === 'strikeout' ? 'Strikeout' :
          e.reason === 'ground-out' ? 'Groundout' :
          e.reason === 'fly-out' ? 'Flyout' :
          e.reason === 'line-out' ? 'Lineout' :
          e.reason === 'pop-out' ? 'Popout' :
          e.reason === 'foul-out' ? 'Foul out' :
          e.reason === 'sac-fly' ? 'Sac fly' :
          e.reason === 'double-play' ? 'Double play' :
          e.reason === 'fielders-choice' ? 'Fielder’s choice' :
          String(e.reason);
        const at = e.atPosition ? ` (${fielderLabel(e.atPosition)})` : '';
        const who = e.runnerId != null ? ` — ${runnerLabel(e.runnerId)} out` : '';
        out.push({ eventIdx: i, t: e.t, kind: 'play', text: `  ${r}${at}${who} — ${e.outNum} out${e.outNum === 1 ? '' : 's'}` });
        break;
      }
      case 'run-scored': {
        scoreHome = e.scoreHome;
        scoreAway = e.scoreAway;
        const who = runnerLabel(e.runnerId);
        out.push({
          eventIdx: i, t: e.t, kind: 'score',
          text: `  RUN SCORES — ${who} — ${awayName} ${e.scoreAway}, ${homeName} ${e.scoreHome}`,
        });
        break;
      }
      case 'at-bat-end': {
        const r =
          e.result === 'single' ? 'Single' :
          e.result === 'double' ? 'Double' :
          e.result === 'triple' ? 'Triple' :
          e.result === 'home-run' ? 'HOME RUN' :
          e.result === 'walk' ? 'Walk' :
          e.result === 'hbp' ? 'Hit by pitch' :
          e.result === 'reached-on-error' ? 'Reached on error' :
          null;
        if (r) {
          const rbi = e.rbis > 0 ? `, ${e.rbis} RBI` : '';
          // For hits, append who fielded it so the user can see the play
          // (e.g. “Single off S. Garcia, 2B”).
          const isHit = e.result === 'single' || e.result === 'double'
            || e.result === 'triple' || e.result === 'home-run';
          const where = isHit && lastFielderPos
            ? ` (off ${fielderLabel(lastFielderPos)})`
            : '';
          out.push({ eventIdx: i, t: e.t, kind: 'play', text: `  → ${curBatter}: ${r}${where}${rbi}` });
        }
        break;
      }
      case 'inning-end': {
        scoreHome = e.scoreHome;
        scoreAway = e.scoreAway;
        out.push({
          eventIdx: i, t: e.t, kind: 'inning',
          text: `  End ${inningLabel} — ${awayName} ${e.scoreAway}, ${homeName} ${e.scoreHome}`,
        });
        break;
      }
      case 'game-end': {
        out.push({
          eventIdx: i, t: e.t, kind: 'final',
          text: `FINAL — ${awayName} ${e.scoreAway}, ${homeName} ${e.scoreHome}`,
        });
        break;
      }
    }
  }
  return out;
}
