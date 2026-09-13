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
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { blankValue, schemaFor } from './field-schema';
import { checkReferenceValues, duplicateReferences, referenceMetaOf, resolveReferenceOptions, type ReferenceOption } from './reference-fields';
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

/** Alle Variablenwerte, mit Rechteprüfung — für Oberfläche und MCP. */
export async function getVariables(deps: Deps, ctx: CallContext): Promise<Result<Record<string, unknown>>> {
  const denied = requirePermission(ctx, 'site.view');
  if (denied) return denied;
  return ok(readValues(deps));
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

  // Referenzwerte müssen in der gefilterten Sicht stehen — dieselbe Prüfung
  // für Maske und site_variables_set (Spec 2026-09-13, § 4.4). Geprüft wird
  // nur, was sich ändert: Ein gespeicherter Wert, der inzwischen nicht mehr
  // trägt (Hund vermittelt), bleibt stehen und wird im Export-Prüflauf zum
  // Befund; er darf nicht das Speichern aller anderen Variablen blockieren
  // (Backlog 19).
  const before = readValues(deps);
  const changed = Object.fromEntries(
    Object.entries(parsed.value as Record<string, unknown>).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key])),
  );
  const stale = checkReferenceValues(deps, template.schema, changed);
  const duplicates = duplicateReferences(template.schema, parsed.value as Record<string, unknown>);
  if (stale.length > 0 || duplicates.length > 0) {
    return invalid([
      ...stale.map((s) => ({ path: s.field, message: 'referenceNotFound' })),
      ...duplicates.map((field) => ({ path: field, message: 'duplicateReference' })),
    ]);
  }

  const now = isoNow(deps.clock);
  deps.db.transaction((tx) => {
    for (const [key, value] of Object.entries(parsed.value as Record<string, unknown>)) {
      if (value === null || value === undefined) {
        tx.delete(siteValues).where(eq(siteValues.key, key)).run();
      } else {
        tx.insert(siteValues)
          .values({ key, value, updatedAt: now })
          .onConflictDoUpdate({ target: siteValues.key, set: { value, updatedAt: now } })
          .run();
      }
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

/** Die wählbaren Datensätze je Referenzfeld — für die Maske und für `site_variables_options`. */
export async function listReferenceOptions(deps: Deps, ctx: CallContext): Promise<Result<Record<string, ReferenceOption[]>>> {
  const denied = requirePermission(ctx, 'site.view');
  if (denied) return denied;
  const template = activeTemplate(deps);
  if (!template) return conflict('noTemplate', 'Es ist kein Template eingelesen');
  const out: Record<string, ReferenceOption[]> = {};
  for (const [key, field] of Object.entries(template.schema.variables)) {
    if (referenceMetaOf(field)) out[key] = resolveReferenceOptions(deps, template.schema.uses, field);
  }
  return ok(out);
}
