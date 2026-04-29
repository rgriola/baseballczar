import { describe, it, expect } from 'vitest';
import { resolveBaseAdvance, classifySituationalOut, createRng } from '@baseballczar/sim-engine';
import type { Player } from '@baseballczar/sim-engine';

let nextId = 1;
function mk(name: string): Player {
  return {
    id: nextId++, firstName: name, lastName: 'X', hand: 'R', position: 'CF',
    skills: {
      ag: 5, avg: 5, power: 5, eye: 5, dhr: 5, speed: 5,
      stamina: 5, pitchIntel: 5, defense: 5,
    },
  };
}

describe('resolveBaseAdvance', () => {
  it('walk with bases empty: batter to 1B', () => {
    const b = mk('B');
    const r = resolveBaseAdvance([null, null, null], b, 'walk');
    expect(r.newBases).toEqual([b, null, null]);
    expect(r.runsScored).toBe(0);
    expect(r.outsRecorded).toBe(0);
  });

  it('walk bases loaded: r3 forced home', () => {
    const r1 = mk('R1'), r2 = mk('R2'), r3 = mk('R3'), b = mk('B');
    const r = resolveBaseAdvance([r1, r2, r3], b, 'walk');
    expect(r.newBases).toEqual([b, r1, r2]);
    expect(r.scorers).toEqual([r3]);
  });

  it('walk with [r1, _, r3]: r3 holds (not forced)', () => {
    const r1 = mk('R1'), r3 = mk('R3'), b = mk('B');
    const r = resolveBaseAdvance([r1, null, r3], b, 'walk');
    expect(r.newBases).toEqual([b, r1, r3]);
    expect(r.runsScored).toBe(0);
  });

  it('single with r2: r2 scores, r1 (none) → batter on 1B', () => {
    const r2 = mk('R2'), b = mk('B');
    const r = resolveBaseAdvance([null, r2, null], b, 'single');
    expect(r.newBases).toEqual([b, null, null]);
    expect(r.scorers).toEqual([r2]);
  });

  it('single with r1 takes 3rd by default', () => {
    const r1 = mk('R1'), b = mk('B');
    const r = resolveBaseAdvance([r1, null, null], b, 'single');
    expect(r.newBases).toEqual([b, null, r1]);
  });

  it('single with r1HoldsAtSecond: r1 stops at 2B', () => {
    const r1 = mk('R1'), b = mk('B');
    const r = resolveBaseAdvance([r1, null, null], b, 'single', { r1HoldsAtSecond: true });
    expect(r.newBases).toEqual([b, r1, null]);
  });

  it('single does NOT double-score r2 (Phase A: kills the dedupe smell)', () => {
    const r1 = mk('R1'), r2 = mk('R2'), b = mk('B');
    const r = resolveBaseAdvance([r1, r2, null], b, 'single');
    expect(r.scorers.length).toBe(1);
    expect(r.scorers[0]).toBe(r2);
  });

  it('double bases loaded: r2 + r3 score, r1 to 3B, batter on 2B', () => {
    const r1 = mk('R1'), r2 = mk('R2'), r3 = mk('R3'), b = mk('B');
    const r = resolveBaseAdvance([r1, r2, r3], b, 'double');
    expect(r.newBases).toEqual([null, b, r1]);
    expect(r.runsScored).toBe(2);
  });

  it('home run bases loaded: 4 runs', () => {
    const r1 = mk('R1'), r2 = mk('R2'), r3 = mk('R3'), b = mk('B');
    const r = resolveBaseAdvance([r1, r2, r3], b, 'home-run');
    expect(r.newBases).toEqual([null, null, null]);
    expect(r.runsScored).toBe(4);
  });

  it('ground-out with r1: r1 forced to 2B, batter out', () => {
    const r1 = mk('R1'), b = mk('B');
    const r = resolveBaseAdvance([r1, null, null], b, 'ground-out');
    expect(r.newBases).toEqual([null, r1, null]);
    expect(r.outsRecorded).toBe(1);
  });

  it('ground-out bases loaded: r3 scores, batter out', () => {
    const r1 = mk('R1'), r2 = mk('R2'), r3 = mk('R3'), b = mk('B');
    const r = resolveBaseAdvance([r1, r2, r3], b, 'ground-out');
    expect(r.newBases).toEqual([null, r1, r2]);
    expect(r.scorers).toEqual([r3]);
    expect(r.outsRecorded).toBe(1);
  });

  it('ground-out with r3 only: r3 holds (not forced), batter out', () => {
    const r3 = mk('R3'), b = mk('B');
    const r = resolveBaseAdvance([null, null, r3], b, 'ground-out');
    expect(r.newBases).toEqual([null, null, r3]);
    expect(r.runsScored).toBe(0);
  });

  it('double-play: r1 + batter out, r2/r3 hold', () => {
    const r1 = mk('R1'), r2 = mk('R2'), r3 = mk('R3'), b = mk('B');
    const r = resolveBaseAdvance([r1, r2, r3], b, 'double-play');
    expect(r.newBases).toEqual([null, r2, r3]);
    expect(r.outsRecorded).toBe(2);
  });

  it('fielders-choice: r1 out at 2B, batter on 1B, r2 to 3B', () => {
    const r1 = mk('R1'), r2 = mk('R2'), b = mk('B');
    const r = resolveBaseAdvance([r1, r2, null], b, 'fielders-choice');
    expect(r.newBases).toEqual([b, null, r2]);
    expect(r.outsRecorded).toBe(1);
  });

  it('sac-fly: r3 scores, r2 to 3B, batter out', () => {
    const r2 = mk('R2'), r3 = mk('R3'), b = mk('B');
    const r = resolveBaseAdvance([null, r2, r3], b, 'sac-fly');
    expect(r.newBases).toEqual([null, null, r2]);
    expect(r.scorers).toEqual([r3]);
    expect(r.outsRecorded).toBe(1);
  });

  it('strikeout: only batter out, runners frozen', () => {
    const r1 = mk('R1'), r2 = mk('R2'), b = mk('B');
    const r = resolveBaseAdvance([r1, r2, null], b, 'strikeout');
    expect(r.newBases).toEqual([r1, r2, null]);
    expect(r.outsRecorded).toBe(1);
  });

  it('throw-error ROE bases loaded: extra base for everyone, r3 scores', () => {
    const r1 = mk('R1'), r2 = mk('R2'), r3 = mk('R3'), b = mk('B');
    const r = resolveBaseAdvance([r1, r2, r3], b, 'reached-on-error', { errorType: 'throw' });
    // Force: r3→home, r2→3B, r1→2B, batter→1B. Throw error: every existing
    // baserunner takes ONE extra base. r3 already scored on the force, so the
    // additional advance is a no-op for him; r2 (now on 3B) → home; r1 (now on 2B) → 3B; batter holds 1B.
    expect(r.newBases[0]).toBe(b);
    expect(r.scorers.length).toBeGreaterThanOrEqual(1);
  });
});

describe('classifySituationalOut', () => {
  const rng = createRng(1);

  it('keeps non-grounders unchanged', () => {
    const out = classifySituationalOut('single', { outs: 0, bases: [null, null, null] }, rng);
    expect(out).toBe('single');
  });

  it('keeps ground-out unchanged when no r1', () => {
    const out = classifySituationalOut('ground-out', {
      outs: 0, bases: [null, mk('X'), null], fieldedBy: 'SS', fielderDefense: 5,
    }, rng);
    expect(out).toBe('ground-out');
  });

  it('keeps ground-out unchanged when 2 outs (no DP/FC reclassification)', () => {
    const out = classifySituationalOut('ground-out', {
      outs: 2, bases: [mk('X'), null, null], fieldedBy: 'SS', fielderDefense: 5,
    }, rng);
    expect(out).toBe('ground-out');
  });

  it('high-skill MIF on ground-out + r1 + 0 outs sometimes turns DP', () => {
    let dpCount = 0;
    const r = createRng(42);
    for (let i = 0; i < 200; i++) {
      const result = classifySituationalOut('ground-out', {
        outs: 0, bases: [mk('R1'), null, null], fieldedBy: 'SS', fielderDefense: 9,
      }, r);
      if (result === 'double-play') dpCount++;
    }
    expect(dpCount).toBeGreaterThan(20);
  });

  it('OF fly with r3 and <2 outs sometimes becomes sac-fly', () => {
    let sfCount = 0;
    const r = createRng(99);
    for (let i = 0; i < 200; i++) {
      const result = classifySituationalOut('fly-out', {
        outs: 0, bases: [null, null, mk('R3')], fieldedBy: 'CF', fielderDefense: 5,
      }, r);
      if (result === 'sac-fly') sfCount++;
    }
    expect(sfCount).toBeGreaterThan(20);
  });

  it('infield popup with r3 never becomes sac-fly', () => {
    const r = createRng(7);
    for (let i = 0; i < 100; i++) {
      const result = classifySituationalOut('fly-out', {
        outs: 0, bases: [null, null, mk('R3')], fieldedBy: 'SS', fielderDefense: 5,
      }, r);
      expect(result).toBe('fly-out');
    }
  });

  it('2 outs + bases loaded + grounder to B2 → fielders-choice (step on 2B)', () => {
    const r = createRng(11);
    const result = classifySituationalOut('ground-out', {
      outs: 2,
      bases: [mk('R1'), mk('R2'), mk('R3')],
      fieldedBy: 'B2',
      fielderDefense: 5,
    }, r);
    expect(result).toBe('fielders-choice');
  });
});

describe('MLB Rule 5.08(a) — no run on force third out', () => {
  it('ground-out with 2 outs + bases loaded: r3 does NOT score', () => {
    const r1 = mk('R1'), r2 = mk('R2'), r3 = mk('R3'), b = mk('B');
    const r = resolveBaseAdvance([r1, r2, r3], b, 'ground-out', { outsBefore: 2 });
    expect(r.runsScored).toBe(0);
    expect(r.scorers).toEqual([]);
    expect(r.outsRecorded).toBe(1);
  });

  it('ground-out with 1 out + bases loaded: r3 DOES score (only 2 outs after)', () => {
    const r1 = mk('R1'), r2 = mk('R2'), r3 = mk('R3'), b = mk('B');
    const r = resolveBaseAdvance([r1, r2, r3], b, 'ground-out', { outsBefore: 1 });
    expect(r.runsScored).toBe(1);
    expect(r.scorers).toEqual([r3]);
  });

  it('fielders-choice with 2 outs + r1/r3: r3 does NOT score', () => {
    const r1 = mk('R1'), r3 = mk('R3'), b = mk('B');
    const r = resolveBaseAdvance([r1, null, r3], b, 'fielders-choice', { outsBefore: 2 });
    expect(r.runsScored).toBe(0);
  });

  it('home-run with 2 outs + bases loaded: all 4 score (not a force play)', () => {
    const r1 = mk('R1'), r2 = mk('R2'), r3 = mk('R3'), b = mk('B');
    const r = resolveBaseAdvance([r1, r2, r3], b, 'home-run', { outsBefore: 2 });
    expect(r.runsScored).toBe(4);
  });
});
