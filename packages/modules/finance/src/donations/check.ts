import { invalid, isoNow, notFound, ok, readSetting, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { contacts, type ContactRow } from '@kompass/module-contacts';
import { documentTypeFor } from '@kompass/module-dms';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { CERTIFIABLE_INCOME_KINDS } from '../ledger/codes';
import { entryViewInternal } from '../ledger/entries';
import { noticeValidAt } from '../ledger/notice-validity';
import { financeAllocationLines, financeCategories, financeConfirmationLines, financeConfirmations, financeEntries, financeInKindDetails, financeNotices, type FinanceAllocationLineRow, type FinanceInKindDetailsRow } from '../schema';
import { machineProcedureStatusAt, type MachineProcedureStatus } from './machine';
import { CONFIRMATION_DOCUMENT_TYPE } from './templates/shared';

/**
 * Die Prüfliste vor dem Ausstellen (F6a Task 5, Spec 7.2): die neun Prüfungen
 * der Spec als elf Schlüssel — Nr. 1 „festgeschrieben“, 2 „bescheinigungsfähig“,
 * 3 „Kontakt vollständig“, 4 „nicht schon bestätigt“, 5 „Bescheid gültig“,
 * 6 „Betrag nach Rückläufern“, 7 „belegt“, 8 „Sachspende beschrieben“,
 * 9 „Dokumentart aktiv“ und „Unterzeichner“; dazu der Schalter der
 * Aufwandsspenden (E13). Eine Checkliste, kein Fehler: Jede Prüfung sagt, ob
 * sie erfüllt ist, ob sie sperrt und wo es weitergeht. Dieselbe Funktion läuft
 * vor dem Rendern und erneut in `afterIssue`.
 */
export const CONFIRMATION_CHECK_KEYS = ['final', 'certifiable', 'contactComplete', 'notConfirmed', 'noticeValid', 'amountPositive', 'documented', 'inKindDetails', 'typeActive', 'signerValid', 'expenseWaiverEnabled'] as const;
export type ConfirmationCheckKey = (typeof CONFIRMATION_CHECK_KEYS)[number];
export type ConfirmationWarning = 'organization' | 'foreignCountry' | 'beforeOldestNotice';

export interface ConfirmationCheck {
  key: ConfirmationCheckKey;
  /** Trifft die Prüfung auf diese Zuwendung zu? Sachspende und Aufwandsspende nur bei ihrer Art; der Unterzeichner nur, wo maschinell erlaubt ist. */
  applies: boolean;
  done: boolean;
  blocked: boolean;
  detail: Record<string, string | number | null>;
  /** Wo es weitergeht — `labelKey` ist ein Schlüssel der Oberfläche (F6a Task 7). */
  remedy: { href: string | null; labelKey: string } | null;
  /** `organization` | `foreignCountry` | `beforeOldestNotice` | `signatureField` — ein Hinweis, der nie sperrt. */
  warning: string | null;
}

export interface ConfirmationCheckLine {
  lineId: string;
  entryId: string;
  entryNumber: string | null;
  entryDate: string;
  amountCents: number;
  /** Nach Rückläufern (Annahme 6): Zeile minus festgeschriebene, nicht zurückgenommene Rückbuchungen auf sie. */
  netCents: number;
  incomeKind: string | null;
}

export interface ConfirmationCheckResult {
  kind: 'money' | 'inKind';
  contactId: string;
  lines: ConfirmationCheckLine[];
  checks: ConfirmationCheck[];
  ok: boolean;
  warnings: ConfirmationWarning[];
  notice: { id: string; kind: string; noticeDate: string; validUntil: string } | null;
  machine: MachineProcedureStatus;
  expenseWaiver: boolean;
}

export interface CheckConfirmableArgs {
  lineIds: readonly string[];
  issuedOn: string;
  /** Die gewünschte Art; eine Sachspende nur als `inKind`, Geld nie als `inKind` (`confirmationInKindMixed`). */
  kind?: 'money' | 'inKind' | 'collective';
}

type Line = FinanceAllocationLineRow & { entryNumber: string | null; entryDate: string; entryStatus: string; reversedByEntryId: string | null; reversesEntryId: string | null; incomeKind: string | null; categoryName: string };

const clean = (v: string | null | undefined) => (v ?? '').trim();

/** Annahme 4: Person mit Nachname, Organisation mit Name — beide mit Straße, Postleitzahl und Ort. */
export function missingContactFields(contact: Pick<ContactRow, 'kind' | 'lastName' | 'name' | 'street' | 'postalCode' | 'city'>): string[] {
  const fields = contact.kind === 'organization' ? (['name', 'street', 'postalCode', 'city'] as const) : (['lastName', 'street', 'postalCode', 'city'] as const);
  return fields.filter((field) => !clean(contact[field]));
}

/** Land außer Deutschland (leer gilt als Deutschland) — nur eine Warnung. */
export function isForeignCountry(contact: Pick<ContactRow, 'country'>): boolean {
  const country = clean(contact.country).toUpperCase();
  return country !== '' && country !== 'DE';
}

/** Rückläufer (Annahme 6): festgeschriebene, nicht zurückgenommene Zeilen mit `originLineId` auf diese Zeile. */
export function returnedCentsInternal(db: DbOrTx, lineIds: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (lineIds.length === 0) return out;
  const rows = db
    .select({ originLineId: financeAllocationLines.originLineId, amountCents: financeAllocationLines.amountCents })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
    .where(and(inArray(financeAllocationLines.originLineId, [...lineIds]), eq(financeEntries.status, 'final'), isNull(financeEntries.reversedByEntryId), isNull(financeEntries.reversesEntryId)))
    .all();
  for (const r of rows) out.set(r.originLineId!, (out.get(r.originLineId!) ?? 0) + Math.abs(r.amountCents));
  return out;
}

/** Die gültige Bestätigung (nicht freigegebene Zeile), die eine Zuwendungszeile trägt — Nummer und ID. */
export function openConfirmationsForLinesInternal(db: DbOrTx, lineIds: readonly string[]): Map<string, { confirmationId: string; number: string }> {
  const out = new Map<string, { confirmationId: string; number: string }>();
  if (lineIds.length === 0) return out;
  const rows = db
    .select({ lineId: financeConfirmationLines.lineId, confirmationId: financeConfirmations.id, number: financeConfirmations.documentNumber })
    .from(financeConfirmationLines)
    .innerJoin(financeConfirmations, eq(financeConfirmationLines.confirmationId, financeConfirmations.id))
    .where(and(inArray(financeConfirmationLines.lineId, [...lineIds]), isNull(financeConfirmationLines.releasedAt)))
    .all();
  for (const r of rows) out.set(r.lineId, { confirmationId: r.confirmationId, number: r.number });
  return out;
}

/** Vollständig beschrieben (Spec 7.2 Nr. 8): Gegenstand, Zustand, Wertermittlung, Herkunft, Wertunterlage; bei Betriebsvermögen Entnahmewert und Umsatzsteuer. */
export function inKindDetailsMissing(details: FinanceInKindDetailsRow | undefined): string[] {
  if (!details) return ['item', 'condition', 'valuation', 'origin', 'proofDocumentId'];
  const missing: string[] = [];
  for (const field of ['item', 'condition', 'valuation'] as const) if (!clean(details[field])) missing.push(field);
  if (!details.proofDocumentId) missing.push('proofDocumentId');
  if (details.origin === 'business') {
    if (details.withdrawalValueCents === null) missing.push('withdrawalValueCents');
    if (details.vatCents === null) missing.push('vatCents');
  }
  return missing;
}

function loadLines(db: DbOrTx, lineIds: readonly string[]): Line[] {
  return db
    .select({
      line: financeAllocationLines,
      entryNumber: financeEntries.number,
      entryDate: financeEntries.entryDate,
      entryStatus: financeEntries.status,
      reversedByEntryId: financeEntries.reversedByEntryId,
      reversesEntryId: financeEntries.reversesEntryId,
      incomeKind: financeCategories.incomeKind,
      categoryName: financeCategories.name,
    })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
    .innerJoin(financeCategories, eq(financeAllocationLines.categoryId, financeCategories.id))
    .where(inArray(financeAllocationLines.id, [...lineIds]))
    .all()
    .map(({ line, ...rest }) => ({ ...line, ...rest }));
}

const entryHref = (entryId: string) => `/finance/entries/${entryId}`;
const NOTICES_HREF = '/finance/donations/notices';

/**
 * Dieselbe Prüfung vor dem Rendern und in `afterIssue` — ohne Rechteprüfung,
 * lesend, in einer offenen Transaktion oder außerhalb. Fehler der Eingabe
 * (Zeile fehlt, verschiedene Kontakte, Geld und Sache gemischt) sind
 * `Result`-Fehler; alles Übrige steht in der Prüfliste.
 */
export function checkConfirmableInternal(db: DbOrTx, deps: Deps, args: CheckConfirmableArgs): Result<ConfirmationCheckResult> {
  const lineIds = [...new Set(args.lineIds)];
  const loaded = loadLines(db, lineIds);
  const byId = new Map(loaded.map((l) => [l.id, l]));
  const missingLine = lineIds.find((id) => !byId.has(id));
  if (missingLine) return notFound('financeAllocationLine', missingLine);
  const lines = lineIds.map((id) => byId.get(id)!).sort((a, b) => a.entryDate.localeCompare(b.entryDate) || (a.entryNumber ?? '').localeCompare(b.entryNumber ?? '') || a.position - b.position);

  if (lines.some((l) => l.contactId === null)) return invalid([{ path: 'lineIds', message: 'lineWithoutContact' }]);
  const contactId = lines[0]!.contactId!;
  if (lines.some((l) => l.contactId !== contactId)) return invalid([{ path: 'lineIds', message: 'linesOfDifferentContacts' }]);

  const inKindCount = lines.filter((l) => l.incomeKind === 'inKindDonation').length;
  if (inKindCount > 0 && (inKindCount < lines.length || (args.kind !== undefined && args.kind !== 'inKind'))) return financeConflict('confirmationInKindMixed');
  if (inKindCount === 0 && args.kind === 'inKind') return financeConflict('confirmationInKindMixed');
  const kind: 'money' | 'inKind' = inKindCount > 0 ? 'inKind' : 'money';

  const checks: ConfirmationCheck[] = [];
  const add = (key: ConfirmationCheckKey, c: Partial<Omit<ConfirmationCheck, 'key'>> & { done: boolean }) =>
    checks.push({ key, applies: c.applies ?? true, done: c.done, blocked: c.blocked ?? !c.done, detail: c.detail ?? {}, remedy: c.done ? null : (c.remedy ?? null), warning: c.warning ?? null });
  const warnings: ConfirmationWarning[] = [];

  // 1. Festgeschrieben, nicht zurückgenommen — und selbst keine Rücknahme.
  const notFinal = lines.find((l) => l.entryStatus !== 'final');
  const reversed = lines.find((l) => l.reversedByEntryId !== null || l.reversesEntryId !== null);
  const finalBad = notFinal ?? reversed;
  add('final', { done: !finalBad, detail: finalBad ? { state: notFinal ? 'draft' : 'reversed', entryNumber: finalBad.entryNumber } : {}, remedy: finalBad ? { href: entryHref(finalBad.entryId), labelKey: notFinal ? 'finalizeEntry' : 'openEntry' } : null });

  // 2. Bescheinigungsfähig: Einnahme einer der vier Arten; Mitgliedsbeiträge nur, solange der Verein sie bestätigt.
  const feesCertifiable = readSetting<boolean>(deps, 'finance.membershipFeesCertifiable');
  const notCertifiable = lines.find((l) => l.amountCents <= 0 || !(CERTIFIABLE_INCOME_KINDS as readonly string[]).includes(l.incomeKind ?? '') || (l.incomeKind === 'membershipFee' && !feesCertifiable));
  add('certifiable', { done: !notCertifiable, detail: notCertifiable ? { category: notCertifiable.categoryName } : {}, remedy: notCertifiable ? { href: entryHref(notCertifiable.entryId), labelKey: 'fixCategory' } : null });

  // 3. Kontakt vollständig (Annahme 4); Organisation und Ausland warnen nur.
  const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  const missing = contact ? missingContactFields(contact) : ['contact'];
  let contactWarning: ConfirmationWarning | null = null;
  if (contact?.kind === 'organization') warnings.push((contactWarning = 'organization'));
  if (contact && isForeignCountry(contact)) {
    warnings.push('foreignCountry');
    contactWarning ??= 'foreignCountry';
  }
  add('contactComplete', { done: missing.length === 0, detail: missing.length > 0 ? { missing: missing.join(',') } : {}, remedy: { href: `/contacts/${contactId}`, labelKey: 'completeAddress' }, warning: contactWarning });

  // 4. In keiner gültigen Bestätigung (der partielle Unique-Index ist die letzte Wache).
  const open = openConfirmationsForLinesInternal(db, lineIds);
  const confirmed = lineIds.map((id) => open.get(id)).find((c) => c !== undefined);
  add('notConfirmed', { done: !confirmed, detail: confirmed ? { number: confirmed.number, confirmationId: confirmed.confirmationId } : {}, remedy: confirmed ? { href: `/finance/donations?confirmation=${confirmed.confirmationId}`, labelKey: 'openConfirmation' } : null });

  // 5. Am Ausstellungstag ein gültiger Bescheid; eine Zuwendung vor dem ältesten Bescheid warnt (Pflichtbegründung beim Ausstellen).
  const notices = db.select().from(financeNotices).all();
  const valid = noticeValidAt(notices, args.issuedOn);
  const oldest = notices.filter((n) => n.voidedAt === null).map((n) => n.noticeDate).sort()[0] ?? null;
  const beforeOldest = oldest !== null && lines.some((l) => l.entryDate < oldest);
  if (beforeOldest) warnings.push('beforeOldestNotice');
  add('noticeValid', { done: valid !== null, detail: valid ? { noticeId: valid.notice.id, validUntil: valid.validUntil } : { date: args.issuedOn }, remedy: { href: NOTICES_HREF, labelKey: 'recordNotice' }, warning: beforeOldest ? 'beforeOldestNotice' : null });

  // 6. Betrag abzüglich Rückläufern > 0 — je Zeile.
  const returned = returnedCentsInternal(db, lineIds);
  const checkLines: ConfirmationCheckLine[] = lines.map((l) => ({ lineId: l.id, entryId: l.entryId, entryNumber: l.entryNumber, entryDate: l.entryDate, amountCents: l.amountCents, netCents: l.amountCents - (returned.get(l.id) ?? 0), incomeKind: l.incomeKind }));
  const empty = checkLines.find((l) => l.netCents <= 0);
  add('amountPositive', { done: !empty, detail: empty ? { netCents: empty.netCents, entryNumber: empty.entryNumber } : { netCents: checkLines.reduce((s, l) => s + l.netCents, 0) }, remedy: empty ? { href: entryHref(empty.entryId), labelKey: 'openEntry' } : null });

  // 7. Belegt (Annahme 7): Beleg oder „Auszug genügt“ mit Kontoumsatz.
  const undocumented = [...new Set(lines.map((l) => l.entryId))].find((entryId) => entryViewInternal(db, entryId)?.documentation.state === 'missing');
  add('documented', { done: !undocumented, detail: undocumented ? { entryId: undocumented } : {}, remedy: undocumented ? { href: entryHref(undocumented), labelKey: 'attachVoucher' } : null });

  // 8. Sachspende beschrieben (Annahme 11).
  if (kind === 'inKind') {
    const details = db.select().from(financeInKindDetails).where(inArray(financeInKindDetails.lineId, lineIds)).all();
    const incomplete = lines.map((l) => ({ line: l, missing: inKindDetailsMissing(details.find((d) => d.lineId === l.id)) })).find((x) => x.missing.length > 0);
    add('inKindDetails', { done: !incomplete, detail: incomplete ? { lineId: incomplete.line.id, missing: incomplete.missing.join(',') } : {}, remedy: incomplete ? { href: entryHref(incomplete.line.entryId), labelKey: 'describeInKind' } : null });
  } else {
    add('inKindDetails', { applies: false, done: true });
  }

  // 9a. Dokumentart aktiv.
  const docType = documentTypeFor(db, CONFIRMATION_DOCUMENT_TYPE);
  const typeActive = !!docType?.isActive;
  add('typeActive', { done: typeActive, detail: typeActive ? {} : { type: CONFIRMATION_DOCUMENT_TYPE }, remedy: { href: '/admin/dms?panel=types', labelKey: 'activateType' } });

  // 9b. Unterzeichner — sperrt nie: Ohne vollständiges Verfahren entsteht die Bestätigung mit Unterschriftsfeld.
  const expenseWaiver = lines.some((l) => l.incomeKind === 'expenseWaiver');
  const machine = machineProcedureStatusAt(db, args.issuedOn);
  const machineAllowed = kind === 'money' && !expenseWaiver;
  add('signerValid', {
    applies: machineAllowed,
    done: !machineAllowed || machine.complete,
    blocked: false,
    detail: machine.missing.length > 0 ? { missing: machine.missing.join(',') } : {},
    remedy: machineAllowed && !machine.complete ? { href: NOTICES_HREF, labelKey: 'setupMachine' } : null,
    warning: machineAllowed && machine.complete ? null : 'signatureField',
  });

  // E13: Aufwandsspenden nur, solange der Verein sie bestätigt.
  if (expenseWaiver) {
    const enabled = readSetting<boolean>(deps, 'finance.expenseWaiversEnabled');
    add('expenseWaiverEnabled', { done: enabled, remedy: { href: '/admin/finance', labelKey: 'enableExpenseWaivers' } });
  } else {
    add('expenseWaiverEnabled', { applies: false, done: true });
  }

  return ok({
    kind,
    contactId,
    lines: checkLines,
    checks,
    ok: checks.every((c) => !c.blocked),
    warnings,
    notice: valid ? { id: valid.notice.id, kind: valid.notice.kind, noticeDate: valid.notice.noticeDate, validUntil: valid.validUntil } : null,
    machine,
    expenseWaiver,
  });
}

/** Die erste sperrende Prüfung als Fachfehler — für `issueConfirmation` und `afterIssue`. */
export function checkFailure(result: ConfirmationCheckResult): Failure | null {
  const blocked = result.checks.find((c) => c.blocked);
  if (!blocked) return null;
  const d = blocked.detail;
  switch (blocked.key) {
    case 'final':
      return financeConflict(d.state === 'draft' ? 'confirmationLineNotFinal' : 'confirmationLineReversed');
    case 'certifiable':
      return financeConflict('confirmationIncomeNotCertifiable', { category: String(d.category ?? '') });
    case 'contactComplete':
      return financeConflict('confirmationContactIncomplete');
    case 'notConfirmed':
      return financeConflict('confirmationLineAlreadyConfirmed', { number: String(d.number ?? '') });
    case 'noticeValid':
      return financeConflict('noNoticeValidAt', { date: String(d.date ?? '') });
    case 'amountPositive':
      return financeConflict('confirmationAmountNotPositive');
    case 'documented':
      return financeConflict('confirmationEntryUndocumented');
    case 'inKindDetails':
      return financeConflict('confirmationInKindDetailsMissing');
    case 'typeActive':
      return financeConflict('confirmationTypeInactive');
    case 'expenseWaiverEnabled':
      return financeConflict('confirmationExpenseWaiversDisabled');
    case 'signerValid':
      return null;
  }
}

export const checkSchema = z.object({
  lineIds: z.array(z.string().min(1)).min(1).max(1000),
  issuedOn: z.iso.date().optional(),
  kind: z.enum(['money', 'inKind', 'collective']).optional(),
});

/** `finance.read`: die Prüfliste für eine oder mehrere Zuwendungszeilen desselben Kontakts; Vorgabe für den Tag ist heute. */
export async function checkConfirmable(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ConfirmationCheckResult>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, checkSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  return checkConfirmableInternal(deps.db, deps, { lineIds: v.lineIds, issuedOn: v.issuedOn ?? isoNow(deps.clock).slice(0, 10), kind: v.kind });
}
