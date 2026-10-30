import { and, eq, isNull } from 'drizzle-orm';
import { followUps } from './db/schema';
import type { Deps } from './deps';
import { describeMediaUsage, type MediaUsage } from './media/service';
import type { RecordReference, RecordReferenceInput, RetentionHold } from './modules/manifest';
import { messageDate } from './message-date';
import { withResolvedLabel } from './modules/record-hooks';
import { CORE_MODULE_KEY, enabledManifests } from './modules/service';
import { conflict, localizedConflict, type Failure } from './result';
import { holdsFor } from './retention/service';
import { todayIn } from './today';

/**
 * Die Verweise des Kerns selbst: offene Wiedervorlagen. `createFollowUp` prüft
 * sein Ziel nicht, also kann eine an jedem Datensatz hängen. Erledigte zählen
 * nicht — sie sind Geschichte und vertragen ein verschwundenes Ziel.
 */
export function coreRecordReferences(deps: Deps, entityType: string, id: string): RecordReferenceInput[] {
  return deps.db
    .select({ id: followUps.id, title: followUps.title })
    .from(followUps)
    .where(and(eq(followUps.entityType, entityType), eq(followUps.entityId, id), isNull(followUps.doneAt)))
    .all()
    .map((f) => ({ label: { key: 'deletion.references.followUp', params: { title: f.title } }, entity: 'followUp', id: f.id }));
}

/**
 * Alle Verweise auf einen Datensatz — Kern plus jedes **aktive** Modul, wie
 * `findMediaReferences`. Wirft ein Haken, wird das durchgereicht (vgl.
 * `holdsFor`): Ein defekter Haken darf nie als „zeigt nichts“ gelesen werden.
 */
export function findRecordReferences(deps: Deps, entityType: string, id: string): RecordReference[] {
  return enabledManifests(deps).flatMap((m) => [...(m.recordReferences?.(deps, entityType, id) ?? [])].map((r) => withResolvedLabel(deps, r)));
}

/**
 * Wie `findRecordReferences`, ohne die Verweise des Kerns. Für Datensätze, die
 * ihre Wiedervorlagen beim Löschen selbst mitnehmen (die Akte): Dort hindert
 * eine offene Wiedervorlage nicht (Akte-fertig-Spec § 4.2), ein Verweis eines
 * Moduls — eine Buchung auf ihren Beleg — aber schon.
 */
export function findModuleRecordReferences(deps: Deps, entityType: string, id: string): RecordReference[] {
  return enabledManifests(deps).filter((m) => m.key !== CORE_MODULE_KEY).flatMap((m) => [...(m.recordReferences?.(deps, entityType, id) ?? [])].map((r) => withResolvedLabel(deps, r)));
}

/**
 * Die Halter, die eine Löschung **heute** verhindern: dauerhafte und solche,
 * deren Frist noch läuft. Anders als beim Kontakt heißt eine leere Liste hier
 * „frei“ — Tier, Projekt und Eintrag sind Arbeitsmaterial, kein
 * personenbezogener Datensatz, der eine nachgewiesene Frist braucht.
 */
export function blockingHolds(deps: Deps, entityType: string, id: string): RetentionHold[] {
  const today = todayIn(deps);
  return holdsFor(deps, entityType, id).filter((h) => h.until === null || h.until >= today);
}

export interface DeletionPreview {
  isPublished: boolean;
  /** Nur die blockierenden Halter. */
  holds: RetentionHold[];
  references: RecordReference[];
  media: MediaUsage[];
  deletable: boolean;
}

/**
 * Die eine Stelle, die über die Löschbarkeit eines Webseiten-Datensatzes
 * entscheidet. Löschfunktion und Löschdialog rufen beide sie auf, damit der
 * Dialog nie „frei“ zeigt, wo der Dienst ablehnt.
 */
export function buildDeletionPreview(deps: Deps, subject: { entityType: string; id: string; isPublished: boolean; assetIds: readonly string[] }): DeletionPreview {
  const holds = blockingHolds(deps, subject.entityType, subject.id);
  const references = findRecordReferences(deps, subject.entityType, subject.id);
  const media = describeMediaUsage(deps, subject.assetIds, { entity: subject.entityType, id: subject.id });
  return { isPublished: subject.isPublished, holds, references, media, deletable: !subject.isPublished && holds.length === 0 && references.length === 0 };
}

/**
 * K2: „noch gehalten“ als Satz der Sprachdatei — die Halter als Liste (getrennt durch U+001F), dazu das späteste Ende
 * oder „dauerhaft“, Datum wie die Anzeige (`messageDate`). Wie `retentionHoldActive` beim Kontakt.
 */
export function recordHeldConflict(deps: Pick<Deps, 'db' | 'registry'>, holds: readonly RetentionHold[]): Failure {
  const holders = holds.map((h) => h.label).join('\u001f');
  const permanent = holds.some((h) => h.until === null);
  const until = permanent ? null : holds.map((h) => h.until!).sort().at(-1)!;
  return localizedConflict('recordHeld', 'errors.recordHeld', until === null ? { permanent: 'yes', holders } : { permanent: 'no', untilText: messageDate(deps, until), holders });
}

/** K2: „es zeigt noch darauf“ als Satz der Sprachdatei, die Verweise als Liste (getrennt durch U+001F). */
export function stillReferencedConflict(references: readonly RecordReference[]): Failure {
  return localizedConflict('stillReferenced', 'errors.stillReferenced', { references: references.map((r) => r.label).join('\u001f') });
}

/** Der Konflikt zu einer Vorschau, oder `null`, wenn gelöscht werden darf. */
export function deletionConflict(deps: Pick<Deps, 'db' | 'registry'>, preview: DeletionPreview): Failure | null {
  if (preview.isPublished) return conflict('stillPublished', 'Der Datensatz ist veröffentlicht. Ziehen Sie ihn erst zurück.');
  if (preview.holds.length > 0) return recordHeldConflict(deps, preview.holds);
  if (preview.references.length > 0) return stillReferencedConflict(preview.references);
  return null;
}
