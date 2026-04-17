interface Props {
  game: {
    home_runs: number;
    visitor_runs: number;
    home_hits: number;
    visitor_hits: number;
    innings: number;
    home_linescore: number[] | null;
    visitor_linescore: number[] | null;
    winning_team_id: number | null;
    home_team_id: number;
    visitor_team_id: number;
  };
  homeName: string;
  visitorName: string;
}

export default function Scoreboard({ game, homeName, visitorName }: Props) {
  const numInnings = game.innings || 9;
  const homeLine = game.home_linescore ?? [];
  const visitorLine = game.visitor_linescore ?? [];

  // Build column headers: 1..numInnings
  const inningHeaders = Array.from({ length: numInnings }, (_, i) => i + 1);

  return (
    <div className="overflow-x-auto">
      <table className="text-sm">
        <thead>
          <tr className="text-gray-400">
            <th className="pb-2 pr-4 text-left font-normal">Team</th>
            {inningHeaders.map((n) => (
              <th key={n} className="w-8 pb-2 text-center font-normal">
                {n}
              </th>
            ))}
            <th className="w-10 pb-2 pl-3 text-center font-semibold text-gray-300">R</th>
            <th className="w-10 pb-2 text-center font-semibold text-gray-300">H</th>
          </tr>
        </thead>
        <tbody>
          {/* Visitor row */}
          <tr className={game.winning_team_id === game.visitor_team_id ? 'text-white font-semibold' : 'text-gray-400'}>
            <td className="py-1 pr-4 text-left">{visitorName}</td>
            {inningHeaders.map((n) => (
              <td key={n} className="py-1 text-center">
                {visitorLine[n - 1] !== undefined ? visitorLine[n - 1] : ''}
              </td>
            ))}
            <td className="py-1 pl-3 text-center font-bold">{game.visitor_runs}</td>
            <td className="py-1 text-center">{game.visitor_hits}</td>
          </tr>
          {/* Home row */}
          <tr className={game.winning_team_id === game.home_team_id ? 'text-white font-semibold' : 'text-gray-400'}>
            <td className="py-1 pr-4 text-left">{homeName}</td>
            {inningHeaders.map((n) => (
              <td key={n} className="py-1 text-center">
                {homeLine[n - 1] !== undefined ? homeLine[n - 1] : ''}
              </td>
            ))}
            <td className="py-1 pl-3 text-center font-bold">{game.home_runs}</td>
            <td className="py-1 text-center">{game.home_hits}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
