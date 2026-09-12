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
