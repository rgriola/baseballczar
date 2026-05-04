/**
 * Manager Personality profiles.
 *
 * Each profile is a set of tuning knobs that adjust decision thresholds
 * across all three AI Manager tiers. The same engine code runs for every
 * manager — only the weights change.
 *
 * This lets us model real-world managerial archetypes:
 *   - Old-school "play for one run" skippers
 *   - Analytics-driven front-office types
 *   - Aggressive, risk-taking small-ball managers
 *   - Default balanced managers
 */

// ─── Profile interface ──────────────────────────────────────────

export interface ManagerProfile {
  name: string;
  style: 'aggressive' | 'conservative' | 'analytics' | 'balanced';

  // ── Tier 1: Strategic ──────────────────────────
  /** Multiplier on pitch-count threshold before pulling the starter.
   *  < 1 = pull earlier (short leash), > 1 = let them work (long leash). */
  starterLeash: number;
  /** How many runs allowed in an inning before the hook.
   *  Lower = quicker hook. */
  bleedingThreshold: number;
  /** Willingness to pinch hit (0-1 scale). Higher = more aggressive PH use. */
  pinchHitAggression: number;
  /** Willingness to burn a bench runner for speed (0-1). */
  pinchRunAggression: number;
  /** Trust in the closer: multiplier on save-situation urgency. */
  closerTrust: number;

  // ── Tier 2: Tactical ──────────────────────────
  /** How often to throw off-speed / breaking on first pitch (0-1).
   *  Higher = more deceptive, lower = more fastball-first. */
  firstPitchOffSpeed: number;
  /** Multiplier on steal signal probability. > 1 = run more. */
  stealAggression: number;
  /** Willingness to bunt (0-1). Higher = more sac bunts. */
  buntWillingness: number;
  /** Hit-and-run frequency multiplier. */
  hitAndRunFreq: number;
  /** Shift aggressiveness (0-1). Higher = shift more often and more extreme. */
  shiftAggression: number;
  /** Intentional walk willingness (0-1). Higher = more IBBs. */
  ibbWillingness: number;

  // ── Tier 3: Reactive ──────────────────────────
  /** Throw-to-lead-runner bias (0-1). Higher = always throw ahead of the
   *  lead runner even when the play is tight. */
  throwAheadBias: number;
  /** Cutoff aggression: probability of cutting and relaying vs letting through. */
  cutoffAggressiveness: number;
  /** Runner tag-up aggression. Higher = send runners on shallower flies. */
  tagUpAggression: number;
}

// ─── Built-in profiles ──────────────────────────────────────────

export const MANAGER_PROFILES: Record<string, ManagerProfile> = {
  balanced: {
    name: 'Balanced Manager',
    style: 'balanced',
    // Strategic
    starterLeash: 1.0,
    bleedingThreshold: 3,
    pinchHitAggression: 0.5,
    pinchRunAggression: 0.3,
    closerTrust: 1.0,
    // Tactical
    firstPitchOffSpeed: 0.3,
    stealAggression: 1.0,
    buntWillingness: 0.4,
    hitAndRunFreq: 1.0,
    shiftAggression: 0.5,
    ibbWillingness: 0.5,
    // Reactive
    throwAheadBias: 0.6,
    cutoffAggressiveness: 0.5,
    tagUpAggression: 0.5,
  },

  aggressive: {
    name: 'Aggressive Skipper',
    style: 'aggressive',
    // Strategic: long leash, slow to pull, burns bench aggressively
    starterLeash: 1.15,
    bleedingThreshold: 4,
    pinchHitAggression: 0.7,
    pinchRunAggression: 0.6,
    closerTrust: 0.8,  // doesn't wait for classic save spots
    // Tactical: runs early, bunts less, aggressive on-base approach
    firstPitchOffSpeed: 0.2,
    stealAggression: 1.6,
    buntWillingness: 0.2,
    hitAndRunFreq: 1.5,
    shiftAggression: 0.3,
    ibbWillingness: 0.3,
    // Reactive: throw ahead, send runners
    throwAheadBias: 0.8,
    cutoffAggressiveness: 0.7,
    tagUpAggression: 0.8,
  },

  conservative: {
    name: 'Conservative Skipper',
    style: 'conservative',
    // Strategic: short leash, protect leads, save the bench
    starterLeash: 0.85,
    bleedingThreshold: 2,
    pinchHitAggression: 0.3,
    pinchRunAggression: 0.15,
    closerTrust: 1.3,  // trusts the closer, waits for save spots
    // Tactical: play for one run, bunt more, less running
    firstPitchOffSpeed: 0.4,
    stealAggression: 0.6,
    buntWillingness: 0.7,
    hitAndRunFreq: 0.5,
    shiftAggression: 0.3,
    ibbWillingness: 0.7,
    // Reactive: hold runners, take the sure out
    throwAheadBias: 0.4,
    cutoffAggressiveness: 0.3,
    tagUpAggression: 0.3,
  },

  analytics: {
    name: 'Analytics-Driven Manager',
    style: 'analytics',
    // Strategic: data-driven pull points, platoon splits matter most
    starterLeash: 0.95,
    bleedingThreshold: 3,
    pinchHitAggression: 0.6,
    pinchRunAggression: 0.4,
    closerTrust: 1.0,
    // Tactical: shift heavy, matchup-driven, less small ball
    firstPitchOffSpeed: 0.45,  // more deceptive sequencing
    stealAggression: 0.8,     // only steal when the numbers say go
    buntWillingness: 0.15,    // bunts are rarely +EV
    hitAndRunFreq: 0.7,
    shiftAggression: 0.9,     // maximum defensive shifting
    ibbWillingness: 0.6,
    // Reactive: probability-driven decisions
    throwAheadBias: 0.5,
    cutoffAggressiveness: 0.5,
    tagUpAggression: 0.5,
  },
};

// ─── Profile-aware decision modifiers ────────────────────────────

/**
 * Apply the manager profile to a pitch-count threshold.
 * Returns the adjusted threshold for pulling the starter.
 */
export function adjustedPitchThreshold(
  basePitchThreshold: number,
  profile: ManagerProfile,
): number {
  return basePitchThreshold * profile.starterLeash;
}

/**
 * Apply the manager profile to the bleeding threshold.
 * Returns how many runs in an inning triggers a pitching change.
 */
export function adjustedBleedingThreshold(profile: ManagerProfile): number {
  return profile.bleedingThreshold;
}

/**
 * Should we attempt a steal? Combines base probability with profile aggression.
 */
export function shouldAttemptSteal(
  baseProb: number,
  profile: ManagerProfile,
): boolean {
  return Math.random() < baseProb * profile.stealAggression;
}

/**
 * Should we bunt? Combines base probability with profile willingness.
 */
export function shouldBunt(
  baseProb: number,
  profile: ManagerProfile,
): boolean {
  return Math.random() < baseProb * profile.buntWillingness;
}

/**
 * Should we shift defensively? Profile-adjusted threshold.
 */
export function shouldShift(
  batterPower: number,
  profile: ManagerProfile,
): boolean {
  // Base threshold: shift when power >= 7
  // Analytics manager shifts at power >= 5 (7 * (1 - 0.9 * 0.3) ≈ 5)
  const threshold = 7 * (1 - profile.shiftAggression * 0.3);
  return batterPower >= threshold;
}

/**
 * Should we issue an intentional walk?
 * Profile adjusts the threat threshold.
 */
export function shouldIBB(
  batterThreat: number,
  onDeckThreat: number,
  profile: ManagerProfile,
): boolean {
  const threshold = 7.5 - profile.ibbWillingness * 1.5;  // 6.0 (high) to 7.5 (low)
  return batterThreat >= threshold && onDeckThreat < batterThreat - 1.5;
}

/**
 * Should the runner tag up on this fly ball?
 * Profile adjusts the distance threshold for sending the runner.
 */
export function shouldTagUp(
  throwDistFt: number,
  profile: ManagerProfile,
): boolean {
  // Base: send if throw > 200ft. Aggressive: send at 150ft.
  const threshold = 200 - profile.tagUpAggression * 100;
  return throwDistFt >= threshold;
}
