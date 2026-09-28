import type { Result, ServiceError } from '@kompass/core';
import type { CallToolResult } from '@modelcontextprotocol/server';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Macht aus einem Fehler den Text, den ein Agent liest — die App übersetzt Konflikte mit Sprachschlüssel (A6). */
export type ErrorTranslator = (error: ServiceError) => ServiceError;

export function toCallToolResult(result: Result<unknown>, translateError?: ErrorTranslator): CallToolResult {
  if (!result.ok) return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: translateError ? translateError(result.error) : result.error }) }] };
  const value = result.value === undefined ? null : result.value;
  return { content: [{ type: 'text', text: JSON.stringify(value) }], ...(isRecord(value) ? { structuredContent: value } : {}) };
}
