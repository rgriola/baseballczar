/**
 * Tick-engine baseline smoke tests.
 *
 * These tests verify the physics and skill-wiring invariants that
 * must remain stable across refactors. They do NOT test the renderer
 * (tickScene.ts) — only the pure simulation layer.
 *
 * Categories:
 *   1. Ball physics (flight, bounce, roll, throw)
 *   2. Fielder skills → entity properties
 *   3. Runner skills → entity properties
 *   4. Single at-bat simulation (smoke)
 *   5. Collision avoidance (rigid bodies)
 *
 * Run:  npx vitest run --config packages/tick-engine/vitest.config.ts
 */
import { describe, it, expect } from 'vitest';
import type { BallEntity, FielderEntity, RunnerEntity, Point2D } from '../src/entities';
import { launchBall, tickBall, throwBall } from '../src/ballPhysics';
import { simulateAtBatTick, type TickSimOptions } from '../src/tickEngine';
import type { AtBatRecord, Player, Position, BattedBall, Skills } from '@baseballczar/sim-engine';
import { FIELDER_POSITIONS_FT } from '@baseballczar/sim-engine';

// ─── Test helpers ────────────────────────────────────────────────

function makeBall(): BallEntity {
  return { pos: { x: 0, y: 0, z: 3 }, state: { type: 'idle' } };
}

function makeTestPlayer(overrides: Omit<Partial<Player>, 'skills'> & { skills?: Partial<Skills> } = {}): Player {
  return {
    id: overrides.id ?? 1,
    firstName: overrides.firstName ?? 'Test',
    lastName: overrides.lastName ?? 'Player',
    hand: overrides.hand ?? 'R',
    position: overrides.position ?? 'CF',
    skills: {
      speed: 6, ag: 5, stamina: 5, eye: 5, avg: 5,
      power: 5, dhr: 5, fielding: 5, throwing: 5,
      playIntelligence: 5, bunting: 5, karma: 5,
      ...overrides.skills,
    },
  };
}

function makeTestBattedBall(overrides: Partial<BattedBall> = {}): BattedBall {
  return {
    exitVeloMph: overrides.exitVeloMph ?? 95,
    launchAngleDeg: overrides.launchAngleDeg ?? 25,
    sprayAngleDeg: overrides.sprayAngleDeg ?? 0,
    distanceFt: overrides.distanceFt ?? 350,
    hangTimeSec: overrides.hangTimeSec ?? 4.5,
    peakHeightFt: overrides.peakHeightFt ?? 80,
    landingPoint: overrides.landingPoint ?? { x: 0, y: 350 },
    restPoint: overrides.restPoint ?? { x: 0, y: 360 },
    rollDistanceFt: overrides.rollDistanceFt ?? 10,
    landingSpeedFps: overrides.landingSpeedFps ?? 40,
    isFoul: overrides.isFoul ?? false,
    isHomeRun: overrides.isHomeRun ?? false,
  };
}

function makeTestAtBat(overrides: Partial<AtBatRecord> = {}): AtBatRecord {
  return {
    inning: 1,
    half: 'top',
    outs: 0,
    batter: makeTestPlayer({ id: 100, position: 'CF' }),
    pitcher: makeTestPlayer({ id: 200, position: 'P' }),
    pitches: [{ pitchNum: 1, balls: 0, strikes: 0, intentZone: 'in', actualInZone: true, swung: true, outcome: 'in-play' }],
    result: 'single',
    battedBall: makeTestBattedBall({
      exitVeloMph: 90,
      launchAngleDeg: 10,
      sprayAngleDeg: -15,
      distanceFt: 180,
      hangTimeSec: 1.2,
      peakHeightFt: 12,
      landingPoint: { x: -46, y: 174 },
      restPoint: { x: -48, y: 180 },
      rollDistanceFt: 6,
      landingSpeedFps: 35,
    }),
    fieldedBy: 'LF',
    rbis: 0,
    runsScored: 0,
    ...overrides,
  };
}

function makeDefenseRoster(): Map<Position, Player> {
  const positions: Position[] = ['P', 'C', 'B1', 'B2', 'SS', 'B3', 'LF', 'CF', 'RF'];
  const map = new Map<Position, Player>();
  positions.forEach((pos, i) => {
    map.set(pos, makeTestPlayer({ id: 10 + i, position: pos }));
  });
  return map;
}

// ─── 1. Ball Physics ─────────────────────────────────────────────

describe('Ball Physics', () => {
  it('launchBall sets in-flight state with correct velocity direction', () => {
    const ball = makeBall();
    launchBall(ball, 100, 25, 0);  // 100 mph, 25° up, dead center

    expect(ball.state.type).toBe('in-flight');
    if (ball.state.type !== 'in-flight') return;
    // Ball should fly toward CF (+y), upward (+z)
    expect(ball.state.vel.y).toBeGreaterThan(0);
    expect(ball.state.vel.z).toBeGreaterThan(0);
    // Dead center spray → minimal lateral movement
    expect(Math.abs(ball.state.vel.x)).toBeLessThan(5);
  });

  it('launchBall with pull spray sends ball toward correct field', () => {
    const ball = makeBall();
    // RHB pull = negative spray = toward LF
    launchBall(ball, 95, 20, -30);

    if (ball.state.type !== 'in-flight') return;
    // Negative spray → ball should go toward LF (negative x)
    expect(ball.state.vel.x).toBeLessThan(0);
    expect(ball.state.vel.y).toBeGreaterThan(0);
  });

  it('tickBall applies gravity — ball comes down', () => {
    const ball = makeBall();
    launchBall(ball, 95, 30, 0);

    let maxZ = 0;
    let landed = false;
    for (let i = 0; i < 600; i++) {  // 10 seconds at 60fps
      const result = tickBall(ball, 1 / 60);
      if (ball.pos.z > maxZ) maxZ = ball.pos.z;
      if (result.landed) { landed = true; break; }
    }

    expect(maxZ).toBeGreaterThan(10);  // ball went up
    expect(landed).toBe(true);          // ball came down
  });

  it('home run ball clears the wall', () => {
    const ball = makeBall();
    launchBall(ball, 110, 28, 0, {
      targetDistanceFt: 420,
      targetHangTimeSec: 5.0,
      targetPeakHeightFt: 100,
      minPeakHeightFt: 12,
    });

    let hitHR = false;
    for (let i = 0; i < 600; i++) {
      const result = tickBall(ball, 1 / 60);
      if (result.homeRun) { hitHR = true; break; }
    }

    expect(hitHR).toBe(true);
  });

  it('grounder rolls and decelerates to a stop', () => {
    const ball = makeBall();
    launchBall(ball, 70, -5, 10);  // chopper

    let wasRolling = false;
    let stopped = false;
    for (let i = 0; i < 600; i++) {
      const result = tickBall(ball, 1 / 60);
      if (ball.state.type === 'rolling') wasRolling = true;
      if (result.stopped) { stopped = true; break; }
    }

    expect(wasRolling).toBe(true);
    expect(stopped).toBe(true);
  });

  it('throwBall creates thrown state with correct target', () => {
    const ball = makeBall();
    const from: Point2D = { x: 200, y: 200 };
    const to: Point2D = { x: 0, y: 127 };  // second base

    throwBall(ball, from, to, 120, 'CF');

    expect(ball.state.type).toBe('thrown');
    if (ball.state.type !== 'thrown') return;
    expect(ball.state.target).toEqual(to);
    expect(ball.state.thrower).toBe('CF');
    // Ball should be heading toward second base (negative x, negative y from OF)
    expect(ball.state.vel.y).toBeLessThan(0);
  });

  it('dirt vs grass friction — ball rolls faster on dirt', () => {
    // Two balls rolling the same direction, same initial speed
    // Dirt ball starts at y=40 (infield), grass ball at y=250 (outfield)
    const dirtBall = makeBall();
    dirtBall.pos = { x: 0, y: 40, z: 0 };
    dirtBall.state = { type: 'rolling', vel: { x: 50, y: 0 } };

    const grassBall = makeBall();
    grassBall.pos = { x: 0, y: 250, z: 0 };
    grassBall.state = { type: 'rolling', vel: { x: 50, y: 0 } };

    // Tick both 30 times
    for (let i = 0; i < 30; i++) {
      tickBall(dirtBall, 1 / 60);
      tickBall(grassBall, 1 / 60);
    }

    // Both roll in the x direction. Dirt ball should have rolled farther
    // because dirt has lower deceleration (9 ft/s²) than grass (14 ft/s²)
    const dirtRollDist = dirtBall.pos.x - 0;
    const grassRollDist = grassBall.pos.x - 0;
    expect(dirtRollDist).toBeGreaterThan(grassRollDist);
  });
});

// ─── 2. Skills → Fielder Entity Properties ───────────────────────

describe('Skill Wiring — Fielders', () => {
  it('fast fielder has higher speedFps than slow fielder', () => {
    const roster = makeDefenseRoster();
    const fastPlayer = makeTestPlayer({ id: 50, position: 'CF', skills: { speed: 9 } as any });
    const slowPlayer = makeTestPlayer({ id: 51, position: 'LF', skills: { speed: 2 } as any });
    roster.set('CF', fastPlayer);
    roster.set('LF', slowPlayer);

    const ab = makeTestAtBat();
    const snaps = simulateAtBatTick(ab, roster, 0x1e5631);

    expect(snaps.length).toBeGreaterThan(0);
    const firstSnap = snaps[0];

    const cf = firstSnap.fielders.find(f => f.position === 'CF');
    const lf = firstSnap.fielders.find(f => f.position === 'LF');

    expect(cf).toBeDefined();
    expect(lf).toBeDefined();
    expect(cf!.speedFps).toBeGreaterThan(lf!.speedFps);
  });

  it('all 9 fielders appear in first snapshot', () => {
    const ab = makeTestAtBat();
    const snaps = simulateAtBatTick(ab, makeDefenseRoster(), 0x1e5631);

    expect(snaps.length).toBeGreaterThan(0);
    const fielders = snaps[0].fielders;
    expect(fielders.length).toBe(9);

    const positions = new Set(fielders.map(f => f.position));
    expect(positions.size).toBe(9);
    for (const pos of ['P', 'C', 'B1', 'B2', 'SS', 'B3', 'LF', 'CF', 'RF'] as Position[]) {
      expect(positions.has(pos)).toBe(true);
    }
  });

  it('fielders start at their home positions', () => {
    const ab = makeTestAtBat();
    const snaps = simulateAtBatTick(ab, makeDefenseRoster(), 0x1e5631);

    const fielders = snaps[0].fielders;
    for (const f of fielders) {
      const home = FIELDER_POSITIONS_FT[f.position as Position];
      // Should start within a few feet of home position
      const dist = Math.hypot(f.pos.x - home.x, f.pos.y - home.y);
      expect(dist).toBeLessThan(10);
    }
  });

  it('fielder throwVeloFps increases with fielding skill', () => {
    const roster = makeDefenseRoster();
    const strongArm = makeTestPlayer({ id: 60, position: 'RF', skills: { fielding: 9 } as any });
    const weakArm = makeTestPlayer({ id: 61, position: 'LF', skills: { fielding: 2 } as any });
    roster.set('RF', strongArm);
    roster.set('LF', weakArm);

    const ab = makeTestAtBat();
    const snaps = simulateAtBatTick(ab, roster, 0x1e5631);

    const rf = snaps[0].fielders.find(f => f.position === 'RF');
    const lf = snaps[0].fielders.find(f => f.position === 'LF');

    expect(rf!.throwVeloFps).toBeGreaterThan(lf!.throwVeloFps);
  });
});

// ─── 3. Skills → Runner Entity Properties ────────────────────────

describe('Skill Wiring — Runners', () => {
  it('batter becomes a runner on contact', () => {
    const ab = makeTestAtBat();
    const snaps = simulateAtBatTick(ab, makeDefenseRoster(), 0x1e5631);

    // At some point a runner with the batter's ID should appear
    const hasRunner = snaps.some(s =>
      s.runners.some(r => r.id === ab.batter.id)
    );
    expect(hasRunner).toBe(true);
  });

  it('fast batter-runner has higher speedFps', () => {
    const fastBatter = makeTestPlayer({ id: 100, skills: { speed: 9 } as any });
    const slowBatter = makeTestPlayer({ id: 101, skills: { speed: 2 } as any });

    const abFast = makeTestAtBat({ batter: fastBatter });
    const abSlow = makeTestAtBat({ batter: slowBatter });
    const roster = makeDefenseRoster();

    const snapsFast = simulateAtBatTick(abFast, roster, 0x1e5631);
    const snapsSlow = simulateAtBatTick(abSlow, roster, 0x1e5631);

    const fastRunner = snapsFast.flatMap(s => s.runners).find(r => r.id === fastBatter.id);
    const slowRunner = snapsSlow.flatMap(s => s.runners).find(r => r.id === slowBatter.id);

    expect(fastRunner).toBeDefined();
    expect(slowRunner).toBeDefined();
    expect(fastRunner!.speedFps).toBeGreaterThan(slowRunner!.speedFps);
  });
});

// ─── 4. At-Bat Simulation Smoke Tests ────────────────────────────

describe('At-Bat Simulation', () => {
  it('produces snapshots for a batted ball at-bat', () => {
    const ab = makeTestAtBat();
    const snaps = simulateAtBatTick(ab, makeDefenseRoster(), 0x1e5631);

    expect(snaps.length).toBeGreaterThan(5);
    // First snapshot should have time near 0
    expect(snaps[0].time).toBeLessThan(1);
    // Last snapshot should be within MAX_PLAY_SECS
    expect(snaps[snaps.length - 1].time).toBeLessThan(10);
  });

  it('returns empty snapshots for a walk (no battedBall)', () => {
    const ab = makeTestAtBat({
      result: 'walk',
      battedBall: undefined,
    });
    const snaps = simulateAtBatTick(ab, makeDefenseRoster(), 0x1e5631);

    expect(snaps.length).toBe(0);
  });

  it('emits a contact event on first pitch contact', () => {
    const ab = makeTestAtBat();
    const snaps = simulateAtBatTick(ab, makeDefenseRoster(), 0x1e5631);

    const contactEvents = snaps.flatMap(s => s.events).filter(e => e.type === 'contact');
    expect(contactEvents.length).toBe(1);

    const contact = contactEvents[0];
    if (contact.type !== 'contact') return;
    expect(contact.exitVeloMph).toBe(ab.battedBall!.exitVeloMph);
    expect(contact.launchAngleDeg).toBe(ab.battedBall!.launchAngleDeg);
    expect(contact.sprayAngleDeg).toBe(ab.battedBall!.sprayAngleDeg);
  });

  it('emits play-complete event', () => {
    const ab = makeTestAtBat();
    const snaps = simulateAtBatTick(ab, makeDefenseRoster(), 0x1e5631);

    const completeEvents = snaps.flatMap(s => s.events).filter(e => e.type === 'play-complete');
    expect(completeEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('home run produces wall-cleared event', () => {
    const ab = makeTestAtBat({
      result: 'home-run',
      battedBall: makeTestBattedBall({
        exitVeloMph: 110,
        launchAngleDeg: 28,
        sprayAngleDeg: 0,
        distanceFt: 420,
        hangTimeSec: 5.0,
        peakHeightFt: 100,
        isHomeRun: true,
      }),
    });
    const snaps = simulateAtBatTick(ab, makeDefenseRoster(), 0x1e5631);

    const wallEvents = snaps.flatMap(s => s.events).filter(e => e.type === 'wall-cleared');
    expect(wallEvents.length).toBe(1);
  });

  it('fly ball to CF produces snapshots and resolves the play', () => {
    const ab = makeTestAtBat({
      result: 'fly-out',
      battedBall: makeTestBattedBall({
        exitVeloMph: 85,
        launchAngleDeg: 35,
        sprayAngleDeg: 0,
        distanceFt: 250,
        hangTimeSec: 3.5,
        peakHeightFt: 55,
        landingPoint: { x: 0, y: 250 },
        restPoint: { x: 0, y: 255 },
        rollDistanceFt: 5,
        landingSpeedFps: 30,
      }),
    });
    const snaps = simulateAtBatTick(ab, makeDefenseRoster(), 0x1e5631);

    // Should produce meaningful snapshots
    expect(snaps.length).toBeGreaterThan(5);

    // Contact event should fire
    const allEvents = snaps.flatMap(s => s.events);
    expect(allEvents.some(e => e.type === 'contact')).toBe(true);

    // Should have at least contact + ball-landed or ball-caught
    expect(allEvents.length).toBeGreaterThan(1);
  });
});

// ─── 5. Entity Agility & Facing (package-only features) ──────────

describe('Entity Properties — Agility & Facing', () => {
  it('fielders have facingRad and agility properties', () => {
    const ab = makeTestAtBat();
    const snaps = simulateAtBatTick(ab, makeDefenseRoster(), 0x1e5631);

    const fielder = snaps[0].fielders[0];
    expect(typeof fielder.facingRad).toBe('number');
    expect(typeof fielder.agility).toBe('number');
    expect(typeof fielder.turnRateRad).toBe('number');
  });

  it('high AG player has faster turn rate', () => {
    const roster = makeDefenseRoster();
    const agilePlayer = makeTestPlayer({ id: 70, position: 'SS', skills: { ag: 9 } as any });
    const stiffPlayer = makeTestPlayer({ id: 71, position: 'B1', skills: { ag: 2 } as any });
    roster.set('SS', agilePlayer);
    roster.set('B1', stiffPlayer);

    const ab = makeTestAtBat();
    const snaps = simulateAtBatTick(ab, roster, 0x1e5631);

    const ss = snaps[0].fielders.find(f => f.position === 'SS');
    const b1 = snaps[0].fielders.find(f => f.position === 'B1');

    expect(ss!.turnRateRad).toBeGreaterThan(b1!.turnRateRad);
  });
});

// ─── 6. Invariants from DO_NOT_BREAK.md ──────────────────────────

describe('DO_NOT_BREAK Invariants', () => {
  it('ball always has a valid state type', () => {
    const ab = makeTestAtBat();
    const snaps = simulateAtBatTick(ab, makeDefenseRoster(), 0x1e5631);

    const validStates = ['idle', 'pitched', 'in-flight', 'rolling', 'held', 'thrown'];
    for (const snap of snaps) {
      expect(validStates).toContain(snap.ball.state.type);
    }
  });

  it('no fielder has NaN position', () => {
    const ab = makeTestAtBat();
    const snaps = simulateAtBatTick(ab, makeDefenseRoster(), 0x1e5631);

    for (const snap of snaps) {
      for (const f of snap.fielders) {
        expect(Number.isFinite(f.pos.x)).toBe(true);
        expect(Number.isFinite(f.pos.y)).toBe(true);
      }
    }
  });

  it('no runner has NaN position', () => {
    const ab = makeTestAtBat();
    const snaps = simulateAtBatTick(ab, makeDefenseRoster(), 0x1e5631);

    for (const snap of snaps) {
      for (const r of snap.runners) {
        expect(Number.isFinite(r.pos.x)).toBe(true);
        expect(Number.isFinite(r.pos.y)).toBe(true);
      }
    }
  });

  it('snapshot timestamps are monotonically increasing', () => {
    const ab = makeTestAtBat();
    const snaps = simulateAtBatTick(ab, makeDefenseRoster(), 0x1e5631);

    for (let i = 1; i < snaps.length; i++) {
      expect(snaps[i].time).toBeGreaterThanOrEqual(snaps[i - 1].time);
    }
  });

  it('ball z-coordinate never goes deeply negative', () => {
    const ab = makeTestAtBat();
    const snaps = simulateAtBatTick(ab, makeDefenseRoster(), 0x1e5631);

    for (const snap of snaps) {
      // Ball can briefly dip to 0 but should never be far below ground
      expect(snap.ball.pos.z).toBeGreaterThanOrEqual(-1);
    }
  });
});

// ─── 6. Statcast Collision Model (Phase 4) ───────────────────────

describe('Statcast Collision Model', () => {
  // Use the real sim-engine RNG for deterministic, non-degenerate tests
  async function getSimEngineRng() {
    const { createRng } = await import('@baseballczar/sim-engine/rng');
    return createRng;
  }

  it('rollBattedBall is importable from sim-engine', async () => {
    const mod = await import('@baseballczar/sim-engine');
    expect(mod.rollBattedBall).toBeDefined();
  });

  it('higher batter power produces higher exit velocity on average', async () => {
    const { rollBattedBall } = await import('@baseballczar/sim-engine');
    const createRng = await getSimEngineRng();
    const pitcher = makeTestPlayer({ id: 50, position: 'P', skills: { throwing: 5 } });

    const N = 50;
    let weakSum = 0;
    let strongSum = 0;

    for (let i = 0; i < N; i++) {
      const weakBatter = makeTestPlayer({ id: 1, skills: { power: 2, avg: 5, dhr: 5 } });
      const strongBatter = makeTestPlayer({ id: 2, skills: { power: 9, avg: 5, dhr: 5 } });

      const weakBall = rollBattedBall(weakBatter, pitcher, createRng(i));
      const strongBall = rollBattedBall(strongBatter, pitcher, createRng(i));

      weakSum += weakBall.exitVeloMph;
      strongSum += strongBall.exitVeloMph;
    }

    const weakAvg = weakSum / N;
    const strongAvg = strongSum / N;

    // Power 9 should average significantly higher EV than Power 2
    expect(strongAvg).toBeGreaterThan(weakAvg + 5);
    expect(weakAvg).toBeGreaterThan(50);
    expect(strongAvg).toBeLessThan(120);
  });

  it('pitcher throwing skill affects exit velocity (Statcast verified)', async () => {
    const { rollBattedBall } = await import('@baseballczar/sim-engine');
    const createRng = await getSimEngineRng();
    const batter = makeTestPlayer({ id: 1, skills: { power: 5, avg: 5, dhr: 5 } });

    const N = 50;
    let slowPitcherSum = 0;
    let fastPitcherSum = 0;

    for (let i = 0; i < N; i++) {
      const slowP = makeTestPlayer({ id: 50, position: 'P', skills: { throwing: 2 } });
      const fastP = makeTestPlayer({ id: 51, position: 'P', skills: { throwing: 9 } });

      const slowBall = rollBattedBall(batter, slowP, createRng(1000 + i));
      const fastBall = rollBattedBall(batter, fastP, createRng(1000 + i));

      slowPitcherSum += slowBall.exitVeloMph;
      fastPitcherSum += fastBall.exitVeloMph;
    }

    const slowAvg = slowPitcherSum / N;
    const fastAvg = fastPitcherSum / N;

    // Faster pitch → higher EV (q=0.2 × ΔV_pitch)
    expect(fastAvg).toBeGreaterThan(slowAvg);
    expect(fastAvg - slowAvg).toBeLessThan(8); // q=0.2 caps this effect
  });

  it('batter AVG vs pitcher AVG affects squared-up rate', async () => {
    const { rollBattedBall } = await import('@baseballczar/sim-engine');
    const createRng = await getSimEngineRng();
    const pitcher = makeTestPlayer({ id: 50, position: 'P', skills: { throwing: 5, avg: 5 } });

    const N = 50;
    let goodContactSum = 0;
    let poorContactSum = 0;

    for (let i = 0; i < N; i++) {
      const goodContact = makeTestPlayer({ id: 1, skills: { power: 5, avg: 9, dhr: 5 } });
      const poorContact = makeTestPlayer({ id: 2, skills: { power: 5, avg: 2, dhr: 5 } });

      const goodBall = rollBattedBall(goodContact, pitcher, createRng(i));
      const poorBall = rollBattedBall(poorContact, pitcher, createRng(i));

      goodContactSum += goodBall.exitVeloMph;
      poorContactSum += poorBall.exitVeloMph;
    }

    const goodAvg = goodContactSum / N;
    const poorAvg = poorContactSum / N;

    // Higher AVG should square up better → higher EV
    expect(goodAvg).toBeGreaterThan(poorAvg);
  });

  it('exit velocity stays within MLB-realistic bounds (50-120 mph)', async () => {
    const { rollBattedBall } = await import('@baseballczar/sim-engine');
    const createRng = await getSimEngineRng();

    const extremes = [
      { power: 1, throwing: 1, avg: 1, eye: 10 },
      { power: 10, throwing: 10, avg: 10, eye: 1 },
      { power: 5, throwing: 5, avg: 5, eye: 5 },
    ];

    for (const skills of extremes) {
      const batter = makeTestPlayer({ id: 1, skills: { power: skills.power, avg: skills.avg, dhr: 5 } });
      const pitcher = makeTestPlayer({ id: 50, position: 'P', skills: { throwing: skills.throwing, eye: skills.eye, avg: 5 } });

      for (let seed = 0; seed < 20; seed++) {
        const ball = rollBattedBall(batter, pitcher, createRng(seed));
        expect(ball.exitVeloMph).toBeGreaterThanOrEqual(50);
        expect(ball.exitVeloMph).toBeLessThanOrEqual(120);
      }
    }
  });

  it('DHR skill affects launch angle (low DHR = grounders, high DHR = fly balls)', async () => {
    const { rollBattedBall } = await import('@baseballczar/sim-engine');
    const createRng = await getSimEngineRng();
    const pitcher = makeTestPlayer({ id: 50, position: 'P' });

    const N = 50;
    let grounderSum = 0;
    let flyBallSum = 0;

    for (let i = 0; i < N; i++) {
      const grounder = makeTestPlayer({ id: 1, skills: { power: 5, avg: 5, dhr: 1 } });
      const flyBaller = makeTestPlayer({ id: 2, skills: { power: 5, avg: 5, dhr: 9 } });

      const gBall = rollBattedBall(grounder, pitcher, createRng(i));
      const fBall = rollBattedBall(flyBaller, pitcher, createRng(i));

      grounderSum += gBall.launchAngleDeg;
      flyBallSum += fBall.launchAngleDeg;
    }

    const grounderAvg = grounderSum / N;
    const flyBallAvg = flyBallSum / N;

    // DHR 9 should produce higher average launch angles than DHR 1
    expect(flyBallAvg).toBeGreaterThan(grounderAvg + 10);
  });
});
