// Last touched by agent: 2026-05-07T21:44:21Z
// Purpose: Normalizes persisted at-bat outcomes and replay outcome predicates.

const OUTCOME_CODE = {
  single: 1,
  double: 2,
  triple: 3,
  homeRun: 4,
  walk: 5,
  ballInPlayOut: 6,
  strikeout: 7,
} as const;

export function mapPersistedOutcomeCode(outcomeCode: number): string {
  if (outcomeCode === OUTCOME_CODE.single) return 'single';
  if (outcomeCode === OUTCOME_CODE.double) return 'double';
  if (outcomeCode === OUTCOME_CODE.triple) return 'triple';
  if (outcomeCode === OUTCOME_CODE.homeRun) return 'home-run';
  if (outcomeCode === OUTCOME_CODE.walk) return 'walk';
  if (outcomeCode === OUTCOME_CODE.strikeout) return 'strikeout';
  return 'ground-out';
}

export function normalizeOutcomeFromDescription(mappedOutcome: string, description: string | null): string {
  const raw = (description ?? '').toLowerCase();
  if (!raw) return mappedOutcome;

  if (raw.includes('double play')) return 'double-play';
  if (raw.includes("fielder's choice") || raw.includes('fielders choice')) return 'fielders-choice';
  if (raw.includes('fouls out') || raw.includes('foul out')) return 'foul-out';
  if (raw.includes('pops out') || raw.includes('pop out')) return 'pop-out';
  if (raw.includes('lines out') || raw.includes('line out')) return 'line-out';
  if (raw.includes('flies out') || raw.includes('fly out')) return 'fly-out';
  if (raw.includes('grounds out') || raw.includes('ground out')) return 'ground-out';

  return mappedOutcome;
}

export function isBattedBallOutcome(outcome: string): boolean {
  return outcome === 'single'
    || outcome === 'double'
    || outcome === 'triple'
    || outcome === 'home-run'
    || outcome === 'ground-out'
    || outcome === 'line-out'
    || outcome === 'fly-out'
    || outcome === 'pop-out'
    || outcome === 'foul-out'
    || outcome === 'double-play'
    || outcome === 'fielders-choice';
}

export function isCatchOutOutcome(outcome: string): boolean {
  return outcome === 'line-out'
    || outcome === 'fly-out'
    || outcome === 'pop-out'
    || outcome === 'foul-out';
}
