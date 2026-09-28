import { z } from 'zod';
import type { Deps } from './deps';
import { invalid, ok, type Result, type ValidationIssue } from './result';

type Issue = ValidationIssue;

/** Die Codes, die `zodIssue` aus Zod-Standardmeldungen macht — jeder steht unter `errors.fields` in der Sprachdatei. */
export const VALIDATION_MESSAGE_CODES = [
  'required', 'invalid', 'tooSmall', 'mustBeGreater', 'tooBig', 'mustBeLess', 'tooShort', 'tooLong',
  'tooFewItems', 'tooManyItems', 'notInteger', 'invalidDate', 'email', 'invalidOption',
] as const;

/** Eigene Meldungen der Schemas sind Codes (`amountCentsRequired`); alles andere ist ein Satz von Zod. */
const OWN_CODE = /^[a-z][A-Za-z0-9]*$/;

type ZodIssueLike = { code?: string; path: PropertyKey[]; message: string; origin?: string; minimum?: unknown; maximum?: unknown; inclusive?: boolean; expected?: string; format?: string; values?: unknown[] };

function codeOf(issue: ZodIssueLike): { message: (typeof VALIDATION_MESSAGE_CODES)[number]; params?: Record<string, string | number> } {
  const numeric = issue.origin === 'number' || issue.origin === 'bigint';
  const countable = issue.origin === 'array' || issue.origin === 'set';
  switch (issue.code) {
    case 'invalid_type':
      if (/received undefined/.test(issue.message)) return { message: 'required' };
      return issue.expected === 'int' ? { message: 'notInteger' } : { message: 'invalid' };
    case 'too_small': {
      const minimum = Number(issue.minimum);
      if (numeric) return issue.inclusive === false ? { message: 'mustBeGreater', params: { minimum } } : { message: 'tooSmall', params: { minimum } };
      if ((issue.origin === 'string' || countable) && minimum <= 1) return { message: 'required' };
      if (issue.origin === 'string') return { message: 'tooShort', params: { minimum } };
      if (countable) return { message: 'tooFewItems', params: { minimum } };
      return { message: 'invalid' };
    }
    case 'too_big': {
      const maximum = Number(issue.maximum);
      if (numeric) return issue.inclusive === false ? { message: 'mustBeLess', params: { maximum } } : { message: 'tooBig', params: { maximum } };
      if (issue.origin === 'string') return { message: 'tooLong', params: { maximum } };
      if (countable) return { message: 'tooManyItems', params: { maximum } };
      return { message: 'invalid' };
    }
    case 'invalid_format':
      if (issue.format === 'email') return { message: 'email' };
      if (issue.format === 'date' || issue.format === 'datetime') return { message: 'invalidDate' };
      return { message: 'invalid' };
    case 'invalid_value':
      return { message: 'invalidOption', params: { options: (issue.values ?? []).map(String).join(', ') } };
    default:
      return { message: 'invalid' };
  }
}

/**
 * Eine Zod-Meldung als Prüfmeldung: eigene Codes bleiben, Standardmeldungen („Too small: …“) werden zum
 * Code mit Parametern. Jeder Dienst, der selbst `safeParse` ruft, meldet über diese Funktion.
 */
export function zodIssue(issue: ZodIssueLike, prefix = ''): Issue {
  const path = [prefix, issue.path.map(String).join('.')].filter(Boolean).join('.');
  if (OWN_CODE.test(issue.message)) return { path, message: issue.message };
  return { path, ...codeOf(issue) };
}

/** Alle Meldungen eines Zod-Fehlers als Prüfmeldungen (siehe `zodIssue`). */
export function zodIssues(error: { issues: readonly ZodIssueLike[] }, prefix = ''): Issue[] {
  return error.issues.map((issue) => zodIssue(issue, prefix));
}

function unwrapSchema(schema: z.ZodType<unknown>): any {
  let curr: any = schema;
  while (curr) {
    if (curr.def?.shape || curr.shape) return curr;
    curr = curr.def?.innerType ?? curr.def?.schema;
  }
  return schema;
}

function getFieldMeta(field: z.ZodType<unknown>): { localized?: boolean; leadingRequired?: boolean } | undefined {
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
    if ((required || meta.leadingRequired) && String(text[leading] ?? '').length === 0) {
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
    return invalid(zodIssues(parsed.error as { issues: readonly ZodIssueLike[] }));
  }
  const localeIssues = checkLocales(deps, schema as z.ZodType<unknown>, parsed.data);
  return localeIssues.length > 0 ? invalid(localeIssues) : ok(parsed.data);
}
