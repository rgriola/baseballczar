/**
 * GET /api/cron/weekly — run by Vercel Cron every Monday at 5:00 AM UTC.
 * Deducts weekly payroll (player salaries) from every team's budget.
 * Protected by CRON_SECRET header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { safeDebit, getWeeklyPayroll } from '@/lib/finance';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: budgets, error } = await supabase
    .from('team_budgets')
    .select('team_id');

  if (error) {
    logger.error({ error: error.message }, 'cron: payroll query failed');
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: { teamId: number; payroll: number; newBalance: number }[] = [];

  for (const { team_id } of budgets ?? []) {
    try {
      const payroll = await getWeeklyPayroll(supabase, team_id);
      if (payroll === 0) continue;

      const newBalance = await safeDebit(
        supabase,
        team_id,
        payroll,
        'player_sal',
        `Weekly payroll (${new Date().toISOString().slice(0, 10)})`,
      );
      results.push({ teamId: team_id, payroll, newBalance });
    } catch (err) {
      logger.error({ teamId: team_id, err }, 'cron: payroll debit failed');
    }
  }

  logger.info({ processed: results.length }, 'cron: weekly payroll complete');
  return NextResponse.json({ processed: results.length, results });
}
