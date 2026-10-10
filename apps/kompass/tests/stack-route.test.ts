import { describe, expect, it } from 'vitest';
import { rightAction } from '@/app/(shell)/animals/proposals/review/stack-route';

const item = (o: Partial<Parameters<typeof rightAction>[0]> = {}) => ({ kind: 'update' as const, conflictCount: 0, hintCount: 0, missing: [] as ('primaryPhoto' | 'summary')[], ...o });

describe('rightAction (Spec § 6, Board 3)', () => {
  it('accepts a clean change with its preselection', () => expect(rightAction(item())).toEqual({ kind: 'accept', publish: false }));
  it('accepts a complete new dog and puts it online', () => expect(rightAction(item({ kind: 'create' }))).toEqual({ kind: 'accept', publish: true }));
  it('leads to the review page on conflict, doubt, notice, match, or a new dog without cover photo or summary', () => {
    expect(rightAction(item({ conflictCount: 1 }))).toEqual({ kind: 'review', reasons: ['conflict'] });
    expect(rightAction(item({ hintCount: 2 }))).toEqual({ kind: 'review', reasons: ['hints'] });
    expect(rightAction(item({ kind: 'notice' }))).toEqual({ kind: 'review', reasons: ['notice'] });
    expect(rightAction(item({ kind: 'sameAs' }))).toEqual({ kind: 'review', reasons: ['sameAs'] });
    expect(rightAction(item({ kind: 'create', missing: ['primaryPhoto', 'summary'] }))).toEqual({ kind: 'review', reasons: ['missingPrimaryPhoto', 'missingSummary'] });
  });

  it('leads to the review page when the status becomes adopted and no year is known', () => {
    expect(rightAction(item(), { needsYear: true })).toEqual({ kind: 'review', reasons: ['adoptedYear'] });
  });
});
