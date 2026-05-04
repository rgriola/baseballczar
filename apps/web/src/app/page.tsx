import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function Home() {
  // Authenticated users go straight to dashboard
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect('/dashboard');

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-zinc-800/60">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold tracking-tight">
            ⚾ Baseball Czar
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm text-zinc-400 hover:text-white transition-colors px-4 py-2"
          >
            Sign In
          </Link>
          <Link
            href="/signup"
            className="text-sm font-medium bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg transition-colors"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        <div className="max-w-2xl mx-auto space-y-8">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-900/30 border border-amber-800/40 text-amber-300 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Sim Engine v2 — Now Live
          </div>

          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-tight">
            Own. Manage.
            <br />
            <span className="bg-gradient-to-r from-blue-400 via-cyan-300 to-emerald-400 bg-clip-text text-transparent">
              Dominate.
            </span>
          </h1>

          <p className="text-lg text-zinc-400 max-w-lg mx-auto leading-relaxed">
            Build your dynasty from the ground up. Draft players, manage your roster,
            set strategies, and compete in a full-physics baseball simulation.
          </p>

          <div className="flex items-center justify-center gap-4 pt-2">
            <Link
              href="/signup"
              className="px-8 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 font-semibold text-sm transition-all hover:shadow-lg hover:shadow-blue-600/25"
            >
              Create Account
            </Link>
            <Link
              href="/login"
              className="px-8 py-3 rounded-lg border border-zinc-700 hover:border-zinc-500 font-semibold text-sm text-zinc-300 hover:text-white transition-all"
            >
              Sign In
            </Link>
          </div>
        </div>

        {/* Feature pills */}
        <div className="mt-16 flex flex-wrap justify-center gap-3 max-w-xl">
          {[
            ['🏟️', 'Full 9-Inning Sim'],
            ['🧠', 'AI Managers'],
            ['📊', 'Real-Time PBP'],
            ['⚡', 'Tick Physics'],
            ['🎯', 'Strategic Depth'],
            ['🏆', 'Dynasty Mode'],
          ].map(([icon, label]) => (
            <div
              key={label}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-400"
            >
              <span>{icon}</span>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="px-8 py-6 border-t border-zinc-800/60 text-center text-xs text-zinc-600">
        Baseball Czar — Tactical Baseball Simulation
      </footer>
    </div>
  );
}
