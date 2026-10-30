import { followUpMailStateInternal, hasPermission, isModuleEnabled, notFound, ok, requirePermission, schema as coreSchema, timeZoneOf, todayIn, validate, type CallContext, type Deps, type FollowUpMailState, type Result } from '@kompass/core';
import { contactIdForUserInternal } from '@kompass/module-contacts';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requireFinanceRead } from '../ledger/access';
import { representativeOfUserInternal, representativesInternal, type Representative } from '../ledger/representatives';
import { financeFiscalYears, financeReports } from '../schema';
import { zonedDayOf } from '../zoned-days';
import { annualAccountsExplanationInternal } from '../reporting/annual-accounts-notes';
import { annualAccountsNamingInternal } from '../reporting/annual-accounts-naming';
import { livePublicationInternal, publicationsOfYearInternal, publicPublicationsOfYearInternal, publicationViewInternal, publishNeedsInternal, type AnnualAccountsPublicationView, type AnnualAccountsWithdrawnCause } from './annual-accounts-publish';
import { signatureViewInternal, type AnnualAccountsSignatureView } from './annual-accounts-sign';
import { reportDefinition } from '../reporting/catalog';
import type { AnnualAccounts } from '../reporting/reports/annual-accounts';
import { runReportInternal } from '../reporting/service';

/** Zustand einer Zeile der Karte „Veröffentlichung“ (Designer): erledigt, offen oder gedämpft (noch nicht dran). */
export type AnnualAccountsRowState = 'done' | 'open' | 'muted';

export interface AnnualAccountsState {
  fiscalYearId: string;
  designation: string;
  finalVersion: { reportId: string; documentId: string; documentNumber: string; finalizedAt: string; shortHash: string; corrected: { replacesFinalizedAt: string } | null } | null;
  explanation: { state: AnnualAccountsRowState; length: number; updatedAt: string | null; locked: boolean };
  signature: {
    state: AnnualAccountsRowState;
    mutedReason: 'notFinal' | null;
    signed: AnnualAccountsSignatureView | null;
    /** Die offene Bitte: an wen (Kontakt, Konto), von wem (`requestedByUserId`, Board 1f „… bittet Sie darum“), seit wann. */
    request: { contactId: string; name: string; requestedOn: string; followUpId: string; requestedByUserId: string; assigneeUserId: string } | null;
    canSignSelf: boolean;
    representatives: (Representative & { mailState: FollowUpMailState | 'noAccount' })[];
  };
  website: {
    state: AnnualAccountsRowState;
    mutedReason: 'notFinal' | 'notSigned' | null;
    publication: AnnualAccountsPublicationView | null;
    /** Die zuletzt zurückgenommene Veröffentlichung; `wasLive`: stand sie da auf der Webseite (sonst nur bereitgestellt). */
    previous: { withdrawnAt: string; cause: AnnualAccountsWithdrawnCause; finalizedAt: string; wasLive: boolean } | null;
    publishNeeds: 'nothing' | 'reason' | 'blocked';
    blockedCode: 'annualAccountsAssemblyPending' | 'siteModuleDisabled' | null;
    mayPublish: boolean;
    assemblyOn: string | null;
  };
  /** „n von 3 erledigt“. */
  doneCount: number;
}

const stateSchema = z.object({ fiscalYearId: z.string().min(1) });

/**
 * Der Zustand von Erläuterung, Abzeichnung und Webseite einer Jahresrechnung für die Oberfläche (U1, Karte
 * „Veröffentlichung“) — `finance.overview` oder `finance.read`, nur lesend. Die Erläuterung ist nie gedämpft; die
 * Abzeichnung erst nach dem Festschreiben dran, die Webseite erst nach der Abzeichnung.
 */
export async function getAnnualAccountsState(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnnualAccountsState>> {
  const denied = requireFinanceRead(ctx, 'overview');
  if (denied) return denied;
  const parsed = validate(deps, stateSchema, input);
  if (!parsed.ok) return parsed;
  const db = deps.db;
  const year = db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, parsed.value.fiscalYearId)).get();
  if (!year) return notFound('financeFiscalYear', parsed.value.fiscalYearId);
  const today = todayIn(deps);
  const tz = timeZoneOf(deps);

  const report = db.select().from(financeReports).where(and(eq(financeReports.reportKey, 'annualAccounts'), eq(financeReports.fiscalYearId, year.id), isNull(financeReports.voidedAt))).orderBy(desc(financeReports.finalizedAt)).get() ?? null;
  const publications = publicationsOfYearInternal(db, year.id);
  const earlier = report ? publicPublicationsOfYearInternal(deps, db, year.id).find((p) => p.reportId !== report.id) : undefined;
  const earlierReport = earlier ? db.select({ finalizedAt: financeReports.finalizedAt }).from(financeReports).where(eq(financeReports.id, earlier.reportId)).get() : undefined;
  const finalVersion = report
    ? { reportId: report.id, documentId: report.documentId, documentNumber: report.documentNumber, finalizedAt: report.finalizedAt, shortHash: report.dataHash.slice(0, 8), corrected: earlierReport ? { replacesFinalizedAt: earlierReport.finalizedAt } : null }
    : null;

  const note = annualAccountsExplanationInternal(db, year.id);
  const explanation = { state: (note ? 'done' : 'open') as AnnualAccountsRowState, length: note?.text.length ?? 0, updatedAt: note?.updatedAt ?? null, locked: report !== null };

  const signed = report ? signatureViewInternal(db, report.id) : null;
  const openRequest = report && !signed
    ? db.select().from(coreSchema.followUps).where(and(eq(coreSchema.followUps.entityType, 'financeReport'), eq(coreSchema.followUps.entityId, report.id), isNull(coreSchema.followUps.doneAt))).orderBy(desc(coreSchema.followUps.createdAt)).get()
    : undefined;
  const requestContact = openRequest?.assigneeUserId ? contactIdForUserInternal(db, openRequest.assigneeUserId) : null;
  const representatives = representativesInternal(db, today);
  const request = openRequest && requestContact
    ? { contactId: requestContact, name: representatives.find((r) => r.contactId === requestContact)?.name ?? db.select({ name: coreSchema.users.name }).from(coreSchema.users).where(eq(coreSchema.users.id, openRequest.assigneeUserId!)).get()?.name ?? '', requestedOn: zonedDayOf(openRequest.createdAt, tz), followUpId: openRequest.id, requestedByUserId: openRequest.createdByUserId, assigneeUserId: openRequest.assigneeUserId! }
    : null;
  const signature: AnnualAccountsState['signature'] = {
    state: !report ? 'muted' : signed ? 'done' : 'open',
    mutedReason: report ? null : 'notFinal',
    signed,
    request,
    canSignSelf: report !== null && signed === null && ctx.userId !== null && representativeOfUserInternal(db, ctx.userId, today) !== null,
    representatives: representatives.map((r) => ({ ...r, mailState: r.userId ? followUpMailStateInternal(deps, r.userId, ctx.userId) : 'noAccount' })),
  };

  const live = report ? livePublicationInternal(db, report.id) : null;
  const lastWithdrawn = !live ? publications.find((p) => p.withdrawnAt !== null) : undefined;
  const previousReport = lastWithdrawn ? db.select({ finalizedAt: financeReports.finalizedAt }).from(financeReports).where(eq(financeReports.id, lastWithdrawn.reportId)).get() : undefined;
  const needs = publishNeedsInternal(deps, db, year.id, report?.id ?? '');
  const siteOff = !isModuleEnabled(deps, 'site');
  const blockedCode = siteOff ? 'siteModuleDisabled' : needs.blocked;
  const website: AnnualAccountsState['website'] = {
    state: !report || !signed ? 'muted' : live ? 'done' : 'open',
    mutedReason: !report ? 'notFinal' : !signed ? 'notSigned' : null,
    publication: live ? publicationViewInternal(deps, live) : null,
    previous: lastWithdrawn && previousReport ? { withdrawnAt: lastWithdrawn.withdrawnAt!, cause: lastWithdrawn.withdrawnCause!, finalizedAt: previousReport.finalizedAt, wasLive: lastWithdrawn.withdrawnLiveSince !== null } : null,
    publishNeeds: blockedCode ? 'blocked' : needs.early ? 'reason' : 'nothing',
    blockedCode,
    mayPublish: hasPermission(ctx, 'finance.reportsFinalize') && hasPermission(ctx, 'site.publish'),
    assemblyOn: needs.assemblyOn,
  };
  const doneCount = [explanation.state, signature.state, website.state].filter((s) => s === 'done').length;
  return ok({ fiscalYearId: year.id, designation: year.designation, finalVersion, explanation, signature, website, doneCount });
}

const donorSchema = z.object({ contactId: z.string().min(1) });

/**
 * Was die Jahresrechnung des letzten beendeten Jahres über einen Zuwender sagt (Designer: Unterzeile „Folge fürs letzte
 * Jahr“ in den Finanzangaben zum Kontakt) — Betrag, Anteil an den Einnahmen in Promille und ob F8 ihn mit Namen nennt;
 * `null` unter 10 % oder ohne beendetes Jahr. `finance.read` (Personenbezug).
 */
export async function annualAccountsDonorEffect(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ designation: string; amountCents: number; sharePermille: number; named: boolean } | null>> {
  const denied = requirePermission(ctx, 'finance.read');
  if (denied) return denied;
  const parsed = validate(deps, donorSchema, input);
  if (!parsed.ok) return parsed;
  const db = deps.db;
  // Das letzte beendete Jahr, auch offen oder wiedergeöffnet — sonst nennte die Zeile nach einem Wiederöffnen das Jahr
  // davor, während F8 der Jahresrechnung schon das beendete Jahr zeigt (Bildabnahme 0.4.5 W-1/W-2).
  const today = todayIn(deps);
  const year = db.select().from(financeFiscalYears).orderBy(desc(financeFiscalYears.endsOn)).all().find((y) => y.endsOn < today);
  if (!year) return ok(null);
  const run = runReportInternal(deps, db, reportDefinition('annualAccounts')!, { fiscalYearId: year.id });
  const data = run.data as AnnualAccounts;
  const donor = data.majorDonors.find((d) => d.contactId === parsed.value.contactId);
  if (!donor || donor.amountCents === null || donor.sharePermille === null) return ok(null);
  const naming = annualAccountsNamingInternal(db, data, today, [], deps.locales()[0] ?? 'de');
  return ok({ designation: year.designation, amountCents: donor.amountCents, sharePermille: donor.sharePermille, named: naming.donors[parsed.value.contactId] !== null && naming.donors[parsed.value.contactId] !== undefined });
}
