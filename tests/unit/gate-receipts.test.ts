import { describe, it, expect } from 'vitest';
import { calculateGameRevenue } from '@/lib/sim-engine/GateReceipts';

describe('calculateGameRevenue', () => {
  it('returns correct regular game revenue', () => {
    const rev = calculateGameRevenue('regular');
    expect(rev.homeReceipts).toBe(22500);
    expect(rev.visitorReceipts).toBe(15000);
    expect(rev.homeFoodBev).toBe(Math.round(22500 * 0.15));
    expect(rev.homeAds).toBe(Math.round(22500 * 0.08));
    expect(rev.homeStadiumOps).toBe(-5000);
  });

  it('returns correct playoff revenue', () => {
    const rev = calculateGameRevenue('playoff');
    expect(rev.homeReceipts).toBe(35000);
    expect(rev.visitorReceipts).toBe(25000);
  });

  it('returns correct o2o revenue', () => {
    const rev = calculateGameRevenue('o2o');
    expect(rev.homeReceipts).toBe(35000);
    expect(rev.visitorReceipts).toBe(3000);
  });

  it('stadium ops is always negative', () => {
    for (const type of ['regular', 'playoff', 'o2o'] as const) {
      const rev = calculateGameRevenue(type);
      expect(rev.homeStadiumOps).toBeLessThan(0);
    }
  });
});
