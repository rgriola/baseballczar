'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Application, Container } from 'pixi.js';
import type { SimEvent } from '@baseballczar/sim-engine';
import { makeTransform, ftToPx } from './coords';
import { buildField } from './field/drawField';
import { createScene, type SceneAPI } from './scene';
import { usePlayer, type PlaybackSpeed } from './engine/usePlayer';

const CANVAS_W = 800;
const CANVAS_H = 600;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;

/** Named camera presets (focus point in engine feet, zoom level). */
const PRESETS = {
  full:    { fx: 0,    fy: 160, zoom: 1 },
  infield: { fx: 0,    fy: 80,  zoom: 2.2 },
  mound:   { fx: 0,    fy: 60,  zoom: 3 },
  home:    { fx: 0,    fy: 5,   zoom: 3.5 },
  rightF:  { fx: 130,  fy: 280, zoom: 2.5 },
  centerF: { fx: 0,    fy: 320, zoom: 2.5 },
  leftF:   { fx: -130, fy: 280, zoom: 2.5 },
} as const;
type PresetName = keyof typeof PRESETS;

export interface FieldCanvasV2Props {
  events: SimEvent[];
  speed?: PlaybackSpeed;
  autoplay?: boolean;
  onClock?: (clockSec: number) => void;
  onCursor?: (cursor: number) => void;
}

interface HudState {
  inning: number;
  half: 'top' | 'bottom';
  outs: number;
  scoreHome: number;
  scoreAway: number;
  homeName: string;
  awayName: string;
  balls: number;
  strikes: number;
  bases: [boolean, boolean, boolean]; // 1B, 2B, 3B
}

const INITIAL_HUD: HudState = {
  inning: 1, half: 'top', outs: 0,
  scoreHome: 0, scoreAway: 0,
  homeName: 'Home', awayName: 'Away',
  balls: 0, strikes: 0,
  bases: [false, false, false],
};

export default function FieldCanvasV2({
  events,
  speed = 1,
  autoplay = false,
  onClock,
  onCursor,
}: FieldCanvasV2Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const sceneRef = useRef<SceneAPI | null>(null);
  const worldRef = useRef<Container | null>(null);
  const transformRef = useRef<ReturnType<typeof makeTransform> | null>(null);

  // Camera state (mirrored into refs so wheel/drag handlers don't restart effects).
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 }); // in screen px, applied after scale
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);

  /**
   * Apply current camera (zoom + pan) to the world container.
   * Zoom is anchored on the canvas center so the field doesn't fly off.
   */
  const applyCamera = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const z = zoomRef.current;
    world.scale.set(z);
    // Center the canvas, then offset by pan, then re-center about (cx,cy).
    const cx = CANVAS_W / 2;
    const cy = CANVAS_H / 2;
    world.position.set(cx + panRef.current.x - cx * z, cy + panRef.current.y - cy * z);
  }, []);

  // Re-apply whenever zoom/pan change.
  useEffect(() => { applyCamera(); }, [zoom, pan, applyCamera]);

  // Build the Pixi app once (or when canvas dimensions change).
  useEffect(() => {
    let disposed = false;
    let app: Application | null = null;
    let initialized = false;
    (async () => {
      app = new Application();
      try {
        await app.init({
          width: CANVAS_W,
          height: CANVAS_H,
          background: 0x081818,
          antialias: true,
          autoDensity: true,
          resolution: window.devicePixelRatio || 1,
        });
      } catch {
        return;
      }
      initialized = true;
      if (disposed) {
        try { app.destroy(true, { children: true, texture: true }); } catch { /* ignore */ }
        return;
      }
      appRef.current = app;
      hostRef.current?.appendChild(app.canvas);

      const transform = makeTransform({ width: CANVAS_W, height: CANVAS_H });
      transformRef.current = transform;
      const fieldRoot: Container = buildField({ width: CANVAS_W, height: CANVAS_H }, transform).root;

      const scene = createScene(transform);
      sceneRef.current = scene;

      // Wrap field + scene in a single "world" container we can scale/pan.
      const world = new Container();
      world.addChild(fieldRoot);
      world.addChild(scene.root);
      worldRef.current = world;
      app.stage.addChild(world);
      applyCamera();

      // Per-frame tween advance — we drive scene.tick from rAF here, but
      // we still need the engine clock from the player. Use a hook bridge.
      // The player ticker already calls us via onClock; if not provided,
      // fall back to wall-clock.
      app.ticker.add(() => {
        scene.tick(currentClockRef.current);
      });
    })();

    return () => {
      disposed = true;
      sceneRef.current = null;
      worldRef.current = null;
      transformRef.current = null;
      if (app && initialized) {
        try { app.destroy(true, { children: true, texture: true }); } catch { /* ignore */ }
      }
      if (hostRef.current) hostRef.current.innerHTML = '';
      appRef.current = null;
    };
  }, [applyCamera]);

  // ─── Wheel zoom (anchored on cursor) and drag-to-pan ───
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = host.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;
      const oldZoom = zoomRef.current;
      const factor = Math.exp(-ev.deltaY * 0.0015);
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * factor));
      if (newZoom === oldZoom) return;
      // Keep the world point under the cursor stationary.
      // World point at cursor before: (mx - panX) / oldZoom adjusted for our anchor formula.
      // Since applyCamera centers on canvas, derive new pan that preserves cursor's world coord.
      const cx = CANVAS_W / 2;
      const cy = CANVAS_H / 2;
      // Inverse of applyCamera:
      // screenX = cx + panX - cx*z + worldX*z  =>  worldX = (screenX - cx - panX + cx*z) / z
      const wx = (mx - cx - panRef.current.x + cx * oldZoom) / oldZoom;
      const wy = (my - cy - panRef.current.y + cy * oldZoom) / oldZoom;
      const newPanX = mx - cx + cx * newZoom - wx * newZoom;
      const newPanY = my - cy + cy * newZoom - wy * newZoom;
      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    };

    let dragging = false;
    let lastX = 0, lastY = 0;
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      dragging = true;
      lastX = ev.clientX; lastY = ev.clientY;
      host.setPointerCapture(ev.pointerId);
      host.style.cursor = 'grabbing';
    };
    const onMove = (ev: PointerEvent) => {
      if (!dragging) return;
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      lastX = ev.clientX; lastY = ev.clientY;
      setPan(p => ({ x: p.x + dx, y: p.y + dy }));
    };
    const onUp = (ev: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try { host.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      host.style.cursor = 'grab';
    };

    host.style.cursor = 'grab';
    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerup', onUp);
    host.addEventListener('pointercancel', onUp);

    return () => {
      host.removeEventListener('wheel', onWheel);
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerup', onUp);
      host.removeEventListener('pointercancel', onUp);
    };
  }, []);

  /** Center the camera on a point in engine feet at a given zoom. */
  const focusOn = useCallback((fx: number, fy: number, z: number) => {
    const t = transformRef.current;
    if (!t) return;
    const px = ftToPx({ x: fx, y: fy }, t);
    const cx = CANVAS_W / 2;
    const cy = CANVAS_H / 2;
    // applyCamera: screen = cx + pan + (worldPx - cx) * z
    // We want screen = (cx, cy) when worldPx = px:
    // pan = cx - cx - (px - cx) * z + (cy/cx swap) — derive both axes
    setPan({
      x: cx - cx - (px.x - cx) * z + (cx - cx),
      y: cy - cy - (px.y - cy) * z + (cy - cy),
    });
    setZoom(z);
  }, []);

  const applyPreset = useCallback((name: PresetName) => {
    const p = PRESETS[name];
    focusOn(p.fx, p.fy, p.zoom);
  }, [focusOn]);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Player drives event firing & clock; scene applies events & tweens.
  const currentClockRef = useRef(0);

  // HUD state derived from events. Lives in React so a DOM overlay can
  // render it independent of the Pixi camera (so zooming the field doesn't
  // hide the score/outs).
  const [hud, setHud] = useState<HudState>(INITIAL_HUD);

  const [playerState, controls] = usePlayer({
    events,
    autoplay,
    onEvent: (e) => {
      sceneRef.current?.applyEvent(e);
      setHud(prev => reduceHud(prev, e));
    },
    onSeek: () => {
      sceneRef.current?.reset();
      setHud(INITIAL_HUD);
    },
  });

  // Mirror clock from playerState into ref the rAF loop reads.
  useEffect(() => {
    currentClockRef.current = playerState.clock;
    onClock?.(playerState.clock);
  }, [playerState.clock, onClock]);

  useEffect(() => {
    onCursor?.(playerState.cursor);
  }, [playerState.cursor, onCursor]);

  // Apply requested speed.
  useEffect(() => {
    controls.setSpeed(speed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed]);

  return (
    <div className="flex flex-col gap-2">
      <div
        style={{ width: CANVAS_W, height: CANVAS_H, position: 'relative' }}
        className="rounded-lg overflow-hidden border border-zinc-800"
      >
        <div
          ref={hostRef}
          style={{ width: CANVAS_W, height: CANVAS_H, lineHeight: 0, touchAction: 'none' }}
          className="bg-black"
        />
        <HudOverlay hud={hud} />
      </div>
      <CameraBar
        zoom={zoom}
        onZoom={(z) => setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)))}
        onPreset={applyPreset}
        onReset={resetView}
      />
      <PlayerControlsBar
        state={playerState}
        controls={controls}
      />
    </div>
  );
}

function CameraBar({
  zoom, onZoom, onPreset, onReset,
}: {
  zoom: number;
  onZoom: (z: number) => void;
  onPreset: (name: PresetName) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-300 px-1 flex-wrap">
      <span className="text-zinc-500 uppercase tracking-wider">View</span>
      {(['full', 'infield', 'mound', 'home', 'leftF', 'centerF', 'rightF'] as const).map(name => (
        <button
          key={name}
          onClick={() => name === 'full' ? onReset() : onPreset(name)}
          className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
        >
          {presetLabel(name)}
        </button>
      ))}
      <div className="w-px h-4 bg-zinc-700 mx-1" />
      <button onClick={() => onZoom(zoom * 0.8)} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700">−</button>
      <input
        type="range"
        min={MIN_ZOOM}
        max={MAX_ZOOM}
        step={0.05}
        value={zoom}
        onChange={(e) => onZoom(Number(e.target.value))}
        className="w-32"
      />
      <button onClick={() => onZoom(zoom * 1.25)} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700">+</button>
      <span className="font-mono tabular-nums w-12 text-right text-zinc-400">{zoom.toFixed(2)}×</span>
      <span className="text-zinc-600 ml-auto">Drag to pan · Scroll to zoom</span>
    </div>
  );
}

function presetLabel(n: PresetName): string {
  switch (n) {
    case 'full': return 'Full';
    case 'infield': return 'Infield';
    case 'mound': return 'Mound';
    case 'home': return 'Home';
    case 'leftF': return 'LF';
    case 'centerF': return 'CF';
    case 'rightF': return 'RF';
  }
}

function PlayerControlsBar({
  state, controls,
}: {
  state: ReturnType<typeof usePlayer>[0];
  controls: ReturnType<typeof usePlayer>[1];
}) {
  return (
    <div className="flex items-center gap-3 text-sm text-zinc-300 px-1">
      <button
        onClick={controls.toggle}
        className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
      >
        {state.playing ? '❚❚ Pause' : '▶ Play'}
      </button>
      <button
        onClick={controls.reset}
        className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
      >
        ⏮ Reset
      </button>
      <div className="flex gap-1">
        {[0.5, 1, 2, 4, 8].map(s => (
          <button
            key={s}
            onClick={() => controls.setSpeed(s as PlaybackSpeed)}
            className={`px-2 py-1 rounded text-xs ${
              state.speed === s ? 'bg-blue-600 text-white' : 'bg-zinc-800 hover:bg-zinc-700'
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
      <input
        type="range"
        min={0}
        max={state.duration || 1}
        step={0.1}
        value={state.clock}
        onChange={(e) => controls.seek(Number(e.target.value))}
        className="flex-1"
      />
      <span className="font-mono text-xs tabular-nums w-28 text-right">
        {fmtClock(state.clock)} / {fmtClock(state.duration)}
      </span>
      <span className="font-mono text-xs tabular-nums text-zinc-500">
        {state.cursor}/{state.total}
      </span>
    </div>
  );
}

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── HUD reducer & overlay ───────────────────────────────────────────

function reduceHud(s: HudState, e: SimEvent): HudState {
  switch (e.type) {
    case 'game-start':
      return { ...s, homeName: e.homeTeamName, awayName: e.awayTeamName };
    case 'inning-start':
      return { ...s, inning: e.inning, half: e.half, outs: 0, balls: 0, strikes: 0, bases: [false, false, false] };
    case 'at-bat-start': {
      const bases: [boolean, boolean, boolean] = [
        e.runners[0] != null, e.runners[1] != null, e.runners[2] != null,
      ];
      return { ...s, balls: 0, strikes: 0, bases };
    }
    case 'pitch': {
      let { balls, strikes } = s;
      if (e.outcome === 'ball') balls++;
      else if (e.outcome === 'called-strike' || e.outcome === 'swinging-strike') strikes++;
      else if (e.outcome === 'foul' && strikes < 2) strikes++;
      return { ...s, balls, strikes };
    }
    case 'out':
      return { ...s, outs: e.outNum };
    case 'run-scored':
      return { ...s, scoreHome: e.scoreHome, scoreAway: e.scoreAway };
    case 'at-bat-end':
      return { ...s, balls: 0, strikes: 0 };
    default:
      return s;
  }
}

function HudOverlay({ hud }: { hud: HudState }) {
  const halfArrow = hud.half === 'top' ? '▲' : '▼';
  return (
    <div
      className="absolute top-2 left-2 pointer-events-none select-none"
      style={{ zIndex: 10 }}
    >
      <div className="bg-black/70 backdrop-blur-sm rounded-md border border-zinc-700/60 px-3 py-2 text-zinc-100 font-mono text-xs leading-tight shadow-lg">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-red-400 w-10 truncate">{hud.awayName.slice(0, 8)}</span>
              <span className="tabular-nums font-bold text-base">{hud.scoreAway}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-blue-400 w-10 truncate">{hud.homeName.slice(0, 8)}</span>
              <span className="tabular-nums font-bold text-base">{hud.scoreHome}</span>
            </div>
          </div>
          <div className="w-px self-stretch bg-zinc-700/60" />
          <div className="flex flex-col items-center">
            <span className="text-zinc-300">{halfArrow} {hud.inning}</span>
            <span className="text-zinc-400 mt-0.5">{hud.outs} out{hud.outs === 1 ? '' : 's'}</span>
          </div>
          <div className="w-px self-stretch bg-zinc-700/60" />
          <div className="flex flex-col items-center">
            <span className="tabular-nums">{hud.balls}-{hud.strikes}</span>
            <Diamond bases={hud.bases} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Diamond({ bases }: { bases: [boolean, boolean, boolean] }) {
  // Tiny SVG diamond: 2B top, 3B left, 1B right.
  const size = 22;
  const c = size / 2;
  const r = 3;
  const filled = '#fbbf24';
  const empty = '#3f3f46';
  return (
    <svg width={size} height={size} className="mt-0.5">
      <rect x={c - r} y={1}        width={r * 2} height={r * 2} transform={`rotate(45 ${c} ${1 + r})`}        fill={bases[1] ? filled : empty} />
      <rect x={1}     y={c - r}    width={r * 2} height={r * 2} transform={`rotate(45 ${1 + r} ${c})`}        fill={bases[2] ? filled : empty} />
      <rect x={size - 1 - r * 2} y={c - r} width={r * 2} height={r * 2} transform={`rotate(45 ${size - 1 - r} ${c})`} fill={bases[0] ? filled : empty} />
    </svg>
  );
}
