import { createFollowUp, notFound, requirePermission, validate, type CallContext, type Deps, type FollowUpRecord, type FollowUpTarget, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { documents } from './schema';

export const documentFollowUpSchema = z.object({
  documentId: z.string().min(1),
  dueAt: z.string().date(),
  title: z.string().trim().min(1).max(200),
  assigneeUserId: z.string().trim().min(1).nullable().optional(),
});

/**
 * Der Kern prüft die Entität nicht. Hier steht die Prüfung, die er nicht
 * leisten kann: Gibt es das Dokument, und darf der Aufrufer in der Akte
 * schreiben. Danach gilt das Recht des Kerns.
 */
export async function createDocumentFollowUp(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FollowUpRecord>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;
  const parsed = validate(deps, documentFollowUpSchema, input);
  if (!parsed.ok) return parsed;
  const doc = deps.db.select({ id: documents.id }).from(documents).where(eq(documents.id, parsed.value.documentId)).get();
  if (!doc) return notFound('document', parsed.value.documentId);
  const { documentId, ...rest } = parsed.value;
  return createFollowUp(deps, ctx, { entityType: 'document', entityId: documentId, ...rest });
}

export function dmsFollowUpTargets(deps: Deps, entityType: string, id: string): FollowUpTarget | null {
  if (entityType !== 'document') return null;
  const doc = deps.db.select({ number: documents.number, subject: documents.subject }).from(documents).where(eq(documents.id, id)).get();
  if (!doc) return null;
  return { label: doc.number ? `${doc.number} · ${doc.subject}` : doc.subject, href: `/dms/${id}` };
}
