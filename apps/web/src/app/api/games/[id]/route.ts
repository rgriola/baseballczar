// Last touched by agent: 2026-05-07T22:40:33Z
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type PlayerSummary = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  jersey_no: number | null;
  position: string | null;
  hand_batting: number | null;
  hand_throw: number | null;
  speed: number | null;
  stamina: number | null;
  ag: number | null;
  eye: number | null;
  avg: number | null;
  strength: number | null;
  play_intel: number | null;
  bunting: number | null;
  fielding: number | null;
  throw: number | null;
};

type BoxRow = {
  player_id: number;
  players?: PlayerSummary | PlayerSummary[] | null;
};

function hydratePlayers<T extends BoxRow>(rows: T[], playerMap: Map<number, PlayerSummary>): T[] {
  return rows.map((row) => {
    if (row.players) return row;
    const player = playerMap.get(Number(row.player_id));
    if (!player) return row;
    return { ...row, players: player };
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const gameId = parseInt(id, 10);
  if (isNaN(gameId)) {
    return NextResponse.json({ error: 'Invalid game ID' }, { status: 400 });
  }

  const supabase = await createClient();

  // Fetch game
  const { data: game, error: gameErr } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single();

  if (gameErr || !game) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }

  // Fetch team names
  const { data: teams } = await supabase
    .from('teams')
    .select('id, team_name')
    .in('id', [game.home_team_id, game.visitor_team_id]);

  const teamMap = Object.fromEntries(
    (teams ?? []).map((t) => [t.id, t.team_name]),
  );

  const [eventsRes, hittingRes, pitchingRes] = await Promise.all([
    supabase
      .from('game_events')
      .select('*')
      .eq('game_id', gameId)
      .order('seq'),
    supabase
      .from('game_stats_hitting')
        .select('*, players(first_name, last_name, jersey_no, position, hand_batting, hand_throw, speed, stamina, ag, eye, avg, strength, play_intel, bunting, fielding, throw)')
      .eq('game_id', gameId)
      .order('bat_order'),
    supabase
      .from('game_stats_pitching')
        .select('*, players(first_name, last_name, jersey_no, position, hand_batting, hand_throw, speed, stamina, ag, eye, avg, strength, play_intel, bunting, fielding, throw)')
      .eq('game_id', gameId)
      .order('pitch_app'),
  ]);

  let hitting = hittingRes.data ?? [];
  let pitching = pitchingRes.data ?? [];

  // Fallback if relation joins fail in an environment with stale relation metadata.
  if (hittingRes.error || pitchingRes.error) {
    const [plainHittingRes, plainPitchingRes] = await Promise.all([
      supabase
        .from('game_stats_hitting')
        .select('*')
        .eq('game_id', gameId)
        .order('bat_order'),
      supabase
        .from('game_stats_pitching')
        .select('*')
        .eq('game_id', gameId)
        .order('pitch_app'),
    ]);

    if (plainHittingRes.error || plainPitchingRes.error) {
      return NextResponse.json({ error: 'An internal error occurred' }, { status: 500 });
    }

    hitting = plainHittingRes.data ?? [];
    pitching = plainPitchingRes.data ?? [];

    const playerIds = new Set<number>();
    for (const row of [...hitting, ...pitching]) {
      const id = Number((row as { player_id: unknown }).player_id);
      if (Number.isFinite(id)) playerIds.add(id);
    }

    if (playerIds.size > 0) {
      const { data: players } = await supabase
        .from('players')
          .select('id, first_name, last_name, jersey_no, position, hand_batting, hand_throw, speed, stamina, ag, eye, avg, strength, play_intel, bunting, fielding, throw')
        .in('id', Array.from(playerIds));

      const playerMap = new Map<number, PlayerSummary>();
      for (const player of players ?? []) {
        const id = Number(player.id);
        if (!Number.isFinite(id)) continue;
        playerMap.set(id, {
          id,
          first_name: player.first_name,
          last_name: player.last_name,
          jersey_no: player.jersey_no,
          position: player.position,
          hand_batting: player.hand_batting,
          hand_throw: player.hand_throw,
          speed: player.speed,
          stamina: player.stamina,
          ag: player.ag,
          eye: player.eye,
          avg: player.avg,
          strength: player.strength,
          play_intel: player.play_intel,
          bunting: player.bunting,
          fielding: player.fielding,
          throw: player.throw,
        });
      }

      hitting = hydratePlayers(hitting as BoxRow[], playerMap);
      pitching = hydratePlayers(pitching as BoxRow[], playerMap);
    }
  }

  return NextResponse.json({
    game,
    teamMap,
    events: eventsRes.data ?? [],
    hitting: hitting ?? [],
    pitching: pitching ?? [],
  });
}
