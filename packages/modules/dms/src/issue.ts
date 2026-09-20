import { buildContext, conflict, isoNow, newId, notFound, ok, prepare, recordAudit, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { documentTypeFor } from './catalog';
import { NumberMovedOn } from './drafts';
import { documentLinks, documents } from './schema';
import { allocateDocumentNumber, peekDocumentNumber, resolveFolder, toRecord, type DocumentRecord } from './service';
import { removeDocumentFile, storeDocumentFile } from './storage';

export interface IssuedDocument { id: string; number: string; fileChecksum: string }

export interface IssueInput<T> {
  templateKey: string;
  input: unknown;
  snapshot?: unknown;
  subject: string;
  documentDate: string;
  folder?: string | null;
  links?: { entityType: string; entityId: string; role?: 'sender' | 'recipient' | 'about' }[];
  afterIssue?: (tx: DbOrTx, doc: IssuedDocument) => T;
}

class IssueAborted extends Error {
  constructor(readonly failure: Failure) {
    super('issue aborted by afterIssue');
    this.name = 'IssueAborted';
  }
}

/** Aus `afterIssue` heraus: Zeile, Nummer, Bezüge und Datei verschwinden, der Aufrufer bekommt `failure`. Zurückgerollt wird nur durch Werfen. */
export function abortIssue(failure: Failure): never {
  throw new IssueAborted(failure);
}

/**
 * Der Weg, auf dem ein Modul ein festgeschriebenes Dokument ausstellt. Anders
 * als `fileDocument` gibt es keinen Entwurf: Die ID entsteht vorab, die Datei
 * wird unter ihr geschrieben, die Zeile entsteht erst in der Transaktion.
 *
 * Wie dort trägt das PDF seine Nummer, also steht sie vor dem Rendern fest,
 * und gerendert wird außerhalb der Transaktion: ansehen, rendern, schreiben, in
 * der Transaktion ziehen — weicht die gezogene ab, neu rendern. `afterIssue`
 * kann deshalb bis zu dreimal laufen und darf außerhalb von `tx` nichts
 * bewirken; seine Voraussetzungen prüft es dort erneut, weil zwischen Rendern
 * und Transaktion Zeit vergeht.
 */
export async function issueGeneratedDocument<T = undefined>(deps: Deps, ctx: CallContext, input: IssueInput<T>): Promise<Result<{ document: DocumentRecord; after: T | undefined }>> {
  // Vorprüfung: Vorlage, ihr Recht, die Eingabe. `prepare` prüft `template.permission`.
  const first = await prepare(deps, ctx, { templateKey: input.templateKey, input: input.input });
  if (!first.ok) return first;
  const template = first.value.template;
  const docType = documentTypeFor(deps.db, template.type);
  if (!docType) return notFound('documentType', template.type);
  if (!docType.ownerModule) return conflict('documentTypeNotOwned', `Dokumentart „${docType.label}“ gehört keinem Modul; freie Arten schreibt die Akte über Entwürfe fest`);
  if (!template.permission) return conflict('templateWithoutPermission', `Vorlage „${template.key}“ nennt kein Recht; ein Modul stellt nur unter seinem eigenen Recht aus`);

  const folderRes = resolveFolder(deps.db, input.folder, docType.defaultFolder);
  if (!folderRes.ok) return folderRes;

  const id = newId();
  let fileName: string | null = null;
  const cleanUp = async () => { if (fileName) await removeDocumentFile(deps, fileName); };

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const year = deps.clock.now().getUTCFullYear();
      const expected = peekDocumentNumber(deps.db, docType.prefix, year);
      const prepared = await prepare(deps, ctx, { templateKey: input.templateKey, input: input.input }, { number: expected, issuedOn: input.documentDate });
      if (!prepared.ok) return prepared;
      const { built, baseId, base, bodyTypst } = prepared.value;
      const context = await buildContext(deps, ctx, expected, input.documentDate);
      const { bytes } = await deps.documents.render({ baseId, bodyTypst, slots: built.slots, context });

      const stored = await storeDocumentFile(deps, id, bytes);
      if (!stored.ok) return stored;
      fileName = stored.value.fileName;

      const snapshot = { input: input.snapshot ?? prepared.value.data, slots: built.slots, base: baseId, baseChecksum: base.checksum };
      try {
        return deps.db.transaction((tx: DbOrTx) => {
          const number = allocateDocumentNumber(tx, docType.prefix, year);
          if (number !== expected) throw new NumberMovedOn();
          const now = isoNow(deps.clock);
          tx.insert(documents)
            .values({
              id, phase: 'issued', direction: docType.defaultDirection, sourceKind: 'generated', typeKey: docType.key, number,
              subject: input.subject, documentDate: input.documentDate, folder: folderRes.value, draftBody: null, templateKey: template.key,
              inputSnapshot: JSON.stringify(snapshot), fileName: stored.value.fileName, fileChecksum: stored.value.fileChecksum, fileBytes: stored.value.fileBytes,
              textStatus: 'pending', textAttempts: 0, textError: null, textExtractedAt: null,
              status: 'issued', createdByUserId: ctx.userId ?? 'system', createdAt: now, updatedAt: now,
            })
            .run();
          for (const link of input.links ?? []) {
            tx.insert(documentLinks).values({ id: newId(), documentId: id, entityType: link.entityType, entityId: link.entityId, role: link.role ?? 'about', createdAt: now }).run();
          }
          // Nummer, Vorlage, Art — nie der Betreff und nie die Bezüge (Vorarbeiten-Spec, Regel 8).
          recordAudit(tx, deps, ctx, { action: 'dms.issue', entityType: 'document', entityId: id, after: { number, templateKey: template.key, typeKey: docType.key }, summary: `Dokument ${number} ausgestellt` });
          const after = input.afterIssue?.(tx, { id, number, fileChecksum: stored.value.fileChecksum });
          const row = tx.select().from(documents).where(eq(documents.id, id)).get()!;
          return ok({ document: toRecord(deps, row, tx), after });
        });
      } catch (error) {
        if (error instanceof NumberMovedOn) continue; // der nächste Anlauf überschreibt die Datei
        throw error;
      }
    }
    await cleanUp();
    return conflict('documentNumberContention', 'Dokumentnummer konnte nicht reserviert werden');
  } catch (error) {
    await cleanUp();
    if (error instanceof IssueAborted) return error.failure;
    throw error;
  }
}
