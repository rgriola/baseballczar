import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

  // Fetch events
  const { data: events } = await supabase
    .from('game_events')
    .select('*')
    .eq('game_id', gameId)
    .order('seq');

  // Fetch hitting box
  const { data: hitting } = await supabase
    .from('game_stats_hitting')
    .select('*, players(first_name, last_name, jersey_no, position)')
    .eq('game_id', gameId)
    .order('bat_order');

  // Fetch pitching box
  const { data: pitching } = await supabase
    .from('game_stats_pitching')
    .select('*, players(first_name, last_name, jersey_no)')
    .eq('game_id', gameId)
    .order('pitch_app');

  return NextResponse.json({
    game,
    teamMap,
    events: events ?? [],
    hitting: hitting ?? [],
    pitching: pitching ?? [],
  });
}
