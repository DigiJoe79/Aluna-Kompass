import {
  type CallContext,
  type Deps,
  type Result,
  conflict,
  invalid,
  isoNow,
  ok,
  recordAudit,
  requirePermission,
  validate,
} from '@kompass/core';
import { z } from 'zod';
import { blankValue, schemaFor } from './field-schema';
import { siteValues } from './schema';
import { activeTemplate } from './service';

const setInput = z.object({ values: z.record(z.string(), z.unknown()) });

/** Alle Variablenwerte des aktiven Templates; fehlende Schlüssel mit ihrem Leerwert. */
export function readValues(deps: Deps): Record<string, unknown> {
  const template = activeTemplate(deps);
  const stored = new Map(deps.db.select().from(siteValues).all().map((r) => [r.key, r.value]));
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(template?.schema.variables ?? {})) {
    out[key] = stored.has(key) ? stored.get(key) : blankValue(field);
  }
  return out;
}

/** Schreibt die übergebenen Variablenwerte, geprüft gegen das Template-Schema. */
export async function setValues(deps: Deps, ctx: CallContext, raw: unknown): Promise<Result<Record<string, unknown>>> {
  const denied = requirePermission(ctx, 'site.manage');
  if (denied) return denied;
  const parsedInput = setInput.safeParse(raw);
  if (!parsedInput.success) {
    return invalid(parsedInput.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })));
  }
  const { values } = parsedInput.data;

  const template = activeTemplate(deps);
  if (!template) return conflict('noTemplate', 'Es ist kein Template eingelesen');
  const fields = template.schema.variables;

  for (const key of Object.keys(values)) {
    if (!(key in fields)) return invalid([{ path: key, message: 'unknownVariable' }]);
  }
  const shape = Object.fromEntries(Object.keys(values).map((key) => [key, schemaFor(fields[key]!)]));
  const parsed = validate(deps, z.object(shape), values);
  if (!parsed.ok) return parsed;

  const before = readValues(deps);
  const now = isoNow(deps.clock);
  deps.db.transaction((tx) => {
    for (const [key, value] of Object.entries(parsed.value as Record<string, unknown>)) {
      tx.insert(siteValues)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({ target: siteValues.key, set: { value, updatedAt: now } })
        .run();
    }
    recordAudit(tx, deps, ctx, {
      action: 'site.values.update',
      entityType: 'siteValues',
      entityId: 'variables',
      before,
      after: { ...before, ...(parsed.value as Record<string, unknown>) },
      summary: `Variablen geändert: ${Object.keys(values).join(', ')}`,
    });
  });
  return ok(readValues(deps));
}
