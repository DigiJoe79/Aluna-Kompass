import { describe, expect, it } from 'vitest';
import { DMS_MCP_TOOLS } from '../src/mcp-tools';
import { fileFixture, setupWithTypes } from './helpers';

const tool = (name: string) => {
  const found = DMS_MCP_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`kein Werkzeug ${name}`);
  return found;
};

describe('DMS-Werkzeuge', () => {
  it('dms_get liefert Metadaten, Bezüge und Notizen — keine Bytes', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    const res = await tool('dms_get').handler(deps, ctx, { id: letter.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const value = res.value as Record<string, unknown>;
    expect(value).not.toHaveProperty('bytes');
    expect(value).toHaveProperty('relations');
    expect(value).toHaveProperty('notes');
    expect(value).toHaveProperty('sentAt');
  });

  it('dms_move_folder verschiebt einen Ordner', async () => {
    const { deps, ctx } = setupWithTypes();
    await tool('dms_create_folder').handler(deps, ctx, { path: 'a' });
    const moved = await tool('dms_move_folder').handler(deps, ctx, { from: 'a', to: 'b' });
    expect(moved).toMatchObject({ ok: true, value: { from: 'a', to: 'b', folders: 1 } });
  });

  it('dms_delete_type deletes an unused type (Task 4)', async () => {
    const { deps, ctx } = setupWithTypes();
    const created = await tool('dms_create_type').handler(deps, ctx, { key: 'memo', label: 'Vermerk', prefix: 'VMK', defaultDirection: 'outgoing', retentionClass: 'statutory6Y' });
    expect(created.ok).toBe(true);
    const deleted = await tool('dms_delete_type').handler(deps, ctx, { key: 'memo' });
    expect(deleted.ok).toBe(true);
  });
});

describe('Umklassifizieren über MCP (Spec 2026-09-19)', () => {
  it('dms_reclassify nimmt den Ladestand', () => {
    expect(Object.keys((tool('dms_reclassify').inputSchema as unknown as { shape: Record<string, unknown> }).shape)).toEqual(
      expect.arrayContaining(['id', 'typeKey', 'subject', 'documentDate', 'expectedVersion']),
    );
  });
});
