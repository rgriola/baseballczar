/**
 * Scene — owns Pixi sprites for ball, fielders, and runners and responds
 * to SimEvents by starting tweens. The scene tracks "active tweens" and
 * advances them every frame.
 *
 * Engine-native units (feet) are used everywhere; transform applied at
 * draw time so the scene stays resolution-independent.
 */
import { Container, Graphics, Text } from 'pixi.js';
import {
  type FieldTransform,
  ftToPx,
  ftToPxXY,
  arcLiftPx,
  arcHeightFt,
  grounderBouncePx,
  grounderBounceHeightFt,
  pitchLiftPx,
  pitchHeightFt,
  lerpFt,
} from './coords';
import { dugoutSpotFt } from './field/drawField';
import {
  BASE_COORDS_FT,
  FIELDER_POSITIONS_FT,
  sprintFtPerSec,
  type Position,
  type SimEvent,
} from '@baseballczar/sim-engine';

const TEAM_HOME = 0x4aa3ff;

// Order in which fielders jog out of the dugout for the pre-game intro.
// Pitcher leads (he needs to be on the mound first to throw warmups),
// then catcher, then infielders close to far, then outfielders.
const POSITION_ORDER: Position[] = [
  'P', 'C', 'B1', 'B2', 'B3', 'SS', 'LF', 'CF', 'RF',
];
const TEAM_AWAY = 0xff6b6b;
const BALL_COLOR = 0xfafafa;
const TRAIL_COLOR = 0xfff8d4;

interface MovingSprite {
  gfx: Container;
  /** Current position in engine feet. */
  cur: { x: number; y: number };
  /** Tween start. */
  from: { x: number; y: number };
  /** Tween end. */
  to: { x: number; y: number };
  /** Engine-time tween started. */
  startT: number;
  /** Tween duration (engine seconds). */
  durSec: number;
  /** 'line' = no arc, 'fly' = parabolic lift, 'grounder' = small bounces, 'pitch' = release→plate ramp. */
  arc: 'line' | 'fly' | 'grounder' | 'pitch';
  /** Apex altitude in feet (for fly arcs only). */
  apexFt: number;
}

export interface SceneAPI {
  root: Container;
  applyEvent: (e: SimEvent) => void;
  /** Called from rAF — update visual positions for current engine clock. */
  tick: (clockSec: number) => void;
  /** Reset to game-start visual state. */
  reset: () => void;
}

export function createScene(transform: FieldTransform): SceneAPI {
  const root = new Container();
  // Shadow layer sits BELOW everything so player/ball shadows don't
  // occlude their owners. Player shadows are kept as children of each
  // sprite so they move automatically; the ball's shadow is on this
  // layer so it can decouple from the lifted ball sprite.
  const layerShadows = new Container();
  const layerFielders = new Container();
  const layerRunners = new Container();
  const layerBall = new Container();
  const layerHud = new Container();
  root.addChild(layerShadows, layerFielders, layerRunners, layerBall, layerHud);

  // ─── Build fielder sprites at their home positions ───
  // Players are sized in feet (2 ft wide = 1 ft radius) so they scale
  // with the camera. The min-pixel floor keeps them visible when zoomed out.
  const PLAYER_RADIUS_FT = 1;
  const PLAYER_RADIUS_PX_MIN = 4;
  const playerRadiusPx = Math.max(PLAYER_RADIUS_PX_MIN, PLAYER_RADIUS_FT * transform.scale);
  const fielders = new Map<Position, MovingSprite>();
  const fielderBodies = new Map<Position, Graphics>();
  for (const [pos, ft] of Object.entries(FIELDER_POSITIONS_FT) as [Position, { x: number; y: number }][]) {
    const { c: gfx, body } = makeFielderSprite(pos, playerRadiusPx);
    const px = ftToPx(ft, transform);
    gfx.position.set(px.x, px.y);
    layerFielders.addChild(gfx);
    fielderBodies.set(pos, body);
    fielders.set(pos, {
      gfx,
      cur: { ...ft },
      from: { ...ft },
      to: { ...ft },
      startT: 0,
      durSec: 0,
      arc: 'line',
      apexFt: 0,
    });
  }

  // ─── Ball sprite (initially at pitcher's mound) ───
  // No stroke (cleaner look at small sizes). Sized to read as a baseball
  // alongside the player sprites; min-pixel floor keeps it visible at
  // low world zoom.
  const BALL_RADIUS_PX = 2.25;
  const ballGfx = new Graphics()
    .circle(0, 0, BALL_RADIUS_PX).fill(BALL_COLOR);
  const ballStartPx = ftToPx(FIELDER_POSITIONS_FT.P, transform);
  ballGfx.position.set(ballStartPx.x, ballStartPx.y);
  layerBall.addChild(ballGfx);

  // Ball shadow lives on the shadow layer (not parented to the ball) so
  // the lifted ball can rise off it. Updated per-frame in tick() based
  // on the ball's current ground projection + current altitude.
  // Drawn larger than the ball so a hit ball reads as casting a real
  // shadow on the grass; per-frame logic grows + softens it with altitude.
  const ballShadow = new Graphics()
    .ellipse(0, 0, BALL_RADIUS_PX * 2.4, BALL_RADIUS_PX * 1.1)
    .fill({ color: 0x000000, alpha: 0.55 });
  ballShadow.position.set(ballStartPx.x, ballStartPx.y + BALL_RADIUS_PX * 0.4);
  layerShadows.addChild(ballShadow);

  let ball: MovingSprite = {
    gfx: ballGfx,
    cur: { ...FIELDER_POSITIONS_FT.P },
    from: { ...FIELDER_POSITIONS_FT.P },
    to: { ...FIELDER_POSITIONS_FT.P },
    startT: 0, durSec: 0, arc: 'line', apexFt: 0,
  };

  // ─── Runners (created on demand, keyed by runnerId) ───
  interface RunnerSprite extends MovingSprite {
    teamColor: number;
    /** Sprint speed (skill 1–10). Drives walk/jog cadence in the renderer. */
    speed: number;
  }
  const runners = new Map<number, RunnerSprite>();
  const battingTeamIdRef: { home: number | null; away: number | null } = { home: null, away: null };
  let homeTeamId = -1;

  // Track which side is currently batting so a fresh batter sprite gets the right color.
  let currentBatterId: number | null = null;
  let currentBattingTeamId: number | null = null;

  // ─── HUD: scoreboard text ───
  const scoreText = new Text({
    text: '',
    style: { fill: 0xffffff, fontSize: 13, fontFamily: 'system-ui', fontWeight: '600' },
  });
  scoreText.position.set(10, 8);
  layerHud.addChild(scoreText);

  const inningText = new Text({
    text: '',
    style: { fill: 0xc8d4d8, fontSize: 11, fontFamily: 'system-ui' },
  });
  inningText.position.set(10, 26);
  layerHud.addChild(inningText);

  let scoreHome = 0, scoreAway = 0;
  let inning = 1;
  let half: 'top' | 'bottom' = 'top';
  let outs = 0;

  // Pre-game intro state. The home team takes the field at the start
  // of T1, and the leadoff batter walks out from the away dugout to
  // the box. Both run only once per game.
  let firstInningOpened = false;
  let firstBatterShown = false;

  const updateHud = () => {
    scoreText.text = `${scoreAway}–${scoreHome}`;
    const halfArrow = half === 'top' ? '▲' : '▼';
    inningText.text = `${halfArrow} ${inning}   ${outs} out${outs === 1 ? '' : 's'}`;
  };
  updateHud();

  // ─── Tween starters ───
  const startTween = (
    sprite: MovingSprite,
    to: { x: number; y: number },
    durSec: number,
    clockSec: number,
    arc: 'line' | 'fly' | 'grounder' | 'pitch' = 'line',
    apexFt = 0,
  ) => {
    sprite.from = { ...sprite.cur };
    sprite.to = { ...to };
    sprite.startT = clockSec;
    sprite.durSec = Math.max(0.05, durSec);
    sprite.arc = arc;
    sprite.apexFt = apexFt;
  };

  /**
   * Get-or-create a runner sprite, placed initially at the given base.
   */
  const ensureRunner = (
    runnerId: number,
    initBase: 'home' | 'first' | 'second' | 'third',
    teamColor: number,
  ): RunnerSprite => {
    let r = runners.get(runnerId);
    if (r) return r;
    const ft = initBase === 'home' ? { x: 0, y: 0 } : BASE_COORDS_FT[initBase];
    const gfx = makeRunnerSprite(teamColor, playerRadiusPx);
    const px = ftToPx(ft, transform);
    gfx.position.set(px.x, px.y);
    layerRunners.addChild(gfx);
    r = {
      gfx, teamColor,
      speed: 5,
      cur: { ...ft }, from: { ...ft }, to: { ...ft },
      startT: 0, durSec: 0, arc: 'line', apexFt: 0,
    };
    runners.set(runnerId, r);
    return r;
  };

  /**
   * Place the batter as a runner sprite in the correct batter's box based on
   * their hand ('L'|'R'|'S'). Engine coords: +x toward 1B, +y toward CF.
   * RH batter stands on the 3B side (negative x); LH on the 1B side (+x).
   * Switch hitter bats opposite the pitcher's throwing hand (vs LHP → RHB,
   * vs RHP → LHB), per standard baseball platoon convention.
   *
   * Box geometry (must stay in sync with FIELD_SPEC in drawField.ts):
   *   plateHalfWidthFt = 0.708, batterBoxOffsetFt = 0.5, batterBoxWidthFt = 4
   *   → box-center x = ±(0.708 + 0.5 + 4/2) = ±3.208 ft
   */
  const ensureBatter = (
    batterId: number,
    hand: 'L' | 'R' | 'S',
    pitcherHand: 'L' | 'R',
    teamColor: number,
    speedSkill: number,
    walkOutAtT?: number,
  ) => {
    if (runners.has(batterId)) return; // already on base from prev AB? unlikely
    const xMag = 3.208;
    // Switch hitter: bat opposite the pitcher's throwing hand.
    const effectiveHand: 'L' | 'R' = hand === 'S'
      ? (pitcherHand === 'R' ? 'L' : 'R')
      : hand;
    const standsRight = effectiveHand === 'R';
    const ft = { x: standsRight ? -xMag : xMag, y: 0 };
    const gfx = makeRunnerSprite(teamColor, playerRadiusPx);
    // For the pre-game leadoff, start the batter in the away dugout
    // (3B side) and walk them to the box. Subsequent batters just
    // appear in the box (they're already "on deck").
    const startFt = walkOutAtT != null
      ? dugoutSpotFt(false, standsRight ? -8 : 8, 5)
      : ft;
    const px = ftToPx(startFt, transform);
    gfx.position.set(px.x, px.y);
    layerRunners.addChild(gfx);
    const sprite: RunnerSprite = {
      gfx, teamColor,
      speed: speedSkill,
      cur: { ...startFt }, from: { ...startFt }, to: { ...startFt },
      startT: 0, durSec: 0, arc: 'line', apexFt: 0,
    };
    runners.set(batterId, sprite);
    if (walkOutAtT != null) {
      // Walk pace = ~50% of sprint speed, so a slow slugger ambles in
      // around 11 ft/s and a burner trots at 14 ft/s.
      const walkFps = sprintFtPerSec(speedSkill) * 0.50;
      const distFt = Math.hypot(ft.x - startFt.x, ft.y - startFt.y);
      const walkSec = Math.max(1.5, distFt / walkFps);
      startTween(sprite, ft, walkSec, walkOutAtT, 'line');
    }
  };

  const removeRunner = (runnerId: number) => {
    const r = runners.get(runnerId);
    if (!r) return;
    layerRunners.removeChild(r.gfx);
    r.gfx.destroy();
    runners.delete(runnerId);
  };

  /**
   * Animate a runner walking back to their team's dugout, then remove the
   * sprite once they've cleared the field. Home team uses the 1B-side
   * dugout, away uses the 3B-side. Inferred from the sprite's team color.
   */
  const sendToDugout = (runnerId: number, atClockSec: number) => {
    const r = runners.get(runnerId);
    if (!r) return;
    const homeSide = r.teamColor === TEAM_HOME;
    const alongOffset = ((runnerId * 37) % 41) - 20; // -20..+20 ft along bench
    const dest = dugoutSpotFt(homeSide, alongOffset, 5);
    // Hustle pace off the field: ~80% of sprint (jogging, not sprinting).
    const jogFps = sprintFtPerSec(r.speed) * 0.80;
    const distFt = Math.hypot(dest.x - r.cur.x, dest.y - r.cur.y);
    const walkSec = Math.max(0.6, distFt / jogFps);
    startTween(r, dest, walkSec, atClockSec, 'line');
    // Once they arrive, fade + shrink so they read as INSIDE the dugout
    // (sitting on the bench / in shadow) rather than perched on the rim.
    setTimeout(() => {
      if (!runners.has(runnerId)) return;
      if (r.gfx.destroyed) return;
      r.gfx.alpha = 0.55;
      r.gfx.scale.set(0.7);
    }, Math.ceil(walkSec * 1000) + 50);
    // Keep them visible in the dugout for a few seconds, then despawn so
    // the bench doesn't accumulate forever.
    setTimeout(() => removeRunner(runnerId), Math.ceil(walkSec * 1000) + 4000);
  };

  // ─── Per-frame tween advancer ───
  /**
   * Compute current parabolic altitude (in feet) for a tween. Returns 0
   * for non-fly arcs or when the tween isn't running.
   */
  const altitudeFt = (sprite: MovingSprite, clockSec: number): number => {
    if (sprite.durSec <= 0) return 0;
    const u = Math.min(1, Math.max(0, (clockSec - sprite.startT) / sprite.durSec));
    if (sprite.arc === 'fly') return arcHeightFt(u, sprite.apexFt);
    if (sprite.arc === 'grounder') return grounderBounceHeightFt(u);
    if (sprite.arc === 'pitch') return pitchHeightFt(u);
    return 0;
  };

  const advance = (sprite: MovingSprite, clockSec: number) => {
    if (sprite.durSec <= 0) return;
    const u = Math.min(1, Math.max(0, (clockSec - sprite.startT) / sprite.durSec));
    sprite.cur = lerpFt(sprite.from, sprite.to, u);
    const px = ftToPx(sprite.cur, transform);
    let yOffset = 0;
    if (sprite.arc === 'fly') yOffset = arcLiftPx(u, sprite.apexFt, transform);
    else if (sprite.arc === 'grounder') yOffset = grounderBouncePx(u, transform);
    else if (sprite.arc === 'pitch') yOffset = pitchLiftPx(u, transform);
    sprite.gfx.position.set(px.x, px.y - yOffset);
    if (u >= 1) sprite.durSec = 0;
  };

  /**
   * Update the ball's shadow + 3D-ish scaling based on its current
   * altitude. Shadow stays on the ground (no lift). For a hit ball the
   * shadow GROWS and softens as the ball climbs (top-down-ish camera),
   * which sells the height of fly balls. Ball itself scales up so it
   * reads as "closer to the camera" when high in the air.
   */
  const updateBallShadow = (clockSec: number) => {
    const groundPx = ftToPx(ball.cur, transform);
    const h = altitudeFt(ball, clockSec);
    // Scale: ball appears ~1.6x larger at apex of a 60-ft fly (cap at 2.2x).
    const ballScale = Math.min(2.2, 1 + h / 80);
    ballGfx.scale.set(ballScale);
    // Shadow: grows with altitude (cap ~2.0x at 60 ft) and softens as the
    // ball climbs so it stays readable as a shadow rather than a blob.
    const shadowScale = Math.min(2.0, 1 + h / 60);
    const shadowAlpha = Math.max(0.18, 0.6 - h / 150);
    ballShadow.scale.set(shadowScale);
    ballShadow.alpha = shadowAlpha;
    // Shadow sits just under the ball on ground (camera is slightly tilted).
    ballShadow.position.set(groundPx.x, groundPx.y + BALL_RADIUS_PX * 0.4);
  };

  const tick = (clockSec: number) => {
    advance(ball, clockSec);
    for (const f of fielders.values()) advance(f, clockSec);
    for (const r of runners.values()) advance(r, clockSec);
    updateBallShadow(clockSec);
  };

  // ─── Event handlers ───
  let lastClockSec = 0;
  const applyEvent = (e: SimEvent) => {
    lastClockSec = e.t;
    switch (e.type) {
      case 'game-start': {
        homeTeamId = e.homeTeamId;
        // Stage the home team in their dugout (1B side) so the first
        // inning-start can animate them jogging out to their positions.
        // We tween 0.01s to instantly place them there without snapping
        // through the field; the actual jog-out happens at inning-start.
        for (const [pos, sp] of fielders) {
          // Stagger fielders along the dugout so they don't stack on
          // top of each other before they break.
          const seed = (POSITION_ORDER.indexOf(pos) + 1) * 6 - 21; // -15..+27 ft
          const dugoutPt = dugoutSpotFt(true, seed, 4);
          sp.cur = { ...dugoutPt };
          sp.from = { ...dugoutPt };
          sp.to = { ...dugoutPt };
          sp.durSec = 0;
          const px = ftToPx(dugoutPt, transform);
          sp.gfx.position.set(px.x, px.y);
        }
        break;
      }
      case 'inning-start': {
        inning = e.inning;
        half = e.half;
        outs = 0;
        currentBattingTeamId = e.battingTeamId;
        // Color fielders by defense team so HOME stays one color and AWAY
        // the other, regardless of who's batting.
        const defenseColor = currentBattingTeamId === homeTeamId ? TEAM_AWAY : TEAM_HOME;
        for (const body of fielderBodies.values()) {
          body.clear()
            .circle(0, 0, playerRadiusPx).fill(defenseColor)
            .stroke({ color: 0x111111, width: 0.5 });
        }
        // Index this inning's defense by position so we can drive jog
        // duration by each fielder's speed skill.
        const speedByPos = new Map<Position, number>();
        for (const d of e.defense) speedByPos.set(d.position, d.speed);
        // First inning of the game: jog the home team out of the dugout
        // to their positions in a staggered pre-pitch intro. Subsequent
        // innings just snap them back into place. Jog speed = ~70% of
        // each fielder's sprint speed (skills.speed 1–10 → 22–28 ft/s),
        // so a fast CF outpaces a slow 1B naturally without a fixed
        // cascade. Reach time is distance / jog speed.
        const introMode = !firstInningOpened;
        firstInningOpened = true;
        for (const [pos, sp] of fielders) {
          const home = FIELDER_POSITIONS_FT[pos];
          if (introMode) {
            const speed = speedByPos.get(pos) ?? 5;
            const jogFps = sprintFtPerSec(speed) * 0.70;
            const dist = Math.hypot(home.x - sp.cur.x, home.y - sp.cur.y);
            const dur = Math.max(2.0, dist / jogFps);
            startTween(sp, home, dur, e.t, 'line');
          } else {
            startTween(sp, home, 0.5, e.t, 'line');
          }
        }
        updateHud();
        break;
      }
      case 'at-bat-start': {
        currentBatterId = e.batter.id;
        // Materialize any runners on base who don't have sprites yet, and
        // snap any existing runner sprite to the base the engine says
        // they're on (defends against any prior accounting drift).
        const offenseColor = currentBattingTeamId === homeTeamId ? TEAM_HOME : TEAM_AWAY;
        const baseNames: ('first' | 'second' | 'third')[] = ['first', 'second', 'third'];
        e.runners.forEach((rid, i) => {
          if (rid == null) return;
          const baseFt = BASE_COORDS_FT[baseNames[i]];
          const existing = runners.get(rid);
          if (existing) {
            // Cancel any in-flight tween and place at the correct base.
            existing.cur = { ...baseFt };
            existing.from = { ...baseFt };
            existing.to = { ...baseFt };
            existing.durSec = 0;
            const px = ftToPx(baseFt, transform);
            existing.gfx.position.set(px.x, px.y);
          } else {
            ensureRunner(rid, baseNames[i], offenseColor);
          }
        });
        // Place the batter in the appropriate batter's box. Registered as a
        // runner under batter.id so a subsequent 'runner-advance' from 'home'
        // animates them out of the box toward first base.
        // First batter of the game walks out from the away dugout for
        // the intro; everyone after that just appears in the box.
        const walkOutAt = !firstBatterShown ? e.t : undefined;
        firstBatterShown = true;
        ensureBatter(e.batter.id, e.batter.hand, e.pitcher.hand, offenseColor, e.batter.speed, walkOutAt);
        break;
      }
      case 'pitch': {
        // Animate ball P → C with a release-point arc: ball starts ~6 ft
        // above the mound and arrives ~2.5 ft above the plate, so its
        // shadow trails behind it on the way in.
        const from = FIELDER_POSITIONS_FT.P;
        const to = FIELDER_POSITIONS_FT.C;
        ball.cur = { ...from };
        startTween(ball, to, e.flightSec, e.t, 'pitch');
        break;
      }
      case 'contact': {
        // Ball flight from home plate to landing point
        ball.cur = { x: 0, y: 0 };
        const apex = e.launchAngleDeg > 25 ? Math.max(20, e.distanceFt * 0.18) : 0;
        const arc = e.launchAngleDeg > 15 ? 'fly' : 'grounder';
        startTween(ball, e.landingPoint, e.hangTimeSec || 1.2, e.t, arc, apex);
        break;
      }
      case 'fielder-converge': {
        const sp = fielders.get(e.position);
        if (sp) startTween(sp, e.toPoint, e.reachSec, e.t, 'line');
        break;
      }
      case 'cover-base': {
        // Cover fielder breaks for the bag while the throw is in the air.
        const sp = fielders.get(e.position);
        if (sp) startTween(sp, e.toPoint, e.arriveSec, e.t, 'line');
        break;
      }
      case 'throw': {
        // Move ball from fielder to base. Give it a small hump so the
        // shadow visibly separates from the ball — sells the 3D feel
        // even on routine infield throws.
        ball.cur = { ...e.fromPoint };
        const dist = Math.hypot(e.toPoint.x - e.fromPoint.x, e.toPoint.y - e.fromPoint.y);
        const apex = Math.max(4, Math.min(14, dist * 0.07));
        startTween(ball, e.toPoint, e.flightSec, e.t, 'fly', apex);
        break;
      }
      case 'ball-return': {
        // Ball travels back to the pitcher. Slow lobs (catcher / umpire)
        // get a higher apex; fielder relays from across the field use a
        // flatter arc.
        ball.cur = { ...e.fromPoint };
        const dist = Math.hypot(e.toPoint.x - e.fromPoint.x, e.toPoint.y - e.fromPoint.y);
        const apexBoost = e.source === 'fielder' ? 0.07 : 0.12;
        const apex = Math.max(5, Math.min(18, dist * apexBoost));
        startTween(ball, e.toPoint, e.flightSec, e.t, 'fly', apex);
        break;
      }
      case 'runner-advance': {
        const sp = runners.get(e.runnerId);
        if (!sp) break;
        const toFt = e.toBase === 'home' ? { x: 0, y: 0 } : BASE_COORDS_FT[e.toBase];
        startTween(sp, toFt, e.travelSec, e.t, 'line');
        break;
      }
      case 'out': {
        outs = e.outNum;
        if (e.runnerId != null) {
          // Walk the out runner off to their dugout, then remove.
          sendToDugout(e.runnerId, e.t);
        } else if (currentBatterId != null) {
          // Strikeout / non-runner out (e.g. foul-out) — the batter sprite
          // was registered under batter.id at at-bat-start; walk them off too.
          sendToDugout(currentBatterId, e.t);
        }
        updateHud();
        break;
      }
      case 'run-scored': {
        scoreHome = e.scoreHome;
        scoreAway = e.scoreAway;
        // Runner who scored heads to their dugout instead of just disappearing.
        sendToDugout(e.runnerId, e.t);
        updateHud();
        break;
      }
      case 'at-bat-end': {
        currentBatterId = null;
        // The engine now emits a `ball-return` before at-bat-end so the
        // ball animates all the way back to the pitcher. Only snap if it
        // didn't make it (e.g. older saved games without ball-return
        // events) — detected by ball still being well off the mound.
        const moundPx = ftToPx(FIELDER_POSITIONS_FT.P, transform);
        const curPx = ftToPx(ball.cur, transform);
        const offMound = Math.hypot(curPx.x - moundPx.x, curPx.y - moundPx.y);
        if (offMound > 30) {
          ball.cur = { ...FIELDER_POSITIONS_FT.P };
          ball.from = { ...FIELDER_POSITIONS_FT.P };
          ball.to = { ...FIELDER_POSITIONS_FT.P };
          ball.durSec = 0;
          ball.gfx.position.set(moundPx.x, moundPx.y);
        }
        // Reset every fielder to their home position. (Previously we only
        // reset fielders that had wandered > 6 ft, which left fielders who
        // had moved a small amount stuck off-position for the next at-bat.)
        for (const [pos, sp] of fielders) {
          const home = FIELDER_POSITIONS_FT[pos];
          const dist = Math.hypot(sp.cur.x - home.x, sp.cur.y - home.y);
          if (dist > 0.5) {
            startTween(sp, home, 1.2, e.t, 'line');
          }
        }
        break;
      }
      case 'inning-end': {
        scoreHome = e.scoreHome;
        scoreAway = e.scoreAway;
        // Clear all runners between innings
        for (const id of [...runners.keys()]) removeRunner(id);
        outs = 0;
        updateHud();
        break;
      }
      case 'game-end': {
        scoreHome = e.scoreHome;
        scoreAway = e.scoreAway;
        updateHud();
        break;
      }
      // 'fielder-converge' covered; nothing else needs to do anything visual
      default:
        break;
    }
    void battingTeamIdRef;
    void lastClockSec;
  };

  const reset = () => {
    // Clear all runners
    for (const id of [...runners.keys()]) removeRunner(id);
    // Snap fielders home
    for (const [pos, sp] of fielders) {
      const home = FIELDER_POSITIONS_FT[pos];
      sp.cur = { ...home };
      sp.from = { ...home };
      sp.to = { ...home };
      sp.durSec = 0;
      const px = ftToPx(home, transform);
      sp.gfx.position.set(px.x, px.y);
    }
    // Snap ball to pitcher
    ball.cur = { ...FIELDER_POSITIONS_FT.P };
    ball.durSec = 0;
    const ballPx = ftToPx(FIELDER_POSITIONS_FT.P, transform);
    ball.gfx.position.set(ballPx.x, ballPx.y);
    // Reset HUD
    scoreHome = 0; scoreAway = 0; inning = 1; half = 'top'; outs = 0;
    updateHud();
  };

  void TRAIL_COLOR;
  void ftToPxXY;

  return { root, applyEvent, tick, reset };
}

// ─── Sprite factories ───

function makeFielderSprite(pos: Position, radiusPx: number): { c: Container; body: Graphics } {
  const c = new Container();
  // Shadow first so it draws beneath the body. Slightly offset down to
  // suggest a sun overhead and to read as feet planted on the dirt.
  const shadow = new Graphics()
    .ellipse(0, radiusPx * 0.55, radiusPx * 1.05, radiusPx * 0.45)
    .fill({ color: 0x000000, alpha: 0.32 });
  c.addChild(shadow);
  const body = new Graphics()
    .circle(0, 0, radiusPx).fill(0xffffff)
    .stroke({ color: 0x222222, width: 0.5 });
  c.addChild(body);
  // Only show the position label if the sprite is large enough to read it.
  if (radiusPx >= 6) {
    const lbl = new Text({
      text: pos,
      style: { fill: 0x222222, fontSize: Math.max(6, radiusPx * 1.1), fontFamily: 'system-ui', fontWeight: '700' },
    });
    lbl.anchor.set(0.5);
    lbl.position.set(0, 0);
    c.addChild(lbl);
  }
  return { c, body };
}

function makeRunnerSprite(color: number, radiusPx: number): Container {
  const c = new Container();
  const shadow = new Graphics()
    .ellipse(0, radiusPx * 0.55, radiusPx * 1.05, radiusPx * 0.45)
    .fill({ color: 0x000000, alpha: 0.32 });
  c.addChild(shadow);
  const body = new Graphics()
    .circle(0, 0, radiusPx).fill(color)
    .stroke({ color: 0x111111, width: 0.5 });
  c.addChild(body);
  return c;
}
