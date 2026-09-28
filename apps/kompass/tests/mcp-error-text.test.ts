import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { assignRole, conflict, constraintFailure, coreModule, createApiToken, createRole, invalid, setRolePermissions, unwrap, VALIDATION_MESSAGE_CODES, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser, systemContext } from '@kompass/core/testing';
import { coreMcpTools, createKompassMcpHandler, toCallToolResult } from '@kompass/mcp';
import { contactsModule } from '@kompass/module-contacts';
import { dmsModule } from '@kompass/module-dms';
import { financeModule } from '@kompass/module-finance';
import { projectsModule } from '@kompass/module-projects';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { toActionState } from '@/lib/actions';
import { mcpErrorTranslator } from '@/lib/mcp-errors';
import messages from '../messages/de.json';

/**
 * Nachtrag Rest 0.2.0, Task 7g (MB) und M: Was die Oberfläche übersetzt, übersetzt MCP genauso — Sperren des
 * Kerns (`settingUiOnly`, `humanOnly`) und Prüfmeldungen kamen über MCP nur als Schlüssel bzw. als englischer
 * Zod-Satz („Too small: expected number to be >0“). Der Code bleibt maschinenlesbar.
 */
const errors = (messages as unknown as { errors: Record<string, unknown> & { fields: Record<string, string> } }).errors;
const t = createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin' }) as unknown as (key: string, values?: Record<string, unknown>) => string;

async function connectAsAdministrator() {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule, projectsModule, financeModule] });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'projects', 'finance'], 'test.enable'));
  const handler = createKompassMcpHandler(deps, { extraTools: coreMcpTools, translateError: mcpErrorTranslator(deps) });
  const userId = insertUser(deps, {});
  const admin = ctxWith([...deps.registry.permissionKeys], userId);
  const role = unwrap(await createRole(deps, admin, { name: 'Alles' }));
  unwrap(await setRolePermissions(deps, admin, { roleId: role.id, permissionKeys: [...deps.registry.permissionKeys] }));
  unwrap(await assignRole(deps, admin, { userId, roleId: role.id }));
  const { token } = unwrap(await createApiToken(deps, ctxWith([], userId), { name: 'test' }));
  const client = new Client({ name: 'kompass-test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://kompass.test/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  return { deps, client };
}

type McpError = { type: string; code?: string; message?: string; issues?: { path: string; code: string; message: string }[] };
async function callError(client: Client, name: string, args: Record<string, unknown>): Promise<McpError> {
  const res = await client.callTool({ name, arguments: args });
  expect(res.isError).toBe(true);
  return (JSON.parse((res.content as { text: string }[])[0]!.text) as { error: McpError }).error;
}
const mcpError = (failure: ReturnType<typeof conflict>) =>
  (JSON.parse((toCallToolResult(failure, mcpErrorTranslator(createTestDeps())).content[0] as { text: string }).text) as { error: McpError }).error;

describe('Sperren des Kerns über MCP als Satz (MB)', () => {
  it('eine uiOnly-Einstellung über MCP: der Satz der Oberfläche, der Code bleibt', async () => {
    const { client } = await connectAsAdministrator();
    const error = await callError(client, 'settings_set', { key: 'finance.mcpHumanOnlyAllowed', value: true });
    expect(error).toMatchObject({ type: 'conflict', code: 'settingUiOnly', message: errors.settingUiOnly });
    await client.close();
  });

  it('die Finanz-Sperre humanOnly greift über den echten MCP-Weg (Prüfer-Befund 13) und kommt als Satz', async () => {
    const { client } = await connectAsAdministrator();
    const error = await callError(client, 'finance_entry_finalize', { id: 'gibt-es-nicht' });
    expect(error).toMatchObject({ type: 'conflict', code: 'humanOnly' });
    expect(error.message).toMatch(/ein Mensch/);
    expect(error.message).not.toContain('finance.');
    await client.close();
  });

  it('die allgemeine humanOnly-Sperre des Kerns bekommt denselben Satz wie in der Oberfläche', () => {
    expect(mcpError(conflict('humanOnly', 'some.setting'))).toMatchObject({ code: 'humanOnly', message: errors.humanOnly });
    const ui = toActionState(conflict('settingUiOnly', 'x'), t);
    expect(mcpError(conflict('settingUiOnly', 'x')).message).toBe(ui.status === 'error' ? ui.message : '');
  });

  it('N1: eine verletzte Datenbankregel kommt in Oberfläche und MCP als derselbe deutsche Satz, nie roh', () => {
    const failure = constraintFailure();
    const viaMcp = mcpErrorTranslator(createTestDeps())(failure.error);
    const viaUi = toActionState(failure, t as never);
    expect(viaMcp).toMatchObject({ type: 'conflict', code: 'databaseConstraint', message: expect.stringContaining('Regel der Datenbank') });
    expect(viaUi).toMatchObject({ status: 'error', code: 'databaseConstraint', message: (viaMcp as { message: string }).message });
  });

  it('N6: ein Konflikt mit mehreren Gründen nennt alle — in Oberfläche und MCP derselbe Text', () => {
    const failure = { ok: false as const, error: { type: 'conflict' as const, code: 'waiverNotConfirmed', message: 'waiverNotConfirmed', messageKey: 'finance.errors.waiverNotConfirmed', params: {}, also: [{ code: 'waiverSignedMissing', messageKey: 'finance.errors.waiverSignedMissing', params: {} }] } };
    const viaMcp = mcpErrorTranslator(createTestDeps())(failure.error) as { message: string };
    expect(viaMcp.message).toContain('Es ist nicht bestätigt, dass der Anspruch vorab vereinbart war.');
    expect(viaMcp.message).toContain('Die unterschriebene Verzichtserklärung liegt noch nicht vor.');
    expect(toActionState(failure, t as never)).toMatchObject({ status: 'error', message: viaMcp.message });
  });

  it('Prüfer-Fixrunde 28.09.: ein Grund ist ein Satz, mehrere sind eine Liste — MCP je Grund eine Zeile, die Oberfläche die Gründe einzeln', () => {
    const one = { ok: false as const, error: { type: 'conflict' as const, code: 'waiverSignedMissing', message: 'waiverSignedMissing', messageKey: 'finance.errors.waiverSignedMissing', params: {} } };
    const single = (mcpErrorTranslator(createTestDeps())(one.error) as { message: string }).message;
    expect(single).not.toContain('\n');
    expect(single.startsWith('- ')).toBe(false);
    expect(toActionState(one, t as never)).not.toHaveProperty('reasons');

    const also = [{ code: 'waiverSignedMissing', messageKey: 'finance.errors.waiverSignedMissing', params: {} }, { code: 'waiverDeclarationMissing', messageKey: 'finance.errors.waiverDeclarationMissing', params: {} }];
    const many = { ok: false as const, error: { type: 'conflict' as const, code: 'waiverAgreedAfterPosition', message: 'waiverAgreedAfterPosition', messageKey: 'finance.errors.waiverAgreedAfterPosition', params: {}, also } };
    const viaMcp = mcpErrorTranslator(createTestDeps())(many.error) as { code: string; message: string; also: unknown };
    const lines = viaMcp.message.split('\n');
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line.startsWith('- ')).toBe(true);
    expect(viaMcp).toMatchObject({ code: 'waiverAgreedAfterPosition', also });
    const viaUi = toActionState(many, t as never) as { message: string; reasons?: string[] };
    expect(viaUi.message).toBe(viaMcp.message);
    expect(viaUi.reasons).toEqual(lines.map((line) => line.slice(2)));
  });

  it('ein Konflikt ohne Übersetzung behält die Meldung des Dienstes', () => {
    expect(mcpError(conflict('somethingUnknown', 'Dienst sagt etwas'))).toMatchObject({ code: 'somethingUnknown', message: 'Dienst sagt etwas' });
  });
});

describe('Prüfmeldungen immer aus der Sprachdatei (M)', () => {
  it('ein negativer Betrag bei der Spendendose über MCP: deutscher Satz, Code daneben', async () => {
    const { deps, client } = await connectAsAdministrator();
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'finance.mcpHumanOnlyAllowed', true, 'test.allow'));
    const error = await callError(client, 'finance_donation_box_empty', { accountId: 'x', date: '2026-03-10', amountCents: -500, counterOneContactId: 'a', counterTwoContactId: 'b', boxLabel: 'Dose' });
    expect(error.type).toBe('validation');
    expect(error.issues).toEqual([{ path: 'amountCents', code: 'mustBeGreater', message: 'Muss größer als 0 sein.' }]);
    await client.close();
  });

  it('N5: eine bedingte Pflicht meldet der Dienst mit Code und Satz, nicht das SDK auf Englisch', async () => {
    const { client } = await connectAsAdministrator();
    const board = await callError(client, 'finance_setup_board_remuneration', { allowed: true, basisText: 'Satzung § 5' });
    expect(board).toMatchObject({ type: 'validation', issues: [{ path: 'validFrom', code: 'required', message: errors.fields.required }] });
    const partner = await callError(client, 'finance_partner_get', {});
    expect(partner).toMatchObject({ type: 'validation', issues: [{ code: 'idOrContactId', message: errors.fields.idOrContactId }] });
    await client.close();
  });

  it('Oberfläche und MCP zeigen dieselbe Feldmeldung', () => {
    const failure = invalid([{ path: 'amountCents', message: 'tooSmall', params: { minimum: 1 } }]);
    const ui = toActionState(failure, t);
    expect(ui.status === 'error' ? ui.fieldErrors.amountCents : null).toBe('Mindestens 1.');
    expect(mcpError(failure).issues).toEqual([{ path: 'amountCents', code: 'tooSmall', message: 'Mindestens 1.' }]);
  });

  it('jeder Code, den validate aus einer Zod-Standardmeldung macht, steht in errors.fields', () => {
    for (const code of VALIDATION_MESSAGE_CODES) expect(errors.fields, code).toHaveProperty(code);
  });

  it('jeder eigene Prüfcode im Quelltext ist ein Code und steht in errors.fields', () => {
    const roots = ['packages/core/src', 'packages/modules', 'packages/mcp/src'].map((p) => path.resolve(import.meta.dirname, '../../..', p));
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = path.join(dir, n);
        if (n === 'node_modules' || n === 'tests' || n === 'dist') return [];
        return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
      });
    const found = new Map<string, string>();
    for (const file of roots.flatMap(files)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(?:path: [^,}]+, message|code: 'custom', path: \[[^\]]*\], message|\{ message): '([^']*)'/g)) found.set(m[1]!, file);
      for (const m of src.matchAll(/\.refine\([^;]*?, '([^']*)'\)/g)) found.set(m[1]!, file);
      for (const m of src.matchAll(/^\s+message: '([^']*)',?$/gm)) found.set(m[1]!, file);
    }
    expect(found.size).toBeGreaterThan(50);
    const missing = [...found].filter(([code]) => !/^[a-z][A-Za-z0-9]*$/.test(code) || !(code in errors.fields)).map(([code, file]) => `${code} (${path.relative(process.cwd(), file)})`);
    expect(missing).toEqual([]);
  });
});
