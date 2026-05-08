// Last touched by agent: 2026-05-06T16:24:08Z
// Purpose: Build league smoke-test rate and batted-ball distribution summaries.

import { SupabaseClient } from '@supabase/supabase-js';

interface BuildSummaryOptions {
  leagueId?: number;
  seasonNo?: number;
}

interface GameRow {
  id: number;
  schedule_id: number | null;
  home_runs: number;
  visitor_runs: number;
  home_hits: number;
  visitor_hits: number;
}

interface ScheduleRow {
  id: number;
}

interface HittingRow {
  ab: number;
  h: number;
  b2: number;
  b3: number;
  hr: number;
  bb: number;
  so: number;
  sf: number;
  sac: number;
}

interface EventTelemetryRow {
  spray_angle_deg: number | null;
  launch_angle_deg: number | null;
}

interface SprayBucket {
  label: string;
  fair: number;
  foul: number;
}

interface LaunchBucket {
  label: string;
  count: number;
}

export interface SimSmokeSummary {
  scope: {
    leagueId: number | null;
    seasonNo: number | null;
  };
  games: number;
  teamGames: number;
  rates: {
    plateAppearances: number;
    atBats: number;
    hits: number;
    homeRuns: number;
    walks: number;
    strikeouts: number;
    bbPct: number;
    kPct: number;
    babip: number;
    hrPerFb: number;
  };
  perTeamGame: {
    runs: number;
    hits: number;
    doubles: number;
    triples: number;
    homeRuns: number;
  };
  spray: {
    total: number;
    fair: number;
    foul: number;
    meanDeg: number;
    meanAbsDeg: number;
    buckets: SprayBucket[];
  };
  launch: {
    total: number;
    grounders: number;
    flyPop: number;
    meanDeg: number;
    meanAbsDeg: number;
    buckets: LaunchBucket[];
  };
  notes: string[];
}

const SPRAY_LABELS = [
  'foul-L (<-45)',
  'LF-line (-45..-30)',
  'LF (-30..-10)',
  'CF (-10..+10)',
  'RF (+10..+30)',
  'RF-line (+30..+45)',
  'foul-R (>+45)',
] as const;

const LAUNCH_LABELS = [
  'grounder (<5deg)',
  'low-liner (5..15deg)',
  'line-drive (15..25deg)',
  'fly-ball (25..35deg)',
  'high-fly (35..50deg)',
  'pop-up (>50deg)',
] as const;

function safeDiv(numerator: number, denominator: number): number {
  return numerator / Math.max(1, denominator);
}

function classifySprayLabel(sprayDeg: number): (typeof SPRAY_LABELS)[number] {
  if (sprayDeg < -45) return 'foul-L (<-45)';
  if (sprayDeg < -30) return 'LF-line (-45..-30)';
  if (sprayDeg < -10) return 'LF (-30..-10)';
  if (sprayDeg < 10) return 'CF (-10..+10)';
  if (sprayDeg < 30) return 'RF (+10..+30)';
  if (sprayDeg <= 45) return 'RF-line (+30..+45)';
  return 'foul-R (>+45)';
}

function classifyLaunchLabel(launchDeg: number): (typeof LAUNCH_LABELS)[number] {
  if (launchDeg < 5) return 'grounder (<5deg)';
  if (launchDeg < 15) return 'low-liner (5..15deg)';
  if (launchDeg < 25) return 'line-drive (15..25deg)';
  if (launchDeg < 35) return 'fly-ball (25..35deg)';
  if (launchDeg <= 50) return 'high-fly (35..50deg)';
  return 'pop-up (>50deg)';
}

function createEmptySummary(opts: BuildSummaryOptions): SimSmokeSummary {
  return {
    scope: {
      leagueId: opts.leagueId ?? null,
      seasonNo: opts.seasonNo ?? null,
    },
    games: 0,
    teamGames: 0,
    rates: {
      plateAppearances: 0,
      atBats: 0,
      hits: 0,
      homeRuns: 0,
      walks: 0,
      strikeouts: 0,
      bbPct: 0,
      kPct: 0,
      babip: 0,
      hrPerFb: 0,
    },
    perTeamGame: {
      runs: 0,
      hits: 0,
      doubles: 0,
      triples: 0,
      homeRuns: 0,
    },
    spray: {
      total: 0,
      fair: 0,
      foul: 0,
      meanDeg: 0,
      meanAbsDeg: 0,
      buckets: SPRAY_LABELS.map((label) => ({ label, fair: 0, foul: 0 })),
    },
    launch: {
      total: 0,
      grounders: 0,
      flyPop: 0,
      meanDeg: 0,
      meanAbsDeg: 0,
      buckets: LAUNCH_LABELS.map((label) => ({ label, count: 0 })),
    },
    notes: [
      'Pitch-level metrics (pitches/PA and foul rates) are not persisted in schedule summaries.',
      'HR/FB is estimated from launch-angle buckets where launch angle >= 25deg.',
    ],
  };
}

export async function buildSimSmokeSummary(
  supabase: SupabaseClient,
  opts: BuildSummaryOptions,
): Promise<SimSmokeSummary> {
  const summary = createEmptySummary(opts);

  let seasonScheduleIds: Set<number> | null = null;
  if (opts.seasonNo) {
    let scheduleQuery = supabase
      .from('schedules')
      .select('id');

    if (opts.leagueId) {
      scheduleQuery = scheduleQuery.eq('league_id', opts.leagueId);
    }

    scheduleQuery = scheduleQuery.eq('season_no', opts.seasonNo);

    const { data: schedules, error: scheduleErr } = await scheduleQuery;
    if (scheduleErr) {
      throw new Error(`Failed to load schedules for summary: ${scheduleErr.message}`);
    }

    seasonScheduleIds = new Set((schedules ?? []).map((row: ScheduleRow) => row.id));
    if (seasonScheduleIds.size === 0) {
      summary.notes.push('No schedules found for the requested league/season scope.');
      return summary;
    }
  }

  let gamesQuery = supabase
    .from('games')
    .select('id, schedule_id, home_runs, visitor_runs, home_hits, visitor_hits');

  if (opts.leagueId) {
    gamesQuery = gamesQuery.eq('league_id', opts.leagueId);
  }

  const { data: rawGames, error: gamesErr } = await gamesQuery;
  if (gamesErr) {
    throw new Error(`Failed to load games for summary: ${gamesErr.message}`);
  }

  const scopedGames = (rawGames ?? []).filter((game: GameRow) => {
    if (typeof game.schedule_id !== 'number') return false;
    if (seasonScheduleIds && !seasonScheduleIds.has(game.schedule_id)) return false;
    return true;
  });

  if (scopedGames.length === 0) {
    summary.notes.push('No played schedule games found in the requested scope.');
    return summary;
  }

  summary.games = scopedGames.length;
  summary.teamGames = summary.games * 2;

  const gameIds = scopedGames.map((game: GameRow) => game.id);

  const [{ data: hittingRows, error: hittingErr }, { data: eventRows, error: eventErr }] = await Promise.all([
    supabase
      .from('game_stats_hitting')
      .select('ab, h, b2, b3, hr, bb, so, sf, sac')
      .in('game_id', gameIds),
    supabase
      .from('game_events')
      .select('spray_angle_deg, launch_angle_deg')
      .in('game_id', gameIds),
  ]);

  if (hittingErr) {
    throw new Error(`Failed to load hitting rows for summary: ${hittingErr.message}`);
  }

  if (eventErr) {
    throw new Error(`Failed to load event rows for summary: ${eventErr.message}`);
  }

  let totalRuns = 0;
  let totalHitsFromGames = 0;
  for (const game of scopedGames) {
    totalRuns += game.home_runs + game.visitor_runs;
    totalHitsFromGames += game.home_hits + game.visitor_hits;
  }

  let totalAb = 0;
  let totalHitsFromHitting = 0;
  let totalDoubles = 0;
  let totalTriples = 0;
  let totalHr = 0;
  let totalBb = 0;
  let totalSo = 0;
  let totalSf = 0;
  let totalSac = 0;

  for (const row of (hittingRows ?? []) as HittingRow[]) {
    totalAb += row.ab;
    totalHitsFromHitting += row.h;
    totalDoubles += row.b2;
    totalTriples += row.b3;
    totalHr += row.hr;
    totalBb += row.bb;
    totalSo += row.so;
    totalSf += row.sf;
    totalSac += row.sac;
  }

  const sprayBuckets = new Map(summary.spray.buckets.map((bucket) => [bucket.label, bucket]));
  const launchBuckets = new Map(summary.launch.buckets.map((bucket) => [bucket.label, bucket]));

  let spraySum = 0;
  let sprayAbsSum = 0;
  let launchSum = 0;
  let launchAbsSum = 0;

  for (const row of (eventRows ?? []) as EventTelemetryRow[]) {
    if (typeof row.spray_angle_deg === 'number') {
      const sprayDeg = row.spray_angle_deg;
      summary.spray.total += 1;
      spraySum += sprayDeg;
      sprayAbsSum += Math.abs(sprayDeg);

      const sprayLabel = classifySprayLabel(sprayDeg);
      const sprayBucket = sprayBuckets.get(sprayLabel);
      if (sprayBucket) {
        if (sprayDeg < -45 || sprayDeg > 45) {
          sprayBucket.foul += 1;
          summary.spray.foul += 1;
        } else {
          sprayBucket.fair += 1;
          summary.spray.fair += 1;
        }
      }
    }

    if (typeof row.launch_angle_deg === 'number') {
      const launchDeg = row.launch_angle_deg;
      summary.launch.total += 1;
      launchSum += launchDeg;
      launchAbsSum += Math.abs(launchDeg);

      const launchLabel = classifyLaunchLabel(launchDeg);
      const launchBucket = launchBuckets.get(launchLabel);
      if (launchBucket) {
        launchBucket.count += 1;
      }

      if (launchDeg < 5) {
        summary.launch.grounders += 1;
      }

      if (launchDeg >= 25) {
        summary.launch.flyPop += 1;
      }
    }
  }

  summary.spray.meanDeg = safeDiv(spraySum, summary.spray.total);
  summary.spray.meanAbsDeg = safeDiv(sprayAbsSum, summary.spray.total);
  summary.launch.meanDeg = safeDiv(launchSum, summary.launch.total);
  summary.launch.meanAbsDeg = safeDiv(launchAbsSum, summary.launch.total);

  const totalHits = totalHitsFromHitting > 0 ? totalHitsFromHitting : totalHitsFromGames;
  const totalPa = totalAb + totalBb + totalSf + totalSac;
  const ballsInPlay = totalAb - totalSo - totalHr;

  summary.rates.plateAppearances = totalPa;
  summary.rates.atBats = totalAb;
  summary.rates.hits = totalHits;
  summary.rates.homeRuns = totalHr;
  summary.rates.walks = totalBb;
  summary.rates.strikeouts = totalSo;
  summary.rates.bbPct = safeDiv(totalBb, totalPa);
  summary.rates.kPct = safeDiv(totalSo, totalPa);
  summary.rates.babip = safeDiv(totalHits - totalHr, ballsInPlay);
  summary.rates.hrPerFb = safeDiv(totalHr, summary.launch.flyPop);

  summary.perTeamGame.runs = safeDiv(totalRuns, summary.teamGames);
  summary.perTeamGame.hits = safeDiv(totalHits, summary.teamGames);
  summary.perTeamGame.doubles = safeDiv(totalDoubles, summary.teamGames);
  summary.perTeamGame.triples = safeDiv(totalTriples, summary.teamGames);
  summary.perTeamGame.homeRuns = safeDiv(totalHr, summary.teamGames);

  return summary;
}
