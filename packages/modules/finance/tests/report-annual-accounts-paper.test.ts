import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { createProject, setProjectPublished } from '@kompass/module-projects';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { saveContactTaxDetails } from '../src/allocation/contact-tax-details';
import { recordNameConsent } from '../src/allocation/name-consents';
import { createAccount } from '../src/ledger/accounts';
import { bookEntry } from '../src/ledger/finalize';
import { renderContextInternal, releaseReportsForFinalizing } from '../src/reporting/finalize';
import { annualAccountsReport } from '../src/reporting/reports/annual-accounts';
import { annualAccountsTypst } from '../src/reporting/reports/annual-accounts-typst';
import type { AnnualAccounts } from '../src/reporting/reports/annual-accounts';
import { financeCategories } from '../src/schema';
import { ledgerFixture } from './helpers';

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;
const env = { settings: {} };
const contactCtx = ctxWith(['contacts.view', 'contacts.manage']);
const category = (f: Fixture, key: string) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!;
const book = (f: Fixture, date: string, key: string, cents: number, line: Record<string, unknown> = {}, accountId = f.bank.id) =>
  bookEntry(f.deps, f.ctx, { entryDate: date, text: key, moneyLines: [{ accountId, amountCents: cents }], allocationLines: [{ categoryId: category(f, key).id, amountCents: cents, taxCode: 'none', ...line }] }).then(unwrap);

/** Das Papier wie beim Rendern: Daten, Beschriftungen, und was `prepareRender` außerhalb des Hashs beisteuert. */
async function paper(f: Fixture, fiscalYearId: string, over: Partial<AnnualAccounts> = {}) {
  const data = { ...annualAccountsReport.compute(f.deps.db, { fiscalYearId }, env), ...over };
  const extra = await annualAccountsReport.prepareRender!(f.deps, data, {});
  return annualAccountsTypst(data, { ...renderContextInternal(f.deps), extra });
}

async function scene() {
  const f = await ledgerFixture({ years: ['2025', '2026'] });
  const y2025 = f.years['2025']!.id;
  const y2026 = f.years['2026']!.id;
  const org = unwrap(await createContact(f.deps, contactCtx, { kind: 'organization', name: 'Stiftung Sonnenschein' }));
  const unknownOrg = unwrap(await createContact(f.deps, contactCtx, { kind: 'organization', name: 'Malerbetrieb Klecks GbR' }));
  const privatePerson = unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: 'Petra', lastName: 'Privatier' }));
  unwrap(await saveContactTaxDetails(f.deps, f.ctx, { contactId: org.id, legalEntity: 'yes' }));
  const hidden = unwrap(await createProject(f.deps, ctxWith(['projects.manage']), { slug: 'geheim', name: { de: 'Geheimprojekt' }, type: 'ongoing' as const, summary: { de: '' }, body: { de: '' } }));
  const shown = unwrap(await createProject(f.deps, ctxWith(['projects.manage']), { slug: 'offen', name: { de: 'Offenes Projekt' }, type: 'ongoing' as const, summary: { de: '' }, body: { de: '' } }));
  unwrap(await setProjectPublished(f.deps, ctxWith(['projects.manage']), { id: shown.id, isPublished: true }));
  const named = unwrap(await createAccount(f.deps, f.ctx, { name: 'Handkasse Hildegard Huber', kind: 'cash' }));
  await book(f, '2025-03-01', 'donations', 10000);
  await book(f, '2026-03-01', 'donations', 10000);
  await book(f, '2026-03-02', 'body-grants', 6000, { contactId: org.id });
  await book(f, '2026-03-03', 'body-grants', 5000, { contactId: unknownOrg.id });
  await book(f, '2026-03-04', 'donations', 4000, { contactId: privatePerson.id });
  await book(f, '2026-03-05', 'program-costs', -700, { projectId: hidden.id });
  await book(f, '2026-03-06', 'program-costs', -900, { projectId: shown.id });
  await book(f, '2026-03-07', 'donations', 50, {}, named.id);
  return { f, y2025, y2026, org, unknownOrg, privatePerson, hidden, shown };
}

describe('Papier der Jahresrechnung (J1 Task 7)', () => {
  it('hat ohne Vorjahr keine Spalte „Vorjahr“, mit Vorjahr schon', async () => {
    const { f, y2025, y2026 } = await scene();
    expect(await paper(f, y2025)).not.toContain('Vorjahr');
    expect(await paper(f, y2026)).toContain('Vorjahr');
  });

  it('nennt in F8 nur juristische Personen und Eingewilligte, sonst die Bandbreite', async () => {
    const { f, y2026, privatePerson } = await scene();
    let text = await paper(f, y2026);
    expect(text).toContain('Stiftung Sonnenschein');
    expect(text).not.toContain('Malerbetrieb Klecks');
    expect(text).not.toContain('Privatier');
    expect(text).toContain('Großspende einer Privatperson');
    expect(text).toContain('10–20 % der Einnahmen');
    unwrap(await recordNameConsent(f.deps, f.ctx, { kind: 'granted', contactId: privatePerson.id, on: '2026-09-01', fromYear: 2026 }));
    text = await paper(f, y2026);
    expect(text).toContain('Petra Privatier');
  });

  it('nennt nur veröffentlichte Projekte; der Rest steht als „übrige Satzungsarbeit“', async () => {
    const { f, y2026 } = await scene();
    const text = await paper(f, y2026);
    expect(text).toContain('Offenes Projekt');
    expect(text).not.toContain('Geheimprojekt');
    expect(text).toContain('übrige Satzungsarbeit');
  });

  it('sagt „publiziert“, nicht „veröffentlicht“ (MUSTER, Bildabnahme 0.4.5 T-1)', async () => {
    const { f, y2026 } = await scene();
    const text = await paper(f, y2026);
    expect(text).toContain('Mit Namen erscheinen nur publizierte Projekte');
    expect(text).not.toMatch(/veröffentlicht/i);
  });

  it('F7: Wörter stehen nicht in einer Spalte „in €“ (Bildabnahme 0.4.5 T-2)', async () => {
    const { f, y2026 } = await scene();
    const f7 = (t: string) => t.slice(t.indexOf('F7 Kennzahlen'), t.indexOf('F8 '));
    const none = f7(await paper(f, y2026, { remuneration: [{ kind: 'remuneration', recipients: 0, amountCents: null }, { kind: 'volunteerAllowance', recipients: 0, amountCents: null }] }));
    expect(none).not.toContain('in €');
    expect(none).not.toContain('keine Vergütung');
    expect(none).toContain('[#"keine";]');
    const paid = f7(await paper(f, y2026, { remuneration: [{ kind: 'remuneration', recipients: 3, amountCents: 120000 }, { kind: 'volunteerAllowance', recipients: 1, amountCents: null }] }));
    expect(paid).toContain('Betrag in € bzw. Angabe');
    expect(paid).toContain('[#"gezahlt";]');
  });

  it('nennt Konten nur nach Art, nie mit Bezeichnung oder IBAN', async () => {
    const { f, y2026 } = await scene();
    const text = await paper(f, y2026);
    expect(text).not.toContain('Hildegard');
    expect(text).not.toContain('Vereinskonto');
    expect(text).toContain('Barkasse');
    expect(text).toContain('Bankkonto');
    expect(text).not.toMatch(/DE23\s?9999/);
  });

  it('liest die Hinweise der Bildschirmansicht nie', async () => {
    const { f, y2026 } = await scene();
    const base = annualAccountsReport.compute(f.deps.db, { fiscalYearId: y2026 }, env);
    const other: AnnualAccounts['screen'] = { over25: [{ section: 'income', key: 'other', sharePermille: 999 }], operationsLoss: ['business'], aeaoCostRatio: { costsCents: 1, revenueCents: 2, permille: 3 }, gemReconciliation: { incomeCents: 4, assetSalesCents: 5, taxRefundsCents: 6, gemLine9Cents: 7, differenceCents: 8 } };
    expect(await paper(f, y2026, { screen: other })).toBe(await paper(f, y2026, { screen: base.screen }));
  });

  it('nennt die Prüfung mit festem Text je Begründung, nie den Freitext', async () => {
    const { f, y2025 } = await scene();
    f.closeYear(y2025);
    unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'other', note: 'Prüferin Zarah war verreist' }));
    const text = await paper(f, y2025);
    expect(text).toContain('Ohne schriftlichen Prüfbericht festgeschrieben.');
    expect(text).not.toContain('Zarah');
    expect(text).toContain('Noch nicht abgezeichnet.');
  });

  it('beschriftet eine Plattform ohne Namen nur einmal', async () => {
    const { f, y2026 } = await scene();
    const platform = unwrap(await createContact(f.deps, contactCtx, { kind: 'organization', name: 'Plattform Ohnename' }));
    await book(f, '2026-04-01', 'platform-payouts', 20000, { contactId: platform.id });
    const text = await paper(f, y2026);
    expect(text).not.toContain('Ohnename');
    expect(text).toContain('Spendenplattform; leitet Spenden vieler Einzelspender weiter');
    expect(text).not.toContain('Spendenplattform (Spendenplattform');
  });

  it('setzt die Erläuterung als Absatz, leer ohne', async () => {
    const { f, y2026 } = await scene();
    const { saveAnnualAccountsExplanation } = await import('../src/reporting/annual-accounts-notes');
    expect(await paper(f, y2026)).not.toContain('Ein besonderes Jahr');
    unwrap(await saveAnnualAccountsExplanation(f.deps, f.ctx, { fiscalYearId: y2026, text: 'Ein **besonderes** Jahr.' }));
    expect(await paper(f, y2026)).toContain('besonderes');
  });

describe('Rücklagen in F5 (Abnahme M1)', () => {
  it('nennt jede Art einmal und gleich geformt, ohne doppeltes „Rücklage“', async () => {
    const f = await ledgerFixture({ years: ['2026'] });
    const reserves = [
      { kind: 'projectFunds', cents: 100 }, { kind: 'replacement', cents: 200 }, { kind: 'free', cents: 300 },
      { kind: 'participation', cents: 400 }, { kind: 'business', cents: 500 }, { kind: 'assetManagement', cents: 600 },
    ] as AnnualAccounts['assets']['reserves'];
    const base = annualAccountsReport.compute(f.deps.db, { fiscalYearId: f.year.id }, env);
    const body = await paper(f, f.year.id, { assets: { ...base.assets, reserves } });
    expect(body).not.toContain('Rücklage: ');
    for (const text of [
      'Rücklage für Projekte und Betrieb (§ 62 Abs. 1 Nr. 1 AO)',
      'Rücklage für Wiederbeschaffung (§ 62 Abs. 1 Nr. 2 AO)',
      'Freie Rücklage (§ 62 Abs. 1 Nr. 3 AO)',
      'Rücklage für Beteiligungen (§ 62 Abs. 1 Nr. 4 AO)',
      'Rücklage im wirtschaftlichen Geschäftsbetrieb (AEAO zu § 55 Nr. 3 und Nr. 28)',
      'Rücklage in der Vermögensverwaltung (AEAO zu § 55 Nr. 3 und Nr. 28)',
    ]) expect(body).toContain(text);
  });
});
});
