import { invalid, isoNow, notFound, ok, readSetting, recordAudit, requireHumanChannel, requirePermission, validate, writeSettingInternal, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, eq, isNotNull, lt, ne } from 'drizzle-orm';
import { z } from 'zod';
import { catchAborted, governanceConflict, GovernanceAborted } from '../errors';
import { governanceRegisterFilings } from '../schema';
import { registerStatuteInternal } from '../statutes';
import { attachUnregisteredBasesInternal, filingOccasionsInternal, filingRowInternal, filingViewInternal, type FilingChangeView } from './filings';
import { completeInterimFollowUpInternal } from './interim-orders';
import { filingStatuteIdsInternal } from './requirements';

const shortText = z.string().trim().min(1).max(200);
export const filingCompleteSchema = z.object({
  filingId: z.string().min(1),
  registeredOn: z.iso.date(),
  registerCourt: shortText.optional(),
  registerNumber: shortText.optional(),
  /** Registerauszug, Vorschlag Art Grundlagendokument (`GRD`); jede Art wird angenommen. */
  extractDocumentId: z.string().min(1).optional(),
});

/** Schreibt eine Einstellung des Vereinsstamms, wenn sie sich ändert — protokolliert als `settings.update`. */
function syncSetting(tx: DbOrTx, deps: Deps, ctx: CallContext, key: string, value: string | undefined): void {
  if (value === undefined || readSetting<string>(deps, key) === value) return;
  const written = writeSettingInternal(tx, deps, ctx, key, value);
  if (!written.ok) throw new GovernanceAborted(written);
}

/**
 * Eintragung (Spec § 7.1, § 10 „Satzungsstand eintragen“; nur am Bildschirm): in einer Transaktion der Tag an der
 * Anmeldung, je Satzungsstand der Anlässe — bei einer Ersteintragung ohne solchen der am Tag gültige beschlossene —
 * der Tag der Eintragung (`registerStatuteInternal`, dieselben Regeln), Registergericht und -nummer im Vereinsstamm,
 * wenn gegeben und anders, und `organization.registeredOn` bei der ersten eingetragenen Anmeldung. Offene
 * Zwischenverfügungen gelten mit der Eintragung als behoben. Fehlende Unterlagen, offene Prüffragen und
 * Überfälligkeit hindern nicht (Anti-Ziel 1).
 */
export async function completeRegisterFiling(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FilingChangeView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, 'governance.mcpHumanOnlyAllowed');
  if (human) return human;
  const parsed = validate(deps, filingCompleteSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const before = filingRowInternal(deps.db, v.filingId);
  if (!before) return notFound('governanceRegisterFiling', v.filingId);
  if (before.registeredOn) return governanceConflict('filingRegistered');
  if (before.submittedOn && v.registeredOn < before.submittedOn) return invalid([{ path: 'registeredOn', message: 'beforeSubmitted' }]);
  return catchAborted(() =>
    deps.db.transaction((tx: DbOrTx) => {
      // K-3: auch hier — ein inzwischen beschlossener Stand, auf dem einer der Anmeldung aufbaut, kommt mit.
      const attached = attachUnregisteredBasesInternal(tx, deps, ctx, before.id);
      const occasions = filingOccasionsInternal(tx, before.id);
      const statuteIds = filingStatuteIdsInternal(tx, occasions, v.registeredOn);
      for (const id of statuteIds) registerStatuteInternal(tx, deps, ctx, { id, registeredOn: v.registeredOn });
      const interimOrders = before.interimOrders.map((o) => (o.resolvedOn === null ? { ...o, resolvedOn: v.registeredOn } : o));
      for (const o of before.interimOrders) if (o.resolvedOn === null) completeInterimFollowUpInternal(tx, deps, ctx, before.id, o);
      tx.update(governanceRegisterFilings)
        .set({ registeredOn: v.registeredOn, registerCourt: v.registerCourt ?? null, registerNumber: v.registerNumber ?? null, extractDocumentId: v.extractDocumentId ?? null, interimOrders, updatedAt: isoNow(deps.clock) })
        .where(eq(governanceRegisterFilings.id, before.id))
        .run();
      syncSetting(tx, deps, ctx, 'organization.registerCourt', v.registerCourt);
      syncSetting(tx, deps, ctx, 'organization.registerNumber', v.registerNumber);
      const earlier = tx.select({ id: governanceRegisterFilings.id }).from(governanceRegisterFilings).where(and(ne(governanceRegisterFilings.id, before.id), isNotNull(governanceRegisterFilings.registeredOn), lt(governanceRegisterFilings.registeredOn, v.registeredOn))).get();
      if (!earlier) syncSetting(tx, deps, ctx, 'organization.registeredOn', v.registeredOn);
      recordAudit(tx, deps, ctx, {
        action: 'governance.register.complete',
        entityType: 'governanceRegisterFiling',
        entityId: before.id,
        before: { registeredOn: null },
        after: { registeredOn: v.registeredOn, statuteIds },
        params: { registeredOn: v.registeredOn, occasions: occasions.length, statutes: statuteIds.length },
      });
      return ok({ ...filingViewInternal(tx, deps, filingRowInternal(tx, before.id)!), attachedOccasions: attached });
    }),
  );
}
