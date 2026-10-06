import { describe, expect, it } from 'vitest';
import { SEED_STORY_LAST_DAY, seedStoryYear } from '../src/seed-calendar';

describe('seedStoryYear', () => {
  it('is the running year from the last day of the story on, the year before until then', () => {
    expect(SEED_STORY_LAST_DAY).toBe('08-31');
    expect(seedStoryYear('2027-08-30')).toBe(2026);
    expect(seedStoryYear('2027-08-31')).toBe(2027);
    expect(seedStoryYear('2027-09-01')).toBe(2027);
    expect(seedStoryYear('2027-12-31')).toBe(2027);
  });

  it('falls back a year across New Year and on a leap day', () => {
    expect(seedStoryYear('2027-01-01')).toBe(2026);
    expect(seedStoryYear('2027-03-01')).toBe(2026);
    expect(seedStoryYear('2028-02-29')).toBe(2027);
  });

  it('keeps the story year of the unit tests: TEST_NOW (2026-09-05) and today give 2026', () => {
    expect(seedStoryYear('2026-09-05')).toBe(2026);
    expect(seedStoryYear('2026-10-06')).toBe(2026);
  });
});
