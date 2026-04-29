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
} from './coords';
import {
  BASE_COORDS_FT,
  FIELDER_POSITIONS_FT,
  type Position,
  type SimEvent,
} from '@baseballczar/sim-engine';
import {
  type MovingSprite,
  type RunnerSprite,
  makeFielderSprite,
  makeRunnerSprite,
} from './scene/sprites';
import { altitudeFt, advance, startTween, updateHatFacing } from './scene/tween';
import { createRunnerManager } from './scene/runners';
import { stageHomeTeamInDugout, playFieldersToPositions } from './scene/intro';

const TEAM_HOME = 0x4aa3ff;
const TEAM_AWAY = 0xff6b6b;
const BALL_COLOR = 0xfafafa;

interface SceneAPI {
  root: Container;
  applyEvent: (e: SimEvent) => void;
  /** Called from rAF — update visual positions for current engine clock. */
  tick: (clockSec: number) => void;
  /** Reset to game-start visual state. */
  reset: () => void;
}

export type { SceneAPI };

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
    const { c: gfx, body, hat, hatOffsetPx } = makeFielderSprite(pos, playerRadiusPx);
    const px = ftToPx(ft, transform);
    gfx.position.set(px.x, px.y);
    layerFielders.addChild(gfx);
    fielderBodies.set(pos, body);
    const f: MovingSprite = {
      gfx, hat, hatOffsetPx,
      cur: { ...ft },
      from: { ...ft },
      to: { ...ft },
      startT: 0,
      durSec: 0,
      arc: 'line',
      apexFt: 0,
    };
    fielders.set(pos, f);
    // Frame-zero facing: every fielder looks toward home plate so the
    // very first render is correctly oriented (don't wait for a tick).
    updateHatFacing(f, transform, null);
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
  const runners = new Map<number, RunnerSprite>();
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

  const { ensureRunner, ensureBatter, removeRunner, sendToDugout } = createRunnerManager({
    runners, layerRunners, transform, playerRadiusPx, homeColor: TEAM_HOME,
  });

  // ─── Per-frame tween advancer ───

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
    advance(ball, clockSec, transform);
    for (const f of fielders.values()) advance(f, clockSec, transform);
    for (const r of runners.values()) advance(r, clockSec, transform);
    updateBallShadow(clockSec);
  };

  // ─── Event handlers ───
  const applyEvent = (e: SimEvent) => {
    switch (e.type) {
      case 'game-start': {
        homeTeamId = e.homeTeamId;
        // Stage the home team in their dugout (1B side) so the first
        // inning-start can animate them jogging out to their positions.
        stageHomeTeamInDugout(fielders, transform);
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
        // in a staggered pre-pitch intro. Subsequent innings just snap.
        const introMode = !firstInningOpened;
        firstInningOpened = true;
        playFieldersToPositions(fielders, e.t, { intro: introMode, speedByPos });
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
        // Ball flight from home plate to landing point.
        ball.cur = { x: 0, y: 0 };
        // Compute apex from kinematics so the visual loft matches the
        // launch angle + exit velocity. Vacuum apex = (v\u00b7sin\u03b8)\u00b2 / (2g),
        // then \u00d70.75 to roughly account for drag (real fly balls peak a
        // bit lower than vacuum predicts).
        //   v in ft/s = mph \u00d7 5280/3600
        //   g         = 32.174 ft/s\u00b2
        // Anything below ~12\u00b0 LA is a grounder; above that we render a
        // fly arc, even at modest 15\u201325\u00b0 line drives (which previously
        // got apex=0 and looked like they hugged the ground).
        const v = e.exitVeloMph * (5280 / 3600);
        const sinTheta = Math.sin((e.launchAngleDeg * Math.PI) / 180);
        const vacuumApex = (v * sinTheta) * (v * sinTheta) / (2 * 32.174);
        const arc = e.launchAngleDeg > 12 ? 'fly' : 'grounder';
        const apex = arc === 'fly' ? Math.max(6, vacuumApex * 0.75) : 0;
        startTween(ball, e.landingPoint, e.hangTimeSec || 1.2, e.t, arc, apex);
        break;
      }
      case 'fielder-converge': {
        const sp = fielders.get(e.position);
        if (sp) startTween(sp, e.toPoint, e.reachSec, e.t, 'line');
        break;
      }
      case 'ball-roll': {
        // Ball rolls along the grass from landing point toward the
        // fielder's intercept point. Linear ground tween (no apex):
        // gameplay-truthful — the engine already resolved the
        // intercept time, we just animate the ball getting there.
        ball.cur = { ...e.fromPoint };
        startTween(ball, e.toPoint, e.rollSec, e.t, 'grounder');
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
        // Snap the runner exactly onto `fromBase` before kicking off
        // the next leg. The engine emits per-segment events spaced by
        // segSec, but the renderer's tween clock can fall behind a few
        // ms (rAF jitter, event-fire vs ticker ordering), which would
        // leave `cur` short of the bag and cause the runner to "cut
        // the corner" \u2014 visible on home runs where 4 segments fire
        // back-to-back. Snapping guarantees every base is touched.
        const fromFt = e.fromBase === 'home' ? { x: 0, y: 0 } : BASE_COORDS_FT[e.fromBase];
        sp.cur = { ...fromFt };
        sp.from = { ...fromFt };
        const fromPx = ftToPx(fromFt, transform);
        sp.gfx.position.set(fromPx.x, fromPx.y);
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
  };

  const reset = () => {
    // Clear all runners
    for (const id of [...runners.keys()]) removeRunner(id);
    // Re-arm the pre-game intro so the next game also plays
    // the take-the-field jog + leadoff walk-out.
    firstInningOpened = false;
    firstBatterShown = false;
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

  return { root, applyEvent, tick, reset };
}

