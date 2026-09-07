import { z } from 'zod';

// Ein einziges Modul ohne relative Importe: Diese Datei wird zur Laufzeit direkt
// von Node geladen (aus dem Template im Volume), und Node löst extensionslose
// relative Importe nicht auf.

// ---------------------------------------------------------------------------
// Feldhelfer
// ---------------------------------------------------------------------------

export interface FieldOptions {
  label?: string;
  localized?: boolean;
  /**
   * Der frühere Name dieses Feldes. Ohne die Angabe liest der Resync eine
   * Umbenennung als „entfällt plus neu" — der Inhalt wäre verloren.
   */
  renamedFrom?: string;
}

const LOCALE_CODE = /^[a-z]{2}(-[a-z]{2})?$/;

/** Was jedes Feld an Kompass weitergibt. Leere Angaben bleiben weg. */
const meta = (opts: FieldOptions, widget: string, extra: Record<string, unknown> = {}) => ({
  widget,
  ...(opts.label === undefined ? {} : { label: opts.label }),
  ...(opts.renamedFrom === undefined ? {} : { renamedFrom: opts.renamedFrom }),
  ...extra,
});

/** Mehrsprachig heisst: ein Record über Sprachschlüssel, wie im Kern. */
const wrap = (inner: z.ZodType<string>, opts: FieldOptions, widget: string, extra: Record<string, unknown> = {}) =>
  (opts.localized
    ? z.record(z.string().regex(LOCALE_CODE), inner).meta(meta(opts, 'localized', { markdown: widget === 'markdown', ...extra }))
    : inner.meta(meta(opts, widget, extra))) as z.ZodType<unknown>;

export const text = (opts: FieldOptions & { max?: number } = {}) =>
  wrap(z.string().trim().max(opts.max ?? 500), opts, 'text', { max: opts.max ?? 500 });

export const markdown = (opts: FieldOptions & { max?: number } = {}) =>
  wrap(z.string().max(opts.max ?? 20_000), opts, 'markdown', { max: opts.max ?? 20_000 });

export const number = (opts: FieldOptions & { min?: number; max?: number; integer?: boolean } = {}) => {
  const base = opts.integer ? z.number().int() : z.number();
  const bounded = opts.max === undefined ? base.min(opts.min ?? 0) : base.min(opts.min ?? 0).max(opts.max);
  return bounded.meta(meta(opts, 'number')) as z.ZodType<unknown>;
};

export const asset = (opts: FieldOptions & { accept?: string } = {}) =>
  z.string().nullable().default(null).meta(meta(opts, 'asset', { accept: opts.accept ?? 'image/*' })) as z.ZodType<unknown>;

export const select = (values: [string, ...string[]], opts: FieldOptions = {}) =>
  z.enum(values).meta(meta(opts, 'select')) as z.ZodType<unknown>;

export const list = (of: z.ZodType<unknown>, opts: FieldOptions & { max?: number } = {}) =>
  z.array(of).max(opts.max ?? 50).meta(meta(opts, 'list')) as z.ZodType<unknown>;

// ---------------------------------------------------------------------------
// defineTemplate
// ---------------------------------------------------------------------------

export interface CollectionDefinition {
  label: string;
  fields: Record<string, z.ZodType<unknown>>;
  slug?: boolean;
  sortable?: boolean;
  publishable?: boolean;
  max?: number;
}

export interface TemplateInput {
  name: string;
  locales: string[];
  variables: Record<string, z.ZodType<unknown>>;
  collections: Record<string, CollectionDefinition>;
  uses?: string[];
}

export interface TemplateDefinition extends Omit<TemplateInput, 'collections' | 'uses'> {
  collections: Record<string, Required<Omit<CollectionDefinition, 'max'>> & { max?: number }>;
  uses: string[];
}

const KEY = /^[a-z][a-z0-9-]{0,40}$/;

export function defineTemplate(input: TemplateInput): TemplateDefinition {
  if (!input.name.trim()) throw new Error('template needs a name');
  if (input.locales.length === 0) throw new Error('template needs at least one locale');
  for (const l of input.locales) if (!LOCALE_CODE.test(l)) throw new Error(`invalid locale: ${l}`);
  for (const key of Object.keys(input.collections)) if (!KEY.test(key)) throw new Error(`invalid collection key: ${key}`);
  for (const key of Object.keys(input.variables)) if (!KEY.test(key)) throw new Error(`invalid variable key: ${key}`);
  return {
    name: input.name.trim(),
    locales: input.locales,
    variables: input.variables,
    uses: input.uses ?? [],
    collections: Object.fromEntries(
      Object.entries(input.collections).map(([key, c]) => [
        key,
        { label: c.label, fields: c.fields, slug: c.slug ?? false, sortable: c.sortable ?? false, publishable: c.publishable ?? false, max: c.max },
      ]),
    ),
  };
}
