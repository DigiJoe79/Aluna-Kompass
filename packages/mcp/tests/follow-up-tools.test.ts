import { coreModule, createFollowUp, listDueFollowUpsWithTargets } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { coreMcpTools } from '../src/core-tools';

const tool = (name: string) => {
  const found = coreMcpTools.find((t) => t.name === name);
  if (!found) throw new Error(`kein Werkzeug ${name}`);
  return found;
};

describe('followups_* tools', () => {
  it('sind registriert und nennen ihren Service', () => {
    for (const name of ['followups_list_due', 'followups_list', 'followups_create', 'followups_complete', 'followups_reopen', 'followups_delete']) {
      expect(tool(name).service, name).toBeTypeOf('function');
      expect(tool(name).description).toMatch(/followUps\.(view|manage)/);
    }
    expect(tool('followups_create').service).toBe(createFollowUp);
    expect(tool('followups_list_due').service).toBe(listDueFollowUpsWithTargets);
  });

  it('jedes Kernwerkzeug nennt einen Service', () => {
    const silent = coreMcpTools.filter((t) => typeof t.service !== 'function').map((t) => t.name);
    expect(silent).toEqual([]);
  });

  it('legt über das Werkzeug an und liest über das andere zurück', async () => {
    const deps = createTestDeps({ manifests: [coreModule] });
    const ctx = ctxWith(['followUps.view', 'followUps.manage']);
    const created = await tool('followups_create').handler(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-01', title: 'Antwort' });
    expect(created.ok).toBe(true);
    const due = await tool('followups_list_due').handler(deps, ctx, { until: '2026-12-31' });
    expect(due.ok && (due.value as { title: string }[]).map((f) => f.title)).toEqual(['Antwort']);
  });
});
