import { coreModule, setSetting, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { projectsModule } from '../src/manifest';
import { projectsRecordLabels } from '../src/record-labels';
import { createProject } from '../src/service';

describe('projectsRecordLabels', () => {
  const base = {
    name: { de: 'Kastrationsaktion' },
    type: 'shortTerm' as const,
    summary: { de: 'Zusammenfassung' },
    body: { de: '' },
  };

  const setup = async () => {
    const deps = createTestDeps({ manifests: [coreModule, projectsModule] });
    await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de'] });
    const manage = ctxWith(['projects.view', 'projects.manage']);
    return { deps, manage };
  };

  it('answers only for projects', async () => {
    const { deps } = await setup();
    expect(projectsRecordLabels(deps, ctxWith(['projects.view']), 'contact', 'C1')).toBeNull();
  });

  it('labels a project for a reader, and a neutral label for anyone else', async () => {
    const { deps, manage } = await setup();
    const p = unwrap(await createProject(deps, manage, { ...base, slug: 'kastration' }));
    expect(projectsRecordLabels(deps, ctxWith(['projects.view']), 'project', p.id)).toEqual({
      label: 'Kastrationsaktion',
      href: `/projects/${p.id}`,
      state: 'ok',
    });
    expect(projectsRecordLabels(deps, ctxWith([]), 'project', p.id)).toEqual({
      label: 'Projekt (kein Zugriff)',
      href: null,
      state: 'forbidden',
    });
  });

  it('says missing for an unknown id', async () => {
    const { deps } = await setup();
    expect(projectsRecordLabels(deps, ctxWith(['projects.view']), 'project', 'NOPE')).toEqual({
      label: '',
      href: null,
      state: 'missing',
    });
  });
});
