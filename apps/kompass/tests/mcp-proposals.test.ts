import { assignRole, coreModule, createApiToken, createRole, setModuleEnabled, setRolePermissions, setUserActive, unwrap, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser, systemContext, type TestDeps } from '@kompass/core/testing';
import { coreMcpTools, createKompassMcpHandler } from '@kompass/mcp';
import { animalsModule, PROPOSALS_ENABLED_KEY } from '@kompass/module-animals';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import { mcpErrorTranslator } from '@/lib/mcp-errors';

/**
 * Vorschlags-Eingang Ende-zu-Ende über den echten MCP-Handler (Spec 2026-10-09, § 8 Tests): Eine Quelle mit
 * `animals.view` + `animals.propose` schlägt vor, eine Prüferin mit `animals.manage` nimmt an, die Quelle liest
 * Zustand und Endfassung samt Fotozuordnung zurück.
 */
/** Ein PNG mit einem Pixel (die App hängt nicht an sharp). */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function clientFor(deps: TestDeps, admin: ReturnType<typeof ctxWith>, name: string, permissionKeys: string[]) {
  const handler = createKompassMcpHandler(deps, { extraTools: coreMcpTools, translateError: mcpErrorTranslator(deps) });
  const userId = insertUser(deps, { name });
  const role = unwrap(await createRole(deps, admin, { name }));
  unwrap(await setRolePermissions(deps, admin, { roleId: role.id, permissionKeys }));
  unwrap(await assignRole(deps, admin, { userId, roleId: role.id }));
  const { token } = unwrap(await createApiToken(deps, ctxWith([], userId), { name: 'test' }));
  const client = new Client({ name: 'kompass-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://kompass.test/mcp'), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return { client, userId };
}

async function connectBoth(opts: { proposals?: boolean } = {}) {
  const deps = createTestDeps({ manifests: [coreModule, animalsModule], locales: ['de', 'en'] });
  const adminId = insertUser(deps, { name: 'Admin' });
  const admin = ctxWith([...deps.registry.permissionKeys], adminId);
  unwrap(await setModuleEnabled(deps, admin, { key: 'animals', enabled: true }));
  deps.db.transaction((tx) => unwrap(writeSettingInternal(tx, deps, systemContext(), PROPOSALS_ENABLED_KEY, opts.proposals ?? true)));
  const source = await clientFor(deps, admin, 'Tierbörse Nord', ['animals.view', 'animals.propose']);
  const manager = await clientFor(deps, admin, 'Petra Prüferin', ['animals.view', 'animals.manage']);
  return { deps, admin, sourceClient: source.client, sourceUserId: source.userId, managerClient: manager.client };
}

const call = async (c: Client, name: string, args: Record<string, unknown>) => {
  const r = await c.callTool({ name, arguments: args });
  expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
  return r.structuredContent as Record<string, unknown>;
};

const fiete = { name: 'Fiete', sex: 'male', birthText: { de: '2020', en: '' }, sizeText: { de: 'groß', en: '' }, summary: { de: 'Freundlich.', en: '' }, body: { de: 'Lang.', en: '' } };

describe('proposals over mcp', () => {
  it('source proposes, manager accepts, source reads back the final version with photo mapping', async () => {
    const { sourceClient, managerClient } = await connectBoth();
    const staged = await call(sourceClient, 'animals_proposal_image_stage', { filename: 'hb-7.png', contentBase64: PNG_BASE64, sourceRef: 'hb-7' });
    await call(sourceClient, 'animals_proposal_submit', { kind: 'create', sourceKey: 'tb-7-v1', externalRef: 'TB-7', values: fiete, photos: [{ imageId: staged.imageId, isPrimary: true, crop: { x: 0, y: 0, w: 1, h: 0.9 } }] });
    // Die Quelle kann weder annehmen noch selbst schreiben.
    expect((await sourceClient.callTool({ name: 'animals_proposal_accept', arguments: { id: 'egal' } })).isError).toBe(true);
    expect((await sourceClient.callTool({ name: 'animals_create', arguments: { name: 'X', sex: 'male', birthText: {}, sizeText: {}, summary: {}, body: {} } })).isError).toBe(true);
    const inbox = await call(managerClient, 'animals_proposals_list', {});
    const id = (inbox.proposals as { id: string }[])[0]!.id;
    await call(managerClient, 'animals_proposal_accept', { id, publish: false });
    const status = await call(sourceClient, 'animals_proposals_status', { sourceKeys: ['tb-7-v1'] });
    expect(status.proposals).toMatchObject([{ state: 'accepted', final: { animalId: expect.any(String), photos: [{ sourceRef: 'hb-7', position: 1, isPrimary: true, crop: { x: 0, y: 0, w: 1, h: 0.9 }, mediaId: expect.any(String) }] } }]);
    const found = await call(sourceClient, 'animals_list', { origin: { externalRef: 'TB-7' } });
    expect((found.animals as { name: string }[]).map((a) => a.name)).toEqual(['Fiete']);
    await sourceClient.close();
    await managerClient.close();
  });

  it('with the setting off the source tools refuse with proposalsDisabled', async () => {
    const { sourceClient, managerClient } = await connectBoth({ proposals: false });
    const r = await sourceClient.callTool({ name: 'animals_proposal_submit', arguments: { kind: 'create', sourceKey: 'k', externalRef: 'TB-1', values: fiete } });
    expect(r.isError).toBe(true);
    const text = (r.content as { text: string }[])[0]!.text;
    expect(text).toContain('proposalsDisabled');
    expect(text).toContain('ausgeschaltet');
    await sourceClient.close();
    await managerClient.close();
  });

  it('a deactivated source user is not accepted', async () => {
    const { deps, admin, sourceClient, sourceUserId, managerClient } = await connectBoth();
    await call(sourceClient, 'animals_proposals_status', {});
    unwrap(await setUserActive(deps, admin, { id: sourceUserId, isActive: false }));
    await expect(sourceClient.callTool({ name: 'animals_proposals_status', arguments: {} })).rejects.toThrow();
    await managerClient.close();
  });
});
