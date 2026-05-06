// Last touched by agent: 2026-05-05T19:15:00Z
// Purpose: Mounts the Sim Lab 2 module at the dashboard games route.
import SimLab2Module from '@/app/sim-lab-2/SimLab2Module';

export default function DashboardGamesPage() {
  return (
    <div className="space-y-5">
      <header className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
        <h1 className="text-2xl font-bold text-white">Games</h1>
        <p className="text-sm text-zinc-400">
          Sim Lab 2 is now the default game simulation module for dashboard games.
        </p>
      </header>

      <SimLab2Module embedded />
    </div>
  );
}
