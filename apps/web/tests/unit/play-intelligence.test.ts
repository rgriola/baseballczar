import { describe, it, expect } from 'vitest';
import { decideThrowTarget, getPlayIntelligence, rollPI, createRng } from '@baseballczar/sim-engine';
import type { Player } from '@baseballczar/sim-engine';
import type { CoverageAssignments } from '../../../../packages/sim-engine/src/defense/responsibilities';

function mkPlayer(pi: number | undefined): Player {
  return {
    id: 1, jerseyNumber: 1, firstName: 'F', lastName: 'L', hand: 'R', position: 'CF',
    skills: {
      ag: 5, avg: 5, power: 5, eye: 5, dhr: 5, speed: 5,
      stamina: 5, fielding: 5, throwing: 5, playIntelligence: 5,
      ...(pi !== undefined ? { playIntelligence: pi } : {}),
    },
  };
}

const homeCoverage: CoverageAssignments = {
  throwTarget: 'home',
  cutoff: { position: 'B1', toPoint: { x: 25, y: 35 }, forBase: 'home' },
  covers: [{ position: 'C', base: 'home', toPoint: { x: 0, y: 0 } }],
  backups: [{ position: 'P', toPoint: { x: 0, y: 25 }, forBase: 'home' }],
};

describe('Play Intelligence', () => {
  it('defaults missing playIntelligence to 5', () => {
    expect(getPlayIntelligence(mkPlayer(undefined))).toBe(5);
    expect(getPlayIntelligence(mkPlayer(8))).toBe(8);
    expect(getPlayIntelligence(undefined)).toBe(5);
  });

  it('rollPI passes more often as PI increases', () => {
    const rng = createRng(42);
    let highWins = 0, lowWins = 0;
    for (let i = 0; i < 1000; i++) {
      if (rollPI(9, 7, rng)) highWins++;
      if (rollPI(2, 7, rng)) lowWins++;
    }
    expect(highWins).toBeGreaterThan(800);   // PI 9 vs diff 7 → ~91%
    expect(lowWins).toBeLessThan(50);        // PI 2 vs diff 7 → < 1%
  });

  it('decideThrowTarget: high-PI fielder almost always picks textbook', () => {
    const rng = createRng(123);
    const fielder = mkPlayer(9);
    let textbook = 0;
    for (let i = 0; i < 200; i++) {
      const c = decideThrowTarget(homeCoverage, fielder, rng);
      if (c.throwTarget === 'home') textbook++;
    }
    expect(textbook).toBeGreaterThan(160);   // > 80% (PI 9 vs diff 7)
  });

  it('decideThrowTarget: low-PI fielder downgrades often', () => {
    const rng = createRng(456);
    const fielder = mkPlayer(2);
    let downgraded = 0;
    for (let i = 0; i < 200; i++) {
      const c = decideThrowTarget(homeCoverage, fielder, rng);
      if (c.throwTarget !== 'home') downgraded++;
    }
    expect(downgraded).toBeGreaterThan(170); // > 85% (PI 2 vs diff 7)
  });

  it('decideThrowTarget: home → third on downgrade preserves cutoff (still OF lane)', () => {
    const rng = createRng(789);
    const fielder = mkPlayer(1);  // very low PI → near-certain downgrade
    const c = decideThrowTarget(homeCoverage, fielder, rng);
    if (c.throwTarget === 'third') {
      // SS would normally be the cutoff for 3B, but our test input has B1 cutoff.
      // The downgrade preserves the cutoff field (it's still an OF lane throw).
      expect(c.cutoff).not.toBeNull();
    }
  });

  it('decideThrowTarget: routine throw to first is NOT rolled', () => {
    const rng = createRng(999);
    const fielder = mkPlayer(1);  // even very low PI shouldn't matter
    const firstCoverage: CoverageAssignments = {
      throwTarget: 'first',
      cutoff: null,
      covers: [{ position: 'B1', base: 'first', toPoint: { x: 90, y: 0 } }],
      backups: [],
    };
    for (let i = 0; i < 50; i++) {
      const c = decideThrowTarget(firstCoverage, fielder, rng);
      expect(c.throwTarget).toBe('first');
    }
  });

  it('decideThrowTarget: no throw target → no change', () => {
    const rng = createRng(111);
    const noThrow: CoverageAssignments = {
      throwTarget: null, cutoff: null, covers: [], backups: [],
    };
    const c = decideThrowTarget(noThrow, mkPlayer(5), rng);
    expect(c.throwTarget).toBeNull();
  });
});
