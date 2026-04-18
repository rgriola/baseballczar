import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import TradeBlockBrowser from './trade-block-browser';

export default async function TradeBlockPage() {
  const supabase = await createClient();
  const team = await requireMyTeam();

  // Active listings with player + seller team info
  const { data: listings } = await supabase
    .from('trade_listings')
    .select('id, seller_team_id, player_id, asking_price, created_at')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (!listings || listings.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">Trade Block</h1>
        <p className="text-gray-400">No players currently listed for trade.</p>
      </div>
    );
  }

  // Batch load player + team data
  const playerIds = listings.map((l) => l.player_id);
  const teamIds = Array.from(new Set(listings.map((l) => l.seller_team_id)));

  const [{ data: players }, { data: teams }] = await Promise.all([
    supabase
      .from('players')
      .select('id, first_name, last_name, age, position, fielder, speed, stamina, play_intel, avg, strength, eye, bunting, throw, fielding, salary')
      .in('id', playerIds),
    supabase
      .from('teams')
      .select('id, team_name')
      .in('id', teamIds),
  ]);

  const playerMap = Object.fromEntries((players ?? []).map((p) => [p.id, p]));
  const teamMap = Object.fromEntries((teams ?? []).map((t) => [t.id, t]));

  const enriched = listings.map((l) => ({
    ...l,
    player: playerMap[l.player_id] ?? null,
    sellerTeam: teamMap[l.seller_team_id] ?? null,
  }));

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Trade Block</h1>
      <TradeBlockBrowser listings={enriched} myTeamId={team.id} />
    </div>
  );
}
