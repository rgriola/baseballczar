/**
 * Budget utilities.
 *
 * safeDebit / safeCredit use PostgreSQL RPCs with SELECT ... FOR UPDATE
 * to prevent race conditions. The old recordTransaction is kept for
 * backward compat but callers should migrate to the safe variants.
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface BudgetCheckResult {
  ok: boolean;
  balance: number;
  shortfall: number;
}

/**
 * Check whether a team can afford a given cost (read-only, no lock).
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
 * Atomically debit a team's budget via PostgreSQL RPC.
 * Returns the new balance, or throws if insufficient funds.
 */
export async function safeDebit(
  supabase: SupabaseClient,
  teamId: number,
  amount: number,
  type: string,
  description: string,
  referenceId?: number,
): Promise<number> {
  const { data, error } = await supabase.rpc('safe_debit', {
    p_team_id: teamId,
    p_amount: amount,
    p_type: type,
    p_desc: description,
    p_ref_id: referenceId ?? null,
  });

  if (error) throw new Error(`safe_debit failed: ${error.message}`);
  if (data === -1) throw new Error('Insufficient funds');
  return data as number;
}

/**
 * Atomically credit a team's budget via PostgreSQL RPC.
 * Returns the new balance.
 */
export async function safeCredit(
  supabase: SupabaseClient,
  teamId: number,
  amount: number,
  type: string,
  description: string,
  referenceId?: number,
): Promise<number> {
  const { data, error } = await supabase.rpc('safe_credit', {
    p_team_id: teamId,
    p_amount: amount,
    p_type: type,
    p_desc: description,
    p_ref_id: referenceId ?? null,
  });

  if (error) throw new Error(`safe_credit failed: ${error.message}`);
  return data as number;
}

/**
 * @deprecated Use safeDebit / safeCredit instead. This has a race condition.
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
