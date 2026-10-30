import { invalid, notFound, ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { assemblyPersonsInternal, financeFiscalYears, type AssemblyPerson } from '@kompass/module-finance';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { catchAborted, GovernanceAborted } from './errors';
import { meetingRowInternal } from './meetings';
import { exclusionInputSchema, votesInputSchema, writeResolutionInternal, type ResolutionView } from './resolutions';
import { governanceAgendaItems, governanceResolutions } from './schema';
import { requireWriterInternal } from './session';

const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const id = z.string().min(1);

export const dischargeCandidatesSchema = z.object({ fiscalYearId: id });
export const dischargeSaveSchema = z.object({
  agendaItemId: id,
  fiscalYearId: id,
  /** Einzeln: je Person ein Beschluss, sie stimmt nicht mit; gesamt: ein Beschluss, alle Betroffenen stimmen nicht mit. */
  mode: z.enum(['individual', 'collective']),
  /** Vorgabe: die Liste der Finanzen für das Geschäftsjahr; weitere Personen lassen sich ergänzen (Spec § 8.1). */
  contactIds: z.array(id).min(1).max(50).optional(),
  votedAt: TIME,
  votes: votesInputSchema.optional(),
  yesComputed: z.boolean().optional(),
  unanimous: z.boolean().optional(),
  /** Ausnahmsweise von Hand; ohne Angabe die Betroffenen (§ 34 BGB analog). */
  excluded: z.array(exclusionInputSchema).max(100).optional(),
});

/** Die zu Entlastenden eines Geschäftsjahres aus den Finanzen (Rollen `board-member`/`treasurer` im Jahr, Übergaben). */
export async function dischargeCandidates(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AssemblyPerson[]>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, dischargeCandidatesSchema, input);
  if (!parsed.ok) return parsed;
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, parsed.value.fiscalYearId)).get();
  if (!year) return notFound('fiscalYear', parsed.value.fiscalYearId);
  return ok(assemblyPersonsInternal(deps.db, year));
}

type DischargeDetails = { fiscalYearId: string; mode: 'individual' | 'collective'; contactIds: string[] };

/**
 * Entlastung im Mitlauf (Spec § 5.4): einzeln je Person ein Beschluss `discharge`, gesamt einer. Ein zweiter Aufruf
 * ändert die vorhandenen Beschlüsse des TOP (je Person bzw. den gesamten). Gremien schreibt nichts in die Finanzen;
 * Schritt 11 liest das Ergebnis mit G7.
 */
export async function saveDischarge(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ResolutionView[]>> {
  const denied = requirePermission(ctx, 'governance.record');
  if (denied) return denied;
  const parsed = validate(deps, dischargeSaveSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const item = deps.db.select().from(governanceAgendaItems).where(eq(governanceAgendaItems.id, v.agendaItemId)).get();
  if (!item) return notFound('governanceAgendaItem', v.agendaItemId);
  const meeting = meetingRowInternal(deps.db, item.meetingId)!;
  const refused = requireWriterInternal(deps.db, ctx, meeting);
  if (refused) return refused;
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, v.fiscalYearId)).get();
  if (!year) return notFound('fiscalYear', v.fiscalYearId);
  const contactIds = v.contactIds ?? assemblyPersonsInternal(deps.db, year).map((p) => p.contactId);
  if (contactIds.length === 0) return invalid([{ path: 'contactIds', message: 'required' }]);
  const groups = v.mode === 'individual' ? contactIds.map((c) => [c]) : [contactIds];
  const text = item.proposal ?? item.title;
  return catchAborted(() =>
    deps.db.transaction((tx: DbOrTx) => {
    const existing = tx
      .select()
      .from(governanceResolutions)
      .where(and(eq(governanceResolutions.agendaItemId, item.id), eq(governanceResolutions.kind, 'discharge')))
      .all();
    const views: ResolutionView[] = [];
    for (const group of groups) {
      const before =
        existing.find((r) => {
          const d = r.details as DischargeDetails | null;
          return d?.fiscalYearId === v.fiscalYearId && d.mode === v.mode && (v.mode === 'collective' || d.contactIds[0] === group[0]);
        }) ?? null;
      const details: DischargeDetails = { fiscalYearId: v.fiscalYearId, mode: v.mode, contactIds: group };
      const written = writeResolutionInternal(tx, deps, ctx, meeting, item, before, {
        kind: 'discharge',
        text: before?.text ?? text,
        votedAt: v.votedAt,
        ...(v.votes ? { votes: v.votes } : {}),
        ...(v.yesComputed !== undefined ? { yesComputed: v.yesComputed } : {}),
        ...(v.unanimous !== undefined ? { unanimous: v.unanimous } : {}),
        // Vorschlag aus den Angaben (§ 34 BGB analog), auch beim Ändern neu.
        excluded: v.excluded ?? group.map((contactId) => ({ contactId, reason: 'discharge' as const })),
        details,
      });
      if (!written.ok) throw new GovernanceAborted(written);
      views.push(written.value);
    }
    return ok(views);
  }),
  );
}
