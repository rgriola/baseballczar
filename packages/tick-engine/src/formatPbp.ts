// Last touched by agent: 2026-05-05T06:10:11Z
/**
 * Play-by-play formatter for sim-lab-2 tick events.
 *
 * Converts raw TickEvent arrays into rich narrative PBP entries with
 * color coding, pitch velocity, batted ball stats, and descriptive
 * baseball language.
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

function lastNameOnly(name: string): string {
  const raw = name.replace(/^#\d+\s+/, '').trim();
  const parts = raw.split(/\s+/);
  return parts[parts.length - 1] ?? raw;
}

function formatPlayerTag(name?: string, id?: number, fallback = 'Player'): string {
  if (name?.startsWith('#')) return name;
  if (id != null && id > 0) {
    const taggedName = name ? lastNameOnly(name) : fallback;
    return `#${id} ${taggedName}`;
  }
  return name ?? fallback;
}

// ─── Pitch narrative helpers ─────────────────────────────────────

/** Describe where the pitch was relative to the zone. */
function zoneNarrative(zone: 'in' | 'edge' | 'off', actualInZone: boolean): string {
  if (zone === 'in' && actualInZone) return 'right down the middle';
  if (zone === 'in' && !actualInZone) return 'misses inside';
  if (zone === 'edge' && actualInZone) return 'paints the corner';
  if (zone === 'edge' && !actualInZone) return 'just misses';
  if (zone === 'off' && !actualInZone) return 'well outside';
  if (zone === 'off' && actualInZone) return 'sneaks back over';
  return '';
}

/** Describe what the batter did on the pitch. */
function outcomeNarrative(outcome: string, swung: boolean, zone: 'in' | 'edge' | 'off'): string {
  switch (outcome) {
    case 'called-strike':  return 'Called strike';
    case 'swinging-strike': return zone === 'off' ? 'Chases — swinging strike' : 'Swings and misses';
    case 'foul':           return 'Fouled off';
    case 'foul-out':       return 'Foul ball caught!';
    case 'in-play':        return 'In play';
    case 'ball':           return swung ? 'Checked swing — ball' : 'Takes for a ball';
    case 'hit':            return 'Puts it in play';
    case 'hbp':            return 'Hit by pitch!';
    default:               return outcome;
  }
}

function namedOutcomeNarrative(outcome: string, batter: string): string {
  switch (outcome) {
    case 'called-strike':
      return `Called strike to ${batter}`;
    case 'swinging-strike':
      return `${batter} swings and misses`;
    case 'foul':
      return `${batter} fouls it off`;
    case 'foul-out':
      return `${batter} pops it up in foul ground`;
    case 'in-play':
    case 'hit':
      return `${batter} puts the ball in play`;
    case 'ball':
      return `Ball to ${batter}`;
    case 'hbp':
      return `${batter} is hit by the pitch`;
    default:
      return outcome;
  }
}

/** Describe the ball off the bat based on LA and exit velo. */
function contactDescriptor(la: number, ev: number): string {
  if (la < -5)  return 'Chops it into the dirt';
  if (la < 5)   return ev > 95 ? 'Lines it hard' : 'Grounds it';
  if (la < 15)  return ev > 100 ? 'Rifles a line drive' : 'Hits a liner';
  if (la < 25)  return ev > 100 ? 'Drives it deep' : 'Lifts a fly ball';
  if (la < 35)  return ev > 95 ? 'Launches one — HIGH fly ball' : 'Pops one up';
  if (la < 50)  return ev > 100 ? 'Skies one deep' : 'Hits a high fly';
  return 'Pops it straight up';
}

/** Describe the fielder's action. */
function fieldedVerb(by: string): string {
  const pos = displayPos(by);
  if (['LF', 'CF', 'RF'].includes(pos)) return 'tracks it down';
  if (['SS', '2B'].includes(pos)) return 'charges in and scoops it';
  if (['1B', '3B'].includes(pos)) return 'fields it cleanly';
  if (pos === 'C') return 'pounces on it';
  if (pos === 'P') return 'snags it off the mound';
  return 'fields it';
}

const resultLabel = (r: string): string => {
  switch (r) {
    case 'single': return 'SINGLE';
    case 'double': return 'DOUBLE';
    case 'triple': return 'TRIPLE';
    case 'home-run': return '💣 HOME RUN';
    case 'walk': return 'WALK';
    case 'hbp': return 'HIT BY PITCH';
    case 'strikeout': return 'STRIKEOUT';
    case 'ground-out': return 'Groundout';
    case 'fly-out': return 'Flyout';
    case 'line-out': return 'Lineout';
    case 'pop-out': return 'Popout';
    case 'foul-out': return 'Foul out';
    case 'sac-fly': return 'Sac fly';
    case 'double-play': return 'DOUBLE PLAY';
    case 'fielders-choice': return "Fielder's choice";
    case 'reached-on-error': return 'REACHED ON ERROR';
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
          text: `\n══════ ${halfLabel(e.half)} ${inn} ══════`,
          color: 'text-zinc-100',
        });
        break;
      }

      case 'at-bat-start': {
        const inn = ORD[e.inning - 1] ?? `${e.inning}th`;
        const baseDots = ['first', 'second', 'third']
          .map(b => e.bases.includes(b) ? '●' : '○')
          .join('');
        const batterName = formatPlayerTag(e.batter.name, e.batter.id, 'Batter');
        const pitcherName = formatPlayerTag(e.pitcher.name, e.pitcher.id, 'Pitcher');

        // Matchup header
        out.push({
          time, kind: 'ab-header', bold: true,
          text: `\n${batterName} (${e.batter.hand}H) vs ${pitcherName} (${e.pitcher.hand}H)`,
          color: 'text-white',
        });

        // Situation line
        out.push({
          time, kind: 'ab-header',
          text: `  ${halfLabel(e.half)} ${inn} — ${e.awayName} ${e.awayScore}, ${e.homeName} ${e.homeScore} — ${e.outs} out${e.outs === 1 ? '' : 's'} [${baseDots}]`,
          color: 'text-zinc-400',
        });

        // Batter skills
        const bs = [
          `AVG ${e.batter.avg}`, `PWR ${e.batter.power}`,
          `EYE ${e.batter.eye}`, `SPD ${e.batter.speed}`,
        ].join('  ');

        // Pitcher skills (including velocity potential)
        const ps = [
          `CTRL ${e.pitcher.ctrl}`, `ARM ${e.pitcher.throwing}`, `STM ${e.pitcher.stam}`,
        ].join('  ');

        out.push({
          time, kind: 'skills',
          text: `  ⚾ ${bs}  │  🎯 ${ps}`,
          color: 'text-zinc-500',
        });
        break;
      }

      // ── PITCH ─────────────────────────────────────────────
      case 'pitch': {
        const loc = zoneNarrative(e.zone, e.actualInZone);
        const pitcher = formatPlayerTag(e.pitcherName, e.pitcherId, 'Pitcher');
        const batter = formatPlayerTag(e.batterName, e.batterId, 'Batter');
        out.push({
          time, kind: 'pitch',
          text: `  ${e.pitchNum}. ${pitcher} throws ${e.speed} ${e.mph} mph to ${batter} — ${loc}`,
          color: 'text-violet-300',
        });
        break;
      }

      case 'pitch-result': {
        const hasBatterContext = Boolean(e.batterName || (e.batterId != null && e.batterId > 0));
        const batter = formatPlayerTag(e.batterName, e.batterId, 'Batter');
        const narr = hasBatterContext
          ? namedOutcomeNarrative(e.outcome, batter)
          : outcomeNarrative(e.outcome, false, 'in');
        const countStr = `(${e.balls}-${e.strikes})`;

        // Combine outcome with count
        let text = `     ${narr} ${countStr}`;

        // Add contact stats for foul or fair balls when available.
        const contactBall = e.foulBall ?? e.inPlayBall;
        if (contactBall) {
          const apex = contactBall.peakHeightFt != null
            ? `, Apex ${Math.round(contactBall.peakHeightFt)} ft`
            : '';
          text += ` — ${Math.round(contactBall.exitVeloMph)} mph, LA ${Math.round(contactBall.launchAngleDeg)}°, ${Math.round(contactBall.distanceFt)} ft ${contactBall.sprayDirection}${apex}`;
        }

        out.push({
          time, kind: 'pitch',
          text,
          color: e.outcome === 'ball' ? 'text-sky-300' :
                 e.outcome === 'foul' ? 'text-amber-200' :
                 e.outcome.includes('strike') ? 'text-red-300' :
                 'text-violet-300',
        });
        break;
      }

      // ── CONTACT (batted ball in play) ─────────────────────
      case 'contact': {
        const ev = Math.round(e.exitVeloMph);
        const la = Math.round(e.launchAngleDeg);
        const spray = Math.round(e.sprayAngleDeg);
        const dist = Math.round(e.distanceFt);
        const descriptor = contactDescriptor(la, ev);
        const batter = formatPlayerTag(e.batterName, e.batterId, 'Batter');
        const hasBatterContext = Boolean(e.batterName || (e.batterId != null && e.batterId > 0));
        const batterAction = hasBatterContext
          ? `${batter} ${descriptor.charAt(0).toLowerCase()}${descriptor.slice(1)}`
          : descriptor;
        const apex = e.peakHeightFt != null ? ` | apex ${Math.round(e.peakHeightFt)} ft` : '';
        const hang = e.hangTimeSec != null ? ` | hang ${e.hangTimeSec.toFixed(1)}s` : '';

        if (e.isHomeRun) {
          out.push({
            time, kind: 'contact', bold: true,
            text: `  🚀 ${batterAction} to ${e.sprayDirection}! EV ${ev} mph | LA ${la}° | Spray ${spray}° | ${dist} ft${apex}`,
            color: 'text-yellow-300',
          });
        } else {
          out.push({
            time, kind: 'contact',
            text: `  💥 ${batterAction} to ${e.sprayDirection} — EV ${ev} mph | LA ${la}° | Spray ${spray}° | ${dist} ft${apex}${hang}`,
            color: 'text-amber-300',
          });
        }
        break;
      }

      // ── FIELDING EVENTS ───────────────────────────────────
      case 'ball-landed': {
        out.push({
          time, kind: 'play',
          text: `  📍 Ball lands at (${Math.round(e.at.x)}, ${Math.round(e.at.y)})`,
          color: 'text-zinc-400',
        });
        break;
      }

      case 'ball-caught': {
        const who = (e.playerName || (e.playerId != null && e.playerId > 0))
          ? `${formatPlayerTag(e.playerName, e.playerId, displayPos(e.by))} (${displayPos(e.by)})`
          : displayPos(e.by);
        out.push({
          time, kind: 'play',
          text: `  🧤 ${who} makes the catch!`,
          color: 'text-green-300',
        });
        break;
      }

      case 'ball-fielded': {
        const who = (e.playerName || (e.playerId != null && e.playerId > 0))
          ? `${formatPlayerTag(e.playerName, e.playerId, displayPos(e.by))} (${displayPos(e.by)})`
          : displayPos(e.by);
        const verb = fieldedVerb(e.by);
        out.push({
          time, kind: 'play',
          text: `  🏃 ${who} ${verb}`,
          color: 'text-green-300',
        });
        break;
      }

      case 'throw-released': {
        const from = (e.fromName || (e.fromId != null && e.fromId > 0))
          ? `${formatPlayerTag(e.fromName, e.fromId, displayPos(e.from))} (${displayPos(e.from)})`
          : displayPos(e.from);
        const baseName = baseShort(e.toBase);
        out.push({
          time, kind: 'play',
          text: `  💨 ${from} fires to ${baseName}`,
          color: 'text-blue-300',
        });
        break;
      }

      case 'ball-received': {
        const who = (e.playerName || (e.playerId != null && e.playerId > 0))
          ? `${formatPlayerTag(e.playerName, e.playerId, displayPos(e.by))} (${displayPos(e.by)})`
          : displayPos(e.by);
        out.push({
          time, kind: 'play',
          text: `  👐 ${who} receives the throw`,
          color: 'text-blue-200',
        });
        break;
      }

      case 'wall-bounce': {
        out.push({
          time, kind: 'play', bold: true,
          text: `  💥 OFF THE WALL!`,
          color: 'text-orange-300',
        });
        break;
      }

      case 'wall-cleared': {
        const height = e.heightFt != null && e.heightFt > 0.5
          ? ` at ${Math.round(e.heightFt)} ft`
          : '';
        out.push({
          time, kind: 'play', bold: true,
          text: `  🧱 Cleared the wall at (${Math.round(e.at.x)}, ${Math.round(e.at.y)})${height}`,
          color: 'text-yellow-200',
        });
        break;
      }

      case 'home-run': {
        out.push({
          time, kind: 'play', bold: true,
          text: `  🚀 GONE! ${e.distanceFt} ft bomb!`,
          color: 'text-yellow-300',
        });
        break;
      }

      // ── RUNNER EVENTS ─────────────────────────────────────
      case 'runner-safe': {
        const runner = formatPlayerTag(e.runnerName, e.runnerId, 'Runner');
        const base = baseShort(e.base);
        const verb = base === 'home' ? `${runner} slides in safely at home!` : `${runner} is safe at ${base}`;
        out.push({
          time, kind: 'play',
          text: `  ✅ ${verb}`,
          color: 'text-emerald-300',
        });
        break;
      }

      case 'runner-out': {
        const runner = formatPlayerTag(e.runnerName, e.runnerId, 'Runner');
        const at = baseShort(e.at);
        out.push({
          time, kind: 'play',
          text: `  ❌ ${runner} is OUT at ${at}!`,
          color: 'text-red-400',
        });
        break;
      }

      case 'runner-scored': {
        const runner = formatPlayerTag(e.runnerName, e.runnerId, 'Runner');
        out.push({
          time, kind: 'score', bold: true,
          text: `  🏠 ${runner} scores!`,
          color: 'text-emerald-400',
        });
        break;
      }

      // ── AT-BAT RESULT ─────────────────────────────────────
      case 'at-bat-end': {
        const batter = formatPlayerTag(e.batterName, e.batterId, 'Batter');
        const r = resultLabel(e.result);
        const rbi = e.rbis > 0 ? ` (${e.rbis} RBI)` : '';
        const where = e.fieldedBy ? ` — off ${e.fieldedBy}` : '';
        out.push({
          time, kind: 'result', bold: true,
          text: `→ ${batter}: ${r}${where}${rbi}`,
          color: e.result === 'home-run' ? 'text-yellow-300' :
                 ['single', 'double', 'triple', 'walk', 'hbp', 'reached-on-error'].includes(e.result)
                   ? 'text-emerald-300' : 'text-red-300',
        });
        break;
      }

      case 'play-complete':
        break;

      // ── MANAGER EVENTS ────────────────────────────────────
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
          text: `⚙️ Defense shifts`,
          color: 'text-cyan-300',
        });
        break;
      }

      default:
        break;
    }
  }

  return out;
}
