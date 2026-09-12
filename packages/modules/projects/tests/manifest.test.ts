import { describe, expect, it } from 'vitest';
import { projectsModule } from '../src/manifest';
import { PROJECTS_MCP_TOOLS } from '../src/mcp-tools';

describe('projects module', () => {
  it('brings its permissions, navigation, view, seed and tools', () => {
    expect(projectsModule.key).toBe('projects');
    expect([...projectsModule.permissions]).toEqual(['projects.view', 'projects.manage']);
    expect(projectsModule.navigation?.map((n) => n.href)).toEqual(['/projects']);
    expect(projectsModule.publishedViews?.map((v) => v.name)).toEqual(['projects']);
    expect(projectsModule.seed).toBeDefined();
    expect(projectsModule.mediaReferences).toBeDefined();
  });

  it('names a tool for each permission and keeps the tool names of the core era', () => {
    const names = PROJECTS_MCP_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(['project_create', 'project_get', 'project_set_published', 'project_update', 'projects_list', 'projects_reorder']);
    for (const permission of projectsModule.permissions) {
      expect(PROJECTS_MCP_TOOLS.some((t) => t.description.includes(permission)), permission).toBe(true);
    }
  });
});
