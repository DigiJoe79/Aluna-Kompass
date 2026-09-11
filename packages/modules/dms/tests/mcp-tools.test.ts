import { describe, expect, it } from 'vitest';
import { dmsModule } from '../src/manifest';
import { DMS_MCP_TOOLS } from '../src/mcp-tools';

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
