// Last touched by agent: 2026-05-06T03:49:31Z
'use client';

/**
 * React wrapper for the tick-based field canvas.
 * Manages the Pixi application lifecycle and provides playback controls
 * with a draggable timeline scrubber, view mode buttons, and speed control.
 */
import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import type { WorldSnapshot } from '@baseballczar/tick-engine';
import type { ViewMode, EventDispatchMeta, DebugPlayerLookup } from './tickScene';

interface TickFieldCanvasProps {
  snapshots: WorldSnapshot[];
  autoplay?: boolean;
  speed?: number;
  width?: number;
  height?: number;
  onEvent?: (events: WorldSnapshot['events'], time: number, meta?: EventDispatchMeta) => void;
  onTimeUpdate?: (time: number) => void;
  debugPlayerTags?: boolean;
  playerLookup?: DebugPlayerLookup;
}

type TickSceneLike = {
  init: () => Promise<void>;
  destroy: () => void;
  loadSnapshots: (
    snapshots: WorldSnapshot[],
    onEvent?: (events: WorldSnapshot['events'], time: number, meta?: EventDispatchMeta) => void,
  ) => void;
  play: (speed?: number) => void;
  pause: () => void;
  seek: (time: number) => void;
  setSpeed: (speed: number) => void;
  setDebugPlayerTags: (enabled: boolean, lookup?: DebugPlayerLookup) => void;
  setViewMode: (mode: ViewMode) => void;
  getTime: () => number;
  isFinished: () => boolean;
};

export default function TickFieldCanvas({
  snapshots,
  autoplay = true,
  speed: initialSpeed = 1,
  width = 800,
  height = 600,
  onEvent,
  onTimeUpdate,
  debugPlayerTags = false,
  playerLookup = {},
}: TickFieldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<TickSceneLike | null>(null);
  const [ready, setReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('full');
  const [speed, setSpeed] = useState(initialSpeed);
  const [isPlaying, setIsPlaying] = useState(autoplay);
  const scrubberRef = useRef<HTMLDivElement>(null);
  const onEventRef = useRef<typeof onEvent>(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const duration = useMemo(() => {
    if (snapshots.length === 0) return 0;
    return snapshots[snapshots.length - 1].time;
  }, [snapshots]);

  // Initialize Pixi app
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let scene: TickSceneLike | null = null;
    setReady(false);

    const initScene = async () => {
      try {
        const { TickScene } = await import('./tickScene');
        if (cancelled) return;

        scene = new TickScene({ canvas, width, height });
        sceneRef.current = scene;
        await scene.init();

        if (cancelled) {
          scene.destroy();
          if (sceneRef.current === scene) sceneRef.current = null;
          return;
        }

        setReady(true);
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to initialize TickScene', err);
        }
      }
    };

    void initScene();

    return () => {
      cancelled = true;
      setReady(false);
      scene?.destroy();
      if (sceneRef.current === scene) sceneRef.current = null;
    };
  }, [width, height]);

  // Load snapshots when they change
  const loadedSnapshotsRef = useRef<WorldSnapshot[] | null>(null);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !ready) return;

    // Prevent double-load from React strict mode re-renders
    if (loadedSnapshotsRef.current === snapshots) return;
    loadedSnapshotsRef.current = snapshots;

    scene.loadSnapshots(snapshots, (events, time, meta) => {
      onEventRef.current?.(events, time, meta);
    });

    if (autoplay) {
      scene.play(speed);
      setIsPlaying(true);
    }
    // Intentionally omit speed/onEvent from deps:
    // - speed changes are handled by the separate setSpeed effect
    // - onEvent is captured in the closure; re-running loadSnapshots
    //   would reset playbackTime and destroy/recreate sprites
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshots, ready, autoplay]);

  // Poll playback time from the scene for scrubber position
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !ready) return;

    const interval = setInterval(() => {
      const t = scene.getTime();
      setCurrentTime(t);
      onTimeUpdate?.(t);
      if (scene.isFinished()) setIsPlaying(false);
    }, 100);

    return () => clearInterval(interval);
  }, [ready, onTimeUpdate]);

  // Update speed
  useEffect(() => {
    sceneRef.current?.setSpeed(speed);
  }, [speed]);

  // Toggle on-field debug player tags and refresh lookup data.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !ready) return;
    scene.setDebugPlayerTags(debugPlayerTags, playerLookup);
  }, [ready, debugPlayerTags, playerLookup]);

  const handlePlay = useCallback(() => {
    sceneRef.current?.play(speed);
    setIsPlaying(true);
  }, [speed]);

  const handlePause = useCallback(() => {
    sceneRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const handleViewMode = useCallback((mode: ViewMode) => {
    sceneRef.current?.setViewMode(mode);
    setViewMode(mode);
  }, []);

  // Scrubber click/drag
  const handleScrubberClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = scrubberRef.current;
    if (!bar || duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const t = (x / rect.width) * duration;
    sceneRef.current?.seek(t);
    setCurrentTime(t);
  }, [duration]);

  const handleScrubberDrag = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return; // only on left-click drag
    handleScrubberClick(e);
  }, [handleScrubberClick]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const viewButtons: { mode: ViewMode; label: string; icon: string }[] = [
    { mode: 'full', label: 'Full', icon: '🏟️' },
    { mode: 'infield', label: 'Infield', icon: '💎' },
    { mode: 'ball', label: 'Ball', icon: '⚾' },
  ];

  const speedOptions = [0.5, 1, 1.5, 2, 3];

  // Format time as m:ss
  const fmt = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          width,
          height,
          borderRadius: '8px 8px 0 0',
          border: '1px solid rgba(255,255,255,0.08)',
          borderBottom: 'none',
        }}
      />

      {/* Timeline scrubber bar */}
      <div
        ref={scrubberRef}
        onClick={handleScrubberClick}
        onMouseMove={handleScrubberDrag}
        className="relative h-2 bg-zinc-800 cursor-pointer"
        style={{ width }}
        title={`${fmt(currentTime)} / ${fmt(duration)}`}
      >
        {/* Progress fill */}
        <div
          className="absolute top-0 left-0 h-full bg-blue-500/70 transition-none"
          style={{ width: `${progress}%` }}
        />
        {/* Playhead dot */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-blue-400 rounded-full shadow-md border border-blue-300"
          style={{ left: `calc(${progress}% - 6px)` }}
        />
      </div>

      {/* Playback controls — below the scrubber */}
      <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-b-lg px-3 py-1.5" style={{ width }}>
        <button
          onClick={isPlaying ? handlePause : handlePlay}
          className="text-white/80 hover:text-white text-sm w-6 text-center"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        {/* Speed selector */}
        <div className="flex items-center gap-0.5">
          {speedOptions.map(s => (
            <button
              key={s}
              onClick={() => {
                setSpeed(s);
                sceneRef.current?.setSpeed(s);
              }}
              className={`px-1 py-0.5 rounded text-[10px] font-mono ${
                speed === s
                  ? 'bg-zinc-700 text-white'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        {/* Separator */}
        <div className="w-px h-4 bg-zinc-700" />

        {/* View mode buttons */}
        {viewButtons.map(({ mode, label, icon }) => (
          <button
            key={mode}
            onClick={() => handleViewMode(mode)}
            className={`px-1.5 py-0.5 rounded text-xs ${
              viewMode === mode
                ? 'bg-blue-600 text-white'
                : 'text-white/50 hover:text-white/80 hover:bg-zinc-800'
            }`}
            title={`${label} view`}
          >
            {icon} {label}
          </button>
        ))}

        {/* Time display */}
        <div className="flex-1 text-xs text-white/50 font-mono text-right">
          {fmt(currentTime)} / {fmt(duration)}
        </div>
      </div>
    </div>
  );
}
