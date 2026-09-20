import { coreModule, moduleMcpTools, type McpToolDefinition, type ModuleManifest } from '@kompass/core';
import * as animalsPkg from '@kompass/module-animals';
import * as contactsPkg from '@kompass/module-contacts';
import * as dmsPkg from '@kompass/module-dms';
import * as projectsPkg from '@kompass/module-projects';
import * as corePkg from '@kompass/core';
import * as sitePkg from '@kompass/module-site';
import { createTestDeps } from '@kompass/core/testing';
import { coreMcpTools } from '@kompass/mcp';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { installedModules } from '@/modules';

// Die Werkzeugliste mancher Module (etwa `site`) entsteht erst zur Laufzeit aus
// `deps` — deshalb über `moduleMcpTools` statt direkt über das Manifest.
const deps = createTestDeps({ manifests: [coreModule, ...installedModules] });
const registeredTools: McpToolDefinition[] = [...coreMcpTools, ...installedModules.flatMap((m) => [...moduleMcpTools(deps, m)])];

// Die Kernwerkzeuge liegen in @kompass/mcp, nicht im Manifest des Kerns.
const modulesWithTools: [ModuleManifest, readonly McpToolDefinition[]][] = [
  [coreModule, coreMcpTools],
  ...installedModules.map((m): [ModuleManifest, readonly McpToolDefinition[]] => [m, moduleMcpTools(deps, m)]),
];

/**
 * Rechte, die bewusst ohne MCP-Werkzeug bleiben. Backup hängt an Dateiströmen —
 * ein Backup von einigen hundert Megabyte durch JSON-RPC zu reichen, brächte
 * niemandem etwas; es läuft über Route Handler. Die sechs `dms.*`-Rechte sind
 * mit dem Modul selbst nur umgezogen (Plan „dms-1-umzug“); ihre Werkzeuge
 * bringt Plan „dms-4-oberflaeche-mcp-seed“ (§ 7 der Spec). Wer hier einträgt,
 * entscheidet bewusst; wer ein Recht ergänzt, ohne es hier oder in einem
 * Werkzeug zu nennen, bekommt einen roten Test.
 */
const WITHOUT_MCP = new Set(['backup.export', 'backup.import']);

/** Rechte, die kein Werkzeug nennt, als `modul: recht`. */
const uncoveredPermissions = (pairs: [ModuleManifest, readonly McpToolDefinition[]][]) =>
  pairs.flatMap(([manifest, tools]) =>
    manifest.permissions
      .filter((key) => !WITHOUT_MCP.has(key) && !tools.some((tool) => tool.description.includes(key)))
      .map((key) => `${manifest.key}: ${key}`),
  );

const jsonSchema = (tool: McpToolDefinition) => {
  const schema = z.toJSONSchema(tool.inputSchema, { io: 'input' }) as {
    properties?: Record<string, unknown>;
    additionalProperties?: unknown;
    oneOf?: Array<{ properties?: Record<string, unknown>; additionalProperties?: unknown }>;
  };
  if (schema.oneOf) {
    const combined = Object.assign({}, ...schema.oneOf.map((s) => s.properties ?? {}));
    return { ...schema, properties: combined };
  }
  return schema;
};

describe('registered mcp tools', () => {
  it('names the arguments of every tool that takes some', () => {
    const takesArguments = registeredTools.filter((tool) => tool.handler.length > 2);
    expect(takesArguments.length).toBeGreaterThan(20);
    const silent = takesArguments.filter((tool) => Object.keys(jsonSchema(tool).properties ?? {}).length === 0).map((tool) => tool.name);
    expect(silent).toEqual([]);
  });

  it('accepts nothing beyond the named arguments', () => {
    const open = registeredTools
      .filter((tool) => {
        const schema = jsonSchema(tool) as { additionalProperties?: unknown; oneOf?: Array<{ additionalProperties?: unknown }> };
        if (schema.oneOf) {
          return schema.oneOf.some((branch) => (branch.additionalProperties ?? false) !== false);
        }
        return (schema.additionalProperties ?? false) !== false;
      })
      .map((tool) => tool.name);
    expect(open).toEqual([]);
  });

  it('offers a tool for every permission a module defines', () => {
    expect(uncoveredPermissions(modulesWithTools)).toEqual([]);
  });

  /**
   * Eine Werkzeugbeschreibung geht an einen Agenten, nicht an ein
   * Vereinsmitglied: Sie läuft nicht über `messages/de.json` und ist damit
   * Code — also Englisch (AGENTS.md, Prinzip 7).
   */
  it('describes every tool in English, like the rest of the code', () => {
    const german = /[äöüßÄÖÜ]|\b(der|die|das|und|oder|nicht|über|eine|einen|Sie|wird|werden)\b/;
    const offenders = registeredTools.filter((tool) => german.test(tool.description)).map((tool) => tool.name);
    expect(offenders).toEqual([]);
  });

  /**
   * `contacts_delete` fehlt bewusst. Das unwiederbringliche Löschen
   * personenbezogener Daten soll einen Menschen vor einem Bildschirm haben, der
   * zeigt, was gleich verschwindet. Ein Agent, der eine Fälligkeitsliste falsch
   * liest, löscht sonst dreißig Spender. Die Fälligkeitsliste selbst ist über
   * `contacts_due` lesbar — nur das Ausführen bleibt der Oberfläche vorbehalten.
   */
  it('offers no tool that deletes a contact', () => {
    expect(registeredTools.map((tool) => tool.name)).not.toContain('contacts_delete');
    expect(registeredTools.some((tool) => tool.name === 'contacts_due')).toBe(true);
  });

  /**
   * `dms_delete_document` fehlt bewusst. Eine Löschung nach Fristablauf
   * bestätigt ein Mensch am Fristenbildschirm (Entscheidung 10).
   */
  it('offers no tool that deletes a document', () => {
    expect(registeredTools.map((tool) => tool.name)).not.toContain('dms_delete_document');
  });

  // Beweist, dass die Prüfung oben greift: ein erfundenes Modul, das seine
  // Rechte nicht über MCP anbietet, muss auffallen — sonst ist der grüne Test
  // darüber wertlos.
  it('names a module that brings a permission without a tool', () => {
    const newcomer: ModuleManifest = { key: 'members', version: '1', permissions: ['members.manage'] };
    expect(uncoveredPermissions([[newcomer, []]])).toEqual(['members: members.manage']);
    const withTool = [{ description: 'Create a member. Requires members.manage.' }] as unknown as McpToolDefinition[];
    expect(uncoveredPermissions([[newcomer, withTool]])).toEqual([]);
  });

  /**
   * Wer mehrsprachige Felder anbietet, muss sie auch übersetzen lassen: Die
   * Werkzeuge tragen die echten Zod-Schemata der Services, und `localizedText`
   * hinterlässt darin `localized: true`. Ein Modul mit Treffer ohne beide Haken
   * fiele aus `translations_list_gaps` still heraus.
   */
  const carriesLocalized = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') return false;
    if ((node as { localized?: unknown }).localized === true) return true;
    return Object.values(node as Record<string, unknown>).some(carriesLocalized);
  };
  const toolsOf = (m: ModuleManifest): readonly McpToolDefinition[] =>
    m.key === 'site' ? siteToolsWithTemplate().filter((t) => t.name.startsWith('site_')) : moduleMcpTools(deps, m);

  it('every module whose tools carry localized fields offers both translation hooks', () => {
    const localized = installedModules.filter((m) => toolsOf(m).some((tool) => carriesLocalized(z.toJSONSchema(tool.inputSchema, { io: 'input' }))));
    expect(localized.map((m) => m.key).sort()).toEqual(['animals', 'projects', 'site']);
    const missing = localized.filter((m) => !m.translatables || !m.setTranslations).map((m) => m.key);
    expect(missing).toEqual([]);
  });

  it('every update tool with localized fields points at translations_set for single locales', () => {
    const updaters = registeredTools.concat(siteToolsWithTemplate()).filter((tool) => /_update$|^site_variables_set$|^animals_set_story$/.test(tool.name));
    const withLocalized = updaters.filter((tool) => carriesLocalized(z.toJSONSchema(tool.inputSchema, { io: 'input' })));
    // `site_variables_set` nimmt Werte generisch entgegen (`z.record(string, unknown())`),
    // weil sich die echte Form erst aus dem eingelesenen Template ergibt — sein
    // Schema zeigt deshalb nie `localized: true`. Den Hinweis trägt es trotzdem
    // (Step 3), nur greift die Prüfung unten dafür nicht.
    expect(withLocalized.map((t) => t.name)).toEqual(expect.arrayContaining(['animals_update', 'animals_set_story', 'project_update', 'site_notes_update']));
    const silent = withLocalized.filter((tool) => !tool.description.includes('translations_set')).map((t) => t.name);
    expect(silent).toEqual([]);
  });
});

/**
 * Was ein Service ist, entscheidet die Signatur, nicht eine Liste: eine
 * exportierte Funktion, deren erste zwei Parameter `deps` und `ctx` heißen.
 * Jede muss von einem Werkzeug als `service` genannt werden — sonst ist sie
 * über MCP unerreichbar, und Prinzip 8 („ein Weg zu den Daten“) ist verletzt.
 *
 * Der Kern war bis zum 2026-09-15 ausgenommen, mit der Begründung, eine
 * Ausnahmeliste wäre länger als die Werkzeugliste. Nachgezählt: 22 von 60
 * Kern-Diensten hatten kein Werkzeug, die Liste wäre also kürzer gewesen — und
 * darunter waren Lücken, die niemand entschieden hatte. `README.md` verspricht
 * „Alles, was die Oberfläche kann, kann auch ein KI-Assistent über MCP“; ein
 * Wächter, der den Kern auslässt, kann das nicht halten.
 */
const SERVICE_SIGNATURE = /^(?:async\s+)?function\s+\w+\s*\(\s*deps\s*,\s*ctx\b/;

/** Wie `McpToolDefinition.service` eine Funktion beschreibt. */
type ServiceFn = (...args: never[]) => unknown;

/** Services, die bewusst ohne Werkzeug bleiben — jeder mit Grund. */
const WITHOUT_TOOL: Record<string, string> = {
  'dms.deleteDocument': 'Löschung nach Fristablauf bestätigt ein Mensch (Entscheidung 10).',
  'dms.previewDraft': 'Liefert Bytes; ein Agent liest den Volltext (Entscheidung 39).',
  'dms.getDocument': 'Liefert Bytes; dms_get ruft getDocumentRecord.',
  'dms.extractDocumentText': 'Innenleben des Workers; dms_reindex stößt es an.',
  'dms.previewNextNumber': 'Ein Hinweis in der Oberfläche, kein Vorgang.',
  'dms.countUnreadDocuments': 'Ein Zähler für die Verwaltungsseite.',
  'dms.countDocumentsByFolder': 'Die Zahlen neben den Ordnern; die Liste selbst ist dms_list.',
  'dms.seedDms': 'Beispieldaten der Entwicklung; laufen über seedDevelopment, nie über MCP.',
  'dms.issueGeneratedDocument': 'Baustein für Module: nimmt einen Callback und stellt unter dem Recht der Vorlage aus; das Werkzeug ist der Dienst des Moduls (z. B. Bestätigung ausstellen).',
  'dms.readLinkedDocument': 'Liefert Bytes, und nur über die Seiten des Moduls, dem der Vorgang gehört.',
  'dms.receiveGeneratedUpload': 'Baustein für Module: nimmt einen Callback; das Werkzeug ist der Dienst des Moduls (z. B. Auslage einreichen).',
  'dms.storeIncoming': 'Innenleben von dms_receive und receiveGeneratedUpload.',
  'dms.requireDmsGate': 'Rechteprüfung für die Seiten der Akte, kein Dienst.',
  'contacts.deleteContact': 'Löschung personenbezogener Daten bestätigt ein Mensch.',
  'contacts.seedContacts': 'Beispieldaten der Entwicklung.',
  'animals.seedAnimals': 'Beispieldaten der Entwicklung.',
  'projects.seedProjects': 'Beispieldaten der Entwicklung.',
  'site.applySeed': 'Beispielinhalte des Templates; ein Mensch bestätigt sie in der Oberfläche.',
  'site.previewTemplateSync': 'Derselbe Vorgang wie site_template_sync ohne confirm; das Werkzeug nennt den anwendenden Zweig.',
  'site.recordPublish': 'Innenleben von site_publish: schreibt den Verlaufseintrag, den der Lauf erzeugt.',

  // Kern. Seit dem 2026-09-15 mitgeprüft; was hier steht, ist entschieden.
  'core.buildContext': 'Baut den Aufrufkontext; kein Vorgang, sondern seine Voraussetzung.',
  'core.prepare': 'Innenleben des Dokument-Renderings; documents_render ruft es.',
  'core.exportDocument': 'Liefert Bytes; ein Agent liest den Datensatz.',
  'core.exportBackup': 'Ein Archiv von hunderten Megabyte durch JSON-RPC zu reichen, hilft niemandem.',
  'core.importBackup': 'Ersetzt die Datenbank als Datei — das bestätigt ein Mensch vor sich, nicht ein Agent für ihn.',
  'core.getMediaPreview': 'Liefert Bytes einer Vorschau.',
  'core.storeMediaInternal': 'Innenleben; media_upload ist der Weg von außen.',
  'core.storeMediaAssetDetailed': 'Dieselbe Ablage wie media_upload, mit mehr Rückgabe für die Oberfläche.',
  'core.changeOwnPassword': 'Das eigene Passwort ändert man dort, wo man sich anmeldet. Ein API-Token, das Passwörter setzen darf, wäre ein zweiter Anmeldeweg.',
  'core.createApiToken': 'Ein Token, das Token ausstellt, hebelt die Rechtevergabe aus: Wer eines hat, verschafft sich beliebig weitere.',
  'core.revokeApiToken': 'Gegenstück zu createApiToken — Token verwaltet man in der Oberfläche.',
  'core.listApiTokens': 'Ebenso: Die Liste der eigenen Token gehört zur Kontoverwaltung.',
  'core.listDueFollowUps': 'followups_list_due ruft listDueFollowUpsWithTargets — dieselbe Liste, dazu wohin jede Wiedervorlage zeigt.',
  'core.deleteUnreferencedMedia': 'Innenleben der Löschfunktionen; erreichbar über deren Schalter deleteOrphanedMedia, ruft sich nicht selbst über MCP.',
  'core.requireHumanChannel': 'Prüft den Aufrufkanal; Helfer für Dienste, kein eigener Vorgang.',
  'core.resolveRecordLabel': 'Hakenverteiler für Datensatzbeschriftungen, kein eigener Dienst.',
  'core.withTarget': 'Reichert Wiedervorlagen mit Zielbeschriftung an; Innenleben von listDueFollowUpsWithTargets.',
};

const servicesOf = (moduleKey: string, pkg: Record<string, unknown>) =>
  Object.entries(pkg)
    .filter(([, value]) => typeof value === 'function' && SERVICE_SIGNATURE.test(String(value)))
    .map(([name, fn]) => ({ key: `${moduleKey}.${name}`, fn: fn as ServiceFn }));

/**
 * Die Werkzeuge einer Sammlung entstehen erst, wenn ein Template eingelesen
 * ist — ohne eins nennt `site` seine Eintrags-Services nicht, und der Test
 * hielte sie für unerreichbar. Deshalb eine zweite Registry mit Template.
 */
function siteToolsWithTemplate(): readonly McpToolDefinition[] {
  const deps = createTestDeps({ manifests: [coreModule, ...installedModules], locales: ['de'] });
  deps.db
    .insert(sitePkg.siteTemplateState)
    .values({
      id: 'current',
      name: 'T',
      schemaJson: {
        name: 'T',
        locales: ['de'],
        uses: [],
        variables: {},
        collections: { notes: { label: 'Notizen', slug: true, sortable: true, publishable: true, fields: { body: { widget: 'localized', type: 'object' } } } },
      },
      checksum: 'a'.repeat(64),
      readAt: 't',
      readByUserId: null,
    })
    .run();
  return installedModules.flatMap((m) => [...moduleMcpTools(deps, m)]);
}

describe('every service has a tool', () => {
  const packages: [string, Record<string, unknown>][] = [
    ['contacts', contactsPkg],
    ['animals', animalsPkg],
    ['site', sitePkg],
    ['dms', dmsPkg],
    ['projects', projectsPkg],
    ['core', corePkg],
  ];
  const named = new Set(
    [...registeredTools, ...siteToolsWithTemplate(), ...coreMcpTools]
      .map((tool) => tool.service)
      .filter((s): s is ServiceFn => typeof s === 'function'),
  );

  it('names every module service from a tool, or explains why not', () => {
    const uncovered = packages.flatMap(([moduleKey, pkg]) =>
      servicesOf(moduleKey, pkg).filter(({ key, fn }) => !named.has(fn) && !(key in WITHOUT_TOOL)).map(({ key }) => key),
    );
    expect(uncovered).toEqual([]);
  });

  it('keeps the exception list honest: every listed service exists and has no tool', () => {
    const all = new Map(packages.flatMap(([moduleKey, pkg]) => servicesOf(moduleKey, pkg).map(({ key, fn }) => [key, fn] as const)));
    for (const key of Object.keys(WITHOUT_TOOL)) {
      expect(all.has(key), `${key} gibt es nicht mehr`).toBe(true);
      expect(named.has(all.get(key)!), `${key} hat inzwischen ein Werkzeug — aus der Liste nehmen`).toBe(false);
    }
  });

  it('finds a module service without a tool', () => {
    const fake = { orphan: async function orphan(deps: never, ctx: never) { void deps; void ctx; } };
    expect(servicesOf('fake', fake).map((s) => s.key)).toEqual(['fake.orphan']);
  });
});
