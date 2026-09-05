import { defineModule, type ModuleManifest } from '@kompass/core';
import { WEBSITE_PERMISSIONS } from './page-keys';
import { WEBSITE_SETTINGS } from './settings';
import { WEBSITE_VIEWS } from './views';
import { WEBSITE_MCP_TOOLS } from './mcp-tools';

const nav = (key: string, href: string, icon: string, permission: string) => ({ key: `website.${key}`, href, icon, group: 'website', permission });

export const websiteModule: ModuleManifest = defineModule({
  key: 'website',
  version: '0.1.0',
  permissions: WEBSITE_PERMISSIONS,
  settings: WEBSITE_SETTINGS,
  navigation: [
    nav('pages', '/website/pages', 'file-text', 'website.view'),
    nav('articles', '/website/articles', 'newspaper', 'website.view'),
    nav('team', '/website/team', 'users', 'website.view'),
    nav('faqs', '/website/faqs', 'help-circle', 'website.view'),
    nav('projects', '/website/projects', 'folder', 'website.view'),
    nav('downloads', '/website/downloads', 'download', 'website.view'),
    nav('facts', '/website/facts', 'sliders', 'website.manage'),
    nav('publish', '/website/publish', 'upload', 'website.publish'),
  ],
  publishedViews: WEBSITE_VIEWS,
  mcpTools: WEBSITE_MCP_TOOLS,
});
