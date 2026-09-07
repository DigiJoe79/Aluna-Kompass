import { defineModule, type ModuleManifest } from '@kompass/core';
import { SITE_MCP_TOOLS } from './mcp-tools';

export const SITE_PERMISSIONS = ['site.view', 'site.manage', 'site.publish'] as const;

export const siteModule: ModuleManifest = defineModule({
  key: 'site',
  version: '0.1.0',
  permissions: SITE_PERMISSIONS,
  navigation: [{ key: 'site.template', href: '/site/template', icon: 'layout-template', group: 'site', permission: 'site.manage' }],
  mcpTools: SITE_MCP_TOOLS,
});
