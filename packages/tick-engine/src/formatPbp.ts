/**
 * Play-by-play formatter for sim-lab-2 tick events.
 *
 * Converts raw TickEvent arrays into rich narrative PBP entries with
 * color coding, modeled after the v1 pbp.ts quality level but driven
 * by the tick engine's event stream.
 */
import type { TickEvent } from './entities';

export interface PbpEntry {
  time: number;
  kind: 'inning' | 'ab-header' | 'skills' | 'pitch' | 'contact' | 'play' | 'result' | 'score' | 'flow';
  text: string;
  /** Tailwind text color class. */
  color: string;
  bold?: boolean;
}

const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];
const halfLabel = (h: 'top' | 'bottom') => (h === 'top' ? 'Top' : 'Bot');
const baseShort = (b: string) =>
  b === 'home' ? 'home' : b === 'first' ? '1B' : b === 'second' ? '2B' : b === 'third' ? '3B' : b;
const displayPos = (p: string) => p.replace(/^B(\d)/, '$1B');

const resultLabel = (r: string): string => {
  switch (r) {
    case 'single': return 'Single';
    case 'double': return 'Double';
    case 'triple': return 'Triple';
    case 'home-run': return 'HOME RUN';
    case 'walk': return 'Walk';
    case 'hbp': return 'Hit by pitch';
    case 'strikeout': return 'Strikeout';
    case 'ground-out': return 'Groundout';
    case 'fly-out': return 'Flyout';
    case 'line-out': return 'Lineout';
    case 'pop-out': return 'Popout';
    case 'foul-out': return 'Foul out';
    case 'sac-fly': return 'Sac fly';
    case 'double-play': return 'Double play';
    case 'fielders-choice': return "Fielder's choice";
    case 'reached-on-error': return 'Reached on error';
    default: return r;
  }
};

/**
 * Format a batch of tick events (from a single snapshot) into PBP entries.
 * Maintains no state — each call is independent. The page accumulates
 * entries across snapshots.
 */
export function formatTickEvents(events: TickEvent[], time: number): PbpEntry[] {
  const out: PbpEntry[] = [];

  for (const e of events) {
    switch (e.type) {
      case 'inning-change': {
        const inn = ORD[e.inning - 1] ?? `${e.inning}th`;
        out.push({
          time, kind: 'inning', bold: true,
          text: `══ ${halfLabel(e.half)} ${inn} ══`,
          color: 'text-zinc-100',
        });
        break;
      }

      case 'at-bat-start': {
        const inn = ORD[e.inning - 1] ?? `${e.inning}th`;
        const baseDots = ['first', 'second', 'third']
          .map(b => e.bases.includes(b) ? '●' : '○')
          .join('');
        out.push({
          time, kind: 'ab-header', bold: true,
          text: `${e.batter.name} (${e.batter.hand}H) vs ${e.pitcher.name} (${e.pitcher.hand}H)`,
          color: 'text-white',
        });
        out.push({
          time, kind: 'ab-header',
          text: `  ${halfLabel(e.half)} ${inn} — ${e.awayName} ${e.awayScore}, ${e.homeName} ${e.homeScore} — ${e.outs} out${e.outs === 1 ? '' : 's'} [${baseDots}]`,
          color: 'text-zinc-400',
        });
        // Skill badges
        const bs = [
          `AVG${e.batter.avg}`, `POW${e.batter.power}`,
          `EYE${e.batter.eye}`, `SPD${e.batter.speed}`,
        ].join(' ');
        const ps = [`CTRL${e.pitcher.ctrl}`, `STAM${e.pitcher.stam}`].join(' ');
        out.push({
          time, kind: 'skills',
          text: `  ${bs}  |  ${ps}`,
          color: 'text-zinc-500',
        });
        break;
      }

      case 'contact': {
        const ev = Math.round(e.exitVeloMph);
        const la = Math.round(e.launchAngleDeg);
        const dist = Math.round(e.distanceFt);
        const apex = e.peakHeightFt != null ? `, apex ${Math.round(e.peakHeightFt)} ft` : '';
        const hang = e.hangTimeSec != null ? `, hang ${e.hangTimeSec.toFixed(1)}s` : '';
        const hr = e.isHomeRun ? ' — HR!' : '';
        out.push({
          time, kind: 'contact', bold: !!e.isHomeRun,
          text: `  Contact: ${ev} mph, LA ${la}°, ${e.sprayDirection}, ${dist} ft${apex}${hang}${hr}`,
          color: e.isHomeRun ? 'text-yellow-300' : 'text-amber-300',
        });
        break;
      }

      case 'ball-landed': {
        out.push({
          time, kind: 'play',
          text: `  📍 Landed at (${Math.round(e.at.x)}, ${Math.round(e.at.y)})`,
          color: 'text-zinc-400',
        });
        break;
      }

      case 'ball-caught': {
        const who = e.playerName ? `${e.playerName} (${displayPos(e.by)})` : displayPos(e.by);
        out.push({
          time, kind: 'play',
          text: `  🧤 Caught by ${who}`,
          color: 'text-green-300',
        });
        break;
      }

      case 'ball-fielded': {
        const who = e.playerName ? `${e.playerName} (${displayPos(e.by)})` : displayPos(e.by);
        out.push({
          time, kind: 'play',
          text: `  🏃 Fielded by ${who}`,
          color: 'text-green-300',
        });
        break;
      }

      case 'throw-released': {
        const from = e.fromName ? `${e.fromName} (${displayPos(e.from)})` : displayPos(e.from);
        out.push({
          time, kind: 'play',
          text: `  💨 Throw: ${from} → ${baseShort(e.toBase)}`,
          color: 'text-blue-300',
        });
        break;
      }

      case 'wall-bounce': {
        out.push({
          time, kind: 'play', bold: true,
          text: `  💥 Off the wall!`,
          color: 'text-orange-300',
        });
        break;
      }

      case 'home-run': {
        out.push({
          time, kind: 'play', bold: true,
          text: `  🚀 HOME RUN — ${e.distanceFt} ft!`,
          color: 'text-yellow-300',
        });
        break;
      }

      case 'runner-safe': {
        out.push({
          time, kind: 'play',
          text: `  ✅ Runner safe at ${baseShort(e.base)}`,
          color: 'text-emerald-300',
        });
        break;
      }

      case 'runner-out': {
        out.push({
          time, kind: 'play',
          text: `  ❌ Runner OUT at ${baseShort(e.at)}`,
          color: 'text-red-400',
        });
        break;
      }

      case 'runner-scored': {
        out.push({
          time, kind: 'score', bold: true,
          text: `  🏠 RUN SCORES!`,
          color: 'text-emerald-400',
        });
        break;
      }

      case 'at-bat-end': {
        const r = resultLabel(e.result);
        const rbi = e.rbis > 0 ? `, ${e.rbis} RBI` : '';
        const where = e.fieldedBy ? ` (off ${e.fieldedBy})` : '';
        out.push({
          time, kind: 'result', bold: true,
          text: `→ ${e.batterName}: ${r}${where}${rbi}`,
          color: e.result === 'home-run' ? 'text-yellow-300' :
                 ['single', 'double', 'triple', 'walk', 'hbp', 'reached-on-error'].includes(e.result)
                   ? 'text-emerald-300' : 'text-red-300',
        });
        break;
      }

      case 'play-complete': {
        // Don't render — the at-bat-end result line is the visual terminator
        break;
      }

      case 'manager-signal': {
        out.push({
          time, kind: 'flow',
          text: `📋 ${e.decision}: ${e.detail}`,
          color: 'text-cyan-300',
        });
        break;
      }

      case 'defensive-shift': {
        out.push({
          time, kind: 'flow',
          text: `⚙️ Defensive shift`,
          color: 'text-cyan-300',
        });
        break;
      }

      // pitch / pitch-result — keep minimal for now
      case 'pitch': {
        out.push({
          time, kind: 'pitch',
          text: `  Pitch ${e.pitchNum}: ${e.speed}, ${e.zone} zone`,
          color: 'text-violet-300',
        });
        break;
      }

      case 'pitch-result': {
        out.push({
          time, kind: 'pitch',
          text: `  📊 ${e.outcome} (${e.balls}-${e.strikes})`,
          color: 'text-violet-300',
        });
        break;
      }

      default:
        break;
    }
  }

  return out;
}
