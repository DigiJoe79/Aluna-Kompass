import {
  conflict,
  invalid,
  isoNow,
  linkedAccess,
  newId,
  requirePermission,
  validate,
  type CallContext,
  type DbOrTx,
  type Deps,
  type Failure,
  type Result,
} from '@kompass/core';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { documentTypeFor } from './catalog';
import { storeIncoming } from './incoming';
import { resolveFolder } from './service';
import { documentLinks } from './schema';

/**
 * Ein Bezug auf den Vorgang eines Moduls — der Beweis, auf den
 * `readLinkedDocument` sich stützt. Ein Modul, das seine Verknüpfungen in einer
 * eigenen Tabelle führt, schreibt **beide** in derselben Transaktion. Idempotent.
 */
export function linkDocumentInternal(tx: DbOrTx, deps: Deps, input: { documentId: string; entityType: string; entityId: string; role?: 'sender' | 'recipient' | 'about' }): string {
  const role = input.role ?? 'about';
  const existing = tx
    .select({ id: documentLinks.id })
    .from(documentLinks)
    .where(and(eq(documentLinks.documentId, input.documentId), eq(documentLinks.entityType, input.entityType), eq(documentLinks.entityId, input.entityId), eq(documentLinks.role, role)))
    .get();
  if (existing) return existing.id;
  const id = newId();
  tx.insert(documentLinks).values({ id, documentId: input.documentId, entityType: input.entityType, entityId: input.entityId, role, createdAt: isoNow(deps.clock) }).run();
  return id;
}

/** Löst alle Bezüge des Dokuments auf diesen Vorgang. Protokolliert wird im Dienst des Moduls. */
export function unlinkDocumentInternal(tx: DbOrTx, input: { documentId: string; entityType: string; entityId: string }): number {
  return tx
    .delete(documentLinks)
    .where(and(eq(documentLinks.documentId, input.documentId), eq(documentLinks.entityType, input.entityType), eq(documentLinks.entityId, input.entityId)))
    .run().changes;
}

export interface ReceivedDocument { id: string; number: string; fileChecksum: string }

class ReceiveAborted extends Error {
  constructor(readonly failure: Failure) {
    super('receive aborted by afterReceive');
    this.name = 'ReceiveAborted';
  }
}

export function abortReceive(failure: Failure): never {
  throw new ReceiveAborted(failure);
}

const uploadSchema = z.object({
  bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' }),
  typeKey: z.string().min(1),
  subject: z.string().trim().min(1).max(300),
  documentDate: z.string().date(),
  folder: z.string().trim().min(1).nullable().optional(),
  links: z.array(z.object({ entityType: z.string().trim().min(1).max(60), entityId: z.string().trim().min(1), role: z.enum(['sender', 'recipient', 'about']).default('about') })).min(1),
});

/**
 * Eingang im Namen eines Vorgangs: die Helferin legt den Beleg zu ihrer Auslage
 * ab, ohne die Akte zu kennen. Abgelegt wird unter dem `receivePermission`
 * jedes angemeldeten Bezugs; mindestens einer muss dabei sein. Der Betreff
 * nennt keine Person (Regel des Aufrufers) und steht nicht im Protokoll.
 */
export async function receiveGeneratedUpload<T = undefined>(deps: Deps, ctx: CallContext, input: z.input<typeof uploadSchema> & { afterReceive?: (tx: DbOrTx, doc: ReceivedDocument) => T }): Promise<Result<{ document: ReceivedDocument; after: T | undefined }>> {
  const parsed = validate(deps, uploadSchema, { bytes: input.bytes, typeKey: input.typeKey, subject: input.subject, documentDate: input.documentDate, folder: input.folder, links: input.links });
  if (!parsed.ok) return parsed;

  const registered = parsed.value.links.map((link) => linkedAccess(deps, link.entityType)).filter((a) => a !== null);
  if (registered.length === 0) return conflict('noLinkedRecord', 'Ablegen im Namen eines Vorgangs braucht einen Bezug auf einen Vorgang, den ein Modul angemeldet hat');
  for (const access of registered) {
    if (!access.receivePermission) return conflict('noLinkedRecord', `Zu „${access.entityType}“ legt das Modul ${access.module} nichts ab`);
    const denied = requirePermission(ctx, access.receivePermission);
    if (denied) return denied;
  }

  const docType = documentTypeFor(deps.db, parsed.value.typeKey);
  if (!docType || !docType.isActive) return invalid([{ path: 'typeKey', message: 'unknownDocumentType' }]);
  const folderRes = resolveFolder(deps.db, parsed.value.folder, docType.defaultFolder ?? null);
  if (!folderRes.ok) return folderRes;

  try {
    return await storeIncoming(
      deps, ctx, parsed.value.bytes,
      { docType, subject: parsed.value.subject, documentDate: parsed.value.documentDate, folder: folderRes.value, links: parsed.value.links, relations: [], audit: { after: {}, summary: (number) => `Dokument ${number} im Namen eines Vorgangs abgelegt` } },
      (tx, doc) => ({ document: doc, after: input.afterReceive?.(tx, doc) }),
    );
  } catch (error) {
    if (error instanceof ReceiveAborted) return error.failure;
    throw error;
  }
}
