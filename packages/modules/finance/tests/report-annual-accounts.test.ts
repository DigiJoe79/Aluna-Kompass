import { newId, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { addContactRole, createContact } from '@kompass/module-contacts';
import { createProject, setProjectPublished } from '@kompass/module-projects';
import { runFinanceReport } from '../src/reporting/service';
import { endowmentAtInternal } from '../src/ledger/endowment';
import { saveAnnualAccountsExplanation } from '../src/reporting/annual-accounts-notes';
import { finalizeFinanceReport, releaseReportsForFinalizing } from '../src/reporting/finalize';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createCategory } from '../src/ledger/categories';
import { bookEntry } from '../src/ledger/finalize';
import { incomeStatement } from '../src/ledger/queries';
import { computeAnnualAccounts, type AnnualAccounts } from '../src/reporting/reports/annual-accounts';
import { computeCashReport } from '../src/reporting/reports/cash-report';
import { financeCategories, financeExpenseClaims } from '../src/schema';
import { fileAccountStatementDocument } from '../src/ledger/statement-documents';
import { ledgerFixture, pdfBytes } from './helpers';

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;
const env = { settings: {} };
const category = (f: Fixture, key: string) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!;
const book = (f: Fixture, date: string, key: string, cents: number, line: Record<string, unknown> = {}, entry: Record<string, unknown> = {}) =>
  bookEntry(f.deps, f.ctx, { ...entry, entryDate: date, text: key, moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId: category(f, key).id, amountCents: cents, taxCode: 'none', ...line }] }).then(unwrap);
const newProject = async (f: Fixture, slug: string, name = 'Testprojekt') =>
  unwrap(await createProject(f.deps, ctxWith(['projects.manage']), { slug, name: { de: name }, type: 'ongoing' as const, summary: { de: '' }, body: { de: '' } }));
const row = (data: AnnualAccounts, key: string) => data.income.rows.find((r) => r.row === key);

async function twoYears() {
  const f = await ledgerFixture({ years: ['2025', '2026'] });
  const y2025 = f.years['2025']!.id;
  const y2026 = f.years['2026']!.id;
  await book(f, '2025-05-01', 'donations', 20000);
  await book(f, '2025-06-01', 'program-costs', -5000);
  await book(f, '2026-03-01', 'donations', 30000);
  await book(f, '2026-03-02', 'membership-fees', 6000);
  await book(f, '2026-03-03', 'interest', 300);
  await book(f, '2026-03-04', 'sales', 4000);
  await book(f, '2026-03-05', 'program-costs', -9000);
  await book(f, '2026-03-06', 'website-pr', -1500);
  await book(f, '2026-03-07', 'office', -1000);
  await book(f, '2026-03-08', 'asset-costs', -200);
  await book(f, '2026-03-09', 'business-costs', -700);
  await book(f, '2026-03-10', 'partner-transfers', -2000);
  return { f, y2025, y2026 };
}

describe('Jahresrechnung F1–F4 (J1 Task 5)', () => {
  it('geht auf: F2 = F4-Einnahmen = EÜR, F3 = F4-Ausgaben = EÜR', async () => {
    const { f, y2026 } = await twoYears();
    const data = computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env);
    const plain = incomeStatement(f.deps.db, { from: '2026-01-01', to: '2026-12-31' });
    const incomeRows = data.income.rows.reduce((s, r) => s + r.cents, 0);
    expect([incomeRows, data.income.total.cents, data.result.incomeCents]).toEqual([plain.totalIncomeCents, plain.totalIncomeCents, plain.totalIncomeCents]);
    const e = data.expense;
    expect(e.program.total.cents + e.fundraising.cents + e.administration.cents + e.assetManagement.cents + e.business.cents).toBe(plain.totalExpenseCents);
    expect([e.total.cents, data.result.expenseCents]).toEqual([plain.totalExpenseCents, plain.totalExpenseCents]);
    expect(data.result.resultCents).toBe(plain.resultCents);
    expect(data.income.bySphere.reduce((s, r) => s + r.cents, 0)).toBe(plain.totalIncomeCents);
    expect(e.program.projects.reduce((s, p) => s + p.cents, 0)).toBe(e.program.total.cents);
  });

  it('rechnet Anteile, Vorjahr, Kennzahl und „Cent je Euro“ ohne VV und wGB', async () => {
    const { f, y2026 } = await twoYears();
    const data = computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env);
    expect(row(data, 'cashDonations')).toEqual({ row: 'cashDonations', cents: 30000, previousCents: 20000, sharePermille: Math.round((30000 * 1000) / 40300) });
    expect(row(data, 'revenue')).toMatchObject({ cents: 4000 });
    expect(row(data, 'assetManagement')).toMatchObject({ cents: 300 });
    const e = data.expense;
    expect(e.program.total).toMatchObject({ cents: 11000, previousCents: 5000 });
    expect(e.program.partnerForwarding.cents).toBe(2000);
    expect(e.program.auxiliaries.cents).toBe(0);
    expect([e.fundraising.cents, e.administration.cents, e.assetManagement.cents, e.business.cents]).toEqual([1500, 1000, 200, 700]);
    expect(e.idealAndPurposeTotal.cents).toBe(13500);
    expect(data.ratios.overheadPermille).toBe(Math.round((2500 * 1000) / 13500));
    expect(data.glance).toMatchObject({ incomeCents: 40300, expenseCents: 14400, resultCents: 25900, programCentsPerEuro: Math.round((11000 * 100) / 13500) });
    expect(data.result.previous).toEqual({ incomeCents: 20000, expenseCents: 5000, resultCents: 15000 });
    expect(data.result.probe).toEqual(computeCashReport(f.deps.db, { fiscalYearId: y2026 }, env).probe);
  });

  it('lässt eine Ausgabe im wGB mit Werbung aus der Quote', async () => {
    const { f, y2026 } = await twoYears();
    const before = computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env).ratios.overheadPermille;
    const ad = unwrap(await createCategory(f.deps, f.ctx, { key: 'business-ads', name: 'Werbung Verkauf', direction: 'expense', sphere: 'business', costFunction: 'fundraising' }));
    await bookEntry(f.deps, f.ctx, { entryDate: '2026-04-01', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: -800 }], allocationLines: [{ categoryId: ad.id, amountCents: -800, taxCode: 'none' }] }).then(unwrap);
    const after = computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env);
    expect(after.ratios.overheadPermille).toBe(before);
    expect(after.expense.business.cents).toBe(1500);
  });

  it('zeigt Geldauflagen nur, wenn es welche gibt', async () => {
    const { f, y2026 } = await twoYears();
    expect(row(computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env), 'courtFines')).toBeUndefined();
    await book(f, '2026-05-01', 'court-fines', 1000);
    expect(row(computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env), 'courtFines')).toMatchObject({ cents: 1000, previousCents: 0 });
  });

  it('hat im ersten Jahr kein Vorjahr — überall null, Anteil trotzdem', async () => {
    const { f, y2025 } = await twoYears();
    const data = computeAnnualAccounts(f.deps.db, { fiscalYearId: y2025 }, env);
    expect(data.previous).toBeNull();
    expect(data.result.previous).toBeNull();
    const amounts = [...data.income.rows, ...data.income.bySphere, data.income.total, ...data.expense.program.projects, data.expense.program.total, data.expense.fundraising, data.expense.administration, data.expense.total];
    expect(amounts.every((a) => a.previousCents === null)).toBe(true);
    expect(row(data, 'cashDonations')!.sharePermille).toBe(1000);
  });

  it('mindert die Zeile um einen Rückläufer, auch ins Negative — kein Absturz', async () => {
    const { f, y2026 } = await twoYears();
    await book(f, '2026-06-01', 'membership-fees', -8000);
    const data = computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env);
    expect(row(data, 'membershipFees')).toMatchObject({ cents: -2000 });
    expect(row(data, 'membershipFees')!.sharePermille).toBeLessThan(0);
    expect(data.income.rows.reduce((s, r) => s + r.cents, 0)).toBe(data.income.total.cents);
  });

  it('summiert zwei Plattform-Kategorien in „davon über Spendenplattformen“', async () => {
    const { f, y2026 } = await twoYears();
    expect(computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env).income.viaPlatforms).toBeNull();
    const handles = unwrap(await createCategory(f.deps, f.ctx, { key: 'platform-two', name: 'Plattform zwei', direction: 'income', sphere: 'ideal', incomeKind: 'donation', donationPlatform: 'handlesOnly' }));
    await book(f, '2026-07-01', 'platform-payouts', 2500);
    await bookEntry(f.deps, f.ctx, { entryDate: '2026-07-02', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: 1500 }], allocationLines: [{ categoryId: handles.id, amountCents: 1500, taxCode: 'none' }] }).then(unwrap);
    const data = computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env);
    expect(data.income.viaPlatforms).toMatchObject({ cents: 4000, previousCents: 0 });
    expect(row(data, 'cashDonations')!.cents).toBe(34000);
    expect(row(data, 'otherOrganizations')!.cents).toBe(0);
  });

  it('zählt einen Aufwandsverzicht nur mit bestandener Prüfung zu den Geldspenden', async () => {
    const { f, y2026 } = await twoYears();
    const passed = await book(f, '2026-08-01', 'expense-waivers', 700, { contactId: f.donor.id });
    await book(f, '2026-08-02', 'expense-waivers', 300, { contactId: f.donor.id });
    const now = '2026-08-01T10:00:00.000Z';
    f.deps.db.insert(financeExpenseClaims).values({ id: newId(), contactId: f.donor.id, submittedByUserId: f.userId, createdAt: now, updatedAt: now, state: 'approved', waiver: true, waiverSignedDocumentId: 'DOC', entryId: passed.id }).run();
    const data = computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env);
    expect(row(data, 'cashDonations')!.cents).toBe(30700);
    expect(row(data, 'other')!.cents).toBe(300);
  });

  it('führt Programmausgaben je Projekt, ohne Projekt als null', async () => {
    const { f, y2026 } = await twoYears();
    const project = await newProject(f, 'hilfe');
    await book(f, '2026-09-01', 'program-costs', -400, { projectId: project.id });
    const data = computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env);
    expect(data.expense.program.projects.map((p) => [p.projectId, p.cents])).toEqual([
      [null, 11000],
      [project.id, 400],
    ]);
  });
});

const contactCtx = ctxWith(['contacts.view', 'contacts.manage']);
const person = async (f: Fixture, firstName: string) => unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName, lastName: 'Beispiel' }));
const boardMember = async (f: Fixture, firstName: string) => {
  const c = await person(f, firstName);
  unwrap(await addContactRole(f.deps, contactCtx, { id: c.id, role: 'board-member', since: '2025-01-01' }));
  return c;
};

describe('Jahresrechnung F5–F9 und Hinweise der Bildschirmansicht (J1 Task 6)', () => {
  it('F5: Konten wie Endbestand des Kassenberichts, Reinvermögen mit offenen Posten und sonstigen Werten, § 62 Abs. 3 heraus', async () => {
    const { f, y2026 } = await twoYears();
    await book(f, '2026-04-01', 'inheritances', 5000);
    const data = computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env);
    const cash = computeCashReport(f.deps.db, { fiscalYearId: y2026 }, env);
    const a = data.assets;
    expect(a.accountsCents).toBe(cash.probe.closingCents);
    expect(a.accounts.reduce((s, x) => s + x.cents, 0)).toBe(a.accountsCents);
    expect(a.accounts.map((x) => x.kind)).toContain('bank');
    expect(a.netAssetsCents).toBe(cash.probe.closingCents + a.receivablesCents - a.payablesCents + a.otherAssetsCents - a.otherLiabilitiesCents);
    expect(a.endowmentCents).toBe(5000);
    expect(a.remainingCents).toBe(a.netAssetsCents - a.earmarkedCents - a.reserves.reduce((s, r) => s + r.cents, 0) - a.endowmentCents);
    expect(data.glance.netAssetsCents).toBe(a.netAssetsCents);
  });

  it('F6: je Projekt Einnahmen, Ausgaben und Zweckbestand, nur IDs', async () => {
    const { f, y2026 } = await twoYears();
    const project = await newProject(f, 'hilfe');
    await book(f, '2026-09-01', 'program-costs', -400, { projectId: project.id });
    await book(f, '2026-09-02', 'donations', 900, { projectId: project.id });
    const data = computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env);
    expect(data.projects).toEqual([{ projectId: project.id, incomeCents: 900, expenseCents: 400, purposeClosingCents: 0 }]);
  });

  it('F7: Vergütungen nur an den Vorstand, je Art Empfänger, Summe erst ab drei', async () => {
    const { f, y2026 } = await twoYears();
    const kinds = () => computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env).remuneration;
    expect(kinds()).toEqual([
      { kind: 'remuneration', recipients: 0, amountCents: null },
      { kind: 'volunteerAllowance', recipients: 0, amountCents: null },
    ]);
    const one = await boardMember(f, 'Anna');
    await book(f, '2026-05-01', 'volunteer-allowance', -300, { contactId: one.id }, { reason: 'Beschluss folgt' });
    // Nahestehende und Auslagen gegen Beleg zählen nicht.
    const near = await person(f, 'Nora');
    unwrap(await addContactRole(f.deps, contactCtx, { id: near.id, role: 'related-party', since: '2025-01-01' }));
    await book(f, '2026-05-02', 'volunteer-allowance', -300, { contactId: near.id });
    await book(f, '2026-05-03', 'travel', -120, { contactId: one.id });
    expect(kinds()[1]).toEqual({ kind: 'volunteerAllowance', recipients: 1, amountCents: null });
    const two = await boardMember(f, 'Bert');
    const three = await boardMember(f, 'Clara');
    await book(f, '2026-05-04', 'volunteer-allowance', -200, { contactId: two.id }, { reason: 'Beschluss folgt' });
    await book(f, '2026-05-05', 'volunteer-allowance', -100, { contactId: three.id }, { reason: 'Beschluss folgt' });
    expect(kinds()[1]).toEqual({ kind: 'volunteerAllowance', recipients: 3, amountCents: 600 });
    expect(computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env).remunerationWithoutBasis).toBe(3);
    const allowed = { settings: { 'finance.boardRemunerationAllowed': true, 'finance.boardRemunerationValidFrom': '2020-01-01' } };
    expect(computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, allowed).remunerationWithoutBasis).toBe(0);
  });

  it('F7: eine zurückgebuchte Pauschale zählt nicht als Vergütung und verlangt keine Bestätigung', async () => {
    const { f, y2026 } = await twoYears();
    const one = await boardMember(f, 'Anna');
    await book(f, '2026-05-01', 'volunteer-allowance', -300, { contactId: one.id }, { reason: 'Irrtum' });
    await book(f, '2026-05-20', 'volunteer-allowance', 300, { contactId: one.id }, { reason: 'Rückbuchung' });
    const data = computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env);
    expect(data.remuneration[1]).toEqual({ kind: 'volunteerAllowance', recipients: 0, amountCents: null });
    expect(data.remunerationWithoutBasis).toBe(0);
  });

  it('F8: Zuwender über 10 % mit Bandbreite, genau 10 % nicht, Plattform markiert', async () => {
    const { f, y2026 } = await twoYears();
    // Einnahmen bisher 40.300; dazu 10.000 (Org) + 7.000 (Person) + 2.500 (Plattform) = 59.800.
    const org = unwrap(await createContact(f.deps, contactCtx, { kind: 'organization', name: 'Stiftung Beispiel' }));
    const donorPerson = await person(f, 'Erika');
    const platform = unwrap(await createContact(f.deps, contactCtx, { kind: 'organization', name: 'Plattform Beispiel' }));
    await book(f, '2026-06-01', 'body-grants', 10000, { contactId: org.id });
    await book(f, '2026-06-02', 'donations', 5980, { contactId: donorPerson.id });
    await book(f, '2026-06-03', 'membership-fees', 1020, { contactId: donorPerson.id });
    await book(f, '2026-06-04', 'platform-payouts', 2500, { contactId: platform.id });
    const total = 59800;
    expect(computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env).income.total.cents).toBe(total);
    let major = computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env).majorDonors;
    expect(major.map((m) => [m.contactId, m.amountCents, m.bandFromPercent, m.platform])).toEqual([
      [org.id, 10000, 10, false],
      [donorPerson.id, 7000, 10, false],
    ]);
    expect(major[0]!.sharePermille).toBe(Math.round((10000 * 1000) / total));
    // Die Plattform über 10 % steht mit Kennzeichen da.
    await book(f, '2026-06-05', 'platform-payouts', 4220, { contactId: platform.id });
    major = computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env).majorDonors;
    // 6.720 von 64.020 ≈ 10,5 % → dabei, als Plattform.
    expect(major.find((m) => m.contactId === platform.id)).toMatchObject({ platform: true, bandFromPercent: 10 });
  });

  it('F8: genau 10 % ist nicht dabei; ohne Treffer leer', async () => {
    const f = await ledgerFixture({ years: ['2026'] });
    const y = f.years['2026']!.id;
    expect(computeAnnualAccounts(f.deps.db, { fiscalYearId: y }, env).majorDonors).toEqual([]);
    const donorPerson = await person(f, 'Erika');
    await book(f, '2026-03-01', 'donations', 9000);
    await book(f, '2026-03-02', 'donations', 1000, { contactId: donorPerson.id });
    expect(computeAnnualAccounts(f.deps.db, { fiscalYearId: y }, env).majorDonors).toEqual([]);
  });

  it('F9: Erläuterung, Begründung der Freigabe ohne Prüfbericht, Kassenbericht mit Nummer', async () => {
    const { f, y2025 } = await twoYears();
    f.closeYear(y2025);
    unwrap(await saveAnnualAccountsExplanation(f.deps, f.ctx, { fiscalYearId: y2025, text: 'Ein Jahr.' }));
    expect(computeAnnualAccounts(f.deps.db, { fiscalYearId: y2025 }, env).notes).toEqual({ explanation: 'Ein Jahr.', audit: null, cashReport: null });
    unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'oralReport', note: null }));
    unwrap(await fileAccountStatementDocument(f.deps, f.ctx, { accountId: f.bank.id, periodTo: '2025-12-31', bytes: pdfBytes() }));
    const cash = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'cashReport', params: { fiscalYearId: y2025 } }));
    const notes = computeAnnualAccounts(f.deps.db, { fiscalYearId: y2025 }, env).notes;
    expect(notes.audit).toEqual({ basis: 'oralReport', auditReportFiledOn: null });
    expect(notes.cashReport).toEqual({ documentNumber: cash.documentNumber, finalizedOn: '2026-09-05' });
  });

  it('screen: „übrige Satzungsarbeit“ zählt wie das PDF — ohne Projekt plus nicht publizierte Projekte (Abnahme B1 Nachzug 1)', async () => {
    const f = await ledgerFixture({ years: ['2026'] });
    const y = f.years['2026']!.id;
    const hidden = await newProject(f, 'intern', 'Intern');
    const shown = await newProject(f, 'offen', 'Offen');
    unwrap(await setProjectPublished(f.deps, ctxWith(['projects.manage']), { id: shown.id, isPublished: true }));
    await book(f, '2026-03-01', 'donations', 20000);
    await book(f, '2026-03-02', 'program-costs', -2000);
    await book(f, '2026-03-03', 'program-costs', -3000, { projectId: hidden.id });
    await book(f, '2026-03-04', 'program-costs', -5000, { projectId: shown.id });
    const over25 = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'annualAccounts', params: { fiscalYearId: y } })).data as AnnualAccounts;
    expect(over25.screen.over25).toEqual([{ section: 'expense', key: 'project:none', sharePermille: 500 }]);
  });

  it('screen: Posten über 25 %, Verlust im wGB, Kostenquote nach AEAO und Überleitung zur Anlage Gem', async () => {
    const { f, y2026 } = await twoYears();
    const sale = unwrap(await createCategory(f.deps, f.ctx, { key: 'asset-sale', name: 'Verkauf Anlage', direction: 'income', sphere: 'ideal', incomeKind: 'other', isAssetSale: true }));
    await bookEntry(f.deps, f.ctx, { entryDate: '2026-04-01', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: 700 }], allocationLines: [{ categoryId: sale.id, amountCents: 700, taxCode: 'none' }] }).then(unwrap);
    const s = computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env).screen;
    // Joe 2026-10-28 (Bildabnahme 0.4.5 (a)): nur Sammelposten — Geldspenden über 25 % lösen keinen Hinweis aus;
    // „übrige Satzungsarbeit“ kommt erst in der Ausgabe dazu (publizierte Projekte, nicht im Hash, Test oben).
    expect(s.over25.map((o) => `${o.section}:${o.key}`)).toEqual([]);
    expect(s.operationsLoss).toEqual([]);
    expect(s.aeaoCostRatio).toMatchObject({ costsCents: 2500 });
    expect(s.gemReconciliation).toMatchObject({ incomeCents: 41000, assetSalesCents: 700, taxRefundsCents: 0, gemLine9Cents: 40300, differenceCents: 0 });
    await book(f, '2026-04-02', 'business-costs', -5000);
    expect(computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env).screen.operationsLoss).toEqual(['business']);
    // „Sonstiges“ ist ein Sammelposten: über 25 % der Einnahmen ein Hinweis.
    await bookEntry(f.deps, f.ctx, { entryDate: '2026-04-03', text: 'y', moneyLines: [{ accountId: f.bank.id, amountCents: 30000 }], allocationLines: [{ categoryId: sale.id, amountCents: 30000, taxCode: 'none' }] }).then(unwrap);
    expect(computeAnnualAccounts(f.deps.db, { fiscalYearId: y2026 }, env).screen.over25.map((o) => `${o.section}:${o.key}`)).toContain('income:other');
  });
});

describe('endowmentAtInternal', () => {
  it('summiert Zuführungen zum Vermögen bis zum Stichtag', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    await book(f, '2025-04-01', 'inheritances', 3000);
    await book(f, '2026-04-01', 'inheritances', 2000);
    expect(endowmentAtInternal(f.deps.db, '2025-12-31')).toBe(3000);
    expect(endowmentAtInternal(f.deps.db, '2026-12-31')).toBe(5000);
    expect(endowmentAtInternal(f.deps.db, '2025-03-31')).toBe(0);
  });
});
