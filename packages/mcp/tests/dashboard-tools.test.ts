import { coreModule, getDashboardLayout, listDashboardTiles, readDashboard, resetDashboardLayout, setDashboardLayout } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { coreMcpTools } from '../src/core-tools';

const tool = (name: string) => {
  const found = coreMcpTools.find((t) => t.name === name);
  if (!found) throw new Error(`kein Werkzeug ${name}`);
  return found;
};

describe('dashboard_* tools', () => {
  it('sind registriert und nennen ihren Service', () => {
    expect(tool('dashboard_tiles').service).toBe(listDashboardTiles);
    expect(tool('dashboard_get_layout').service).toBe(getDashboardLayout);
    expect(tool('dashboard_set_layout').service).toBe(setDashboardLayout);
    expect(tool('dashboard_reset_layout').service).toBe(resetDashboardLayout);
    expect(tool('dashboard_read').service).toBe(readDashboard);
  });

  it('setzt über das Werkzeug und liest die Inhalte über das andere', async () => {
    const deps = createTestDeps({ manifests: [coreModule] });
    const ctx = ctxWith(['backup.export', 'retention.view'], insertUser(deps, {}));
    const tiles = await tool('dashboard_tiles').handler(deps, ctx, {});
    expect(tiles.ok && (tiles.value as { key: string }[]).map((t) => t.key)).toEqual(['backup', 'retention']);
    const set = await tool('dashboard_set_layout').handler(deps, ctx, { tiles: [{ module: 'core', key: 'retention' }] });
    expect(set.ok).toBe(true);
    const read = await tool('dashboard_read').handler(deps, ctx, {});
    expect(read.ok && (read.value as { key: string; content: unknown }[]).map((t) => t.key)).toEqual(['retention']);
    const reset = await tool('dashboard_reset_layout').handler(deps, ctx, {});
    expect(reset.ok && (reset.value as { custom: boolean }).custom).toBe(false);
  });
});
