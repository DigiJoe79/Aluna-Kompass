import { invalid, notFound, ok, readSetting, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { contacts, type ContactRow } from '@kompass/module-contacts';
import { documentTypeFor } from '@kompass/module-dms';
import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { CERTIFIABLE_INCOME_KINDS } from '../ledger/codes';
import { entryViewInternal } from '../ledger/entries';
import { noticeValidAt } from '../ledger/notice-validity';
import {
  financeAllocationLines, financeCategories, financeConfirmationLines, financeConfirmations, financeEntries, financeInKindDetails, financeMoneyLines, financeNotices, financeNotReturnMarks,
  type FinanceAllocationLineRow, type FinanceInKindDetailsRow, type FinanceNoticeRow,
} from '../schema';
import { machineProcedureStatusAt, type MachineProcedureStatus } from './machine';
import { exemptionStartInternal } from './notices';
import { CONFIRMATION_DOCUMENT_TYPE } from './templates/shared';

/**
 * Die Prüfliste vor dem Ausstellen (F6a Task 5, Spec 7.2): die neun Prüfungen
 * der Spec als elf Schlüssel — Nr. 1 „festgeschrieben“, 2 „bescheinigungsfähig“,
 * 3 „Kontakt vollständig“, 4 „nicht schon bestätigt“, 5 „Bescheid gültig“
 * und 5b „nicht vor Beginn der Steuerbefreiung“ (N4),
 * 6 „Betrag nach Rückläufern“, 7 „belegt“, 8 „Sachspende beschrieben“,
 * 9 „Dokumentart aktiv“ und „Unterzeichner“; dazu der Schalter der
 * Aufwandsspenden (E13) und die Vereinsanschrift, die jede Bestätigung
 * trägt — fehlt sie, soll die Prüfliste es sagen, nicht erst das Rendern. Eine Checkliste, kein Fehler: Jede Prüfung sagt, ob
 * sie erfüllt ist, ob sie sperrt und wo es weitergeht. Dieselbe Funktion läuft
 * vor dem Rendern und erneut in `afterIssue`.
 */
export const CONFIRMATION_CHECK_KEYS = ['final', 'certifiable', 'contactComplete', 'organizationAddress', 'notConfirmed', 'noticeValid', 'afterExemptionStart', 'issuedAfterDonation', 'noticeComplete', 'amountPositive', 'possibleReturnWithoutOrigin', 'returnDraftPending', 'documented', 'inKindDetails', 'typeActive', 'signerValid', 'expenseWaiverEnabled'] as const;
export type ConfirmationCheckKey = (typeof CONFIRMATION_CHECK_KEYS)[number];
export type ConfirmationWarning = 'organization' | 'foreignCountry';

/** N4: eine Buchung, die eine Bestätigung sperrt — die Auszahlung ohne Bezug oder der Rückgabe-Entwurf. */
export interface ConfirmationBlockingEntry {
  entryId: string;
  entryNumber: string | null;
  entryDate: string;
  amountCents: number;
  href: string;
}

export interface ConfirmationCheck {
  key: ConfirmationCheckKey;
  /** Trifft die Prüfung auf diese Zuwendung zu? Sachspende und Aufwandsspende nur bei ihrer Art; der Unterzeichner nur, wo maschinell erlaubt ist. */
  applies: boolean;
  done: boolean;
  blocked: boolean;
  /** N4: `entries` nennt alle sperrenden Buchungen (`possibleReturnWithoutOrigin`, `returnDraftPending`), sonst Einzelwerte. */
  detail: Record<string, string | number | null | ConfirmationBlockingEntry[]>;
  /** Wo es weitergeht — `labelKey` ist ein Schlüssel der Oberfläche (F6a Task 7). */
  remedy: { href: string | null; labelKey: string } | null;
  /** `organization` | `foreignCountry` | `signatureField` — ein Hinweis, der nie sperrt. */
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
  /** Befund 30b/AC: `possibleReturnWithoutOrigin`, wenn eine Auszahlung an den Kontakt ohne `originLineId` existiert — nur in der unbescheinigten Liste gesetzt. */
  warnings?: ('possibleReturnWithoutOrigin' | 'returnDraftPending')[];
  /** Befund 59: Datum nach heute (Zeitzone des Vereins) — noch nicht ausstellbar; nur in der unbescheinigten Liste gesetzt. */
  inFuture?: true;
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

/**
 * MA (MCP-Prüfer 2026-09-27): Rückgabe-Entwürfe — noch nicht festgeschriebene Buchungen mit einer Zeile, deren
 * `originLineId` auf eine dieser Zeilen zeigt. Solange einer liegt, ist offen, ob die Zuwendung bleibt: Die
 * Bestätigung sperrt (Voraussetzung, keine Warnung). Ergebnis: Zeile → Buchung des (ersten) Entwurfs.
 */
export function returnDraftsInternal(db: DbOrTx, lineIds: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (lineIds.length === 0) return out;
  const rows = db
    .select({ originLineId: financeAllocationLines.originLineId, entryId: financeEntries.id })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
    .where(and(inArray(financeAllocationLines.originLineId, [...lineIds]), eq(financeEntries.status, 'draft')))
    .all();
  for (const r of rows) if (!out.has(r.originLineId!)) out.set(r.originLineId!, r.entryId);
  return out;
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

/**
 * Befund 30b, erweitert mit AC: eine festgeschriebene, nicht zurückgenommene
 * Auszahlung an denselben Kontakt — am Spendentag oder danach, höchstens so hoch
 * wie die Zuwendung, ohne `originLineId` und nicht als „ist keine Rückgabe“
 * gekennzeichnet (`financeNotReturnMarks`). Möglicherweise eine Rückzahlung
 * oder Rücklastschrift, nur ohne Bezug gebucht — `returnedCentsInternal` zählt
 * sie deshalb nicht, und eine Bestätigung über den vollen Betrag wäre zu hoch.
 * Früher nur gleich hohe Rücklastschriften mit Rückgabe-Code; eine
 * PayPal-Teilrückzahlung fiel durch. Auszahlung heißt: Die Buchung hat eine
 * ausgehende Geldzeile — Verzicht und Sachspende ohne Geldfluss zählen nicht,
 * und nie die Buchung der Zuwendung selbst. Ergebnis: Zuwendungszeile → die
 * früheste solche Auszahlung (Nummer und Buchung für den Weg dorthin).
 */
export function possibleReturnsWithoutOriginInternal(db: DbOrTx, lines: readonly { lineId: string; contactId: string | null; amountCents: number }[], all?: Map<string, ConfirmationBlockingEntry[]>): Map<string, { entryId: string; entryNumber: string | null }> {
  const out = new Map<string, { entryId: string; entryNumber: string | null }>();
  const gifts = lines.filter((l): l is { lineId: string; contactId: string; amountCents: number } => l.contactId !== null && l.amountCents > 0);
  if (gifts.length === 0) return out;
  const giftEntries = new Map(
    db.select({ id: financeAllocationLines.id, entryId: financeAllocationLines.entryId, entryDate: financeEntries.entryDate })
      .from(financeAllocationLines).innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
      .where(inArray(financeAllocationLines.id, gifts.map((g) => g.lineId))).all()
      .map((r) => [r.id, r] as const),
  );
  const payments = db
    .select({ entryId: financeEntries.id, entryNumber: financeEntries.number, entryDate: financeEntries.entryDate, contactId: financeAllocationLines.contactId, amountCents: financeAllocationLines.amountCents })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .leftJoin(financeNotReturnMarks, and(eq(financeNotReturnMarks.entryId, financeEntries.id), isNull(financeNotReturnMarks.revokedAt)))
    .where(and(
      inArray(financeAllocationLines.contactId, [...new Set(gifts.map((g) => g.contactId))]), lt(financeAllocationLines.amountCents, 0), isNull(financeAllocationLines.originLineId),
      eq(financeEntries.status, 'final'), isNull(financeEntries.reversedByEntryId), isNull(financeEntries.reversesEntryId), isNull(financeNotReturnMarks.entryId),
    ))
    .all();
  if (payments.length === 0) return out;
  const paying = new Set(
    db.select({ entryId: financeMoneyLines.entryId }).from(financeMoneyLines)
      .where(and(inArray(financeMoneyLines.entryId, [...new Set(payments.map((p) => p.entryId))]), lt(financeMoneyLines.amountCents, 0))).all()
      .map((r) => r.entryId),
  );
  const ordered = payments.filter((p) => paying.has(p.entryId)).sort((a, b) => a.entryDate.localeCompare(b.entryDate) || (a.entryNumber ?? '').localeCompare(b.entryNumber ?? ''));
  for (const g of gifts) {
    const gift = giftEntries.get(g.lineId);
    if (!gift) continue;
    const hit = ordered.find((p) => p.contactId === g.contactId && p.entryId !== gift.entryId && p.entryDate >= gift.entryDate && -p.amountCents <= g.amountCents);
    if (hit) out.set(g.lineId, { entryId: hit.entryId, entryNumber: hit.entryNumber });
    if (all) {
      const hits = ordered.filter((p) => p.contactId === g.contactId && p.entryId !== gift.entryId && p.entryDate >= gift.entryDate && -p.amountCents <= g.amountCents);
      const seen = new Set<string>();
      all.set(g.lineId, hits.filter((p) => !seen.has(p.entryId) && seen.add(p.entryId)).map((p) => ({ entryId: p.entryId, entryNumber: p.entryNumber, entryDate: p.entryDate, amountCents: p.amountCents, href: entryHref(p.entryId) })));
    }
  }
  return out;
}

/** N4: wie `possibleReturnsWithoutOriginInternal`, aber je Zuwendungszeile **alle** verdächtigen Auszahlungen, nach Datum. */
export function possibleReturnEntriesInternal(db: DbOrTx, lines: readonly { lineId: string; contactId: string | null; amountCents: number }[]): Map<string, ConfirmationBlockingEntry[]> {
  const all = new Map<string, ConfirmationBlockingEntry[]>();
  possibleReturnsWithoutOriginInternal(db, lines, all);
  return all;
}

/** N4: je Zuwendungszeile alle Rückgabe-Entwürfe, die auf sie zeigen — mit Datum und Betrag, nach Datum. */
export function returnDraftEntriesInternal(db: DbOrTx, lineIds: readonly string[]): Map<string, ConfirmationBlockingEntry[]> {
  const out = new Map<string, ConfirmationBlockingEntry[]>();
  if (lineIds.length === 0) return out;
  const rows = db
    .select({ originLineId: financeAllocationLines.originLineId, entryId: financeEntries.id, entryNumber: financeEntries.number, entryDate: financeEntries.entryDate, amountCents: financeAllocationLines.amountCents })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
    .where(and(inArray(financeAllocationLines.originLineId, [...lineIds]), eq(financeEntries.status, 'draft')))
    .all()
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.entryId.localeCompare(b.entryId));
  for (const r of rows) {
    const list = out.get(r.originLineId!) ?? [];
    if (!list.some((e) => e.entryId === r.entryId)) list.push({ entryId: r.entryId, entryNumber: r.entryNumber, entryDate: r.entryDate, amountCents: r.amountCents, href: entryHref(r.entryId) });
    out.set(r.originLineId!, list);
  }
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

export interface IssuePreconditionsInput {
  /** Der gewünschte Ausstellungstag. */
  issuedOn: string;
  /** Der jüngste Zuwendungstag der Zeilen. */
  lastDonationDate: string;
  /** Der am Ausstellungstag gültige Bescheid — `null`, wenn keiner gültig ist (dann greift `noticeValid`). */
  notice: Pick<FinanceNoticeRow, 'kind' | 'purposesTextAccusative'> | null;
}

export interface IssuePreconditionsResult {
  /** Befund 17: das Ausstellen prüfte dies bisher, die Prüfliste nicht — jetzt beide über diese Funktion. */
  beforeDonation: boolean;
  /** Ergänzung 2026-09-26: ein § 60a-Bescheid ohne den (seit Migration 0027 nur bei neuen Bescheiden pflichtigen) Wortlaut im Akkusativ — das Ausstellen scheitert erst beim Rendern der Vorlage, wenn die Prüfliste das nicht vorwegnimmt. */
  noticeAccusativeMissing: boolean;
}

/**
 * Was das Ausstellen vor dem Rendern zusätzlich zur Prüfliste verlangt hatte
 * (F6a Task 5, Befund 17 und Nachtrag) — jetzt eine gemeinsame reine
 * Funktion für `checkConfirmableInternal` **und** `buildConfirmationInputInternal`,
 * damit Check und Ausstellen nie wieder auseinanderlaufen.
 */
export function issuePreconditions(input: IssuePreconditionsInput): IssuePreconditionsResult {
  return {
    beforeDonation: input.issuedOn < input.lastDonationDate,
    noticeAccusativeMissing: input.notice !== null && input.notice.kind === 'section60a' && !clean(input.notice.purposesTextAccusative),
  };
}

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

  // 3b. Name und Anschrift des Vereins — sie stehen auf jeder Bestätigung (Verwaltung → Stammdaten).
  const organizationMissing = (['name', 'street', 'postalCode', 'city'] as const).filter((field) => !clean(readSetting<string>(deps, `organization.${field}`)));
  add('organizationAddress', { done: organizationMissing.length === 0, detail: organizationMissing.length > 0 ? { missing: organizationMissing.join(',') } : {}, remedy: { href: '/admin/settings', labelKey: 'completeOrganization' } });

  // 4. In keiner gültigen Bestätigung (der partielle Unique-Index ist die letzte Wache).
  const open = openConfirmationsForLinesInternal(db, lineIds);
  const confirmed = lineIds.map((id) => open.get(id)).find((c) => c !== undefined);
  add('notConfirmed', { done: !confirmed, detail: confirmed ? { number: confirmed.number, confirmationId: confirmed.confirmationId } : {}, remedy: confirmed ? { href: `/finance/donations?confirmation=${confirmed.confirmationId}`, labelKey: 'openConfirmation' } : null });

  // 5. Am Ausstellungstag ein gültiger Bescheid.
  const notices = db.select().from(financeNotices).all();
  const valid = noticeValidAt(notices, args.issuedOn);
  add('noticeValid', { done: valid !== null, detail: valid ? { noticeId: valid.notice.id, validUntil: valid.validUntil } : { date: args.issuedOn }, remedy: { href: NOTICES_HREF, labelKey: 'recordNotice' } });

  // 5b. Zuwendung nicht vor Beginn der Steuerbefreiung (BMF 07.11.2013 Nr. 14): sperrt, keine Begründung heilt das.
  const exemptFrom = exemptionStartInternal(db);
  const early = exemptFrom === null ? undefined : lines.find((l) => l.entryDate < exemptFrom);
  add('afterExemptionStart', { done: !early, detail: early ? { exemptFrom, entryDate: early.entryDate } : {}, remedy: early ? { href: NOTICES_HREF, labelKey: 'checkExemptionStart' } : null });

  // 5c/5d. Dieselbe Prüfung, die sonst erst das Ausstellen träfe (Befund 17 und Nachtrag).
  const lastDonationDate = lines.at(-1)!.entryDate;
  const pre = issuePreconditions({ issuedOn: args.issuedOn, lastDonationDate, notice: valid ? valid.notice : null });
  add('issuedAfterDonation', { done: !pre.beforeDonation, detail: pre.beforeDonation ? { issuedOn: args.issuedOn, lastDonationDate } : {}, remedy: pre.beforeDonation ? { href: null, labelKey: 'fixIssuedOn' } : null });
  add('noticeComplete', {
    // Nur bei einem § 60a-Bescheid ist der Wortlaut im Akkusativ überhaupt Pflicht (N8) — sonst wie `inKindDetails`/`expenseWaiverEnabled` „trifft nicht zu“.
    applies: valid !== null && valid.notice.kind === 'section60a',
    done: !pre.noticeAccusativeMissing,
    detail: pre.noticeAccusativeMissing ? { noticeId: valid!.notice.id } : {},
    remedy: pre.noticeAccusativeMissing ? { href: NOTICES_HREF, labelKey: 'completeNoticePurposes' } : null,
  });

  // 6. Betrag abzüglich Rückläufern > 0 — je Zeile.
  const returned = returnedCentsInternal(db, lineIds);
  const checkLines: ConfirmationCheckLine[] = lines.map((l) => ({ lineId: l.id, entryId: l.entryId, entryNumber: l.entryNumber, entryDate: l.entryDate, amountCents: l.amountCents, netCents: l.amountCents - (returned.get(l.id) ?? 0), incomeKind: l.incomeKind }));
  const empty = checkLines.find((l) => l.netCents <= 0);
  add('amountPositive', { done: !empty, detail: empty ? { netCents: empty.netCents, entryNumber: empty.entryNumber } : { netCents: checkLines.reduce((s, l) => s + l.netCents, 0) }, remedy: empty ? { href: entryHref(empty.entryId), labelKey: 'openEntry' } : null });

  // 6b. Befund 3, Nachtrag 3: kein möglicher Rückläufer ohne Bezug — dieselbe Erkennung wie in der unbescheinigten Liste (dort nur Warnung), hier sperrend.
  // AC: Detail und Weg führen zur verdächtigen Auszahlung — dort wird sie verknüpft oder als „ist keine Rückgabe“ gekennzeichnet.
  // N4: alle verdächtigen Auszahlungen, die Abhilfe auf die erste.
  const blockingOf = (byLine: Map<string, ConfirmationBlockingEntry[]>) => {
    const seen = new Set<string>();
    return lines.flatMap((l) => byLine.get(l.id) ?? []).filter((e) => !seen.has(e.entryId) && seen.add(e.entryId)).sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.entryId.localeCompare(b.entryId));
  };
  const possibleReturns = blockingOf(possibleReturnEntriesInternal(db, lines.map((l) => ({ lineId: l.id, contactId: l.contactId, amountCents: l.amountCents }))));
  const firstReturn = possibleReturns[0];
  add('possibleReturnWithoutOrigin', { done: !firstReturn, detail: firstReturn ? { entryNumber: firstReturn.entryNumber, entries: possibleReturns } : {}, remedy: firstReturn ? { href: firstReturn.href, labelKey: 'openEntry' } : null });

  // 6c. MA: Liegt eine Rückgabe als Entwurf vor, ist offen, ob die Zuwendung bleibt — festschreiben oder verwerfen, erst dann bestätigen.
  // N4: genannt werden die Entwürfe (nicht die Spende), alle.
  const returnDrafts = blockingOf(returnDraftEntriesInternal(db, lineIds));
  const firstDraft = returnDrafts[0];
  add('returnDraftPending', { done: !firstDraft, detail: firstDraft ? { entryNumber: firstDraft.entryNumber, entries: returnDrafts } : {}, remedy: firstDraft ? { href: firstDraft.href, labelKey: 'openReturnDraft' } : null });

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
  // R 10b.1 Abs. 4 S. 3 EStR: Die Regelung gilt nicht für Sach- und Aufwandsspenden.
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
    case 'organizationAddress':
      return financeConflict('confirmationOrganizationIncomplete');
    case 'notConfirmed':
      return financeConflict('confirmationLineAlreadyConfirmed', { number: String(d.number ?? '') });
    case 'noticeValid':
      return financeConflict('noNoticeValidAt', { date: String(d.date ?? '') });
    case 'afterExemptionStart':
      return financeConflict('confirmationBeforeExemptionStart', { entryDate: String(d.entryDate ?? ''), exemptFrom: String(d.exemptFrom ?? '') });
    case 'issuedAfterDonation':
      return invalid([{ path: 'issuedOn', message: 'beforeDonation' }]);
    case 'noticeComplete':
      return invalid([{ path: 'notice.purposesTextAccusative', message: 'purposesTextAccusativeRequired' }]);
    case 'amountPositive':
      return financeConflict('confirmationAmountNotPositive');
    case 'possibleReturnWithoutOrigin':
      return financeConflict('confirmationPossibleReturnWithoutOrigin');
    case 'returnDraftPending':
      return financeConflict('confirmationReturnDraftPending');
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
  return checkConfirmableInternal(deps.db, deps, { lineIds: v.lineIds, issuedOn: v.issuedOn ?? todayIn(deps), kind: v.kind });
}
