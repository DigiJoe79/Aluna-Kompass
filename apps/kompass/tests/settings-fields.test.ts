import { CORE_SETTINGS } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { managedHintKey, SETTINGS_TABS, settingsSections } from '@/lib/settings-fields';

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

  // Handoff Konsistenz § 8b.3/§ 8c: Abschnitte und Spannweiten der Vorlage „Verein“; Kontakt in zwei Zeilen
  // (E-Mail m · Telefon s, dann Webseite m — 2 + 1 + 2 passt nicht in vier Spalten und bricht von selbst um).
  it('lays out the association tab in five sections with sizes from the template', () => {
    const tab = SETTINGS_TABS.find((t) => t.key === 'organization')!;
    expect(settingsSections(tab).map((s) => [s.section, s.fields.map((f) => `${f.key.replace('organization.', '')}:${f.size}`)])).toEqual([
      ['name', ['name:m', 'legalForm:m']],
      ['address', ['street:m', 'postalCode:s', 'city:s']],
      ['locale', ['country:s', 'timeZone:s', 'foundedYear:s']],
      ['register', ['registerCourt:m', 'registerNumber:s']],
      ['contact', ['email:m', 'phone:s', 'website:m']],
    ]);
  });
  it('gives every field a size and every titled section a heading', () => {
    const sizes = { s: 1, m: 2, l: 3, full: 4 } as const;
    const sectionTitles = (messages.settings as unknown as { sections: Record<string, string> }).sections;
    for (const tab of SETTINGS_TABS) {
      for (const field of tab.fields) {
        expect(sizes[field.size], field.key).toBeDefined();
        expect('span' in field, field.key).toBe(false);
      }
      for (const { section } of settingsSections(tab)) {
        if (section) expect(sectionTitles[section], `${tab.key}.${section}`).toBeTruthy();
      }
    }
  });
  it('keeps the fields of one section together, without reordering', () => {
    for (const tab of SETTINGS_TABS) {
      const sections = settingsSections(tab);
      expect(sections.flatMap((s) => s.fields)).toEqual(tab.fields);
      const named = sections.map((s) => s.section).filter(Boolean);
      expect(new Set(named).size, tab.key).toBe(named.length);
    }
  });
});
