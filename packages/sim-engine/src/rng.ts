/**
 * Seedable random number generator (mulberry32). Pure, deterministic.
 * All randomness in sim-lab routes through an `Rng` instance so test
 * runs are reproducible given a seed.
 */

export interface Rng {
  next(): number;            // uniform [0, 1)
  int(min: number, max: number): number;  // inclusive
  pick<T>(arr: readonly T[]): T;
  gaussian(mean: number, stdDev: number): number;
  bool(pTrue: number): boolean;
}

export function createRng(seed = 0xC0FFEE): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Box-Muller for normal samples
  const gaussian = (mean: number, stdDev: number): number => {
    const u1 = Math.max(next(), 1e-12);
    const u2 = next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stdDev;
  };
  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    gaussian,
    bool: (p) => next() < p,
  };
}
