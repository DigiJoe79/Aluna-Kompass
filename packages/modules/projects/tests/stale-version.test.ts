import { coreModule, setSetting, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { projectsModule } from '../src';
import { createProject, getProject, updateProject } from '../src/service';

/** Backlog 20: siehe `animals/tests/stale-version.test.ts`. */
const setup = async () => {
  const d = createTestDeps({ manifests: [coreModule, projectsModule] });
  insertUser(d, { id: 'USER-TEST' });
  await setSetting(d, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });
  return d;
};
const manage = ctxWith(['projects.manage', 'projects.view']);
const base = { slug: 'grundversorgung', name: { de: 'Grundversorgung', en: '' }, type: 'ongoing' as const, summary: { de: 'Futter', en: '' }, body: { de: 'Text', en: '' } };

describe('updateProject mit Ladestand', () => {
  it('weist ein Speichern auf veraltetem Stand ab und lässt die Zwischenänderung stehen', async () => {
    const d = await setup();
    const loaded = unwrap(await createProject(d, manage, base));
    d.clock.advance(60_000);
    unwrap(await updateProject(d, manage, { id: loaded.id, name: { de: 'Grundversorgung', en: 'Basic care' } }));
    d.clock.advance(60_000);

    const stale = await updateProject(d, manage, { id: loaded.id, name: { de: 'Versorgung', en: '' }, expectedVersion: loaded.updatedAt });

    expect(stale).toMatchObject({ ok: false, error: { type: 'conflict', code: 'staleVersion' } });
    expect(unwrap(await getProject(d, manage, loaded.id)).name).toEqual({ de: 'Grundversorgung', en: 'Basic care' });
  });

  it('speichert, wer den aktuellen Stand nennt', async () => {
    const d = await setup();
    const loaded = unwrap(await createProject(d, manage, base));
    d.clock.advance(60_000);
    const saved = unwrap(await updateProject(d, manage, { id: loaded.id, slug: 'versorgung', expectedVersion: loaded.updatedAt }));
    expect(saved.slug).toBe('versorgung');
  });
});
