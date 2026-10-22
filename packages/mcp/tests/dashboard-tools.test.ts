import { coreModule } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { coreMcpTools } from '../src/core-tools';

const tool = (name: string) => {
  const found = coreMcpTools.find((t) => t.name === name);
  if (!found) throw new Error(`kein Werkzeug ${name}`);
  return found;
};

describe('dashboard_* tools', () => {
  it('setzt über das Werkzeug, flach und in Spalten, und liest die Inhalte über das andere', async () => {
    const deps = createTestDeps({ manifests: [coreModule] });
    const ctx = ctxWith(['backup.export', 'retention.view'], insertUser(deps, {}));
    const tiles = await tool('dashboard_tiles').handler(deps, ctx, {});
    expect(tiles.ok && (tiles.value as { key: string }[]).map((t) => t.key)).toEqual(['backup', 'retention']);
    const set = await tool('dashboard_set_layout').handler(deps, ctx, { tiles: [{ module: 'core', key: 'retention' }] });
    expect(set.ok).toBe(true);
    const read = await tool('dashboard_read').handler(deps, ctx, {});
    expect(read.ok && (read.value as { key: string; content: unknown }[]).map((t) => t.key)).toEqual(['retention']);
    const columns = await tool('dashboard_set_layout').handler(deps, ctx, { layout: 'wide-narrow', columns: [[{ module: 'core', key: 'backup' }], [{ module: 'core', key: 'retention' }]] });
    expect(columns.ok && (columns.value as { layout: string; columns: { key: string }[][] }).columns.map((c) => c.map((t) => t.key))).toEqual([['backup'], ['retention']]);
    const layout = await tool('dashboard_get_layout').handler(deps, ctx, {});
    expect(layout.ok && (layout.value as { layout: string }).layout).toBe('wide-narrow');
    const viewed = await tool('dashboard_read').handler(deps, ctx, {});
    expect(viewed.ok && (viewed.value as { key: string; column: number }[]).map((t) => [t.key, t.column])).toEqual([['backup', 0], ['retention', 1]]);
    // Ein- und ausgeschaltet gilt für beide Layouts (Vorgaben Teil M, Entscheidung 1) — die Beschreibung sagt es.
    expect(tool('dashboard_set_layout').description).toMatch(/on and off apply to both/);
    const reset = await tool('dashboard_reset_layout').handler(deps, ctx, {});
    expect(reset.ok && (reset.value as { custom: boolean }).custom).toBe(false);
  });
});
