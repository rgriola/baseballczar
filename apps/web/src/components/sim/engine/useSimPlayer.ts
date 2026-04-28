'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnimationStep, SimEvent } from './AnimationQueue';
import { buildAnimationQueue } from './AnimationQueue';

export type Speed = 0.5 | 1 | 2 | 4;

export interface SimPlayerState {
  stepIndex: number;
  totalSteps: number;
  playing: boolean;
  speed: Speed;
  currentEvent: SimEvent | null;
}

export interface SimPlayerControls {
  play: () => void;
  pause: () => void;
  setSpeed: (s: Speed) => void;
  seek: (index: number) => void;
}

/**
 * React hook: converts SimEvent[] → AnimationStep[], manages play/pause/speed.
 * Calls onStep(step) for every step so the PixiJS renderer can execute it.
 *
 * onStep MUST return a Promise<void> that resolves when the animation completes.
 */
export function useSimPlayer(
  events: SimEvent[],
  onStep: (step: AnimationStep, speed: Speed) => Promise<void>,
): [SimPlayerState, SimPlayerControls] {
  const stepsRef = useRef<AnimationStep[]>([]);
  const eventsRef = useRef<SimEvent[]>(events);
  const playingRef = useRef(false);
  const speedRef = useRef<Speed>(1);
  const stepIndexRef = useRef(0);
  const cancelRef = useRef(false);

  const [state, setState] = useState<SimPlayerState>({
    stepIndex: 0,
    totalSteps: 0,
    playing: false,
    speed: 1,
    currentEvent: null,
  });

  // Build queue once on mount / events change
  useEffect(() => {
    eventsRef.current = events;
    stepsRef.current = buildAnimationQueue(events);
    stepIndexRef.current = 0;
    setState((s) => ({ ...s, stepIndex: 0, totalSteps: stepsRef.current.length, playing: false }));
  }, [events]);

  const runFrom = useCallback(async (startIdx: number) => {
    cancelRef.current = false;
    const steps = stepsRef.current;

    for (let i = startIdx; i < steps.length; i++) {
      if (cancelRef.current) break;

      stepIndexRef.current = i;
      setState((s) => ({ ...s, stepIndex: i }));

      await onStep(steps[i], speedRef.current);
    }

    playingRef.current = false;
    setState((s) => ({ ...s, playing: false, stepIndex: stepsRef.current.length }));
  }, [onStep]);

  const play = useCallback(() => {
    if (playingRef.current) return;
    playingRef.current = true;
    setState((s) => ({ ...s, playing: true }));
    void runFrom(stepIndexRef.current);
  }, [runFrom]);

  const pause = useCallback(() => {
    cancelRef.current = true;
    playingRef.current = false;
    setState((s) => ({ ...s, playing: false }));
  }, []);

  const setSpeed = useCallback((s: Speed) => {
    speedRef.current = s;
    setState((prev) => ({ ...prev, speed: s }));
  }, []);

  const seek = useCallback((index: number) => {
    cancelRef.current = true;
    playingRef.current = false;
    stepIndexRef.current = index;
    setState((s) => ({ ...s, stepIndex: index, playing: false }));
  }, []);

  return [state, { play, pause, setSpeed, seek }];
}
