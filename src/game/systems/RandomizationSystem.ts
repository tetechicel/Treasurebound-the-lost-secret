/**
 * Deterministic PRNG (Mulberry32 + FNV-1a seed hashing)
 * Ensures identical map layout, item placements, and puzzle order across all clients.
 */
export function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class SeededRandom {
  private state: number;

  constructor(seed: string | number) {
    this.state = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
    if (this.state === 0) this.state = 0x6d2b79f5;
  }

  /** Returns float in [0, 1) */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Returns shuffled copy of array using Fisher-Yates */
  shuffle<T>(items: readonly T[]): T[] {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Picks one element deterministically */
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
}

export function generateMatchSeed(): string {
  const bytes = new Uint32Array(2);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    bytes[0] = Math.floor(Math.random() * 0xffffffff);
    bytes[1] = Date.now() >>> 0;
  }
  return `TB-${bytes[0].toString(36).toUpperCase()}-${bytes[1].toString(36).toUpperCase()}`;
}
