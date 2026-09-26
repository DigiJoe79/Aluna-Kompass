import { buildContext, invalid, isoNow, newId, notFound, ok, prepare, readSetting, requirePermission, systemContext, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { addContactRole, contactRoles, contacts, displayName, type ContactRow } from '@kompass/module-contacts';
import { abortIssue, abortReceive, issueGeneratedDocument, readLinkedDocument, receiveGeneratedUpload } from '@kompass/module-dms';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { CERTIFIABLE_INCOME_KINDS } from '../ledger/codes';
import {
  financeAllocationLines,
  financeCategories,
  financeConfirmationLines,
  financeConfirmations,
  financeEntries,
  financeInKindDetails,
  financeNotices,
  financeSigners,
  type FinanceConfirmationRow,
  type FinanceNoticeRow,
} from '../schema';
import { checkConfirmableInternal, checkFailure, isForeignCountry, missingContactFields, openConfirmationsForLinesInternal, returnedCentsInternal, type ConfirmationCheckLine, type ConfirmationCheckResult } from './check';
import { readFacsimileInternal } from './machine';
import type { CollectiveConfirmationInput, ConfirmationTemplateKey, InKindConfirmationInput, MoneyConfirmationInput } from './templates/shared';
import { toCorrectReasonsInternal, type ToCorrectReason } from './to-correct';

/**
 * Zuwendungsbestätigungen (F6a Task 5, Spec 7.2): ausstellen über die Akte,
 * zurücknehmen mit Rückholspur, Versandvermerk, unterschriebene Fassung,
 * Listen. Unser Exemplar ist das ausgestellte Dokument der Art
 * `finance-confirmation`; der Datensatz trägt, was die Akte nicht weiß.
 * Ins Protokoll kommen nie Kontakt, Name, Anschrift oder Begründung.
 */
export type ConfirmationKind = 'money' | 'inKind' | 'collective';

export interface ConfirmationLineView {
  lineId: string;
  entryId: string;
  entryNumber: string | null;
  amountCents: number;
  releasedAt: string | null;
}

export interface ConfirmationView extends FinanceConfirmationRow {
  lines: ConfirmationLineView[];
  contactName: string;
  toCorrect: ToCorrectReason[];
  /** `signed`: unterschriebene Fassung abgelegt; `machine`: maschinell erstellt; sonst fehlt die Unterschrift (Vierschritt). */
  signatureState: 'machine' | 'needsSignature' | 'signed';
  state: 'valid' | 'voided';
}

const today = (deps: Deps) => isoNow(deps.clock).slice(0, 10);

/** Für den Betreff der Akte — ohne Personennamen (Principle 3). */
const KIND_LABEL: Record<ConfirmationKind, string> = { money: 'Geldzuwendung', inKind: 'Sachzuwendung', collective: 'Sammelbestätigung' };
const TEMPLATE_KEY: Record<ConfirmationKind, ConfirmationTemplateKey> = { money: 'finance-confirmation-money', inKind: 'finance-confirmation-in-kind', collective: 'finance-confirmation-collective' };

const signatureStateOf = (row: FinanceConfirmationRow): ConfirmationView['signatureState'] => (row.signedDocumentId ? 'signed' : row.machine ? 'machine' : 'needsSignature');

function viewsInternal(db: DbOrTx, rows: readonly FinanceConfirmationRow[]): ConfirmationView[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const lineRows = db
    .select({ confirmationId: financeConfirmationLines.confirmationId, lineId: financeConfirmationLines.lineId, amountCents: financeConfirmationLines.amountCents, releasedAt: financeConfirmationLines.releasedAt, entryId: financeEntries.id, entryNumber: financeEntries.number, entryDate: financeEntries.entryDate })
    .from(financeConfirmationLines)
    .innerJoin(financeAllocationLines, eq(financeConfirmationLines.lineId, financeAllocationLines.id))
    .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
    .where(inArray(financeConfirmationLines.confirmationId, ids))
    .all()
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || (a.entryNumber ?? '').localeCompare(b.entryNumber ?? ''));
  const contactIds = [...new Set(rows.map((r) => r.contactId))];
  const names = new Map(db.select().from(contacts).where(inArray(contacts.id, contactIds)).all().map((c) => [c.id, displayName(c)] as const));
  return rows.map((row) => ({
    ...row,
    lines: lineRows.filter((l) => l.confirmationId === row.id).map(({ lineId, entryId, entryNumber, amountCents, releasedAt }) => ({ lineId, entryId, entryNumber, amountCents, releasedAt })),
    contactName: names.get(row.contactId) ?? '',
    toCorrect: toCorrectReasonsInternal(db, row),
    signatureState: signatureStateOf(row),
    state: row.voidedAt ? 'voided' : 'valid',
  }));
}

function viewInternal(db: DbOrTx, id: string): ConfirmationView | null {
  const row = db.select().from(financeConfirmations).where(eq(financeConfirmations.id, id)).get();
  return row ? viewsInternal(db, [row])[0]! : null;
}

const auditOfIssue = (row: FinanceConfirmationRow, lineCount: number) => ({
  kind: row.kind, noticeId: row.noticeId, documentId: row.documentId, documentNumber: row.documentNumber, issuedOn: row.issuedOn, machine: row.machine,
  signerId: row.signerId, expenseWaiver: row.expenseWaiver, totalCents: row.totalCents, lineCount, channel: row.issuedChannel,
});

// ── Eingabe der Vorlagen ────────────────────────────────────────────────────

const clean = (v: string | null | undefined) => (v ?? '').trim();

export function organizationParty(deps: Deps): { name: string; addressLines: string[] } {
  const street = clean(readSetting<string>(deps, 'organization.street'));
  const cityLine = [clean(readSetting<string>(deps, 'organization.postalCode')), clean(readSetting<string>(deps, 'organization.city'))].filter(Boolean).join(' ');
  return { name: clean(readSetting<string>(deps, 'organization.name')), addressLines: [street, cityLine].filter(Boolean) };
}

/** Name und Anschrift des Zuwendenden — nur aus dem Kontakt selbst (Annahme 4); ein Land außer Deutschland steht in der letzten Zeile. */
function recipientParty(contact: ContactRow): { name: string; addressLines: string[] } {
  const cityLine = [clean(contact.postalCode), clean(contact.city)].filter(Boolean).join(' ');
  const lines = [clean(contact.addressExtra), clean(contact.street), cityLine, isForeignCountry(contact) ? clean(contact.country).toUpperCase() : ''].filter(Boolean);
  return { name: displayName(contact), addressLines: lines };
}

function noticeInput(notice: FinanceNoticeRow) {
  return { kind: notice.kind, taxOffice: notice.taxOffice, taxNumber: notice.taxNumber, noticeDate: notice.noticeDate, assessmentPeriod: notice.assessmentPeriod, purposesText: notice.purposesText, purposesTextAccusative: notice.purposesTextAccusative };
}

// ── ausstellen ──────────────────────────────────────────────────────────────

const issueSchema = z.object({
  lineIds: z.array(z.string().min(1)).min(1).max(1000),
  issuedOn: z.iso.date().optional(),
  kind: z.enum(['money', 'inKind', 'collective']).optional(),
  /** Nur bei `collective`; Vorgabe: erster und letzter Zuwendungstag. */
  periodFrom: z.iso.date().optional(),
  periodTo: z.iso.date().optional(),
});

const isConstraintError = (error: unknown) => typeof (error as { code?: unknown })?.code === 'string' && (error as { code: string }).code.startsWith('SQLITE_CONSTRAINT');

const sumNet = (lines: readonly ConfirmationCheckLine[]) => lines.reduce((s, l) => s + l.netCents, 0);

export interface ConfirmationInputOptions {
  issuedOn: string;
  kind?: ConfirmationKind;
  periodFrom?: string;
  periodTo?: string;
}

/** Was `buildConfirmationInputInternal` für Ausstellen und Vorschau aufbereitet. */
export interface ConfirmationInputBuild {
  kind: ConfirmationKind;
  templateKey: ConfirmationTemplateKey;
  /** Die Eingabe der Vorlage — mit den Bytes des Faksimiles; der Snapshot der Akte behält davon nur Prüfsumme und Typ. */
  input: MoneyConfirmationInput | InKindConfirmationInput | CollectiveConfirmationInput;
  noticeId: string;
  /** Maschinell erlaubt: Geld, keine Aufwandsspende. */
  machineAllowed: boolean;
  /** Maschinell erstellt: erlaubt, Verfahren vollständig, Faksimile gelesen. */
  machine: boolean;
  signerId: string | null;
  facsimileChecksum: string | null;
  totalCents: number;
  periodFrom: string | null;
  periodTo: string | null;
}

/**
 * Die Eingabe der Vorlage aus einer Prüfliste — eine Stelle für
 * `issueConfirmation` und `previewConfirmation`, ohne Rechteprüfung und ohne
 * Schreiben. Prüft, was die Prüfliste nicht weiß (Art zu den Zeilen,
 * Ausstellungstag nach der Zuwendung, Sammelbestätigung in einem Jahr und
 * ihr Zeitraum), dann die erste sperrende Prüfung, und liest das Faksimile
 * nur, wo maschinell erlaubt und das Verfahren vollständig ist.
 */
export async function buildConfirmationInputInternal(deps: Deps, check: ConfirmationCheckResult, opts: ConfirmationInputOptions): Promise<Result<ConfirmationInputBuild>> {
  const { issuedOn } = opts;
  const kind: ConfirmationKind = opts.kind ?? (check.kind === 'inKind' ? 'inKind' : check.lines.length > 1 ? 'collective' : 'money');
  if (kind !== 'collective' && check.lines.length > 1) return invalid([{ path: 'lineIds', message: 'singleLineOnly' }]);
  const dates = check.lines.map((l) => l.entryDate).sort();
  if (issuedOn < dates.at(-1)!) return invalid([{ path: 'issuedOn', message: 'beforeDonation' }]);
  let periodFrom: string | null = null;
  let periodTo: string | null = null;
  if (kind === 'collective') {
    if (new Set(dates.map((d) => d.slice(0, 4))).size > 1) return invalid([{ path: 'lineIds', message: 'linesOfDifferentYears' }]);
    periodFrom = opts.periodFrom ?? dates[0]!;
    periodTo = opts.periodTo ?? dates.at(-1)!;
    if (periodFrom > dates[0]! || periodTo < dates.at(-1)!) return invalid([{ path: 'periodFrom', message: 'outsidePeriod' }]);
  }

  const failure = checkFailure(check);
  if (failure) return failure;
  if (!check.notice) return financeConflict('noNoticeValidAt', { date: issuedOn });

  const contact = deps.db.select().from(contacts).where(eq(contacts.id, check.contactId)).get();
  if (!contact) return notFound('contact', check.contactId);
  const notice = deps.db.select().from(financeNotices).where(eq(financeNotices.id, check.notice.id)).get()!;
  // R 10b.1 Abs. 4 S. 3 EStR: Die Regelung gilt nicht für Sach- und Aufwandsspenden.
  const machineAllowed = kind !== 'inKind' && !check.expenseWaiver;
  const signerRow = machineAllowed && check.machine.complete && check.machine.signer ? deps.db.select().from(financeSigners).where(eq(financeSigners.id, check.machine.signer.id)).get() : undefined;
  const facsimile = signerRow ? await readFacsimileInternal(deps, signerRow) : null;
  const machine = !!signerRow && !!facsimile;
  const signerName = check.machine.signer?.signerName ?? null;
  const totalCents = sumNet(check.lines);

  const common = {
    organization: organizationParty(deps),
    recipient: recipientParty(contact),
    notice: noticeInput(notice),
    place: clean(readSetting<string>(deps, 'organization.city')),
    issuedOn,
    machine,
    signerName,
    machineNotifiedOn: machine ? signerRow!.notifiedOn : null,
    // Eine Kopie mit eigenem ArrayBuffer — das Eingabeschema der Vorlagen verlangt ihn.
    ...(machine ? { facsimile: { ...facsimile!, bytes: new Uint8Array(facsimile!.bytes) } } : {}),
  };
  const membershipFeesCertifiable = readSetting<boolean>(deps, 'finance.membershipFeesCertifiable');
  let input: MoneyConfirmationInput | InKindConfirmationInput | CollectiveConfirmationInput;
  if (kind === 'money') {
    const line = check.lines[0]!;
    input = { ...common, membershipFeesCertifiable, amountCents: line.netCents, donatedOn: line.entryDate, expenseWaiver: check.expenseWaiver } satisfies MoneyConfirmationInput;
  } else if (kind === 'inKind') {
    const line = check.lines[0]!;
    const details = deps.db.select().from(financeInKindDetails).where(eq(financeInKindDetails.lineId, line.lineId)).get()!;
    input = {
      ...common, amountCents: line.netCents, donatedOn: line.entryDate, item: details.item, condition: details.condition, valuation: details.valuation, origin: details.origin,
      withdrawalValueCents: details.withdrawalValueCents, vatCents: details.vatCents,
    } satisfies InKindConfirmationInput;
  } else {
    input = {
      ...common, membershipFeesCertifiable, periodFrom: periodFrom!, periodTo: periodTo!,
      lines: check.lines.map((l) => ({ donatedOn: l.entryDate, kind: l.incomeKind === 'membershipFee' ? ('membershipFee' as const) : ('donation' as const), expenseWaiver: l.incomeKind === 'expenseWaiver', amountCents: l.netCents })),
    } satisfies CollectiveConfirmationInput;
  }

  return ok({
    kind, templateKey: TEMPLATE_KEY[kind], input, noticeId: notice.id, machineAllowed, machine,
    signerId: machine ? signerRow!.id : null, facsimileChecksum: machine ? facsimile!.checksum : null, totalCents, periodFrom, periodTo,
  });
}

/**
 * Bestätigung ausstellen — `finance.donationsIssue`, **`humanOnly`**. Die
 * Prüfliste läuft vor dem Rendern und erneut in `afterIssue`; sperrt eine
 * Prüfung, kommt ihr Fachfehler zurück, und es entsteht nichts. Maschinell
 * (Faksimile, Hinweis) nur mit vollständigem Verfahren und nie bei Sach- oder
 * Aufwandsspenden — sonst mit Unterschriftsfeld. Der Kontakt bekommt die Rolle
 * `donor`, falls sie noch nicht läuft.
 */
export async function issueConfirmation(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ConfirmationView>> {
  const denied = requirePermission(ctx, 'finance.donationsIssue');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, issueSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const issuedOn = v.issuedOn ?? today(deps);
  if (issuedOn > today(deps)) return invalid([{ path: 'issuedOn', message: 'inFuture' }]);
  const lineIds = [...new Set(v.lineIds)];

  const checked = checkConfirmableInternal(deps.db, deps, { lineIds, issuedOn, kind: v.kind });
  if (!checked.ok) return checked;
  const check = checked.value;

  const prepared = await buildConfirmationInputInternal(deps, check, { issuedOn, kind: v.kind, periodFrom: v.periodFrom, periodTo: v.periodTo });
  if (!prepared.ok) return prepared;
  const { kind, templateKey, input: templateInput, noticeId, machineAllowed, machine, signerId, facsimileChecksum, totalCents, periodFrom, periodTo } = prepared.value;

  const confirmationId = newId();
  const entryIds = [...new Set(check.lines.map((l) => l.entryId))];
  const unchanged = (fresh: ConfirmationCheckResult) => fresh.notice?.id === noticeId && sumNet(fresh.lines) === totalCents && (machineAllowed ? fresh.machine.complete === check.machine.complete && fresh.machine.signer?.id === check.machine.signer?.id : true);

  const result = await issueGeneratedDocument<string>(deps, ctx, {
    templateKey,
    input: templateInput,
    subject: `Zuwendungsbestätigung ${KIND_LABEL[kind]} ${issuedOn}`,
    documentDate: issuedOn,
    links: [{ entityType: 'financeConfirmation', entityId: confirmationId }, ...entryIds.map((entryId) => ({ entityType: 'financeEntry', entityId: entryId }))],
    afterIssue: (tx, doc) => {
      // Zwischen Rendern und Transaktion vergeht Zeit — dieselbe Prüfliste noch einmal (Spec 7.2).
      const fresh = checkConfirmableInternal(tx, deps, { lineIds, issuedOn, kind: v.kind });
      if (!fresh.ok) return abortIssue(fresh);
      const freshFailure = checkFailure(fresh.value);
      if (freshFailure) return abortIssue(freshFailure);
      if (!unchanged(fresh.value)) return abortIssue(financeConflict('confirmationChangedMeanwhile'));

      const row: FinanceConfirmationRow = {
        id: confirmationId, kind, contactId: check.contactId, noticeId, documentId: doc.id, documentNumber: doc.number, issuedOn,
        issuedByUserId: ctx.userId ?? 'system', issuedChannel: ctx.channel, machine, signerId, facsimileChecksum,
        expenseWaiver: check.expenseWaiver, totalCents, periodFrom, periodTo,
        signedDocumentId: null, sentAt: null, sentVia: null, voidedAt: null, voidedByUserId: null, voidNote: null, sentBeforeVoid: null, originalReturnedOn: null, taxOfficeInformedOn: null,
        createdAt: isoNow(deps.clock),
      };
      try {
        tx.insert(financeConfirmations).values(row).run();
        for (const line of fresh.value.lines) tx.insert(financeConfirmationLines).values({ id: newId(), confirmationId, lineId: line.lineId, amountCents: line.netCents, releasedAt: null }).run();
      } catch (error) {
        // Der partielle Unique-Index ist die letzte Wache gegen die Doppelausstellung.
        if (!isConstraintError(error)) throw error;
        const other = openConfirmationsForLinesInternal(tx, lineIds);
        return abortIssue(financeConflict('confirmationLineAlreadyConfirmed', { number: [...other.values()][0]?.number ?? '' }));
      }
      financeAudit(tx, deps, ctx, { action: 'finance.confirmation.issue', entity: 'financeConfirmation', id: confirmationId, after: auditOfIssue(row, fresh.value.lines.length), summary: `Zuwendungsbestätigung ${doc.number} ausgestellt` });
      return confirmationId;
    },
  });
  if (!result.ok) return result;

  await ensureDonorRoleInternal(deps, check.contactId, issuedOn);
  return ok(viewInternal(deps.db, confirmationId)!);
}

/**
 * Die Kontaktrolle `donor` setzen, wenn keine läuft — im Systemkontext, weil
 * der Aussteller `contacts.manage` nicht braucht. Scheitert es, bleibt die
 * Bestätigung trotzdem gültig: Die Rolle ist eine Beschriftung, kein Halter
 * (die Frist hängt an der Bestätigung).
 */
async function ensureDonorRoleInternal(deps: Deps, contactId: string, since: string): Promise<void> {
  const running = deps.db.select({ id: contactRoles.id }).from(contactRoles).where(and(eq(contactRoles.contactId, contactId), eq(contactRoles.role, 'donor'), isNull(contactRoles.until))).get();
  if (running) return;
  await addContactRole(deps, { ...systemContext(), permissions: new Set(['contacts.manage']) }, { id: contactId, role: 'donor', since });
}

// ── Vorschau ────────────────────────────────────────────────────────────────

/** Die Nummer auf der Vorschau — keine Nummer der Akte wird verbraucht. */
export const PREVIEW_NUMBER = 'ENTWURF';

/**
 * Die Vorschau im Ausstellen-Dialog — `finance.donationsIssue`, nicht
 * `humanOnly` (sie ändert nichts). Dieselbe Prüfliste und dieselbe Eingabe
 * wie `issueConfirmation`, gerendert mit dem Wasserzeichen ENTWURF und der
 * Nummer ENTWURF. Kein Akteneintrag, kein Protokoll. Liefert Bytes: kein
 * MCP-Werkzeug — ein Agent liest die Prüfliste (`finance_confirmation_check`).
 */
export async function previewConfirmation(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ bytes: Uint8Array; filename: string; mimeType: 'application/pdf' }>> {
  const denied = requirePermission(ctx, 'finance.donationsIssue');
  if (denied) return denied;
  const parsed = validate(deps, issueSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const issuedOn = v.issuedOn ?? today(deps);
  if (issuedOn > today(deps)) return invalid([{ path: 'issuedOn', message: 'inFuture' }]);
  const checked = checkConfirmableInternal(deps.db, deps, { lineIds: [...new Set(v.lineIds)], issuedOn, kind: v.kind });
  if (!checked.ok) return checked;
  const built = await buildConfirmationInputInternal(deps, checked.value, { issuedOn, kind: v.kind, periodFrom: v.periodFrom, periodTo: v.periodTo });
  if (!built.ok) return built;

  const prepared = await prepare(deps, ctx, { templateKey: built.value.templateKey, input: built.value.input }, { number: PREVIEW_NUMBER, issuedOn });
  if (!prepared.ok) return prepared;
  const { built: template, baseId, bodyTypst, images } = prepared.value;
  const context = await buildContext(deps, ctx, PREVIEW_NUMBER, issuedOn);
  const { bytes } = await deps.documents.render({ baseId, bodyTypst, slots: { ...template.slots, draft: true }, context, images });
  return ok({ bytes, filename: 'Zuwendungsbestaetigung-Entwurf.pdf', mimeType: 'application/pdf' });
}

// ── zurücknehmen ────────────────────────────────────────────────────────────

const voidSchema = z.object({
  id: z.string().min(1),
  /** Warum — steht am Datensatz, nie im Protokoll. */
  note: z.string().trim().min(1).max(1000),
  /** „Bereits versandt?“ — dann gehört die Rückholspur dazu. */
  alreadySent: z.boolean(),
  originalReturnedOn: z.iso.date().optional(),
  taxOfficeInformedOn: z.iso.date().optional(),
});

/**
 * Bestätigung zurücknehmen — `finance.donationsIssue`, **`humanOnly`**. Setzt
 * die Rückholspur und gibt alle Zeilen frei (`releasedAt`): Sie sind wieder
 * bestätigbar, Storno und Kontaktkorrektur der Buchung wieder möglich. Unser
 * Exemplar bleibt als Beweis festgeschrieben in der Akte.
 */
export async function voidConfirmation(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ConfirmationView>> {
  const denied = requirePermission(ctx, 'finance.donationsIssue');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, voidSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const before = deps.db.select().from(financeConfirmations).where(eq(financeConfirmations.id, v.id)).get();
  if (!before) return notFound('financeConfirmation', v.id);
  if (before.voidedAt) return financeConflict('confirmationAlreadyVoided');

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    tx.update(financeConfirmations)
      .set({ voidedAt: now, voidedByUserId: ctx.userId ?? 'system', voidNote: v.note, sentBeforeVoid: v.alreadySent, originalReturnedOn: v.originalReturnedOn ?? null, taxOfficeInformedOn: v.taxOfficeInformedOn ?? null })
      .where(eq(financeConfirmations.id, v.id))
      .run();
    tx.update(financeConfirmationLines).set({ releasedAt: now }).where(and(eq(financeConfirmationLines.confirmationId, v.id), isNull(financeConfirmationLines.releasedAt))).run();
    financeAudit(tx, deps, ctx, {
      action: 'finance.confirmation.void', entity: 'financeConfirmation', id: v.id,
      after: { voided: true, sentBeforeVoid: v.alreadySent, originalReturned: v.originalReturnedOn !== undefined, taxOfficeInformed: v.taxOfficeInformedOn !== undefined },
      summary: `Zuwendungsbestätigung ${before.documentNumber} zurückgenommen`,
    });
    return ok(viewInternal(tx, v.id)!);
  });
}

// ── Versand, unterschriebene Fassung ────────────────────────────────────────

const dispatchSchema = z.object({ id: z.string().min(1), sentAt: z.iso.date(), sentVia: z.enum(['post', 'email', 'handed']) });

function loadValid(db: DbOrTx, id: string): Result<FinanceConfirmationRow> {
  const row = db.select().from(financeConfirmations).where(eq(financeConfirmations.id, id)).get();
  if (!row) return notFound('financeConfirmation', id);
  if (row.voidedAt) return financeConflict('confirmationAlreadyVoided');
  return ok(row);
}

/** Versandvermerk — `finance.donationsIssue`, einmal (Annahme 9). Den Versand selbst macht Kompass nicht. */
export async function recordConfirmationDispatch(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ConfirmationView>> {
  const denied = requirePermission(ctx, 'finance.donationsIssue');
  if (denied) return denied;
  const parsed = validate(deps, dispatchSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const loaded = loadValid(deps.db, v.id);
  if (!loaded.ok) return loaded;
  if (loaded.value.sentAt) return financeConflict('confirmationAlreadySent');

  return deps.db.transaction((tx: DbOrTx) => {
    if (!recordDispatchInternal(tx, deps, ctx, loaded.value, v.sentAt, v.sentVia)) return financeConflict('confirmationAlreadySent');
    return ok(viewInternal(tx, v.id)!);
  });
}

/**
 * Den Versandvermerk einer Bestätigung setzen, in der offenen Transaktion —
 * nur, wenn noch keiner steht; `false`, wenn ein anderer schneller war. Auch
 * für den Versandvermerk für alle des Serienlaufs.
 */
export function recordDispatchInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, row: Pick<FinanceConfirmationRow, 'id' | 'documentNumber'>, sentAt: string, sentVia: 'post' | 'email' | 'handed'): boolean {
  const changed = tx.update(financeConfirmations).set({ sentAt, sentVia }).where(and(eq(financeConfirmations.id, row.id), isNull(financeConfirmations.sentAt), isNull(financeConfirmations.voidedAt))).run().changes;
  if (changed !== 1) return false;
  financeAudit(tx, deps, ctx, { action: 'finance.confirmation.dispatch', entity: 'financeConfirmation', id: row.id, after: { sentVia }, summary: `Versand von ${row.documentNumber} vermerkt` });
  return true;
}

const signedSchema = z.object({
  id: z.string().min(1),
  bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' }),
  /** Wie die Datei hieß — nur für die Oberfläche; die Akte vergibt Nummer und Betreff selbst. */
  fileName: z.string().trim().max(300).optional(),
});

/**
 * Die unterschriebene Fassung als Eingang ablegen (Vierschritt, Schritt 3) —
 * `finance.donationsIssue`, einmal. Art `finance-confirmation-signed` (ZWU,
 * modul-eigen), abgelegt über `receiveGeneratedUpload` im Namen der
 * Bestätigung: Der Aufrufer braucht kein Recht der Akte. Der Betreff nennt
 * die Nummer, keinen Namen.
 */
export async function attachSignedConfirmation(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ConfirmationView>> {
  const denied = requirePermission(ctx, 'finance.donationsIssue');
  if (denied) return denied;
  const parsed = validate(deps, signedSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const loaded = loadValid(deps.db, v.id);
  if (!loaded.ok) return loaded;
  const row = loaded.value;
  if (row.signedDocumentId) return financeConflict('confirmationSignedAlready');

  const result = await receiveGeneratedUpload(deps, ctx, {
    bytes: v.bytes,
    typeKey: 'finance-confirmation-signed',
    subject: `Zuwendungsbestätigung ${row.documentNumber} unterschrieben`,
    documentDate: today(deps),
    links: [{ entityType: 'financeConfirmation', entityId: row.id }],
    afterReceive: (tx, doc) => {
      const changed = tx.update(financeConfirmations).set({ signedDocumentId: doc.id }).where(and(eq(financeConfirmations.id, row.id), isNull(financeConfirmations.signedDocumentId), isNull(financeConfirmations.voidedAt))).run().changes;
      if (changed !== 1) abortReceive(financeConflict('confirmationSignedAlready'));
      financeAudit(tx, deps, ctx, { action: 'finance.confirmation.signed', entity: 'financeConfirmation', id: row.id, after: { signedDocumentId: doc.id }, summary: `Unterschriebene Fassung ${doc.number} zu ${row.documentNumber} abgelegt` });
      return null;
    },
  });
  if (!result.ok) return result;
  return ok(viewInternal(deps.db, row.id)!);
}

// ── unser Exemplar ──────────────────────────────────────────────────────────

const copySchema = z.object({ id: z.string().min(1) });

/**
 * Unser Exemplar als PDF — über den Bezug als Berechtigung der Akte
 * (`financeConfirmation`, Recht `finance.read`), ohne `dms.view`; auch nach
 * der Rücknahme, denn es bleibt als Beweis. Liefert Bytes: kein
 * MCP-Werkzeug (Muster `readCashCountProtocol`).
 */
export async function readConfirmationCopy(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ bytes: Uint8Array; filename: string; number: string | null }>> {
  const parsed = validate(deps, copySchema, input);
  if (!parsed.ok) return parsed;
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const row = deps.db.select().from(financeConfirmations).where(eq(financeConfirmations.id, parsed.value.id)).get();
  if (!row) return notFound('financeConfirmation', parsed.value.id);
  const result = await readLinkedDocument(deps, ctx, { documentId: row.documentId, entityType: 'financeConfirmation', entityId: row.id });
  if (!result.ok) return result;
  return ok({ bytes: result.value.bytes, filename: result.value.filename, number: result.value.record.number });
}

// ── Listen ──────────────────────────────────────────────────────────────────

const listSchema = z.object({
  tab: z.enum(['issued', 'toCorrect', 'needsSignature']),
  contactId: z.string().min(1).optional(),
  year: z.number().int().min(1900).max(2999).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export interface ConfirmationList {
  items: ConfirmationView[];
  total: number;
  /** Je Reiter, mit denselben Filtern (Kontakt, Jahr) — für „Zu korrigieren (n)“. */
  counts: { issued: number; toCorrect: number; needsSignature: number };
}

/**
 * `finance.read`: Ausgestellt (gültige und zurückgenommene, jüngste zuerst),
 * zu korrigieren (berechnet), Unterschrift fehlt (gültig, nicht maschinell,
 * ohne unterschriebene Fassung).
 */
export async function listConfirmations(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ConfirmationList>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input);
  if (!parsed.ok) return parsed;
  const f = parsed.value;

  let rows = deps.db.select().from(financeConfirmations).orderBy(desc(financeConfirmations.issuedOn), desc(financeConfirmations.documentNumber)).all();
  if (f.contactId) rows = rows.filter((r) => r.contactId === f.contactId);
  if (f.year) rows = rows.filter((r) => r.issuedOn.startsWith(`${f.year}-`));
  const toCorrect = rows.filter((r) => toCorrectReasonsInternal(deps.db, r).length > 0);
  const needsSignature = rows.filter((r) => !r.voidedAt && !r.machine && !r.signedDocumentId);
  const selected = f.tab === 'toCorrect' ? toCorrect : f.tab === 'needsSignature' ? needsSignature : rows;
  return ok({
    items: viewsInternal(deps.db, selected.slice(f.offset, f.offset + f.limit)),
    total: selected.length,
    counts: { issued: rows.length, toCorrect: toCorrect.length, needsSignature: needsSignature.length },
  });
}

/** Für die Kachel: gültige Bestätigungen ohne Unterschrift. */
export function countNeedsSignatureInternal(db: DbOrTx): number {
  return db.select({ id: financeConfirmations.id }).from(financeConfirmations).where(and(isNull(financeConfirmations.voidedAt), eq(financeConfirmations.machine, false), isNull(financeConfirmations.signedDocumentId))).all().length;
}

const uncertifiedSchema = z.object({
  /** „Spenden ab {Betrag} ohne Bestätigung“ — gegen die Summe je Kontakt. */
  minCents: z.number().int().min(0).optional(),
  year: z.number().int().min(1900).max(2999).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export interface UncertifiedGroup {
  contactId: string;
  contactName: string;
  contactComplete: boolean;
  lines: ConfirmationCheckLine[];
  sumCents: number;
}

/**
 * `finance.read`: „Noch nicht bestätigt“ — festgeschriebene, nicht
 * zurückgenommene, bescheinigungsfähige Zeilen mit Kontakt und Betrag nach
 * Rückläufern, ohne gültige Bestätigung; je Kontakt gruppiert, mit dem
 * Hinweis, ob die Anschrift reicht.
 */
export async function listUncertifiedDonations(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ groups: UncertifiedGroup[]; total: number }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, uncertifiedSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const f = parsed.value;

  const feesCertifiable = readSetting<boolean>(deps, 'finance.membershipFeesCertifiable');
  const kinds = CERTIFIABLE_INCOME_KINDS.filter((k) => feesCertifiable || k !== 'membershipFee');
  let rows = deps.db
    .select({ lineId: financeAllocationLines.id, entryId: financeEntries.id, entryNumber: financeEntries.number, entryDate: financeEntries.entryDate, amountCents: financeAllocationLines.amountCents, contactId: financeAllocationLines.contactId, incomeKind: financeCategories.incomeKind, reversedByEntryId: financeEntries.reversedByEntryId, reversesEntryId: financeEntries.reversesEntryId })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
    .innerJoin(financeCategories, eq(financeAllocationLines.categoryId, financeCategories.id))
    .where(and(eq(financeEntries.status, 'final'), isNull(financeEntries.reversedByEntryId), isNull(financeEntries.reversesEntryId), inArray(financeCategories.incomeKind, [...kinds])))
    .all()
    .filter((r) => r.amountCents > 0 && r.contactId !== null);
  if (f.year) rows = rows.filter((r) => r.entryDate.startsWith(`${f.year}-`));
  const lineIds = rows.map((r) => r.lineId);
  const open = openConfirmationsForLinesInternal(deps.db, lineIds);
  const returned = returnedCentsInternal(deps.db, lineIds);

  const byContact = new Map<string, ConfirmationCheckLine[]>();
  for (const r of rows) {
    if (open.has(r.lineId)) continue;
    const netCents = r.amountCents - (returned.get(r.lineId) ?? 0);
    if (netCents <= 0) continue;
    const list = byContact.get(r.contactId!) ?? [];
    list.push({ lineId: r.lineId, entryId: r.entryId, entryNumber: r.entryNumber, entryDate: r.entryDate, amountCents: r.amountCents, netCents, incomeKind: r.incomeKind });
    byContact.set(r.contactId!, list);
  }
  const contactRows = byContact.size === 0 ? [] : deps.db.select().from(contacts).where(inArray(contacts.id, [...byContact.keys()])).all();
  const groups = contactRows
    .map((contact) => {
      const lines = byContact.get(contact.id)!.sort((a, b) => a.entryDate.localeCompare(b.entryDate) || (a.entryNumber ?? '').localeCompare(b.entryNumber ?? ''));
      return { contactId: contact.id, contactName: displayName(contact), contactComplete: missingContactFields(contact).length === 0, lines, sumCents: sumNet(lines) };
    })
    .filter((g) => f.minCents === undefined || g.sumCents >= f.minCents)
    .sort((a, b) => a.contactName.localeCompare(b.contactName, 'de'));
  return ok({ groups: groups.slice(f.offset, f.offset + f.limit), total: groups.length });
}
