import { validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { z } from 'zod';
import { accountCreateSchema, accountUpdateSchema, createAccount, deleteAccount, listAccounts, setAccountActive, updateAccount } from './accounts';
import { categoryFieldsSchema, categoryUpdateSchema, createCategory, deleteCategory, listCategories, setCategoryActive, updateCategory } from './categories';
import { listDatedValues } from './dated-values';
import { listFiscalYears } from './fiscal-years';
import { createPurpose, deletePurpose, dissolvePurpose, fulfillPurpose, listPurposes, purposeCreateSchema, purposeUpdateSchema, reopenPurpose, setPurposeActive, updatePurpose } from './purposes';

/**
 * Vier Verteilerdienste über die Stammdaten (Spec 10.2: „je Art mit
 * Discriminator"), damit ein Agent nicht zwanzig Werkzeuge lernen muss. Sie
 * rufen die Dienste der Tasks 5–9 und prüfen **kein Recht selbst** — das tut
 * der gerufene Dienst.
 */
const readSchema = z.object({ kind: z.enum(['account', 'category', 'purpose', 'fiscalYear', 'datedValue']), includeInactive: z.boolean().optional() });

export async function readMasterData(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<unknown[]>> {
  const parsed = validate(deps, readSchema, input);
  if (!parsed.ok) return parsed;
  const includeInactive = parsed.value.includeInactive ?? false;
  switch (parsed.value.kind) {
    case 'account':
      return listAccounts(deps, ctx, { includeInactive });
    case 'category':
      return listCategories(deps, ctx, { includeInactive });
    case 'purpose':
      return listPurposes(deps, ctx, { includeInactive });
    case 'fiscalYear':
      return listFiscalYears(deps, ctx);
    case 'datedValue':
      return listDatedValues(deps, ctx);
  }
}

/**
 * A3: `data` ist je Art das Schema des Dienstes — mit `id` das Ändern-, ohne das Anlegen-Schema. Das Anlegen-Schema
 * verbietet `id` ausdrücklich: Sonst würde ein Ändern, das am Ändern-Schema scheitert (etwa ein `key` an einer
 * Kategorie), still als Anlegen durchgehen, weil Zod die unbekannte `id` wegstreicht.
 */
const withId = (update: z.ZodType, create: z.ZodType) =>
  z.union([update, create.and(z.object({ id: z.never().optional() }))]).describe('With id: update only the named fields (pass expectedVersion). Without id: create.');

export const saveMasterDataSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('account'), data: withId(accountUpdateSchema, accountCreateSchema) }),
  z.object({ kind: z.literal('category'), data: withId(categoryUpdateSchema, categoryFieldsSchema) }),
  z.object({ kind: z.literal('purpose'), data: withId(purposeUpdateSchema, purposeCreateSchema) }),
]);

export async function saveMasterData(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<unknown>> {
  const parsed = validate(deps, saveMasterDataSchema, input);
  if (!parsed.ok) return parsed;
  const { kind, data } = parsed.value as { kind: 'account' | 'category' | 'purpose'; data: Record<string, unknown> };
  const hasId = typeof data.id === 'string';
  switch (kind) {
    case 'account':
      return hasId ? updateAccount(deps, ctx, data) : createAccount(deps, ctx, data);
    case 'category':
      return hasId ? updateCategory(deps, ctx, data) : createCategory(deps, ctx, data);
    case 'purpose':
      return hasId ? updatePurpose(deps, ctx, data) : createPurpose(deps, ctx, data);
  }
}

const activeSchema = z.object({ kind: z.enum(['account', 'category', 'purpose']), id: z.string().min(1), isActive: z.boolean(), expectedVersion: z.string().min(1).optional() });

export async function setMasterDataActive(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<unknown>> {
  const parsed = validate(deps, activeSchema, input);
  if (!parsed.ok) return parsed;
  const { kind, ...rest } = parsed.value;
  switch (kind) {
    case 'account':
      return setAccountActive(deps, ctx, rest);
    case 'category':
      return setCategoryActive(deps, ctx, rest);
    case 'purpose':
      return setPurposeActive(deps, ctx, rest);
  }
}

const deleteSchema = z.object({ kind: z.enum(['account', 'category', 'purpose']), id: z.string().min(1) });

export async function deleteMasterData(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const parsed = validate(deps, deleteSchema, input);
  if (!parsed.ok) return parsed;
  switch (parsed.value.kind) {
    case 'account':
      return deleteAccount(deps, ctx, { id: parsed.value.id });
    case 'category':
      return deleteCategory(deps, ctx, { id: parsed.value.id });
    case 'purpose':
      return deletePurpose(deps, ctx, { id: parsed.value.id });
  }
}

/** `finance_purpose_close`: die drei Zustandswechsel eines Zwecks über einen Discriminator (Spec 10.2). F8b Annahme 7: `reopen` verlangt `reason`. */
const closeSchema = z.object({ id: z.string().min(1), expectedVersion: z.string().min(1).optional(), how: z.enum(['fulfilled', 'dissolved', 'reopen']), reason: z.string().trim().max(1000).optional() });

export async function closePurpose(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<unknown>> {
  const parsed = validate(deps, closeSchema, input);
  if (!parsed.ok) return parsed;
  switch (parsed.value.how) {
    case 'fulfilled':
      return fulfillPurpose(deps, ctx, { id: parsed.value.id, expectedVersion: parsed.value.expectedVersion });
    case 'dissolved':
      return dissolvePurpose(deps, ctx, { id: parsed.value.id, expectedVersion: parsed.value.expectedVersion });
    case 'reopen':
      return reopenPurpose(deps, ctx, { id: parsed.value.id, expectedVersion: parsed.value.expectedVersion, reason: parsed.value.reason });
  }
}
