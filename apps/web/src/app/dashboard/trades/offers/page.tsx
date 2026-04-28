import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import OffersList from './offers-list';

export default async function IncomingOffersPage() {
  const supabase = await createClient();
  const team = await requireMyTeam();

  // Pending offers where I'm the seller
  const { data: incomingOffers } = await supabase
    .from('trade_offers')
    .select('id, listing_id, from_team_id, to_team_id, offered_player_ids, cash_amount, status, created_at')
    .eq('to_team_id', team.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  // My outgoing offers (pending)
  const { data: outgoingOffers } = await supabase
    .from('trade_offers')
    .select('id, listing_id, from_team_id, to_team_id, offered_player_ids, cash_amount, status, created_at')
    .eq('from_team_id', team.id)
    .order('created_at', { ascending: false })
    .limit(20);

  // Gather all team IDs and listing IDs for enrichment
  const allOffers = [...(incomingOffers ?? []), ...(outgoingOffers ?? [])];
  const teamIds = Array.from(new Set(allOffers.flatMap((o) => [o.from_team_id, o.to_team_id])));
  const listingIds = Array.from(new Set(allOffers.map((o) => o.listing_id).filter(Boolean))) as number[];
  const offeredPIds = Array.from(new Set(allOffers.flatMap((o) => o.offered_player_ids ?? [])));

  const [{ data: teams }, { data: listings }, { data: offeredPlayers }] = await Promise.all([
    supabase.from('teams').select('id, team_name').in('id', teamIds.length > 0 ? teamIds : [0]),
    supabase
      .from('trade_listings')
      .select('id, player_id')
      .in('id', listingIds.length > 0 ? listingIds : [0]),
    supabase
      .from('players')
      .select('id, first_name, last_name, position')
      .in('id', offeredPIds.length > 0 ? offeredPIds : [0]),
  ]);

  // Also load listed players
  const listedPlayerIds = (listings ?? []).map((l) => l.player_id);
  const { data: listedPlayers } = await supabase
    .from('players')
    .select('id, first_name, last_name, position')
    .in('id', listedPlayerIds.length > 0 ? listedPlayerIds : [0]);

  const teamMap = Object.fromEntries((teams ?? []).map((t) => [t.id, t.team_name]));
  const listingMap = Object.fromEntries((listings ?? []).map((l) => [l.id, l.player_id]));
  const playerMap = Object.fromEntries(
    [...(offeredPlayers ?? []), ...(listedPlayers ?? [])].map((p) => [
      p.id,
      `${p.first_name} ${p.last_name} (${p.position})`,
    ]),
  );

  function enrichOffer(o: (typeof allOffers)[0]) {
    const listedPlayerId = o.listing_id ? listingMap[o.listing_id] : null;
    return {
      ...o,
      fromTeamName: teamMap[o.from_team_id] ?? 'Unknown',
      toTeamName: teamMap[o.to_team_id] ?? 'Unknown',
      listedPlayerName: listedPlayerId ? (playerMap[listedPlayerId] ?? 'Unknown') : null,
      offeredPlayerNames: (o.offered_player_ids ?? []).map(
        (id: number) => playerMap[id] ?? 'Unknown',
      ),
    };
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Trade Offers</h1>
      <OffersList
        incoming={(incomingOffers ?? []).map(enrichOffer)}
        outgoing={(outgoingOffers ?? []).map(enrichOffer)}
      />
    </div>
  );
}
