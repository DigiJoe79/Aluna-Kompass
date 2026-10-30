import { isoNow, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { agendaItemViewInternal, type AgendaItemView } from './agenda';
import { governanceConflict } from './errors';
import { meetingRowInternal, meetingStateOf } from './meetings';
import { minutesVersionsInternal } from './minutes/signed';
import { governanceAgendaItems } from './schema';
import { requireWriterInternal } from './session';

export const agendaNoteSchema = z.object({
  itemId: z.string().min(1),
  /** Fließtext fürs Protokoll; leer entfernt die Notiz. */
  note: z.string().max(5000),
});

/**
 * Die Notiz eines TOP (Spec § 5.4), Fließtext fürs Protokoll — im Mitlauf durch die Schreibende, nach dem Ende der
 * Sitzung mit `governance.record` (der Entwurf wird neu erzeugt), bei nachgetragenen Sitzungen mit `governance.manage`.
 * Sobald eine unterschriebene Fassung abgelegt ist (`minutesFiled`) und nach dem Festschreiben nur über die Berichtigung. Der Text steht nur am Datensatz, das Protokoll nennt die Position.
 */
export async function setAgendaNote(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AgendaItemView>> {
  const denied = requirePermission(ctx, 'governance.record');
  if (denied) return denied;
  const parsed = validate(deps, agendaNoteSchema, input);
  if (!parsed.ok) return parsed;
  const item = deps.db.select().from(governanceAgendaItems).where(eq(governanceAgendaItems.id, parsed.value.itemId)).get();
  if (!item) return notFound('governanceAgendaItem', parsed.value.itemId);
  const meeting = meetingRowInternal(deps.db, item.meetingId)!;
  const state = meetingStateOf(meeting);
  if (state === 'signed') return governanceConflict('meetingSealed');
  // Mit abgelegter unterschriebener Fassung gilt das Papier; der Datensatz wiche sonst davon ab — dann nur Berichtigung.
  if (minutesVersionsInternal(deps.db, meeting.id).length > 0) return governanceConflict('minutesFiled');
  if (state !== 'recorded' || meeting.backfilled) {
    const refused = requireWriterInternal(deps.db, ctx, meeting);
    if (refused) return refused;
  }
  const note = parsed.value.note.trim() || null;
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceAgendaItems).set({ minutesNote: note, updatedAt: isoNow(deps.clock) }).where(eq(governanceAgendaItems.id, item.id)).run();
    recordAudit(tx, deps, ctx, { action: 'governance.agenda.note', entityType: 'governanceAgendaItem', entityId: item.id, params: { position: item.position } });
    return ok(agendaItemViewInternal(deps, tx, item.id));
  });
}
