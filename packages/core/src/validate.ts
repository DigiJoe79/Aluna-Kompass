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

/** Steigt in Objekt-Shapes und Listen ab, um den Elementtyp zu finden. */
function itemSchema(field: z.ZodType<unknown>): z.ZodType<unknown> | undefined {
  let curr: any = field;
  while (curr) {
    if (curr.def?.element) return curr.def.element as z.ZodType<unknown>;
    curr = curr.def?.innerType ?? curr.def?.schema;
  }
  return undefined;
}

/**
 * Läuft Schema und Wert gemeinsam ab und meldet jede Sprache, die diese
 * Installation nicht führt, sowie jede fehlende Leitsprache. Der Abstieg geht
 * durch Objekte und Listen, weil mehrsprachiger Text auch in Bausteinen und
 * Sammlungseinträgen steckt — nicht nur auf oberster Ebene.
 */
function checkValue(schema: z.ZodType<unknown>, value: unknown, path: string, locales: string[], required: boolean): Issue[] {
  const meta = getFieldMeta(schema);
  if (meta?.localized) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const text = value as Record<string, unknown>;
    const issues: Issue[] = [];
    for (const key of Object.keys(text)) {
      if (!locales.includes(key)) issues.push({ path: `${path}.${key}`, message: 'unknownLocale' });
    }
    const leading = locales[0]!;
    if ((required || meta.required) && String(text[leading] ?? '').length === 0) {
      issues.push({ path: `${path}.${leading}`, message: 'required' });
    }
    return issues;
  }

  const element = itemSchema(schema);
  if (element && Array.isArray(value)) {
    return value.flatMap((item, i) => checkValue(element, item, path ? `${path}.${i}` : String(i), locales, false));
  }

  const unwrapped = unwrapSchema(schema);
  const shape =
    (unwrapped as { shape?: Record<string, z.ZodType<unknown>> }).shape ??
    (unwrapped as { def?: { shape?: Record<string, z.ZodType<unknown>> } }).def?.shape;
  if (!shape || !value || typeof value !== 'object' || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  return Object.entries(shape).flatMap(([key, field]) =>
    key in record ? checkValue(field, record[key], path ? `${path}.${key}` : key, locales, false) : [],
  );
}

function checkLocales(deps: Deps, schema: z.ZodType<unknown>, value: unknown): Issue[] {
  return checkValue(schema, value, '', deps.locales(), false);
}

export function validate<T>(deps: Deps, schema: z.ZodType<T>, input: unknown): Result<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return invalid(parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })));
  }
  const localeIssues = checkLocales(deps, schema as z.ZodType<unknown>, parsed.data);
  return localeIssues.length > 0 ? invalid(localeIssues) : ok(parsed.data);
}
