import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, newId, setModuleEnabled, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { dmsModule } from '@kompass/module-dms';
import { financeAnnualAccountsPublications, financeFiscalYears, financeModule, financeReports, financeReportSignatures } from '@kompass/module-finance';
import { projectsModule } from '@kompass/module-projects';
import { applyTemplateSync, computePendingChanges, currentContentManifest, recordPublish, SITE_DASHBOARD_TILES, siteModule } from '@kompass/module-site';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * J2: Die Sicht `annualAccounts` der Finanzen in der echten Webseite — eine bereitgestellte Jahresrechnung zählt bis zum
 * nächsten Publizieren als Änderung. Die Zeilen entstehen direkt (der Weg dorthin ist in den Finanz-Tests geprüft).
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const TEMPLATE = `
import { defineTemplate } from '@kompass/site-template';
export default defineTemplate({ name: 'X', locales: ['de'], uses: ['finance'], variables: {}, collections: {} });`;
const AT = '2026-03-20T10:00:00.000Z';
const admin = ctxWith(['modules.manage', 'site.manage', 'site.publish']);

describe('Jahresrechnung in der Webseite', () => {
  it('erscheint nach dem Bereitstellen als neue Änderung', async () => {
    const deps = createTestDeps({ locales: ['de'], manifests: [coreModule, contactsModule, dmsModule, projectsModule, financeModule, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    for (const key of ['site', 'contacts', 'dms', 'projects', 'finance']) unwrap(await setModuleEnabled(deps, admin, { key, enabled: true }));
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-aa-tpl-'));
    dirs.push(dir);
    writeFileSync(path.join(dir, 'kompass.template.ts'), TEMPLATE);
    unwrap(await applyTemplateSync(deps, admin, { dir, confirm: true }));
    const none = { changed: [], added: [], removed: [] };
    // Die Kachel sieht den Publish der eigenen Umgebung, die Änderungen den der Produktion — in Prod dieselbe Zeile.
    if (deps.env !== 'production') recordPublish(deps, admin, { environment: deps.env, startedAt: '2026-03-01T08:00:00.000Z', status: 'success', contentHash: 'h', diff: none, fileManifest: {}, log: '', summary: 's', contentManifest: null });
    recordPublish(deps, admin, { environment: 'production', startedAt: '2026-03-01T08:00:00.000Z', status: 'success', contentHash: 'h', diff: none, fileManifest: {}, log: '', summary: 's', contentManifest: currentContentManifest(deps) });

    const yearId = newId();
    deps.db.insert(financeFiscalYears).values({ id: yearId, designation: '2025', startsOn: '2025-01-01', endsOn: '2025-12-31', createdAt: AT, updatedAt: AT }).run();
    const reportId = newId();
    deps.db.insert(financeReports).values({ id: reportId, reportKey: 'annualAccounts', params: '{}', fiscalYearId: yearId, dataHash: 'h', documentId: 'D1', documentNumber: 'FB-2026-0001', finalizedAt: AT, finalizedByUserId: 'USER-TEST' }).run();
    deps.db.insert(financeReportSignatures).values({ id: newId(), reportId, contactId: 'C1', signerName: 'Vera Vorstand', via: 'account', signerUserId: 'USER-TEST', signedOn: '2026-03-20', documentId: 'D2', documentNumber: 'FB-2026-0002', namedContactIds: '[]', createdAt: AT, createdByUserId: 'USER-TEST' }).run();
    deps.db.insert(financeAnnualAccountsPublications).values({ id: newId(), reportId, fiscalYearId: yearId, publishedAt: AT, publishedByUserId: 'USER-TEST', corrected: false }).run();

    // Die Kachel „Webseite“ der Startseite zählt dieselbe Änderung (Spec § Bausteine, Nachzug U1).
    const tile = SITE_DASHBOARD_TILES[0]!;
    expect(await tile.load(deps, admin, {})).toMatchObject({ messageKey: 'changed', values: { count: 1 } });
    expect(computePendingChanges(deps)?.items).toEqual([expect.objectContaining({ kind: 'added', label: 'Jahresrechnung 2025', href: `/finance/reports/annualAccounts?year=${yearId}` })]);
    recordPublish(deps, admin, { environment: 'production', startedAt: '2026-03-21T08:00:00.000Z', status: 'success', contentHash: 'h2', diff: none, fileManifest: {}, log: '', summary: 's', contentManifest: currentContentManifest(deps) });
    expect(await tile.load(deps, admin, {})).toMatchObject({ messageKey: 'current' });
  });
});
