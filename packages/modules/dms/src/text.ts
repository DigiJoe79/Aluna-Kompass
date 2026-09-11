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
import { and, count, eq, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { documents } from './schema';
import { readDocumentFile } from './storage';
import { replaceDocumentText } from './index-store';

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
  if (!row.fileName) return conflict('documentHasNoFile', 'Dokument hat keine Datei');
  if (row.textAttempts >= MAX_ATTEMPTS) {
    return conflict('textExtractionGaveUp', 'Maximale Anzahl an Erkennungsversuchen erreicht');
  }

  const probe = await deps.textExtraction.probe();
  if (!probe.ok) {
    // Keine Schuld des Dokuments: Versuche werden nicht gezählt, damit es
    // wieder drankommt, sobald die Werkzeuge da sind.
    return deps.db.transaction((tx: DbOrTx) => {
      tx.update(documents)
        .set({ textStatus: 'unavailable', textError: probe.error })
        .where(eq(documents.id, documentId))
        .run();

      recordAudit(tx, deps, ctx, {
        action: 'document.textExtractionUnavailable',
        entityType: 'document',
        entityId: documentId,
        before: { textStatus: row.textStatus },
        after: { textStatus: 'unavailable', reason: probe.error },
        summary: `Volltext von ${row.number ?? row.subject} nicht lesbar: ${probe.error}`,
      });

      return ok({ documentId, pages: 0, status: 'unavailable' as const });
    });
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
    const gaveUp = attempts >= MAX_ATTEMPTS;

    return deps.db.transaction((tx: DbOrTx) => {
      tx.update(documents)
        .set({ textStatus: gaveUp ? 'failed' : 'pending', textAttempts: attempts, textError: message })
        .where(eq(documents.id, documentId))
        .run();

      // Protokolliert wird das Aufgeben, nicht jeder Anlauf. Ein Versuch, dem
      // ein weiterer folgt, ist noch kein Vorgang — der Zähler trägt ihn. Was
      // ins Protokoll gehört, ist der Moment, ab dem dieses Dokument nicht
      // mehr gelesen wird: Er erklärt später, warum im Volltext etwas fehlt.
      if (gaveUp) {
        recordAudit(tx, deps, ctx, {
          action: 'document.textExtractionFailed',
          entityType: 'document',
          entityId: documentId,
          before: { textStatus: row.textStatus, textAttempts: row.textAttempts },
          after: { textStatus: 'failed', textAttempts: attempts, reason: message },
          summary: `Volltext von ${row.number ?? row.subject} nach ${attempts} Versuchen aufgegeben: ${message}`,
        });
      }

      return ok({ documentId, pages: 0, status: 'failed' as const });
    });
  }

  // Erst der Index, dann der Zustand: Bricht das Schreiben ab, bleibt das
  // Dokument auf `running` und wird beim naechsten Start neu genommen. Andersrum
  // stuende `done` an einem Dokument, das nicht auffindbar ist.
  replaceDocumentText(
    deps,
    documentId,
    pages.map((p) => ({ page: p.page, text: p.text })),
  );

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

/**
 * Alles noch einmal lesen. Setzt nur den Zustand zurück — gelesen wird vom
 * Worker, eins nach dem anderen. Ein Knopf, der zehn Minuten blockiert, wäre
 * kein Knopf, sondern eine Falle.
 *
 * Der Index bleibt bis zum jeweiligen Lauf stehen: Die Suche wird während des
 * Neu-Lesens nicht schlechter, nur langsam aktueller.
 */
export async function reindexAllDocuments(deps: Deps, ctx: CallContext): Promise<Result<{ queued: number }>> {
  const denied = requirePermission(ctx, 'dms.manage');
  if (denied) return denied;

  const rows = deps.db.select({ id: documents.id }).from(documents).where(isNotNull(documents.fileName)).all();

  return deps.db.transaction((tx: DbOrTx) => {
    for (const row of rows) {
      tx.update(documents)
        .set({ textStatus: 'pending', textAttempts: 0, textError: null })
        .where(eq(documents.id, row.id))
        .run();
    }

    recordAudit(tx, deps, ctx, {
      action: 'document.reindexRequested',
      entityType: 'document',
      entityId: 'all',
      before: null,
      after: { queued: rows.length },
      summary: `${rows.length} Dokumente zum Neu-Lesen vorgemerkt`,
    });

    return ok({ queued: rows.length });
  });
}

/**
 * Wie viele Dokumente mit Datei noch nicht fertig gelesen sind.
 */
export function countUnreadDocuments(deps: Deps, ctx: CallContext): Result<number> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;

  const row = deps.db
    .select({ value: count() })
    .from(documents)
    .where(and(isNotNull(documents.fileName), or(isNull(documents.textStatus), ne(documents.textStatus, 'done'))))
    .get();

  return ok(row?.value ?? 0);
}

