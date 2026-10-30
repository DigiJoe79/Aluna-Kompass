import type { DbOrTx } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { governanceResolutionCounters } from './schema';

/** Beschlussnummer `B-{Jahr}-{lfd. Nr.}`, die laufende Nummer mindestens dreistellig: `B-2026-003` (Designer Phase 2, Joe 2026-10-28). */
export function formatResolutionNumber(year: number, sequence: number): string {
  return `B-${year}-${String(sequence).padStart(3, '0')}`;
}

/**
 * Vergibt die nächste Beschlussnummer eines Jahres (`formatResolutionNumber`), **vereinsweit über alle Organe** (je
 * Organ gäbe es „B-2026-001“ zweimal — Planprüfung 2026-10-28), lückenlos. Nur in der Transaktion des
 * Festschreibens (G4) und nur für `adopted`/`rejected`.
 */
export function allocateResolutionNumberInternal(tx: DbOrTx, year: number): string {
  const row = tx.select().from(governanceResolutionCounters).where(eq(governanceResolutionCounters.year, year)).get();
  const current = row?.next ?? 1;
  if (row) tx.update(governanceResolutionCounters).set({ next: current + 1 }).where(eq(governanceResolutionCounters.year, year)).run();
  else tx.insert(governanceResolutionCounters).values({ year, next: current + 1 }).run();
  return formatResolutionNumber(year, current);
}
