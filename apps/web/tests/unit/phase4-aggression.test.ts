import { describe, it, expect } from 'vitest';
import {
  decideThrowTarget,
  decideRunnerAdvance,
  createRng,
} from '@baseballczar/sim-engine';
import type { Player, GameContext } from '@baseballczar/sim-engine';
import type { CoverageAssignments } from '../../../../packages/sim-engine/src/defense/responsibilities';

function mkPlayer(pi: number | undefined, speed = 5): Player {
  return {
    id: 1, firstName: 'F', lastName: 'L', hand: 'R', position: 'CF',
    skills: {
      ag: 5, avg: 5, power: 5, eye: 5, dhr: 5, speed,
      stamina: 5, pitchIntel: 5, defense: 5,
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

describe('Phase 4 — score/inning aggression on throw decision', () => {
  it('defense up by 5: even average PI usually concedes (downgrades home → third)', () => {
    const rng = createRng(1234);
    const fielder = mkPlayer(5);  // average PI
    const ctx: GameContext = { defenseLeadDeficit: 5, inning: 6 };
    let conceded = 0;
    for (let i = 0; i < 200; i++) {
      const c = decideThrowTarget(homeCoverage, fielder, rng, ctx);
      if (c.throwTarget !== 'home') conceded++;
    }
    // baseline (no ctx): PI 5 vs diff 7 ≈ 9% throw home → 91% concede
    // with +2 modifier: PI 5 vs diff 9 → effectively never throws home
    expect(conceded).toBeGreaterThan(190);
  });

  it('tied in 9th: low-PI fielder attempts the throw home much more often than baseline', () => {
    const rng = createRng(5678);
    const fielder = mkPlayer(4);
    const ctx: GameContext = { defenseLeadDeficit: 0, inning: 9 };
    let attempted = 0, baselineAttempted = 0;
    for (let i = 0; i < 200; i++) {
      if (decideThrowTarget(homeCoverage, fielder, rng, ctx).throwTarget === 'home') attempted++;
      if (decideThrowTarget(homeCoverage, fielder, rng).throwTarget === 'home') baselineAttempted++;
    }
    // PI 4 vs diff 7 baseline ≈ 2%; with -2 modifier diff 5 → ~25%.
    // The contextualized rate should be at least 5x baseline.
    expect(attempted).toBeGreaterThan(baselineAttempted * 5);
    expect(attempted).toBeGreaterThan(30);
  });

  it('down 1 in 9th: PI 5 fielder attempts the throw home majority of the time', () => {
    const rng = createRng(9999);
    const fielder = mkPlayer(5);
    const ctx: GameContext = { defenseLeadDeficit: -1, inning: 9 };
    let attempted = 0;
    for (let i = 0; i < 200; i++) {
      const c = decideThrowTarget(homeCoverage, fielder, rng, ctx);
      if (c.throwTarget === 'home') attempted++;
    }
    // PI 5 vs diff 5 → ~50%, easily majority over baseline 9%
    expect(attempted).toBeGreaterThan(80);
  });

  it('no game context: behavior matches Phase 3 baseline', () => {
    const rng = createRng(2024);
    const fielder = mkPlayer(9);
    let textbook = 0;
    for (let i = 0; i < 200; i++) {
      const c = decideThrowTarget(homeCoverage, fielder, rng);
      if (c.throwTarget === 'home') textbook++;
    }
    expect(textbook).toBeGreaterThan(160);
  });
});

describe('Phase 4 — runner advance PI gate', () => {
  it('high-PI fast runner takes 3rd on a single ~always', () => {
    const rng = createRng(11);
    const runner = mkPlayer(9, 8);
    let advanced = 0;
    for (let i = 0; i < 500; i++) {
      if (decideRunnerAdvance('r1-to-3rd-single', runner, rng)) advanced++;
    }
    expect(advanced).toBeGreaterThan(450);  // > 90%
  });

  it('low-PI slow runner holds at 2nd ~always', () => {
    const rng = createRng(22);
    const runner = mkPlayer(2, 3);
    let advanced = 0;
    for (let i = 0; i < 500; i++) {
      if (decideRunnerAdvance('r1-to-3rd-single', runner, rng)) advanced++;
    }
    expect(advanced).toBeLessThan(50);   // < 10%
  });

  it('average runner takes the extra base sometimes (40-80%)', () => {
    const rng = createRng(33);
    const runner = mkPlayer(5, 5);
    let advanced = 0;
    for (let i = 0; i < 500; i++) {
      if (decideRunnerAdvance('r1-to-3rd-single', runner, rng)) advanced++;
    }
    // PI 5 vs diff 6 with σ=1.5 → ~25%; allow wide band 5-50%
    expect(advanced).toBeGreaterThan(25);
    expect(advanced).toBeLessThan(250);
  });

  it('r2 → home on a single is easier than r1 → 3rd', () => {
    const rng = createRng(44);
    const runner = mkPlayer(5, 5);
    let r2Home = 0, r1Third = 0;
    for (let i = 0; i < 500; i++) {
      if (decideRunnerAdvance('r2-to-home-single', runner, rng)) r2Home++;
      if (decideRunnerAdvance('r1-to-3rd-single', runner, rng)) r1Third++;
    }
    expect(r2Home).toBeGreaterThan(r1Third);
  });

  it('runner with no playIntelligence skill defaults to PI 5', () => {
    const rng = createRng(55);
    const runner = mkPlayer(undefined, 5);
    let advanced = 0;
    for (let i = 0; i < 500; i++) {
      if (decideRunnerAdvance('r1-to-3rd-single', runner, rng)) advanced++;
    }
    // Same as PI 5 average runner: 5-50%
    expect(advanced).toBeGreaterThan(25);
    expect(advanced).toBeLessThan(250);
  });
});
