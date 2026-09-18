import { describe, expect, it } from 'vitest';
import * as core from '@kompass/core';

const REQUIRED = [
  'createDeps', 'readEnv', 'isSetupRequired', 'completeSetup', 'login', 'resolveSession', 'revokeSession', 'changeOwnPassword',
  'createUser', 'listUsers', 'updateUser', 'setUserActive', 'resetStartPassword',
  'listRoles', 'createRole', 'updateRole', 'setRolePermissions', 'assignRole', 'removeRole',
  'readSetting', 'readAllSettings', 'setSetting',
  'listThemes', 'resolveActiveTheme', 'createTheme', 'updateTheme', 'duplicateTheme', 'deleteTheme', 'activateTheme', 'checkThemeContrast', 'THEME_TOKENS',
  'listModules', 'setModuleEnabled', 'enabledManifests',
  'queryAudit', 'getAuditEntry',
  'createApiToken', 'listApiTokens', 'revokeApiToken',
  'seedDevelopment', 'CORE_PERMISSIONS', 'requirePermission', 'newId',
  'localizedText', 'resolveText',
] as const;

describe('core contract', () => {
  it('exports every service the app relies on', () => {
    const missing = REQUIRED.filter((name) => !(name in core));
    expect(missing).toEqual([]);
  });
});
