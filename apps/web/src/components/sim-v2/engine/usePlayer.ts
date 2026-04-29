/**
 * usePlayer — drives a SimEvent[] timeline at a configurable speed.
 *
 * Strategy: maintain a virtual `clock` (seconds in engine time). Each
 * animation frame, advance the clock by `dt * speed` and fire any events
 * whose `t` is now <= clock. The renderer subscribes to event callbacks.
 *
 * The hook is renderer-agnostic — it just calls `onEvent(event)` and
 * `onTick(clock)`. The Pixi scene handles tweening between events.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SimEvent } from '@baseballczar/sim-engine';

export type PlaybackSpeed = 0.5 | 1 | 2 | 4 | 8;

export interface PlayerControls {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setSpeed: (s: PlaybackSpeed) => void;
  seek: (clockSec: number) => void;
  reset: () => void;
}

export interface PlayerState {
  playing: boolean;
  speed: PlaybackSpeed;
  clock: number;        // current engine-time (seconds)
  duration: number;     // total event timeline length
  cursor: number;       // index of next event to fire
  total: number;        // total event count
}

export interface UsePlayerOpts {
  events: SimEvent[];
  onEvent: (e: SimEvent) => void;
  onSeek?: (clockSec: number) => void;
  /** Optional: cap speed*frame-dt to avoid huge jumps (default 0.25s). */
  maxStepSec?: number;
  autoplay?: boolean;
}

export function usePlayer(opts: UsePlayerOpts): [PlayerState, PlayerControls] {
  const { events, onEvent, onSeek, maxStepSec = 0.25, autoplay = false } = opts;

  const duration = events.length > 0 ? events[events.length - 1].t : 0;

  const [state, setState] = useState<PlayerState>({
    playing: autoplay,
    speed: 1,
    clock: 0,
    duration,
    cursor: 0,
    total: events.length,
  });

  // Keep refs in sync so the rAF loop reads latest values without restart.
  const playingRef = useRef(state.playing);
  const speedRef = useRef<PlaybackSpeed>(state.speed);
  const clockRef = useRef(0);
  const cursorRef = useRef(0);
  const eventsRef = useRef(events);
  const onEventRef = useRef(onEvent);

  useEffect(() => { playingRef.current = state.playing; }, [state.playing]);
  useEffect(() => { speedRef.current = state.speed; }, [state.speed]);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  // Reset when the events array itself changes (e.g. new game).
  // Also notify the renderer to clear residual sprites (batter, runners,
  // ball position) from the previous game — otherwise the next game's
  // first at-bat draws on top of the prior game's lingering state.
  useEffect(() => {
    eventsRef.current = events;
    clockRef.current = 0;
    cursorRef.current = 0;
    onSeek?.(0);
    setState(s => ({
      ...s,
      clock: 0,
      cursor: 0,
      total: events.length,
      duration: events.length > 0 ? events[events.length - 1].t : 0,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  // ─── rAF loop ───
  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(maxStepSec, (now - last) / 1000);
      last = now;
      if (playingRef.current) {
        const step = dt * speedRef.current;
        clockRef.current += step;
        const evs = eventsRef.current;
        let cur = cursorRef.current;
        while (cur < evs.length && evs[cur].t <= clockRef.current) {
          onEventRef.current(evs[cur]);
          cur++;
        }
        if (cur !== cursorRef.current) cursorRef.current = cur;
        // End of timeline?
        if (cur >= evs.length) {
          playingRef.current = false;
          setState(s => ({ ...s, playing: false, clock: clockRef.current, cursor: cur }));
        } else {
          // Lightweight state sync (~30fps for UI, rAF still drives sim).
          setState(s => (s.clock === clockRef.current && s.cursor === cur ? s : {
            ...s, clock: clockRef.current, cursor: cur,
          }));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [maxStepSec]);

  const play = useCallback(() => setState(s => ({ ...s, playing: true })), []);
  const pause = useCallback(() => setState(s => ({ ...s, playing: false })), []);
  const toggle = useCallback(() => setState(s => ({ ...s, playing: !s.playing })), []);
  const setSpeed = useCallback((s: PlaybackSpeed) => setState(prev => ({ ...prev, speed: s })), []);

  const reset = useCallback(() => {
    clockRef.current = 0;
    cursorRef.current = 0;
    setState(s => ({ ...s, clock: 0, cursor: 0, playing: false }));
    onSeek?.(0);
  }, [onSeek]);

  const seek = useCallback((target: number) => {
    const evs = eventsRef.current;
    const clamped = Math.max(0, Math.min(target, duration));
    // If seeking forward, fire intermediate events. If backward, reset and replay.
    if (clamped < clockRef.current) {
      onSeek?.(clamped);
      cursorRef.current = 0;
    }
    clockRef.current = clamped;
    let cur = cursorRef.current;
    while (cur < evs.length && evs[cur].t <= clamped) {
      onEventRef.current(evs[cur]);
      cur++;
    }
    cursorRef.current = cur;
    setState(s => ({ ...s, clock: clamped, cursor: cur }));
  }, [duration, onSeek]);

  return [
    state,
    { play, pause, toggle, setSpeed, seek, reset },
  ];
}
