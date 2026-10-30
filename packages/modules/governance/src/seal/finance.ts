import type { CallContext, DbOrTx, Deps } from '@kompass/core';
import { applyBoardRemunerationInternal } from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { minutesVersionsInternal } from '../minutes/signed';
import { governanceAgendaItems, governanceMeetings, governanceResolutions } from '../schema';

/**
 * Folge `financeReference` beim Festschreiben (G7). Nur eine angenommene Vergütung (`remuneration`) schreibt in die
 * Finanzen — den Einrichtungspunkt „Vergütung des Vorstands“ über deren interne Funktion: Grundlage ist die
 * Satzungsfundstelle, sonst der Titel des TOP; gilt ab den Angaben; Tag und Protokoll der Sitzung. Entlastung,
 * Genehmigung, Rücklage und Beitragsordnung lesen die Finanzen und Mitglieder selbst; die Regel für Auslagen
 * (`expenseRule`) hat in den Finanzen kein Gegenstück und bleibt in Gremien.
 */
export function applyFinanceReferenceInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, resolutionId: string): void {
  const row = tx.select().from(governanceResolutions).where(eq(governanceResolutions.id, resolutionId)).get();
  if (!row || row.kind !== 'remuneration' || row.outcome !== 'adopted') return;
  const details = row.details as { statuteReference: string | null; validFrom: string } | null;
  if (!details) return;
  const meeting = row.meetingId ? tx.select({ id: governanceMeetings.id, heldOn: governanceMeetings.heldOn }).from(governanceMeetings).where(eq(governanceMeetings.id, row.meetingId)).get() : undefined;
  const title = row.agendaItemId ? tx.select({ title: governanceAgendaItems.title }).from(governanceAgendaItems).where(eq(governanceAgendaItems.id, row.agendaItemId)).get()?.title : undefined;
  applyBoardRemunerationInternal(tx, deps, ctx, {
    allowed: true,
    basisText: details.statuteReference ?? title ?? row.text,
    validFrom: details.validFrom,
    documentId: meeting ? (minutesVersionsInternal(tx, meeting.id).at(-1)?.documentId ?? null) : null,
    decidedOn: meeting?.heldOn ?? row.decidedOn,
    resolutionId: row.id,
  });
}
