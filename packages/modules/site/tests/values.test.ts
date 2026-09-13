import { coreModule, schema as core, unwrap } from '@kompass/core';
import { animalsModule, createAnimal, setAnimalPublished } from '@kompass/module-animals';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { number, reference, references, text } from '@kompass/site-template';
import type { FieldSchema } from '../src/load';
import { siteTemplateState } from '../src/schema';
import { listReferenceOptions, readValues, setValues } from '../src/values';

const asJson = (s: unknown) => z.toJSONSchema(s as z.ZodType, { io: 'input' }) as FieldSchema;

const withUser = (locales: string[]) => {
  const deps = createTestDeps({ locales });
  insertUser(deps, { id: 'USER-TEST' });
  return deps;
};

const seedTemplate = (deps: ReturnType<typeof withUser>, variables: Record<string, FieldSchema>) => {
  deps.db
    .insert(siteTemplateState)
    .values({
      id: 'current',
      name: 'T',
      schemaJson: { name: 'T', locales: deps.locales(), uses: [], variables, collections: {} },
      checksum: 'a'.repeat(64),
      readAt: 't',
      readByUserId: null,
    })
    .run();
};

describe('site values', () => {
  it('returns the declared defaults before anything was saved', () => {
    const deps = withUser(['de']);
    seedTemplate(deps, { claim: asJson(text({ localized: true })), pct: asJson(number({ min: 0, max: 100 })) });
    expect(readValues(deps)).toEqual({ claim: {}, pct: 0 });
  });

  it('saves and reads back a value', async () => {
    const deps = withUser(['de']);
    seedTemplate(deps, { claim: asJson(text({ localized: true })), pct: asJson(number({ min: 0, max: 100 })) });
    unwrap(await setValues(deps, ctxWith(['site.manage']), { values: { pct: 42 } }));
    expect(readValues(deps)).toEqual({ claim: {}, pct: 42 });
  });

  it('needs site.manage', async () => {
    const deps = withUser(['de']);
    seedTemplate(deps, { pct: asJson(number({})) });
    const r = await setValues(deps, ctxWith([]), { values: { pct: 1 } });
    expect(r.ok === false && r.error.type === 'forbidden').toBe(true);
  });

  it('rejects a value the template schema does not allow', async () => {
    const deps = withUser(['de']);
    seedTemplate(deps, { pct: asJson(number({ min: 0, max: 100 })) });
    const r = await setValues(deps, ctxWith(['site.manage']), { values: { pct: 200 } });
    expect(r.ok === false && r.error.type === 'validation' && r.error.issues[0]?.path === 'pct').toBe(true);
  });

  it('rejects a key the template does not declare', async () => {
    const deps = withUser(['de']);
    seedTemplate(deps, { pct: asJson(number({})) });
    const r = await setValues(deps, ctxWith(['site.manage']), { values: { nope: 1 } });
    expect(r.ok === false && r.error.type === 'validation' && r.error.issues[0]?.message === 'unknownVariable' && r.error.issues[0]?.path === 'nope').toBe(true);
  });

  it('rejects a locale the installation does not keep', async () => {
    const deps = withUser(['de']);
    seedTemplate(deps, { claim: asJson(text({ localized: true })) });
    const r = await setValues(deps, ctxWith(['site.manage']), { values: { claim: { de: 'ok', fr: 'non' } } });
    expect(r.ok === false && r.error.type === 'validation' && r.error.issues[0]?.message === 'unknownLocale').toBe(true);
  });

  it('writes one audit entry per save with before and after', async () => {
    const deps = withUser(['de']);
    seedTemplate(deps, { pct: asJson(number({ min: 0, max: 100 })) });
    const ctx = ctxWith(['site.manage']);
    unwrap(await setValues(deps, ctx, { values: { pct: 10 } }));
    unwrap(await setValues(deps, ctx, { values: { pct: 20 } }));
    const entries = deps.db.select().from(core.auditLog).all().filter((e) => e.action === 'site.values.update');
    expect(entries.length).toBe(2);
    expect(JSON.parse(entries.at(-1)?.before ?? '{}')).toEqual({ pct: 10 });
    expect(JSON.parse(entries.at(-1)?.after ?? '{}')).toEqual({ pct: 20 });
  });
});

describe('reference values', () => {
  const withAnimals = async () => {
    const deps = createTestDeps({ locales: ['de', 'en'], manifests: [coreModule, animalsModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const ctx = ctxWith(['animals.manage', 'animals.view']);
    const bruno = unwrap(await createAnimal(deps, ctx, { slug: 'bruno', name: 'Bruno', sex: 'male', birthText: {}, sizeText: {}, summary: {}, body: {} }));
    unwrap(await setAnimalPublished(deps, ctx, { id: bruno.id, isPublished: true }));
    deps.db
      .insert(siteTemplateState)
      .values({
        id: 'current',
        name: 'T',
        schemaJson: { name: 'T', locales: ['de', 'en'], uses: ['animals'], variables: { dog: asJson(reference({ view: 'animals', where: { status: 'lookingForHome' }, label: 'Hund' })), dogs: asJson(references({ view: 'animals', max: 2, label: 'Hunde' })) }, collections: {} },
        checksum: 'a'.repeat(64),
        readAt: 't',
        readByUserId: null,
      })
      .run();
    return deps;
  };

  it('saves a value that is among the options and rejects one that is not', async () => {
    const deps = await withAnimals();
    const manage = ctxWith(['site.manage']);
    const saved = unwrap(await setValues(deps, manage, { values: { dog: 'bruno' } }));
    expect(saved.dog).toBe('bruno');
    const stale = await setValues(deps, manage, { values: { dog: 'ghost' } });
    expect(stale.ok === false && stale.error.type === 'validation' && stale.error.issues).toEqual([{ path: 'dog', message: 'referenceNotFound' }]);
    expect(readValues(deps).dog).toBe('bruno');
  });

  it('accepts null as no choice, and refuses the same record twice in a references field', async () => {
    const deps = await withAnimals();
    const manage = ctxWith(['site.manage']);
    expect(unwrap(await setValues(deps, manage, { values: { dog: null } })).dog).toBe(null);
    const twice = await setValues(deps, manage, { values: { dogs: ['bruno', 'bruno'] } });
    expect(twice.ok === false && twice.error.type === 'validation' && twice.error.issues).toEqual([{ path: 'dogs', message: 'duplicateReference' }]);
  });

  it('lists the options per reference field for the mask and for MCP', async () => {
    const deps = await withAnimals();
    const options = unwrap(await listReferenceOptions(deps, ctxWith(['site.view'])));
    expect(options).toEqual({ dog: [{ value: 'bruno', label: 'Bruno' }], dogs: [{ value: 'bruno', label: 'Bruno' }] });
    const denied = await listReferenceOptions(deps, ctxWith([]));
    expect(denied.ok === false && denied.error.type).toBe('forbidden');
  });
});
