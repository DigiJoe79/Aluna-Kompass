import { assignRole, coreModule, createApiToken, createRole, setModuleEnabled, setRolePermissions, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { coreMcpTools, createKompassMcpHandler } from '@kompass/mcp';
import { animalsModule } from '@kompass/module-animals';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

async function connectAsAnimalManager() {
  const deps = createTestDeps({ manifests: [coreModule, animalsModule] });
  const handler = createKompassMcpHandler(deps, { extraTools: coreMcpTools });
  const userId = insertUser(deps, {});
  const admin = ctxWith(['roles.manage', 'users.manage', 'modules.manage'], userId);
  unwrap(await setModuleEnabled(deps, admin, { key: 'animals', enabled: true }));
  const role = unwrap(await createRole(deps, admin, { name: 'Tierpflege' }));
  unwrap(await setRolePermissions(deps, admin, { roleId: role.id, permissionKeys: ['animals.manage', 'animals.view'] }));
  unwrap(await assignRole(deps, admin, { userId, roleId: role.id }));
  const { token } = unwrap(await createApiToken(deps, ctxWith([], userId), { name: 'test' }));
  const client = new Client({ name: 'kompass-test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://kompass.test/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  return client;
}

describe('mcp endpoint with a feature module', () => {
  it('tells a client which arguments a writing module tool takes', async () => {
    const client = await connectAsAnimalManager();
    const create = (await client.listTools()).tools.find((t) => t.name === 'animals_create')!;
    expect(Object.keys(create.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(['slug', 'name', 'sex', 'summary', 'body']));
    await client.close();
  });

  it('creates an animal from arguments shaped after the published schema', async () => {
    const client = await connectAsAnimalManager();
    const result = await client.callTool({
      name: 'animals_create',
      arguments: { slug: 'luna', name: 'Luna', sex: 'female', birthText: { de: '2022', en: '' }, sizeText: { de: '40 cm', en: '' }, summary: { de: 'Kurz', en: '' }, body: { de: 'Lang', en: '' } },
    });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { slug: string }).slug).toBe('luna');
    await client.close();
  });
});
