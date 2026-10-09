import { projectsModule } from '@kompass/module-projects';
import { coreModule, unwrap } from '@kompass/core';
import { listProjects } from '@kompass/module-projects';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { importPrototype } from '../../../../scripts/import-prototype';
import { eq } from 'drizzle-orm';
import { animals, animalsModule, findAnimalBySlug, listAnimals } from '../src';
import { cleanupPrototypes, fakePrototype } from './prototype-fixture';

afterEach(() => {
  cleanupPrototypes();
});

describe('importPrototype', () => {
  it('imports dogs with their story and the projects, and stays idempotent', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule, projectsModule], env: 'test' });
    insertUser(deps, { id: 'USER-TEST' });
    const ctx = ctxWith(['projects.manage', 'projects.view', 'animals.manage', 'animals.view', 'media.upload', 'settings.manage']);
    const dir = fakePrototype();

    // Den Slug bildet Kompass; der Import erkennt Tiere am Namen, der Test findet sie auch dort.
    const findAnimalByName = (name: string) => findAnimalBySlug(deps.db, deps.db.select().from(animals).where(eq(animals.name, name)).get()!.slug)!;
    const first = await importPrototype(deps, ctx, { prototypeDir: dir });
    expect(first).toEqual({ animals: 2, projects: 1 });
    expect(unwrap(await listAnimals(deps, ctx)).total).toBe(2);
    const akiko = findAnimalByName('Akiko');
    expect(akiko.status).toBe('adopted');
    expect(akiko.story?.quote.de).toBe('Endlich zuhause.');
    expect(findAnimalByName('Chiara').photos).toHaveLength(1);
    expect(unwrap(await listProjects(deps, ctx))[0]?.type).toBe('ongoing');

    const second = await importPrototype(deps, ctx, { prototypeDir: dir });
    expect(second).toEqual({ animals: 0, projects: 0 });
  });
});
