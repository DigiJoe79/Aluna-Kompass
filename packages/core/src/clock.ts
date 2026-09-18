export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface FixedClock extends Clock {
  advance(ms: number): void;
  set(iso: string): void;
}

export function fixedClock(iso: string): FixedClock {
  let current = new Date(iso);
  return {
    now: () => new Date(current.getTime()),
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
    },
    set: (next) => {
      current = new Date(next);
    },
  };
}

export const isoNow = (clock: Clock): string => clock.now().toISOString();
