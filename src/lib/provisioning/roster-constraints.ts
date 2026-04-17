/**
 * Roster constraint validation — enforced on every roster-modifying operation.
 *
 * Constraints (matching original BBCzar rules):
 * - Minimum active roster: 25 (10 pitchers + 15 fielders)
 * - Maximum total roster: 40
 */

export const ROSTER_LIMITS = {
  MIN_ACTIVE: 25,
  MIN_ACTIVE_PITCHERS: 10,
  MIN_ACTIVE_FIELDERS: 15,
  MAX_TOTAL: 40,
} as const;

export interface RosterCounts {
  activePitchers: number;
  activeFielders: number;
  reservePitchers: number;
  reserveFielders: number;
}

export function countRoster(
  players: { fielder: boolean; roster_status: string }[],
): RosterCounts {
  let activePitchers = 0;
  let activeFielders = 0;
  let reservePitchers = 0;
  let reserveFielders = 0;

  for (const p of players) {
    if (p.roster_status === 'active') {
      if (p.fielder) activeFielders++;
      else activePitchers++;
    } else {
      if (p.fielder) reserveFielders++;
      else reservePitchers++;
    }
  }

  return { activePitchers, activeFielders, reservePitchers, reserveFielders };
}

export interface RosterValidation {
  valid: boolean;
  errors: string[];
}

/**
 * Validate that roster counts meet all constraints.
 */
export function validateRoster(counts: RosterCounts): RosterValidation {
  const errors: string[] = [];
  const totalActive = counts.activePitchers + counts.activeFielders;
  const total =
    counts.activePitchers +
    counts.activeFielders +
    counts.reservePitchers +
    counts.reserveFielders;

  if (totalActive < ROSTER_LIMITS.MIN_ACTIVE) {
    errors.push(
      `Active roster has ${totalActive} players, minimum is ${ROSTER_LIMITS.MIN_ACTIVE}`,
    );
  }
  if (counts.activePitchers < ROSTER_LIMITS.MIN_ACTIVE_PITCHERS) {
    errors.push(
      `Only ${counts.activePitchers} active pitchers, minimum is ${ROSTER_LIMITS.MIN_ACTIVE_PITCHERS}`,
    );
  }
  if (counts.activeFielders < ROSTER_LIMITS.MIN_ACTIVE_FIELDERS) {
    errors.push(
      `Only ${counts.activeFielders} active fielders, minimum is ${ROSTER_LIMITS.MIN_ACTIVE_FIELDERS}`,
    );
  }
  if (total > ROSTER_LIMITS.MAX_TOTAL) {
    errors.push(
      `Total roster has ${total} players, maximum is ${ROSTER_LIMITS.MAX_TOTAL}`,
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if moving a player from active to reserve would violate constraints.
 */
export function canDeactivate(
  counts: RosterCounts,
  isFielder: boolean,
): RosterValidation {
  const projected = { ...counts };
  if (isFielder) {
    projected.activeFielders--;
    projected.reserveFielders++;
  } else {
    projected.activePitchers--;
    projected.reservePitchers++;
  }
  return validateRoster(projected);
}

/**
 * Check if adding a player to the roster would violate the max total.
 */
export function canAddPlayer(counts: RosterCounts): RosterValidation {
  const total =
    counts.activePitchers +
    counts.activeFielders +
    counts.reservePitchers +
    counts.reserveFielders;

  if (total >= ROSTER_LIMITS.MAX_TOTAL) {
    return {
      valid: false,
      errors: [`Roster is full (${total}/${ROSTER_LIMITS.MAX_TOTAL})`],
    };
  }
  return { valid: true, errors: [] };
}
