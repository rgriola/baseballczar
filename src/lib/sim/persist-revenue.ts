/**
 * Persist game revenue — gate receipts + budget updates via safe_credit RPC.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { GameResult } from '../sim-engine/types';
import { calculateGameRevenue } from '../sim-engine/GateReceipts';

export async function processRevenue(
  supabase: SupabaseClient,
  gameId: number,
  result: GameResult,
  opts: { gameType: 'regular' | 'playoff' | 'o2o' },
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

  const homeTotal = rev.homeReceipts + rev.homeFoodBev + rev.homeAds + rev.homeStadiumOps;
  const visitorTotal = rev.visitorReceipts;

  await supabase.rpc('safe_credit', {
    p_team_id: result.homeTeamId,
    p_amount: homeTotal,
    p_type: 'LGR_home',
    p_desc: `Game ${gameId} home revenue`,
    p_ref_id: gameId,
  });

  await supabase.rpc('safe_credit', {
    p_team_id: result.visitorTeamId,
    p_amount: visitorTotal,
    p_type: 'LGR_visitor',
    p_desc: `Game ${gameId} visitor revenue`,
    p_ref_id: gameId,
  });
}
