// Last touched by agent: 2026-05-05T21:59:55Z
import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import PersistedReplay from './persisted-replay';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}

export default async function GamePage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const gameId = parseInt(id, 10);
  if (isNaN(gameId)) notFound();

  const openBoxScore = query.view === 'box';

  const supabase = await createClient();

  const { data: game } = await supabase
    .from('games')
    .select('id, home_team_id, visitor_team_id, home_runs, visitor_runs')
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

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
        <div>
          <h1 className="text-2xl font-bold text-white">{visitorName} @ {homeName}</h1>
          <p className="text-sm text-zinc-400">
            Game ID #{game.id} • {openBoxScore ? 'Persisted Box Score View' : 'Persisted Replay View'}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-right">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">Final Score</p>
          <p className="font-mono text-xl font-bold text-zinc-100">
            {game.visitor_runs} - {game.home_runs}
          </p>
        </div>
        <Link
          href="/sim-lab-2"
          className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-900"
        >
          Open Sim-Lab-2 Sandbox
        </Link>
      </header>

      <PersistedReplay gameId={gameId} initialView={openBoxScore ? 'box' : 'replay'} />
    </div>
  );
}
