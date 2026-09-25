import { CORE_SETTINGS } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { managedHintKey, SETTINGS_TABS } from '@/lib/settings-fields';

describe('SETTINGS_TABS', () => {
  it('covers every organization, branding and ui setting exactly once', () => {
    const covered = SETTINGS_TABS.flatMap((tab) => tab.fields.map((f) => f.key));
    // branding.logoAssetId wird über den Logo-Upload verwaltet, nicht als Textfeld
    const expected = CORE_SETTINGS.map((s) => s.key).filter((k) => (k.startsWith('organization.') || k.startsWith('branding.') || k.startsWith('ui.')) && k !== 'branding.logoAssetId');
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
  it('names, for every field a module may manage, where it is kept instead — one sentence per tab', () => {
    const managed = CORE_SETTINGS.filter((s) => s.managedBy).map((s) => s.key);
    for (const tab of SETTINGS_TABS) {
      for (const field of tab.fields.filter((f) => managed.includes(f.key))) {
        const key = managedHintKey(field.key);
        expect(key, field.key).toBe(`managedHint.${tab.key}`);
        expect((messages.settings.managedHint as Record<string, string>)[tab.key], field.key).toBeTruthy();
      }
    }
    expect(managedHintKey('organization.name')).toBeNull();
  });
});
