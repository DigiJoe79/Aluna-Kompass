import { createApiToken, createRole, schema, setRolePermissions, assignRole, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import { coreMcpTools, createKompassMcpHandler, toCallToolResult } from '../src';

async function connect(fetchImpl: (url: string | URL, init?: RequestInit) => Promise<Response>, token: string | null) {
  const client = new Client({ name: 'kompass-test', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('http://kompass.test/mcp'), {
    fetch: fetchImpl,
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  await client.connect(transport);
  return client;
}

async function tokenFor(deps: ReturnType<typeof createTestDeps>, permissions: string[]) {
  const userId = insertUser(deps, {});
  const admin = ctxWith(['roles.manage', 'users.manage'], userId);
  const role = unwrap(await createRole(deps, admin, { name: `R-${permissions.join('-') || 'none'}` }));
  unwrap(await setRolePermissions(deps, admin, { roleId: role.id, permissionKeys: permissions }));
  unwrap(await assignRole(deps, admin, { userId, roleId: role.id }));
  const { token } = unwrap(await createApiToken(deps, ctxWith([], userId), { name: 'test' }));
  return { token, userId };
}

describe('toCallToolResult', () => {
  it('serialises ok values and marks errors', () => {
    expect(toCallToolResult({ ok: true, value: { a: 1 } })).toEqual({ content: [{ type: 'text', text: '{"a":1}' }], structuredContent: { a: 1 } });
    const err = toCallToolResult({ ok: false, error: { type: 'forbidden', permission: 'x.y' } });
    expect(err.isError).toBe(true);
    expect(JSON.parse((err.content[0] as { text: string }).text)).toEqual({ error: { type: 'forbidden', permission: 'x.y' } });
  });
});

describe('kompass mcp handler', () => {
  it('lists core tools and executes a read with the token owner permissions', async () => {
    const deps = createTestDeps();
    const handler = createKompassMcpHandler(deps, { extraTools: coreMcpTools });
    const { token } = await tokenFor(deps, ['settings.manage']);
    const client = await connect((url, init) => handler.fetch(new Request(url, init)), token);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['settings_get', 'settings_set', 'roles_list', 'users_create', 'audit_query', 'documents_bases', 'modules_set_enabled']));
    const result = await client.callTool({ name: 'settings_get', arguments: { key: 'organization.name' } });
    expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toEqual({ key: 'organization.name', value: 'Neuer Verein' });
    await client.close();
  });

  it('writes through the service layer with channel mcp and token id in the audit log', async () => {
    const deps = createTestDeps();
    const handler = createKompassMcpHandler(deps, { extraTools: coreMcpTools });
    const { token, userId } = await tokenFor(deps, ['settings.manage']);
    const client = await connect((url, init) => handler.fetch(new Request(url, init)), token);
    const result = await client.callTool({ name: 'settings_set', arguments: { key: 'organization.city', value: 'Jülich' } });
    expect(result.isError).toBeFalsy();
    const entry = deps.db.select().from(schema.auditLog).all().at(-1)!;
    expect(entry).toMatchObject({ action: 'settings.update', channel: 'mcp', userId });
    expect(entry.apiTokenId).toBeTruthy();
    await client.close();
  });

  it('returns a structured forbidden error instead of bypassing permissions', async () => {
    const deps = createTestDeps();
    const handler = createKompassMcpHandler(deps, { extraTools: coreMcpTools });
    const { token } = await tokenFor(deps, ['audit.view']);
    const client = await connect((url, init) => handler.fetch(new Request(url, init)), token);
    const result = await client.callTool({ name: 'settings_set', arguments: { key: 'organization.city', value: 'X' } });
    expect(result.isError).toBe(true);
    expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toEqual({ error: { type: 'forbidden', permission: 'settings.manage' } });
    await client.close();
  });

  it('rejects missing or revoked tokens with 401', async () => {
    const deps = createTestDeps();
    const handler = createKompassMcpHandler(deps, { extraTools: coreMcpTools });
    const response = await handler.fetch(new Request('http://kompass.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) }));
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
    await expect(connect((url, init) => handler.fetch(new Request(url, init)), 'akx_test_invalid')).rejects.toThrow();
  });
});
