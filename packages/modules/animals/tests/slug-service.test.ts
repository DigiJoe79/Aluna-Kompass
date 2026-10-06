import { coreModule, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { animalsModule, createAnimal, updateAnimal } from '../src';
import { animalSlugFor } from '../src/service';
import { ANIMALS_MCP_TOOLS } from '../src/mcp-tools';
import { animals } from '../src/schema';
import { animalSlug } from '../src/slug';

const base = { name: 'Luna', sex: 'female' as const, birthText: {}, sizeText: {}, summary: {}, body: {} };
const tool = (name: string) => ANIMALS_MCP_TOOLS.find((t) => t.name === name)!;

function setup() {
  const deps = createTestDeps({ manifests: [coreModule, animalsModule] });
  const ctx = ctxWith(['animals.manage', 'animals.view'], insertUser(deps, {}));
  return { deps, ctx };
}

describe('the slug is made by Kompass and stays', () => {
  it('builds it from name and id at creation', async () => {
    const { deps, ctx } = setup();
    const a = unwrap(await createAnimal(deps, ctx, base));
    expect(a.slug).toBe(animalSlug('Luna', a.id));
  });

  it('gives two dogs of the same name two slugs (Review Focus 4)', async () => {
    const { deps, ctx } = setup();
    const one = unwrap(await createAnimal(deps, ctx, base));
    const two = unwrap(await createAnimal(deps, ctx, base));
    expect(one.slug).not.toBe(two.slug);
  });

  it('takes a longer id part when the short slug is already taken', async () => {
    const { deps, ctx } = setup();
    const other = unwrap(await createAnimal(deps, ctx, base));
    // Einen Kurzslug von Hand besetzen, damit die (in echt fast unmögliche) Kollision sicher eintritt.
    const id = '01M3FPWPWAM4CCFPW048GAYEH3';
    deps.db.update(animals).set({ slug: animalSlug('Luna', id) }).where(eq(animals.id, other.id)).run();
    expect(animalSlugFor(deps.db, 'Luna', id)).toBe('luna-gayeh3');
    expect(animalSlugFor(deps.db, 'Bella', id)).toBe('bella-yeh3');
  });

  it('keeps the slug when the dog is renamed (Review Focus 1)', async () => {
    const { deps, ctx } = setup();
    const a = unwrap(await createAnimal(deps, ctx, base));
    const renamed = unwrap(await updateAnimal(deps, ctx, { id: a.id, name: 'Bella' }));
    expect(renamed.name).toBe('Bella');
    expect(renamed.slug).toBe(a.slug);
  });

  it('refuses a slug sent by a caller, at create and update (Review Focus 2)', async () => {
    const { deps, ctx } = setup();
    const created = await createAnimal(deps, ctx, { ...base, slug: 'luna' });
    expect(created).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'slug', message: 'slugGenerated' }] } });
    const a = unwrap(await createAnimal(deps, ctx, base));
    const updated = await updateAnimal(deps, ctx, { id: a.id, slug: 'neu' });
    expect(updated).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'slug', message: 'slugGenerated' }] } });
  });

  it('offers no slug argument on animals_create and animals_update and refuses one', () => {
    for (const name of ['animals_create', 'animals_update']) {
      const schema = tool(name).inputSchema;
      const args = name === 'animals_create' ? { ...base, slug: 'luna' } : { id: 'X', slug: 'luna' };
      expect(schema.safeParse(args).success).toBe(false);
      const { slug: _slug, ...without } = args;
      expect(schema.safeParse(without).success).toBe(true);
    }
  });
});
