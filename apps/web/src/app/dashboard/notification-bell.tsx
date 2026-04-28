'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

interface NotifRow {
  id: number;
  type: string;
  payload: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
}

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

export default function NotificationBell({ userId }: { userId: string }) {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotifRow[]>([]);
  const supabase = createClient();

  // Load initial unread count + recent items
  useEffect(() => {
    async function load() {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('read', false);

      setUnread(count ?? 0);

      const { data } = await supabase
        .from('notifications')
        .select('id, type, payload, read, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);

      setItems((data as NotifRow[]) ?? []);
    }

    load();
  }, [userId, supabase]);

  // Realtime subscription for new notifications
  useEffect(() => {
    const channel = supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as NotifRow;
          setItems((prev) => [row, ...prev].slice(0, 10));
          setUnread((prev) => prev + 1);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, supabase]);

  async function markRead(id: number) {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', id);

    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    setUnread((prev) => Math.max(0, prev - 1));
  }

  async function markAllRead() {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);

    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white"
        aria-label="Notifications"
      >
        {/* Bell icon (SVG) */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-5 w-5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
          />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-gray-700 bg-gray-900 shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-800 px-4 py-2">
            <span className="text-sm font-semibold text-white">
              Notifications
            </span>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-gray-500">
                No notifications yet.
              </p>
            )}
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  if (!n.read) markRead(n.id);
                }}
                className={`block w-full px-4 py-3 text-left hover:bg-gray-800 ${
                  n.read ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start gap-2">
                  {!n.read && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-400" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">
                      {TYPE_LABELS[n.type] ?? n.type}
                    </p>
                    {n.payload && 'message' in n.payload && (
                      <p className="mt-0.5 truncate text-xs text-gray-400">
                        {String(n.payload.message)}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-gray-600">
                      {new Date(n.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="border-t border-gray-800 px-4 py-2">
            <Link
              href="/dashboard/notifications"
              onClick={() => setOpen(false)}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
