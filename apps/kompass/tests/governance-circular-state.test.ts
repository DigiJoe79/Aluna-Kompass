import { describe, expect, it } from 'vitest';
import { STATUS_TONES } from '@/components/status-badge';
import { circularState } from '@/lib/governance/circular-state';

const evaluation = (reached: boolean, possible: boolean) => ({ consent: 'all' as const, reached, possible, missing: 0, needed: 3, yes: 0, no: 0, abstain: 0, total: 3, reachedOn: null });
const base = { deadline: '2026-09-10', outcome: null, sealedAt: null };

describe('circularState', () => {
  it('sealed: adopted passed, otherwise failed', () => {
    expect(circularState({ ...base, sealedAt: 'x', outcome: 'adopted', evaluation: evaluation(false, false) }, '2026-09-01')).toBe('passed');
    expect(circularState({ ...base, sealedAt: 'x', outcome: 'rejected', evaluation: evaluation(true, true) }, '2026-09-01')).toBe('failed');
  });
  it('open: reached passed (also after the deadline), impossible failed, past the deadline overdue, else running', () => {
    expect(circularState({ ...base, evaluation: evaluation(true, true) }, '2026-09-01')).toBe('passed');
    expect(circularState({ ...base, evaluation: evaluation(true, true) }, '2026-09-20')).toBe('passed');
    expect(circularState({ ...base, evaluation: evaluation(false, false) }, '2026-09-01')).toBe('failed');
    expect(circularState({ ...base, evaluation: evaluation(false, true) }, '2026-09-11')).toBe('overdue');
    expect(circularState({ ...base, evaluation: evaluation(false, true) }, '2026-09-10')).toBe('running');
  });
  it('every state has a tone', () => {
    for (const s of ['running', 'overdue', 'failed', 'passed'] as const) expect(STATUS_TONES.circular[s]).toBeDefined();
  });
});
