import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import MyListings from './my-listings';

export default async function MyTradeBlockPage() {
  const supabase = await createClient();
  const team = await requireMyTeam();

  // Get my active listings
  const { data: listings } = await supabase
    .from('trade_listings')
    .select('id, player_id, asking_price, status, created_at')
    .eq('seller_team_id', team.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  // Get my available (unlisted) players
  const listedPlayerIds = (listings ?? []).map((l) => l.player_id);

  const { data: allPlayers } = await supabase
    .from('players')
    .select('id, first_name, last_name, position, age, speed, stamina, play_intel, avg, strength, eye, bunting, throw, fielding, salary')
    .eq('team_id', team.id)
    .in('roster_status', ['active', 'reserve']);

  const availablePlayers = (allPlayers ?? []).filter(
    (p) => !listedPlayerIds.includes(p.id),
  );

  // Enrich listings with player names
  const playerMap = Object.fromEntries(
    (allPlayers ?? []).map((p) => [p.id, p]),
  );

  const enrichedListings = (listings ?? []).map((l) => ({
    ...l,
    player: playerMap[l.player_id] ?? null,
  }));

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">My Trade Block</h1>
      <MyListings
        listings={enrichedListings}
        availablePlayers={availablePlayers}
      />
    </div>
  );
}
