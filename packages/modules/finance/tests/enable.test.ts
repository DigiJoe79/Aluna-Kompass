import { coreModule, schema, setModuleEnabled, setSetting, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith, systemContext } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { dmsModule, listDocumentAreas } from '@kompass/module-dms';
import { projectsModule } from '@kompass/module-projects';
import { like } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { financeModule } from '../src/manifest';
import { financeCategories } from '../src/schema';

/**
 * Ersatz für die manuelle Prüfung aus Task 13 Step 2 (kein Bildschirm zur
 * Verfügung): schaltet Finanzen über den Dienst des Kerns ein, wie es
 * Verwaltung → Module täte, und prüft die vier sichtbaren Folgen.
 */
describe('switching finance on, the way Verwaltung → Module would', () => {
  it('provisions the five roles, the 37 categories, locks the bank details, and shows the protection area', async () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule, projectsModule, financeModule] });
    const admin = ctxWith(['modules.manage', 'settings.manage', 'dms.manage']);

    // Voraussetzungen von Finanzen (dependsOn) einschalten, wie es eine echte Installation vorher täte.
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'projects'], 'test.enable'));

    const enabled = await setModuleEnabled(deps, admin, { key: 'finance', enabled: true });
    expect(enabled.ok).toBe(true);

    const financeRoles = deps.db.select().from(schema.roles).where(like(schema.roles.originKey, 'finance:%')).all();
    expect(financeRoles).toHaveLength(5);

    const categories = deps.db.select().from(financeCategories).all();
    expect(categories).toHaveLength(37);

    const ibanChange = await setSetting(deps, admin, { key: 'organization.iban', value: 'DE23999999990000202051' });
    expect(ibanChange.ok ? null : ibanChange.error).toMatchObject({ type: 'conflict', code: 'settingManaged', message: 'finance' });

    const areas = await listDocumentAreas(deps, admin);
    expect(areas.ok && areas.value.some((a) => a.key === 'finance' && a.module === 'finance')).toBe(true);
  });
});
