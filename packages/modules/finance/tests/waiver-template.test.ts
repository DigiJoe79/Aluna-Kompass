import type { DocumentRenderContext } from '@kompass/core';
import { DEFAULT_THEME } from '@kompass/core/themes';
import { describe, expect, it } from 'vitest';
import { waiverDeclarationTemplate } from '../src/allocation/templates/waiver-declaration';
import { financeModule } from '../src/manifest';

/** F8a Task 3 — die Verzichtserklärung als Modul-Vorlage (Annahme 10): kein Mustertext, mit Unterschriftsfeld. */
const ctx: DocumentRenderContext = { number: 'VZE-2026-001', issuedAt: '2026-09-05T12:00:00.000Z', organization: { 'organization.name': 'Musterverein e.V.' }, theme: DEFAULT_THEME, logo: null };

const input = {
  organization: { name: 'Musterverein e.V.', addressLines: ['Musterweg 1', '12345 Musterstadt'] },
  claimant: { name: 'Hanna Helferin', addressLines: ['Beispielstraße 7', '54321 Beispielstadt'] },
  claimNumber: 'KE-2026-001',
  amountCents: 4519,
  basisText: 'Satzung § 7 Abs. 2',
  agreedOn: '2026-01-02',
  declaredOn: '2026-09-05',
  place: 'Musterstadt',
};

function build(data: unknown) {
  const parsed = waiverDeclarationTemplate.schema.safeParse(data);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  const built = waiverDeclarationTemplate.build(parsed.data, ctx);
  return 'typst' in built.body ? built.body.typst : '';
}

describe('waiver declaration template', () => {
  it('is registered as a filed form under finance.approve for the type VZE', () => {
    const registered = (financeModule.documentTemplates ?? []).find((t) => t.key === 'finance-waiver-declaration');
    expect(registered).toMatchObject({ type: 'finance-waiver-declaration', base: 'a4-formular', permission: 'finance.approve' });
    expect(registered!.filed).not.toBe(false);
  });

  it('prints number, amount, basis, agreement date, the claimant and a signature line', () => {
    const typst = build(input);
    for (const text of ['KE-2026-001', '45,19 €', 'Satzung § 7 Abs. 2', '02.01.2026', 'Hanna Helferin', 'Beispielstraße 7', 'Musterstadt, 05.09.2026', 'Unterschrift', 'Verzichtserklärung']) expect(typst, text).toContain(text);
  });

  it('leaves the agreement date out when the basis has none, and escapes free text', () => {
    const typst = build({ ...input, agreedOn: null, claimant: { name: 'Hanna "#Helferin"', addressLines: [] }, basisText: 'Satzung $ 7' });
    expect(typst).not.toContain('vereinbart am');
    expect(typst).toContain('\\"#Helferin\\"');
    expect(typst).toContain('#"Satzung $ 7";');
  });

  it('refuses an input without basis or with a zero amount', () => {
    expect(waiverDeclarationTemplate.schema.safeParse({ ...input, basisText: '' }).success).toBe(false);
    expect(waiverDeclarationTemplate.schema.safeParse({ ...input, amountCents: 0 }).success).toBe(false);
  });
});
