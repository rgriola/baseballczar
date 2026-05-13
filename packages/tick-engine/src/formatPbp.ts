/**
 * Play-by-play formatter for sim-lab-2 tick events.
 *
 * Converts raw TickEvent arrays into rich narrative PBP entries with
 * color coding, pitch velocity, batted ball stats, and descriptive
 * baseball language.
 *
 * v2 — condensed fielding, scoring notation, debug gating, inning summaries.
 */
import type { TickEvent } from './entities';

export interface PbpEntry {
  time: number;
  kind: 'inning' | 'ab-header' | 'skills' | 'pitch' | 'contact' | 'play' | 'result' | 'score' | 'flow' | 'debug';
  text: string;
  /** Tailwind text color class. */
  color: string;
  bold?: boolean;
}

/** Cross-call state for inning summaries and accumulators. */
export interface PbpFormatterState {
  inningRuns: number;
  inningHits: number;
  lastHalf?: 'top' | 'bottom';
  lastInning?: number;
  lastHomeName?: string;
  lastAwayName?: string;
  lastHomeScore?: number;
  lastAwayScore?: number;
  /** Fielding accumulator — buffered until terminal runner event. */
  fieldingChain: Array<{ pos: string; name: string; action: 'caught' | 'fielded' | 'threw' | 'received'; at?: { x: number; y: number } }>;
  /** Pending pitch event — merged with pitch-result on arrival. */
  pendingPitch?: TickEvent & { type: 'pitch' };
  /** Current batter ID — used to suppress contradictory runner-safe events. */
  currentBatterId?: number;
  /** Current outs before the at-bat — used to detect 3rd-out LOB. */
  currentOuts?: number;
}

export function createPbpState(): PbpFormatterState {
  return { inningRuns: 0, inningHits: 0, fieldingChain: [] };
}

/** Position → defensive scoring number. */
const POS_NUM: Record<string, number> = {
  P: 1, C: 2, '1B': 3, '2B': 4, '3B': 5, SS: 6, LF: 7, CF: 8, RF: 9,
};

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
    case 'called-strike': return 'Called strike';
    case 'swinging-strike': return zone === 'off' ? 'Chases — swinging strike' : 'Swings and misses';
    case 'foul': return 'Fouled off';
    case 'foul-out': return 'Foul ball caught!';
    case 'in-play': return 'In play';
    case 'ball': return swung ? 'Checked swing — ball' : 'Takes for a ball';
    case 'hit': return 'Puts it in play';
    case 'hbp': return 'Hit by pitch!';
    default: return outcome;
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
  if (la < -5) return 'Chops it into the dirt';
  if (la < 5) return ev > 95 ? 'Lines it hard' : 'Grounds it';
  if (la < 15) return ev > 100 ? 'Rifles a line drive' : 'Hits a liner';
  if (la < 25) return ev > 100 ? 'Drives it deep' : 'Lifts a fly ball';
  if (la < 35) return ev > 95 ? 'Launches one — HIGH fly ball' : 'Pops one up';
  if (la < 50) return ev > 100 ? 'Skies one deep' : 'Hits a high fly';
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
 * State is maintained across calls for inning summaries and accumulators.
 */
export function formatTickEvents(
  events: TickEvent[],
  time: number,
  debug = false,
  state?: PbpFormatterState,
  debugBallCoords = false,
): PbpEntry[] {
  const out: PbpEntry[] = [];
  const st = state ?? createPbpState();

  for (const e of events) {
    switch (e.type) {

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

        // Track for inning summaries (#10)
        st.lastHomeName = e.homeName;
        st.lastAwayName = e.awayName;
        st.lastHomeScore = e.homeScore;
        st.lastAwayScore = e.awayScore;
        // Track batter + outs for runner-safe suppression
        st.currentBatterId = e.batter.id;
        st.currentOuts = e.outs;

        // Batter + pitcher skills — debug only (#8)
        if (debug) {
          const bs = [
            `AVG ${e.batter.avg}`, `PWR ${e.batter.power}`,
            `EYE ${e.batter.eye}`, `SPD ${e.batter.speed}`,
          ].join('  ');
          const ps = [
            `CTRL ${e.pitcher.ctrl}`, `ARM ${e.pitcher.throwing}`, `STM ${e.pitcher.stam}`,
          ].join('  ');
          out.push({
            time, kind: 'skills',
            text: `  ⚾ ${bs}  │  🎯 ${ps}`,
            color: 'text-zinc-500',
          });
        }
        break;
      }

      // ── PITCH (#6 — buffer, merge with result) ────────────
      case 'pitch': {
        st.pendingPitch = e as TickEvent & { type: 'pitch' };
        break;
      }

      case 'pitch-result': {
        const pp = st.pendingPitch;
        st.pendingPitch = undefined;
        const batter = formatPlayerTag(e.batterName, e.batterId, 'Batter');
        const countStr = `(${e.balls}-${e.strikes})`;
        const isContact = e.outcome === 'in-play' || e.outcome === 'hit';

        if (pp) {
          const pitcher = formatPlayerTag(pp.pitcherName, pp.pitcherId, 'Pitcher');
          const batterLast = e.batterName ? lastNameOnly(formatPlayerTag(e.batterName, e.batterId, 'Batter')) : 'Batter';
          const loc = zoneNarrative(pp.zone, pp.actualInZone);

          if (isContact) {
            // Contact — will be completed by the contact event below
            // Just emit the pitch info; contact event adds the hit description
            out.push({
              time, kind: 'pitch',
              text: `  ${pp.pitchNum}. ${pitcher} throws ${pp.speed} to ${batter} [${pp.mph} mph]`,
              color: 'text-violet-300',
            });
          } else if (e.outcome === 'foul') {
            let text = `  ${pp.pitchNum}. ${pitcher} throws ${pp.speed} to ${batterLast}, ${batterLast} fouls it off ${countStr} [${pp.mph} mph]`;
            const fb = e.foulBall;
            if (fb) {
              text += ` — ${Math.round(fb.exitVeloMph)} mph, LA ${Math.round(fb.launchAngleDeg)}°, ${Math.round(fb.distanceFt)} ft`;
            }
            out.push({ time, kind: 'pitch', text, color: 'text-amber-200' });
          } else if (e.outcome === 'ball') {
            // Ball — show location since batter didn't swing
            out.push({
              time, kind: 'pitch',
              text: `  ${pp.pitchNum}. ${pitcher} throws ${pp.speed}, ${loc} — ball ${countStr} [${pp.mph} mph]`,
              color: 'text-sky-300',
            });
          } else if (e.outcome === 'called-strike') {
            out.push({
              time, kind: 'pitch',
              text: `  ${pp.pitchNum}. ${pitcher} throws ${pp.speed}, ${loc} — called strike ${countStr} [${pp.mph} mph]`,
              color: 'text-red-300',
            });
          } else if (e.outcome === 'swinging-strike') {
            const chase = pp.zone === 'off' ? 'chases' : 'swings and misses';
            out.push({
              time, kind: 'pitch',
              text: `  ${pp.pitchNum}. ${pitcher} throws ${pp.speed}, ${batterLast} ${chase} ${countStr} [${pp.mph} mph]`,
              color: 'text-red-300',
            });
          } else if (e.outcome === 'hbp') {
            out.push({
              time, kind: 'pitch',
              text: `  ${pp.pitchNum}. ${pitcher} throws ${pp.speed} — hits ${batterLast}! ${countStr} [${pp.mph} mph]`,
              color: 'text-red-300',
            });
          } else {
            out.push({
              time, kind: 'pitch',
              text: `  ${pp.pitchNum}. ${pitcher} throws ${pp.speed} to ${batter} — ${e.outcome} ${countStr} [${pp.mph} mph]`,
              color: 'text-violet-300',
            });
          }
        } else {
          // No buffered pitch (shouldn't happen, but fallback)
          out.push({
            time, kind: 'pitch',
            text: `     ${batter} — ${e.outcome} ${countStr}`,
            color: 'text-violet-300',
          });
        }
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
          ? `he ${descriptor.charAt(0).toLowerCase()}${descriptor.slice(1)}`
          : descriptor;
        const apex = e.peakHeightFt != null ? ` | apex ${Math.round(e.peakHeightFt)} ft` : '';
        const hang = e.hangTimeSec != null ? ` | hang ${e.hangTimeSec.toFixed(1)}s` : '';

        if (e.isHomeRun) {
          out.push({
            time, kind: 'contact', bold: true,
            text: `  🚀 ${batter} ${descriptor.charAt(0).toLowerCase()}${descriptor.slice(1)} to ${e.sprayDirection}!`,
            color: 'text-yellow-300',
          });
          out.push({
            time, kind: 'contact',
            text: `     — EV ${ev} mph | LA ${la}° | Spray ${spray}° | ${dist} ft${apex}`,
            color: 'text-yellow-200',
          });
        } else {
          out.push({
            time, kind: 'contact',
            text: `     ${batterAction} to ${e.sprayDirection}`,
            color: 'text-amber-300',
          });
          out.push({
            time, kind: 'contact',
            text: `     — EV ${ev} mph | LA ${la}° | Spray ${spray}° | ${dist} ft${apex}${hang}`,
            color: 'text-amber-200',
          });
        }
        break;
      }

      // ── FIELDING EVENTS (#1 accumulator, #3 debug coords) ─
      case 'ball-landed': {
        if (debugBallCoords) {
          out.push({
            time, kind: 'debug',
            text: `  📍 ball landed (${Math.round(e.at.x)}, ${Math.round(e.at.y)}) — ground bounce`,
            color: 'text-zinc-500',
          });
        }
        break;
      }

      case 'ball-caught': {
        const pos = displayPos(e.by);
        const who = formatPlayerTag(e.playerName, e.playerId, pos);
        st.fieldingChain.push({ pos, name: who, action: 'caught', at: e.at });
        if (debugBallCoords) {
          out.push({
            time, kind: 'debug',
            text: `  📍 ball caught (${Math.round(e.at.x)}, ${Math.round(e.at.y)}) — in the air`,
            color: 'text-zinc-500',
          });
        }
        break;
      }

      case 'ball-fielded': {
        const pos = displayPos(e.by);
        const who = formatPlayerTag(e.playerName, e.playerId, pos);
        st.fieldingChain.push({ pos, name: who, action: 'fielded', at: e.at });
        if (debugBallCoords) {
          out.push({
            time, kind: 'debug',
            text: `  📍 ball fielded at (${Math.round(e.at.x)}, ${Math.round(e.at.y)})`,
            color: 'text-zinc-500',
          });
        }
        break;
      }

      case 'throw-released': {
        const pos = displayPos(e.from);
        const who = formatPlayerTag(e.fromName, e.fromId, pos);
        st.fieldingChain.push({ pos, name: who, action: 'threw' });
        break;
      }

      case 'ball-received': {
        const pos = displayPos(e.by);
        const who = formatPlayerTag(e.playerName, e.playerId, pos);
        st.fieldingChain.push({ pos, name: who, action: 'received' });
        break;
      }

      // ── WALL EVENTS (#4 — description always, coords debug) ──
      case 'wall-bounce': {
        let text = `  💥 OFF THE WALL!`;
        if (debugBallCoords) text += ` at (${Math.round(e.at.x)}, ${Math.round(e.at.y)})`;
        out.push({ time, kind: 'play', bold: true, text, color: 'text-orange-300' });
        break;
      }

      case 'wall-cleared': {
        const h = e.heightFt != null && e.heightFt > 0.5 ? `, height ${Math.round(e.heightFt)} ft` : '';
        let text = `  🧱 Cleared the wall!${h}`;
        if (debugBallCoords) text = `  🧱 Cleared the wall at (${Math.round(e.at.x)}, ${Math.round(e.at.y)})${h}`;
        out.push({ time, kind: 'play', bold: true, text, color: 'text-yellow-200' });
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

      // ── RUNNER EVENTS (flush fielding accumulator) ──────────
      case 'runner-safe': {
        const runner = formatPlayerTag(e.runnerName, e.runnerId, 'Runner');
        const base = baseShort(e.base);

        // Look ahead: does an at-bat-end in this same batch say the result is an out?
        const abEnd = events.find((ev): ev is TickEvent & { type: 'at-bat-end' } =>
          ev.type === 'at-bat-end',
        );
        const isOutResult = abEnd && ['ground-out', 'fly-out', 'line-out', 'pop-out',
          'foul-out', 'strikeout', 'double-play', 'fielders-choice', 'sac-fly'].includes(abEnd.result);

        // Suppress runner-safe for the batter when the at-bat result is an out
        if (isOutResult && e.runnerId === abEnd.batterId) {
          break;
        }

        // Suppress intermediate-base runner-safe for the batter on a HR trot.
        // The batter passes through 1B, 2B, 3B on the way home — only show
        // the final "slides in safely at home!" (or nothing, the HR line covers it).
        const isHR = abEnd && abEnd.result === 'home-run';
        if (isHR && e.runnerId === abEnd.batterId && e.base !== 'home') {
          break;
        }

        // Suppress runner-safe on 3rd out (LOB, not safe)
        const outsBeforeAB = st.currentOuts ?? 0;
        if (isOutResult && outsBeforeAB >= 2) {
          // 3rd out — remaining runners are LOB, don't show as "safe"
          break;
        }

        const verb = base === 'home' ? `slides in safely at home!` : `is safe at ${base}`;
        out.push({
          time, kind: 'play',
          text: `  ✅ ${runner} ${verb}`,
          color: 'text-emerald-300',
        });
        break;
      }

      case 'runner-out': {
        const runner = formatPlayerTag(e.runnerName, e.runnerId, 'Runner');
        const at = baseShort(e.at);
        // Build condensed fielding line with scoring notation (#1, #2)
        const chain = st.fieldingChain;
        if (chain.length > 0) {
          const first = chain[0];
          // Build scoring notation: filter out 'received', map to position
          // numbers, deduplicate consecutive same-position entries (e.g.
          // pitcher fields + throws = just '1', not '1-1'), then append
          // the receiver (putout) position.
          const scoringNums = chain
            .filter(c => c.action !== 'received')
            .map(c => POS_NUM[c.pos] ?? c.pos)
            .filter((num, i, arr) => i === 0 || num !== arr[i - 1]);
          const receiver = chain.find(c => c.action === 'received');
          if (receiver) scoringNums.push(POS_NUM[receiver.pos] ?? receiver.pos);
          const isCatch = first.action === 'caught';
          const scoringStr = isCatch
            ? `(F${POS_NUM[first.pos] ?? first.pos})`
            : `(${scoringNums.join('-')})`;

          if (isCatch) {
            out.push({
              time, kind: 'play',
              text: `  🧤 ${first.name} (${first.pos}) makes the catch — ${runner} is OUT ${scoringStr}`,
              color: 'text-green-300',
            });
          } else {
            // Find the receiver
            const receiver = chain.find(c => c.action === 'received');
            const receiverPart = receiver ? ` to ${lastNameOnly(receiver.name)} at ${at}` : ` to ${at}`;
            out.push({
              time, kind: 'play',
              text: `  🏃 ${first.name} (${first.pos}) fields and throws${receiverPart} — ${runner} is OUT ${scoringStr}`,
              color: 'text-green-300',
            });
          }
          st.fieldingChain = [];
        } else {
          out.push({
            time, kind: 'play',
            text: `  ❌ ${runner} is OUT at ${at}!`,
            color: 'text-red-400',
          });
        }
        break;
      }

      case 'runner-scored': {
        const runner = formatPlayerTag(e.runnerName, e.runnerId, 'Runner');
        st.inningRuns++;
        out.push({
          time, kind: 'score', bold: true,
          text: `  🏠 ${runner} scores!`,
          color: 'text-emerald-400',
        });
        break;
      }

      // ── AT-BAT RESULT (#5 — removed fieldedBy) ────────────
      case 'at-bat-end': {
        const batter = formatPlayerTag(e.batterName, e.batterId, 'Batter');
        const r = resultLabel(e.result);
        const rbi = e.rbis > 0 ? ` (${e.rbis} RBI)` : '';
        const isOut = ['ground-out', 'fly-out', 'line-out', 'pop-out', 'foul-out',
          'strikeout', 'double-play', 'fielders-choice', 'sac-fly'].includes(e.result);
        // Track hits for inning summary
        if (['single', 'double', 'triple', 'home-run'].includes(e.result)) {
          st.inningHits++;
        }
        // Flush fielding chain — if result is an out but tick engine didn't
        // emit a runner-out, build the fielding line from the chain.
        const chain = st.fieldingChain;
        if (chain.length > 0 && isOut) {
          const first = chain[0];
          // Build scoring notation: filter out 'received', map to position
          // numbers, deduplicate consecutive same-position entries, then
          // append the receiver (putout) position.
          const scoringNums = chain
            .filter(c => c.action !== 'received')
            .map(c => POS_NUM[c.pos] ?? c.pos)
            .filter((num, i, arr) => i === 0 || num !== arr[i - 1]);
          const receiver = chain.find(c => c.action === 'received');
          if (receiver) scoringNums.push(POS_NUM[receiver.pos] ?? receiver.pos);
          const isCatch = first.action === 'caught';
          const scoringStr = isCatch
            ? `(F${POS_NUM[first.pos] ?? first.pos})`
            : `(${scoringNums.join('-')})`;

          if (isCatch) {
            out.push({
              time, kind: 'play',
              text: `  🧤 ${first.name} (${first.pos}) makes the catch — ${batter} is OUT ${scoringStr}`,
              color: 'text-green-300',
            });
          } else {
            const receiver = chain.find(c => c.action === 'received');
            const receiverPart = receiver ? ` to ${lastNameOnly(receiver.name)}` : '';
            out.push({
              time, kind: 'play',
              text: `  🏃 ${first.name} (${first.pos}) fields and throws${receiverPart} — ${batter} is OUT ${scoringStr}`,
              color: 'text-green-300',
            });
          }
        }
        st.fieldingChain = [];
        out.push({
          time, kind: 'result', bold: true,
          text: `→ ${batter}: ${r}${rbi}`,
          color: e.result === 'home-run' ? 'text-yellow-300' :
            ['single', 'double', 'triple', 'walk', 'hbp', 'reached-on-error'].includes(e.result)
              ? 'text-emerald-300' : 'text-red-300',
        });
        break;
      }

      // ── RUNDOWN EVENTS ─────────────────────────────────────────
      case 'rundown-start': {
        const runner = formatPlayerTag(e.runnerName, e.runnerId, 'Runner');
        out.push({
          time, kind: 'play',
          text: `🔄 ${runner} caught in a rundown between ${baseShort(e.between[0])} and ${baseShort(e.between[1])}!`,
          color: 'text-amber-300',
        });
        break;
      }

      case 'rundown-throw': {
        // Silent — just for animation; too noisy for PBP text
        break;
      }

      case 'rundown-end': {
        const runner = formatPlayerTag(e.runnerName, e.runnerId, 'Runner');
        if (e.result === 'out') {
          out.push({
            time, kind: 'play',
            text: `❌ ${runner} tagged out ${e.at}`,
            color: 'text-red-400',
          });
        } else {
          out.push({
            time, kind: 'play',
            text: `✅ ${runner} escapes the rundown! Safe at ${baseShort(e.at)}`,
            color: 'text-emerald-400',
          });
        }
        break;
      }

      case 'play-complete':
        break;

      // ── INNING CHANGE (#10 — summary + separator) ──────────
      case 'inning-change': {
        // Emit summary for the PREVIOUS half-inning (if any)
        if (st.lastHalf != null && st.lastInning != null) {
          const prevInn = ORD[st.lastInning - 1] ?? `${st.lastInning}th`;
          const prevLabel = halfLabel(st.lastHalf);
          const home = st.lastHomeName ?? 'Home';
          const away = st.lastAwayName ?? 'Away';
          const hs = st.lastHomeScore ?? 0;
          const as = st.lastAwayScore ?? 0;
          const runTxt = st.inningRuns === 1 ? '1 run' : `${st.inningRuns} runs`;
          const hitTxt = st.inningHits === 1 ? '1 hit' : `${st.inningHits} hits`;
          out.push({
            time, kind: 'inning',
            text: `  End ${prevLabel} ${prevInn} — ${away} ${as}, ${home} ${hs} (${runTxt}, ${hitTxt} this inning)`,
            color: 'text-zinc-400',
          });
          out.push({
            time, kind: 'inning',
            text: `  ════════════════════════════════════════`,
            color: 'text-zinc-600',
          });
        }
        // Reset counters for new half-inning
        st.inningRuns = 0;
        st.inningHits = 0;
        st.lastHalf = e.half;
        st.lastInning = e.inning;
        // New inning header
        const inn = ORD[e.inning - 1] ?? `${e.inning}th`;
        out.push({
          time, kind: 'inning', bold: true,
          text: `\n══════ ${halfLabel(e.half)} ${inn} ══════`,
          color: 'text-zinc-100',
        });
        break;
      }

      // ── MANAGER EVENTS (#9 — narrative) ────────────────────
      case 'manager-signal': {
        const narratives: Record<string, string> = {
          'mound-visit': 'Manager calls time, heads out to the mound',
          'pitching-change': 'Manager signals to the bullpen for a pitching change',
          'intentional-walk': 'Manager signals for an intentional walk',
        };
        const text = narratives[e.decision] ?? `Manager decision: ${e.detail}`;
        out.push({ time, kind: 'flow', text: `  📋 ${text}`, color: 'text-cyan-300' });
        break;
      }

      case 'defensive-shift': {
        out.push({
          time, kind: 'flow',
          text: `  ⚙️ Manager adjusts the defensive alignment`,
          color: 'text-cyan-300',
        });
        break;
      }

      // ── BASERUNNING / MISCUE EVENTS (#7 stubs) ─────────────
      case 'stolen-base': {
        const runner = formatPlayerTag(e.runnerName, e.runnerId, 'Runner');
        out.push({
          time, kind: 'play', bold: true,
          text: `  🏃 ${runner} steals ${baseShort(e.base)}!`,
          color: 'text-emerald-300',
        });
        break;
      }

      case 'caught-stealing': {
        const runner = formatPlayerTag(e.runnerName, e.runnerId, 'Runner');
        out.push({
          time, kind: 'play', bold: true,
          text: `  ❌ ${runner} caught stealing at ${baseShort(e.at)}!`,
          color: 'text-red-400',
        });
        break;
      }

      case 'wild-pitch': {
        const pitcher = formatPlayerTag(e.pitcherName, e.pitcherId, 'Pitcher');
        out.push({
          time, kind: 'play', bold: true,
          text: `  ⚠️ Wild pitch by ${pitcher}!`,
          color: 'text-orange-300',
        });
        break;
      }

      case 'passed-ball': {
        const catcher = formatPlayerTag(e.catcherName, e.catcherId, 'Catcher');
        out.push({
          time, kind: 'play', bold: true,
          text: `  ⚠️ Passed ball by ${catcher}!`,
          color: 'text-orange-300',
        });
        break;
      }

      case 'balk': {
        const pitcher = formatPlayerTag(e.pitcherName, e.pitcherId, 'Pitcher');
        out.push({
          time, kind: 'play', bold: true,
          text: `  ⚠️ Balk called on ${pitcher} — runners advance`,
          color: 'text-orange-300',
        });
        break;
      }

      default:
        break;
    }
  }

  return out;
}
