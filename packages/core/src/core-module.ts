import { defineModule } from './modules/manifest';
import { CORE_PERMISSIONS } from './permissions/core';

export const coreModule = defineModule({
  key: 'core',
  version: '0.1.0',
  permissions: CORE_PERMISSIONS,
});
