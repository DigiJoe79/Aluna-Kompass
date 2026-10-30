import { isoDayIn, type Deps, type RecordReferenceInput } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { governanceAgendaItems, governanceAssemblyRequests, governanceMeetings, governanceMinutesVersions, governanceMotions, governanceRegisterFilings, type FilingRow } from './schema';

/** Alle Dokumente einer Registeranmeldung: Zwischenverfügungen, Prüfliste, Registerauszug, Bestätigung und Auszüge des Transparenzregisters. */
export function filingDocumentIds(f: FilingRow): string[] {
  return [
    ...f.interimOrders.map((o) => o.documentId),
    ...Object.values(f.documents).flat(),
    f.extractDocumentId,
    f.transparency?.confirmationDocumentId ?? null,
    ...(f.transparency?.extractDocumentIds ?? []),
  ].filter((d): d is string => !!d);
}

/**
 * Wo Gremien auf ein Dokument der Akte zeigt (`recordReferences`, Spec § 9.3): Einladung einer Sitzung, Anlage eines
 * Tagesordnungspunkts, Dokument eines Antrags oder eines Verlangens, Fassung des Protokolls, Unterlagen einer
 * Registeranmeldung (G5). Nicht aus `index.ts` exportieren.
 */
export function governanceRecordReferences(deps: Deps, entityType: string, id: string): RecordReferenceInput[] {
  if (entityType !== 'document') return [];
  const db = deps.db;
  const meetings = new Set<string>();
  for (const m of db.select({ id: governanceMeetings.id }).from(governanceMeetings).where(eq(governanceMeetings.invitationDocumentId, id)).all()) meetings.add(m.id);
  for (const item of db.select({ meetingId: governanceAgendaItems.meetingId, ids: governanceAgendaItems.attachmentDocumentIds }).from(governanceAgendaItems).all()) if (item.ids.includes(id)) meetings.add(item.meetingId);
  for (const m of db.select({ meetingId: governanceMotions.meetingId }).from(governanceMotions).where(eq(governanceMotions.documentId, id)).all()) meetings.add(m.meetingId);
  // Jede Fassung des unterschriebenen Protokolls (Plan G4), auch eine ersetzte.
  for (const v of db.select({ meetingId: governanceMinutesVersions.meetingId }).from(governanceMinutesVersions).where(eq(governanceMinutesVersions.documentId, id)).all()) meetings.add(v.meetingId);
  const refs: RecordReferenceInput[] = [...meetings].map((meetingId) => {
    const meeting = db.select({ heldOn: governanceMeetings.heldOn }).from(governanceMeetings).where(eq(governanceMeetings.id, meetingId)).get();
    return { label: { key: 'governance.records.meetingDocument', params: { date: meeting?.heldOn ?? '' } }, entity: 'governanceMeeting', id: meetingId };
  });
  for (const r of db.select({ id: governanceAssemblyRequests.id, receivedOn: governanceAssemblyRequests.receivedOn }).from(governanceAssemblyRequests).where(eq(governanceAssemblyRequests.documentId, id)).all()) {
    refs.push({ label: { key: 'governance.records.assemblyRequestDocument', params: { date: r.receivedOn } }, entity: 'governanceAssemblyRequest', id: r.id });
  }
  for (const f of db.select().from(governanceRegisterFilings).all()) {
    if (filingDocumentIds(f).includes(id)) refs.push({ label: { key: 'governance.records.registerFilingDocument', params: { date: isoDayIn(deps, Date.parse(f.createdAt)) } }, entity: 'governanceRegisterFiling', id: f.id });
  }
  return refs;
}
