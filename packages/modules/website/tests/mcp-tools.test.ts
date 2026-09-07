import { coreModule, moduleMcpTools } from '@kompass/core';
import { createTestDeps } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { websiteModule } from '../src';

describe('website mcp tools', () => {
  it('registers one tool per service with underscore names and object schemas', () => {
    const tools = moduleMcpTools(createTestDeps({ manifests: [coreModule, websiteModule] }), websiteModule);
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['website_page_get', 'website_page_update', 'website_article_create', 'website_team_set_published', 'website_download_set', 'website_project_update']));

    for (const tool of tools) {
      expect(tool.name).toMatch(/^website_[a-z_]+$/);
      expect(tool.description.length).toBeGreaterThan(10);
      expect(typeof tool.inputSchema.safeParse === 'function').toBe(true);
    }
  });
});
