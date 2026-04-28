'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { Application, Graphics, Text, TextStyle } from 'pixi.js';
import { drawField, FIELD } from './field/drawField';
import { createPlaceholderBall, createPlaceholderPlayer } from './assets/SpriteProvider';
import { nullSoundEffects } from './assets/SoundProvider';
import { useSimPlayer, type Speed } from './engine/useSimPlayer';
import type { AnimationStep, SimEvent } from './engine/AnimationQueue';
import { animatePitch, animateBallFlight } from './renderer/BallRenderer';
import { animateRunner, flashContact } from './renderer/RunnerRenderer';

interface Props {
  events: SimEvent[];
  homeName: string;
  visitorName: string;
  homeRuns: number;
  visitorRuns: number;
}

export default function FieldCanvas({ events, homeName, visitorName, homeRuns, visitorRuns }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const ballRef = useRef<Graphics | null>(null);
  // Runner pool: seq id → Graphics
  const runnersRef = useRef<Map<number, Graphics>>(new Map());
  const [ready, setReady] = useState(false);

  // ── Step executor ─────────────────────────────────────────────
  const executeStep = useCallback(async (step: AnimationStep, speed: Speed): Promise<void> => {
    const ball = ballRef.current;
    if (!ball) return;

    switch (step.type) {
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

      case 'runner_advance': {
        const app = appRef.current;
        if (!app) break;
        let runner = runnersRef.current.get(step.runnerId);
        if (!runner) {
          const { gfx } = createPlaceholderPlayer(0xff6600, String(step.runnerId % 100));
          app.stage.addChild(gfx);
          runnersRef.current.set(step.runnerId, gfx);
          runner = gfx;
        }
        await animateRunner(runner, step.from, step.to, speed);
        // If runner returned to home (scored), remove from stage
        if (step.to.x === FIELD.BASE.home.x && step.to.y === FIELD.BASE.home.y) {
          runner.visible = false;
          runnersRef.current.delete(step.runnerId);
        }
        break;
      }

      case 'out': {
        // Brief flash at fielder position
        const app = appRef.current;
        if (!app) break;
        const flash = new Graphics();
        flash.circle(step.pos.x, step.pos.y, 14).fill({ color: 0xff0000, alpha: 0.5 });
        app.stage.addChild(flash);
        await new Promise<void>((r) => setTimeout(r, 350 / speed));
        app.stage.removeChild(flash);
        break;
      }

      case 'sound':
        nullSoundEffects[step.effect](); // Phase 5: swap with real SoundEffects
        break;

      case 'pause':
        await new Promise<void>((r) => setTimeout(r, step.ms / speed));
        break;
    }
  }, []);

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

      if (cancelled) {
        app.destroy(true);
        return;
      }
      if (!canvasRef.current) {
        app.destroy(true);
        return;
      }

      localApp = app;
      canvasRef.current.appendChild(app.canvas as HTMLCanvasElement);
      appRef.current = app;

      drawField(app);

      // Defensive fielders (8 players besides pitcher) — placeholder circles
      const fielderPositions: Array<{ pos: { x: number; y: number }; label: string }> = [
        { pos: { x: FIELD.BASE.home.x,    y: FIELD.BASE.home.y + 22 }, label: 'C'  }, // catcher
        { pos: { x: 565, y: 430 },                                      label: '1B' },
        { pos: { x: 470, y: 330 },                                      label: '2B' },
        { pos: { x: 335, y: 330 },                                      label: 'SS' },
        { pos: { x: 235, y: 430 },                                      label: '3B' },
        { pos: { x: 170, y: 200 },                                      label: 'LF' },
        { pos: { x: 400, y: 130 },                                      label: 'CF' },
        { pos: { x: 630, y: 200 },                                      label: 'RF' },
      ];

      for (const { pos, label: _label } of fielderPositions) {
        const { gfx } = createPlaceholderPlayer(0x3366ff, _label);
        gfx.x = pos.x;
        gfx.y = pos.y;
        app.stage.addChild(gfx);
      }

      // Pitcher
      const { gfx: pitcherGfx } = createPlaceholderPlayer(0x3366ff, 'P');
      pitcherGfx.x = FIELD.MOUND.x;
      pitcherGfx.y = FIELD.MOUND.y;
      app.stage.addChild(pitcherGfx);

      const { gfx: batterGfx } = createPlaceholderPlayer(0xff3333, 'B');
      batterGfx.x = FIELD.BASE.home.x + 25;
      batterGfx.y = FIELD.BASE.home.y;
      app.stage.addChild(batterGfx);

      // Ball
      const { gfx: ballGfx } = createPlaceholderBall();
      ballGfx.x = FIELD.MOUND.x;
      ballGfx.y = FIELD.MOUND.y;
      ballGfx.visible = false;
      app.stage.addChild(ballGfx);
      ballRef.current = ballGfx;

      // Score overlay text
      const style = new TextStyle({ fill: 0xffffff, fontSize: 13, fontFamily: 'monospace' });
      const scoreText = new Text({ text: `${visitorName} ${visitorRuns}  ${homeName} ${homeRuns}`, style });
      scoreText.x = 10;
      scoreText.y = 8;
      app.stage.addChild(scoreText);

      setReady(true);
    })();

    return () => {
      cancelled = true;
      if (localApp) {
        localApp.destroy(true);
      }
      appRef.current = null;
      ballRef.current = null;
      runnersRef.current.clear();
      setReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Controls bar ──────────────────────────────────────────────
  const speedOptions: Speed[] = [0.5, 1, 2, 4];

  return (
    <div className="flex flex-col gap-3">
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
    </div>
  );
}
