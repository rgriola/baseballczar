/**
 * Seed script — bootstraps one pre-populated league (6 AI teams, 240 players,
 * 150-game schedule) plus one open league for human signups.
 *
 * Usage:
 *   npx tsx scripts/seed.ts
 *
 * Requires environment variables:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { createLeague, createOpenLeague } from '../src/lib/seed/create-league';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log('Creating pre-populated league (6 AI teams)...');
  const result = await createLeague(supabase, {
    leagueName: 'Premiere League 1',
    division: 'Premiere',
    seasonNo: 1,
  });
  console.log(
    `  League #${result.leagueId}: ${result.teamIds.length} teams, ` +
    `${result.playerCount} players, ${result.scheduleCount} scheduled games`,
  );

  console.log('Creating open league for signups...');
  const openId = await createOpenLeague(supabase, {
    leagueName: 'Premiere League 2',
    division: 'Premiere',
    seasonNo: 1,
  });
  console.log(`  Open league #${openId} ready for signups`);

  console.log('Seed complete.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
