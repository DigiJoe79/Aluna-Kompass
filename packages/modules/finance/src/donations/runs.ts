import { yearIn, invalid, isoNow, newId, notFound, ok, readSetting, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { contacts, deliveryForContactInternal, displayName } from '@kompass/module-contacts';
import { dmsMailOutbox, documentTypeFor, mailNotReady, manualChannelInternal, movePairToPostInternal, peekDocumentNumber, queueDocumentEmailsInternal, readLinkedDocument, returnPairToEmailInternal, type MailOutboxStatus, type SendPlanItem, type SendPlanReason } from '@kompass/module-dms';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { CERTIFIABLE_INCOME_KINDS } from '../ledger/codes';
import {
  financeAllocationLines,
  financeCategories,
  financeConfirmationLines,
  financeConfirmationRunItems,
  financeConfirmationRuns,
  financeConfirmations,
  financeEntries,
  type FinanceConfirmationRow,
  type FinanceConfirmationRunItemRow,
  type FinanceConfirmationRunRow,
} from '../schema';
import { machineProcedureStatusAt } from './machine';
import { checkConfirmableInternal, openConfirmationsForLinesInternal, possibleReturnsWithoutOriginInternal, returnDraftsInternal, returnedCentsInternal, type ConfirmationCheckKey } from './check';
import { issueConfirmation, recordDispatchInternal } from './confirmations';
import { noticeValidAtInternal } from './notices';
import { CONFIRMATION_DOCUMENT_TYPE } from './templates/shared';

/**
 * Serienlauf, Vorschau (F6b Task 2, Spec 7.4, Annahmen 1–3, 5, 6, 11): eine
 * reine Auswertung, nichts wird geschrieben. Auswahl sind die festgeschriebenen,
 * nicht zurückgenommenen Zeilen bescheinigungsfähiger Einnahmearten mit Kontakt
 * im Jahr, die in keiner gültigen Bestätigung stehen und nach Rückläufern noch
 * etwas wert sind; je Kontakt zählt die Summe gegen den Mindestbetrag. Daraus
 * werden Posten: eine Sammelbestätigung über Geld und Beiträge, eine eigene
 * über Aufwandsspenden (immer mit Unterschriftsfeld) und je Sachspendenzeile
 * eine Einzelbestätigung. Jeder Posten läuft durch dieselbe Prüfliste wie das
 * einzelne Ausstellen. Ein Nachzügler-Lauf braucht keinen eigenen Filter:
 * Bestätigte Zeilen fallen ohnehin heraus.
 */
export type RunItemKind = 'collective' | 'collectiveWaiver' | 'inKind';
export type RunPreviewGroup = 'ready' | 'needsSignature' | 'addressMissing' | 'blocked';
export type RunSignatureReason = 'expenseWaiver' | 'inKind' | 'machineIncomplete';
export type RunBlockedBy = ConfirmationCheckKey;

export interface RunPreviewItem {
  contactId: string;
  contactName: string;
  /** Der Topf des Postens: `collective` (Geld und Beiträge), `collectiveWaiver` (Aufwandsspenden), `inKind` (eine Sachspende). Nicht die Form der Bestätigung — die steht in `issueKind`. */
  kind: RunItemKind;
  /** Was der Lauf tatsächlich ausstellt: bei einer einzigen Zeile eine Einzelbestätigung (`money`), sonst die Sammelbestätigung. */
  issueKind: 'money' | 'inKind' | 'collective';
  inKindLineId: string | null;
  lineIds: string[];
  /** Nach Rückläufern. */
  totalCents: number;
  lineCount: number;
  /** Zeilen desselben Kontakts, Jahres und derselben Art, die schon in einer gültigen Einzelbestätigung stehen — „2 von 3 Zuwendungen; 1 bereits einzeln bestätigt“. */
  alreadyConfirmedSingly: number;
  /** Befund 3, Nachtrag 3: Zeilen mit `possibleReturnWithoutOrigin`, die der Lauf ausgelassen hat — sie bleiben aus der Sammelbestätigung heraus, die übrigen Zeilen des Spenders bleiben drin. */
  excludedPossibleReturn: number;
  /** K1: Zeilen, die erst nach dem Ausstellungstag liegen — ausgelassen und gezählt wie `excludedPossibleReturn`; ein späterer Lauf nimmt sie auf. */
  excludedInFuture: number;
  /** MA: Zeilen, auf die eine Rückgabe als Entwurf zeigt — ausgelassen und gezählt; erst nach Festschreiben oder Verwerfen bescheinigbar. */
  excludedReturnDraft: number;
  group: RunPreviewGroup;
  /**
   * Die sperrende Prüfung (`contactComplete` bei *Anschrift fehlt*); `null`, wenn nichts sperrt.
   * `afterExemptionStart`: eine Zuwendung liegt vor dem Beginn der Steuerbefreiung — gesperrt wie jede andere Prüfung.
   */
  blockedBy: RunBlockedBy | null;
  signatureReason: RunSignatureReason | null;
}

/** N3: warum eine Zeile nicht in den Lauf kommt — möglicher Rückläufer, Rückgabe als Entwurf, Datum nach dem Ausstellungstag. */
export type RunExclusionReason = 'possibleReturn' | 'returnDraft' | 'inFuture';

/**
 * N3: ein Spender mit ausgelassenen Zeilen — auch der, dessen Zeilen alle ausgelassen sind und der deshalb unter
 * den Posten fehlt. `lineCount` zählt seine offenen Zeilen des Jahres (ausgelassen oder nicht); `blockingEntries`
 * sind die Buchungen, die sperren (die Auszahlung, der Rückgabe-Entwurf; bei `inFuture` die Zuwendung selbst).
 */
export interface RunExcludedContact {
  contactId: string;
  contactName: string;
  reasons: RunExclusionReason[];
  excludedLineCount: number;
  lineCount: number;
  excludedCents: number;
  blockingEntries: { entryId: string; entryNumber: string | null; href: string }[];
}

export interface RunBlocked {
  reason: 'noNotice' | 'organizationIncomplete';
  /** Wo es weitergeht — `labelKey` wie in der Prüfliste. */
  remedy: { href: string; labelKey: string };
}

export interface RunPreview {
  year: number;
  minCents: number;
  excludedContactIds: string[];
  /** Ausstellungstag aller Bestätigungen (Annahme 5). */
  issuedOn: string;
  items: RunPreviewItem[];
  /** N3: Spender mit ausgelassenen Zeilen, nach Namen — die Gruppe „Ausgeschlossen“. */
  excluded: RunExcludedContact[];
  counts: Record<RunPreviewGroup, number>;
  /** Sperrt den ganzen Lauf; die Posten stehen trotzdem in der Vorschau. */
  blockedRun: RunBlocked | null;
  /** Die nächste Nummer der Dokumentart und wie viele Bestätigungen der Lauf ausstellen würde — ein Blick, kein Zug. */
  numberRange: { from: string; count: number };
}

export interface RunPreviewArgs {
  year: number;
  /** Vorgabe: `finance.batchMinimumCents`. */
  minCents?: number;
  excludedContactIds?: readonly string[];
  /** Schließt nichts aus — bestätigte Zeilen fallen ohnehin heraus (Annahme 6). */
  followUpOfRunId?: string | null;
}

/** Befund 21: wie beim Einzelausstellen — eine Zeile ergibt die Einzelbestätigung, erst ab zwei die Sammelbestätigung. Sachspenden bleiben einzeln. */
export function issueKindOf(kind: RunItemKind, lineCount: number): 'money' | 'inKind' | 'collective' {
  return kind === 'inKind' ? 'inKind' : lineCount > 1 ? 'collective' : 'money';
}

/** Diese Prüfungen gelten dem Lauf, nicht dem Spender — sie stehen in `blockedRun`, nicht am Posten. */
const RUN_LEVEL_CHECKS: readonly ConfirmationCheckKey[] = ['noticeValid', 'organizationAddress'];
const KIND_ORDER: Record<RunItemKind, number> = { collective: 0, collectiveWaiver: 1, inKind: 2 };

interface SelectedLine {
  lineId: string;
  entryDate: string;
  entryNumber: string | null;
  position: number;
  contactId: string;
  incomeKind: string;
  netCents: number;
}

const itemKindOf = (incomeKind: string): RunItemKind => (incomeKind === 'inKindDonation' ? 'inKind' : incomeKind === 'expenseWaiver' ? 'collectiveWaiver' : 'collective');

function blockedRunInternal(db: DbOrTx, deps: Deps, issuedOn: string): RunBlocked | null {
  if (!noticeValidAtInternal(db, issuedOn)) return { reason: 'noNotice', remedy: { href: '/finance/donations/notices', labelKey: 'recordNotice' } };
  const organizationMissing = (['name', 'street', 'postalCode', 'city'] as const).some((field) => !(readSetting<string>(deps, `organization.${field}`) ?? '').trim());
  if (organizationMissing) return { reason: 'organizationIncomplete', remedy: { href: '/admin/settings', labelKey: 'completeOrganization' } };
  return null;
}

/** Die Vorschau ohne Rechteprüfung — auch für den Start des Laufs, der die Posten beim Start neu ausrechnet. */
export function previewConfirmationRunInternal(db: DbOrTx, deps: Deps, args: RunPreviewArgs, issuedOn: string): RunPreview {
  const minCents = args.minCents ?? readSetting<number>(deps, 'finance.batchMinimumCents');
  const excluded = new Set(args.excludedContactIds ?? []);
  const feesCertifiable = readSetting<boolean>(deps, 'finance.membershipFeesCertifiable');
  const kinds = CERTIFIABLE_INCOME_KINDS.filter((k) => feesCertifiable || k !== 'membershipFee');

  // Annahme 1: festgeschrieben, nicht zurückgenommen, selbst keine Rücknahme, positiv, mit Kontakt, im Jahr.
  const candidates = db
    .select({
      lineId: financeAllocationLines.id,
      entryId: financeEntries.id,
      entryDate: financeEntries.entryDate,
      entryNumber: financeEntries.number,
      position: financeAllocationLines.position,
      contactId: financeAllocationLines.contactId,
      amountCents: financeAllocationLines.amountCents,
      incomeKind: financeCategories.incomeKind,
    })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
    .innerJoin(financeCategories, eq(financeAllocationLines.categoryId, financeCategories.id))
    .where(and(eq(financeEntries.status, 'final'), isNull(financeEntries.reversedByEntryId), isNull(financeEntries.reversesEntryId), inArray(financeCategories.incomeKind, [...kinds])))
    .all()
    .filter((r) => r.amountCents > 0 && r.contactId !== null && !excluded.has(r.contactId) && r.entryDate.startsWith(`${args.year}-`));

  const candidateIds = candidates.map((r) => r.lineId);
  const confirmedKind = new Map<string, string>();
  if (candidateIds.length > 0) {
    const rows = db
      .select({ lineId: financeConfirmationLines.lineId, kind: financeConfirmations.kind })
      .from(financeConfirmationLines)
      .innerJoin(financeConfirmations, eq(financeConfirmationLines.confirmationId, financeConfirmations.id))
      .where(and(inArray(financeConfirmationLines.lineId, candidateIds), isNull(financeConfirmationLines.releasedAt)))
      .all();
    for (const r of rows) confirmedKind.set(r.lineId, r.kind);
  }
  const returned = returnedCentsInternal(db, candidateIds);
  // Befund 3, Nachtrag 3: dieselbe Erkennung wie die unbescheinigte Liste — hier lässt der Lauf die Zeile aus, statt die Sammelbestätigung zu sperren.
  const possibleReturns = possibleReturnsWithoutOriginInternal(db, candidates.map((r) => ({ lineId: r.lineId, contactId: r.contactId, amountCents: r.amountCents })));

  // „bereits einzeln bestätigt“ je Kontakt und Art des Postens.
  const singly = new Map<string, number>();
  const excludedPossibleReturn = new Map<string, number>();
  const excludedInFuture = new Map<string, number>();
  const excludedReturnDraft = new Map<string, number>();
  const returnDrafts = returnDraftsInternal(db, candidateIds);
  const byContact = new Map<string, SelectedLine[]>();
  // N3: je Kontakt, was ausgelassen wurde und warum — damit niemand still aus der Vorschau verschwindet.
  const exclusions = new Map<string, { reasons: Set<RunExclusionReason>; excludedLineCount: number; lineCount: number; excludedCents: number; blocking: Map<string, string | null> }>();
  const exclusionOf = (contactId: string) => {
    let e = exclusions.get(contactId);
    if (!e) exclusions.set(contactId, (e = { reasons: new Set(), excludedLineCount: 0, lineCount: 0, excludedCents: 0, blocking: new Map() }));
    return e;
  };
  const exclude = (contactId: string, reason: RunExclusionReason, cents: number, entryId: string, entryNumber: string | null) => {
    const e = exclusionOf(contactId);
    e.reasons.add(reason);
    e.excludedLineCount += 1;
    e.excludedCents += cents;
    if (!e.blocking.has(entryId)) e.blocking.set(entryId, entryNumber);
  };
  for (const r of candidates) {
    const contactId = r.contactId!;
    const incomeKind = r.incomeKind!;
    const confirmed = confirmedKind.get(r.lineId);
    if (confirmed !== undefined) {
      if (confirmed === 'money') {
        const key = `${contactId}|${itemKindOf(incomeKind)}`;
        singly.set(key, (singly.get(key) ?? 0) + 1);
      }
      continue;
    }
    const netCents = r.amountCents - (returned.get(r.lineId) ?? 0);
    if (netCents <= 0) continue;
    exclusionOf(contactId).lineCount += 1;
    // Was erst nach dem Ausstellungstag liegt, kann eine Bestätigung von diesem Tag nicht tragen (K1: gezählt, nicht still).
    if (r.entryDate > issuedOn) {
      const key = `${contactId}|${itemKindOf(incomeKind)}`;
      excludedInFuture.set(key, (excludedInFuture.get(key) ?? 0) + 1);
      exclude(contactId, 'inFuture', netCents, r.entryId, r.entryNumber);
      continue;
    }
    const draftId = returnDrafts.get(r.lineId);
    if (draftId) {
      const key = `${contactId}|${itemKindOf(incomeKind)}`;
      excludedReturnDraft.set(key, (excludedReturnDraft.get(key) ?? 0) + 1);
      exclude(contactId, 'returnDraft', netCents, draftId, null);
      continue;
    }
    const possible = possibleReturns.get(r.lineId);
    if (possible) {
      const key = `${contactId}|${itemKindOf(incomeKind)}`;
      excludedPossibleReturn.set(key, (excludedPossibleReturn.get(key) ?? 0) + 1);
      exclude(contactId, 'possibleReturn', netCents, possible.entryId, possible.entryNumber);
      continue;
    }
    const list = byContact.get(contactId) ?? [];
    list.push({ lineId: r.lineId, entryDate: r.entryDate, entryNumber: r.entryNumber, position: r.position, contactId, incomeKind, netCents });
    byContact.set(contactId, list);
  }
  for (const [contactId, lines] of byContact) if (lines.reduce((s, l) => s + l.netCents, 0) < minCents) byContact.delete(contactId);

  const excludedIds = [...exclusions].filter(([, e]) => e.excludedLineCount > 0).map(([id]) => id);
  const namedIds = [...new Set([...byContact.keys(), ...excludedIds])];
  const contactRows = namedIds.length === 0 ? [] : db.select().from(contacts).where(inArray(contacts.id, namedIds)).all();
  const names = new Map(contactRows.map((c) => [c.id, displayName(c)]));
  const REASON_ORDER: readonly RunExclusionReason[] = ['possibleReturn', 'returnDraft', 'inFuture'];
  const excludedContacts: RunExcludedContact[] = excludedIds
    .map((contactId) => {
      const e = exclusions.get(contactId)!;
      return {
        contactId,
        contactName: names.get(contactId) ?? '',
        reasons: REASON_ORDER.filter((r) => e.reasons.has(r)),
        excludedLineCount: e.excludedLineCount,
        lineCount: e.lineCount,
        excludedCents: e.excludedCents,
        blockingEntries: [...e.blocking].map(([entryId, entryNumber]) => ({ entryId, entryNumber, href: `/finance/entries/${entryId}` })),
      };
    })
    .sort((a, b) => a.contactName.localeCompare(b.contactName, 'de') || a.contactId.localeCompare(b.contactId));

  const items: (RunPreviewItem & { firstDate: string })[] = [];
  for (const [contactId, all] of byContact) {
    const lines = all.sort((a, b) => a.entryDate.localeCompare(b.entryDate) || (a.entryNumber ?? '').localeCompare(b.entryNumber ?? '') || a.position - b.position);
    const buckets: { kind: RunItemKind; inKindLineId: string | null; lines: SelectedLine[] }[] = [];
    const collective = lines.filter((l) => itemKindOf(l.incomeKind) === 'collective');
    const waiver = lines.filter((l) => itemKindOf(l.incomeKind) === 'collectiveWaiver');
    if (collective.length > 0) buckets.push({ kind: 'collective', inKindLineId: null, lines: collective });
    if (waiver.length > 0) buckets.push({ kind: 'collectiveWaiver', inKindLineId: null, lines: waiver });
    for (const l of lines.filter((x) => x.incomeKind === 'inKindDonation')) buckets.push({ kind: 'inKind', inKindLineId: l.lineId, lines: [l] });

    for (const bucket of buckets) {
      const lineIds = bucket.lines.map((l) => l.lineId);
      const checked = checkConfirmableInternal(db, deps, { lineIds, issuedOn, kind: issueKindOf(bucket.kind, lineIds.length) });
      let group: RunPreviewGroup;
      let blockedBy: RunBlockedBy | null = null;
      let signatureReason: RunSignatureReason | null = null;
      if (!checked.ok) {
        group = 'blocked';
      } else {
        const blocking = checked.value.checks.filter((c) => c.blocked && !RUN_LEVEL_CHECKS.includes(c.key));
        if (blocking.some((c) => c.key === 'contactComplete')) {
          group = 'addressMissing';
          blockedBy = 'contactComplete';
        } else if (blocking.length > 0) {
          group = 'blocked';
          blockedBy = blocking[0]!.key;
        } else {
          // R 10b.1 Abs. 4 S. 3 EStR: Die Regelung gilt nicht für Sach- und Aufwandsspenden.
          signatureReason = bucket.kind === 'collectiveWaiver' ? 'expenseWaiver' : bucket.kind === 'inKind' ? 'inKind' : checked.value.machine.complete ? null : 'machineIncomplete';
          group = signatureReason ? 'needsSignature' : 'ready';
        }
      }
      items.push({
        contactId,
        contactName: names.get(contactId) ?? '',
        kind: bucket.kind,
        issueKind: issueKindOf(bucket.kind, lineIds.length),
        inKindLineId: bucket.inKindLineId,
        lineIds,
        totalCents: bucket.lines.reduce((s, l) => s + l.netCents, 0),
        lineCount: lineIds.length,
        alreadyConfirmedSingly: bucket.kind === 'inKind' ? 0 : (singly.get(`${contactId}|${bucket.kind}`) ?? 0),
        excludedPossibleReturn: bucket.kind === 'inKind' ? 0 : (excludedPossibleReturn.get(`${contactId}|${bucket.kind}`) ?? 0),
        excludedInFuture: bucket.kind === 'inKind' ? 0 : (excludedInFuture.get(`${contactId}|${bucket.kind}`) ?? 0),
        excludedReturnDraft: bucket.kind === 'inKind' ? 0 : (excludedReturnDraft.get(`${contactId}|${bucket.kind}`) ?? 0),
        group,
        blockedBy,
        signatureReason,
        firstDate: bucket.lines[0]!.entryDate,
      });
    }
  }
  items.sort((a, b) => a.contactName.localeCompare(b.contactName, 'de') || a.contactId.localeCompare(b.contactId) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.firstDate.localeCompare(b.firstDate));

  const counts: Record<RunPreviewGroup, number> = { ready: 0, needsSignature: 0, addressMissing: 0, blocked: 0 };
  for (const item of items) counts[item.group] += 1;
  const prefix = documentTypeFor(db, CONFIRMATION_DOCUMENT_TYPE)?.prefix ?? 'ZWB';
  // Die Akte zieht die Nummer im Jahr des Ablegens (`issueGeneratedDocument`), nicht im Jahr der Zuwendungen.
  const numberRange = { from: peekDocumentNumber(db, prefix, yearIn(deps)), count: counts.ready + counts.needsSignature };

  return {
    year: args.year,
    minCents,
    excludedContactIds: [...excluded],
    issuedOn,
    items: items.map(({ firstDate: _firstDate, ...item }) => item),
    excluded: excludedContacts,
    counts,
    blockedRun: blockedRunInternal(db, deps, issuedOn),
    numberRange,
  };
}

export const runArgsSchema = z.object({
  year: z.number().int().min(2000).max(9999),
  minCents: z.number().int().min(0).optional(),
  excludedContactIds: z.array(z.string().min(1)).max(1000).optional(),
  followUpOfRunId: z.string().min(1).optional(),
});

/**
 * `finance.read`: die Posten eines Serienlaufs, bevor er startet —
 * Ausstellungstag heute. Ohne eigene `excludedContactIds` übernimmt die
 * Nachzügler-Vorschau (`followUpOfRunId`) die Ausschlüsse des Ursprungslaufs
 * — wer den Ursprungslauf ausgeschlossen hat, bleibt ohne weiteres Zutun
 * draußen; ein ausdrücklich leeres Feld gilt als eigene Angabe.
 */
export async function previewConfirmationRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<RunPreview>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, runArgsSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const issuedOn = todayIn(deps);
  if (v.year > Number(issuedOn.slice(0, 4))) return invalid([{ path: 'year', message: 'inFuture' }]);
  let origin: FinanceConfirmationRunRow | undefined;
  if (v.followUpOfRunId) {
    origin = deps.db.select().from(financeConfirmationRuns).where(eq(financeConfirmationRuns.id, v.followUpOfRunId)).get();
    if (!origin) return notFound('financeConfirmationRun', v.followUpOfRunId);
  }
  const excludedContactIds = v.excludedContactIds ?? (origin ? (JSON.parse(origin.excludedContactIds) as string[]) : undefined);
  return ok(previewConfirmationRunInternal(deps.db, deps, { ...v, excludedContactIds }, issuedOn));
}

// ── Lauf: starten, fortsetzen, lesen, Versandvermerk für alle (F6b Task 3) ──

export type RunItemState = 'pending' | 'issued' | 'failed' | 'skipped';

/** Ein Posten des Laufs — die Kurzform der Vorschau plus Ausgang. Der Name kommt frisch aus dem Kontakt. */
export interface RunViewItem {
  id: string;
  contactId: string;
  contactName: string;
  kind: RunItemKind;
  inKindLineId: string | null;
  lineIds: string[];
  totalCents: number;
  lineCount: number;
  /** Beim Start: braucht die Bestätigung ein Unterschriftsfeld (Gruppe *braucht Unterschrift*)? */
  needsSignature: boolean;
  state: RunItemState;
  confirmationId: string | null;
  confirmationNumber: string | null;
  errorCode: string | null;
  doneAt: string | null;
}

export interface RunCounts {
  total: number;
  pending: number;
  issued: number;
  failed: number;
  skipped: number;
  /** Ausgestellte Posten, deren Bestätigung maschinell erstellt ist. */
  machine: number;
  /** Ausgestellte Posten, deren Bestätigung ein Unterschriftsfeld trägt. */
  needsSignature: number;
  /** Davon gültig und noch ohne unterschriebene Fassung. */
  missingSignedVersion: number;
}

export interface RunSummary {
  id: string;
  year: number;
  minCents: number;
  excludedCount: number;
  /** Nur lesend — die Kontakte selbst stehen nie im Protokoll, nur ihre Anzahl (`excludedCount`). */
  excludedContactIds: string[];
  followUpOfRunId: string | null;
  startedOn: string;
  startedAt: string;
  finishedAt: string | null;
  dispatchedAt: string | null;
  dispatchedVia: 'post' | 'email' | 'handed' | null;
  counts: RunCounts;
}

export interface RunView extends RunSummary {
  items: RunViewItem[];
}

/** `blockedBy` → der Fachfehler, den `issueConfirmation` für dieselbe Sperre meldete — für übersprungene Posten. */
const SKIP_CODE: Record<RunBlockedBy, string> = {
  final: 'confirmationLineNotFinal',
  certifiable: 'confirmationIncomeNotCertifiable',
  contactComplete: 'confirmationContactIncomplete',
  organizationAddress: 'confirmationOrganizationIncomplete',
  notConfirmed: 'confirmationLineAlreadyConfirmed',
  noticeValid: 'noNoticeValidAt',
  afterExemptionStart: 'confirmationBeforeExemptionStart',
  // Beide sperren über `invalid(...)`, keinen `financeConflict` — der reale Weg (oben, `code = error.type === 'conflict' ? error.code : error.type`) meldet dafür `'validation'`.
  issuedAfterDonation: 'validation',
  noticeComplete: 'validation',
  amountPositive: 'confirmationAmountNotPositive',
  possibleReturnWithoutOrigin: 'confirmationPossibleReturnWithoutOrigin',
  returnDraftPending: 'confirmationReturnDraftPending',
  documented: 'confirmationEntryUndocumented',
  inKindDetails: 'confirmationInKindDetailsMissing',
  typeActive: 'confirmationTypeInactive',
  signerValid: 'confirmationChangedMeanwhile',
  expenseWaiverEnabled: 'confirmationExpenseWaiversDisabled',
};

/** Befund 49: je Grund ein eigener Code, der Wortlaut steht in der Sprachdatei. */
const BLOCKED_RUN_CODE = { noNotice: 'runBlockedNoNotice', organizationIncomplete: 'runBlockedOrganizationIncomplete' } as const satisfies Record<RunBlocked['reason'], string>;

function itemRowsInternal(db: DbOrTx, runIds: readonly string[]): FinanceConfirmationRunItemRow[] {
  if (runIds.length === 0) return [];
  return db.select().from(financeConfirmationRunItems).where(inArray(financeConfirmationRunItems.runId, [...runIds])).all();
}

const byRunOrder = (a: FinanceConfirmationRunItemRow, b: FinanceConfirmationRunItemRow) =>
  a.sortKey.localeCompare(b.sortKey, 'de') || a.contactId.localeCompare(b.contactId) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id);

function runViewsInternal(db: DbOrTx, runs: readonly FinanceConfirmationRunRow[], withItems: boolean): RunView[] {
  const allItems = itemRowsInternal(db, runs.map((r) => r.id));
  const confirmationIds = allItems.map((i) => i.confirmationId).filter((id): id is string => id !== null);
  const confirmations = new Map(
    (confirmationIds.length === 0 ? [] : db.select().from(financeConfirmations).where(inArray(financeConfirmations.id, confirmationIds)).all()).map((c) => [c.id, c] as const),
  );
  const contactIds = withItems ? [...new Set(allItems.map((i) => i.contactId))] : [];
  const names = new Map((contactIds.length === 0 ? [] : db.select().from(contacts).where(inArray(contacts.id, contactIds)).all()).map((c) => [c.id, displayName(c)] as const));

  return runs.map((run) => {
    const rows = allItems.filter((i) => i.runId === run.id).sort(byRunOrder);
    const counts: RunCounts = { total: rows.length, pending: 0, issued: 0, failed: 0, skipped: 0, machine: 0, needsSignature: 0, missingSignedVersion: 0 };
    for (const row of rows) {
      counts[row.state] += 1;
      const confirmation = row.confirmationId ? confirmations.get(row.confirmationId) : undefined;
      if (row.state !== 'issued' || !confirmation) continue;
      if (confirmation.machine) counts.machine += 1;
      else {
        counts.needsSignature += 1;
        if (!confirmation.voidedAt && !confirmation.signedDocumentId) counts.missingSignedVersion += 1;
      }
    }
    const excludedContactIds = JSON.parse(run.excludedContactIds) as string[];
    return {
      id: run.id,
      year: run.year,
      minCents: run.minCents,
      excludedCount: excludedContactIds.length,
      excludedContactIds,
      followUpOfRunId: run.followUpOfRunId,
      startedOn: run.startedOn,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      dispatchedAt: run.dispatchedAt,
      dispatchedVia: run.dispatchedVia,
      counts,
      items: withItems
        ? rows.map((row) => {
            const lineIds = JSON.parse(row.lineIds) as string[];
            return {
              id: row.id,
              contactId: row.contactId,
              contactName: names.get(row.contactId) ?? '',
              kind: row.kind,
              inKindLineId: row.inKindLineId,
              lineIds,
              totalCents: row.totalCents,
              lineCount: lineIds.length,
              needsSignature: row.needsSignature,
              state: row.state,
              confirmationId: row.confirmationId,
              confirmationNumber: row.confirmationId ? (confirmations.get(row.confirmationId)?.documentNumber ?? null) : null,
              errorCode: row.errorCode,
              doneAt: row.doneAt,
            };
          })
        : [],
    };
  });
}

function runViewInternal(db: DbOrTx, id: string): RunView | null {
  const run = db.select().from(financeConfirmationRuns).where(eq(financeConfirmationRuns.id, id)).get();
  return run ? runViewsInternal(db, [run], true)[0]! : null;
}

const itemAudit = (row: Pick<FinanceConfirmationRunItemRow, 'runId' | 'kind' | 'lineIds' | 'totalCents'>, outcome: { state: RunItemState; confirmationId: string | null; errorCode: string | null }) => ({
  runId: row.runId, kind: row.kind, state: outcome.state, confirmationId: outcome.confirmationId, errorCode: outcome.errorCode, totalCents: row.totalCents, lineCount: (JSON.parse(row.lineIds) as string[]).length,
});

export const startRunSchema = runArgsSchema;

/**
 * Serienlauf starten — `finance.donationsIssue`, **`humanOnly`** (E10). Die
 * Posten entstehen jetzt als Schnappschuss (Review Focus 3): dieselbe
 * Vorschau, heute gerechnet. *Bereit* und *braucht Unterschrift* werden
 * `pending`; *Anschrift fehlt* und *blockiert* stehen gleich als `skipped`
 * mit dem Fachfehler da, den das Ausstellen melden würde — auch Zuwendungen
 * vor dem Beginn der Steuerbefreiung. Ausgestellt wird erst in
 * `continueConfirmationRun`.
 */
export async function startConfirmationRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<RunView>> {
  const denied = requirePermission(ctx, 'finance.donationsIssue');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, startRunSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const issuedOn = todayIn(deps);
  if (v.year > Number(issuedOn.slice(0, 4))) return invalid([{ path: 'year', message: 'inFuture' }]);

  return deps.db.transaction((tx: DbOrTx) => {
    if (v.followUpOfRunId && !tx.select({ id: financeConfirmationRuns.id }).from(financeConfirmationRuns).where(eq(financeConfirmationRuns.id, v.followUpOfRunId)).get()) {
      return notFound('financeConfirmationRun', v.followUpOfRunId);
    }
    const preview = previewConfirmationRunInternal(tx, deps, v, issuedOn);
    if (preview.blockedRun) return financeConflict(BLOCKED_RUN_CODE[preview.blockedRun.reason]);

    const runId = newId();
    const now = isoNow(deps.clock);
    const items: FinanceConfirmationRunItemRow[] = preview.items.map((item) => {
      const pending = item.group === 'ready' || item.group === 'needsSignature';
      return {
        id: newId(), runId, contactId: item.contactId, kind: item.kind, inKindLineId: item.inKindLineId, lineIds: JSON.stringify(item.lineIds), totalCents: item.totalCents,
        needsSignature: item.signatureReason !== null, state: pending ? 'pending' : 'skipped', confirmationId: null,
        errorCode: pending ? null : item.blockedBy ? SKIP_CODE[item.blockedBy] : 'confirmationChangedMeanwhile', doneAt: pending ? null : now,
        sortKey: item.contactName.toLowerCase(),
      };
    });
    if (!items.some((i) => i.state === 'pending')) return financeConflict('runNothingToIssue');

    tx.insert(financeConfirmationRuns)
      .values({
        id: runId, year: v.year, minCents: preview.minCents, excludedContactIds: JSON.stringify(preview.excludedContactIds), followUpOfRunId: v.followUpOfRunId ?? null,
        startedOn: issuedOn, startedAt: now, startedByUserId: ctx.userId ?? 'system', startedChannel: ctx.channel, finishedAt: null, dispatchedAt: null, dispatchedVia: null,
        createdAt: now,
      })
      .run();
    for (const item of items) tx.insert(financeConfirmationRunItems).values(item).run();
    financeAudit(tx, deps, ctx, {
      action: 'finance.confirmationRun.start', entity: 'financeConfirmationRun', id: runId,
      after: { year: v.year, minCents: preview.minCents, excludedCount: preview.excludedContactIds.length, followUpOfRunId: v.followUpOfRunId ?? null, startedOn: issuedOn, itemCount: items.filter((i) => i.state === 'pending').length, channel: ctx.channel },
      params: { year: v.year },
    });
    return ok(runViewInternal(tx, runId)!);
  });
}

export const continueRunSchema = z.object({
  runId: z.string().min(1),
  max: z.number().int().min(1).max(50).default(10),
});

/**
 * Den Ausgang eines Postens festhalten — nur, solange er `pending` ist; ein
 * zweiter Aufruf, der schneller war, gewinnt (Review Focus 2).
 */
function settleItemInternal(deps: Deps, ctx: CallContext, row: FinanceConfirmationRunItemRow, outcome: { state: 'issued' | 'failed'; confirmationId: string | null; errorCode: string | null }): void {
  deps.db.transaction((tx: DbOrTx) => {
    const changed = tx
      .update(financeConfirmationRunItems)
      .set({ state: outcome.state, confirmationId: outcome.confirmationId, errorCode: outcome.errorCode, doneAt: isoNow(deps.clock) })
      .where(and(eq(financeConfirmationRunItems.id, row.id), eq(financeConfirmationRunItems.state, 'pending')))
      .run().changes;
    if (changed !== 1) return;
    financeAudit(tx, deps, ctx, { action: 'finance.confirmationRun.item', entity: 'financeConfirmationRunItem', id: row.id, after: itemAudit(row, outcome), params: { issued: outcome.state === 'issued' } });
  });
}

/**
 * Serienlauf fortsetzen — `finance.donationsIssue`, **`humanOnly`**. Höchstens
 * `max` offene Posten, in der Reihenfolge der Namen, je über
 * `issueConfirmation` unter dem Aufrufer, mit dem Ausstellungstag des Starts
 * und dem Jahr als Zeitraum (bis höchstens zum Ausstellungstag). Ein Fehler
 * steht als Code am Posten, der Lauf geht weiter. Meldet `issueConfirmation`,
 * dass alle Zeilen des Postens schon in *einer* gültigen Bestätigung stehen,
 * war ein zweiter Aufruf schneller: Der Posten zählt als ausgestellt mit
 * dessen Bestätigung. Ist nichts mehr offen, ist der Lauf fertig.
 */
export async function continueConfirmationRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<RunView>> {
  const denied = requirePermission(ctx, 'finance.donationsIssue');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, continueRunSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const run = deps.db.select().from(financeConfirmationRuns).where(eq(financeConfirmationRuns.id, v.runId)).get();
  if (!run) return notFound('financeConfirmationRun', v.runId);
  if (run.finishedAt) return financeConflict('runAlreadyFinished');

  // BMF 07.11.2013 Nr. 14: eine Bestätigung für einen Zeitraum vor Beginn der Steuerbefreiung ist unrichtig — Beginn ist das spätere von Jahresanfang und `exemptFrom` des am Ausstellungstag gültigen Bescheids.
  const yearStart = `${run.year}-01-01`;
  const notice = noticeValidAtInternal(deps.db, run.startedOn);
  const periodFrom = notice && notice.exemptFrom > yearStart ? notice.exemptFrom : yearStart;
  const yearEnd = `${run.year}-12-31`;
  const periodTo = run.startedOn < yearEnd ? run.startedOn : yearEnd;
  const batch = itemRowsInternal(deps.db, [run.id]).filter((i) => i.state === 'pending').sort(byRunOrder).slice(0, v.max);

  for (const row of batch) {
    const lineIds = JSON.parse(row.lineIds) as string[];
    const issueKind = issueKindOf(row.kind, lineIds.length);
    const issued = await issueConfirmation(deps, ctx, {
      lineIds, issuedOn: run.startedOn, kind: issueKind,
      ...(issueKind === 'collective' ? { periodFrom, periodTo } : {}),
    });
    if (issued.ok) {
      settleItemInternal(deps, ctx, row, { state: 'issued', confirmationId: issued.value.id, errorCode: null });
      continue;
    }
    const error = issued.error;
    const code = error.type === 'conflict' ? error.code : error.type;
    if (code === 'confirmationLineAlreadyConfirmed') {
      const open = openConfirmationsForLinesInternal(deps.db, lineIds);
      const holders = new Set([...open.values()].map((c) => c.confirmationId));
      if (open.size === lineIds.length && holders.size === 1) {
        settleItemInternal(deps, ctx, row, { state: 'issued', confirmationId: [...holders][0]!, errorCode: null });
        continue;
      }
    }
    settleItemInternal(deps, ctx, row, { state: 'failed', confirmationId: null, errorCode: code });
  }

  deps.db.transaction((tx: DbOrTx) => {
    const rows = itemRowsInternal(tx, [run.id]);
    if (rows.some((i) => i.state === 'pending')) return;
    const changed = tx.update(financeConfirmationRuns).set({ finishedAt: isoNow(deps.clock) }).where(and(eq(financeConfirmationRuns.id, run.id), isNull(financeConfirmationRuns.finishedAt))).run().changes;
    if (changed !== 1) return;
    financeAudit(tx, deps, ctx, {
      action: 'finance.confirmationRun.finish', entity: 'financeConfirmationRun', id: run.id,
      after: { itemCount: rows.filter((i) => i.state !== 'skipped').length, issuedCount: rows.filter((i) => i.state === 'issued').length, failedCount: rows.filter((i) => i.state === 'failed').length, finished: true },
      params: { year: run.year },
    });
  });
  return ok(runViewInternal(deps.db, run.id)!);
}

const getRunSchema = z.object({ id: z.string().min(1) });

/** `finance.read`: ein Serienlauf mit Posten und berechnetem Fortschritt. */
export async function getConfirmationRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<RunView>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, getRunSchema, input);
  if (!parsed.ok) return parsed;
  const view = runViewInternal(deps.db, parsed.value.id);
  return view ? ok(view) : notFound('financeConfirmationRun', parsed.value.id);
}

const listRunsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

/** `finance.read`: frühere Serienläufe, jüngste zuerst — mit Zählern, ohne Posten. */
export async function listConfirmationRuns(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: RunSummary[]; total: number }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listRunsSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const { limit, offset } = parsed.value;
  const all = deps.db.select().from(financeConfirmationRuns).orderBy(desc(financeConfirmationRuns.startedAt), desc(financeConfirmationRuns.id)).all();
  const page = runViewsInternal(deps.db, all.slice(offset, offset + limit), false).map(({ items: _items, ...summary }) => summary);
  return ok({ items: page, total: all.length });
}

export const dispatchRunSchema = z.object({ runId: z.string().min(1), sentAt: z.iso.date(), sentVia: z.enum(['post', 'email', 'handed']) });

/**
 * Versandvermerk für alle (Annahme 8) — `finance.donationsIssue`, nicht
 * `humanOnly` (wie der einzelne Vermerk). In einer Transaktion je
 * ausgestellter, gültiger, maschineller Bestätigung des Laufs ohne Vermerk;
 * zu unterschreibende bekommen ihn erst nach der unterschriebenen Fassung.
 * Den Versand selbst macht Kompass nicht.
 */
export async function dispatchRunConfirmations(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<RunView>> {
  const denied = requirePermission(ctx, 'finance.donationsIssue');
  if (denied) return denied;
  const parsed = validate(deps, dispatchRunSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  return deps.db.transaction((tx: DbOrTx) => {
    const run = tx.select().from(financeConfirmationRuns).where(eq(financeConfirmationRuns.id, v.runId)).get();
    if (!run) return notFound('financeConfirmationRun', v.runId);
    const confirmationIds = itemRowsInternal(tx, [run.id]).filter((i) => i.state === 'issued' && i.confirmationId).map((i) => i.confirmationId!);
    // Was per E-Mail hinausgeht, vermerkt der Sender der Akte, sobald die Mail draußen ist — hier nur die Post-Posten.
    const mailed = new Set(tx.select({ documentId: dmsMailOutbox.documentId }).from(dmsMailOutbox).where(and(eq(dmsMailOutbox.runRef, runRefOf(run.id)), ne(dmsMailOutbox.status, 'withdrawn'))).all().map((r) => r.documentId));
    const due = (confirmationIds.length === 0 ? [] : tx.select().from(financeConfirmations).where(and(inArray(financeConfirmations.id, confirmationIds), eq(financeConfirmations.machine, true), isNull(financeConfirmations.sentAt), isNull(financeConfirmations.voidedAt))).all()).filter((row) => !mailed.has(row.documentId));
    if (due.some((row) => v.sentAt < row.issuedOn)) return invalid([{ path: 'sentAt', message: 'beforeIssued' }]);
    const dispatched = due.filter((row) => recordDispatchInternal(tx, deps, ctx, row, v.sentAt, v.sentVia)).length;
    if (dispatched === 0) return financeConflict('dispatchNothingMachine');
    if (!run.dispatchedAt) {
      tx.update(financeConfirmationRuns).set({ dispatchedAt: v.sentAt, dispatchedVia: v.sentVia }).where(and(eq(financeConfirmationRuns.id, run.id), isNull(financeConfirmationRuns.dispatchedAt))).run();
    }
    financeAudit(tx, deps, ctx, { action: 'finance.confirmationRun.dispatch', entity: 'financeConfirmationRun', id: run.id, after: { dispatchedVia: v.sentVia }, params: { year: run.year, count: dispatched } });
    return ok(runViewInternal(tx, run.id)!);
  });
}

/** Der Verweis eines Laufs im Ausgangskorb der Akte. */
const runRefOf = (runId: string) => `financeConfirmationRun:${runId}`;

export const runMailSchema = z.object({ runId: z.string().min(1) });

/**
 * Die Bestätigungen eines abgeschlossenen Laufs per E-Mail (Plan E1, Spec PDF
 * per E-Mail § 5) — `finance.donationsIssue` und `dms.send`, nur ein Mensch.
 * Nur im maschinellen Verfahren und nur maschinell erstellte Bestätigungen:
 * Eine, die unterschrieben werden muss, geht auf Papier. Ohne vollständiges
 * Verfahren gehen alle Posten per Post, mit Grund. Eingereiht wird über den
 * Ausgangskorb der Akte, in derselben Transaktion; was schon dort steht, kein
 * zweites Mal. Der Versandvermerk entsteht erst beim Senden.
 */
export async function sendConfirmationRunEmails(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ queued: number; post: SendPlanItem[] }>> {
  const denied = requirePermission(ctx, 'finance.donationsIssue') ?? requirePermission(ctx, 'dms.send');
  if (denied) return denied;
  const human = requireHumanChannelFinance(deps, ctx);
  if (human) return human;
  const parsed = validate(deps, runMailSchema, input);
  if (!parsed.ok) return parsed;
  const run = deps.db.select().from(financeConfirmationRuns).where(eq(financeConfirmationRuns.id, parsed.value.runId)).get();
  if (!run) return notFound('financeConfirmationRun', parsed.value.runId);
  if (!run.finishedAt) return financeConflict('runNotFinished');
  const notReady = mailNotReady(deps);
  if (notReady) return notReady;

  const confirmationIds = itemRowsInternal(deps.db, [run.id]).filter((i) => i.state === 'issued' && i.confirmationId).map((i) => i.confirmationId!);
  const rows = confirmationIds.length === 0 ? [] : deps.db.select().from(financeConfirmations).where(and(inArray(financeConfirmations.id, confirmationIds), isNull(financeConfirmations.voidedAt))).all();
  const machineActive = machineProcedureStatusAt(deps.db, todayIn(deps)).complete;
  const post: SendPlanItem[] = [];
  const items: { documentId: string; contactId: string }[] = [];
  for (const row of rows) {
    if (machineActive && row.machine) items.push({ documentId: row.documentId, contactId: row.contactId });
    else post.push({ documentId: row.documentId, contactId: row.contactId, channel: 'post', reason: 'notMachineProcedure' });
  }
  return deps.db.transaction((tx: DbOrTx) => {
    const { queued, skipped } = queueDocumentEmailsInternal(tx, deps, ctx, { items, runRef: runRefOf(run.id) });
    financeAudit(tx, deps, ctx, { action: 'finance.confirmationRun.mail', entity: 'financeConfirmationRun', id: run.id, after: { queued: queued.length }, params: { year: run.year, count: queued.length } });
    return ok({ queued: queued.length, post: [...skipped, ...post] });
  });
}

/** Zustand einer Mail-Zeile: noch nicht eingereiht oder der Zustand im Ausgang der Akte. */
export type RunMailState = MailOutboxStatus | 'notQueued';

interface RunDispatchRowBase {
  documentId: string;
  documentNumber: string | null;
  confirmationId: string;
  contactId: string;
  /** Name des Spenders (nur Anzeige; das Protokoll nennt ihn nicht). */
  name: string;
  /** Art des Postens wie in der Liste des Laufs (`single`, `collective` …) und Zahl der Zeilen. */
  kind: RunItemKind;
  lineCount: number;
  /** Versandvermerk der Bestätigung (Tag). */
  sentAt: string | null;
}

export interface ConfirmationRunDispatchState {
  mail: (RunDispatchRowBase & { state: RunMailState; address: string; outboxId: string | null; errorCode: string | null; errorText: string | null })[];
  post: (RunDispatchRowBase & { reason: SendPlanReason; dispatched: boolean })[];
  /** Jede Zeile gesendet oder vermerkt; ein „nicht zugestellt“ ist kein Vermerk (Handoff 2b E3). */
  done: boolean;
  mailState: { kind: 'off' | 'ready' | 'redirect' | 'blocked'; redirectTo: string | null };
}

export const runDispatchStateSchema = z.object({ runId: z.string().min(1) });

/**
 * Die Gruppen E-Mail und Post eines Laufs, wie `sendConfirmationRunEmails` sie bildet: per E-Mail nur im
 * maschinellen Verfahren und nur maschinell erstellte Bestätigungen, deren Kontakt eine Adresse hat und nicht Post
 * will; was von Hand in die Post-Gruppe kam (`manual`, Plan U4 Task 2), geht per Post. Ohne Rechte — die prüft der Dienst.
 */
function runDispatchInternal(deps: Deps, run: FinanceConfirmationRunRow): Omit<ConfirmationRunDispatchState, 'mailState'> & { postConfirmations: FinanceConfirmationRow[] } {
  const issued = itemRowsInternal(deps.db, [run.id]).filter((i) => i.state === 'issued' && i.confirmationId !== null).sort(byRunOrder);
  const ids = issued.map((i) => i.confirmationId!);
  const rows = new Map((ids.length === 0 ? [] : deps.db.select().from(financeConfirmations).where(inArray(financeConfirmations.id, ids)).all()).map((c) => [c.id, c] as const));
  const contactIds = [...new Set([...rows.values()].map((c) => c.contactId))];
  const names = new Map((contactIds.length === 0 ? [] : deps.db.select().from(contacts).where(inArray(contacts.id, contactIds)).all()).map((c) => [c.id, displayName(c)] as const));
  const machineActive = machineProcedureStatusAt(deps.db, todayIn(deps)).complete;
  const mailOff = deps.mail.state().kind === 'off';
  const mail: ConfirmationRunDispatchState['mail'] = [];
  const post: ConfirmationRunDispatchState['post'] = [];
  const postConfirmations: FinanceConfirmationRow[] = [];
  for (const item of issued) {
    const c = rows.get(item.confirmationId!);
    if (!c || c.voidedAt) continue;
    const base: RunDispatchRowBase = { documentId: c.documentId, documentNumber: c.documentNumber, confirmationId: c.id, contactId: c.contactId, name: names.get(c.contactId) ?? '', kind: item.kind, lineCount: (JSON.parse(item.lineIds) as string[]).length, sentAt: c.sentAt };
    const toPost = (reason: SendPlanReason) => {
      post.push({ ...base, reason, dispatched: c.sentAt !== null });
      postConfirmations.push(c);
    };
    if (!machineActive || !c.machine) { toPost('notMachineProcedure'); continue; }
    if (mailOff) { toPost('mailOff'); continue; }
    const delivery = deliveryForContactInternal(deps.db, c.contactId);
    if (delivery.channel === 'post') { toPost(delivery.reason); continue; }
    const entry = deps.db.select().from(dmsMailOutbox).where(and(eq(dmsMailOutbox.documentId, c.documentId), eq(dmsMailOutbox.contactId, c.contactId))).orderBy(desc(dmsMailOutbox.queuedAt), desc(dmsMailOutbox.id)).get();
    const manual = manualChannelInternal(deps.db, c.documentId, c.contactId, entry);
    if (manual === 'post') { toPost('manual'); continue; }
    // Zurück zu E-Mail: Die zurückgezogene Sendung zählt nicht mehr, die Zeile ist wieder offen.
    const live = manual === 'returned' ? undefined : entry;
    mail.push({ ...base, state: live?.status ?? 'notQueued', address: delivery.address, outboxId: live?.id ?? null, errorCode: live?.lastErrorCode ?? null, errorText: live?.lastErrorText ?? null });
  }
  const done = mail.every((m) => m.state === 'sent' || m.sentAt !== null) && post.every((p) => p.dispatched);
  return { mail, post, done, postConfirmations };
}

/** Der Schritt „Ergebnis“ als Versand (Handoff 2b E3): Mail-Gruppe mit Zustand im Ausgang, Post-Gruppe mit Grund und Vermerk. `finance.read`. */
export async function confirmationRunDispatchState(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ConfirmationRunDispatchState>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, runDispatchStateSchema, input);
  if (!parsed.ok) return parsed;
  const run = deps.db.select().from(financeConfirmationRuns).where(eq(financeConfirmationRuns.id, parsed.value.runId)).get();
  if (!run) return notFound('financeConfirmationRun', parsed.value.runId);
  const { mail, post, done } = runDispatchInternal(deps, run);
  const state = deps.mail.state();
  return ok({ mail, post, done, mailState: { kind: state.kind, redirectTo: state.kind === 'redirect' ? state.to : null } });
}

export const runMarkPostSchema = z.object({ runId: z.string().min(1), sentAt: z.iso.date(), documentIds: z.array(z.string().min(1)).min(1).max(500).optional() });

/**
 * „Versand vermerken …“ an Zeilen der Post-Gruppe (Weg Post) — `finance.donationsIssue`, in einer Transaktion. Ohne
 * `documentIds` alle offenen der Gruppe. Nie in der Zukunft; mit Unterschriftsfeld erst nach der unterschriebenen
 * Fassung (wie `recordConfirmationDispatch`).
 */
export async function markRunPostConfirmations(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ count: number }>> {
  const denied = requirePermission(ctx, 'finance.donationsIssue');
  if (denied) return denied;
  const parsed = validate(deps, runMarkPostSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.sentAt > todayIn(deps)) return invalid([{ path: 'sentAt', message: 'inFuture' }]);
  const run = deps.db.select().from(financeConfirmationRuns).where(eq(financeConfirmationRuns.id, v.runId)).get();
  if (!run) return notFound('financeConfirmationRun', v.runId);
  const due = runDispatchInternal(deps, run).postConfirmations.filter((c) => !c.sentAt && (!v.documentIds || v.documentIds.includes(c.documentId)));
  if (due.length === 0) return financeConflict('dispatchNothingMachine');
  // Nachttest N19: versandt wird frühestens am Tag der Ausstellung (wie `recordConfirmationDispatch`).
  if (due.some((c) => v.sentAt < c.issuedOn)) return invalid([{ path: 'sentAt', message: 'beforeIssued' }]);
  if (due.some((c) => !c.machine && !c.signedDocumentId)) return financeConflict('confirmationSignedMissing');
  return deps.db.transaction((tx: DbOrTx) => {
    const count = due.filter((row) => recordDispatchInternal(tx, deps, ctx, row, v.sentAt, 'post')).length;
    financeAudit(tx, deps, ctx, { action: 'finance.confirmationRun.dispatch', entity: 'financeConfirmationRun', id: run.id, after: { dispatchedVia: 'post' }, params: { year: run.year, count } });
    return ok({ count });
  });
}

export const runMoveSchema = z.object({ runId: z.string().min(1), documentIds: z.array(z.string().min(1)).min(1).max(500), to: z.enum(['post', 'email']) });

/** Bricht die Transaktion des Verschiebens mit dem Grund der Akte ab — alle oder keine. */
class MoveAborted extends Error {
  constructor(readonly failure: Failure) {
    super('confirmation run move aborted');
  }
}

/**
 * „Per Post schicken“ / „Zurück zu E-Mail“ je Zeile (Nachtrag MCP-Test § 2, Plan U4 Task 2) — `finance.donationsIssue`,
 * wie der Vermerk. `post`: Zeilen der Mail-Gruppe, die warten oder nicht zugestellt sind, wandern mit Grund `manual` in
 * die Post-Gruppe (eine eingereihte Mail wird zurückgezogen), unterwegs oder gesendet lehnt die Akte ab
 * (`mailNotPending`). `email`: nur von Hand verschobene Zeilen ohne Versandvermerk. Alle oder keine; Protokoll mit der
 * Zahl, je Dokument dazu der Eintrag der Akte.
 */
export async function moveConfirmationRunLetters(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ count: number }>> {
  const denied = requirePermission(ctx, 'finance.donationsIssue');
  if (denied) return denied;
  const parsed = validate(deps, runMoveSchema, input);
  if (!parsed.ok) return parsed;
  const { runId, documentIds, to } = parsed.value;
  const run = deps.db.select().from(financeConfirmationRuns).where(eq(financeConfirmationRuns.id, runId)).get();
  if (!run) return notFound('financeConfirmationRun', runId);
  const { mail, post } = runDispatchInternal(deps, run);
  const lineOf = new Map([...mail, ...post].map((row) => [row.documentId, row] as const));
  const postReason = new Map(post.map((row) => [row.documentId, row.reason] as const));
  const missing = documentIds.find((id) => !lineOf.has(id));
  if (missing) return notFound('document', missing);
  try {
    return deps.db.transaction((tx: DbOrTx) => {
      for (const documentId of documentIds) {
        const line = lineOf.get(documentId)!;
        // Der Versandvermerk einer Bestätigung steht an ihr, nicht am Dokument der Akte.
        // U7 (Plan N3): Steht die Zeile schon in der Post-Gruppe, nennt die Ablehnung den Grund des Versandplans.
        const planReason = postReason.get(documentId);
        const pair = { documentId, contactId: line.contactId, runRef: runRefOf(run.id), dispatched: line.sentAt !== null, ...(planReason ? { planReason } : {}) };
        const moved = to === 'post' ? movePairToPostInternal(tx, deps, ctx, pair) : returnPairToEmailInternal(tx, deps, ctx, pair);
        if (!moved.ok) throw new MoveAborted(moved);
      }
      const entry = { entity: 'financeConfirmationRun' as const, id: run.id, after: { count: documentIds.length }, params: { year: run.year, count: documentIds.length } };
      if (to === 'post') financeAudit(tx, deps, ctx, { action: 'finance.confirmationRun.toPost', ...entry });
      else financeAudit(tx, deps, ctx, { action: 'finance.confirmationRun.toEmail', ...entry });
      return ok({ count: documentIds.length });
    });
  } catch (error) {
    if (error instanceof MoveAborted) return error.failure;
    throw error;
  }
}

export const runBundleSchema = z.object({ runId: z.string().min(1), part: z.enum(['machine', 'signature', 'post']) });

const BUNDLE_PART_LABEL: Record<z.infer<typeof runBundleSchema>['part'], string> = { machine: 'maschinell', signature: 'zum-unterschreiben', post: 'per-post' };

/**
 * Sammel-PDF eines Serienlaufs (F6b Task 4, Annahme 7) — `finance.read`. Die
 * Exemplare der ausgestellten Posten in der Reihenfolge der Namen, über den
 * Bezug der Akte (wie `readConfirmationCopy`), zu einem PDF gefügt.
 * Aufgeteilt wird nach der ausgestellten Bestätigung (`machine`), nicht nach
 * dem Schnappschuss beim Start; zurückgenommene bleiben draußen, sie gehen
 * nicht mehr hinaus. Nichts wird abgelegt, nichts protokolliert — ein Lesen.
 * Fehlt `pdfunite` (`ToolMissingError`), antwortet der Dienst mit Abhilfe;
 * der Lauf selbst hängt nicht daran (Review Focus 5). Liefert Bytes: kein
 * MCP-Werkzeug.
 */
export async function readRunBundle(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ bytes: Uint8Array; filename: string; count: number }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, runBundleSchema, input);
  if (!parsed.ok) return parsed;
  const { runId, part } = parsed.value;

  const run = deps.db.select().from(financeConfirmationRuns).where(eq(financeConfirmationRuns.id, runId)).get();
  if (!run) return notFound('financeConfirmationRun', runId);
  const issued = itemRowsInternal(deps.db, [run.id]).filter((i) => i.state === 'issued' && i.confirmationId !== null).sort(byRunOrder);
  const confirmationIds = issued.map((i) => i.confirmationId!);
  const confirmations = new Map(
    (confirmationIds.length === 0 ? [] : deps.db.select().from(financeConfirmations).where(inArray(financeConfirmations.id, confirmationIds)).all()).map((c) => [c.id, c] as const),
  );
  // „Als PDF zum Drucken“ im Versand-Schritt: die Post-Gruppe in der Reihenfolge des Laufs.
  const postIds = part === 'post' ? new Set(runDispatchInternal(deps, run).postConfirmations.map((c) => c.id)) : null;
  const selected = issued
    .map((i) => confirmations.get(i.confirmationId!))
    .filter((c): c is NonNullable<typeof c> => c !== undefined && !c.voidedAt && (postIds ? postIds.has(c.id) : c.machine === (part === 'machine')));
  if (selected.length === 0) return financeConflict('bundleEmpty');

  const files: Uint8Array[] = [];
  for (const confirmation of selected) {
    const copy = await readLinkedDocument(deps, ctx, { documentId: confirmation.documentId, entityType: 'financeConfirmation', entityId: confirmation.id });
    if (!copy.ok) return copy;
    files.push(copy.value.bytes);
  }
  let bytes: Uint8Array;
  try {
    bytes = await deps.pdf.merge(files);
  } catch (error) {
    if (error instanceof Error && error.name === 'ToolMissingError') return financeConflict('bundleToolsMissing');
    throw error;
  }
  return ok({ bytes, filename: `Zuwendungsbestaetigungen-${run.year}-${BUNDLE_PART_LABEL[part]}.pdf`, count: files.length });
}
