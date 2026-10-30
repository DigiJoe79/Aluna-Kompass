import { unwrap, writeSettingInternal } from '@kompass/core';
import { ctxWith, fakeMailTransport, insertUser, systemContext } from '@kompass/core/testing';
import { addContactRole, createContact, linkUserToContact } from '@kompass/module-contacts';
import { createProject, setProjectPublished } from '@kompass/module-projects';
import { eq } from 'drizzle-orm';
import { recordNameConsent } from '../src/allocation/name-consents';
import { bookEntry } from '../src/ledger/finalize';
import { fileAccountStatementDocument } from '../src/ledger/statement-documents';
import { finalizeFinanceReport, releaseReportsForFinalizing } from '../src/reporting/finalize';
import { financeCategories, financeReports } from '../src/schema';
import { defineModule } from '@kompass/core';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { ledgerFixture, pdfBytes } from './helpers';

/**
 * Die Webseite als Attrappe (Finanzen hängen nicht an ihr): Sie bringt das Recht `site.publish` und beantwortet
 * „publiziert seit“ aus `live` (`<sicht>:<href>` → Zeitpunkt).
 */
export function fakeSiteModule(live: Map<string, string>) {
  return defineModule({ key: 'site', version: '1', permissions: ['site.publish'], publishedLiveSince: (_deps, view, href) => live.get(`${view}:${href}`) ?? null });
}

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;
const contactCtx = ctxWith(['contacts.view', 'contacts.manage']);
const category = (f: Fixture, key: string) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!;
export const bookIn = (f: Fixture, date: string, key: string, cents: number, line: Record<string, unknown> = {}) =>
  bookEntry(f.deps, f.ctx, { entryDate: date, text: key, moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId: category(f, key).id, amountCents: cents, taxCode: 'none', ...line }] }).then(unwrap);

/** Ein vertretungsberechtigtes Vorstandsmitglied; mit `linked` samt Nutzerkonto, das mit dem Kontakt verknüpft ist. */
export async function boardMember(f: Fixture, o: { firstName: string; lastName: string; office?: string; since?: string; represents?: boolean; linked?: boolean; email?: string }) {
  const contact = unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: o.firstName, lastName: o.lastName }));
  const withRole = unwrap(await addContactRole(f.deps, contactCtx, { id: contact.id, role: 'board-member', since: o.since ?? '2025-01-01', note: o.office ?? null, representsAssociation: o.represents ?? true }));
  const roleId = withRole.roles.find((r) => r.role === 'board-member')!.id;
  let userId: string | null = null;
  if (o.linked !== false) {
    userId = insertUser(f.deps, { name: `${o.firstName} ${o.lastName}`, email: o.email ?? `${o.firstName.toLowerCase()}@example.org` });
    unwrap(await linkUserToContact(f.deps, ctxWith(['users.manage']), { userId, contactId: contact.id }));
  }
  return { contactId: contact.id, roleId, userId, name: `${o.firstName} ${o.lastName}`, ctx: ctxWith(['finance.overview'], userId) };
}

/**
 * Eine festgeschriebene Jahresrechnung 2025 (Muster `annual-accounts-finalize.test.ts`): Spende einer Privatperson mit
 * Einwilligung (genannt in F8), festgeschriebener Kassenbericht, Freigabe mündlich; dazu Vera Vorstand (vertritt, mit
 * Konto) und Mailversand über die Akte (Fake-Transport).
 */
export async function finalizedAnnualAccounts(opts: { years?: string[]; site?: boolean; secondDonor?: boolean } = {}) {
  const live = new Map<string, string>();
  const f = await ledgerFixture({ years: opts.years ?? ['2025', '2026'], extraModules: opts.site === false ? [] : [fakeSiteModule(live)] });
  const mail = fakeMailTransport();
  f.deps.mail = mail;
  // Was gerendert wurde (Typst-Körper), um Abzeichnungszeile und Webfassung zu prüfen.
  const renders: string[] = [];
  const render = f.deps.documents.render.bind(f.deps.documents);
  f.deps.documents = { ...f.deps.documents, render: (input) => (renders.push(`${input.bodyTypst}\n${JSON.stringify(input.slots ?? {})}`), render(input)) };
  f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'dms.mail.fromAddress', 'verein@example.org'));
  const y2025 = f.years['2025']!.id;
  const with2024 = (opts.years ?? []).includes('2024');
  const donor = unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: 'Petra', lastName: 'Privatier' }));
  const project = unwrap(await createProject(f.deps, ctxWith(['projects.manage']), { slug: 'offen', name: { de: 'Offenes Projekt' }, type: 'ongoing' as const, summary: { de: '' }, body: { de: '' } }));
  unwrap(await setProjectPublished(f.deps, ctxWith(['projects.manage']), { id: project.id, isPublished: true }));
  // Mit 2024 dasselbe Bild ein Jahr früher: dieselbe Spenderin in beiden Jahren genannt (Review Focus 2).
  const designations = with2024 ? ['2024', '2025'] : ['2025'];
  for (const y of designations) {
    await bookIn(f, `${y}-03-01`, 'donations', 10000);
    await bookIn(f, `${y}-03-02`, 'donations', 5000, { contactId: donor.id });
    await bookIn(f, `${y}-03-03`, 'program-costs', -900, { projectId: project.id });
  }
  // Ein zweiter Großspender ohne Einwilligung (über 10 %), für die Webfassung (Abnahme J2, Punkt 3).
  const secondDonor = opts.secondDonor ? unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: 'Otto', lastName: 'Ohne' })) : null;
  if (secondDonor) await bookIn(f, '2025-03-04', 'donations', 3000, { contactId: secondDonor.id });
  unwrap(await recordNameConsent(f.deps, f.ctx, { kind: 'granted', contactId: donor.id, on: '2026-01-10', fromYear: Number(designations[0]) }));
  for (const y of designations) unwrap(await fileAccountStatementDocument(f.deps, f.ctx, { accountId: f.bank.id, periodTo: `${y}-12-31`, bytes: pdfBytes() }));
  const board = await boardMember(f, { firstName: 'Vera', lastName: 'Vorstand', office: 'Vorsitzende', since: '2024-01-01' });
  const finalized: Record<string, { reportId: string; shortHash: string }> = {};
  for (const y of designations) {
    const yearId = f.years[y]!.id;
    f.closeYear(yearId);
    unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: yearId, basis: 'oralReport', note: null }));
    unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'cashReport', params: { fiscalYearId: yearId } }));
    finalized[y] = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'annualAccounts', params: { fiscalYearId: yearId } }));
  }
  const params = { fiscalYearId: y2025 };
  const done = finalized['2025']!;
  const report = f.deps.db.select().from(financeReports).where(eq(financeReports.id, done.reportId)).get()!;
  const report2024 = with2024 ? f.deps.db.select().from(financeReports).where(eq(financeReports.id, finalized['2024']!.reportId)).get()! : null;
  return { f, mail, renders, live, publisher: ctxWith([...FINANCE_PERMISSIONS, 'site.publish'], f.userId), y2025, donor, secondDonor, project, params, board, report, report2024, shortHash: done.shortHash };
}
