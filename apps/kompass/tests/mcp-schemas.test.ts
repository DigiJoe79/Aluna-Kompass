import { assignRole, coreModule, createApiToken, createRole, setModuleEnabled, setRolePermissions, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { coreMcpTools, createKompassMcpHandler } from '@kompass/mcp';
import { siteTemplateState } from '@kompass/module-site';
import { text } from '@kompass/site-template';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { installedModules } from '@/modules';

/**
 * Jedes Werkzeug zeigt ein gültiges JSON-Schema — gültig nach dem Metaschema,
 * nicht nur „von Zod lesbar“.
 *
 * Zod 4 schreibt `.meta()` ungefiltert ins JSON-Schema. Mehrsprachige Felder
 * trugen `.meta({ required: false })`; heraus kam `"required": false`, in JSON
 * Schema aber ist `required` seit Draft 4 eine Liste von Feldnamen. Claude Code
 * prüft streng und verwarf deshalb jedes Werkzeug mit einem mehrsprachigen Feld
 * — Tiere, Projekte, Webseiten-Einträge ließen sich per MCP weder anlegen noch
 * ändern (gefunden 2026-09-19). Unser eigenes `mcp:call` prüft nicht und merkte
 * nichts. Geprüft wird hier, was der Server bei `tools/list` wirklich ausliefert.
 */
async function listAllTools() {
  const deps = createTestDeps({ manifests: [coreModule, ...installedModules], locales: ['de', 'en'] });
  // Ein Template mit einer mehrsprachigen Sammlung: Deren Werkzeuge entstehen
  // erst aus der Deklaration, und genau dort saß die zweite Fundstelle.
  deps.db
    .insert(siteTemplateState)
    .values({
      id: 'current',
      name: 'T',
      schemaJson: {
        name: 'T',
        locales: ['de', 'en'],
        uses: [],
        variables: { claim: z.toJSONSchema(text({ localized: true }) as z.ZodType, { io: 'input' }) },
        collections: { faq: { label: 'FAQ', slug: false, sortable: true, publishable: true, fields: { answer: z.toJSONSchema(text({ localized: true }) as z.ZodType, { io: 'input' }) } } },
      },
      checksum: 'a'.repeat(64),
      readAt: 't',
      readByUserId: null,
    })
    .run();
  const handler = createKompassMcpHandler(deps, { extraTools: coreMcpTools });
  const userId = insertUser(deps, {});
  const admin = ctxWith([...deps.registry.permissionKeys], userId);
  for (const module of installedModules) unwrap(await setModuleEnabled(deps, admin, { key: module.key, enabled: true }));
  const role = unwrap(await createRole(deps, admin, { name: 'Alles' }));
  unwrap(await setRolePermissions(deps, admin, { roleId: role.id, permissionKeys: [...deps.registry.permissionKeys] }));
  unwrap(await assignRole(deps, admin, { userId, roleId: role.id }));
  const { token } = unwrap(await createApiToken(deps, ctxWith([], userId), { name: 'test' }));
  const client = new Client({ name: 'kompass-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://kompass.test/mcp'), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

describe('MCP-Werkzeugschemata', () => {
  it('sind gültiges JSON Schema, für jedes Werkzeug jedes Moduls', async () => {
    const tools = await listAllTools();
    // Eine Stichprobe, damit der Test nicht still an einer leeren Liste vorbeiläuft.
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['animals_update', 'project_create', 'site_faq_create', 'site_faq_update', 'dms_reclassify']));

    const ajv = new Ajv2020({ strict: false });
    const invalid = tools.flatMap((tool) => (ajv.validateSchema(tool.inputSchema) ? [] : [`${tool.name}: ${ajv.errorsText(ajv.errors)}`]));
    expect(invalid).toEqual([]);
  });

  /**
   * Ein Werkzeug, das ändert, nennt nur, was sich ändert. Ein Vorgabewert im
   * Schema füllt fehlende Felder — der Server parst die Argumente damit, ein
   * Client setzt sie womöglich selbst ein — und überschreibt so, was niemand
   * anfassen wollte. `site_…_update` löschte auf diese Weise Bilder (2026-09-19).
   */
  it('tragen in Werkzeugen, die ändern, keine Vorgabewerte', async () => {
    const tools = await listAllTools();
    const changing = tools.filter((t) => /_(update|set_story)$/.test(t.name));
    expect(changing.length).toBeGreaterThan(5);
    const withDefaults = changing.flatMap((tool) =>
      Object.entries((tool.inputSchema.properties ?? {}) as Record<string, { default?: unknown }>)
        .filter(([, property]) => 'default' in property)
        .map(([name]) => `${tool.name}.${name}`),
    );
    expect(withDefaults).toEqual([]);
  });

  /**
   * Prozesstest-Befund 11: der Agent sah beim Aufruf von `finance_master_data`
   * angeblich nur `kind: account`, obwohl der Dienst alle fünf Arten kennt
   * (`readMasterDataSchema`, eine `z.discriminatedUnion('kind', […])`). Der
   * Verdacht war, die JSON-Schema-Ausgabe verliere die Union. Dieser Test
   * liest das tatsächlich ausgelieferte Schema (wie oben, über einen echten
   * MCP-Client) und prüft es direkt.
   */
  /**
   * MCP-Prüfer M11 (2026-09-27): Ein Client, der auf oberster Ebene eine Union bekommt, nimmt den ersten Zweig —
   * `finance_master_data` und `finance_master_data_save` boten deshalb nur `kind: "account"` an. Jedes Werkzeug zeigt
   * an der Wurzel ein Objekt; eine Union darf erst eine Ebene tiefer stehen.
   */
  it('haben auf oberster Ebene ein Objekt, nie eine Union (M11)', async () => {
    const tools = await listAllTools();
    const offenders = tools
      .filter((tool) => {
        const schema = tool.inputSchema as Record<string, unknown>;
        return schema.type !== 'object' || 'anyOf' in schema || 'oneOf' in schema || 'allOf' in schema;
      })
      .map((tool) => tool.name);
    expect(offenders).toEqual([]);
    for (const name of ['finance_master_data', 'finance_master_data_save']) {
      const kind = (tools.find((t) => t.name === name)!.inputSchema.properties as Record<string, { enum?: string[] }>).kind;
      expect(kind?.enum, name).toEqual(expect.arrayContaining(['account', 'category', 'purpose']));
    }
  });

  it('finance_master_data nennt alle fünf Arten im ausgelieferten Schema (Befund 11)', async () => {
    const tools = await listAllTools();
    const tool = tools.find((t) => t.name === 'finance_master_data');
    expect(tool).toBeDefined();
    const schemaText = JSON.stringify(tool!.inputSchema);
    for (const kind of ['account', 'category', 'purpose', 'fiscalYear', 'datedValue']) {
      expect(schemaText, kind).toContain(`"${kind}"`);
    }
  });

  /**
   * Befund 28: `finance_entry_save_draft` verwarf `settlements` auf der
   * Geldzeile lautlos (eigenes Schema in `mcp-tools.ts`, ohne das Feld, das
   * der Dienst kennt) — ein Agent konnte darüber keinen Zahlungsentwurf
   * gegen einen offenen Posten anlegen. Paritätswächter, eng gefasst: das
   * ausgelieferte Schema nennt das Feld mit Beschreibung, für Entwurf und
   * Direktbuchung gleich (beide teilen sich `saveDraftMcpSchema`).
   */
  it('finance_entry_save_draft und finance_entry_book nennen settlements auf der Geldzeile (Befund 28)', async () => {
    const tools = await listAllTools();
    for (const name of ['finance_entry_save_draft', 'finance_entry_book']) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      const moneyLineSchema = (tool!.inputSchema.properties as { moneyLines?: { items?: { properties?: Record<string, { description?: string }> } } }).moneyLines?.items?.properties;
      expect(moneyLineSchema, name).toHaveProperty('settlements');
      expect(moneyLineSchema!.settlements!.description, name).toBeTruthy();
    }
  });

  /**
   * Architektur-Review A3: Drei Werkzeuge nahmen ein freies Objekt
   * (`z.record(z.string(), z.unknown())`) — ein Agent sah kein einziges Feld.
   * Jetzt zeigen sie die Schemata der Dienste selbst, keine Handkopie.
   */
  it('finance_master_data_save, lineTemplate und das CSV-Format zeigen die Felder der Dienste (A3)', async () => {
    const tools = await listAllTools();
    const schemaOf = (name: string) => {
      const tool = tools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      return tool!.inputSchema as { properties?: Record<string, unknown> };
    };
    const masterData = JSON.stringify(schemaOf('finance_master_data_save'));
    for (const field of ['iban', 'openingBalanceCents', 'sphere', 'incomeKind', 'costFunction', 'carryForwardCents', 'referenceNote', 'expectedVersion']) {
      expect(masterData, field).toContain(`"${field}"`);
    }
    const lineTemplate = JSON.stringify(schemaOf('finance_open_item_save').properties?.lineTemplate);
    for (const field of ['categoryId', 'amountCents', 'taxCode', 'purposeId', 'abroad']) expect(lineTemplate, field).toContain(`"${field}"`);
    const format = JSON.stringify(schemaOf('finance_import_profile_save').properties?.format);
    for (const field of ['encoding', 'delimiter', 'headerSignature', 'dateFormat', 'columns']) expect(format, field).toContain(`"${field}"`);
  });
});
