import { coreModule, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser, systemContext } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { dmsModule } from '@kompass/module-dms';
import { projectsModule } from '@kompass/module-projects';
import { FINANCE_PERMISSIONS, financeModule } from '../src/manifest';

/** Das Modul ist **eingeschaltet** — sonst kennt der Kern weder seine Rollen noch seine Haken. */
export function setupFinance(permissions: readonly string[] = FINANCE_PERMISSIONS) {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule, projectsModule, financeModule] });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'projects', 'finance'], 'test.enable'));
  const userId = insertUser(deps, { name: 'Test', email: 'test@kompass.local' });
  return { deps, ctx: ctxWith(permissions, userId), userId };
}
