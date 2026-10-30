import { unwrap, writeSettingInternal } from '@kompass/core';
import { ctxWith, insertUser, systemContext } from '@kompass/core/testing';
import { contactRoles, contacts } from '@kompass/module-contacts';
import { createProject } from '@kompass/module-projects';
import { and, eq, isNull } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { installFinance } from '../src/install';
import { annualAccountsExplanationInternal } from '../src/reporting/annual-accounts-notes';
import { annualAccountsNamingInternal } from '../src/reporting/annual-accounts-naming';
import { computeAnnualAccounts } from '../src/reporting/reports/annual-accounts';
import { computeCashReport } from '../src/reporting/reports/cash-report';
import { incomeStatement } from '../src/ledger/queries';
import { fiscalYearStatusInternal } from '../src/ledger/fiscal-years';
import { financeCategories, financeFiscalYears, financeReports } from '../src/schema';
import { seedFinance } from '../src/seed';
import { setupFinance } from './helpers';
import { fakeSiteModule } from './annual-accounts-j2-fixture';
import { FINANCE_PERMISSIONS, financeModule } from '../src/manifest';
import { financeAnnualAccountsPublications, financeReportSignatures } from '../src/schema';
import { loadAllViews } from '@kompass/core/testing';
import { getEffectivePermissions, schema as coreSchema } from '@kompass/core';

/**
 * Die Jahresrechnung über den Seed mehrerer Jahre (J1 Task 8, Spec „Summen gehen auf“): jedes abgeschlossene Jahr
 * geht auf, das Vorjahr ist festgeschrieben, drei Großzuwendungen, eine davon ohne Namen.
 */
describe('Jahresrechnung im Seed', () => {
  let f: ReturnType<typeof setupFinance>;
  const env = { settings: {} };

  beforeAll(async () => {
    f = setupFinance(FINANCE_PERMISSIONS, [fakeSiteModule(new Map())]);
    insertUser(f.deps, { name: 'Jonas Feld', email: 'jonas@kompass.local' });
    insertUser(f.deps, { name: 'Mira Klein', email: 'mira@kompass.local' });
    f.deps.db.transaction((tx) => {
      for (const [key, value] of [['organization.name', 'Musterverein e.V.'], ['organization.street', 'Vereinsweg 1'], ['organization.postalCode', '12345'], ['organization.city', 'Musterstadt']] as const) {
        writeSettingInternal(tx, f.deps, systemContext(), key, value);
      }
      installFinance(tx, f.deps, systemContext());
    });
    unwrap(await createProject(f.deps, ctxWith(['projects.manage', 'projects.view'], f.userId), { slug: 'winterhilfe', name: { de: 'Winterhilfe' }, type: 'ongoing', summary: { de: 'Kurz' }, body: { de: 'Text' } }));
    await seedFinance(f.deps, f.ctx);
  }, 30_000);

  const closedYears = () => f.deps.db.select().from(financeFiscalYears).orderBy(financeFiscalYears.startsOn).all().filter((y) => fiscalYearStatusInternal(f.deps.db, y.id) === 'closed');

  it('geht in jedem abgeschlossenen Jahr auf und hat eine Erläuterung', () => {
    const years = closedYears();
    expect(years.length).toBeGreaterThanOrEqual(3);
    for (const y of years) {
      const data = computeAnnualAccounts(f.deps.db, { fiscalYearId: y.id }, env);
      const plain = incomeStatement(f.deps.db, { from: y.startsOn, to: y.endsOn });
      const cash = computeCashReport(f.deps.db, { fiscalYearId: y.id }, env);
      expect(data.income.rows.reduce((s, r) => s + r.cents, 0), y.designation).toBe(data.result.incomeCents);
      expect(data.result.incomeCents, y.designation).toBe(plain.totalIncomeCents);
      const e = data.expense;
      expect(e.program.total.cents + e.fundraising.cents + e.administration.cents + e.assetManagement.cents + e.business.cents, y.designation).toBe(data.result.expenseCents);
      expect(data.result.expenseCents, y.designation).toBe(plain.totalExpenseCents);
      expect(data.result.probe.differenceCents, y.designation).toBe(0);
      const a = data.assets;
      expect(a.netAssetsCents, y.designation).toBe(cash.probe.closingCents + a.receivablesCents - a.payablesCents + a.otherAssetsCents - a.otherLiabilitiesCents);
      expect(annualAccountsExplanationInternal(f.deps.db, y.id)?.text, y.designation).toBeTruthy();
    }
  });

  it('hat das Vorjahr festgeschrieben, mit drei Großzuwendungen, eine ohne Namen', () => {
    const previous = closedYears().at(-1)!;
    const valid = f.deps.db.select().from(financeReports).where(and(eq(financeReports.reportKey, 'annualAccounts'), eq(financeReports.fiscalYearId, previous.id), isNull(financeReports.voidedAt))).all();
    expect(valid).toHaveLength(1);
    const data = computeAnnualAccounts(f.deps.db, { fiscalYearId: previous.id }, env);
    expect(data.majorDonors).toHaveLength(3);
    const naming = annualAccountsNamingInternal(f.deps.db, data, previous.endsOn.replace(/^\d{4}/, String(Number(previous.endsOn.slice(0, 4)) + 1)));
    expect(Object.values(naming.donors).filter((n) => n === null)).toHaveLength(1);
  });

  it('kennt das Plattform-Merkmal und vertretende Vorstandsmitglieder mit Amt', () => {
    expect(f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'platform-payouts')).get()?.donationPlatform).toBe('confirmsItself');
    const board = f.deps.db.select({ note: contactRoles.note, represents: contactRoles.representsAssociation, firstName: contacts.firstName }).from(contactRoles).innerJoin(contacts, eq(contacts.id, contactRoles.contactId)).where(eq(contactRoles.role, 'board-member')).all();
    expect(board.some((b) => b.represents && b.note)).toBe(true);
    expect(board.some((b) => !b.represents)).toBe(true);
  });

  it('hat das Vorjahr abgezeichnet (Thomas Wendt, Konto) und nach der MV veröffentlicht, das erste Jahr vor der MV (J2)', () => {
    const years = closedYears();
    const previous = years.at(-1)!;
    const first = years[0]!;
    const thomas = f.deps.db.select().from(coreSchema.users).where(eq(coreSchema.users.email, 'thomas@kompass.local')).get()!;
    const reportOf = (yearId: string) => f.deps.db.select().from(financeReports).where(and(eq(financeReports.reportKey, 'annualAccounts'), eq(financeReports.fiscalYearId, yearId), isNull(financeReports.voidedAt))).get()!;
    const signatureOf = (yearId: string) => f.deps.db.select().from(financeReportSignatures).where(eq(financeReportSignatures.reportId, reportOf(yearId).id)).get();
    expect(signatureOf(previous.id)).toMatchObject({ via: 'account', signerUserId: thomas.id, signerName: 'Thomas Wendt', signerOffice: 'Stellvertretender Vorsitzender', signedOn: previous.endsOn.replace(/^(\d{4})-12-31$/, (_m, y) => `${Number(y) + 1}-02-27`) });
    const pubOf = (yearId: string) => f.deps.db.select().from(financeAnnualAccountsPublications).where(eq(financeAnnualAccountsPublications.fiscalYearId, yearId)).all();
    expect(pubOf(previous.id)).toMatchObject([{ earlyReason: null, corrected: false, withdrawnAt: null }]);
    expect(pubOf(first.id)).toMatchObject([{ earlyReason: 'itzDeadline', withdrawnAt: null }]);
    // Abnahme J2, Punkt 4: Thomas sieht eine Bitte um Abzeichnung unter „Fällig“ und darf abzeichnen.
    const rights = getEffectivePermissions(f.deps.db, f.deps.registry, thomas.id);
    expect([...rights].filter((p) => ['followUps.view', 'followUps.manage', 'finance.overview'].includes(p)).sort()).toEqual(['finance.overview', 'followUps.manage', 'followUps.view']);
    const rows = loadAllViews(f.deps, financeModule).annualAccounts as { year: string }[];
    expect(rows.map((r) => r.year)).toEqual([previous.designation, first.designation]);
  });

  it('ändert beim zweiten Lauf nichts', async () => {
    const count = () => f.deps.sqlite.prepare('SELECT count(*) AS n FROM audit_log').get();
    const before = count();
    await seedFinance(f.deps, f.ctx);
    expect(count()).toEqual(before);
  }, 30_000);
});
