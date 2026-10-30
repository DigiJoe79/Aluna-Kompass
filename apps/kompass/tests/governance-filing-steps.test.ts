import { describe, expect, it } from 'vitest';
import { filingSteps } from '@/lib/governance/filing-steps';

const req = (met: boolean[]) => met.map((m, i) => ({ key: 'resolutionCopy' as const, level: (i < 2 ? 'required' : 'recommended') as 'required' | 'recommended', documentIds: [], met: m, source: 'computed' as const }));
const filing = (f: { notarizedOn?: string | null; submittedOn?: string | null; registeredOn?: string | null; openOrder?: boolean }) => ({
  notarizedOn: f.notarizedOn ?? null,
  submittedOn: f.submittedOn ?? null,
  registeredOn: f.registeredOn ?? null,
  interimOrders: f.openOrder ? [{ on: '2026-09-01', deadline: null, documentId: null, resolvedOn: null, followUpId: null }] : [],
});

describe('filingSteps', () => {
  it('counts the required documents; an open interim order keeps submitted active; registered ends', () => {
    expect(filingSteps(filing({}), req([true, false, false]))).toMatchObject({ active: 'compile', detail: { compile: { met: 1, required: 2 } } });
    expect(filingSteps(filing({}), req([true, true, false])).active).toBe('notary');
    expect(filingSteps(filing({ notarizedOn: 'x' }), req([false, false])).active).toBe('submitted');
    expect(filingSteps(filing({ notarizedOn: 'x', submittedOn: 'y', openOrder: true }), req([])).active).toBe('submitted');
    expect(filingSteps(filing({ notarizedOn: 'x', submittedOn: 'y' }), req([])).active).toBe('registered');
    expect(filingSteps(filing({ notarizedOn: 'x', submittedOn: 'y', registeredOn: 'z' }), req([])).active).toBeNull();
  });
  it('never more than one step active, over all combinations', () => {
    for (let mask = 0; mask < 32; mask++) {
      const f = filing({ notarizedOn: mask & 1 ? 'a' : null, submittedOn: mask & 2 ? 'b' : null, registeredOn: mask & 4 ? 'c' : null, openOrder: !!(mask & 8) });
      const r = filingSteps(f, req([!!(mask & 16), !!(mask & 16)]));
      const open = (['compile', 'notary', 'submitted', 'registered'] as const).filter((k) => !r.done[k]);
      expect(r.active === null ? open.length === 0 : r.active === open[0]).toBe(true);
    }
  });
});
