import { coreModule, moduleMcpTools, seedDevelopment, type CallContext, type McpToolDefinition, type ModuleManifest, type RecordLabelInput } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { siteTemplateState } from '@kompass/module-site';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { installedModules } from '@/modules';

/**
 * Was jedes Modul dem Kern zusagt, einmal für alle installierten Module geprüft (Testdurchsicht 2026-10-22, Plan P2).
 * Bis dahin schrieb jedes Modul dieselben Fälle für `recordLabels`, `translatables`/`setTranslations`, den Ladestand
 * und die MCP-Verdrahtung ab; ein neues Modul, das eine Zusage vergaß, fiel erst auf, wenn jemand die Kopie anlegte.
 * Die Datensätze kommen aus dem Entwicklungs-Seed (dazu ein Eintrag der Webseite, deren Sammlungen erst mit einem
 * Template entstehen); welche Datensatzarten ein Modul führt, sagt es selbst: Sein Haken antwortet nicht mit `null`.
 * Modul-Eigenes (Vorschläge, Story-Felder, Mitgliedsnummer) prüfen die Module weiter selbst.
 */

const USER = 'USER-CONTRACT';
const FOREIGN = '__contract_foreign__';
const UNKNOWN_ID = '__contract_missing__';

/** Eine Webseite mit einer Sammlung: Ohne Template führt `site` keine Einträge. */
const TEMPLATE = {
  name: 'T',
  locales: ['de', 'en'],
  uses: [],
  variables: {},
  collections: { notes: { label: 'Notizen', slug: false, sortable: true, publishable: true, fields: { body: { widget: 'localized', type: 'object' } } } },
};

async function seeded() {
  const deps = createTestDeps({ manifests: [coreModule, ...installedModules], env: 'development', locales: ['de', 'en'] });
  deps.db.insert(siteTemplateState).values({ id: 'current', name: 'T', schemaJson: TEMPLATE, checksum: 'a'.repeat(64), readAt: 't', readByUserId: null }).run();
  await seedDevelopment(deps);
  insertUser(deps, { id: USER });
  const all = ctxWith([...deps.registry.permissionKeys], USER);
  const create = toolsOf(deps, siteModuleOf()).find((t) => t.name === 'site_notes_create')!;
  const entry = await create.handler(deps, all, { body: { de: 'Notiz', en: '' } } as never);
  if (!entry.ok) throw new Error(`site entry: ${JSON.stringify(entry.error)}`);
  return deps;
}
type SeededDeps = Awaited<ReturnType<typeof seeded>>;

const siteModuleOf = () => installedModules.find((m) => m.key === 'site')!;
const toolsOf = (deps: SeededDeps | ReturnType<typeof createTestDeps>, m: ModuleManifest): readonly McpToolDefinition[] => moduleMcpTools(deps, m);
const allCtx = (deps: SeededDeps): CallContext => ctxWith([...deps.registry.permissionKeys], USER);
const noneCtx = (): CallContext => ctxWith([], USER);

/** Je Datensatzart des Protokolls die zuletzt genannten IDs — die Datensätze, an denen die Zusagen geprüft werden. */
function auditedIds(deps: SeededDeps, perType = 5): Map<string, string[]> {
  const rows = deps.sqlite.prepare('select entity_type as entityType, entity_id as entityId from audit_log where entity_id is not null order by occurred_at desc, id desc').all() as { entityType: string; entityId: string }[];
  const out = new Map<string, string[]>();
  for (const { entityType, entityId } of rows) {
    const ids = out.get(entityType) ?? [];
    if (ids.length < perType && !ids.includes(entityId)) ids.push(entityId);
    out.set(entityType, ids);
  }
  return out;
}

/** Die Datensatzarten, für die ein Modul seine Beschriftung liefert. */
const labelledTypes = (deps: SeededDeps, m: ModuleManifest, types: Iterable<string>) => [...types].filter((type) => m.recordLabels!(deps, allCtx(deps), type, UNKNOWN_ID) !== null);

/**
 * Datensatzarten, deren Name auch ohne Leserecht mitgeht — mit Grund. Der Vertrag verlangt sonst eine neutrale
 * Beschriftung ohne `name`. Gefunden vom Vertragstest am 2026-10-22, nicht geändert (Befund an Joe).
 */
const NAME_WITHOUT_PERMISSION: Record<string, string> = {
  financeFiscalYear: 'Die Bezeichnung des Geschäftsjahrs („2025“) ist keine Vereinsinterna; finance/ledger/record-labels.ts gibt sie bewusst mit.',
  financePeriodEvent: 'Beschriftet sich als sein Geschäftsjahr, siehe financeFiscalYear.',
  financeTaxPeriod: 'Beschriftet sich mit den Bezeichnungen seiner Geschäftsjahre („2023–2025“), siehe financeFiscalYear.',
  financeVatFiling: 'Beschriftet sich mit ihrem Umsatzsteuer-Zeitraum („2026-Q2“), wie financeTaxPeriod mit seinen Jahren.',
};

const labelText = (label: RecordLabelInput['label']) => (typeof label === 'string' ? label : '');

describe('module contracts', () => {
  let deps: SeededDeps;
  let audited: Map<string, string[]>;
  beforeAll(async () => {
    deps = await seeded();
    audited = auditedIds(deps);
  }, 30_000);

  const withLabels = installedModules.filter((m) => m.recordLabels);
  const withTranslations = installedModules.filter((m) => m.translatables);

  describe.each(withLabels.map((m) => [m.key, m] as const))('recordLabels of %s', (_key, m) => {
    it('labels at least one kind of record the seed creates', () => {
      expect(labelledTypes(deps, m, audited.keys())).not.toEqual([]);
    });

    it('answers null for a kind of record another module owns', () => {
      const foreign = withLabels.filter((other) => other !== m).flatMap((other) => labelledTypes(deps, other, audited.keys()));
      const claimed = [FOREIGN, ...foreign].filter((type) => m.recordLabels!(deps, allCtx(deps), type, UNKNOWN_ID) !== null);
      expect(claimed).toEqual([]);
    });

    it('labels a record for a reader, neutrally for anyone else, and says missing for an unknown id', () => {
      for (const type of labelledTypes(deps, m, audited.keys())) {
        expect(m.recordLabels!(deps, allCtx(deps), type, UNKNOWN_ID), type).toMatchObject({ state: 'missing', href: null });
        const ids = audited.get(type)!;
        const readable = ids.map((id) => [id, m.recordLabels!(deps, allCtx(deps), type, id)!] as const).find(([, label]) => label.state === 'ok');
        expect(readable, `${type}: kein lesbarer Datensatz`).toBeDefined();
        const [id, ok] = readable!;
        expect(ok.label, type).toBeTruthy();
        const hidden = m.recordLabels!(deps, noneCtx(), type, id)!;
        expect(hidden, type).toMatchObject({ state: 'forbidden', href: null });
        if (type in NAME_WITHOUT_PERMISSION) continue;
        expect(hidden.name, type).toBeUndefined();
        if (labelText(ok.label)) expect(JSON.stringify(hidden.label), type).not.toContain(labelText(ok.label));
      }
    });
  });

  it('keeps the exception list honest: every listed kind is labelled and shows its name without permission', () => {
    for (const type of Object.keys(NAME_WITHOUT_PERMISSION)) {
      const owner = withLabels.find((m) => labelledTypes(deps, m, [type]).length > 0);
      expect(owner, `${type} beschriftet niemand mehr — aus der Liste nehmen`).toBeDefined();
      const shown = (audited.get(type) ?? []).some((id) => owner!.recordLabels!(deps, noneCtx(), type, id)?.name !== undefined);
      expect(shown, `${type} verbirgt seinen Namen inzwischen — aus der Liste nehmen`).toBe(true);
    }
  });

  it('wires translatables and setTranslations together', () => {
    const half = installedModules.filter((m) => !m.translatables !== !m.setTranslations).map((m) => m.key);
    expect(half).toEqual([]);
  });

  describe.each(withTranslations.map((m) => [m.key, m] as const))('translations of %s', (_key, m) => {
    const listed = () => {
      const result = m.translatables!(deps, allCtx(deps));
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      return result.value.filter((t) => Object.keys(t.fields).length > 0);
    };
    /** Je Datensatzart der erste Datensatz mit einem übersetzbaren Feld. */
    const samples = () => [...new Map(listed().map((t) => [t.entityType, t])).values()];

    it('lists something for a reader and nothing without its view permission', () => {
      expect(samples()).not.toEqual([]);
      const denied = m.translatables!(deps, noneCtx());
      expect(denied.ok === false && denied.error.type).toBe('forbidden');
    });

    it('answers null for a kind of record it does not translate', () => {
      const own = new Set(samples().map((t) => t.entityType));
      const foreign = withTranslations.filter((other) => other !== m).flatMap((other) => [...new Map((other.translatables!(deps, allCtx(deps)) as { value?: { entityType: string }[] }).value?.map((t) => [t.entityType, t]) ?? []).keys()]);
      const claimed = [FOREIGN, ...foreign].filter((type) => !own.has(type) && m.setTranslations!(deps, allCtx(deps), { entityType: type, id: UNKNOWN_ID, items: [] }) !== null);
      expect(claimed).toEqual([]);
    });

    it('refuses a writer without permission, an unknown id and an unknown field', async () => {
      for (const t of samples()) {
        const field = Object.keys(t.fields)[0]!;
        const text = Object.values(t.fields[field]!)[0]!;
        const write = (ctx: CallContext, id: string, f: string) => m.setTranslations!(deps, ctx, { entityType: t.entityType, id, items: [{ field: f, locale: 'en', text }] });
        expect(await write(noneCtx(), t.id, field), t.entityType).toMatchObject({ ok: false, error: { type: 'forbidden' } });
        expect(await write(allCtx(deps), UNKNOWN_ID, field), t.entityType).toMatchObject({ ok: false, error: { type: 'notFound' } });
        expect(await write(allCtx(deps), t.id, '__contract_field__'), t.entityType).toMatchObject({ ok: false, error: { type: 'notFound' } });
      }
    });
  });
});

/** Jede Vorgabe einer Einstellung muss ihr eigenes Schema bestehen — sonst liest jede Installation einen ungültigen Wert. */
describe('module settings', () => {
  it.each([coreModule, ...installedModules].map((m) => [m.key, m] as const))('%s: every default passes its schema', (_key, m) => {
    const invalid = (m.settings ?? []).filter((s) => !s.schema.safeParse(s.default).success).map((s) => s.key);
    expect(invalid).toEqual([]);
  });
});

/**
 * Die MCP-Verdrahtung: Jedes Werkzeug nennt den Dienst, den es ruft (sonst sähe der Paritätswächter in
 * `mcp-tools.test.ts` den Dienst nicht), und das Recht, das es verlangt — eines seines Moduls oder, wo ein Modul an
 * Kernbestand schreibt (Nutzerkonten, Einstellungen), eines des Kerns. Ohne Rechte aufgerufen antwortet es
 * `forbidden`: Die Rechteprüfung steht vor allem anderen (Prinzip 6, Ausweitung von `mcp-permissions.test.ts`).
 */
describe('module mcp tools', () => {
  let deps: SeededDeps;
  beforeAll(async () => {
    deps = await seeded();
  }, 30_000);

  it('name their service and a permission of their module or the core', () => {
    const offenders = installedModules.flatMap((m) =>
      toolsOf(deps, m)
        .filter((tool) => typeof tool.service !== 'function' || ![...m.permissions, ...coreModule.permissions].some((p) => tool.description.includes(p)))
        .map((tool) => `${m.key}: ${tool.name}`),
    );
    expect(offenders).toEqual([]);
  });

  it('answer forbidden to a caller without permissions', async () => {
    const leaky: string[] = [];
    for (const m of installedModules) {
      for (const tool of toolsOf(deps, m)) {
        const answer = await callWithoutPermissions(deps, tool);
        if (answer !== 'forbidden') leaky.push(`${tool.name}: ${answer}`);
      }
    }
    expect(leaky).toEqual([]);
  });
});

/**
 * Werkzeugnamen, die ein Agent außerhalb dieses Repos heute ruft — sie fallen nie weg, ohne dass er mitzieht. Sonst
 * pinnt kein Test Werkzeuglisten: Ob jedes Recht und jeder Dienst ein Werkzeug hat, prüft `mcp-tools.test.ts`.
 * Wer einen Namen hier ergänzt, nennt den Aufrufer.
 */
const CALLED_FROM_OUTSIDE: Record<string, string> = {
  animals_list: 'Hundeblicke-Sync (Vereinsrepo, Kompass/hundeblicke-sync)',
  animals_get: 'Hundeblicke-Sync',
  animals_create: 'Hundeblicke-Sync',
  animals_update: 'Hundeblicke-Sync',
  animals_proposal_submit: 'Hundeblicke-Sync',
  animals_proposal_image_stage: 'Hundeblicke-Sync',
  animals_proposal_withdraw: 'Hundeblicke-Sync',
  animals_proposals_status: 'Hundeblicke-Sync',
};

describe('tool names agents call', () => {
  it('keeps every name an outside agent calls', () => {
    const deps = createTestDeps({ manifests: [coreModule, ...installedModules] });
    const names = new Set(installedModules.flatMap((m) => toolsOf(deps, m).map((t) => t.name)));
    expect(Object.keys(CALLED_FROM_OUTSIDE).filter((name) => !names.has(name))).toEqual([]);
  });
});

/**
 * Leere Argumente zuerst; wirft das Werkzeug dabei (es dekodiert etwa Base64, bevor es den Dienst ruft — im Betrieb
 * legt das MCP-SDK die Schemaprüfung davor), dann eine Eingabe, die das Schema der Form nach erfüllt.
 */
async function callWithoutPermissions(deps: SeededDeps, tool: McpToolDefinition): Promise<string> {
  const attempt = async (input: unknown) => {
    try {
      const result = await tool.handler(deps, noneCtx(), input as never);
      return result.ok ? 'ok' : result.error.type;
    } catch (error) {
      return `throws ${String(error).slice(0, 80)}`;
    }
  };
  const first = await attempt({});
  return first === 'forbidden' ? first : attempt(sampleOf(z.toJSONSchema(tool.inputSchema, { io: 'input' }) as JsonSchema));
}

type JsonSchema = { type?: string | string[]; properties?: Record<string, JsonSchema>; required?: string[]; enum?: unknown[]; const?: unknown; oneOf?: JsonSchema[]; anyOf?: JsonSchema[]; items?: JsonSchema; minimum?: number };

/** Ein Wert, der der Form eines JSON Schemas genügt: nur Pflichtfelder, die erste Variante, leere Texte. */
function sampleOf(s: JsonSchema): unknown {
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum[0];
  const branch = s.oneOf?.[0] ?? s.anyOf?.[0];
  if (branch) return sampleOf(branch);
  const type = Array.isArray(s.type) ? s.type[0] : s.type;
  if (type === 'object') return Object.fromEntries((s.required ?? []).map((key) => [key, sampleOf(s.properties?.[key] ?? {})]));
  if (type === 'array') return [];
  if (type === 'string') return 'AA==';
  if (type === 'number' || type === 'integer') return s.minimum ?? 1;
  if (type === 'boolean') return false;
  return null;
}

/**
 * Ladestand (Backlog 20): Jedes Werkzeug, das `expectedVersion` annimmt, weist einen fremden Stand ab, statt still zu
 * überschreiben. Geprüft am Werkzeug, weil es den Dienst mit genau dieser Eingabe ruft: `{ id, expectedVersion }`.
 * Jede ID des Protokolls ist ein Kandidat, mindestens einer muss `staleVersion` ernten. Eigener Seed, weil ein
 * Werkzeug, das den Stand übergeht, schreibt.
 */
const STALE_NOT_PROBED: Record<string, string> = {
  site_variables_set: 'Kein Datensatz mit ID: Der Stand gilt für alle Variablen (site/tests/stale-version.test.ts).',
  animals_set_story: 'Verlangt die ganze Geschichte; modul-eigener Fall in animals/tests/stale-version.test.ts.',
  animals_proposal_resolve_delisted: 'Prüft den Stand erst bei einem Vorschlag im Zustand „nicht mehr gelistet“, den der Seed nicht führt. Lücke: Kein Test prüft hier den Ladestand (gemeldet 2026-10-22).',
  finance_entry_finalize: 'Prüft den Stand erst bei einem ausgeglichenen Entwurf, den der Seed nicht führt; Finanzen prüfen ihren Ladestand selbst (P4).',
  finance_expense_submit: 'Verlangt einen Antragsteller mit Kontaktverknüpfung vor dem Stand; Finanzen prüfen ihren Ladestand selbst (P4).',
  finance_master_data_set_active: 'Verlangt Art und Schalter; Finanzen prüfen ihren Ladestand selbst (P4).',
  finance_entry_save_draft: 'Verlangt eine vollständige Buchung; Finanzen prüfen ihren Ladestand selbst (P4).',
  finance_entry_review: 'Verlangt den Prüfschalter; Finanzen prüfen ihren Ladestand selbst (P4).',
  finance_entry_book: 'Verlangt eine vollständige Buchung; Finanzen prüfen ihren Ladestand selbst (P4).',
  finance_expense_draft_save: 'Verlangt Positionen; Finanzen prüfen ihren Ladestand selbst (P4).',
  finance_expense_approve: 'Verlangt Positionen; Finanzen prüfen ihren Ladestand selbst (P4).',
  finance_partner_payment_draft_save: 'Verlangt Positionen; Finanzen prüfen ihren Ladestand selbst (P4).',
  finance_reserve_save: 'Verlangt Art und Name; Finanzen prüfen ihren Ladestand selbst (P4).',
  finance_audit_auditor_save: 'Verlangt Jahr, Kontakt und Art; Finanzen prüfen ihren Ladestand selbst (auditing-auditors.test.ts).',
  finance_reserve_set_active: 'Verlangt den Schalter; Finanzen prüfen ihren Ladestand selbst (P4).',
  finance_reserve_carry_forward: 'Verlangt Betrag und Tag; Finanzen prüfen ihren Ladestand selbst (P4).',
  finance_other_asset_save: 'Verlangt Art, Bezeichnung, Wert, Grundlage und Beginn; Finanzen prüfen ihren Ladestand selbst (other-assets.test.ts).',
  finance_audit_report_examination_save: 'Verlangt reportId statt id; Finanzen prüfen ihren Ladestand je Karte selbst (auditing-report.test.ts, auditing-mcp-tools.test.ts).',
  finance_audit_report_result_save: 'Verlangt reportId statt id; Finanzen prüfen ihren Ladestand je Karte selbst (auditing-report.test.ts, auditing-mcp-tools.test.ts).',
  finance_audit_report_deviation_save: 'Verlangt reportId statt id; Finanzen prüfen ihren Ladestand je Karte selbst (auditing-report.test.ts, auditing-mcp-tools.test.ts).',
  finance_audit_report_signatures_save: 'Verlangt reportId statt id; Finanzen prüfen ihren Ladestand je Karte selbst (auditing-report.test.ts, auditing-mcp-tools.test.ts).',
  finance_handover_update: 'Verlangt id; offene Übergabe ohne Zwischenbericht — Finanzen prüfen ihren Ladestand selbst (closing-handover.test.ts).',
  finance_handover_items_save: 'Verlangt id und Punkte; Finanzen prüfen ihren Ladestand selbst (closing-handover.test.ts).',
  finance_assembly_result_save: 'Verlangt fiscalYearId statt id, Tag und Art der Entlastung; Finanzen prüfen ihren Ladestand selbst (closing-assembly.test.ts).',
  finance_tax_period_answers_save: 'Verlangt die Angaben; Finanzen prüfen ihren Ladestand selbst (tax-periods.test.ts).',
  finance_tax_period_notice_link: 'Verlangt den Bescheid; Finanzen prüfen ihren Ladestand selbst (tax-periods-filing.test.ts).',
};

const takesVersion = (tool: McpToolDefinition) => {
  const s = z.toJSONSchema(tool.inputSchema, { io: 'input' }) as JsonSchema;
  const props = s.properties ?? Object.assign({}, ...(s.oneOf ?? s.anyOf ?? []).map((b) => b.properties ?? {}));
  return 'expectedVersion' in props;
};

describe('expectedVersion', () => {
  let deps: SeededDeps;
  let versioned: McpToolDefinition[];
  let ids: string[];
  beforeAll(async () => {
    deps = await seeded();
    versioned = installedModules.flatMap((m) => toolsOf(deps, m)).filter(takesVersion);
    ids = [...auditedIds(deps, Infinity).values()].flat();
  }, 30_000);

  const refusesStale = async (tool: McpToolDefinition) => {
    for (const id of ids) {
      const result = await tool.handler(deps, allCtx(deps), { id, expectedVersion: 'contract-stale' } as never);
      if (!result.ok && result.error.type === 'conflict' && (result.error as { code?: string }).code === 'staleVersion') return true;
    }
    return false;
  };

  it('every tool that takes a version refuses a stale one', async () => {
    const ignoring: string[] = [];
    for (const tool of versioned.filter((t) => !(t.name in STALE_NOT_PROBED))) if (!(await refusesStale(tool))) ignoring.push(tool.name);
    expect(versioned.length).toBeGreaterThan(Object.keys(STALE_NOT_PROBED).length);
    expect(ignoring).toEqual([]);
  }, 60_000);

  it('keeps the exception list honest: every listed tool takes a version and escapes the probe', async () => {
    for (const name of Object.keys(STALE_NOT_PROBED)) {
      const tool = versioned.find((t) => t.name === name);
      expect(tool, `${name} nimmt keinen Ladestand mehr — aus der Liste nehmen`).toBeDefined();
      expect(await refusesStale(tool!), `${name} fängt die Probe inzwischen — aus der Liste nehmen`).toBe(false);
    }
  }, 60_000);
});
