import { readSetting, schema, writeSettingInternal } from '@kompass/core';
import { insertUser, systemContext } from '@kompass/core/testing';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { AUDIT_FIELDS, financeAudit } from '../src/audit';
import { installFinance } from '../src/install';
import { financeModule } from '../src/manifest';
import { seedFinance } from '../src/seed';
import { setupFinance } from './helpers';

const SRC = path.resolve(import.meta.dirname, '../src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });

/** Feldnamen, die eine Person, einen Freitext oder eine Bankverbindung tragen könnten — für `after`/`before` und `params`. */
const PERSONAL_FIELD = /name|label|title|description|note|text|reason|iban|bic|holder|purposeLine|contact|subject|email/i;

/** Werte für den Satz, deren Name nach Person klingt, die aber nur einen Schalter oder Code tragen — mit Grund. */
const PARAMS_NOT_PERSONAL: Record<string, string> = {
  withContact: 'Ein Schalter (ob ein Kontakt hängt), nie der Kontakt selbst.',
  reason: 'Beim Mandatsende der Code aus MANDATE_END_REASONS (debtor, creditor, superseded, returned), kein Freitext.',
};

/**
 * Das Protokoll der Finanzen ohne Personen und Freitext — einmal zentral, statt je Dienst (Testdurchsicht 2026-10-22,
 * Plan P4 Task 1). `after`/`before` schützt die Weißliste `AUDIT_FIELDS`; was in `params` geht, prüft der Katalog
 * `auditActions` nach Namen und der Seed-Lauf nach Werten: Jeder Freitext und jede Kontakt-ID, die der Seed in eine
 * Finanztabelle, in `contacts` oder in eine Einstellung schreibt, steht in keinem `finance.*`-Eintrag.
 */
describe('finance audit log over the whole seed', () => {
  let deps: ReturnType<typeof setupFinance>['deps'];
  beforeAll(async () => {
    // Mit Jonas (Kernseed) und Vereinsanschrift läuft der Seed alle Wege, auch Auslagen und Anspruchsgrundlage.
    const setup = setupFinance();
    deps = setup.deps;
    insertUser(deps, { name: 'Jonas Feld', email: 'jonas@kompass.local' });
    deps.db.transaction((tx) => {
      for (const [key, value] of [['organization.name', 'Musterverein e.V.'], ['organization.street', 'Vereinsweg 1'], ['organization.postalCode', '12345'], ['organization.city', 'Musterstadt']] as const) {
        writeSettingInternal(tx, deps, systemContext(), key, value);
      }
      installFinance(tx, deps, systemContext());
    });
    await seedFinance(deps, setup.ctx);
  }, 30_000);

  it('leaves no name, no IBAN, no free text and no contact id in the log — the log cannot be deleted', () => {
    // W4 (Architektur-Review A1): generisch statt einer festen Liste. Jeder Freitext, den der Seed in eine
    // Finanztabelle, in `contacts` oder in eine als `redact` markierte Einstellung schreibt, darf nirgends im
    // Protokoll stehen — auch nicht unter `entityType: 'setting'`.
    const texts = seededTexts(deps);
    expect(texts.size).toBeGreaterThan(100);
    // Geprüft wird, was Finanzen und Kontakte schreiben: jede `finance.*`- und `contacts.*`-Aktion und jede
    // Einstellung (Kontakte seit Befund 48 nur mit Feldnamen). Zwei Ausnahmen mit Grund: Die Akte führt ihr eigenes
    // Protokoll (Nummern), und die Einstellungen `organization.*` sind der Stamm des Vereins selbst — Hausbank, IBAN,
    // Finanzamt stehen auf jeder Zuwendungsbestätigung und tragen keinen Personenbezug.
    const entries = deps.db.select().from(schema.auditLog).all()
      .filter((e) => e.action.startsWith('finance.') || e.action.startsWith('contacts.') || e.entityType === 'setting')
      .filter((e) => !(e.entityType === 'setting' && e.entityId?.startsWith('organization.')));
    expect(entries.some((e) => e.entityType === 'setting')).toBe(true);
    expect(entries.filter((e) => e.action.startsWith('finance.') && e.params !== null).length).toBeGreaterThan(20);
    const log = JSON.stringify(entries.map((e) => [e.before, e.after, e.params]));
    // Ausnahmen, je mit Grund: Wörter, die zugleich fester Wortlaut einer Protokoll-Zusammenfassung sind.
    const allowed = new Set([
      'Aufwandsspenden', // Kategorie des Startplans; die Zusammenfassung „Anspruchsgrundlage für Aufwandsspenden gesetzt“ ist Code.
      'DE98ZZZ09999999999', // Gläubiger-ID des Vereins (L1): wie `organization.*` der Stamm des Vereins, kein Personenbezug.
      'AM04', // Rückgabe-Code der Bank (L3): ein Code des SEPA-Regelwerks, kein Freitext und kein Personenbezug.
      'MD06', // ebenso.
    ]);
    // Ganze Wörter: „Post“ (Versandweg) steckt in „Posten“, ist aber nicht dasselbe.
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const occurs = (text: string) => [text, JSON.stringify(text).slice(1, -1)].some((t) => new RegExp(`(?<![\\p{L}\\d])${escape(t)}(?![\\p{L}\\d])`, 'u').test(log));
    const leaked = [...texts].filter((text) => !allowed.has(text) && occurs(text));
    expect(leaked).toEqual([]);
    // Kontakt-IDs sind ULIDs und fallen oben als Code heraus: eigens geprüft, über alle Finanzeinträge.
    const financeLog = JSON.stringify(entries.filter((e) => e.action.startsWith('finance.')));
    const contactIds = (deps.sqlite.prepare('SELECT id FROM contacts').all() as { id: string }[]).map((c) => c.id);
    expect(contactIds.length).toBeGreaterThan(5);
    expect(contactIds.filter((id) => financeLog.includes(id))).toEqual([]);
  });
});

/**
 * Die Freitexte, die ein Seed hinterlassen hat: alle Zeichenketten (auch in JSON-Spalten) aus den Tabellen
 * `finance_*` und `contacts` sowie die Werte der Einstellungen außer dem Vereinsstamm. Codes, Schlüssel,
 * IDs, Zeitstempel und Hashes sind keine Freitexte und bleiben draußen: Was ein Freitext ist, beginnt mit einem
 * Großbuchstaben oder enthält ein Leerzeichen.
 */
function seededTexts(deps: ReturnType<typeof setupFinance>['deps']): Set<string> {
  const out = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.startsWith('{') || value.startsWith('[')) {
        try {
          collect(JSON.parse(value));
          return;
        } catch {
          /* kein JSON — als Text weiter */
        }
      }
      const text = value.trim();
      if (text.length < 4) return;
      if (/^[0-9A-HJKMNP-TV-Z]{26}$/.test(text)) return; // ULID
      if (/^\d{4}-\d{2}-\d{2}/.test(text)) return; // Datum, Zeitstempel
      if (/^[A-Z]{1,5}-\d{4}-\d+$/.test(text)) return; // Belegnummer — „Nummer statt Betreff“ (AGENTS.md, Prinzip 3)
      if (/^MND-\d+$/.test(text)) return; // Mandatsreferenz — die Finanzen nennen sie wie eine Nummer (Plan L1)
      if (!/\s/.test(text) && !/^\p{Lu}/u.test(text)) return; // Code, Schlüssel, Hash
      out.add(text);
    } else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  const tables = deps.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'finance\\_%' ESCAPE '\\' OR name = 'contacts')")
    .all() as { name: string }[];
  expect(tables.length).toBeGreaterThan(20);
  for (const { name } of tables) for (const row of deps.sqlite.prepare(`SELECT * FROM "${name}"`).all()) collect(row);
  // Jede gespeicherte Einstellung außer dem Vereinsstamm — so fällt auch ein Freitext auf, dem das Kennzeichen
  // `auditValue: 'redact'` noch fehlt.
  for (const def of deps.registry.settingDefinitions.values()) if (!def.key.startsWith('organization.')) collect(readSetting(deps, def.key));
  return out;
}

describe('financeAudit', () => {
  it('writes only whitelisted fields — a name or an IBAN never reaches the log', () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => financeAudit(tx, deps, ctx, { action: 'finance.account.create', entity: 'financeAccount', id: 'A1', after: { kind: 'bank', isMain: true, name: 'Sparkasse Musterstadt', iban: 'DE23999999990000202051', openingBalanceCents: 5000 } }));
    const entry = deps.db.select().from(schema.auditLog).all().at(-1)!;
    expect(JSON.parse(entry.after as string)).toEqual({ kind: 'bank', isMain: true, openingBalanceCents: 5000 });
    expect(`${entry.after}${entry.params}`).not.toMatch(/Sparkasse|DE02/);
    expect(entry).toMatchObject({ action: 'finance.account.create', entityType: 'financeAccount', entityId: 'A1' });
  });

  it('stores params, and throws on a param that names a contact (Spec 10.3, Plan Protokoll Task 7)', () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => financeAudit(tx, deps, ctx, { action: 'finance.entry.finalize', entity: 'financeEntry', id: 'E1', params: { number: '2026-0012' } }));
    expect(deps.db.select().from(schema.auditLog).all().at(-1)).toMatchObject({ action: 'finance.entry.finalize', params: '{"number":"2026-0012"}' });
    expect(() => deps.db.transaction((tx) => financeAudit(tx, deps, ctx, { action: 'finance.entry.finalize', entity: 'financeEntry', id: 'E1', params: { contactId: 'C1' } }))).toThrow(/contactId names a contact/);
    expect(() => deps.db.transaction((tx) => financeAudit(tx, deps, ctx, { action: 'finance.entry.finalize', entity: 'financeEntry', id: 'E1', params: { recipientContactId: 'C1' } }))).toThrow(/names a contact/);
  });

  it('declares no param whose name could carry a person, free text or a bank detail', () => {
    const offenders = Object.entries(financeModule.auditActions ?? {}).flatMap(([action, def]) => def.params.filter((p) => PERSONAL_FIELD.test(p) && !(p in PARAMS_NOT_PERSONAL)).map((p) => `${action}: ${p}`));
    expect(offenders).toEqual([]);
    const declared = new Set(Object.values(financeModule.auditActions ?? {}).flatMap((def) => def.params));
    expect(Object.keys(PARAMS_NOT_PERSONAL).filter((p) => !declared.has(p)), 'nicht mehr deklariert — aus der Liste nehmen').toEqual([]);
  });

  it('never lists a field that could carry a person, free text or a bank detail', () => {
    const offenders = Object.entries(AUDIT_FIELDS).flatMap(([entity, fields]) => fields.filter((f) => PERSONAL_FIELD.test(f)).map((f) => `${entity}.${f}`));
    expect(offenders).toEqual([]);
  });

  it('is the only place in the module that imports recordAudit', () => {
    const offenders = files(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith(`${path.sep}audit.ts`)).filter((f) => /\brecordAudit\b/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
