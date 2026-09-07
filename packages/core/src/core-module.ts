import { defineModule } from './modules/manifest';
import { publishedOrganization } from './published/organization';
import { CORE_PERMISSIONS } from './permissions/core';
import { CORE_SETTINGS } from './settings/core';

export const coreModule = defineModule({
  key: 'core',
  version: '0.1.0',
  permissions: CORE_PERMISSIONS,
  settings: CORE_SETTINGS,
  publishedViews: [publishedOrganization],
});
