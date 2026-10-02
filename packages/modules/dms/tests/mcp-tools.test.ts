import { describe, expect, it } from 'vitest';
import { moveDocumentFolder } from '../src/catalog';
import { dmsModule } from '../src/manifest';
import { DMS_MCP_TOOLS } from '../src/mcp-tools';
import { fileFixture, setupWithTypes } from './helpers';

const tool = (name: string) => {
  const found = DMS_MCP_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`kein Werkzeug ${name}`);
  return found;
};

describe('dms mcp tools', () => {
  it('nennt zu jedem Recht mindestens ein Werkzeug', () => {
    for (const permission of dmsModule.permissions) {
      const named = DMS_MCP_TOOLS.filter((tool) => tool.description.includes(permission));
      expect(named.length, `kein Werkzeug nennt ${permission}`).toBeGreaterThan(0);
    }
  });

  it('zeigt echte Schemata, kein any', () => {
    for (const tool of DMS_MCP_TOOLS) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.name).toMatch(/^dms_[a-z_]+$/);
    }
  });
});

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

  it('dms_receive kennt kein assetId mehr', () => {
    const schema = tool('dms_receive').inputSchema.safeParse({ filename: 'a.pdf', typeKey: 'authority', subject: 's', documentDate: '2026-09-01', assetId: 'X' });
    expect(schema.success).toBe(false);
  });

  it('jedes Werkzeug nennt seinen Service, und die neuen sind da', () => {
    const names = DMS_MCP_TOOLS.map((t) => t.name);
    for (const expected of ['dms_text', 'dms_unlink', 'dms_relate', 'dms_unrelate', 'dms_dispatch', 'dms_dispatch_clear', 'dms_add_note', 'dms_delete_note', 'dms_snippets', 'dms_create_snippet', 'dms_update_snippet', 'dms_delete_snippet', 'dms_folders', 'dms_create_folder', 'dms_delete_folder', 'dms_move_folder', 'dms_rules', 'dms_create_rule', 'dms_update_rule', 'dms_delete_rule', 'dms_create_type', 'dms_update_type', 'dms_create_replacement', 'dms_create_response', 'dms_create_follow_up']) {
      expect(names, expected).toContain(expected);
    }
    expect(names).not.toContain('dms_manage_types');
    expect(DMS_MCP_TOOLS.filter((t) => typeof t.service !== 'function').map((t) => t.name)).toEqual([]);
  });

  it('dms_move_folder ruft moveDocumentFolder und nennt dms.manage', async () => {
    const { deps, ctx } = setupWithTypes();
    await tool('dms_create_folder').handler(deps, ctx, { path: 'a' });
    expect(tool('dms_move_folder').description).toContain('dms.manage');
    expect(tool('dms_move_folder').service).toBe(moveDocumentFolder);
    const moved = await tool('dms_move_folder').handler(deps, ctx, { from: 'a', to: 'b' });
    expect(moved).toMatchObject({ ok: true, value: { from: 'a', to: 'b', folders: 1 } });
  });

  it('dms_delete_type calls deleteDocumentType and names dms.manage (Task 4)', async () => {
    const { deps, ctx } = setupWithTypes();
    const created = await tool('dms_create_type').handler(deps, ctx, { key: 'memo', label: 'Vermerk', prefix: 'VMK', defaultDirection: 'outgoing', retentionClass: 'statutory6Y' });
    expect(created.ok).toBe(true);
    expect(tool('dms_delete_type').description).toContain('dms.manage');
    const deleted = await tool('dms_delete_type').handler(deps, ctx, { key: 'memo' });
    expect(deleted.ok).toBe(true);
  });
});

describe('Umklassifizieren über MCP (Spec 2026-09-19)', () => {
  it('dms_reclassify ruft den Dienst, nennt dms.create und nimmt den Ladestand', async () => {
    const { reclassifyDocument, previewReclassification } = await import('../src/incoming');
    expect(tool('dms_reclassify').service).toBe(reclassifyDocument);
    expect(tool('dms_reclassify').description).toContain('dms.create');
    expect(Object.keys((tool('dms_reclassify').inputSchema as unknown as { shape: Record<string, unknown> }).shape)).toEqual(
      expect.arrayContaining(['id', 'typeKey', 'subject', 'documentDate', 'expectedVersion']),
    );
    expect(tool('dms_preview_reclassification').service).toBe(previewReclassification);
    expect(tool('dms_preview_reclassification').description).toContain('dms.view');
  });
});
