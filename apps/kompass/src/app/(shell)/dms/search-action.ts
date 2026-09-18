'use server';

import { listDocuments } from '@kompass/module-dms';
import { requireSession } from '@/lib/request-context';

export interface PickedDocument {
  id: string;
  number: string | null;
  subject: string;
  phase: 'draft' | 'issued';
}

/** Bis zu zwanzig Treffer für ein Suchfeld; das eigene Dokument fällt heraus. */
export async function searchDocumentsAction(text: string, exceptId?: string): Promise<PickedDocument[]> {
  const { deps, ctx } = await requireSession();
  const trimmed = text.trim();
  const res = await listDocuments(deps, ctx, trimmed ? { text: trimmed, limit: 20 } : { limit: 20 });
  if (!res.ok) return [];
  return res.value.documents
    .filter((d) => d.id !== exceptId)
    .map((d) => ({ id: d.id, number: d.number, subject: d.subject, phase: d.phase }));
}

/**
 * Das jüngste Schreiben an diesen Kontakt — die wahrscheinlichste Antwort auf
 * eingehende Post. Ein Vorschlag, kein Zwang: Das Feld bleibt änderbar.
 */
export async function lastOutgoingToAction(contactId: string): Promise<PickedDocument | null> {
  const { deps, ctx } = await requireSession();
  const res = await listDocuments(deps, ctx, {
    linkedTo: { entityType: 'contact', entityId: contactId },
    direction: 'outgoing',
    phase: 'issued',
    limit: 1,
  });
  if (!res.ok || res.value.documents.length === 0) return null;
  const doc = res.value.documents[0]!;
  return { id: doc.id, number: doc.number, subject: doc.subject, phase: doc.phase };
}
