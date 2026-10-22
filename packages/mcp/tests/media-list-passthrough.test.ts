import { ok } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

// Nur der Dienst ist ersetzt: So sieht der Test, was `media_list` ihm übergibt.
const listMediaAssets = vi.hoisted(() => vi.fn());
vi.mock('@kompass/core', async (actual) => ({ ...(await actual<typeof import('@kompass/core')>()), listMediaAssets }));

const { coreMcpTools } = await import('../src/core-tools');

/** Ein gültiger Wert je Feld, aus dem Schema gelesen: Ein neuer Filter ist ohne Änderung am Test dabei. */
function sample(field: z.ZodType): unknown {
  const def = (field as unknown as { def: { type: string } }).def;
  if (def.type === 'optional' || def.type === 'nullable') return sample((field as unknown as { unwrap: () => z.ZodType }).unwrap());
  if (def.type === 'enum') return (field as unknown as { options: unknown[] }).options.at(-1);
  if (def.type === 'boolean') return true;
  if (def.type === 'string') return 'probe';
  throw new Error(`Kein Probewert für den Feldtyp ${def.type}: sample() ergänzen.`);
}

describe('media_list', () => {
  it('hands every field of its schema to the service unchanged', async () => {
    listMediaAssets.mockResolvedValue(ok([]));
    const tool = coreMcpTools.find((candidate) => candidate.name === 'media_list')!;
    const shape = (tool.inputSchema as unknown as { shape: Record<string, z.ZodType> }).shape;
    const args = Object.fromEntries(Object.entries(shape).map(([key, field]) => [key, sample(field)]));
    expect(tool.inputSchema.safeParse(args).success).toBe(true);

    const deps = createTestDeps({});
    const ctx = ctxWith(['media.upload']);
    await tool.handler(deps, ctx, args);
    expect(listMediaAssets).toHaveBeenCalledWith(deps, ctx, args);
  });
});
