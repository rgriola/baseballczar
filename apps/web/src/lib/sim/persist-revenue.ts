// Last touched by agent: 2026-05-14T09:44:00Z
/**
 * Persist game revenue — gate receipts + budget updates via safe_credit RPC.
 * Reads directly from engine types (GameResult).
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { GameResult } from '@baseballczar/sim-engine';
import { calculateGameRevenue } from '../sim-engine/GateReceipts';

export interface RevenueTransactionTemplate {
  team_id: number;
  type: string;
  amount: number;
  description: string;
}

export interface RevenueBundle {
  transactions: RevenueTransactionTemplate[];
  homeCreditAmount: number;
  visitorCreditAmount: number;
}

export function buildRevenueBundle(
  result: GameResult,
  gameType: string,
): RevenueBundle {
  const rev = calculateGameRevenue(gameType);
  const transactions: RevenueTransactionTemplate[] = [
    {
      team_id: result.homeTeam.id,
      type: 'LGR_home',
      amount: rev.homeReceipts,
      description: 'Home gate receipts',
    },
    {
      team_id: result.awayTeam.id,
      type: 'LGR_visitor',
      amount: rev.visitorReceipts,
      description: 'Visitor gate receipts',
    },
    {
      team_id: result.homeTeam.id,
      type: 'food_bev_souv',
      amount: rev.homeFoodBev,
      description: 'Food/bev/souvenir',
    },
    {
      team_id: result.homeTeam.id,
      type: 'advertisment',
      amount: rev.homeAds,
      description: 'Advertising revenue',
    },
    {
      team_id: result.homeTeam.id,
      type: 'stadium_ops',
      amount: rev.homeStadiumOps,
      description: 'Stadium operations',
    },
  ];

  return {
    transactions,
    homeCreditAmount: rev.homeReceipts + rev.homeFoodBev + rev.homeAds + rev.homeStadiumOps,
    visitorCreditAmount: rev.visitorReceipts,
  };
}

export async function processRevenue(
  supabase: SupabaseClient,
  gameId: number,
  result: GameResult,
  opts: { gameType: 'regular' | 'playoff' | 'o2o' },
) {
  const revenue = buildRevenueBundle(result, opts.gameType);
  const txns = revenue.transactions.map((txn) => ({
    ...txn,
    reference_id: gameId,
  }));

  const { error: insertTxError } = await supabase.from('financial_transactions').insert(txns);
  if (insertTxError) {
    throw new Error(`Failed to insert financial transactions: ${insertTxError.message}`);
  }

  const { error: homeCreditError } = await supabase.rpc('safe_credit', {
    p_team_id: result.homeTeam.id,
    p_amount: revenue.homeCreditAmount,
    p_type: 'LGR_home',
    p_desc: `Game ${gameId} home revenue`,
    p_ref_id: gameId,
  });
  if (homeCreditError) {
    throw new Error(`Failed to credit home team revenue: ${homeCreditError.message}`);
  }

  const { error: visitorCreditError } = await supabase.rpc('safe_credit', {
    p_team_id: result.awayTeam.id,
    p_amount: revenue.visitorCreditAmount,
    p_type: 'LGR_visitor',
    p_desc: `Game ${gameId} visitor revenue`,
    p_ref_id: gameId,
  });
  if (visitorCreditError) {
    throw new Error(`Failed to credit visitor team revenue: ${visitorCreditError.message}`);
  }
}
