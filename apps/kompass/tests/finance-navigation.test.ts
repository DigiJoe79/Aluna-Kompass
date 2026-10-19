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
    ]);
  });

  it('Gruppen ohne sichtbaren Eintrag fallen samt Kopf weg', () => {
    const at = (permissions: string[], path: string) =>
      sectionsFor(buildNavigation({ manifests: [coreModule, financeModule], enabledKeys: new Set(['core', 'finance']), permissions: new Set(permissions) }), path).map((s) => [s.key, s.items.map((i) => i.key)]);
    expect(at(['finance.expensesSubmit', 'finance.approve'], '/finance/expenses')).toEqual([['finance.expenses', ['finance.expenses', 'finance.approvals']]]);
    expect(at(['finance.overview', 'finance.expensesSubmit'], '/finance/expenses')).toEqual([
      ['finance.allocation', ['finance.purposes']],
      ['finance.expenses', ['finance.expenses']],
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
});
