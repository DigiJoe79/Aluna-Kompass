import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { defineModule, type ModuleManifest } from '../src/modules/manifest';
import { unwrap } from '../src/result';
import { RETENTION_DEFAULT_MONTHS, retentionEnd } from '../src/retention/classes';
import { collectRetentionDue, dueUntil, holdsFor, retentionMonths } from '../src/retention/service';
import { readSetting, setSetting, writeSettingInternal } from '../src/settings/service';
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
    expect(retentionMonths(deps, 'statutory6Y')).toBe(72);
    expect(retentionMonths(deps, 'permanent')).toBeNull();

    unwrap(await setSetting(deps, ctxWith(['settings.manage']), { key: 'retention.consent', value: 18 }));
    expect(retentionMonths(deps, 'consent')).toBe(18);
  });
});

describe('retentionEnd input validation', () => {
  // Fix 1: `>` auf Strings ist nur ein Datumsvergleich für vollständige, gepolsterte
  // `YYYY-MM-DD`. Ein kaputtes oder leeres Datum muss laut scheitern statt still
  // ein falsches Maximum zu erzeugen.
  it('throws on a malformed fromIso instead of returning NaN-12-NaN', () => {
    expect(() => retentionEnd('kaputt', 120)).toThrow();
  });

  it('throws on an empty fromIso instead of sorting below every real date', () => {
    expect(() => retentionEnd('', 120)).toThrow();
  });

  it('throws on a negative months value', () => {
    expect(() => retentionEnd('2026-03-15', -1)).toThrow();
  });

  it('throws on a non-integer months value', () => {
    expect(() => retentionEnd('2026-03-15', 1.5)).toThrow();
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

  it('does not ask about an entityType the module does not answer for', () => {
    const deps = createTestDeps({ manifests: [coreModule, holder('alpha', '2028-12-31')] });
    deps.db.transaction((tx) => {
      writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['alpha'], 'test.enable');
    });
    expect(holdsFor(deps, 'document', 'D1')).toEqual([]);
  });
});

describe('dueUntil finds the true maximum, not the last-seen value', () => {
  // Fix 6: der Zwei-Halter-Fall im Bestandstest ist aufsteigend sortiert — ein
  // falscher Startwert der reduce würde dort nicht auffallen.
  it('finds the maximum when holds arrive in descending order', () => {
    const holds = [
      { label: 'a', until: '2036-12-31', entity: 'x', id: '1' },
      { label: 'b', until: '2028-12-31', entity: 'x', id: '2' },
    ];
    expect(dueUntil(holds)).toBe('2036-12-31');
  });

  it('handles duplicate dates', () => {
    const holds = [
      { label: 'a', until: '2030-12-31', entity: 'x', id: '1' },
      { label: 'b', until: '2030-12-31', entity: 'x', id: '2' },
    ];
    expect(dueUntil(holds)).toBe('2030-12-31');
  });

  it('finds the maximum when it comes from the first element', () => {
    const holds = [
      { label: 'a', until: '2036-12-31', entity: 'x', id: '1' },
      { label: 'b', until: '2028-12-31', entity: 'x', id: '2' },
      { label: 'c', until: '2030-12-31', entity: 'x', id: '3' },
    ];
    expect(dueUntil(holds)).toBe('2036-12-31');
  });
});

describe('holdsFor validates hold shape at the module boundary (Fix 1b)', () => {
  it('throws when a module returns an until that is neither null nor YYYY-MM-DD', () => {
    const deps = createTestDeps({
      manifests: [
        coreModule,
        defineModule({
          key: 'broken-date',
          version: '1',
          permissions: [],
          retentionHolds: (_deps, entityType, id) =>
            entityType === 'contact' ? [{ label: 'kaputtes Datum', until: '2036-9-01', entity: 'broken-date', id }] : [],
        }),
      ],
    });
    deps.db.transaction((tx) => {
      writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['broken-date'], 'test.enable');
    });
    expect(() => holdsFor(deps, 'contact', 'C1')).toThrow(/broken-date/);
    expect(() => holdsFor(deps, 'contact', 'C1')).toThrow(/kaputtes Datum/);
  });

  it('throws when a module returns an empty-string until', () => {
    const deps = createTestDeps({
      manifests: [
        coreModule,
        defineModule({
          key: 'broken-date',
          version: '1',
          permissions: [],
          retentionHolds: (_deps, entityType, id) =>
            entityType === 'contact' ? [{ label: 'leeres Datum', until: '', entity: 'broken-date', id }] : [],
        }),
      ],
    });
    deps.db.transaction((tx) => {
      writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['broken-date'], 'test.enable');
    });
    expect(() => holdsFor(deps, 'contact', 'C1')).toThrow(/broken-date/);
  });

  it('accepts a well-formed pair and returns the later date', () => {
    const holds = [
      { label: 'a', until: '2036-09-01', entity: 'x', id: '1' },
      { label: 'b', until: '2036-12-31', entity: 'x', id: '2' },
    ];
    expect(dueUntil(holds)).toBe('2036-12-31');
  });
});

describe('retention settings are derived from RETENTION_DEFAULT_MONTHS (Fix 3)', () => {
  it('defines a setting for every class in RETENTION_DEFAULT_MONTHS with the matching default', () => {
    const deps = createTestDeps();
    for (const [cls, months] of Object.entries(RETENTION_DEFAULT_MONTHS)) {
      expect(readSetting(deps, `retention.${cls}`)).toBe(months);
    }
  });

  it('accepts zero months, which is a legitimate length for consent (Fix 4)', async () => {
    const deps = createTestDeps();
    unwrap(await setSetting(deps, ctxWith(['settings.manage']), { key: 'retention.consent', value: 0 }));
    expect(readSetting(deps, 'retention.consent')).toBe(0);
    expect(retentionEnd('2026-03-15', 0)).toBe('2026-12-31');
  });

  it('still rejects a negative months value', async () => {
    const deps = createTestDeps();
    const result = await setSetting(deps, ctxWith(['settings.manage']), { key: 'retention.consent', value: -1 });
    expect(result.ok).toBe(false);
  });
});

describe('defineModule validates contactRoles (Fix 5)', () => {
  it('throws on a malformed role key', () => {
    expect(() =>
      defineModule({
        key: 'demo',
        version: '1',
        permissions: [],
        contactRoles: [{ key: 'Not Valid!', retention: 'consent' }],
      }),
    ).toThrow(/role key/);
  });

  it('throws on a retention class that is not in RETENTION_CLASSES', () => {
    expect(() =>
      defineModule({
        key: 'demo',
        version: '1',
        permissions: [],
        // @ts-expect-error absichtlich ungültig für den Test
        contactRoles: [{ key: 'donor', retention: 'forever' }],
      }),
    ).toThrow(/retention/);
  });

  it('accepts a well-formed contact role', () => {
    expect(() =>
      defineModule({
        key: 'demo',
        version: '1',
        permissions: [],
        contactRoles: [{ key: 'donor', retention: 'statutory10Y' }],
      }),
    ).not.toThrow();
  });
});

describe('a throwing module hook must never be read as "holds nothing" (Fix 2)', () => {
  it('holdsFor propagates an exception from a module hook instead of swallowing it', () => {
    const deps = createTestDeps({
      manifests: [
        coreModule,
        defineModule({
          key: 'exploding',
          version: '1',
          permissions: [],
          retentionHolds: () => {
            throw new Error('finance module is broken');
          },
        }),
      ],
    });
    deps.db.transaction((tx) => {
      writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['exploding'], 'test.enable');
    });
    expect(() => holdsFor(deps, 'contact', 'C1')).toThrow('finance module is broken');
  });

  it('collectRetentionDue propagates an exception from a module hook too', () => {
    const deps = createTestDeps({
      manifests: [
        coreModule,
        defineModule({
          key: 'exploding',
          version: '1',
          permissions: [],
          retentionDue: () => {
            throw new Error('finance module is broken');
          },
        }),
      ],
    });
    deps.db.transaction((tx) => {
      writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['exploding'], 'test.enable');
    });
    expect(() => collectRetentionDue(deps)).toThrow('finance module is broken');
  });
});
