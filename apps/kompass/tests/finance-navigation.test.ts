import { coreModule } from '@kompass/core';
import { financeModule } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { buildNavigation, sectionsFor } from '@/lib/navigation';

/** Unternavigation Finanzen in sechs Gruppen (Designer Stufe 2 Nr. 12, Nachtrag). Rechte und Routen bleiben. */
const sections = (permissions: string[]) =>
  sectionsFor(buildNavigation({ manifests: [coreModule, financeModule], enabledKeys: new Set(['core', 'finance']), permissions: new Set(permissions) }), '/finance/work').map((s) => [
    s.labelKey ? (s.labelKey.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string) : null,
    s.items.map((i) => i.href),
  ]);

describe('Unternavigation Finanzen', () => {
  it('sechs Gruppen in fester Reihenfolge für Finanzen lesen, Auslagen und Freigeben', () => {
    expect(sections(['finance.read', 'finance.expensesSubmit', 'finance.approve'])).toEqual([
      ['Arbeit', ['/finance/work', '/finance/work/foreign', '/finance/work/vouchers', '/finance/imports', '/finance/work/rules']],
      ['Buchungen', ['/finance/entries', '/finance/open-items', '/finance/accounts', '/finance/cash']],
      ['Zweckmittel', ['/finance/purposes', '/finance/reserves']],
      ['Spenden', ['/finance/donations', '/finance/donations/run', '/finance/donations/book', '/finance/donations/notices']],
      ['Auslagen', ['/finance/expenses', '/finance/approvals']],
      ['Beteiligte', ['/finance/partners', '/finance/people']],
      ['Rechenschaft', ['/finance/closing', '/finance/audit', '/finance/reports', '/finance/other-assets', '/finance/tax', '/finance/deadlines', '/finance/fund-use']],
    ]);
  });

  it('„Kassenprüfung“ vor „Berichte“ mit finance.read oder finance.audit — Prüfer sehen die Navigation nach ihren Rechten (Nachtrag Prüferzugang)', () => {
    const accountability = (permissions: string[]) =>
      buildNavigation({ manifests: [coreModule, financeModule], enabledKeys: new Set(['core', 'finance']), permissions: new Set(permissions) })
        .flatMap((g) => g.items)
        .filter((i) => i.section === 'finance.accountability' && i.visible)
        .map((i) => i.href);
    expect(accountability(['finance.audit'])).toEqual(['/finance/audit', '/finance/reports']);
    expect(accountability(['finance.read', 'finance.overview', 'finance.audit'])).toEqual(['/finance/closing', '/finance/audit', '/finance/reports', '/finance/other-assets', '/finance/tax', '/finance/deadlines', '/finance/fund-use']);
    // Steuererklärung nur mit Leserecht, Prüfer sehen sie nicht (Rechenschaft D2 Task 9).
    expect(accountability(['finance.audit'])).not.toContain('/finance/tax');
    expect(accountability(['finance.overview'])).not.toContain('/finance/tax');
    expect(accountability(['finance.overview'])).not.toContain('/finance/audit');
    // Jahresabschluss nur mit Leserecht (Review Focus 1); Fristen und Schwellen schon mit dem Überblick.
    expect(accountability(['finance.overview'])).not.toContain('/finance/closing');
    expect(accountability(['finance.overview'])).toContain('/finance/deadlines');
  });

  it('„Rechenschaft“: Berichte und Mittelverwendung für Lesende mit und ohne Namen — Mittelverwendung seit 0.4.5 aktiv (Spec § Navigation, N1; Plan U2)', () => {
    const items = buildNavigation({ manifests: [coreModule, financeModule], enabledKeys: new Set(['core', 'finance']), permissions: new Set(['finance.overview']) })
      .flatMap((g) => g.items)
      .filter((i) => i.section === 'finance.accountability');
    expect(items.map((i) => [i.href, i.permission, i.later ?? false, i.visible])).toEqual([
      ['/finance/closing', 'finance.read', false, false],
      ['/finance/audit', ['finance.read', 'finance.audit'], false, false],
      ['/finance/reports', ['finance.read', 'finance.overview', 'finance.audit'], false, true],
      ['/finance/other-assets', ['finance.read', 'finance.overview'], false, true],
      ['/finance/tax', 'finance.read', false, false],
      ['/finance/vat', [], false, false],
      ['/finance/deadlines', ['finance.read', 'finance.overview'], false, true],
      ['/finance/fund-use', ['finance.read', 'finance.overview'], false, true],
    ]);
  });

  it('Gruppen ohne sichtbaren Eintrag fallen samt Kopf weg', () => {
    const at = (permissions: string[], path: string) =>
      sectionsFor(buildNavigation({ manifests: [coreModule, financeModule], enabledKeys: new Set(['core', 'finance']), permissions: new Set(permissions) }), path).map((s) => [s.key, s.items.map((i) => i.key)]);
    expect(at(['finance.expensesSubmit', 'finance.approve'], '/finance/expenses')).toEqual([['finance.expenses', ['finance.expenses', 'finance.approvals']]]);
    expect(at(['finance.overview', 'finance.expensesSubmit'], '/finance/expenses')).toEqual([
      ['finance.allocation', ['finance.purposes']],
      ['finance.expenses', ['finance.expenses']],
      ['finance.accountability', ['finance.reports', 'finance.otherAssets', 'finance.deadlines', 'finance.fundUse']],
    ]);
  });

  it('„Lastschrift“ nach „Offene Zahlungen“: fest nur mit finance.directDebit, eingeschaltet auch für Lesende (Handoff 2a § 1)', () => {
    const entries = (permissions: string[], enabled: boolean) =>
      sectionsFor(
        buildNavigation({
          manifests: [coreModule, financeModule],
          enabledKeys: new Set(['core', 'finance']),
          permissions: new Set(permissions),
          extraItems: enabled ? { finance: [{ key: 'finance.directDebit', href: '/finance/direct-debit', icon: 'euro', group: 'finance', section: 'finance.entries', permission: ['finance.read', 'finance.directDebit'] }] } : {},
        }),
        '/finance/entries',
      ).find((s) => s.key === 'finance.entries')!.items.map((i) => i.href);
    expect(entries(['finance.read'], false)).toEqual(['/finance/entries', '/finance/open-items', '/finance/accounts', '/finance/cash']);
    expect(entries(['finance.read', 'finance.directDebit'], false)).toEqual(['/finance/entries', '/finance/open-items', '/finance/direct-debit', '/finance/accounts', '/finance/cash']);
    expect(entries(['finance.read'], true)).toEqual(['/finance/entries', '/finance/open-items', '/finance/direct-debit', '/finance/accounts', '/finance/cash']);
  });

  it('„Umsatzsteuer“ nach „Steuererklärung“ nur, wenn der Verein Unternehmer ist (Plan E6b Task 8)', () => {
    const accountability = (entrepreneur: boolean) =>
      sectionsFor(
        buildNavigation({
          manifests: [coreModule, financeModule],
          enabledKeys: new Set(['core', 'finance']),
          permissions: new Set(['finance.read']),
          extraItems: entrepreneur ? { finance: [{ key: 'finance.vat', href: '/finance/vat', icon: 'euro', group: 'finance', section: 'finance.accountability', permission: 'finance.read' }] } : {},
        }),
        '/finance/tax',
      ).find((s) => s.key === 'finance.accountability')!.items.map((i) => i.href);
    expect(accountability(false)).not.toContain('/finance/vat');
    const withVat = accountability(true);
    expect(withVat.indexOf('/finance/vat')).toBe(withVat.indexOf('/finance/tax') + 1);
  });
});
