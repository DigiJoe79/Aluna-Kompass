import { coreModule, setSetting, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser, loadAllViews } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { projectsModule } from '../src/manifest';
import { createProject, setProjectPublished } from '../src/service';

const manage = ctxWith(['projects.manage', 'projects.view']);

describe('projects views hold against what the service accepts', () => {
  it('a minimal published project without image or links loads through every view', async () => {
    const deps = createTestDeps({ manifests: [coreModule, projectsModule] });
    insertUser(deps, { id: 'USER-TEST' });
    await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });

    const p = unwrap(await createProject(deps, manage, { slug: 'minimal', name: { de: 'Minimal' }, type: 'ongoing', summary: {}, body: {} }));
    unwrap(await setProjectPublished(deps, manage, { id: p.id, isPublished: true }));

    const views = loadAllViews(deps, projectsModule);
    expect(views.projects).toEqual([expect.objectContaining({ slug: 'minimal', imageAssetId: null, externalLinks: [] })]);
  });
});
