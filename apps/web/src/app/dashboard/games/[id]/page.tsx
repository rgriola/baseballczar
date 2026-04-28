import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import Scoreboard from './scoreboard';
import BoxScore from './box-score';
import PlayByPlay from './play-by-play';
import FieldCanvas from '@/components/sim/FieldCanvasClient';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function GamePage({ params }: Props) {
  const { id } = await params;
  const gameId = parseInt(id, 10);
  if (isNaN(gameId)) notFound();

  const supabase = await createClient();

  const { data: game } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single();

  if (!game) notFound();

  // Team names
  const { data: teams } = await supabase
    .from('teams')
    .select('id, team_name')
    .in('id', [game.home_team_id, game.visitor_team_id]);
  const teamMap: Record<number, string> = {};
  teams?.forEach((t) => { teamMap[t.id] = t.team_name; });

  const homeName = teamMap[game.home_team_id] ?? 'Home';
  const visitorName = teamMap[game.visitor_team_id] ?? 'Visitor';

  // Events
  const { data: events } = await supabase
    .from('game_events')
    .select('*')
    .eq('game_id', gameId)
    .order('seq');

  // Hitting box
  const { data: hitting } = await supabase
    .from('game_stats_hitting')
    .select('*, players(first_name, last_name, jersey_no, position, hand_batting)')
    .eq('game_id', gameId)
    .order('bat_order');

  // Pitching box
  const { data: pitching } = await supabase
    .from('game_stats_pitching')
    .select('*, players(first_name, last_name, jersey_no, hand_batting)')
    .eq('game_id', gameId)
    .order('pitch_app');

  // Build name -> { jersey_no, hand } maps so we can decorate sim events.
  // game_events stores only last names (matches GameEngine.batterName = lastName).
  type PlayerRow = {
    last_name: string;
    jersey_no: number;
    hand_batting: number | null;
  } | null;
  const lookup = new Map<string, { jersey_no: number; hand: 'L' | 'R' }>();
  const addLookup = (p: PlayerRow) => {
    if (!p?.last_name) return;
    // hand_batting: 1=R, 2=L, 3=S — treat S as R for visual placement
    const hand: 'L' | 'R' = p.hand_batting === 2 ? 'L' : 'R';
    lookup.set(p.last_name, { jersey_no: p.jersey_no ?? 0, hand });
  };
  hitting?.forEach((h) => addLookup((h as { players: PlayerRow }).players));
  pitching?.forEach((p) => addLookup((p as { players: PlayerRow }).players));

  const homeHitting = hitting?.filter((h) => h.team_id === game.home_team_id) ?? [];
  const visitorHitting = hitting?.filter((h) => h.team_id === game.visitor_team_id) ?? [];
  const homePitching = pitching?.filter((p) => p.team_id === game.home_team_id) ?? [];
  const visitorPitching = pitching?.filter((p) => p.team_id === game.visitor_team_id) ?? [];

  // Check if game is still in progress (via schedule)
  let isLive = false;
  if (game.schedule_id) {
    const { data: sched } = await supabase
      .from('schedules')
      .select('played')
      .eq('id', game.schedule_id)
      .single();
    isLive = sched ? !sched.played : false;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-white">
          {visitorName} @ {homeName}
        </h1>
        {isLive && (
          <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold uppercase text-white animate-pulse">
            Live
          </span>
        )}
      </div>

      <Scoreboard
        game={game}
        homeName={homeName}
        visitorName={visitorName}
      />

      <div className="grid gap-8 lg:grid-cols-2">
        <BoxScore
          label={visitorName}
          hitting={visitorHitting}
          pitching={visitorPitching}
        />
        <BoxScore
          label={homeName}
          hitting={homeHitting}
          pitching={homePitching}
        />
      </div>

      {/* 2D Sim Playback — only shown for completed games with events */}
      {!isLive && (events?.length ?? 0) > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-white">Game Replay</h2>
          <FieldCanvas
            events={events!.map((e) => {
              const batter = lookup.get(e.batter_name);
              const pitcher = lookup.get(e.pitcher_name);
              return {
                seq: e.seq,
                inning: e.inning,
                half: e.half as 'top' | 'bottom',
                outs: e.outs,
                outcome: e.outcome,
                batter_name: e.batter_name,
                pitcher_name: e.pitcher_name,
                runners_scored: e.runners_scored,
                visitor_runs: e.visitor_runs,
                home_runs: e.home_runs,
                batter_hand: batter?.hand ?? 'R',
                batter_number: batter?.jersey_no ?? '',
                pitcher_number: pitcher?.jersey_no ?? '',
                hit_zone: e.hit_zone ?? undefined,
              };
            })}
            homeName={homeName}
            visitorName={visitorName}
            homeRuns={game.home_runs}
            visitorRuns={game.visitor_runs}
          />
        </section>
      )}

      <PlayByPlay
        events={events ?? []}
        homeName={homeName}
        visitorName={visitorName}
        gameId={gameId}
        isLive={isLive}
      />
    </div>
  );
}
