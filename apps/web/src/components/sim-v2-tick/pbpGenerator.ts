/**
 * Play-by-Play generator for the tick engine.
 *
 * Converts raw TickEvents into human-readable, broadcast-style
 * play-by-play text. Uses player name resolution and baseball
 * terminology to produce lines like:
 *
 *   "📢 Hard grounder to short! Torres fields and throws to first..."
 *   "⚾ 95 mph fastball, LA 28° — deep to center, 390 ft!"
 *   "🧤 Caught by Edwards in right-center — one away!"
 *
 * The PBP generator is stateful — it tracks the at-bat sequence
 * to provide context-aware commentary (e.g. "on the 2-1 pitch").
 */
import type { TickEvent, Point2D } from './entities';
import type { PitchCall, ManagerSignal, DefensiveAlignment } from './aiManager';

// ─── Player name lookup ──────────────────────────────────────────

export interface PBPContext {
  /** Map of player ID → display name. */
  playerNames: Map<number, string>;
  /** Map of position → display name (for fielders). */
  positionNames: Map<string, string>;
  /** Current count (balls-strikes). */
  balls: number;
  strikes: number;
  /** Current outs. */
  outs: number;
  /** Inning display. */
  inning: string;
  /** Running PBP log. */
  lines: PBPLine[];
}

export interface PBPLine {
  time: number;
  text: string;
  category: 'contact' | 'fielding' | 'pitch' | 'runner' | 'manager' | 'result';
  importance: 'routine' | 'notable' | 'dramatic';
}

const POSITION_LABELS: Record<string, string> = {
  P: 'pitcher',
  C: 'catcher',
  B1: 'first baseman',
  B2: 'second baseman',
  SS: 'shortstop',
  B3: 'third baseman',
  LF: 'left fielder',
  CF: 'center fielder',
  RF: 'right fielder',
};

const FIELD_ZONE: Record<string, string> = {
  LF: 'left field',
  CF: 'center field',
  RF: 'right field',
  B1: 'first base side',
  B2: 'up the middle',
  SS: 'the hole',
  B3: 'third base side',
};

// ─── Main generator ──────────────────────────────────────────────

export function createPBPContext(): PBPContext {
  return {
    playerNames: new Map(),
    positionNames: new Map(),
    balls: 0,
    strikes: 0,
    outs: 0,
    inning: 'T1',
    lines: [],
  };
}

/**
 * Generate PBP text from a tick event.
 * Returns the new PBP line(s) to add to the log.
 */
export function generatePBP(
  event: TickEvent,
  ctx: PBPContext,
  time: number,
): PBPLine[] {
  const lines: PBPLine[] = [];

  switch (event.type) {
    // ─── Contact ───────────────────────────────────────
    case 'contact': {
      const zone = sprayZone(event.sprayAngleDeg);
      const type = hitType(event.launchAngleDeg, event.exitVeloMph);
      const velo = event.exitVeloMph.toFixed(0);
      const la = event.launchAngleDeg.toFixed(0);

      lines.push({
        time,
        text: `⚾ ${velo} mph ${type} to ${zone}, LA ${la}°`,
        category: 'contact',
        importance: event.exitVeloMph >= 100 ? 'dramatic' : 'routine',
      });
      break;
    }

    // ─── Ball flight ──────────────────────────────────
    case 'ball-landed': {
      const dist = Math.hypot(event.at.x, event.at.y).toFixed(0);
      lines.push({
        time,
        text: `📍 Ball lands at ${dist} ft`,
        category: 'fielding',
        importance: 'routine',
      });
      break;
    }

    // ─── Catches ──────────────────────────────────────
    case 'ball-caught': {
      const who = ctx.positionNames.get(event.by) ?? POSITION_LABELS[event.by] ?? event.by;
      const dist = Math.hypot(event.at.x, event.at.y).toFixed(0);
      ctx.outs++;
      lines.push({
        time,
        text: `🧤 Caught by ${who}! ${outsText(ctx.outs)}`,
        category: 'fielding',
        importance: ctx.outs === 3 ? 'dramatic' : 'notable',
      });
      break;
    }

    case 'ball-fielded': {
      const who = ctx.positionNames.get(event.by) ?? POSITION_LABELS[event.by] ?? event.by;
      lines.push({
        time,
        text: `🏃 Fielded cleanly by ${who}`,
        category: 'fielding',
        importance: 'routine',
      });
      break;
    }

    // ─── Throws ───────────────────────────────────────
    case 'throw-released': {
      const who = ctx.positionNames.get(event.from) ?? POSITION_LABELS[event.from] ?? event.from;
      const base = baseLabel(event.toBase);
      lines.push({
        time,
        text: `💨 ${who} throws to ${base}`,
        category: 'fielding',
        importance: 'routine',
      });
      break;
    }

    case 'ball-received': {
      const who = ctx.positionNames.get(event.by) ?? POSITION_LABELS[event.by] ?? event.by;
      lines.push({
        time,
        text: `🧤 Received by ${who}`,
        category: 'fielding',
        importance: 'routine',
      });
      break;
    }

    // ─── Wall events ──────────────────────────────────
    case 'wall-bounce': {
      lines.push({
        time,
        text: `💥 Off the wall!`,
        category: 'fielding',
        importance: 'notable',
      });
      break;
    }

    case 'home-run': {
      lines.push({
        time,
        text: `🚀 HOME RUN! ${event.distanceFt} ft!`,
        category: 'result',
        importance: 'dramatic',
      });
      break;
    }

    // ─── Runner events ────────────────────────────────
    case 'runner-safe': {
      const name = ctx.playerNames.get(event.runnerId) ?? `Runner #${event.runnerId}`;
      const base = baseLabel(event.base);
      lines.push({
        time,
        text: `✅ ${name} reaches ${base} safely`,
        category: 'runner',
        importance: event.base === 'home' ? 'dramatic' : 'routine',
      });
      break;
    }

    case 'runner-out': {
      const name = ctx.playerNames.get(event.runnerId) ?? `Runner #${event.runnerId}`;
      ctx.outs++;
      lines.push({
        time,
        text: `❌ ${name} is OUT at ${baseLabel(event.at)}! ${outsText(ctx.outs)}`,
        category: 'runner',
        importance: ctx.outs === 3 ? 'dramatic' : 'notable',
      });
      break;
    }

    case 'runner-scored': {
      const name = ctx.playerNames.get(event.runnerId) ?? `Runner #${event.runnerId}`;
      lines.push({
        time,
        text: `🏠 ${name} SCORES!`,
        category: 'runner',
        importance: 'dramatic',
      });
      break;
    }

    // ─── Pitch events ─────────────────────────────────
    case 'pitch': {
      const speed = event.speed;
      const zone = event.zone === 'in' ? 'in the zone' :
                   event.zone === 'edge' ? 'on the corner' :
                   'off the plate';
      lines.push({
        time,
        text: `⚾ Pitch ${event.pitchNum}: ${speed} ${zone}`,
        category: 'pitch',
        importance: 'routine',
      });
      break;
    }

    case 'pitch-result': {
      const count = `${event.balls}-${event.strikes}`;
      ctx.balls = event.balls;
      ctx.strikes = event.strikes;
      lines.push({
        time,
        text: `📊 ${event.outcome} — count: ${count}`,
        category: 'pitch',
        importance: event.outcome === 'strikeout' || event.outcome === 'walk'
          ? 'notable' : 'routine',
      });
      break;
    }

    // ─── Manager signals ──────────────────────────────
    case 'manager-signal': {
      lines.push({
        time,
        text: `📋 Manager: ${event.decision} — ${event.detail}`,
        category: 'manager',
        importance: event.decision.includes('steal') || event.decision.includes('bunt')
          ? 'notable' : 'routine',
      });
      break;
    }

    case 'defensive-shift': {
      lines.push({
        time,
        text: `⚙️ Defensive alignment adjusting`,
        category: 'manager',
        importance: 'routine',
      });
      break;
    }

    // ─── Game flow ────────────────────────────────────
    case 'play-complete': {
      lines.push({
        time,
        text: `── Play complete ──`,
        category: 'result',
        importance: 'routine',
      });
      break;
    }

    case 'inning-change': {
      const half = event.half === 'top' ? 'Top' : 'Bottom';
      ctx.outs = 0;
      ctx.inning = `${half[0]}${event.inning}`;
      lines.push({
        time,
        text: `\n═══ ${half} of the ${ordinal(event.inning)} ═══`,
        category: 'result',
        importance: 'notable',
      });
      break;
    }
  }

  ctx.lines.push(...lines);
  return lines;
}

// ─── PBP for manager decisions ───────────────────────────────────

export function pbpForPitchCall(call: PitchCall): string {
  return `🎯 ${call.reasoning} — ${call.speed} ${call.zone === 'in' ? 'inside' : call.zone}`;
}

export function pbpForSignal(signal: ManagerSignal): string {
  const icons: Record<string, string> = {
    steal: '🏃💨',
    bunt: '📌',
    'hit-and-run': '🏃⚾',
    take: '✋',
    'swing-away': '⚾',
  };
  return `${icons[signal.type] ?? '📋'} ${signal.reasoning}`;
}

export function pbpForAlignment(alignment: DefensiveAlignment): string {
  return `⚙️ Defense: ${alignment.description}`;
}

// ─── Helpers ─────────────────────────────────────────────────────

function sprayZone(sprayDeg: number): string {
  const abs = Math.abs(sprayDeg);
  if (abs < 10) return 'center field';
  if (sprayDeg < -30) return 'left field line';
  if (sprayDeg < -10) return 'left-center';
  if (sprayDeg > 30) return 'right field line';
  if (sprayDeg > 10) return 'right-center';
  return 'center field';
}

function hitType(launchAngle: number, exitVelo: number): string {
  if (launchAngle < 0) return 'chopper';
  if (launchAngle < 10) return exitVelo > 95 ? 'hard grounder' : 'grounder';
  if (launchAngle < 20) return exitVelo > 100 ? 'screaming liner' : 'line drive';
  if (launchAngle < 30) return exitVelo > 95 ? 'deep fly ball' : 'fly ball';
  if (launchAngle < 45) return 'high fly ball';
  return 'towering pop-up';
}

function baseLabel(base: string): string {
  const labels: Record<string, string> = {
    home: 'home plate',
    first: 'first base',
    second: 'second base',
    third: 'third base',
  };
  return labels[base] ?? base;
}

function outsText(outs: number): string {
  if (outs >= 3) return '3 outs — side retired!';
  return `${outs} out${outs !== 1 ? 's' : ''}`;
}

function ordinal(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}
