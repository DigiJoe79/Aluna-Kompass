import { defineModule, type ModuleManifest, type NavigationItem } from '@kompass/core';
import { SITE_MCP_TOOLS } from './mcp-tools';
import { activeTemplate } from './service';

export const SITE_PERMISSIONS = ['site.view', 'site.manage', 'site.publish'] as const;

/** Je Sammlung ein Navigationseintrag mit ihrer Beschriftung, dazu „Variablen" — erst wenn ein Template eingelesen ist. */
const siteNavigationFor = (deps: Parameters<typeof activeTemplate>[0]): NavigationItem[] => {
  const template = activeTemplate(deps);
  if (!template) return [];
  return [
    { key: 'site.variables', href: '/site/variables', icon: 'sliders', group: 'site', permission: 'site.manage' },
    ...Object.entries(template.schema.collections).map(([key, col]): NavigationItem => ({
      key: `site.c.${key}`,
      href: `/site/c/${key}`,
      icon: 'list',
      group: 'site',
      permission: 'site.view',
      label: col.label,
    })),
  ];
};

export const siteModule: ModuleManifest = defineModule({
  key: 'site',
  version: '0.1.0',
  permissions: SITE_PERMISSIONS,
  navigation: [{ key: 'site.template', href: '/site/template', icon: 'layout-template', group: 'site', permission: 'site.manage' }],
  navigationFor: siteNavigationFor,
  mcpTools: SITE_MCP_TOOLS,
});
