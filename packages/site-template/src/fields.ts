import { z } from 'zod';

export interface FieldOptions { label?: string; localized?: boolean }

const LOCALE_CODE = /^[a-z]{2}(-[a-z]{2})?$/;

/** Mehrsprachig heisst: ein Record über Sprachschlüssel, wie im Kern. */
const wrap = (inner: z.ZodType<string>, opts: FieldOptions, widget: string, extra: Record<string, unknown> = {}) =>
  (opts.localized
    ? z.record(z.string().regex(LOCALE_CODE), inner).meta({ widget: 'localized', markdown: widget === 'markdown', label: opts.label, ...extra })
    : inner.meta({ widget, label: opts.label, ...extra })) as z.ZodType<unknown>;

export const text = (opts: FieldOptions & { max?: number } = {}) =>
  wrap(z.string().trim().max(opts.max ?? 500), opts, 'text', { max: opts.max ?? 500 });

export const markdown = (opts: FieldOptions & { max?: number } = {}) =>
  wrap(z.string().max(opts.max ?? 20_000), opts, 'markdown', { max: opts.max ?? 20_000 });

export const number = (opts: FieldOptions & { min?: number; max?: number; integer?: boolean } = {}) => {
  const base = opts.integer ? z.number().int() : z.number();
  const bounded = opts.max === undefined ? base.min(opts.min ?? 0) : base.min(opts.min ?? 0).max(opts.max);
  return bounded.meta({ widget: 'number', label: opts.label }) as z.ZodType<unknown>;
};

export const asset = (opts: FieldOptions & { accept?: string } = {}) =>
  z.string().nullable().default(null).meta({ widget: 'asset', accept: opts.accept ?? 'image/*', label: opts.label }) as z.ZodType<unknown>;

export const select = (values: [string, ...string[]], opts: FieldOptions = {}) =>
  z.enum(values).meta({ widget: 'select', label: opts.label }) as z.ZodType<unknown>;

export const list = (of: z.ZodType<unknown>, opts: FieldOptions & { max?: number } = {}) =>
  z.array(of).max(opts.max ?? 50).meta({ widget: 'list', label: opts.label }) as z.ZodType<unknown>;
