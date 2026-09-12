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
   * Umbenennung als „entfällt plus neu“ — der Inhalt wäre verloren.
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

/** Ein mehrsprachiges Feld: ein Record über Sprachschlüssel, wie im Kern. */
export type Localized = Record<string, string>;

/**
 * Jeder Helfer trägt den Typ seines Wertes, damit `InferContent` die Form von
 * content.json aus der Deklaration ableiten kann. Mehrsprachig oder nicht
 * entscheidet die Überladung an `localized`.
 */
const wrap = (inner: z.ZodType<string>, opts: FieldOptions, widget: string, extra: Record<string, unknown> = {}) =>
  (opts.localized
    ? z.record(z.string().regex(LOCALE_CODE), inner).meta(meta(opts, 'localized', { markdown: widget === 'markdown', ...extra }))
    : inner.meta(meta(opts, widget, extra))) as z.ZodType<unknown>;

type TextOptions = FieldOptions & { max?: number };

export function text(opts: TextOptions & { localized: true }): z.ZodType<Localized>;
export function text(opts?: TextOptions & { localized?: false }): z.ZodType<string>;
export function text(opts: TextOptions = {}): z.ZodType<unknown> {
  return wrap(z.string().trim().max(opts.max ?? 500), opts, 'text', { max: opts.max ?? 500 });
}

export function markdown(opts: TextOptions & { localized: true }): z.ZodType<Localized>;
export function markdown(opts?: TextOptions & { localized?: false }): z.ZodType<string>;
export function markdown(opts: TextOptions = {}): z.ZodType<unknown> {
  return wrap(z.string().max(opts.max ?? 20_000), opts, 'markdown', { max: opts.max ?? 20_000 });
}

export const number = (opts: FieldOptions & { min?: number; max?: number; integer?: boolean } = {}): z.ZodType<number> => {
  const base = opts.integer ? z.number().int() : z.number();
  const bounded = opts.max === undefined ? base.min(opts.min ?? 0) : base.min(opts.min ?? 0).max(opts.max);
  return bounded.meta(meta(opts, 'number')) as z.ZodType<number>;
};

export const asset = (opts: FieldOptions & { accept?: string } = {}): z.ZodType<string | null> =>
  z.string().nullable().default(null).meta(meta(opts, 'asset', { accept: opts.accept ?? 'image/*' })) as z.ZodType<string | null>;

export const select = <const T extends readonly [string, ...string[]]>(values: T, opts: FieldOptions = {}): z.ZodType<T[number]> =>
  z.enum(values as unknown as [string, ...string[]]).meta(meta(opts, 'select')) as z.ZodType<T[number]>;

export const list = <T>(of: z.ZodType<T>, opts: FieldOptions & { max?: number } = {}): z.ZodType<T[]> =>
  z.array(of).max(opts.max ?? 50).meta(meta(opts, 'list')) as z.ZodType<T[]>;

// ---------------------------------------------------------------------------
// defineTemplate
// ---------------------------------------------------------------------------

export type Fields = Record<string, z.ZodType<unknown>>;

export interface CollectionDefinition<F extends Fields = Fields> {
  label: string;
  fields: F;
  slug?: boolean;
  sortable?: boolean;
  publishable?: boolean;
  max?: number;
}

export type Collections = Record<string, CollectionDefinition>;

export interface TemplateInput<V extends Fields = Fields, C extends Collections = Collections> {
  name: string;
  locales: string[];
  variables: V;
  collections: C;
  uses?: string[];
}

/** Eine Sammlung nach `defineTemplate`: jedes Merkmal gesetzt, Vorgabe `false`. */
export type NormalizedCollection<C extends CollectionDefinition = CollectionDefinition> = {
  label: string;
  fields: C['fields'];
  slug: C['slug'] extends true ? true : false;
  sortable: C['sortable'] extends true ? true : false;
  publishable: C['publishable'] extends true ? true : false;
  max?: number;
};

export interface TemplateDefinition<V extends Fields = Fields, C extends Collections = Collections> {
  name: string;
  locales: string[];
  variables: V;
  collections: { [K in keyof C]: NormalizedCollection<C[K]> };
  uses: string[];
}

// Schlüssel werden zu Objektschlüsseln in content.json und im Template-Code als
// `variables.heroImage` gelesen — camelCase ist deshalb erlaubt, Leerzeichen und
// Sonderzeichen nicht.
const KEY = /^[a-z][a-zA-Z0-9-]{0,40}$/;

export function defineTemplate<V extends Fields, C extends Collections>(input: TemplateInput<V, C>): TemplateDefinition<V, C> {
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
    ) as TemplateDefinition<V, C>['collections'],
  };
}

export const date = (opts: FieldOptions = {}): z.ZodType<string> =>
  z.iso.date().meta(meta(opts, 'date', { format: 'date' })) as z.ZodType<string>;

/**
 * Eine Liste gleichartiger Datensätze — Social-Media-Links, Kennzahlen,
 * Öffnungszeiten. Anders als `list`, das Zeilen aus Text führt, trägt jeder
 * Eintrag hier eigene Felder mit eigenen Beschriftungen.
 */
export const objectList = <F extends Fields>(opts: FieldOptions & { max?: number; fields: F }): z.ZodType<Array<{ [K in keyof F]: Infer<F[K]> }>> =>
  z
    .array(z.object(opts.fields))
    .max(opts.max ?? 50)
    .meta(meta(opts, 'objectList')) as z.ZodType<Array<{ [K in keyof F]: Infer<F[K]> }>>;

// ---------------------------------------------------------------------------
// InferContent — die Form von content.json, abgeleitet aus der Deklaration
// ---------------------------------------------------------------------------

type Infer<S> = S extends z.ZodType<infer O> ? O : never;

/** Eine Datei, die der Export mitliefert; `assets` in content.json. */
export interface ContentAsset {
  id: string;
  filename: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}

type EntryOf<C extends CollectionDefinition> = { [F in keyof C['fields']]: Infer<C['fields'][F]> } & (C['slug'] extends true ? { slug: string } : unknown) &
  (C['sortable'] extends true ? { sortOrder: number } : unknown);

/**
 * `loadContent` eines Templates liefert diesen Typ. Variablen sind optional,
 * weil ein Feld in Kompass leer bleiben kann; ein Sammlungseintrag trägt jedes
 * Feld, dazu `slug` und `sortOrder`, wo die Sammlung sie deklariert. Die
 * Sichten der Module (`views`) kennt die Deklaration nicht — sie bleiben
 * `unknown[]`, bis das Template sie selbst typisiert.
 */
export type InferContent<T extends TemplateDefinition<Fields, Collections>> = {
  variables: { [K in keyof T['variables']]?: Infer<T['variables'][K]> };
  collections: { [K in keyof T['collections']]: Array<EntryOf<T['collections'][K]>> };
  views: Record<string, unknown[]>;
  assets: ContentAsset[];
};
