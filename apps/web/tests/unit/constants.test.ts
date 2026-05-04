import { describe, it, expect } from 'vitest';
import {
  HITTER,
  PITCHER,
  STAMINA_FACTOR,
  BATTER_THRESHOLD,
  GATE_RECEIPTS,
} from '@/lib/sim-engine/constants';

describe('sim-engine constants', () => {
  it('hitter factors are all positive', () => {
    for (const [key, val] of Object.entries(HITTER)) {
      expect(val, `HITTER.${key}`).toBeGreaterThan(0);
    }
  });

  it('pitcher AVG/POWER/EYE/DHR factors are negative (inverted)', () => {
    expect(PITCHER.AVG_FACTOR).toBeLessThan(0);
    expect(PITCHER.POWER_FACTOR).toBeLessThan(0);
    expect(PITCHER.EYE_FACTOR).toBeLessThan(0);
    expect(PITCHER.DHR_FACTOR).toBeLessThan(0);
  });

  it('stamina factor covers levels 1-10', () => {
    for (let i = 1; i <= 10; i++) {
      expect(STAMINA_FACTOR[i]).toBeDefined();
      expect(STAMINA_FACTOR[i]).toBeGreaterThan(0);
      expect(STAMINA_FACTOR[i]).toBeLessThan(1);
    }
  });

  it('higher stamina = lower degradation factor', () => {
    expect(STAMINA_FACTOR[10]).toBeLessThan(STAMINA_FACTOR[1]);
  });

  it('batter threshold covers levels 0-10', () => {
    for (let i = 0; i <= 10; i++) {
      expect(BATTER_THRESHOLD[i]).toBeDefined();
      expect(BATTER_THRESHOLD[i]).toBeGreaterThan(0);
    }
  });

  it('higher eye = higher batter threshold', () => {
    expect(BATTER_THRESHOLD[10]).toBeGreaterThan(BATTER_THRESHOLD[1]);
  });

  it('GATE_RECEIPTS values are reasonable', () => {
    expect(GATE_RECEIPTS.TICKET_PRICE).toBeGreaterThan(0);
    expect(GATE_RECEIPTS.HOME_SPLIT + GATE_RECEIPTS.VISITOR_SPLIT).toBeCloseTo(1);
    expect(GATE_RECEIPTS.STADIUM_OPS_PER_GAME).toBeLessThan(0);
  });
});
