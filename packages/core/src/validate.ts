import { z } from 'zod';
import type { Deps } from './deps';
import { invalid, ok, type Result } from './result';

type Issue = { path: string; message: string };

function unwrapSchema(schema: z.ZodType<unknown>): any {
  let curr: any = schema;
  while (curr) {
    if (curr.def?.shape || curr.shape) return curr;
    curr = curr.def?.innerType ?? curr.def?.schema;
  }
  return schema;
}

function getFieldMeta(field: z.ZodType<unknown>): { localized?: boolean; required?: boolean } | undefined {
  let curr: any = field;
  while (curr) {
    const meta = curr.meta?.();
    if (meta?.localized) return meta;
    curr = curr.def?.innerType;
  }
  return undefined;
}

/** Alle als `localized` markierten Felder eines Objektschemas, mit ihrem Pfad. */
function localizedFields(schema: z.ZodType<unknown>): { path: string; required: boolean }[] {
  const unwrapped = unwrapSchema(schema);
  const shape =
    (unwrapped as { shape?: Record<string, z.ZodType<unknown>> }).shape ??
    (unwrapped as { def?: { shape?: Record<string, z.ZodType<unknown>> } }).def?.shape;
  if (!shape) return [];
  const out: { path: string; required: boolean }[] = [];
  for (const [key, field] of Object.entries(shape)) {
    const meta = getFieldMeta(field);
    if (meta?.localized) out.push({ path: key, required: meta.required ?? false });
  }
  return out;
}

function checkLocales(deps: Deps, schema: z.ZodType<unknown>, value: Record<string, unknown>): Issue[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const locales = deps.locales();
  const leading = locales[0]!;
  const issues: Issue[] = [];
  for (const field of localizedFields(schema)) {
    const text = value[field.path] as Record<string, string> | undefined;
    if (!text || typeof text !== 'object') continue;
    for (const key of Object.keys(text)) {
      if (!locales.includes(key)) issues.push({ path: `${field.path}.${key}`, message: 'unknownLocale' });
    }
    if (field.required && (text[leading] ?? '').length === 0) {
      issues.push({ path: `${field.path}.${leading}`, message: 'required' });
    }
  }
  return issues;
}

export function validate<T>(deps: Deps, schema: z.ZodType<T>, input: unknown): Result<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return invalid(parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })));
  }
  const localeIssues = checkLocales(deps, schema as z.ZodType<unknown>, parsed.data as Record<string, unknown>);
  return localeIssues.length > 0 ? invalid(localeIssues) : ok(parsed.data);
}
