import type { z } from 'zod';

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
const LOCALE_CODE = /^[a-z]{2}(-[a-z]{2})?$/;

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
