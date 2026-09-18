import type { Result } from '@kompass/core';
import type { CallToolResult } from '@modelcontextprotocol/server';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function toCallToolResult(result: Result<unknown>): CallToolResult {
  if (!result.ok) return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: result.error }) }] };
  const value = result.value === undefined ? null : result.value;
  return { content: [{ type: 'text', text: JSON.stringify(value) }], ...(isRecord(value) ? { structuredContent: value } : {}) };
}
