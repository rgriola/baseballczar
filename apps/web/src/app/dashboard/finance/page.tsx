import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import Link from 'next/link';

const TX_LABELS: Record<string, string> = {
  LGR_home: 'Home Gate Receipts',
  LGR_visitor: 'Visitor Gate Receipts',
  food_bev_souv: 'Food / Bev / Souvenirs',
  advertisment: 'Advertising',
  stadium_ops: 'Stadium Operations',
  player_sal: 'Player Salaries',
  coaches_sal: 'Coaches Salaries',
  pSold: 'Player Sold',
  pPurchased: 'Player Purchased',
  signing_bonus: 'Signing Bonus',
  trade_cash: 'Trade Cash',
  other: 'Other',
};

function money(cents: number) {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${Math.abs(cents).toLocaleString()}`;
}

export default async function FinancePage() {
  const team = await requireMyTeam();
  const supabase = await createClient();

  // Budget balance
  const { data: budget } = await supabase
    .from('team_budgets')
    .select('balance, updated_at')
    .eq('team_id', team.id)
    .single();

  // Aggregate income/expense by type
  const { data: txns } = await supabase
    .from('financial_transactions')
    .select('type, amount')
    .eq('team_id', team.id);

  const byType = new Map<string, number>();
  let totalIncome = 0;
  let totalExpense = 0;

  for (const t of txns ?? []) {
    byType.set(t.type, (byType.get(t.type) ?? 0) + t.amount);
    if (t.amount >= 0) {
      totalIncome += t.amount;
    } else {
      totalExpense += t.amount;
    }
  }

  const incomeTypes = Array.from(byType.entries()).filter(([, v]) => v > 0);
  const expenseTypes = Array.from(byType.entries()).filter(([, v]) => v < 0);

  // Salary totals (active roster)
  const { data: players } = await supabase
    .from('players')
    .select('salary, roster_status')
    .eq('team_id', team.id);

  const weeklyPayroll = (players ?? [])
    .filter((p) => p.roster_status === 'active')
    .reduce((sum, p) => sum + p.salary, 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">
          {team.team_name} — Finances
        </h1>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
          <p className="text-sm text-gray-400">Balance</p>
          <p className="mt-1 text-2xl font-bold text-white">
            {money(budget?.balance ?? 0)}
          </p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
          <p className="text-sm text-gray-400">Total Income</p>
          <p className="mt-1 text-2xl font-bold text-green-400">
            {money(totalIncome)}
          </p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
          <p className="text-sm text-gray-400">Total Expenses</p>
          <p className="mt-1 text-2xl font-bold text-red-400">
            {money(totalExpense)}
          </p>
        </div>
      </div>

      {/* Payroll */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
        <h2 className="text-lg font-semibold text-white">Weekly Payroll</h2>
        <p className="mt-1 text-gray-400">
          Active roster salary total:{' '}
          <span className="font-mono text-white">{money(weeklyPayroll)}</span>{' '}
          / week
        </p>
        <p className="mt-1 text-sm text-gray-500">
          {players?.filter((p) => p.roster_status === 'active').length ?? 0}{' '}
          active players
        </p>
      </div>

      {/* Income/Expense Breakdown */}
      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-white">
            Income Breakdown
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-gray-400">
                <th className="pb-2">Source</th>
                <th className="pb-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {incomeTypes.map(([type, amt]) => (
                <tr key={type} className="border-b border-gray-800/50 text-gray-300">
                  <td className="py-1.5">{TX_LABELS[type] ?? type}</td>
                  <td className="py-1.5 text-right font-mono text-green-400">
                    {money(amt)}
                  </td>
                </tr>
              ))}
              <tr className="font-semibold text-white">
                <td className="py-2">Total</td>
                <td className="py-2 text-right font-mono text-green-400">
                  {money(totalIncome)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-white">
            Expense Breakdown
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-gray-400">
                <th className="pb-2">Category</th>
                <th className="pb-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {expenseTypes.map(([type, amt]) => (
                <tr key={type} className="border-b border-gray-800/50 text-gray-300">
                  <td className="py-1.5">{TX_LABELS[type] ?? type}</td>
                  <td className="py-1.5 text-right font-mono text-red-400">
                    {money(amt)}
                  </td>
                </tr>
              ))}
              <tr className="font-semibold text-white">
                <td className="py-2">Total</td>
                <td className="py-2 text-right font-mono text-red-400">
                  {money(totalExpense)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      {/* Link to full transaction log */}
      <div>
        <Link
          href="/dashboard/finance/transactions"
          className="text-sm text-blue-400 hover:text-blue-300"
        >
          View full transaction history →
        </Link>
      </div>
    </div>
  );
}
