import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { defineModule, type ModuleManifest } from '../src/modules/manifest';
import { unwrap } from '../src/result';
import { RETENTION_DEFAULT_MONTHS, retentionEnd } from '../src/retention/classes';
import { collectRetentionDue, dueUntil, holdsFor, retentionMonths } from '../src/retention/service';
import { setSetting, writeSettingInternal } from '../src/settings/service';
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

const holder = (key: string, until: string | null): ModuleManifest =>
  defineModule({
    key,
    version: '1',
    permissions: [`${key}.view`],
    retentionHolds: (_deps, entityType, id) => (entityType === 'contact' ? [{ label: `${key} hält ${id}`, until, entity: key, id }] : []),
    retentionDue: () => [{ entity: key, id: 'X1', label: `${key} X1`, dueSince: '2026-01-01' }],
  });

describe('retention collection', () => {
  it('asks every enabled module and takes the longest hold', () => {
    const deps = createTestDeps({ manifests: [coreModule, holder('alpha', '2028-12-31'), holder('beta', '2036-12-31')] });
    deps.db.transaction((tx) => {
      writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['alpha', 'beta'], 'test.enable');
    });
    const holds = holdsFor(deps, 'contact', 'C1');
    expect(holds.map((h) => h.entity).sort()).toEqual(['alpha', 'beta']);
    expect(dueUntil(holds)).toBe('2036-12-31');
  });

  it('never becomes due while one holder is permanent', () => {
    expect(dueUntil([{ label: 'Satzung', until: null, entity: 'x', id: '1' }, { label: 'Brief', until: '2030-12-31', entity: 'x', id: '2' }])).toBeNull();
  });

  it('is not due when nothing holds it', () => {
    expect(dueUntil([])).toBe(null);
  });

  it('does not ask a disabled module', () => {
    const deps = createTestDeps({ manifests: [coreModule, holder('alpha', '2028-12-31'), holder('beta', '2036-12-31')] });
    deps.db.transaction((tx) => {
      writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['alpha'], 'test.enable');
    });
    expect(holdsFor(deps, 'contact', 'C1').map((h) => h.entity)).toEqual(['alpha']);
    expect(collectRetentionDue(deps).map((d) => d.entity)).toEqual(['alpha']);
  });
});
