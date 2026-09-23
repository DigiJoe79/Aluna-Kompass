import { isoNow, newId, notFound, ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { checksumOf } from '@kompass/module-dms';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { setImportFormatInternal } from '../ledger/accounts';
import { financeAccounts, financeImportProfiles, financeImportRuns, type FinanceAccountRow, type FinanceImportProfileRow } from '../schema';
import { csvFormatSchema, type CsvFormat } from './csv';

export interface ImportProfileView {
  id: string;
  name: string;
  builtinKey: string | null;
  headerSignature: string;
  format: CsvFormat;
  activeForAccountIds: string[];
  runCount: number;
  createdAt: string;
}

const saveImportProfileSchema = z.object({
  accountId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  format: csvFormatSchema,
  builtinKey: z.string().min(1).max(80).nullable().optional(),
  confirmFormatChange: z.boolean().optional(),
});

/** Das Format, auf das ein Konto zeigt — oder `null`. */
export function activeProfileInternal(db: DbOrTx, account: Pick<FinanceAccountRow, 'importProfileId'>): FinanceImportProfileRow | null {
  if (!account.importProfileId) return null;
  return db.select().from(financeImportProfiles).where(eq(financeImportProfiles.id, account.importProfileId)).get() ?? null;
}

export function profileFormatInternal(row: FinanceImportProfileRow): CsvFormat {
  return csvFormatSchema.parse(JSON.parse(row.format));
}

/**
 * `finance.setup` (Rückmeldung Phase 2, Punkt 3). Legt ein neues,
 * unveränderliches CSV-Format an und macht es zum **einen** aktiven Format
 * des Kontos (Spec 6.3). Ein Wechsel von CAMT oder zu einer anderen Kopfzeile
 * verlangt `confirmFormatChange`; dieselbe Kopfzeile (eine korrigierte
 * Zuordnung) nicht — der Dublettenschutz bleibt dann gleich scharf.
 */
export async function saveImportProfile(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ profileId: string; account: FinanceAccountRow }>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, saveImportProfileSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const account = deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, v.accountId)).get();
  if (!account) return notFound('financeAccount', v.accountId);
  if (account.kind !== 'bank' && account.kind !== 'paymentService') return financeConflict('statementAccountNotBank', { account: account.name });
  if (!account.isActive) return financeConflict('accountInactive', { account: account.name });

  const current = activeProfileInternal(deps.db, account);
  const switched = account.importFormat === 'camt053' || (current !== null && current.headerSignature !== v.format.headerSignature);
  if (switched && !v.confirmFormatChange) return financeConflict('statementFormatChange', { account: account.name });

  return deps.db.transaction((tx: DbOrTx) => {
    const id = newId();
    tx.insert(financeImportProfiles)
      .values({
        id, name: v.name, format: JSON.stringify(v.format), headerSignature: v.format.headerSignature, builtinKey: v.builtinKey ?? null,
        createdAt: isoNow(deps.clock), createdByUserId: ctx.userId ?? 'system', createdChannel: ctx.channel,
      })
      .run();
    const after = setImportFormatInternal(tx, deps, ctx, account, 'csv', id);
    financeAudit(tx, deps, ctx, {
      action: 'finance.importProfile.save', entity: 'financeImportProfile', id,
      after: {
        accountId: account.id, encoding: v.format.encoding, delimiter: v.format.delimiter,
        headerChecksum: checksumOf(new TextEncoder().encode(v.format.headerSignature)), switched, builtinKey: v.builtinKey ?? null,
      },
      summary: `CSV-Format ${id} für Konto ${account.id} gespeichert`,
    });
    return ok({ profileId: id, account: after });
  });
}

/** `finance.setup` oder `finance.read`: alle Formate, mit Kontozuordnung und Zahl der Läufe. */
export async function listImportProfiles(deps: Deps, ctx: CallContext, _input: unknown): Promise<Result<{ profiles: ImportProfileView[] }>> {
  if (!ctx.permissions.has('finance.setup') && !ctx.permissions.has('finance.read')) return requirePermission(ctx, 'finance.setup')!;
  const rows = deps.db.select().from(financeImportProfiles).orderBy(desc(financeImportProfiles.createdAt)).all();
  const accounts = deps.db.select({ id: financeAccounts.id, importProfileId: financeAccounts.importProfileId }).from(financeAccounts).all();
  const runCounts = new Map(
    deps.db
      .select({ profileId: financeImportRuns.profileId, n: sql<number>`count(*)` })
      .from(financeImportRuns)
      .groupBy(financeImportRuns.profileId)
      .all()
      .map((r) => [r.profileId, Number(r.n)] as const),
  );
  return ok({
    profiles: rows.map((row) => ({
      id: row.id,
      name: row.name,
      builtinKey: row.builtinKey,
      headerSignature: row.headerSignature,
      format: profileFormatInternal(row),
      activeForAccountIds: accounts.filter((a) => a.importProfileId === row.id).map((a) => a.id),
      runCount: runCounts.get(row.id) ?? 0,
      createdAt: row.createdAt,
    })),
  });
}
