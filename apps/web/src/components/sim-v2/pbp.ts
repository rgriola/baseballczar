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
  let curPitcher = '';
  let inningLabel = '';
  let balls = 0, strikes = 0;
  let homeName = 'Home', awayName = 'Away';
  /** Defense map for the current half-inning, keyed by position. */
  let defense = new Map<string, { name: string; position: string }>();
  /** Most recent fielder to converge on a batted ball, used to label
   *  the at-bat-end / out lines (e.g. "Single (fielded by S. Garcia, 2B)"). */
  let lastFielderPos: string | null = null;

  const fielderLabel = (pos: string | null | undefined) => {
    if (!pos) return '';
    const f = defense.get(pos);
    return f ? `${f.name}, ${f.position}` : pos;
  };

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
          defense.set(d.position, {
            name: `${d.firstName[0]}. ${d.lastName}`,
            position: d.position,
          });
        }
        lastFielderPos = null;
        out.push({ eventIdx: i, t: e.t, kind: 'inning', text: `── ${inningLabel} ──` });
        break;
      }
      case 'at-bat-start': {
        curBatter = `${e.batter.firstName[0]}. ${e.batter.lastName}`;
        curPitcher = `${e.pitcher.firstName[0]}. ${e.pitcher.lastName}`;
        balls = 0; strikes = 0;
        lastFielderPos = null;
        const onBase = e.runners.map((r, j) => r != null ? ['1B', '2B', '3B'][j] : null).filter(Boolean);
        const onBaseStr = onBase.length ? ` (${onBase.join(', ')})` : '';
        out.push({
          eventIdx: i, t: e.t, kind: 'ab',
          text: `${curBatter} batting vs ${curPitcher}${onBaseStr}`,
          meta: inningLabel,
        });
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
        out.push({ eventIdx: i, t: e.t, kind: 'pitch', text: `  Pitch ${e.pitchNum}: ${label} (${count})` });
        break;
      }
      case 'contact': {
        const ev = Math.round(e.exitVeloMph);
        const la = Math.round(e.launchAngleDeg);
        const dist = Math.round(e.distanceFt);
        const tag = e.isHomeRun ? ' — HR!' : e.isFoul ? ' (foul)' : '';
        out.push({
          eventIdx: i, t: e.t, kind: 'play',
          text: `  Contact: ${ev} mph, ${la}°, ${dist} ft${tag}`,
        });
        break;
      }
      case 'fielder-converge': {
        // Remember who got to the ball so the at-bat-end line can name them.
        lastFielderPos = e.position;
        const f = defense.get(e.position);
        if (f) {
          out.push({
            eventIdx: i, t: e.t, kind: 'play',
            text: `  Fielded by ${f.name} (${f.position})`,
          });
        }
        break;
      }
      case 'out': {
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
        out.push({ eventIdx: i, t: e.t, kind: 'play', text: `  ${r}${at} — ${e.outNum} out${e.outNum === 1 ? '' : 's'}` });
        break;
      }
      case 'run-scored': {
        out.push({
          eventIdx: i, t: e.t, kind: 'score',
          text: `  RUN SCORES — ${awayName} ${e.scoreAway}, ${homeName} ${e.scoreHome}`,
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
          // (e.g. “Single to S. Garcia, 2B”).
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
