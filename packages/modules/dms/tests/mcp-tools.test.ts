import { describe, expect, it } from 'vitest';
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
    for (const expected of ['dms_text', 'dms_unlink', 'dms_relate', 'dms_unrelate', 'dms_dispatch', 'dms_dispatch_clear', 'dms_add_note', 'dms_delete_note', 'dms_snippets', 'dms_create_snippet', 'dms_update_snippet', 'dms_delete_snippet', 'dms_folders', 'dms_create_folder', 'dms_delete_folder', 'dms_rules', 'dms_create_rule', 'dms_update_rule', 'dms_delete_rule', 'dms_create_type', 'dms_update_type', 'dms_create_replacement', 'dms_create_follow_up']) {
      expect(names, expected).toContain(expected);
    }
    expect(names).not.toContain('dms_manage_types');
    expect(DMS_MCP_TOOLS.filter((t) => typeof t.service !== 'function').map((t) => t.name)).toEqual([]);
  });
});
