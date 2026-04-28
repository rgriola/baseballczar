import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { markNotificationRead, markAllNotificationsRead } from './actions';

const TYPE_LABELS: Record<string, string> = {
  trade_offer: 'Trade Offer',
  trade_accepted: 'Trade Accepted',
  trade_rejected: 'Trade Rejected',
  challenge_received: 'Challenge Received',
  challenge_accepted: 'Challenge Accepted',
  challenge_declined: 'Challenge Declined',
  game_result: 'Game Result',
  system: 'System',
};

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: notifications } = await supabase
    .from('notifications')
    .select('id, type, payload, read, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);

  const unreadCount = (notifications ?? []).filter((n) => !n.read).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">
          Notifications{' '}
          {unreadCount > 0 && (
            <span className="text-lg text-gray-400">
              ({unreadCount} unread)
            </span>
          )}
        </h1>
        {unreadCount > 0 && (
          <form action={markAllNotificationsRead}>
            <button
              type="submit"
              className="rounded bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
            >
              Mark all read
            </button>
          </form>
        )}
      </div>

      <div className="space-y-2">
        {(!notifications || notifications.length === 0) && (
          <p className="py-8 text-center text-gray-500">
            No notifications yet.
          </p>
        )}
        {(notifications ?? []).map((n) => (
          <div
            key={n.id}
            className={`flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-900 p-4 ${
              n.read ? 'opacity-60' : ''
            }`}
          >
            {!n.read && (
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-blue-400" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-white">
                  {TYPE_LABELS[n.type] ?? n.type}
                </p>
                <span className="text-xs text-gray-600">
                  {new Date(n.created_at).toLocaleString()}
                </span>
              </div>
              {n.payload && typeof n.payload === 'object' && 'message' in (n.payload as Record<string, unknown>) && (
                <p className="mt-1 text-sm text-gray-400">
                  {String((n.payload as Record<string, unknown>).message)}
                </p>
              )}
            </div>
            {!n.read && (
              <form action={markNotificationRead.bind(null, n.id)}>
                <button
                  type="submit"
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  Mark read
                </button>
              </form>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
