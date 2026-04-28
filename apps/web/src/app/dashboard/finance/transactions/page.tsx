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

export default async function TransactionsPage() {
  const team = await requireMyTeam();
  const supabase = await createClient();

  const { data: txns } = await supabase
    .from('financial_transactions')
    .select('id, type, amount, description, reference_id, created_at')
    .eq('team_id', team.id)
    .order('created_at', { ascending: false })
    .limit(200);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Transaction History</h1>
        <Link
          href="/dashboard/finance"
          className="text-sm text-blue-400 hover:text-blue-300"
        >
          ← Back to Finance
        </Link>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-gray-400">
            <th className="pb-2">Date</th>
            <th className="pb-2">Type</th>
            <th className="pb-2">Description</th>
            <th className="pb-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {(txns ?? []).map((t) => (
            <tr
              key={t.id}
              className="border-b border-gray-800/50 text-gray-300"
            >
              <td className="py-1.5 whitespace-nowrap">
                {new Date(t.created_at).toLocaleDateString()}
              </td>
              <td className="py-1.5">{TX_LABELS[t.type] ?? t.type}</td>
              <td className="py-1.5 text-gray-500">
                {t.description ?? '—'}
              </td>
              <td
                className={`py-1.5 text-right font-mono ${
                  t.amount >= 0 ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {money(t.amount)}
              </td>
            </tr>
          ))}
          {(!txns || txns.length === 0) && (
            <tr>
              <td colSpan={4} className="py-8 text-center text-gray-500">
                No transactions yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
