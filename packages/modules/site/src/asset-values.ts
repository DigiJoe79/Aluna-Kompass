import { parseDerivedAssetId, schema as core, type DbOrTx } from '@kompass/core';
import { inArray } from 'drizzle-orm';
import { widgetOf } from './field-schema';
import type { FieldSchema } from './types';

/**
 * Bildwerte in Template-Inhalten (Spec Ausschnitt für alle Bilder §§ 2–3): Ein `asset`-Feld trägt eine Asset-ID oder
 * eine abgeleitete ID mit Ausschnitt (`<assetId>~x_y_w_h`), auch in `list`/`objectList`. Erkannt am Schema, nicht am
 * Feldnamen; Prüfung, Verwendungssuche, Löschen und Export lesen über diese Stelle die Basis.
 */
export interface AssetValue {
  /** Pfad im Datensatz, wie ihn ein Feldfehler nennt: `hero`, `gallery.1.image`. */
  path: string;
  /** Der gespeicherte Wert. */
  value: string;
  /** Die Basis: die ID des Bildes in der Mediathek (bei einem unlesbaren Rest der Wert vor `~`). */
  assetId: string;
  /** Trägt der Wert einen Ausschnitt? */
  cropped: boolean;
  /** Ein `~` mit unlesbarem Rest. */
  malformed: boolean;
}

function toAssetValue(path: string, value: string): AssetValue {
  const derived = parseDerivedAssetId(value);
  if (derived) return { path, value, assetId: derived.assetId, cropped: true, malformed: false };
  const at = value.indexOf('~');
  return at < 0 ? { path, value, assetId: value, cropped: false, malformed: false } : { path, value, assetId: value.slice(0, at), cropped: false, malformed: true };
}

/** Die Bildwerte eines Feldes samt verschachtelter Listen. */
export function assetValuesOf(field: FieldSchema, value: unknown, path: string, out: AssetValue[] = []): AssetValue[] {
  const widget = widgetOf(field);
  if (widget === 'asset') {
    if (typeof value === 'string' && value) out.push(toAssetValue(path, value));
  } else if ((widget === 'list' || widget === 'objectList') && Array.isArray(value)) {
    const items = (field as { items?: FieldSchema & { properties?: Record<string, FieldSchema> } }).items;
    if (!items) return out;
    value.forEach((item, i) => {
      if (items.properties) assetValuesIn(items.properties, item, `${path}.${i}`, out);
      else assetValuesOf(items, item, `${path}.${i}`, out);
    });
  }
  return out;
}

/** Die Bildwerte eines Datensatzes (Variablen, Eintrag, Zeile einer Objektliste) nach seinen Feldern. */
export function assetValuesIn(fields: Record<string, FieldSchema>, record: unknown, base = '', out: AssetValue[] = []): AssetValue[] {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return out;
  const data = record as Record<string, unknown>;
  for (const [key, field] of Object.entries(fields)) assetValuesOf(field, data[key], base ? `${base}.${key}` : key, out);
  return out;
}

/**
 * Feldfehler für Bildwerte: `invalidCrop` bei einem unlesbaren Rest nach `~`, `assetNotFound`, wenn die Basis nicht
 * in der Mediathek steht, `notAnImage`, wenn ein Ausschnitt auf etwas anderes als ein Rasterbild zeigt. Geprüft wird,
 * was der Aufrufer übergibt — die geänderten Werte; ein alter Wert, der nicht mehr trägt, blockiert kein Speichern.
 */
export function assetValueIssues(db: DbOrTx, values: readonly AssetValue[]): { path: string; message: string }[] {
  const ids = [...new Set(values.filter((v) => !v.malformed).map((v) => v.assetId))];
  const found = new Map(
    ids.length === 0 ? [] : db.select({ id: core.mediaAssets.id, mimeType: core.mediaAssets.mimeType }).from(core.mediaAssets).where(inArray(core.mediaAssets.id, ids)).all().map((r) => [r.id, r.mimeType]),
  );
  return values.flatMap((v) => {
    if (v.malformed) return [{ path: v.path, message: 'invalidCrop' }];
    const mime = found.get(v.assetId);
    if (mime === undefined) return [{ path: v.path, message: 'assetNotFound' }];
    if (v.cropped && !mime.startsWith('image/')) return [{ path: v.path, message: 'notAnImage' }];
    return [];
  });
}

/** Nur die Bildwerte, die es vorher an keiner Stelle gab — die geänderten. */
export const newAssetValues = (next: readonly AssetValue[], before: readonly AssetValue[]): AssetValue[] => {
  const old = new Set(before.map((v) => v.value));
  return next.filter((v) => !old.has(v.value));
};

/** Die `asset`-Felder einer Feldliste mit Pfad, auch in Listen (`gallery[].image`) — für Bildstellen und Werkzeuge. */
export function assetFieldsIn(fields: Record<string, FieldSchema>, base = ''): { path: string; field: FieldSchema }[] {
  const out: { path: string; field: FieldSchema }[] = [];
  const visit = (field: FieldSchema, path: string) => {
    const widget = widgetOf(field);
    if (widget === 'asset') out.push({ path, field });
    else if (widget === 'list' || widget === 'objectList') {
      const items = (field as { items?: FieldSchema & { properties?: Record<string, FieldSchema> } }).items;
      if (items?.properties) for (const [k, f] of Object.entries(items.properties)) visit(f, `${path}[].${k}`);
      else if (items) visit(items, `${path}[]`);
    }
  };
  for (const [key, field] of Object.entries(fields)) visit(field, base ? `${base}.${key}` : key);
  return out;
}

/** Ersetzt jeden Bildwert eines Feldes, auch in Listen; `fn` bekommt den Wert und gibt den neuen zurück. */
function mapField(field: FieldSchema, value: unknown, fn: (value: string) => string): unknown {
  const widget = widgetOf(field);
  if (widget === 'asset') return typeof value === 'string' && value ? fn(value) : value;
  if ((widget === 'list' || widget === 'objectList') && Array.isArray(value)) {
    const items = (field as { items?: FieldSchema & { properties?: Record<string, FieldSchema> } }).items;
    if (!items) return value;
    return value.map((item) => (items.properties ? mapAssetValues(items.properties, item, fn) : mapField(items, item, fn)));
  }
  return value;
}

/** Ein Datensatz mit ersetzten Bildwerten (Startinhalte: logische ID → Mediathek-ID), auch in Listen. */
export function mapAssetValues(fields: Record<string, FieldSchema>, record: unknown, fn: (value: string) => string): unknown {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  const out: Record<string, unknown> = { ...(record as Record<string, unknown>) };
  for (const [key, field] of Object.entries(fields)) if (key in out) out[key] = mapField(field, out[key], fn);
  return out;
}

/** Schreibt die Basis eines Bildwerts um und behält den Ausschnitt (`<neu>~x_y_w_h`). */
export function rebaseAssetValue(value: string, map: (assetId: string) => string | undefined): string {
  const at = value.indexOf('~');
  const base = at < 0 ? value : value.slice(0, at);
  const next = map(base) ?? base;
  return at < 0 ? next : `${next}${value.slice(at)}`;
}
