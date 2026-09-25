import { invalid, isoNow, notFound, ok, readSetting, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { documentTypeFor, peekDocumentNumber } from '@kompass/module-dms';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requireFinanceRead } from '../ledger/access';
import { CERTIFIABLE_INCOME_KINDS } from '../ledger/codes';
import { financeAllocationLines, financeCategories, financeConfirmationLines, financeConfirmationRuns, financeConfirmations, financeEntries } from '../schema';
import { checkConfirmableInternal, returnedCentsInternal, type ConfirmationCheckKey } from './check';
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

export interface RunPreviewItem {
  contactId: string;
  contactName: string;
  kind: RunItemKind;
  inKindLineId: string | null;
  lineIds: string[];
  /** Nach Rückläufern. */
  totalCents: number;
  lineCount: number;
  /** Zeilen desselben Kontakts, Jahres und derselben Art, die schon in einer gültigen Einzelbestätigung stehen — „2 von 3 Zuwendungen; 1 bereits einzeln bestätigt“. */
  alreadyConfirmedSingly: number;
  group: RunPreviewGroup;
  /** Die sperrende Prüfung (`contactComplete` bei *Anschrift fehlt*); `null`, wenn nichts sperrt. */
  blockedBy: ConfirmationCheckKey | null;
  signatureReason: RunSignatureReason | null;
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

  // „bereits einzeln bestätigt“ je Kontakt und Art des Postens.
  const singly = new Map<string, number>();
  const byContact = new Map<string, SelectedLine[]>();
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
    const list = byContact.get(contactId) ?? [];
    list.push({ lineId: r.lineId, entryDate: r.entryDate, entryNumber: r.entryNumber, position: r.position, contactId, incomeKind, netCents });
    byContact.set(contactId, list);
  }
  for (const [contactId, lines] of byContact) if (lines.reduce((s, l) => s + l.netCents, 0) < minCents) byContact.delete(contactId);

  const contactRows = byContact.size === 0 ? [] : db.select().from(contacts).where(inArray(contacts.id, [...byContact.keys()])).all();
  const names = new Map(contactRows.map((c) => [c.id, displayName(c)]));

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
      const checked = checkConfirmableInternal(db, deps, { lineIds, issuedOn, kind: bucket.kind === 'inKind' ? 'inKind' : 'collective' });
      let group: RunPreviewGroup;
      let blockedBy: ConfirmationCheckKey | null = null;
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
          signatureReason = bucket.kind === 'collectiveWaiver' ? 'expenseWaiver' : bucket.kind === 'inKind' ? 'inKind' : checked.value.machine.complete ? null : 'machineIncomplete';
          group = signatureReason ? 'needsSignature' : 'ready';
        }
      }
      items.push({
        contactId,
        contactName: names.get(contactId) ?? '',
        kind: bucket.kind,
        inKindLineId: bucket.inKindLineId,
        lineIds,
        totalCents: bucket.lines.reduce((s, l) => s + l.netCents, 0),
        lineCount: lineIds.length,
        alreadyConfirmedSingly: bucket.kind === 'inKind' ? 0 : (singly.get(`${contactId}|${bucket.kind}`) ?? 0),
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
  const numberRange = { from: peekDocumentNumber(db, prefix, deps.clock.now().getUTCFullYear()), count: counts.ready + counts.needsSignature };

  return {
    year: args.year,
    minCents,
    excludedContactIds: [...excluded],
    issuedOn,
    items: items.map(({ firstDate: _firstDate, ...item }) => item),
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

/** `finance.read`: die Posten eines Serienlaufs, bevor er startet — Ausstellungstag heute. */
export async function previewConfirmationRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<RunPreview>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, runArgsSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const issuedOn = isoNow(deps.clock).slice(0, 10);
  if (v.year > Number(issuedOn.slice(0, 4))) return invalid([{ path: 'year', message: 'inFuture' }]);
  if (v.followUpOfRunId && !deps.db.select({ id: financeConfirmationRuns.id }).from(financeConfirmationRuns).where(eq(financeConfirmationRuns.id, v.followUpOfRunId)).get()) {
    return notFound('financeConfirmationRun', v.followUpOfRunId);
  }
  return ok(previewConfirmationRunInternal(deps.db, deps, v, issuedOn));
}
