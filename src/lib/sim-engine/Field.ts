import { AtBatOutcome } from './types';
import type { RunnerState, PlateAppearanceStats } from './types';

const EMPTY_RUNNER: RunnerState = {
  respPitch: -1, lineup: -1, playerId: 0,
  jersey: 0, lastName: '', speed: 0, runs: 0,
};

function emptyRunner(): RunnerState {
  return { ...EMPTY_RUNNER };
}

function emptyPA(): PlateAppearanceStats {
  return { ab: 0, b1: 0, b2: 0, b3: 0, hr: 0, rbi: 0, bb: 0, so: 0, r: 0 };
}

/**
 * Manages base runners and scoring for one half-inning.
 * Translated from Field.java
 *
 * runners[0] = batter (home plate)
 * runners[1] = first base
 * runners[2] = second base
 * runners[3] = third base
 * runners[4..6] = scoring slots used to track which runners crossed home
 */
export class Field {
  firstBase = false;
  secondBase = false;
  thirdBase = false;
  outsRef = 0;
  outsStatus = 0;
  inning: number;

  /** Inning cumulative totals */
  innTot: PlateAppearanceStats;

  /** Current plate-appearance stats (reset each batter) */
  plateApp: PlateAppearanceStats;

  /** Runner slots: 0=batter, 1-3=bases, 4-6=scoring trackers */
  runners: RunnerState[];

  /** Count of runners on base */
  rob = 0;

  constructor(inning: number) {
    this.inning = inning;
    this.innTot = emptyPA();
    this.plateApp = emptyPA();
    this.runners = Array.from({ length: 7 }, () => emptyRunner());
  }

  private updateRob(): void {
    this.rob = (this.firstBase ? 1 : 0) + (this.secondBase ? 1 : 0) + (this.thirdBase ? 1 : 0);
  }

  /**
   * Set the batter info into runner[0] before calling baseSequence.
   */
  setBatter(respPitch: number, lineup: number, playerId: number, jersey: number, lastName: string, speed: number): void {
    this.runners[0] = { respPitch, lineup, playerId, jersey, lastName, speed, runs: 0 };
  }

  /**
   * Process one at-bat outcome: advance runners, track scoring, credit stats.
   * Returns descriptions of what happened for play-by-play.
   */
  baseSequence(outcome: AtBatOutcome): string[] {
    const plays: string[] = [];
    this.outsStatus = 0;
    this.plateApp = emptyPA();

    // Reset scoring slots
    for (let i = 4; i <= 6; i++) this.runners[i] = emptyRunner();

    if (outcome === AtBatOutcome.GroundOut || outcome === AtBatOutcome.Strikeout) {
      this.outsStatus = outcome === AtBatOutcome.Strikeout ? 7 : 6;
    }

    // Process bases in order: third → second → first → batter
    plays.push(...this.processThirdBase(outcome));
    plays.push(...this.processSecondBase(outcome));
    plays.push(...this.processFirstBase(outcome));
    plays.push(...this.processBatter(outcome));

    // Collect stats for this PA
    this.collectStats(outcome);

    // Add PA stats to inning totals
    this.innTot.ab += this.plateApp.ab;
    this.innTot.b1 += this.plateApp.b1;
    this.innTot.b2 += this.plateApp.b2;
    this.innTot.b3 += this.plateApp.b3;
    this.innTot.hr += this.plateApp.hr;
    this.innTot.rbi += this.plateApp.rbi;
    this.innTot.bb += this.plateApp.bb;
    this.innTot.so += this.plateApp.so;

    this.updateRob();
    return plays;
  }

  private collectStats(outcome: AtBatOutcome): void {
    switch (outcome) {
      case AtBatOutcome.Strikeout:
        this.plateApp.ab++;
        this.plateApp.so++;
        this.outsRef++;
        break;
      case AtBatOutcome.GroundOut:
        this.plateApp.ab++;
        this.outsRef++;
        break;
      case AtBatOutcome.Single:
        this.plateApp.ab++;
        this.plateApp.b1++;
        break;
      case AtBatOutcome.Double:
        this.plateApp.ab++;
        this.plateApp.b2++;
        break;
      case AtBatOutcome.Triple:
        this.plateApp.ab++;
        this.plateApp.b3++;
        break;
      case AtBatOutcome.HomeRun:
        this.plateApp.ab++;
        this.plateApp.hr++;
        break;
      case AtBatOutcome.Walk:
        this.plateApp.bb++;
        break;
    }
  }

  // ─── Third Base ───────────────────────────────────────────────
  private processThirdBase(h: AtBatOutcome): string[] {
    const plays: string[] = [];
    if (!this.thirdBase) return plays;

    const r = this.runners[3];
    switch (h) {
      case AtBatOutcome.Single:
        plays.push(`${r.lastName} scores from 3rd on the single`);
        this.runners[6] = { ...r, runs: 1 };
        this.runners[3] = emptyRunner();
        this.thirdBase = false;
        this.plateApp.rbi++;
        break;
      case AtBatOutcome.Walk:
        if (this.firstBase && this.secondBase) {
          plays.push(`${r.lastName} scores from 3rd on the walk (bases loaded)`);
          this.runners[6] = { ...r, runs: 1 };
          this.runners[3] = emptyRunner();
          this.thirdBase = false;
          this.plateApp.rbi++;
        }
        // else stays put
        break;
      case AtBatOutcome.Double:
      case AtBatOutcome.Triple:
      case AtBatOutcome.HomeRun:
        plays.push(`${r.lastName} scores from 3rd on the ${AtBatOutcome[h].toLowerCase()}`);
        this.runners[6] = { ...r, runs: 1 };
        this.runners[3] = emptyRunner();
        this.thirdBase = false;
        this.plateApp.rbi++;
        break;
      case AtBatOutcome.Strikeout:
        if (this.outsRef >= 2) {
          this.runners[3] = emptyRunner();
          this.thirdBase = false;
        }
        break;
      case AtBatOutcome.GroundOut:
        if (this.outsRef >= 2) {
          this.runners[3] = emptyRunner();
          this.thirdBase = false;
        }
        break;
    }
    return plays;
  }

  // ─── Second Base ──────────────────────────────────────────────
  private processSecondBase(h: AtBatOutcome): string[] {
    const plays: string[] = [];
    if (!this.secondBase) return plays;

    const r = this.runners[2];
    switch (h) {
      case AtBatOutcome.Single:
        this.runners[3] = { ...r };
        this.runners[2] = emptyRunner();
        this.thirdBase = true;
        this.secondBase = false;
        plays.push(`${r.lastName} advances to 3rd on the single`);
        break;
      case AtBatOutcome.Walk:
        if (this.firstBase) {
          this.runners[3] = { ...r };
          this.runners[2] = emptyRunner();
          this.thirdBase = true;
          this.secondBase = false;
          plays.push(`${r.lastName} advances to 3rd on the walk`);
        }
        break;
      case AtBatOutcome.Double:
      case AtBatOutcome.Triple:
      case AtBatOutcome.HomeRun:
        plays.push(`${r.lastName} scores from 2nd on the ${AtBatOutcome[h].toLowerCase()}`);
        this.runners[5] = { ...r, runs: 1 };
        this.runners[2] = emptyRunner();
        this.secondBase = false;
        this.thirdBase = false;
        this.plateApp.rbi++;
        break;
      case AtBatOutcome.Strikeout:
        if (this.outsRef >= 2) {
          this.runners[2] = emptyRunner();
          this.secondBase = false;
        }
        break;
      case AtBatOutcome.GroundOut:
        if (this.outsRef < 2) {
          this.runners[3] = { ...r };
          this.runners[2] = emptyRunner();
          this.thirdBase = true;
          this.secondBase = false;
          plays.push(`${r.lastName} advances to 3rd on the ground ball`);
        } else {
          this.runners[2] = emptyRunner();
          this.secondBase = false;
        }
        break;
    }
    return plays;
  }

  // ─── First Base ───────────────────────────────────────────────
  private processFirstBase(h: AtBatOutcome): string[] {
    const plays: string[] = [];
    if (!this.firstBase) return plays;

    const r = this.runners[1];
    switch (h) {
      case AtBatOutcome.Single:
      case AtBatOutcome.Walk:
        this.runners[2] = { ...r };
        this.runners[1] = emptyRunner();
        this.secondBase = true;
        this.firstBase = false;
        plays.push(`${r.lastName} advances to 2nd on the ${h === AtBatOutcome.Single ? 'single' : 'walk'}`);
        break;
      case AtBatOutcome.Double:
        this.runners[3] = { ...r };
        this.runners[1] = emptyRunner();
        this.thirdBase = true;
        this.firstBase = false;
        plays.push(`${r.lastName} goes 1st to 3rd on the double`);
        break;
      case AtBatOutcome.Triple:
      case AtBatOutcome.HomeRun:
        plays.push(`${r.lastName} scores from 1st on the ${AtBatOutcome[h].toLowerCase()}`);
        this.runners[4] = { ...r, runs: 1 };
        this.runners[1] = emptyRunner();
        this.thirdBase = false;
        this.secondBase = false;
        this.firstBase = false;
        this.plateApp.rbi++;
        break;
      case AtBatOutcome.Strikeout:
        if (this.outsRef >= 2) {
          this.runners[1] = emptyRunner();
          this.firstBase = false;
        }
        break;
      case AtBatOutcome.GroundOut:
        if (this.outsRef < 2) {
          this.runners[2] = { ...r };
          this.runners[1] = emptyRunner();
          this.secondBase = true;
          this.firstBase = false;
          plays.push(`${r.lastName} advances to 2nd on the ground ball`);
        } else {
          this.runners[1] = emptyRunner();
          this.firstBase = false;
        }
        break;
    }
    return plays;
  }

  // ─── Batter ───────────────────────────────────────────────────
  private processBatter(h: AtBatOutcome): string[] {
    const plays: string[] = [];
    const batter = this.runners[0];

    switch (h) {
      case AtBatOutcome.Single:
      case AtBatOutcome.Walk:
        this.runners[1] = { ...batter };
        this.firstBase = true;
        plays.push(h === AtBatOutcome.Single
          ? `${batter.lastName} singles`
          : `${batter.lastName} draws a walk`);
        break;
      case AtBatOutcome.Double:
        this.runners[2] = { ...batter };
        this.secondBase = true;
        this.firstBase = false;
        plays.push(`${batter.lastName} doubles`);
        break;
      case AtBatOutcome.Triple:
        this.runners[3] = { ...batter };
        this.thirdBase = true;
        this.secondBase = false;
        this.firstBase = false;
        plays.push(`${batter.lastName} triples`);
        break;
      case AtBatOutcome.HomeRun:
        this.plateApp.rbi++;
        this.thirdBase = false;
        this.secondBase = false;
        this.firstBase = false;
        plays.push(`${batter.lastName} crushes a home run!`);
        break;
      case AtBatOutcome.Strikeout:
        if (this.outsRef >= 2) {
          this.thirdBase = false;
          this.secondBase = false;
          this.firstBase = false;
          plays.push(`${batter.lastName} strikes out to end the inning`);
        } else {
          plays.push(`${batter.lastName} strikes out`);
        }
        break;
      case AtBatOutcome.GroundOut:
        if (this.outsRef >= 2) {
          this.thirdBase = false;
          this.secondBase = false;
          this.firstBase = false;
          plays.push(`${batter.lastName} grounds out to end the inning`);
        } else {
          plays.push(`${batter.lastName} grounds out`);
        }
        break;
    }

    this.runners[0] = emptyRunner();
    return plays;
  }
}
