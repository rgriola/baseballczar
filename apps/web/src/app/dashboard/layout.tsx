// Last touched by agent: 2026-05-07T17:03:14Z
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionUser } from '@/lib/supabase/session-user';
import { logout } from '../(auth)/actions';
import NotificationBell from './notification-bell';

const NAV_LINKS = [
  { href: '/dashboard', label: 'Front Office' },
  { href: '/dashboard/roster', label: 'Roster' },
  { href: '/dashboard/lineup', label: 'Lineup' },
  { href: '/dashboard/pitching-staff', label: 'Pitching Staff' },
  { href: '/dashboard/stats', label: 'Stats' },
  { href: '/dashboard/schedule', label: 'League' },
  { href: '/dashboard/standings', label: 'Standings' },
  { href: '/dashboard/leaders', label: 'Leaders' },
  { href: '/dashboard/finance', label: 'Finance' },
  { href: '/dashboard/market', label: 'Market' },
  { href: '/dashboard/trades', label: 'Trades' },
  { href: '/dashboard/training', label: 'Training' },
  { href: '/dashboard/challenges', label: 'O2O' },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();

  if (!user) {
    redirect('/login');
  }

  const teamName = user.user_metadata?.team_name ?? 'My Team';

  return (
    <div className="min-h-screen bg-gray-950">
      <nav className="border-b border-gray-800 bg-gray-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="text-lg font-bold text-white">Baseball Czar</span>
            <span className="text-sm text-gray-400">{teamName}</span>
          </div>
          <div className="flex items-center gap-4">
            <NotificationBell userId={user.id} />
            <span className="text-sm text-gray-400">{user.email}</span>
            <form action={logout}>
              <button
                type="submit"
                className="rounded bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
              >
                Sign Out
              </button>
            </form>
          </div>
        </div>
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="whitespace-nowrap rounded px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-800 hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </nav>
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}
