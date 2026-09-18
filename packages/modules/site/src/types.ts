/** Reine Typen des Moduls — ohne Laufzeitcode, damit sie auch im Client gebraucht werden können. */

export interface FieldSchema {
  widget?: string;
  label?: string;
  [key: string]: unknown;
}

export interface CollectionSchema {
  label: string;
  slug: boolean;
  sortable: boolean;
  publishable: boolean;
  max?: number;
  fields: Record<string, FieldSchema>;
}

export interface TemplateSchema {
  name: string;
  locales: string[];
  uses: string[];
  variables: Record<string, FieldSchema>;
  collections: Record<string, CollectionSchema>;
}

export interface SeedReport {
  applied: boolean;
  variables: number;
  entries: number;
  byCollection: Record<string, number>;
  assets: number;
}
