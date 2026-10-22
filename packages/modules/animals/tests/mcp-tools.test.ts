import { coreModule, defineModule, moduleMcpTools, setSetting, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule } from '../src';
import { png, proposalDeps, source } from './proposal-fixture';

describe('animals mcp tools', () => {
  it('creates and lists through the tool handlers with the caller context', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule] });
    insertUser(deps, { id: 'USER-TEST' });
    await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });
    const tools = Object.fromEntries(moduleMcpTools(deps, animalsModule).map((t) => [t.name, t]));
    const ctx = ctxWith(['animals.manage', 'animals.view']);
    const created = unwrap(await tools.animals_create!.handler(deps, ctx, tools.animals_create!.inputSchema.parse({ name: 'Luna', sex: 'female', birthText: { de: '2022', en: '' }, sizeText: { de: '40 cm', en: '' }, summary: { de: 'x', en: '' }, body: { de: 'y', en: '' } }))) as { id: string };
    const listed = unwrap(await tools.animals_list!.handler(deps, ctx, {})) as { animals: { id: string }[]; total: number };
    expect(listed.total).toBe(1);
    expect(listed.animals.map((a) => a.id)).toEqual([created.id]);
    const denied = await tools.animals_create!.handler(deps, ctxWith(['animals.view']), { name: 'X', sex: 'male', birthText: { de: '', en: '' }, sizeText: { de: '', en: '' }, summary: { de: '', en: '' }, body: { de: '', en: '' } });
    expect(denied.ok).toBe(false);
  });

  it('stages an image from base64 through the tool', async () => {
    const d = await proposalDeps();
    const tools = Object.fromEntries(moduleMcpTools(d, animalsModule).map((t) => [t.name, t]));
    const args = tools.animals_proposal_image_stage!.inputSchema.parse({ filename: 'hb.png', contentBase64: Buffer.from(await png(3)).toString('base64'), sourceRef: 'hb-3' });
    expect(await tools.animals_proposal_image_stage!.handler(d, source(), args)).toMatchObject({ ok: true, value: { mimeType: 'image/png' } });
  });

  /** Spec Ausschnitt in der Prüfung (2026-10-11) § 3: Annehmen nimmt je Foto einen Ausschnitt mit, wie in der Oberfläche. */
  it('animals_proposal_accept names the crop per photo and where its format comes from', () => {
    const tools = Object.fromEntries(moduleMcpTools(createTestDeps({ manifests: [coreModule, animalsModule] }), animalsModule).map((t) => [t.name, t]));
    const text = tools.animals_proposal_accept!.description;
    expect(text).toMatch(/crop \{ x, y, w, h \}/);
    expect(text).toMatch(/omitted keeps the crop of the proposal .*stored crop/);
    expect(text).toMatch(/null removes it/);
    expect(text).toMatch(/expected in the format of its place/);
    expect(text).toMatch(/imagePlaces\["animals\.primary"\]/);
  });
});

/**
 * MCP-Parität für Quellen (Joe 2026-10-11, Plan E Task 6): Eine Quelle mit nur `animals.propose` liest die Formate,
 * die Kompass für Titelbild und Galerie erwartet, aus `animals_proposals_status` — dieselbe Auflösung wie die Oberfläche.
 */
describe('animals_proposals_status image places', () => {
  type Places = Record<string, { formats: string[]; source: string; places: { ratio: string; minWidthPx: number; lightbox?: boolean }[] }>;
  const proposerOnly = { ...ctxWith(['animals.propose'], 'SOURCE-A'), channel: 'mcp' as const };
  const statusOf = async (d: Awaited<ReturnType<typeof proposalDeps>>) => {
    const tools = Object.fromEntries(moduleMcpTools(d, animalsModule).map((t) => [t.name, t]));
    return unwrap(await tools.animals_proposals_status!.handler(d, proposerOnly, {})) as { proposals: unknown[]; imagePlaces: Places };
  };

  it('without a template: the primary photo from the setting, the gallery free', async () => {
    const got = await statusOf(await proposalDeps());
    expect(got.proposals).toEqual([]);
    expect(Object.keys(got.imagePlaces)).toEqual(['animals.primary', 'animals.gallery']);
    expect(got.imagePlaces['animals.primary']).toMatchObject({ formats: ['4:3'], source: 'fallback' });
    expect(got.imagePlaces['animals.gallery']!.formats).toEqual([]);
    expect(got.imagePlaces['animals.gallery']!.places.some((p) => p.lightbox)).toBe(true);
  });

  it('with a template: the formats and widths the template declares', async () => {
    const web = defineModule({ key: 'web', version: '1', permissions: [], imagePlaceSpecs: () => ({ 'animals.primary': { ratio: '4:5', width: 800 }, 'animals.gallery': { ratio: '1:1', width: 600 } }) });
    const got = await statusOf(await proposalDeps({ manifests: [web] }));
    expect(got.imagePlaces['animals.primary']).toMatchObject({ formats: ['4:5'], source: 'template' });
    expect(got.imagePlaces['animals.gallery']!.formats).toEqual(['1:1']);
    expect(got.imagePlaces['animals.gallery']!.places[0]).toMatchObject({ ratio: '1:1' });
    expect(got.imagePlaces['animals.gallery']!.places[0]!.minWidthPx).toBeGreaterThan(0);
  });

  it('submit and image stage tell where the format comes from', async () => {
    const tools = Object.fromEntries(moduleMcpTools(await proposalDeps(), animalsModule).map((t) => [t.name, t]));
    for (const name of ['animals_proposal_submit', 'animals_proposal_image_stage']) {
      expect(tools[name]!.description).toMatch(/imagePlaces of animals_proposals_status/);
      expect(tools[name]!.description).toMatch(/animals\.primary.*animals\.gallery/);
    }
    expect(tools.animals_proposal_submit!.description).toMatch(/empty formats = any/);
    expect(tools.animals_proposal_submit!.description).toMatch(/gallery photo only with a reason in the picture/);
    expect(tools.animals_proposals_status!.description).toMatch(/imagePlaces/);
  });
});
