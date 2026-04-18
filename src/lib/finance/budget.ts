/**
 * Budget check utilities.
 *
 * Used by free-agent signings, trades, and any operation that debits the budget.
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface BudgetCheckResult {
  ok: boolean;
  balance: number;
  shortfall: number;
}

/**
 * Check whether a team can afford a given cost.
 * Returns the current balance and whether the cost is within budget.
 */
export async function checkBudget(
  supabase: SupabaseClient,
  teamId: number,
  cost: number,
): Promise<BudgetCheckResult> {
  const { data } = await supabase
    .from('team_budgets')
    .select('balance')
    .eq('team_id', teamId)
    .single();

  const balance = data?.balance ?? 0;
  const shortfall = cost > balance ? cost - balance : 0;

  return { ok: balance >= cost, balance, shortfall };
}

/**
 * Debit (or credit) a team's budget and log a financial transaction.
 * Positive amount = income, negative = expense.
 * Returns the new balance.
 */
export async function recordTransaction(
  supabase: SupabaseClient,
  teamId: number,
  type: string,
  amount: number,
  description: string,
  referenceId?: number,
): Promise<number> {
  // Insert transaction
  const { error: txErr } = await supabase
    .from('financial_transactions')
    .insert({
      team_id: teamId,
      type,
      amount,
      description,
      reference_id: referenceId ?? null,
    });

  if (txErr) throw new Error(`Failed to record transaction: ${txErr.message}`);

  // Update balance
  const { data: budget } = await supabase
    .from('team_budgets')
    .select('id, balance')
    .eq('team_id', teamId)
    .single();

  if (!budget) throw new Error(`No budget row for team ${teamId}`);

  const newBalance = budget.balance + amount;

  const { error: budgetErr } = await supabase
    .from('team_budgets')
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq('id', budget.id);

  if (budgetErr) throw new Error(`Failed to update budget: ${budgetErr.message}`);

  return newBalance;
}

/**
 * Calculate total weekly payroll for a team's active roster.
 */
export async function getWeeklyPayroll(
  supabase: SupabaseClient,
  teamId: number,
): Promise<number> {
  const { data: players } = await supabase
    .from('players')
    .select('salary')
    .eq('team_id', teamId)
    .eq('roster_status', 'active');

  return (players ?? []).reduce((sum, p) => sum + p.salary, 0);
}
