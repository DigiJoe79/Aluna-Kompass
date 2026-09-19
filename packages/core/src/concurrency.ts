import { createHash } from 'node:crypto';
import { z } from 'zod';
import { conflict, type Failure } from './result';

/**
 * Optimistische Sperre: Wer speichert, nennt den Stand, auf dem er gearbeitet
 * hat. Ist der Datensatz inzwischen ein anderer, wird abgewiesen statt still
 * überschrieben (Backlog 20). Am 13.09. leerte eine offene Maske sechs
 * englische Texte, die ein Agent zwei Minuten vorher über MCP geschrieben
 * hatte, und niemand merkte es.
 *
 * Optional, damit MCP-Aufrufer ohne Ladestand und interne Schreiber wie
 * `translations_set` weiter schreiben — sie arbeiten ohnehin auf dem frischen
 * Stand.
 */
export const expectedVersionField = z.string().min(1).optional();

export function staleVersion(expected: string | undefined, current: string): Failure | null {
  if (expected === undefined || expected === current) return null;
  return conflict('staleVersion', 'Der Datensatz wurde inzwischen geändert');
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/**
 * Ein Stand aus dem Inhalt, wo es kein `updatedAt` gibt, das ihn trägt — etwa
 * bei Werten, deren Zeile beim Leeren verschwindet. Berechnet, nie gespeichert.
 */
export function versionOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex').slice(0, 16);
}
