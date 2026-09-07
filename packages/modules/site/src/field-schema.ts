import { z } from 'zod';
import type { FieldSchema } from './load';

const LOCALE_KEY = /^[a-z]{2}(-[a-z]{2})?$/;

/** Die Art eines Feldes: `widget` wenn gesetzt, sonst aus `type`/`enum` abgeleitet. */
export function widgetOf(field: FieldSchema): string {
  if (typeof field.widget === 'string') return field.widget;
  if (Array.isArray((field as { enum?: unknown }).enum)) return 'select';
  const type = (field as { type?: string | string[] }).type;
  if (type === 'array') return 'list';
  if (type === 'integer' || type === 'number') return 'number';
  if (Array.isArray(type) && type.includes('null')) return 'asset';
  return 'text';
}

const num = (field: FieldSchema): number | undefined => (typeof field.max === 'number' ? field.max : undefined);
const boundNumber = (field: FieldSchema): number | undefined => {
  const v = (field as { maxLength?: number; maxItems?: number }).maxLength ?? (field as { maxItems?: number }).maxItems ?? num(field);
  return typeof v === 'number' ? v : undefined;
};

/**
 * Baut aus dem gespeicherten JSON-Schema eines Feldes ein prüfbares Zod-Schema.
 * Das JSON-Schema wird **nicht** zurückverwandelt; nur die hinterlegten Grenzen
 * werden nachgezogen. Dieselbe Abbildung, aus der die Maske ihre Widgets wählt.
 */
export function schemaFor(field: FieldSchema): z.ZodType<unknown> {
  switch (widgetOf(field)) {
    case 'localized': {
      const inner = z.string().trim().max(boundNumber(field) ?? 20_000);
      // Beliebige Sprachschlüssel: ob sie zu den gepflegten Sprachen passen,
      // prüft `validate` im Kern.
      return z.record(z.string().regex(LOCALE_KEY), inner).meta({ localized: true, required: false });
    }
    case 'markdown':
      return z.string().max(boundNumber(field) ?? 20_000);
    case 'number': {
      let n = (field as { type?: string }).type === 'integer' ? z.number().int() : z.number();
      const min = (field as { minimum?: number }).minimum;
      const max = (field as { maximum?: number }).maximum;
      if (typeof min === 'number') n = n.min(min);
      if (typeof max === 'number' && max < Number.MAX_SAFE_INTEGER) n = n.max(max);
      return n;
    }
    case 'asset':
      return z
        .string()
        .nullable()
        .default(null);
    case 'select': {
      const values = (field as { enum?: string[] }).enum ?? [];
      return values.length > 0 ? z.enum(values as [string, ...string[]]) : z.string();
    }
    case 'list': {
      const items = (field as { items?: FieldSchema }).items;
      const inner = items ? schemaFor(items) : z.string();
      let arr = z.array(inner);
      const maxItems = (field as { maxItems?: number }).maxItems;
      if (typeof maxItems === 'number') arr = arr.max(maxItems);
      return arr;
    }
    default:
      return z.string().trim().max(boundNumber(field) ?? 500);
  }
}

/** Der Leerwert eines Feldes, wenn noch nichts gespeichert wurde. */
export function blankValue(field: FieldSchema): unknown {
  switch (widgetOf(field)) {
    case 'localized':
      return {};
    case 'number':
      return 0;
    case 'asset':
      return null;
    case 'list':
      return [];
    case 'select':
      return (field as { enum?: string[] }).enum?.[0] ?? '';
    default:
      return '';
  }
}
