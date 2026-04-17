/**
 * Gate Receipts — translated from gateReceipts.java.
 *
 * Original used flat per-game amounts:
 *   League:  Home $22,500 / Visitor $15,000
 *   Playoff: Home $35,000 / Visitor $25,000
 *
 * The food_bev, ads, stadium_ops were stubbed but never implemented in the
 * original. We implement simple versions here for a richer financial model.
 */

export interface GameRevenue {
  homeReceipts: number;
  visitorReceipts: number;
  homeFoodBev: number;
  homeAds: number;
  homeStadiumOps: number; // expense (negative)
}

const REVENUE = {
  regular: { home: 22500, visitor: 15000 },
  playoff: { home: 35000, visitor: 25000 },
  o2o:     { home: 35000, visitor: 3000 },
} as const;

/** Food/bev/souvenir = 15% of home gate */
const FOOD_BEV_RATE = 0.15;
/** Ads = 8% of home gate */
const ADS_RATE = 0.08;
/** Stadium ops = flat $5,000 per home game */
const STADIUM_OPS = 5000;

export function calculateGameRevenue(
  gameType: 'regular' | 'playoff' | 'o2o',
): GameRevenue {
  const rates = REVENUE[gameType];
  const homeReceipts = rates.home;
  const visitorReceipts = rates.visitor;

  return {
    homeReceipts,
    visitorReceipts,
    homeFoodBev: Math.round(homeReceipts * FOOD_BEV_RATE),
    homeAds: Math.round(homeReceipts * ADS_RATE),
    homeStadiumOps: -STADIUM_OPS,
  };
}
