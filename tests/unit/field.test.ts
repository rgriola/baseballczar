import { describe, it, expect, beforeEach } from 'vitest';
import { Field } from '@/lib/sim-engine/Field';
import { AtBatOutcome } from '@/lib/sim-engine/types';

function makeBatter(name: string) {
  return { respPitch: 0, lineup: 1, playerId: 1, jersey: 1, lastName: name, speed: 5 };
}

describe('Field — baserunning state machine', () => {
  let field: Field;

  beforeEach(() => {
    field = new Field(1);
  });

  describe('empty bases', () => {
    it('single puts runner on first', () => {
      const b = makeBatter('Smith');
      field.setBatter(b.respPitch, b.lineup, b.playerId, b.jersey, b.lastName, b.speed);
      field.baseSequence(AtBatOutcome.Single);
      expect(field.firstBase).toBe(true);
      expect(field.secondBase).toBe(false);
      expect(field.thirdBase).toBe(false);
      expect(field.rob).toBe(1);
    });

    it('double puts runner on second', () => {
      const b = makeBatter('Jones');
      field.setBatter(b.respPitch, b.lineup, b.playerId, b.jersey, b.lastName, b.speed);
      field.baseSequence(AtBatOutcome.Double);
      expect(field.firstBase).toBe(false);
      expect(field.secondBase).toBe(true);
      expect(field.thirdBase).toBe(false);
    });

    it('triple puts runner on third', () => {
      const b = makeBatter('Williams');
      field.setBatter(b.respPitch, b.lineup, b.playerId, b.jersey, b.lastName, b.speed);
      field.baseSequence(AtBatOutcome.Triple);
      expect(field.firstBase).toBe(false);
      expect(field.secondBase).toBe(false);
      expect(field.thirdBase).toBe(true);
    });

    it('home run scores batter, bases empty', () => {
      const b = makeBatter('Brown');
      field.setBatter(b.respPitch, b.lineup, b.playerId, b.jersey, b.lastName, b.speed);
      field.baseSequence(AtBatOutcome.HomeRun);
      expect(field.firstBase).toBe(false);
      expect(field.secondBase).toBe(false);
      expect(field.thirdBase).toBe(false);
      expect(field.plateApp.rbi).toBe(1);
      expect(field.plateApp.hr).toBe(1);
    });

    it('walk puts runner on first', () => {
      const b = makeBatter('Davis');
      field.setBatter(b.respPitch, b.lineup, b.playerId, b.jersey, b.lastName, b.speed);
      field.baseSequence(AtBatOutcome.Walk);
      expect(field.firstBase).toBe(true);
      expect(field.plateApp.bb).toBe(1);
    });

    it('strikeout records an out', () => {
      const b = makeBatter('Miller');
      field.setBatter(b.respPitch, b.lineup, b.playerId, b.jersey, b.lastName, b.speed);
      field.baseSequence(AtBatOutcome.Strikeout);
      expect(field.outsRef).toBe(1);
      expect(field.plateApp.so).toBe(1);
      expect(field.rob).toBe(0);
    });

    it('ground out records an out', () => {
      const b = makeBatter('Wilson');
      field.setBatter(b.respPitch, b.lineup, b.playerId, b.jersey, b.lastName, b.speed);
      field.baseSequence(AtBatOutcome.GroundOut);
      expect(field.outsRef).toBe(1);
      expect(field.plateApp.ab).toBe(1);
    });
  });

  describe('runner on first', () => {
    beforeEach(() => {
      // Put a runner on first
      const b = makeBatter('Runner');
      field.setBatter(b.respPitch, b.lineup, b.playerId, b.jersey, b.lastName, b.speed);
      field.baseSequence(AtBatOutcome.Single);
    });

    it('single advances runner to second, batter to first', () => {
      const b = makeBatter('Batter2');
      field.setBatter(b.respPitch, b.lineup, b.playerId, b.jersey, b.lastName, b.speed);
      field.baseSequence(AtBatOutcome.Single);
      expect(field.firstBase).toBe(true);
      expect(field.secondBase).toBe(true);
      expect(field.rob).toBe(2);
    });

    it('double puts runner on third, batter on second', () => {
      const b = makeBatter('Batter2');
      field.setBatter(b.respPitch, b.lineup, b.playerId, b.jersey, b.lastName, b.speed);
      field.baseSequence(AtBatOutcome.Double);
      expect(field.thirdBase).toBe(true);
      expect(field.secondBase).toBe(true);
      expect(field.firstBase).toBe(false);
    });

    it('home run scores runner + batter', () => {
      const b = makeBatter('Batter2');
      field.setBatter(b.respPitch, b.lineup, b.playerId, b.jersey, b.lastName, b.speed);
      field.baseSequence(AtBatOutcome.HomeRun);
      expect(field.firstBase).toBe(false);
      expect(field.secondBase).toBe(false);
      expect(field.thirdBase).toBe(false);
      expect(field.plateApp.rbi).toBe(2); // runner + self
    });
  });

  describe('bases loaded', () => {
    beforeEach(() => {
      // Load the bases: walk, walk, walk
      for (let i = 0; i < 3; i++) {
        const b = makeBatter(`Runner${i}`);
        field.setBatter(b.respPitch, b.lineup, b.playerId, b.jersey, b.lastName, b.speed);
        field.baseSequence(AtBatOutcome.Walk);
      }
      expect(field.firstBase).toBe(true);
      expect(field.secondBase).toBe(true);
      expect(field.thirdBase).toBe(true);
    });

    it('walk with bases loaded scores a run', () => {
      const b = makeBatter('Walker');
      field.setBatter(b.respPitch, b.lineup, b.playerId, b.jersey, b.lastName, b.speed);
      field.baseSequence(AtBatOutcome.Walk);
      expect(field.plateApp.rbi).toBe(1);
      // Still bases loaded after the walk
      expect(field.firstBase).toBe(true);
      expect(field.secondBase).toBe(true);
      expect(field.thirdBase).toBe(true);
    });

    it('grand slam scores 4 RBI', () => {
      const b = makeBatter('Slugger');
      field.setBatter(b.respPitch, b.lineup, b.playerId, b.jersey, b.lastName, b.speed);
      field.baseSequence(AtBatOutcome.HomeRun);
      expect(field.plateApp.rbi).toBe(4); // 3 runners + self
      expect(field.rob).toBe(0);
    });

    it('single scores runner from third', () => {
      const b = makeBatter('Contact');
      field.setBatter(b.respPitch, b.lineup, b.playerId, b.jersey, b.lastName, b.speed);
      field.baseSequence(AtBatOutcome.Single);
      expect(field.plateApp.rbi).toBe(1); // runner from 3rd scores
      expect(field.rob).toBe(3); // bases still loaded
    });
  });

  describe('inning stats accumulation', () => {
    it('accumulates PA stats across multiple at-bats', () => {
      const b = makeBatter('Test');
      field.setBatter(b.respPitch, b.lineup, b.playerId, b.jersey, b.lastName, b.speed);
      field.baseSequence(AtBatOutcome.Single); // ab=1, b1=1

      field.setBatter(b.respPitch, b.lineup, b.playerId, b.jersey, b.lastName, b.speed);
      field.baseSequence(AtBatOutcome.Strikeout); // ab=1, so=1

      expect(field.innTot.ab).toBe(2);
      expect(field.innTot.b1).toBe(1);
      expect(field.innTot.so).toBe(1);
    });
  });
});
