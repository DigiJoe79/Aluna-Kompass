import { coreModule, readSetting, unwrap } from '@kompass/core';
import { auditEntry, createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { getBlockedTerms, setBlockedTerms } from '../src/blocked-terms';
import { siteModule } from '../src/manifest';

/**
 * Backlog 23: Die Sperrwörter gab es als Einstellung, die Prüfung las sie, aber
 * weder Oberfläche noch ein eigenes Werkzeug konnte sie schreiben. Sie gehören
 * zu dem, der publiziert — `site.publish` —, nicht zur Vereinsverwaltung.
 */
const setup = () => {
  const deps = createTestDeps({ manifests: [coreModule, siteModule] });
  insertUser(deps, { id: 'USER-TEST' });
  return deps;
};
const publisher = ctxWith(['site.publish', 'site.view']);

describe('Sperrwörter', () => {
  it('setzt die Liste, bereinigt sie und schreibt ins Änderungsprotokoll', async () => {
    const deps = setup();
    const saved = unwrap(await setBlockedTerms(deps, publisher, { terms: ['  Alter Vereinsname ', 'Lorem ipsum', 'alter vereinsname', ''] }));
    expect(saved).toEqual(['Alter Vereinsname', 'Lorem ipsum']);
    expect(readSetting(deps, 'site.blockedTerms')).toEqual(['Alter Vereinsname', 'Lorem ipsum']);
    expect(auditEntry(deps, 'site.blockedTerms.set')).toMatchObject({ entityType: 'setting', entityId: 'site.blockedTerms' });
  });

  it('liest die Liste mit site.view', async () => {
    const deps = setup();
    unwrap(await setBlockedTerms(deps, publisher, { terms: ['Platzhalter'] }));
    expect(unwrap(await getBlockedTerms(deps, ctxWith(['site.view'])))).toEqual(['Platzhalter']);
  });

  it('verlangt site.publish zum Schreiben', async () => {
    const result = await setBlockedTerms(setup(), ctxWith(['site.manage', 'site.view']), { terms: ['x-x'] });
    expect(result.ok === false && result.error.type).toBe('forbidden');
  });

  it('weist zu kurze Begriffe ab', async () => {
    const result = await setBlockedTerms(setup(), publisher, { terms: ['a'] });
    expect(result.ok === false && result.error.type).toBe('validation');
  });
});
