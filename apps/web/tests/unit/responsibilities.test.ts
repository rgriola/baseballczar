// Last touched by agent: 2026-05-06T13:37:53Z
import { describe, it, expect } from 'vitest';
// Direct deep import — keeps the public sim-engine surface tight while
// still exercising the module under test.
import {
  getCoverage,
} from '../../../../packages/sim-engine/src/defense/responsibilities';

const runner = { id: 1 } as const;
const noBases = [null, null, null] as const;

describe('Defensive responsibilities — textbook coverage table', () => {
  describe('Outfield singles', () => {
    it('single, no runners → throw to 2B with SS or B2 trailing as cutoff', () => {
      // Ball pulled to RF: B2 covers, SS trails as cutoff.
      const right = getCoverage({
        fielder: 'RF', fieldedAt: { x: 170, y: 280 },
        result: 'single', bases: noBases, outs: 0, sprayAngleDeg: 30,
      });
      expect(right.throwTarget).toBe('second');
      expect(right.cutoff?.position).toBe('SS');
      expect(right.covers.find(c => c.base === 'second')?.position).toBe('B2');

      // Ball to LF: SS covers, B2 trails as cutoff.
      const left = getCoverage({
        fielder: 'LF', fieldedAt: { x: -170, y: 280 },
        result: 'single', bases: noBases, outs: 0, sprayAngleDeg: -30,
      });
      expect(left.throwTarget).toBe('second');
      expect(left.cutoff?.position).toBe('B2');
      expect(left.covers.find(c => c.base === 'second')?.position).toBe('SS');
    });

    it('single, runner on 1st → throw to 3B, SS cutoff, P backs up 3B', () => {
      const c = getCoverage({
        fielder: 'CF', fieldedAt: { x: 0, y: 320 },
        result: 'single', bases: [runner, null, null], outs: 0, sprayAngleDeg: 0,
      });
      expect(c.throwTarget).toBe('third');
      expect(c.cutoff?.position).toBe('SS');
      expect(c.backups.find(b => b.position === 'P')?.forBase).toBe('third');
    });

    it('single, runner on 2nd → throw home, B1 cutoff, P backs up home', () => {
      const c = getCoverage({
        fielder: 'CF', fieldedAt: { x: 0, y: 320 },
        result: 'single', bases: [null, runner, null], outs: 0, sprayAngleDeg: 0,
      });
      expect(c.throwTarget).toBe('home');
      expect(c.cutoff?.position).toBe('B1');
      expect(c.backups.find(b => b.position === 'P')?.forBase).toBe('home');
      expect(c.covers.find(cv => cv.base === 'home')?.position).toBe('C');
    });
  });

  describe('Outfield doubles', () => {
    it('double, no runners → throw to 2B with SS cutoff', () => {
      const c = getCoverage({
        fielder: 'RF', fieldedAt: { x: 200, y: 320 },
        result: 'double', bases: noBases, outs: 0, sprayAngleDeg: 30,
      });
      expect(c.throwTarget).toBe('second');
      expect(c.cutoff?.position).toBe('SS');
    });

    it('double with R1 → throw to 3B, SS cutoff', () => {
      const c = getCoverage({
        fielder: 'CF', fieldedAt: { x: 0, y: 350 },
        result: 'double', bases: [runner, null, null], outs: 0, sprayAngleDeg: 0,
      });
      expect(c.throwTarget).toBe('third');
      expect(c.cutoff?.position).toBe('SS');
    });
  });

  describe('Sac fly', () => {
    it('sac-fly always throws home with B1 cutoff and P backup at home', () => {
      const c = getCoverage({
        fielder: 'LF', fieldedAt: { x: -150, y: 290 },
        result: 'sac-fly', bases: [null, null, runner], outs: 1, sprayAngleDeg: -25,
      });
      expect(c.throwTarget).toBe('home');
      expect(c.cutoff?.position).toBe('B1');
      expect(c.backups.find(b => b.position === 'P')?.forBase).toBe('home');
    });
  });

  describe('Infield plays — keeps existing single-hop throws', () => {
    it('ground-out: throw to 1B, P covers if 1B fielded', () => {
      const ss = getCoverage({
        fielder: 'SS', fieldedAt: { x: -35, y: 130 },
        result: 'ground-out', bases: noBases, outs: 0, sprayAngleDeg: -10,
      });
      expect(ss.throwTarget).toBe('first');
      expect(ss.cutoff).toBeNull();
      expect(ss.covers.find(c => c.base === 'first')?.position).toBe('B1');

      const b1 = getCoverage({
        fielder: 'B1', fieldedAt: { x: 50, y: 85 },
        result: 'ground-out', bases: noBases, outs: 0, sprayAngleDeg: 22,
      });
      expect(b1.covers.find(c => c.base === 'first')?.position).toBe('P');
    });

    it('double-play: covers at 2B (pivot) and 1B', () => {
      const c = getCoverage({
        fielder: 'SS', fieldedAt: { x: -35, y: 130 },
        result: 'double-play', bases: [runner, null, null], outs: 0, sprayAngleDeg: -10,
      });
      expect(c.throwTarget).toBe('second');
      // SS fielded → B2 is the pivot at 2B
      expect(c.covers.find(cv => cv.base === 'second')?.position).toBe('B2');
      expect(c.covers.find(cv => cv.base === 'first')?.position).toBe('B1');
    });

    it('double-play from 3B side (5-4-3): B2 pivots and B1 holds first', () => {
      const c = getCoverage({
        fielder: 'B3', fieldedAt: { x: -75, y: 95 },
        result: 'double-play', bases: [runner, null, null], outs: 0, sprayAngleDeg: -25,
      });
      expect(c.throwTarget).toBe('second');
      expect(c.covers.find(cv => cv.base === 'second')?.position).toBe('B2');
      expect(c.covers.find(cv => cv.base === 'first')?.position).toBe('B1');
    });

    it('fielders-choice from SS keeps B2 covering second base', () => {
      const c = getCoverage({
        fielder: 'SS', fieldedAt: { x: -30, y: 120 },
        result: 'fielders-choice', bases: [runner, null, null], outs: 0, sprayAngleDeg: -8,
      });
      expect(c.throwTarget).toBe('second');
      expect(c.covers.find(cv => cv.base === 'second')?.position).toBe('B2');
    });
  });

  describe('No throw cases', () => {
    it('home-run, fly-out, walk → no throw target', () => {
      for (const result of ['home-run', 'fly-out', 'walk', 'strikeout', 'pop-out'] as const) {
        const c = getCoverage({
          fielder: 'CF', fieldedAt: { x: 0, y: 320 },
          result, bases: noBases, outs: 0, sprayAngleDeg: 0,
        });
        expect(c.throwTarget).toBeNull();
        expect(c.cutoff).toBeNull();
        expect(c.covers.length).toBe(0);
      }
    });
  });

  describe('Self-fielder filter', () => {
    it('does not assign cover/cutoff to the fielder making the play', () => {
      // SS fielded a single — SS should NOT also be listed as cutoff.
      const c = getCoverage({
        fielder: 'SS', fieldedAt: { x: -50, y: 200 },
        result: 'single', bases: [runner, null, null], outs: 0, sprayAngleDeg: -15,
      });
      // SS is the cutoff for throws to 3B. SS is also the fielder.
      // Filter must drop the cutoff entirely (or reassign — for now
      // we drop, because the fielder IS in position to throw).
      expect(c.cutoff).toBeNull();
    });
  });
});
