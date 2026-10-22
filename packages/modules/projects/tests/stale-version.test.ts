import { coreModule, setSetting, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { projectsModule } from '../src';
import { createProject, updateProject } from '../src/service';

/** Backlog 20: siehe `animals/tests/stale-version.test.ts`. */
const setup = async () => {
  const d = createTestDeps({ manifests: [coreModule, projectsModule] });
  insertUser(d, { id: 'USER-TEST' });
  await setSetting(d, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });
  return d;
};
const manage = ctxWith(['projects.manage', 'projects.view']);
const base = { slug: 'grundversorgung', name: { de: 'Grundversorgung', en: '' }, type: 'ongoing' as const, summary: { de: 'Futter', en: '' }, body: { de: 'Text', en: '' } };

// Den veralteten Stand weist ab, was `apps/kompass/tests/module-contracts.test.ts` für jedes Werkzeug mit
// `expectedVersion` prüft; hier bleibt der Gutfall.
describe('updateProject mit Ladestand', () => {
  it('speichert, wer den aktuellen Stand nennt', async () => {
    const d = await setup();
    const loaded = unwrap(await createProject(d, manage, base));
    d.clock.advance(60_000);
    const saved = unwrap(await updateProject(d, manage, { id: loaded.id, slug: 'versorgung', expectedVersion: loaded.updatedAt }));
    expect(saved.slug).toBe('versorgung');
  });
});
