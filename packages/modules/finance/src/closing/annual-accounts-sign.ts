import {
  createFollowUpInternal,
  completeFollowUpsInternal,
  hasPermission,
  invalid,
  isoNow,
  newId,
  notFound,
  notifyFollowUpAssignee,
  ok,
  requirePermission,
  timeZoneOf,
  todayIn,
  validate,
  type CallContext,
  type DbOrTx,
  type Deps,
  type FollowUpNotice,
  type Result,
} from '@kompass/core';
import { abortIssue, documents, insertRelation, issueGeneratedDocument, receiveGeneratedUpload } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { assemblyOfYearInternal } from './assembly';
import { financeConflict, requireHumanChannelFinance, uploadLimitProblem } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { zonedDayOf } from '../zoned-days';
import { representativeOfUserInternal, representativesInternal } from '../ledger/representatives';
import { financeFiscalYears, financeReports, financeReportSignatures, type FinanceReportRow, type FinanceReportSignatureRow } from '../schema';
import { annualAccountsNamingInternal } from '../reporting/annual-accounts-naming';
import { reportDefinition } from '../reporting/catalog';
import { documentInputInternal } from '../reporting/finalize';
import type { AnnualAccounts } from '../reporting/reports/annual-accounts';
import { runReportInternal } from '../reporting/service';
import { REPORT_TEMPLATE_KEY } from '../reporting/template';
import type { AnnualAccountsAnnex } from '../reporting/types';

/** Die Abzeichnung einer Fassung, wie Oberfläche und MCP sie sehen (J2). Name und Amt zum Tag der Abzeichnung. */
export interface AnnualAccountsSignatureView {
  reportId: string;
  contactId: string;
  name: string;
  office: string | null;
  signedOn: string;
  via: 'account' | 'scan';
  documentId: string;
  documentNumber: string;
  scanDocumentId: string | null;
  scanDocumentNumber: string | null;
}

/** Ein Aufrufkontext mit einem zusätzlichen Recht — nur für den einen Aufruf der Akte, nachdem der Dienst selbst geprüft hat (Muster `allocation/waiver.ts`). */
export const withPermission = (ctx: CallContext, permission: string): CallContext => (hasPermission(ctx, permission) ? ctx : { ...ctx, permissions: new Set([...ctx.permissions, permission]) });

type DocumentEnd = { id: string; number: string | null; subject: string; typeKey: string };
export const documentEndInternal = (db: DbOrTx, id: string): DocumentEnd => db.select({ id: documents.id, number: documents.number, subject: documents.subject, typeKey: documents.typeKey }).from(documents).where(eq(documents.id, id)).get()!;

export function signatureRowInternal(db: DbOrTx, reportId: string): FinanceReportSignatureRow | null {
  return db.select().from(financeReportSignatures).where(eq(financeReportSignatures.reportId, reportId)).get() ?? null;
}

export function signatureViewInternal(db: DbOrTx, reportId: string): AnnualAccountsSignatureView | null {
  const row = signatureRowInternal(db, reportId);
  if (!row) return null;
  const scanNumber = row.scanDocumentId ? (documentEndInternal(db, row.scanDocumentId).number ?? null) : null;
  return { reportId, contactId: row.contactId, name: row.signerName, office: row.signerOffice, signedOn: row.signedOn, via: row.via, documentId: row.documentId, documentNumber: row.documentNumber, scanDocumentId: row.scanDocumentId, scanDocumentNumber: scanNumber };
}

/** Die Fassung einer Jahresrechnung: unbekannt → `notFound`, storniert → `annualAccountsNotFinal`. */
export function loadAnnualAccountsVersionInternal(db: DbOrTx, reportId: string): Result<{ row: FinanceReportRow; designation: string }> {
  const row = db.select().from(financeReports).where(eq(financeReports.id, reportId)).get();
  if (!row || row.reportKey !== 'annualAccounts') return notFound('financeReport', reportId);
  if (row.voidedAt) return financeConflict('annualAccountsNotFinal');
  const year = db.select({ designation: financeFiscalYears.designation }).from(financeFiscalYears).where(eq(financeFiscalYears.id, row.fiscalYearId)).get()!;
  return ok({ row, designation: year.designation });
}

/**
 * Eine weitere Fassung einer festgeschriebenen Jahresrechnung rendern — abgezeichnet oder für die Webseite: derselbe
 * Datenstand (sonst `reportDataChanged`), Stufe `final`, mit `annex` (J1 Task 7). Abgelegt als `finance-report` an
 * Bericht und Jahr (Betreff „Jahresrechnung {Jahr} – {subjectSuffix}“), mit Bezug `signedCopyOf` auf das Dokument der
 * Fassung. `afterIssue` läuft in derselben Transaktion (Zeile der Abzeichnung oder Webfassung). Ohne Rechteprüfung:
 * Die Akte bekommt `finance.reportsFinalize` nur für diesen Aufruf, der Dienst hat vorher geprüft.
 * `namedContactIds`: die Zuwender, die F8 dieser Fassung mit Namen nennt.
 */
export async function renderAnnualAccountsVersionInternal<T = undefined>(
  deps: Deps,
  ctx: CallContext,
  reportId: string,
  annex: AnnualAccountsAnnex,
  subjectSuffix: string,
  afterIssue?: (tx: DbOrTx, doc: { id: string; number: string; namedContactIds: string[] }) => T,
  /** Webfassung: genannt wird höchstens, wer hier steht — Namen kommen nie hinzu (Abnahme J2, Punkt 3). */
  keepOnly?: readonly string[],
): Promise<Result<{ documentId: string; documentNumber: string; namedContactIds: string[]; after: T | undefined }>> {
  const loaded = loadAnnualAccountsVersionInternal(deps.db, reportId);
  if (!loaded.ok) return loaded;
  const { row, designation } = loaded.value;
  const def = reportDefinition('annualAccounts')!;
  const params = JSON.parse(row.params) as Record<string, string>;
  const run = runReportInternal(deps, deps.db, def, params);
  if (run.hash !== row.dataHash) return financeConflict('reportDataChanged');
  const at = todayIn(deps);
  const donorIds = (run.data as AnnualAccounts).majorDonors.flatMap((d) => (d.contactId ? [d.contactId] : []));
  if (keepOnly) annex = { ...annex, anonymize: [...new Set([...(annex.anonymize ?? []), ...donorIds.filter((id) => !keepOnly.includes(id))])] };
  const naming = annualAccountsNamingInternal(deps.db, run.data as AnnualAccounts, at, annex.anonymize ?? [], deps.locales()[0] ?? 'de');
  const namedContactIds = Object.entries(naming.donors).flatMap(([id, name]) => (name ? [id] : []));
  const input = await documentInputInternal(deps, def, run, 'final', row.finalizedAt, { at, annex });
  const issued = await issueGeneratedDocument(deps, withPermission(ctx, 'finance.reportsFinalize'), {
    templateKey: REPORT_TEMPLATE_KEY,
    input,
    snapshot: { report: def.key, params, dataHash: run.hash, annex: { ...annex, anonymize: [...(annex.anonymize ?? [])] } },
    subject: `Jahresrechnung ${designation} – ${subjectSuffix}`,
    documentDate: at,
    links: [{ entityType: 'financeReport', entityId: row.id }, { entityType: 'financeFiscalYear', entityId: row.fiscalYearId }],
    afterIssue: (tx, doc) => {
      const fresh = tx.select({ voidedAt: financeReports.voidedAt }).from(financeReports).where(eq(financeReports.id, row.id)).get()!;
      if (fresh.voidedAt) return abortIssue(financeConflict('annualAccountsNotFinal'));
      if (runReportInternal(deps, tx, def, params).hash !== row.dataHash) return abortIssue(financeConflict('reportDataChanged'));
      insertRelation(tx, deps, ctx, { documentId: doc.id, relatedDocumentId: row.documentId, kind: 'signedCopyOf' }, documentEndInternal(tx, doc.id), documentEndInternal(tx, row.documentId));
      return afterIssue?.(tx, { id: doc.id, number: doc.number, namedContactIds });
    },
  });
  if (!issued.ok) return issued;
  return ok({ documentId: issued.value.document.id, documentNumber: issued.value.document.number!, namedContactIds, after: issued.value.after });
}

/** Der MV-Tag des Jahres für die Zeile „Der Mitgliederversammlung vorgelegt am …“, sonst `null`. */
export function assemblyOnInternal(deps: Deps, fiscalYearId: string): string | null {
  return assemblyOfYearInternal(deps, deps.db, fiscalYearId, timeZoneOf(deps))?.assemblyOn ?? null;
}

interface SignatureInsert {
  reportId: string;
  contactId: string;
  name: string;
  office: string | null;
  via: 'account' | 'scan';
  signedOn: string;
  scan: { id: string; number: string } | null;
}

/** Zeile, erledigte Bitte und Protokoll der Abzeichnung — in der Transaktion der erzeugten Fassung. */
function recordSignatureInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, s: SignatureInsert, doc: { id: string; number: string; namedContactIds: string[] }): void {
  if (signatureRowInternal(tx, s.reportId)) abortIssue(financeConflict('annualAccountsAlreadySigned', { documentNumber: signatureRowInternal(tx, s.reportId)!.documentNumber }));
  const id = newId();
  const signerUserId = s.via === 'account' ? ctx.userId : null;
  tx.insert(financeReportSignatures)
    .values({ id, reportId: s.reportId, contactId: s.contactId, signerName: s.name, signerOffice: s.office, via: s.via, signerUserId, signedOn: s.signedOn, documentId: doc.id, documentNumber: doc.number, scanDocumentId: s.scan?.id ?? null, namedContactIds: JSON.stringify(doc.namedContactIds), createdAt: isoNow(deps.clock), createdByUserId: ctx.userId ?? 'system' })
    .run();
  completeFollowUpsInternal(tx, deps, ctx, { entityType: 'financeReport', entityId: s.reportId });
  financeAudit(tx, deps, ctx, {
    action: 'finance.annualAccounts.sign',
    entity: 'financeReportSignature',
    id,
    after: { reportId: s.reportId, via: s.via, signedOn: s.signedOn, documentNumber: doc.number, signerUserId, scanDocumentNumber: s.scan?.number ?? null },
    params: { documentNumber: doc.number, via: s.via, scanNumber: s.scan?.number ?? null },
  });
}

const reportIdSchema = z.object({ reportId: z.string().min(1) });

/**
 * Die festgeschriebene Jahresrechnung selbst abzeichnen (Spec Teil J, Ve-F-1): wer am heutigen Tag als
 * Vorstandsmitglied nach § 26 BGB vertritt und mit seinem Konto verknüpft ist. Leserecht `finance.overview`; **nie über
 * einen Agenten** — auch nicht mit `finance.mcpHumanOnlyAllowed` (Planreview J2: Die ITZ verlangt die namentliche
 * Abzeichnung durch die Person). Erzeugt die abgezeichnete Fassung, erledigt die Bitte darum.
 */
export async function signAnnualAccounts(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnnualAccountsSignatureView>> {
  const denied = requireFinanceRead(ctx, 'overview');
  if (denied) return denied;
  if (ctx.channel === 'mcp') return financeConflict('annualAccountsSignNotForAgents');
  const parsed = validate(deps, reportIdSchema, input);
  if (!parsed.ok) return parsed;
  const loaded = loadAnnualAccountsVersionInternal(deps.db, parsed.value.reportId);
  if (!loaded.ok) return loaded;
  const { row } = loaded.value;
  const existing = signatureRowInternal(deps.db, row.id);
  if (existing) return financeConflict('annualAccountsAlreadySigned', { documentNumber: existing.documentNumber });
  const today = todayIn(deps);
  const rep = ctx.userId ? representativeOfUserInternal(deps.db, ctx.userId, today) : null;
  if (!rep) return financeConflict('annualAccountsNotRepresentative');
  const annex: AnnualAccountsAnnex = { signature: { name: rep.name, office: rep.office, signedOn: today, via: 'account', scanNumber: null }, assemblyOn: assemblyOnInternal(deps, row.fiscalYearId) };
  const rendered = await renderAnnualAccountsVersionInternal(deps, ctx, row.id, annex, 'abgezeichnete Fassung', (tx, doc) =>
    recordSignatureInternal(tx, deps, ctx, { reportId: row.id, contactId: rep.contactId, name: rep.name, office: rep.office, via: 'account', signedOn: today, scan: null }, doc),
  );
  if (!rendered.ok) return rendered;
  return ok(signatureViewInternal(deps.db, row.id)!);
}

const scanSchema = z.object({
  reportId: z.string().min(1),
  contactId: z.string().min(1),
  signedOn: z.string().date(),
  bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' }),
  fileName: z.string().trim().max(300).optional(),
});

const isPdf = (bytes: Uint8Array) => bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';

/**
 * Den unterschriebenen Scan an der Fassung ablegen (Spec Teil J): `finance.reportsFinalize`, humanOnly wie Festschreiben.
 * Der Kontakt muss am Tag der Unterschrift vertreten; der Tag liegt nicht in der Zukunft und nicht vor dem Festschreiben.
 * Der Scan trägt eine Unterschrift als Bild und wird nie öffentlich: Abgezeichnet ist die **erzeugte** Fassung, die den
 * Scan mit Nummer nennt; beide hängen mit `signedCopyOf` an der Fassung.
 */
export async function attachSignedAnnualAccountsScan(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnnualAccountsSignatureView>> {
  const denied = requirePermission(ctx, 'finance.reportsFinalize');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, scanSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const tooLarge = uploadLimitProblem(deps, v.bytes);
  if (tooLarge) return tooLarge;
  if (!isPdf(v.bytes)) return invalid([{ path: 'bytes', message: 'notPdf' }]);
  const loaded = loadAnnualAccountsVersionInternal(deps.db, v.reportId);
  if (!loaded.ok) return loaded;
  const { row, designation } = loaded.value;
  const existing = signatureRowInternal(deps.db, row.id);
  if (existing) return financeConflict('annualAccountsAlreadySigned', { documentNumber: existing.documentNumber });
  if (v.signedOn > todayIn(deps)) return invalid([{ path: 'signedOn', message: 'inFuture' }]);
  if (v.signedOn < zonedDayOf(row.finalizedAt, timeZoneOf(deps))) return invalid([{ path: 'signedOn', message: 'beforeIssued' }]);
  const rep = representativesInternal(deps.db, v.signedOn).find((r) => r.contactId === v.contactId);
  if (!rep) return financeConflict('annualAccountsNotRepresentative');

  const scan = await receiveGeneratedUpload(deps, ctx, {
    bytes: v.bytes,
    typeKey: 'finance-report',
    subject: `Jahresrechnung ${designation} – unterschriebenes Exemplar`,
    documentDate: v.signedOn,
    links: [{ entityType: 'financeReport', entityId: row.id }, { entityType: 'financeFiscalYear', entityId: row.fiscalYearId }],
    recordNumber: row.documentNumber,
    afterReceive: (tx, doc) => {
      insertRelation(tx, deps, ctx, { documentId: doc.id, relatedDocumentId: row.documentId, kind: 'signedCopyOf' }, documentEndInternal(tx, doc.id), documentEndInternal(tx, row.documentId));
      return { id: doc.id, number: doc.number };
    },
  });
  if (!scan.ok) return scan;
  const scanDoc = scan.value.after!;
  const annex: AnnualAccountsAnnex = { signature: { name: rep.name, office: rep.office, signedOn: v.signedOn, via: 'scan', scanNumber: scanDoc.number }, assemblyOn: assemblyOnInternal(deps, row.fiscalYearId) };
  const rendered = await renderAnnualAccountsVersionInternal(deps, ctx, row.id, annex, 'abgezeichnete Fassung', (tx, doc) =>
    recordSignatureInternal(tx, deps, ctx, { reportId: row.id, contactId: rep.contactId, name: rep.name, office: rep.office, via: 'scan', signedOn: v.signedOn, scan: scanDoc }, doc),
  );
  if (!rendered.ok) return rendered;
  return ok(signatureViewInternal(deps.db, row.id)!);
}

const requestSchema = z.object({ reportId: z.string().min(1), contactId: z.string().min(1), dueAt: z.string().date() });

/** Titel der Wiedervorlage „Um Abzeichnung bitten“ (Planreview J2); Nutzdaten wie Rollennamen, fest deutsch. */
export const signatureRequestTitle = (designation: string) => `Jahresrechnung ${designation} abzeichnen`;

/**
 * Um Abzeichnung bitten (Spec Teil J): `finance.reportsFinalize`. Der Kontakt vertritt heute und hat ein Konto
 * (`annualAccountsSignerWithoutAccount` sonst — dann bleibt der Scan); eine Wiedervorlage an der Fassung, zugewiesen an
 * sein Konto, mit Mail (`notice`). Agenten dürfen bitten.
 */
export async function requestAnnualAccountsSignature(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ followUpId: string; notice: FollowUpNotice }>> {
  const denied = requirePermission(ctx, 'finance.reportsFinalize');
  if (denied) return denied;
  const parsed = validate(deps, requestSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const loaded = loadAnnualAccountsVersionInternal(deps.db, v.reportId);
  if (!loaded.ok) return loaded;
  const { row, designation } = loaded.value;
  const existing = signatureRowInternal(deps.db, row.id);
  if (existing) return financeConflict('annualAccountsAlreadySigned', { documentNumber: existing.documentNumber });
  const rep = representativesInternal(deps.db, todayIn(deps)).find((r) => r.contactId === v.contactId);
  if (!rep) return financeConflict('annualAccountsNotRepresentative');
  if (!rep.userId) return financeConflict('annualAccountsSignerWithoutAccount');
  const record = deps.db.transaction((tx: DbOrTx) => {
    const created = createFollowUpInternal(tx, deps, ctx, { entityType: 'financeReport', entityId: row.id, dueAt: v.dueAt, title: signatureRequestTitle(designation), assigneeUserId: rep.userId });
    financeAudit(tx, deps, ctx, { action: 'finance.annualAccounts.signatureRequest', entity: 'financeReport', id: row.id, params: { documentNumber: row.documentNumber } });
    return created;
  });
  return ok({ followUpId: record.id, notice: await notifyFollowUpAssignee(deps, ctx, record) });
}
