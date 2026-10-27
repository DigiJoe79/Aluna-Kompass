import { createHash } from 'node:crypto';
import type { ReportParams } from './types';

/**
 * Kanonisches JSON: Schlüssel sortiert, Reihenfolge der Listen bleibt, `undefined` fällt weg (wie `JSON.stringify`).
 * Gleicher Datenstand, gleicher Text — unabhängig davon, in welcher Reihenfolge ein Dienst die Felder setzt.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : sortKeys(v)));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** SHA-256 über `{ report, params, data }` (Spec § A „Daten-Hash“); die Kurzform sind die ersten acht Hex-Zeichen. */
export function reportHash(report: string, params: ReportParams, data: unknown): { hash: string; shortHash: string } {
  const hash = createHash('sha256').update(canonicalJson({ report, params, data })).digest('hex');
  return { hash, shortHash: hash.slice(0, 8) };
}
