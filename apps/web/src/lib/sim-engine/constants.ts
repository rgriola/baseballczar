/**
 * Tuning knobs for the sim engine — extracted from magic numbers
 * scattered across PlayerSkills, GateReceipts, etc.
 *
 * Adjust these to re-balance without hunting through formulae.
 */

// ─── Hitter skill factors ─────────────────────────────────────
export const HITTER = {
  AG_FACTOR: 0.025,
  AG_BASE: 0.1,
  AVG_FACTOR: 0.007,
  AVG_BASE: 0.1,
  POWER_FACTOR: 0.025,
  POWER_BASE: 0.05,
  EYE_FACTOR: 0.03,
  EYE_BASE: 0.15,
  DHR_FACTOR: 0.05,
  DHR_BASE: 0.35,
  SPEED_FACTOR: 0.002,
  SPEED_BASE: 0.003,
} as const;

// ─── Pitcher skill factors ────────────────────────────────────
export const PITCHER = {
  AG_FACTOR: 0.0272,
  AG_BASE: 0.15,
  AVG_FACTOR: -0.014545,
  AVG_BASE: 0.31,
  POWER_FACTOR: -0.0364,
  POWER_BASE: 0.5,
  EYE_FACTOR: -0.0418,
  EYE_BASE: 0.6,
  DHR_FACTOR: -0.054545,
  DHR_BASE: 0.95,
  SPEED_FACTOR: 0.002,
  SPEED_BASE: 0.003,
} as const;

// ─── Stamina / Fatigue ───────────────────────────────────────
/** Skill degradation rate by stamina attribute (1-10) */
export const STAMINA_FACTOR: Record<number, number> = {
  10: 0.025, 9: 0.03, 8: 0.035, 7: 0.04, 6: 0.05,
  5: 0.06, 4: 0.065, 3: 0.075, 2: 0.09, 1: 0.1,
};

/** Batter-count threshold before fatigue kicks in, by eye (0-10) */
export const BATTER_THRESHOLD: Record<number, number> = {
  10: 33, 9: 30, 8: 27, 7: 23, 6: 19,
  5: 17, 4: 15, 3: 13, 2: 10, 1: 7, 0: 5,
};

export const STAMINA_FACTOR_DEFAULT = 0.05;
export const BATTER_THRESHOLD_DEFAULT = 6;

// ─── Financials (GateReceipts) ────────────────────────────────
export const GATE_RECEIPTS = {
  BASE_ATTENDANCE: 20_000,
  TICKET_PRICE: 25,
  HOME_SPLIT: 0.6,
  VISITOR_SPLIT: 0.4,
  FOOD_BEV_PER_FAN: 8,
  SOUVENIR_PER_FAN: 3,
  AD_REVENUE_PER_GAME: 50_000,
  STADIUM_OPS_PER_GAME: -15_000,
} as const;
