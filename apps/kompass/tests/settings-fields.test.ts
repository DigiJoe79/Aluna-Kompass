import { CORE_SETTINGS } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { SETTINGS_TABS } from '@/lib/settings-fields';

describe('SETTINGS_TABS', () => {
  it('covers every organization and branding setting exactly once', () => {
    const covered = SETTINGS_TABS.flatMap((tab) => tab.fields.map((f) => f.key));
    const expected = CORE_SETTINGS.map((s) => s.key).filter((k) => k.startsWith('organization.') || k.startsWith('branding.'));
    expect([...covered].sort()).toEqual([...expected].sort());
    expect(new Set(covered).size).toBe(covered.length);
  });
  it('places tax fields on the tax tab', () => {
    const tax = SETTINGS_TABS.find((t) => t.key === 'tax')!;
    expect(tax.fields.map((f) => f.key)).toEqual([
      'organization.taxNumber',
      'organization.taxOffice',
      'organization.exemptionNoticeType',
      'organization.exemptionNoticeDate',
      'organization.statutoryPurpose',
    ]);
  });
});
