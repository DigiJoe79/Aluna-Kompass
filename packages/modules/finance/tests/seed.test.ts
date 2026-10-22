import { todayIn, unwrap, writeSettingInternal } from '@kompass/core';
import { ctxWith, insertUser, systemContext } from '@kompass/core/testing';
import { documents as dmsDocuments } from '@kompass/module-dms';
import { createProject } from '@kompass/module-projects';
import { beforeAll, describe, expect, it } from 'vitest';
import { listConfirmations } from '../src/donations/confirmations';
import { listNotices } from '../src/donations/notices';
import { installFinance } from '../src/install';
import { listAccounts } from '../src/ledger/accounts';
import { getBalances } from '../src/ledger/overview';
import { listPurposes } from '../src/ledger/purposes';
import { seedFinance } from '../src/seed';
import { seedStoryYear } from '../src/seed-calendar';
import { setupFinance } from './helpers';

/**
 * Der Finanz-Seed als Struktur (Testdurchsicht 2026-10-22, Plan P4 Task 5): ein Lauf, danach Invarianten —
 * erfundene Bankdaten, Stichjahr, jeder wichtige Zustand vertreten, jeder Bezug zeigt auf etwas, das es gibt.
 * Bestimmte Personen, Belege und Kacheln, die nur ein E2E-Bild trägt, sichert das E2E selbst; Idempotenz und „nichts
 * in der Zukunft“ prüft `apps/kompass/tests/seed-calendar.test.ts` über den ganzen Seed an Stichtagen, das Protokoll
 * ohne Namen `audit.test.ts`. Gesät wird wie im echten Seed: mit Vereinsanschrift, Jonas Feld und Mira Klein aus dem
 * Kernseed und dem Projekt „winterhilfe“.
 */
describe('seedFinance', () => {
  let f: ReturnType<typeof setupFinance>;
  const rows = <T,>(sql: string) => f.deps.sqlite.prepare(sql).all() as T[];

  beforeAll(async () => {
    f = setupFinance();
    insertUser(f.deps, { name: 'Jonas Feld', email: 'jonas@kompass.local' });
    insertUser(f.deps, { name: 'Mira Klein', email: 'mira@kompass.local' });
    f.deps.db.transaction((tx) => {
      for (const [key, value] of [['organization.name', 'Musterverein e.V.'], ['organization.street', 'Vereinsweg 1'], ['organization.postalCode', '12345'], ['organization.city', 'Musterstadt']] as const) {
        writeSettingInternal(tx, f.deps, systemContext(), key, value);
      }
      installFinance(tx, f.deps, systemContext());
    });
    unwrap(await createProject(f.deps, ctxWith(['projects.manage', 'projects.view'], f.userId), { slug: 'winterhilfe', name: { de: 'Winterhilfe' }, type: 'ongoing', summary: { de: 'Kurz' }, body: { de: 'Text' } }));
    await seedFinance(f.deps, f.ctx);
  }, 30_000);

  it('carries no real bank code — only the invented DE (99999999/00000000) and AT (99999/00000) ones', async () => {
    const ibans = unwrap(await listAccounts(f.deps, f.ctx, { includeInactive: true })).map((a) => a.iban).filter((iban): iban is string => iban !== null);
    expect(ibans.length).toBeGreaterThan(0);
    for (const iban of ibans) {
      if (iban.startsWith('DE')) expect(['99999999', '00000000'], iban).toContain(iban.slice(4, 12));
      else if (iban.startsWith('AT')) expect(['99999', '00000'], iban).toContain(iban.slice(4, 9));
      else throw new Error(`unerwartetes IBAN-Länderkennzeichen: ${iban}`);
    }
  });

  it('uses no animal and no association-specific wording', async () => {
    const all = JSON.stringify([unwrap(await listAccounts(f.deps, f.ctx, { includeInactive: true })), unwrap(await listPurposes(f.deps, f.ctx, { includeInactive: true }))]);
    expect(all).not.toMatch(/tier|hund|katze|aluna|futter/i);
  });

  it('books in the story year and the year before, and closes the year before', () => {
    const story = seedStoryYear(todayIn(f.deps));
    const years = rows<{ y: string }>('select distinct substr(entry_date, 1, 4) as y from finance_entries').map((r) => Number(r.y));
    expect(years.sort()).toEqual([story - 1, story]);
    const closed = rows<{ designation: string }>("select y.designation from finance_fiscal_years y join finance_period_events e on e.fiscal_year_id = y.id where e.kind = 'closed'");
    expect(closed.map((y) => y.designation)).toEqual([String(story - 1)]);
  });

  it('shows every important state at least once', async () => {
    const has = (sql: string, expected: unknown[]) => expect(rows<{ v: unknown }>(sql).map((r) => r.v), sql).toEqual(expect.arrayContaining(expected));
    const some = (sql: string) => expect(rows(sql).length, sql).toBeGreaterThan(0);
    has('select status as v from finance_entries', ['draft', 'final']);
    some('select id from finance_entries where reverses_entry_id is not null');
    has('select state as v from finance_allocation_corrections', ['applied', 'pending']);
    has("select case when failed_at is not null then 'failed' when discarded_at is not null then 'discarded' when finished_at is not null then 'finished' end as v from finance_import_runs", ['discarded', 'failed', 'finished']);
    has("select case when cancelled_at is not null then 'cancelled' else 'live' end as v from finance_open_items", ['cancelled', 'live']);
    has('select state as v from finance_expense_claims', ['approved', 'draft', 'rejected', 'submitted']);
    has('select state as v from finance_partner_payments', ['approved', 'draft', 'rejected', 'submitted']);
    has('select state as v from finance_purpose_transfers', ['approved', 'submitted']);
    has('select kind as v from finance_reserves', ['free', 'projectFunds', 'replacement']);
    has('select kind as v from finance_confirmations', ['collective', 'inKind', 'money']);
    has("select case when voided_at is not null then 'voided' when machine = 1 then 'machine' else 'signed' end as v from finance_confirmations", ['machine', 'signed', 'voided']);
    some('select id from finance_confirmation_runs where finished_at is not null');
    has("select case when superseded_on is not null then 'superseded' else 'valid' end as v from finance_notices", ['superseded', 'valid']);
    has("select case when ended_on is not null then 'ended' when signed_on is not null then 'active' else 'pending' end as v from finance_sepa_mandates", ['active', 'ended', 'pending']);
    some('select id from finance_pledges where paused_from is not null');
    has('select status as v from finance_direct_debit_runs', ['draft', 'submitted']);
    has('select status as v from finance_direct_debit_returns', ['open']);
    has('select kind as v from finance_accounts', ['bank', 'cash', 'paymentService']);
    const balances = unwrap(await getBalances(f.deps, f.ctx, {}));
    expect(balances.purposes.some((p) => p.negative), 'Zweck im Minus').toBe(true);
    expect(balances.purposes.some((p) => p.fulfilledWithRest), 'erfüllt mit Rest').toBe(true);
  });

  /** Jede Spalte `…contact_id`, `…document_id`, `…project_id`, `…user_id` einer Finanztabelle zeigt auf eine Zeile, die es gibt. */
  it('points every reference at a record that exists', () => {
    const targets: [RegExp, string][] = [[/(^|_)contact_id$/, 'contacts'], [/(^|_)document_id$/, 'documents'], [/(^|_)project_id$/, 'projects'], [/(^|_)user_id$/, 'users']];
    const tables = rows<{ name: string }>("select name from sqlite_master where type = 'table' and name like 'finance\\_%' escape '\\'").map((t) => t.name);
    const checked: string[] = [];
    const dangling = tables.flatMap((table) =>
      rows<{ name: string }>(`pragma table_info("${table}")`).flatMap(({ name: column }) => {
        const target = targets.find(([pattern]) => pattern.test(column))?.[1];
        if (!target) return [];
        checked.push(`${table}.${column}`);
        return rows<{ v: string }>(`select distinct "${column}" as v from "${table}" where "${column}" is not null and "${column}" <> 'system' and "${column}" not in (select id from "${target}")`).map((r) => `${table}.${column}: ${r.v}`);
      }),
    );
    expect(checked.length).toBeGreaterThan(50);
    expect(dangling).toEqual([]);
  });
});

describe('seedFinance without the core seed', () => {
  // Ohne Vereinsanschrift: dann stellt der Seed keine Bestätigung auf einen alten Bescheid aus, die ihr eigenes Datum trägt.
  it('files every finance document at its own date through the services — except the named ones (Joe, 2026-10-06; Plan 2b Task 7, 3m)', async () => {
    const { deps, ctx } = setupFinance();
    insertUser(deps, { name: 'Jonas Feld', email: 'jonas@kompass.local' });
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    await seedFinance(deps, ctx);
    const today = todayIn(deps);
    const docs = deps.db.select().from(dmsDocuments).all();
    const isException = (d: (typeof docs)[number]) => ['finance-confirmation', 'finance-confirmation-signed', 'finance-partner-evidence'].includes(d.typeKey) || d.subject.includes('Jugendfreizeit');
    const minutes = docs.filter((d) => d.typeKey === 'minutes' && !isException(d));
    expect(minutes.length).toBeGreaterThanOrEqual(8);
    expect(minutes.every((d) => d.documentDate! < today)).toBe(true);
    // Ablage am Tag des Dokuments, 10:00 UTC — so hat die verschobene Uhr sie angelegt.
    const late = docs.filter((d) => !isException(d) && !d.createdAt.startsWith(d.documentDate!));
    expect(late.map((d) => `${d.typeKey}: ${d.subject}`)).toEqual([]);
    // Die Ausnahmen liegen heute, mit Datum und Ablage zusammen.
    expect(docs.filter(isException).every((d) => d.documentDate === today && d.createdAt.startsWith(today))).toBe(true);
  });

  it('issues nothing without the address of the association — a module test without the core seed stays green', async () => {
    const { deps, ctx } = setupFinance();
    await seedFinance(deps, ctx);
    expect(unwrap(await listConfirmations(deps, ctx, { tab: 'issued' })).total).toBe(0);
    expect(unwrap(await listNotices(deps, ctx, {}))).toHaveLength(1);
    expect(unwrap(await listNotices(deps, ctx, { includeInactive: true }))).toHaveLength(2);
  });
});
