/**
 * Sound effect socket.
 * Phase 5: Replace nullSoundEffects with real implementations (e.g. Howler.js).
 * The SoundEffects interface must not change — all callers stay the same.
 */

export interface SoundEffects {
  crack: () => void;
  crowd_cheer: () => void;
  crowd_groan: () => void;
  strike: () => void;
  walk: () => void;
  homeRun: () => void;
}

/** No-op stubs — safe to use until real audio is wired in. */
export const nullSoundEffects: SoundEffects = {
  crack:        () => {},
  crowd_cheer:  () => {},
  crowd_groan:  () => {},
  strike:       () => {},
  walk:         () => {},
  homeRun:      () => {},
};
