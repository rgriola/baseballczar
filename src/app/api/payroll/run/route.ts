/**
 * POST /api/payroll/run
 *
 * Weekly salary payroll — deducts active-roster player salaries from each
 * team's budget and logs financial_transactions with type 'player_sal'.
 *
 * Intended to be called by a cron job / BullMQ worker once per sim-week.
 * Protected by checking for the SERVICE_ROLE_KEY in the Authorization header
 * (server-to-server only).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { recordTransaction, getWeeklyPayroll } from '@/lib/finance';

export async function POST(req: NextRequest) {
  // Simple service-key auth for server-to-server calls
  const authHeader = req.headers.get('authorization');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Get all teams that have a budget row
  const { data: budgets, error } = await supabase
    .from('team_budgets')
    .select('team_id');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: { teamId: number; payroll: number; newBalance: number }[] = [];

  for (const { team_id } of budgets ?? []) {
    const payroll = await getWeeklyPayroll(supabase, team_id);
    if (payroll === 0) continue;

    const newBalance = await recordTransaction(
      supabase,
      team_id,
      'player_sal',
      -payroll,
      `Weekly payroll (${new Date().toISOString().slice(0, 10)})`,
    );

    results.push({ teamId: team_id, payroll, newBalance });
  }

  return NextResponse.json({
    processed: results.length,
    results,
  });
}
