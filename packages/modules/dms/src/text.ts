import {
  conflict,
  isoNow,
  notFound,
  ok,
  readSetting,
  recordAudit,
  requirePermission,
  validate,
  type CallContext,
  type DbOrTx,
  type Deps,
  type Result,
} from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { documents } from './schema';
import { readDocumentFile } from './storage';

export const extractTextSchema = z.object({ documentId: z.string().min(1) });

/** Ab hier wird nicht mehr wiederholt; ein viertes Mal ist `conflict`. */
const MAX_ATTEMPTS = 3;

export interface ExtractResult {
  documentId: string;
  pages: number;
  status: 'done' | 'failed' | 'unavailable';
}

/**
 * Ein Dokument lesen. Kein Hintergrundzauber: ein Service wie jeder andere,
 * damit er einzeln testbar ist, über MCP angestoßen werden kann und einen
 * Eintrag im Änderungsprotokoll hinterlässt — **einen je Dokument**.
 */
export async function extractDocumentText(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<ExtractResult>> {
  const denied = requirePermission(ctx, 'dms.manage');
  if (denied) return denied;

  const parsed = validate(deps, extractTextSchema, input);
  if (!parsed.ok) return parsed;
  const { documentId } = parsed.value;

  const row = deps.db.select().from(documents).where(eq(documents.id, documentId)).get();
  if (!row) return notFound('document', documentId);
  if (!row.fileName) return conflict('documentHasNoFile');
  if (row.textAttempts >= MAX_ATTEMPTS) return conflict('textExtractionGaveUp');

  const probe = await deps.textExtraction.probe();
  if (!probe.ok) {
    // Keine Schuld des Dokuments: Versuche werden nicht gezählt, damit es
    // wieder drankommt, sobald die Werkzeuge da sind.
    deps.db
      .update(documents)
      .set({ textStatus: 'unavailable', textError: probe.error })
      .where(eq(documents.id, documentId))
      .run();
    return ok({ documentId, pages: 0, status: 'unavailable' });
  }

  deps.db.update(documents).set({ textStatus: 'running' }).where(eq(documents.id, documentId)).run();

  const languages = ocrLanguages(deps);
  let pages;
  try {
    pages = await deps.textExtraction.extract({
      bytes: await readDocumentFile(deps, row.fileName),
      languages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = row.textAttempts + 1;
    deps.db
      .update(documents)
      .set({
        textStatus: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        textAttempts: attempts,
        textError: message,
      })
      .where(eq(documents.id, documentId))
      .run();
    return ok({ documentId, pages: 0, status: 'failed' });
  }

  const now = isoNow(deps.clock);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(documents)
      .set({ textStatus: 'done', textAttempts: 0, textError: null, textExtractedAt: now })
      .where(eq(documents.id, documentId))
      .run();

    recordAudit(tx, deps, ctx, {
      action: 'document.textExtracted',
      entityType: 'document',
      entityId: documentId,
      before: { textStatus: row.textStatus },
      after: { textStatus: 'done', pages: pages.length },
      summary: `Volltext von ${row.number ?? row.subject} gelesen (${pages.length} Seiten)`,
    });

    return ok({ documentId, pages: pages.length, status: 'done' as const });
  });
}

/** Die eingestellten Sprachen, als Tesseract-Kürzel. */
export function ocrLanguages(deps: Deps): string[] {
  const raw = readSetting(deps, 'dms.ocrLanguages') ?? 'deu+eng';
  return String(raw).split('+').map((l) => l.trim()).filter(Boolean);
}
