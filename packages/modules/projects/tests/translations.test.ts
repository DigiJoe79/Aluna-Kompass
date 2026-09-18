import { coreModule, schema as core, setSetting, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { projectsModule } from '../src/manifest';
import { createProject, getProject } from '../src/service';
import { projectsSetTranslations, projectsTranslatables } from '../src/translations';

const manage = ctxWith(['projects.manage', 'projects.view']);
const view = ctxWith(['projects.view']);
const base = { slug: 'grundversorgung', name: { de: 'Grundversorgung des Heims', en: '' }, type: 'ongoing' as const, summary: { de: 'Futter und Wärme', en: 'Food and warmth' }, body: { de: 'Text', en: '' } };

const setup = async () => {
  const deps = createTestDeps({ manifests: [coreModule, projectsModule] });
  insertUser(deps, { id: 'USER-TEST' });
  await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });
  const p = unwrap(await createProject(deps, manage, base));
  return { deps, id: p.id };
};

describe('projects translations', () => {
  it('lists every project, drafts included, labelled by its leading-locale name', async () => {
    const { deps, id } = await setup();
    expect(unwrap(projectsTranslatables(deps, view))).toEqual([
      { entityType: 'project', id, label: 'Grundversorgung des Heims', href: `/projects/${id}`, fields: { name: base.name, summary: base.summary, body: base.body } },
    ]);
    expect(projectsTranslatables(deps, ctxWith([])).ok).toBe(false);
  });

  it('writes only the named locales in one audited update', async () => {
    const { deps, id } = await setup();
    const auditBefore = deps.db.select().from(core.auditLog).all().length;
    const result = await projectsSetTranslations(deps, manage, { entityType: 'project', id, items: [{ field: 'name', locale: 'en', text: 'Basic care for the shelter' }, { field: 'body', locale: 'en', text: 'Text (en)' }] });
    expect(result && (await result).ok).toBe(true);
    const p = unwrap(await getProject(deps, view, id));
    expect(p.name).toEqual({ de: 'Grundversorgung des Heims', en: 'Basic care for the shelter' });
    expect(p.body).toEqual({ de: 'Text', en: 'Text (en)' });
    expect(p.summary).toEqual(base.summary);
    expect(deps.db.select().from(core.auditLog).all().slice(auditBefore).map((e) => e.action)).toEqual(['projects.update']);
  });

  it('is null for foreign types, forbidden without manage, notFound for a foreign id or field', async () => {
    const { deps, id } = await setup();
    expect(projectsSetTranslations(deps, manage, { entityType: 'animal', id, items: [] })).toBeNull();
    const denied = await projectsSetTranslations(deps, view, { entityType: 'project', id, items: [{ field: 'name', locale: 'en', text: 'x' }] });
    expect(denied && !denied.ok && denied.error.type).toBe('forbidden');
    const missing = await projectsSetTranslations(deps, manage, { entityType: 'project', id: 'nope', items: [{ field: 'name', locale: 'en', text: 'x' }] });
    expect(missing && !missing.ok && missing.error).toEqual({ type: 'notFound', entity: 'project', id: 'nope' });
    const field = await projectsSetTranslations(deps, manage, { entityType: 'project', id, items: [{ field: 'slug', locale: 'en', text: 'x' }] });
    expect(field && !field.ok && field.error).toEqual({ type: 'notFound', entity: 'field', id: 'slug' });
  });

  it('is wired into the manifest', () => {
    expect(projectsModule.translatables).toBe(projectsTranslatables);
    expect(projectsModule.setTranslations).toBe(projectsSetTranslations);
  });
});
