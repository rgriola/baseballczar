import type { ScoreBoardState } from './types';

export function createScoreBoard(
  visitorName: string, visitorId: number,
  homeName: string, homeId: number,
): ScoreBoardState {
  return {
    visitor: {
      name: visitorName, teamId: visitorId, finalInning: 0,
      totalRuns: 0, totalHits: 0, totalErrors: 0,
      runs: new Array(35).fill(0),
      hits: new Array(35).fill(0),
      errors: new Array(35).fill(0),
    },
    home: {
      name: homeName, teamId: homeId, finalInning: 0,
      totalRuns: 0, totalHits: 0, totalErrors: 0,
      runs: new Array(35).fill(0),
      hits: new Array(35).fill(0),
      errors: new Array(35).fill(0),
    },
  };
}

export function addInningScore(
  board: ScoreBoardState,
  half: 'top' | 'bottom',
  inning: number,
  runs: number,
  hits: number,
  totalRuns: number,
  totalHits: number,
): void {
  const side = half === 'top' ? board.visitor : board.home;
  side.runs[inning] = runs;
  side.hits[inning] = hits;
  side.totalRuns = totalRuns;
  side.totalHits = totalHits;
  side.finalInning = inning;
}
