import { describe, expect, it } from 'vitest';
import { unwrap } from '../src/result';
import { RETENTION_DEFAULT_MONTHS, retentionEnd } from '../src/retention/classes';
import { retentionMonths } from '../src/retention/service';
import { setSetting } from '../src/settings/service';
import { createTestDeps, ctxWith } from '../src/testing';

describe('retentionEnd', () => {
  it('starts the period at the end of the calendar year, not at the date itself', () => {
    // § 147 Abs. 4 AO: die Frist beginnt mit Ablauf des Kalenderjahres.
    expect(retentionEnd('2026-03-15', 120)).toBe('2036-12-31');
    expect(retentionEnd('2026-12-31', 120)).toBe('2036-12-31');
    expect(retentionEnd('2026-01-01', 120)).toBe('2036-12-31');
  });

  it('handles the six-year and consent periods', () => {
    expect(retentionEnd('2026-03-15', 72)).toBe('2032-12-31');
    expect(retentionEnd('2026-03-15', 24)).toBe('2028-12-31');
  });

  it('clamps to the last day of the month when the period is not a full year', () => {
    expect(retentionEnd('2026-03-15', 18)).toBe('2028-06-30');
    expect(retentionEnd('2026-03-15', 2)).toBe('2027-02-28');
  });

  it('accepts a full timestamp and reads only the year', () => {
    expect(retentionEnd('2026-09-05T08:00:00.000Z', 120)).toBe('2036-12-31');
  });

  it('names a default length for every class except permanent', () => {
    expect(RETENTION_DEFAULT_MONTHS).toEqual({ statutory10Y: 120, statutory6Y: 72, consent: 24 });
  });
});

describe('retentionMonths', () => {
  it('reads the configured length and treats permanent as never due', async () => {
    const deps = createTestDeps();
    expect(retentionMonths(deps, 'statutory10Y')).toBe(120);
    expect(retentionMonths(deps, 'permanent')).toBeNull();

    unwrap(await setSetting(deps, ctxWith(['settings.manage']), { key: 'retention.consent', value: 18 }));
    expect(retentionMonths(deps, 'consent')).toBe(18);
  });
});
