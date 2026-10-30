import { describe, expect, it } from 'vitest';
import { allocateResolutionNumberInternal } from '../src/numbers';
import { setupGovernance } from './helpers';

describe('allocateResolutionNumberInternal', () => {
  it('numbers across all organs, one gapless sequence per year', () => {
    const { deps } = setupGovernance();
    const next = (year: number) => deps.db.transaction((tx) => allocateResolutionNumberInternal(tx, year));
    // Vorstand, Versammlung, Vorstand — vereinsweit eine Folge.
    expect([next(2026), next(2026), next(2027), next(2026)]).toEqual(['B-2026-001', 'B-2026-002', 'B-2027-001', 'B-2026-003']);
  });
});
