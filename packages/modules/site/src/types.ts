/** Reine Typen des Moduls — ohne Laufzeitcode, damit sie auch im Client gebraucht werden können. */

import type { ImagePlaceSpec } from '@kompass/core/image-places';

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
  /**
   * Format und Breite der Bildstellen der Modul-Sichten, wie das Template sie angibt — auch Schlüssel, die diese
   * Fassung nicht kennt (Warnung beim Einlesen). Fehlt in Schemata, die vor 0.2.11 gespeichert wurden.
   */
  images?: Record<string, ImagePlaceSpec>;
}

export interface SeedReport {
  applied: boolean;
  variables: number;
  entries: number;
  byCollection: Record<string, number>;
  assets: number;
}
