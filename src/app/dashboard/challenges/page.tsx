import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import ChallengePanel from './challenge-panel';

export default async function ChallengesPage() {
  const supabase = await createClient();
  const team = await requireMyTeam();

  // All teams except mine (for challenge targets)
  const { data: allTeams } = await supabase
    .from('teams')
    .select('id, team_name')
    .neq('id', team.id)
    .order('team_name');

  // My challenges (sent + received)
  const { data: sent } = await supabase
    .from('challenge_requests')
    .select('id, challenger_team_id, challenged_team_id, wager, status, game_id, created_at')
    .eq('challenger_team_id', team.id)
    .order('created_at', { ascending: false })
    .limit(20);

  const { data: received } = await supabase
    .from('challenge_requests')
    .select('id, challenger_team_id, challenged_team_id, wager, status, game_id, created_at')
    .eq('challenged_team_id', team.id)
    .order('created_at', { ascending: false })
    .limit(20);

  // Enrich with team names
  const allChallenges = [...(sent ?? []), ...(received ?? [])];
  const teamIds = Array.from(
    new Set(allChallenges.flatMap((c) => [c.challenger_team_id, c.challenged_team_id])),
  );

  const { data: teams } = await supabase
    .from('teams')
    .select('id, team_name')
    .in('id', teamIds.length > 0 ? teamIds : [0]);

  const teamMap = Object.fromEntries((teams ?? []).map((t) => [t.id, t.team_name]));

  function enrichChallenge(c: (typeof allChallenges)[0]) {
    return {
      ...c,
      challengerName: teamMap[c.challenger_team_id] ?? 'Unknown',
      challengedName: teamMap[c.challenged_team_id] ?? 'Unknown',
    };
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">O2O Challenges</h1>
      <ChallengePanel
        myTeamId={team.id}
        opponents={allTeams ?? []}
        sent={(sent ?? []).map(enrichChallenge)}
        received={(received ?? []).map(enrichChallenge)}
      />
    </div>
  );
}
