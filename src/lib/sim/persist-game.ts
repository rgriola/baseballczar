/**
 * Persist a simulated game result to Supabase.
 *
 * Writes to: games, game_events, game_stats_hitting, game_stats_pitching,
 * player_stats_hitting, player_stats_pitching, standings, schedules,
 * team_budgets, financial_transactions.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { GameResult, GameStats, PitcherBoxLine } from '../sim-engine/types';
import { calculateGameRevenue } from '../sim-engine/GateReceipts';

interface PersistOptions {
  scheduleId: number;
  leagueId: number;
  seasonNo: number;
  gameType: 'regular' | 'playoff' | 'o2o';
  /** Map of playerId → { teamId, position, batOrder } for hitters */
  homeHitterMeta: Map<number, { teamId: number; position: string; batOrder: number }>;
  visitorHitterMeta: Map<number, { teamId: number; position: string; batOrder: number }>;
  /** Map of playerId → { teamId, pitchAppearance } for pitchers */
  homePitcherMeta: Map<number, { teamId: number }>;
  visitorPitcherMeta: Map<number, { teamId: number }>;
}

export async function persistGameResult(
  supabase: SupabaseClient,
  result: GameResult,
  opts: PersistOptions,
): Promise<number> {
  // 1. Insert game box score
  const { data: game, error: gameErr } = await supabase
    .from('games')
    .insert({
      schedule_id: opts.scheduleId,
      league_id: opts.leagueId,
      home_team_id: result.homeTeamId,
      visitor_team_id: result.visitorTeamId,
      home_runs: result.homeRuns,
      visitor_runs: result.visitorRuns,
      home_hits: result.homeHits,
      visitor_hits: result.visitorHits,
      innings: result.innings,
      winning_team_id: result.winningTeamId,
      losing_team_id: result.losingTeamId,
      home_linescore: result.scoreBoard.home.runs.slice(1), // drop index 0
      visitor_linescore: result.scoreBoard.visitor.runs.slice(1),
    })
    .select('id')
    .single();

  if (gameErr || !game) {
    throw new Error(`Failed to insert game: ${gameErr?.message}`);
  }

  const gameId = game.id;

  // 2. Insert game events (play-by-play)
  if (result.events.length > 0) {
    const eventInserts = result.events.map((e, i) => ({
      game_id: gameId,
      seq: i + 1,
      inning: e.inning,
      half: e.half,
      outs: e.outs,
      batter_name: e.batterName,
      pitcher_name: e.pitcherName,
      outcome: e.outcome,
      description: e.description,
      visitor_runs: e.visitorRuns,
      home_runs: e.homeRuns,
      visitor_hits: e.visitorHits,
      home_hits: e.homeHits,
      runners_scored: e.runnersScored,
    }));

    // Batch insert events (can be 300+)
    const BATCH = 200;
    for (let i = 0; i < eventInserts.length; i += BATCH) {
      const batch = eventInserts.slice(i, i + BATCH);
      const { error } = await supabase.from('game_events').insert(batch);
      if (error) throw new Error(`Failed to insert events batch: ${error.message}`);
    }
  }

  // 3. Insert game-by-game hitter stats
  const hitterRows = [
    ...buildHitterGameRows(gameId, result.homePlayerStats, opts.homeHitterMeta, result.visitorTeamId, opts.gameType),
    ...buildHitterGameRows(gameId, result.visitorPlayerStats, opts.visitorHitterMeta, result.homeTeamId, opts.gameType),
  ];
  if (hitterRows.length > 0) {
    const { error } = await supabase.from('game_stats_hitting').insert(hitterRows);
    if (error) throw new Error(`Failed to insert hitter game stats: ${error.message}`);
  }

  // 4. Insert game-by-game pitcher stats
  const pitcherRows = [
    ...buildPitcherGameRows(gameId, result.homePitcherStats, opts.homePitcherMeta, result.visitorTeamId, opts.gameType),
    ...buildPitcherGameRows(gameId, result.visitorPitcherStats, opts.visitorPitcherMeta, result.homeTeamId, opts.gameType),
  ];
  if (pitcherRows.length > 0) {
    const { error } = await supabase.from('game_stats_pitching').insert(pitcherRows);
    if (error) throw new Error(`Failed to insert pitcher game stats: ${error.message}`);
  }

  // 5. Upsert season hitter stats (accumulate)
  await upsertSeasonHitterStats(supabase, result.homePlayerStats, opts.homeHitterMeta, opts.seasonNo);
  await upsertSeasonHitterStats(supabase, result.visitorPlayerStats, opts.visitorHitterMeta, opts.seasonNo);

  // 6. Upsert season pitcher stats (accumulate)
  await upsertSeasonPitcherStats(supabase, result.homePitcherStats, opts.homePitcherMeta, opts.seasonNo);
  await upsertSeasonPitcherStats(supabase, result.visitorPitcherStats, opts.visitorPitcherMeta, opts.seasonNo);

  // 7. Update standings (W/L + team hitting totals)
  await updateStandings(supabase, result, opts);

  // 8. Mark schedule as played
  await supabase
    .from('schedules')
    .update({ played: true })
    .eq('id', opts.scheduleId);

  // 9. Process gate receipts
  await processRevenue(supabase, gameId, result, opts);

  return gameId;
}

// ─── Helpers ──────────────────────────────────────────────────

function buildHitterGameRows(
  gameId: number,
  statsMap: Map<number, GameStats>,
  meta: Map<number, { teamId: number; position: string; batOrder: number }>,
  oppTeamId: number,
  gameType: string,
) {
  const rows: Record<string, unknown>[] = [];
  for (const [playerId, stats] of Array.from(statsMap.entries())) {
    const m = meta.get(playerId);
    if (!m) continue;
    rows.push({
      game_id: gameId,
      player_id: playerId,
      team_id: m.teamId,
      opp_team_id: oppTeamId,
      bat_order: m.batOrder,
      position: m.position,
      game_type: gameType,
      g: 1,
      ab: stats.ab,
      r: stats.r,
      h: stats.hits,
      b2: stats.b2,
      b3: stats.b3,
      hr: stats.hr,
      rbi: stats.rbi,
      bb: stats.bb,
      so: stats.so,
      sb: 0,
      cs: 0,
      sf: 0,
      sac: 0,
    });
  }
  return rows;
}

function buildPitcherGameRows(
  gameId: number,
  statsMap: Map<number, PitcherBoxLine>,
  meta: Map<number, { teamId: number }>,
  oppTeamId: number,
  gameType: string,
) {
  const rows: Record<string, unknown>[] = [];
  for (const [playerId, stats] of Array.from(statsMap.entries())) {
    if (stats.g === 0) continue; // didn't appear
    const m = meta.get(playerId);
    if (!m) continue;
    rows.push({
      game_id: gameId,
      player_id: playerId,
      team_id: m.teamId,
      opp_team_id: oppTeamId,
      pitch_app: stats.g,
      game_type: gameType,
      w: stats.w,
      l: stats.l,
      g: stats.g,
      gs: stats.gs,
      cg: stats.cg,
      sho: stats.sho,
      sv: stats.sv,
      ip: stats.ip,
      ab: stats.bf - stats.bb,
      r: stats.r,
      er: stats.er,
      h: stats.h,
      b2: 0,
      b3: 0,
      hr: stats.hr,
      rbi: 0,
      bb: stats.bb,
      so: stats.so,
    });
  }
  return rows;
}

async function upsertSeasonHitterStats(
  supabase: SupabaseClient,
  statsMap: Map<number, GameStats>,
  meta: Map<number, { teamId: number; position: string; batOrder: number }>,
  seasonNo: number,
) {
  for (const [playerId, stats] of Array.from(statsMap.entries())) {
    const m = meta.get(playerId);
    if (!m) continue;

    // Try to find existing row
    const { data: existing } = await supabase
      .from('player_stats_hitting')
      .select('id, g, ab, r, h, b2, b3, hr, rbi, bb, so')
      .eq('player_id', playerId)
      .eq('team_id', m.teamId)
      .eq('season_no', seasonNo)
      .single();

    if (existing) {
      await supabase
        .from('player_stats_hitting')
        .update({
          g: existing.g + 1,
          ab: existing.ab + stats.ab,
          r: existing.r + stats.r,
          h: existing.h + stats.hits,
          b2: existing.b2 + stats.b2,
          b3: existing.b3 + stats.b3,
          hr: existing.hr + stats.hr,
          rbi: existing.rbi + stats.rbi,
          bb: existing.bb + stats.bb,
          so: existing.so + stats.so,
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('player_stats_hitting').insert({
        player_id: playerId,
        team_id: m.teamId,
        season_no: seasonNo,
        g: 1,
        ab: stats.ab,
        r: stats.r,
        h: stats.hits,
        b2: stats.b2,
        b3: stats.b3,
        hr: stats.hr,
        rbi: stats.rbi,
        bb: stats.bb,
        so: stats.so,
      });
    }
  }
}

async function upsertSeasonPitcherStats(
  supabase: SupabaseClient,
  statsMap: Map<number, PitcherBoxLine>,
  meta: Map<number, { teamId: number }>,
  seasonNo: number,
) {
  for (const [playerId, stats] of Array.from(statsMap.entries())) {
    if (stats.g === 0) continue;
    const m = meta.get(playerId);
    if (!m) continue;

    const { data: existing } = await supabase
      .from('player_stats_pitching')
      .select('id, w, l, g, gs, cg, sv, sho, ip, bf, h, r, er, bb, so, hr')
      .eq('player_id', playerId)
      .eq('team_id', m.teamId)
      .eq('season_no', seasonNo)
      .single();

    if (existing) {
      await supabase
        .from('player_stats_pitching')
        .update({
          w: existing.w + stats.w,
          l: existing.l + stats.l,
          g: existing.g + stats.g,
          gs: existing.gs + stats.gs,
          cg: existing.cg + stats.cg,
          sv: existing.sv + stats.sv,
          sho: existing.sho + stats.sho,
          ip: existing.ip + stats.ip,
          bf: existing.bf + stats.bf,
          h: existing.h + stats.h,
          r: existing.r + stats.r,
          er: existing.er + stats.er,
          bb: existing.bb + stats.bb,
          so: existing.so + stats.so,
          hr: existing.hr + stats.hr,
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('player_stats_pitching').insert({
        player_id: playerId,
        team_id: m.teamId,
        season_no: seasonNo,
        w: stats.w,
        l: stats.l,
        g: stats.g,
        gs: stats.gs,
        cg: stats.cg,
        sv: stats.sv,
        sho: stats.sho,
        ip: stats.ip,
        bf: stats.bf,
        h: stats.h,
        r: stats.r,
        er: stats.er,
        bb: stats.bb,
        so: stats.so,
        hr: stats.hr,
      });
    }
  }
}

async function updateStandings(
  supabase: SupabaseClient,
  result: GameResult,
  opts: PersistOptions,
) {
  // Winner gets W+1, loser gets L+1
  const winnerId = result.winningTeamId;
  const loserId = result.losingTeamId;

  // Fetch both standings rows
  const { data: winRow } = await supabase
    .from('standings')
    .select('id, w')
    .eq('league_id', opts.leagueId)
    .eq('team_id', winnerId)
    .eq('season_no', opts.seasonNo)
    .single();

  const { data: loseRow } = await supabase
    .from('standings')
    .select('id, l')
    .eq('league_id', opts.leagueId)
    .eq('team_id', loserId)
    .eq('season_no', opts.seasonNo)
    .single();

  if (winRow) {
    await supabase.from('standings').update({ w: winRow.w + 1 }).eq('id', winRow.id);
  }
  if (loseRow) {
    await supabase.from('standings').update({ l: loseRow.l + 1 }).eq('id', loseRow.id);
  }
}

async function processRevenue(
  supabase: SupabaseClient,
  gameId: number,
  result: GameResult,
  opts: PersistOptions,
) {
  const rev = calculateGameRevenue(opts.gameType);

  const txns = [
    { team_id: result.homeTeamId, type: 'LGR_home', amount: rev.homeReceipts, description: 'Home gate receipts', reference_id: gameId },
    { team_id: result.visitorTeamId, type: 'LGR_visitor', amount: rev.visitorReceipts, description: 'Visitor gate receipts', reference_id: gameId },
    { team_id: result.homeTeamId, type: 'food_bev_souv', amount: rev.homeFoodBev, description: 'Food/bev/souvenir', reference_id: gameId },
    { team_id: result.homeTeamId, type: 'advertisment', amount: rev.homeAds, description: 'Advertising revenue', reference_id: gameId },
    { team_id: result.homeTeamId, type: 'stadium_ops', amount: rev.homeStadiumOps, description: 'Stadium operations', reference_id: gameId },
  ];

  await supabase.from('financial_transactions').insert(txns);

  // Update balances
  const homeTotal = rev.homeReceipts + rev.homeFoodBev + rev.homeAds + rev.homeStadiumOps;
  const visitorTotal = rev.visitorReceipts;

  // Use RPC or manual update
  for (const [teamId, amount] of [[result.homeTeamId, homeTotal], [result.visitorTeamId, visitorTotal]] as const) {
    const { data: budget } = await supabase
      .from('team_budgets')
      .select('id, balance')
      .eq('team_id', teamId)
      .single();

    if (budget) {
      await supabase
        .from('team_budgets')
        .update({ balance: budget.balance + amount, updated_at: new Date().toISOString() })
        .eq('id', budget.id);
    }
  }
}
