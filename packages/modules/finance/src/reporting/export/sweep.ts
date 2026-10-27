import { systemContext, type Deps } from '@kompass/core';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { financeAudit } from '../../audit';
import { financeDataExports } from '../../schema';

/** So viele Tage bleibt ein ZIP zum Herunterladen (Joe 2026-10-24): fest im Code, keine Einstellung. */
export const DATA_EXPORT_KEEP_DAYS = 30;
const KEEP_MS = DATA_EXPORT_KEEP_DAYS * 86_400_000;

/** Bis wann ein Export bleibt — berechnet aus dem Zeitpunkt des Erzeugens, nie gespeichert. */
export function dataExportExpiresAt(createdAt: string): string {
  return new Date(new Date(createdAt).getTime() + KEEP_MS).toISOString();
}

/** Abgelaufen, sobald der Zeitpunkt aus `dataExportExpiresAt` vorbei ist — auch bevor das Aufräumen lief. */
export function dataExportExpired(createdAt: string, now: Date): boolean {
  return now.getTime() > new Date(createdAt).getTime() + KEEP_MS;
}

/**
 * Löscht die ZIPs, deren Frist abgelaufen ist (Modul-Haken `housekeeping`). Die Zeile bleibt mit `file_deleted_at`;
 * das Protokoll sagt, dass Kompass sie gelöscht hat (Kanal System).
 */
export async function sweepDataExports(deps: Deps): Promise<{ removed: number }> {
  const now = deps.clock.now();
  const before = new Date(now.getTime() - KEEP_MS).toISOString();
  const due = deps.db.select().from(financeDataExports).where(and(isNull(financeDataExports.fileDeletedAt), lt(financeDataExports.createdAt, before))).all();
  if (due.length === 0) return { removed: 0 };
  const ctx = systemContext();
  // Erst die Zeilen, dann die Dateien: Bricht der Lauf dazwischen ab, bleibt höchstens eine Datei ohne gültige Zeile,
  // die niemand mehr herunterladen kann; der nächste Datenexport räumt solche Waisen beim Start ab.
  deps.db.transaction((tx) => {
    for (const row of due) {
      tx.update(financeDataExports).set({ fileDeletedAt: now.toISOString() }).where(eq(financeDataExports.id, row.id)).run();
      financeAudit(tx, deps, ctx, { action: 'finance.dataExport.expire', entity: 'financeDataExport', id: row.id, after: { fileDeletedAt: now.toISOString() }, params: { years: row.designations } });
    }
  });
  const store = deps.files('finance');
  for (const row of due) await store.delete(row.fileName);
  return { removed: due.length };
}
