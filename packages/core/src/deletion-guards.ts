import { and, eq, isNull } from 'drizzle-orm';
import { followUps } from './db/schema';
import type { Deps } from './deps';
import { describeMediaUsage, type MediaUsage } from './media/service';
import type { RecordReference, RetentionHold } from './modules/manifest';
import { enabledManifests } from './modules/service';
import { conflict, type Failure } from './result';
import { holdsFor } from './retention/service';

/**
 * Die Verweise des Kerns selbst: offene Wiedervorlagen. `createFollowUp` prüft
 * sein Ziel nicht, also kann eine an jedem Datensatz hängen. Erledigte zählen
 * nicht — sie sind Geschichte und vertragen ein verschwundenes Ziel.
 */
export function coreRecordReferences(deps: Deps, entityType: string, id: string): RecordReference[] {
  return deps.db
    .select({ id: followUps.id, title: followUps.title })
    .from(followUps)
    .where(and(eq(followUps.entityType, entityType), eq(followUps.entityId, id), isNull(followUps.doneAt)))
    .all()
    .map((f) => ({ label: `Wiedervorlage „${f.title}“`, entity: 'followUp', id: f.id }));
}

/**
 * Alle Verweise auf einen Datensatz — Kern plus jedes **aktive** Modul, wie
 * `findMediaReferences`. Wirft ein Haken, wird das durchgereicht (vgl.
 * `holdsFor`): Ein defekter Haken darf nie als „zeigt nichts“ gelesen werden.
 */
export function findRecordReferences(deps: Deps, entityType: string, id: string): RecordReference[] {
  return enabledManifests(deps).flatMap((m) => [...(m.recordReferences?.(deps, entityType, id) ?? [])]);
}

/**
 * Die Halter, die eine Löschung **heute** verhindern: dauerhafte und solche,
 * deren Frist noch läuft. Anders als beim Kontakt heißt eine leere Liste hier
 * „frei“ — Tier, Projekt und Eintrag sind Arbeitsmaterial, kein
 * personenbezogener Datensatz, der eine nachgewiesene Frist braucht.
 */
export function blockingHolds(deps: Deps, entityType: string, id: string): RetentionHold[] {
  const today = deps.clock.now().toISOString().slice(0, 10);
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

/** Der Konflikt zu einer Vorschau, oder `null`, wenn gelöscht werden darf. Detail hinter dem ersten Doppelpunkt. */
export function deletionConflict(preview: DeletionPreview): Failure | null {
  if (preview.isPublished) return conflict('stillPublished', 'Der Datensatz ist veröffentlicht. Ziehen Sie ihn erst zurück.');
  if (preview.holds.length > 0) {
    return conflict('recordHeld', `Noch gehalten von: ${preview.holds.map((h) => `${h.label}${h.until ? ` (bis ${h.until})` : ' (dauerhaft)'}`).join('; ')}`);
  }
  if (preview.references.length > 0) return conflict('stillReferenced', `Es zeigt noch darauf: ${preview.references.map((r) => r.label).join('; ')}`);
  return null;
}
