'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { drawField, FIELD } from './field/drawField';
import { createPlaceholderBall, createPlaceholderPlayer } from './assets/SpriteProvider';
import { nullSoundEffects } from './assets/SoundProvider';
import { useSimPlayer, type Speed } from './engine/useSimPlayer';
import type { AnimationStep, SimEvent } from './engine/AnimationQueue';
import { FIELDER_HOME, PITCHER_ID } from './engine/AnimationQueue';
import { animatePitch, animateBallFlight } from './renderer/BallRenderer';
import { animateRunner, animateSwing, flashContact } from './renderer/RunnerRenderer';

// Batter's box positions (centered in the L/R box drawn on the field)
const BATTER_BOX = {
  L: { x: FIELD.BASE.home.x - 28, y: FIELD.BASE.home.y },
  R: { x: FIELD.BASE.home.x + 28, y: FIELD.BASE.home.y },
};

// Team colors — home is blue, visitor is red.
const TEAM_COLOR = {
  home: 0x3366ff,
  visitor: 0xff3333,
} as const;

/** Which side is batting (and therefore which side is fielding) for a given event. */
function sidesFor(half: 'top' | 'bottom') {
  // top half = visitor bats, home fields
  return half === 'top'
    ? { batting: 'visitor' as const, fielding: 'home' as const }
    : { batting: 'home' as const, fielding: 'visitor' as const };
}

interface Props {
  events: SimEvent[];
  homeName: string;
  visitorName: string;
  homeRuns: number;
  visitorRuns: number;
}

const OUTCOME_LABEL: Record<number, string> = {
  1: 'Single', 2: 'Double', 3: 'Triple', 4: 'Home Run',
  5: 'Walk', 6: 'Ground Out', 7: 'Strikeout',
};

export default function FieldCanvas({ events, homeName, visitorName, homeRuns, visitorRuns }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const ballRef = useRef<Graphics | null>(null);
  const fieldersRef = useRef<Container[]>([]);
  const pitcherRef = useRef<Container | null>(null);
  /** Active runners + current batter (keyed by event seq). */
  const runnersRef = useRef<Map<number, Container>>(new Map());
  /** seq id of the batter currently at the plate */
  const currentBatterIdRef = useRef<number | null>(null);
  const scoreTextRef = useRef<Text | null>(null);
  const [ready, setReady] = useState(false);

  // HUD state shown in HTML overlay
  const [hud, setHud] = useState<SimEvent | null>(null);
  const [scores, setScores] = useState({ visitor: 0, home: 0 });

  // ── Step executor ─────────────────────────────────────────────
  const executeStep = useCallback(async (step: AnimationStep, speed: Speed): Promise<void> => {
    const ball = ballRef.current;
    const app = appRef.current;
    if (!ball || !app) return;

    // Run a parallel group: kick off every sub-step concurrently and wait for
    // the slowest. Sub-steps may themselves be `sequence` groups.
    if (step.type === 'parallel') {
      await Promise.all(step.steps.map((s) => executeStep(s, speed)));
      return;
    }

    // Run sub-steps in order; resolves when the last one finishes.
    if (step.type === 'sequence') {
      for (const s of step.steps) {
        await executeStep(s, speed);
      }
      return;
    }

    switch (step.type) {
      case 'event_start': {
        setHud(step.event);
        const sides = sidesFor(step.event.half);
        const batterColor = TEAM_COLOR[sides.batting];
        const fieldingColor = TEAM_COLOR[sides.fielding];

        // Spawn the new batter as a runner at the appropriate batter's box.
        // This same graphic will become the baserunner if/when they hit.
        const hand = step.event.batter_hand ?? 'R';
        const box = BATTER_BOX[hand];
        const existing = runnersRef.current.get(step.event.seq);
        if (!existing) {
          const { gfx } = createPlaceholderPlayer(batterColor, step.event.batter_number ?? '');
          gfx.x = box.x;
          gfx.y = box.y;
          app.stage.addChild(gfx);
          runnersRef.current.set(step.event.seq, gfx);
        } else {
          existing.x = box.x;
          existing.y = box.y;
        }
        // Re-skin pitcher with current jersey number AND fielding-team color
        if (pitcherRef.current) {
          const old = pitcherRef.current;
          const { gfx: newPitcher } = createPlaceholderPlayer(fieldingColor, step.event.pitcher_number ?? '');
          newPitcher.x = old.x;
          newPitcher.y = old.y;
          app.stage.removeChild(old);
          old.destroy({ children: true });
          app.stage.addChild(newPitcher);
          pitcherRef.current = newPitcher;
        }
        currentBatterIdRef.current = step.event.seq;
        return;
      }

      case 'pitcher_windup': {
        const p = pitcherRef.current;
        if (!p) break;
        p.x = FIELD.MOUND.x;
        p.y = FIELD.MOUND.y;
        await animateRunner(p, { x: p.x, y: p.y }, { x: p.x, y: p.y - 8 }, speed);
        await animateRunner(p, { x: p.x, y: p.y }, { x: FIELD.MOUND.x, y: FIELD.MOUND.y }, speed);
        break;
      }

      case 'batter_swing': {
        const id = currentBatterIdRef.current;
        if (id == null) break;
        const b = runnersRef.current.get(id);
        if (!b) break;
        await animateSwing(b, speed);
        break;
      }

      case 'pitch':
        await animatePitch(ball, step.from, step.to, speed);
        break;

      case 'ball_flight':
        await animateBallFlight(ball, step.from, step.to, step.arc, speed);
        break;

      case 'contact':
        ball.x = step.pos.x;
        ball.y = step.pos.y;
        ball.visible = true;
        await flashContact(ball, speed);
        break;

      case 'fielder_move': {
        const f =
          step.fielderId === PITCHER_ID
            ? pitcherRef.current
            : fieldersRef.current[step.fielderId];
        if (f) await animateRunner(f, { x: f.x, y: f.y }, step.to, speed);
        break;
      }

      case 'fielder_reset': {
        if (step.fielderId === PITCHER_ID) {
          const p = pitcherRef.current;
          if (p) await animateRunner(p, { x: p.x, y: p.y }, FIELD.MOUND, speed);
          break;
        }
        const f = fieldersRef.current[step.fielderId];
        const home = FIELDER_HOME[step.fielderId];
        if (f && home) await animateRunner(f, { x: f.x, y: f.y }, home, speed);
        break;
      }

      case 'runner_advance': {
        let runner = runnersRef.current.get(step.runnerId);
        if (!runner) {
          // Fallback: spawn at the `from` point (shouldn't normally happen —
          // event_start should have created the batter graphic)
          const { gfx } = createPlaceholderPlayer(0xff6600, '');
          gfx.x = step.from.x;
          gfx.y = step.from.y;
          app.stage.addChild(gfx);
          runnersRef.current.set(step.runnerId, gfx);
          runner = gfx;
        }
        await animateRunner(runner, step.from, step.to, speed);
        // If runner returned to home (scored), destroy
        if (Math.abs(step.to.x - FIELD.BASE.home.x) < 1 && Math.abs(step.to.y - FIELD.BASE.home.y) < 1) {
          app.stage.removeChild(runner);
          runner.destroy();
          runnersRef.current.delete(step.runnerId);
        }
        break;
      }

      case 'runner_remove': {
        const r = runnersRef.current.get(step.runnerId);
        if (r) {
          if (step.walkTo) {
            // Trot back to the dugout, then disappear underneath it.
            const start = step.from ?? { x: r.x, y: r.y };
            await animateRunner(r, start, step.walkTo, speed);
          }
          app.stage.removeChild(r);
          r.destroy();
          runnersRef.current.delete(step.runnerId);
        }
        break;
      }

      case 'out': {
        const flash = new Graphics();
        flash.circle(step.pos.x, step.pos.y, 16).fill({ color: 0xff0000, alpha: 0.55 });
        app.stage.addChild(flash);
        await new Promise<void>((r) => setTimeout(r, 350 / speed));
        app.stage.removeChild(flash);
        flash.destroy();
        break;
      }

      case 'score_update':
        setScores({ visitor: step.visitorRuns, home: step.homeRuns });
        if (scoreTextRef.current) {
          scoreTextRef.current.text = `${visitorName} ${step.visitorRuns}  -  ${homeName} ${step.homeRuns}`;
        }
        break;

      case 'sound':
        nullSoundEffects[step.effect](); // Phase 5: real audio
        break;

      case 'side_change': {
        // Quick swap: current defenders run to the dugout of the team that was
        // just on defense, then come back out from the OTHER dugout to their
        // home positions (representing the new fielding team taking the field).
        const exitTo = step.newDefense === 'home' ? FIELD.DUGOUT.visitor : FIELD.DUGOUT.home;
        const enterFrom = step.newDefense === 'home' ? FIELD.DUGOUT.home : FIELD.DUGOUT.visitor;
        const newColor = TEAM_COLOR[step.newDefense];

        // Exit: all fielders + pitcher hustle to the previous defense's dugout
        const all = [...fieldersRef.current];
        if (pitcherRef.current) all.push(pitcherRef.current);
        await Promise.all(
          all.map((g) =>
            animateRunner(g, { x: g.x, y: g.y }, { x: exitTo.x, y: exitTo.y }, speed),
          ),
        );

        // Destroy old fielders/pitcher and rebuild in the new defense's color,
        // starting from the entering dugout.
        fieldersRef.current.forEach((g) => {
          app.stage.removeChild(g);
          g.destroy({ children: true });
        });
        if (pitcherRef.current) {
          app.stage.removeChild(pitcherRef.current);
          pitcherRef.current.destroy({ children: true });
        }
        fieldersRef.current = FIELDER_HOME.map(() => {
          const { gfx } = createPlaceholderPlayer(newColor, '');
          gfx.x = enterFrom.x;
          gfx.y = enterFrom.y;
          app.stage.addChild(gfx);
          return gfx;
        });
        const { gfx: newPitcher } = createPlaceholderPlayer(newColor, '');
        newPitcher.x = enterFrom.x;
        newPitcher.y = enterFrom.y;
        app.stage.addChild(newPitcher);
        pitcherRef.current = newPitcher;

        await Promise.all([
          ...fieldersRef.current.map((g, i) =>
            animateRunner(g, { x: g.x, y: g.y }, FIELDER_HOME[i], speed),
          ),
          animateRunner(newPitcher, { x: newPitcher.x, y: newPitcher.y }, FIELD.MOUND, speed),
        ]);
        break;
      }

      case 'pause':
        await new Promise<void>((r) => setTimeout(r, step.ms / speed));
        break;
    }
  }, [homeName, visitorName]);

  const [simState, controls] = useSimPlayer(events, executeStep);

  // ── Mount PixiJS ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let localApp: Application | null = null;

    (async () => {
      const app = new Application();
      await app.init({
        width: FIELD.W,
        height: FIELD.H,
        backgroundColor: 0x1a6b1a,
        antialias: true,
      });

      if (cancelled) { app.destroy(true); return; }
      if (!canvasRef.current) { app.destroy(true); return; }

      localApp = app;
      canvasRef.current.appendChild(app.canvas as HTMLCanvasElement);
      appRef.current = app;

      drawField(app);

      // 8 fielders (catcher, infield, outfield) — tracked for animation
      fieldersRef.current = FIELDER_HOME.map(() => {
        const { gfx } = createPlaceholderPlayer(0x3366ff, '');
        return gfx;
      });
      fieldersRef.current.forEach((g, i) => {
        g.x = FIELDER_HOME[i].x;
        g.y = FIELDER_HOME[i].y;
        app.stage.addChild(g);
      });

      // Pitcher (animated for windup)
      const { gfx: pitcherGfx } = createPlaceholderPlayer(0x3366ff, '');
      pitcherGfx.x = FIELD.MOUND.x;
      pitcherGfx.y = FIELD.MOUND.y;
      app.stage.addChild(pitcherGfx);
      pitcherRef.current = pitcherGfx;

      // Batter graphic is created on-demand per at-bat in `event_start`.

      // Ball — a persistent object. Starts in the pitcher's hand at the
      // mound and stays visible for the whole game.
      const { gfx: ballGfx } = createPlaceholderBall();
      ballGfx.x = FIELD.MOUND.x;
      ballGfx.y = FIELD.MOUND.y;
      ballGfx.visible = true;
      app.stage.addChild(ballGfx);
      ballRef.current = ballGfx;

      // Score overlay text on canvas
      const style = new TextStyle({ fill: 0xffffff, fontSize: 14, fontFamily: 'monospace', fontWeight: 'bold' });
      const scoreText = new Text({ text: `${visitorName} 0  -  ${homeName} 0`, style });
      scoreText.x = 10;
      scoreText.y = 8;
      app.stage.addChild(scoreText);
      scoreTextRef.current = scoreText;

      setReady(true);
    })();

    return () => {
      cancelled = true;
      localApp?.destroy(true);
      appRef.current = null;
      ballRef.current = null;
      fieldersRef.current = [];
      pitcherRef.current = null;
      runnersRef.current.clear();
      currentBatterIdRef.current = null;
      scoreTextRef.current = null;
      setReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const speedOptions: Speed[] = [0.5, 1, 2, 4];

  return (
    <div className="flex flex-col gap-3">
      {/* HUD overlay */}
      <div className="grid grid-cols-3 gap-3 text-sm rounded bg-gray-900 p-3 border border-gray-700">
        <div>
          <div className="text-gray-500 text-xs uppercase">Inning</div>
          <div className="text-white font-mono">
            {hud ? `${hud.half === 'top' ? '▲' : '▼'} ${hud.inning}` : '—'}
          </div>
        </div>
        <div>
          <div className="text-gray-500 text-xs uppercase">Score</div>
          <div className="text-white font-mono">
            {visitorName.slice(0, 3)} {scores.visitor} - {scores.home} {homeName.slice(0, 3)}
          </div>
        </div>
        <div>
          <div className="text-gray-500 text-xs uppercase">Outs</div>
          <div className="text-white font-mono">{hud?.outs ?? 0}</div>
        </div>
        <div className="col-span-3">
          <div className="text-gray-500 text-xs uppercase">At Bat</div>
          <div className="text-white">
            {hud
              ? `${hud.batter_name} vs ${hud.pitcher_name} → ${OUTCOME_LABEL[hud.outcome] ?? '—'}`
              : 'Press Play to start'}
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="rounded-lg overflow-hidden border border-gray-700"
        style={{ width: FIELD.W, height: FIELD.H, maxWidth: '100%' }}
      />

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={simState.playing ? controls.pause : controls.play}
          disabled={!ready}
          className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-medium"
        >
          {!ready ? 'Loading…' : simState.playing ? 'Pause' : 'Play'}
        </button>

        <div className="flex items-center gap-1">
          {speedOptions.map((s) => (
            <button
              key={s}
              onClick={() => controls.setSpeed(s)}
              className={`px-2.5 py-1 rounded text-xs font-mono ${
                simState.speed === s
                  ? 'bg-gray-200 text-gray-900'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        <span className="ml-auto text-xs text-gray-500 font-mono">
          {simState.stepIndex} / {simState.totalSteps} steps
        </span>
      </div>

      {/* Final score reference */}
      <div className="text-xs text-gray-500">
        Final: {visitorName} {visitorRuns} - {homeName} {homeRuns}
      </div>
    </div>
  );
}
