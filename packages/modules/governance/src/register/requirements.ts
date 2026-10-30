import { isoNow, notFound, ok, recordAudit, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { documentLinks, documents } from '@kompass/module-dms';
import { addCalendarDays, financeNotices } from '@kompass/module-finance';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { governanceConflict } from '../errors';
import { minutesVersionsInternal } from '../minutes/signed';
import { governanceMeetings, governanceRegisterFilings, governanceResolutions, governanceStatutes, governanceTerms, type FilingRow, type OccasionRow } from '../schema';
import { ancestorsOf, statuteValidOnInternal } from '../statutes';
import { filingOccasionsInternal, filingRowInternal, filingViewInternal, type FilingView } from './filings';

export const REQUIREMENT_KEYS = ['resolutionCopy', 'statuteText', 'invitation', 'attendanceList', 'registerData', 'taxNotice'] as const;
/** Unterlage der Registeranmeldung (Spec § 7.1). */
export type RequirementKey = (typeof REQUIREMENT_KEYS)[number];
export type RequirementRow = { key: RequirementKey; level: 'required' | 'recommended'; documentIds: string[]; met: boolean; source: 'computed' | 'manual' };

/** Pflicht nach § 71 BGB nur Beschlussabschrift und Satzungswortlaut (Rechtsprüfung K2: keine Notarbescheinigung). */
const LEVEL: Record<RequirementKey, RequirementRow['level']> = { resolutionCopy: 'required', statuteText: 'required', invitation: 'recommended', attendanceList: 'recommended', registerData: 'recommended', taxNotice: 'recommended' };
const ATTENDANCE_TYPE = 'governance-attendance';
const REGISTER_DATA_TYPE = 'governance-register-data';

export const filingRequirementsSchema = z.object({ filingId: z.string().min(1) });
export const filingDocumentsSchema = z.object({ filingId: z.string().min(1), key: z.enum(REQUIREMENT_KEYS), documentIds: z.array(z.string().min(1)).max(20) });

/** Die Sitzungen der Anlässe — direkt oder über den Beschluss. */
function meetingIdsOf(db: DbOrTx, occasions: OccasionRow[]): string[] {
  const ids = new Set(occasions.map((o) => o.meetingId).filter((id): id is string => !!id));
  const resolutionIds = occasions.map((o) => o.resolutionId).filter((id): id is string => !!id);
  if (resolutionIds.length > 0) for (const r of db.select({ meetingId: governanceResolutions.meetingId }).from(governanceResolutions).where(inArray(governanceResolutions.id, resolutionIds)).all()) if (r.meetingId) ids.add(r.meetingId);
  return [...ids].sort();
}

/**
 * Die Satzungsstände, die mit der Anmeldung eingetragen werden: die der Anlässe `statute`; bei einer Ersteintragung
 * ohne solchen Anlass der am Tag `on` gültige beschlossene Stand (Vorverein, Spec § 4.1).
 */
export function filingStatuteIdsInternal(db: DbOrTx, occasions: OccasionRow[], on: string): string[] {
  const all = [...new Set(occasions.filter((o) => o.kind === 'statute' && o.statuteId).map((o) => o.statuteId!))];
  // K-3: Ein Stand, auf dem ein anderer der Anmeldung aufbaut, wird nicht selbst eingetragen — sein Inhalt steht im jüngeren.
  const byId = new Map(db.select().from(governanceStatutes).all().map((s) => [s.id, s]));
  const covered = new Set(all.flatMap((sid) => (byId.has(sid) ? [...ancestorsOf(byId, byId.get(sid)!)] : [])));
  const ids = all.filter((sid) => !covered.has(sid));
  if (ids.length > 0 || !occasions.some((o) => o.kind === 'initial')) return ids;
  const stand = statuteValidOnInternal(db, on);
  return stand ? [stand.id] : [];
}

function linkedOfType(db: DbOrTx, meetingIds: string[], typeKey: string): string[] {
  if (meetingIds.length === 0) return [];
  return db
    .select({ id: documents.id })
    .from(documentLinks)
    .innerJoin(documents, eq(documents.id, documentLinks.documentId))
    .where(and(eq(documentLinks.entityType, 'governanceMeeting'), inArray(documentLinks.entityId, meetingIds), eq(documents.typeKey, typeKey)))
    .all()
    .map((d) => d.id);
}

/**
 * Prüfliste der Unterlagen (Spec § 7.1, Rechtsprüfung K2/K4): Pflicht die Beschlussabschrift (jüngste Fassung des
 * Protokolls jeder Sitzung der Anlässe; ohne Sitzung — Rücktritt, Tod — die Niederlegung am Amt) und bei Satzung oder
 * Ersteintragung der Wortlaut; empfohlen Einladung und Anwesenheitsliste (nur mit Sitzung), Angaben für die
 * Registeranmeldung und der jüngste nicht aufgehobene § 60a- bzw. Freistellungsbescheid (Gebührenbefreiung). Von Hand
 * gesetzte Dokumente gehen vor (Altbestand als `PRT`/`GRD`). Nur Hinweise — eingetragen werden darf trotzdem.
 */
export function filingRequirementsInternal(db: DbOrTx, filing: FilingRow, today: string): RequirementRow[] {
  const occasions = filingOccasionsInternal(db, filing.id);
  const meetingIds = meetingIdsOf(db, occasions);
  const meetings = meetingIds.length > 0 ? db.select().from(governanceMeetings).where(inArray(governanceMeetings.id, meetingIds)).all() : [];
  const computed: Partial<Record<RequirementKey, { ids: string[]; met: boolean }>> = {};

  const minutes = meetingIds.map((id) => minutesVersionsInternal(db, id).at(-1)?.documentId ?? null);
  const termIds = occasions.filter((o) => !o.meetingId && !o.resolutionId && o.termId).map((o) => o.termId!);
  const resignations = termIds.length > 0 ? db.select({ documentId: governanceTerms.documentId }).from(governanceTerms).where(inArray(governanceTerms.id, termIds)).all().map((t) => t.documentId) : [];
  const copies = [...minutes, ...resignations];
  computed.resolutionCopy = { ids: copies.filter((id): id is string => !!id), met: copies.length > 0 && copies.every((id) => !!id) };

  const statuteIds = filingStatuteIdsInternal(db, occasions, filing.registeredOn ?? addCalendarDays(today, 1));
  if (statuteIds.length > 0 || occasions.some((o) => o.kind === 'initial')) {
    const texts = statuteIds.length > 0 ? db.select({ documentId: governanceStatutes.documentId }).from(governanceStatutes).where(inArray(governanceStatutes.id, statuteIds)).all().map((s) => s.documentId) : [];
    computed.statuteText = { ids: texts.filter((id): id is string => !!id), met: texts.length > 0 && texts.every((id) => !!id) };
  }
  if (meetings.length > 0) {
    const invitations = meetings.map((m) => m.invitationDocumentId).filter((id): id is string => !!id);
    computed.invitation = { ids: invitations, met: invitations.length > 0 };
    const lists = linkedOfType(db, meetingIds, ATTENDANCE_TYPE);
    computed.attendanceList = { ids: lists, met: lists.length > 0 };
  }
  const registerData = linkedOfType(db, meetingIds, REGISTER_DATA_TYPE);
  computed.registerData = { ids: registerData, met: registerData.length > 0 };
  const notice = db
    .select()
    .from(financeNotices)
    .where(and(inArray(financeNotices.kind, ['section60a', 'exemptionNotice']), isNull(financeNotices.voidedAt)))
    .all()
    .filter((n) => n.documentId)
    .sort((a, b) => a.noticeDate.localeCompare(b.noticeDate))
    .at(-1);
  computed.taxNotice = { ids: notice ? [notice.documentId!] : [], met: !!notice };

  return REQUIREMENT_KEYS.flatMap((key): RequirementRow[] => {
    const manual = filing.documents[key];
    const auto = computed[key];
    if (!auto && !manual?.length) return [];
    if (manual?.length) return [{ key, level: LEVEL[key], documentIds: manual, met: true, source: 'manual' }];
    return [{ key, level: LEVEL[key], documentIds: auto!.ids, met: auto!.met, source: 'computed' }];
  });
}

/** Die Prüfliste einer Anmeldung. */
export async function filingRequirements(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<RequirementRow[]>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, filingRequirementsSchema, input);
  if (!parsed.ok) return parsed;
  const filing = filingRowInternal(deps.db, parsed.value.filingId);
  if (!filing) return notFound('governanceRegisterFiling', parsed.value.filingId);
  return ok(filingRequirementsInternal(deps.db, filing, todayIn(deps)));
}

/** Setzt die Dokumente einer Zeile der Prüfliste von Hand (leer: wieder berechnet). */
export async function setFilingDocuments(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FilingView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, filingDocumentsSchema, input);
  if (!parsed.ok) return parsed;
  const { filingId, key, documentIds } = parsed.value;
  const before = filingRowInternal(deps.db, filingId);
  if (!before) return notFound('governanceRegisterFiling', filingId);
  if (before.registeredOn) return governanceConflict('filingRegistered');
  for (const id of documentIds) if (!deps.db.select({ id: documents.id }).from(documents).where(eq(documents.id, id)).get()) return notFound('document', id);
  const next = { ...before.documents };
  if (documentIds.length > 0) next[key] = [...new Set(documentIds)];
  else delete next[key];
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceRegisterFilings).set({ documents: next, updatedAt: isoNow(deps.clock) }).where(eq(governanceRegisterFilings.id, filingId)).run();
    recordAudit(tx, deps, ctx, { action: 'governance.register.documents', entityType: 'governanceRegisterFiling', entityId: filingId, before: { [key]: before.documents[key] ?? [] }, after: { [key]: next[key] ?? [] }, params: { key, count: documentIds.length } });
    return ok(filingViewInternal(tx, deps, filingRowInternal(tx, filingId)!));
  });
}
