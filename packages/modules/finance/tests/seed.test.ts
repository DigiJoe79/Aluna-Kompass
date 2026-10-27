import { todayIn, unwrap, writeSettingInternal } from '@kompass/core';
import { ctxWith, insertUser, systemContext } from '@kompass/core/testing';
import { documents as dmsDocuments } from '@kompass/module-dms';
import { createProject } from '@kompass/module-projects';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getAuditReport } from '../src/auditing/report';
import { listConfirmations } from '../src/donations/confirmations';
import { listNotices } from '../src/donations/notices';
import { toCorrectConfirmationsOfYearInternal } from '../src/donations/to-correct';
import { installFinance } from '../src/install';
import { getHandover, listHandovers } from '../src/closing/handover';
import { getClosingStatus } from '../src/closing/status';
import { listAccounts } from '../src/ledger/accounts';
import { previewPeriodReopen } from '../src/ledger/period';
import { accountStatementsForYearInternal } from '../src/ledger/statement-documents';
import { getBalances } from '../src/ledger/overview';
import { openItemsAtInternal } from '../src/ledger/open-items';
import { listPurposes } from '../src/ledger/purposes';
import { listReserves, saveReserve } from '../src/allocation/reserves';
import { textPdf } from '@kompass/module-dms';
import { declarationDueOn, listTaxPeriods, type TaxPeriodView } from '../src/ledger/tax-periods';
import { seedFinance } from '../src/seed';
import { listFinanceDeadlines } from '../src/closing/deadlines';
import { listVatPeriods } from '../src/ledger/vat-filings';
import { getContactTaxDetails } from '../src/allocation/contact-tax-details';
import { checkReverseCharge, decideReverseChargePrompt } from '../src/import/reverse-charge-check';
import { parseFacturX } from '../src/import/zugferd/parse';
import { buildInvoiceXml, FOREIGN_INVOICE } from '../src/import/zugferd-fixture';
import { vatProfileAt } from '../src/ledger/vat-settings';
import { nextWorkingDay } from '../src/ledger/working-days';
import { SEED_CLOSED_YEARS, seedStoryYear } from '../src/seed-calendar';
import type { CashReport } from '../src/reporting/reports/cash-report';
import { runFinanceReport } from '../src/reporting/service';
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

  it('books in the story year and the closed years before it, and closes those (SEED_CLOSED_YEARS)', () => {
    const story = seedStoryYear(todayIn(f.deps));
    const closedYears = Array.from({ length: SEED_CLOSED_YEARS }, (_, i) => story - SEED_CLOSED_YEARS + i);
    const years = rows<{ y: string }>('select distinct substr(entry_date, 1, 4) as y from finance_entries').map((r) => Number(r.y));
    expect(years.sort()).toEqual([...closedYears, story]);
    const closed = rows<{ designation: string }>("select y.designation from finance_fiscal_years y join finance_period_events e on e.fiscal_year_id = y.id where e.kind = 'closed' group by y.id order by y.starts_on");
    expect(closed.map((y) => y.designation)).toEqual(closedYears.map(String));
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

  // N19 (MCP-Nachttest 0.4.0): Eine Bestätigung geht erst nach ihrer Ausstellung hinaus und kommt erst danach zurück;
  // eine Rückgabe der Zahlung, die eine Bestätigung „zu korrigieren“ macht, liegt nach der Ausstellung.
  it('issues every confirmation before it is sent, returned or its payment comes back (N19)', () => {
    const early = rows<{ document_number: string }>(`select document_number from finance_confirmations where (sent_at is not null and substr(sent_at, 1, 10) < issued_on) or (original_returned_on is not null and original_returned_on < issued_on)`);
    expect(early).toEqual([]);
    const returnedBefore = rows<{ document_number: string }>(`
      select c.document_number from finance_confirmations c
      join finance_confirmation_lines cl on cl.confirmation_id = c.id
      join finance_allocation_lines back on back.origin_line_id = cl.line_id
      join finance_entries e on e.id = back.entry_id
      where e.status = 'final' and e.entry_date < c.issued_on`);
    expect(returnedBefore).toEqual([]);
  });

  it('names a counterparty at every open payment — the handover list says whom it is owed to (Befund 23e)', () => {
    const open = openItemsAtInternal(f.deps.db, todayIn(f.deps)).map((o) => o.id);
    expect(open.length).toBeGreaterThan(0);
    const withoutContact = rows<{ id: string; ref: string }>('select id, payment_reference as ref from finance_open_items where contact_id is null').filter((r) => open.includes(r.id)).map((r) => r.ref);
    expect(withoutContact).toEqual([]);
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

  it('closes every early year fully — cash only, paper audit, assembly, reports of the assembly (Plan seed-mehrjahre, Joe F4)', async () => {
    const story = seedStoryYear(todayIn(f.deps));
    const early = Array.from({ length: SEED_CLOSED_YEARS - 1 }, (_, i) => story - SEED_CLOSED_YEARS + i);
    expect(early.length).toBeGreaterThan(0);
    for (const y of early) {
      const year = rows<{ id: string }>(`select id from finance_fiscal_years where designation = '${y}'`)[0]!.id;
      // Bis zum Konto bei der Beispielbank lief alles bar: keine Geldzeile auf einem Bankkonto, also kein Auszug nötig.
      expect(rows<{ kind: string }>(`select distinct a.kind from finance_money_lines m join finance_entries e on e.id = m.entry_id join finance_accounts a on a.id = m.account_id where e.fiscal_year_id = '${year}'`).map((r) => r.kind)).toEqual(['cash']);
      const status = unwrap(await getClosingStatus(f.deps, f.ctx, { fiscalYearId: year }));
      expect({ y, open: status.steps.filter((s) => !s.done).map((s) => s.key) }).toEqual({ y, open: [] });
      expect(rows<{ state: string; mode: string }>(`select r.state, a.mode from finance_audit_reports r join finance_audit_auditors a on a.fiscal_year_id = r.fiscal_year_id where r.fiscal_year_id = '${year}'`)).toEqual([{ state: 'filed', mode: 'paper' }]);
      const finals = rows<{ report_key: string }>(`select report_key from finance_reports where fiscal_year_id = '${year}' and voided_at is null order by report_key`).map((r) => r.report_key);
      expect(finals).toEqual(expect.arrayContaining(['assetOverview', 'cashReport', 'incomeStatement', 'purposeFunds']));
      // Jedes Jahr nach dem ersten vergleicht sich in der EÜR mit seinem Vorjahr.
      const income = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'incomeStatement', params: { fiscalYearId: year } }));
      expect((income.data as { previous: { designation: string } | null }).previous?.designation ?? null).toBe(y === early[0] ? null : String(y - 1));
    }
    expect(early).toHaveLength(2);
    // Das mittlere Jahr lässt sich nicht wiederöffnen, solange ein späteres abgeschlossen ist (F5).
    const middle = rows<{ id: string }>(`select id from finance_fiscal_years where designation = '${story - 2}'`)[0]!.id;
    const blocked = unwrap(await previewPeriodReopen(f.deps, f.ctx, { id: middle }));
    expect(blocked.laterYearClosed).toBe(true);
    // Designer Runde 8, 17f: der Weg zum späteren Jahr, das zuerst wieder zu öffnen ist — das jüngste abgeschlossene.
    expect(blocked.laterYear).toMatchObject({ designation: String(story - 1) });
  });

  it('carries a correction found after the assembly of the year before the previous one into the previous year (Joe F4)', async () => {
    const story = seedStoryYear(todayIn(f.deps));
    const carry = rows<{ from: string; to: string; n: number }>(
      `select f.designation as "from", t.designation as "to", (select count(*) from finance_audit_carry_over_entries e where e.carry_over_id = c.id) as n from finance_audit_carry_overs c join finance_fiscal_years f on f.id = c.fiscal_year_id join finance_fiscal_years t on t.id = c.target_fiscal_year_id`,
    );
    expect(carry).toEqual([{ from: String(story - 2), to: String(story - 1), n: 1 }]);
    // Die vor dem Wiederöffnen festgeschriebenen Fassungen sind storniert, neue gelten.
    const year = rows<{ id: string }>(`select id from finance_fiscal_years where designation = '${story - 2}'`)[0]!.id;
    expect(rows<{ n: number }>(`select count(*) as n from finance_reports where fiscal_year_id = '${year}' and report_key = 'cashReport' and voided_at is not null`)[0]!.n).toBe(1);
  });

  it('shows the early years in the reports of the previous year: income statement with the year before, purpose funds with carry-forward', async () => {
    const story = seedStoryYear(todayIn(f.deps));
    const previous = rows<{ id: string }>(`select id from finance_fiscal_years where designation = '${story - 1}'`)[0]!.id;
    const income = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'incomeStatement', params: { fiscalYearId: previous } }));
    expect((income.data as { previous: { designation: string } | null }).previous?.designation).toBe(String(story - 2));
    const funds = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'purposeFunds', params: { fiscalYearId: previous } }));
    const dach = rows<{ id: string }>(`select id from finance_purposes where name = 'Dachsanierung Vereinsheim'`)[0]!.id;
    expect((funds.data as { purposes: { purposeId: string; carryForwardCents: number }[] }).purposes.find((p) => p.purposeId === dach)!.carryForwardCents).toBeGreaterThan(0);
  });

  it('saves for the transporter over the closed years (line 54) and builds the free reserve from the year before the previous one (Joe F2, F8)', async () => {
    const story = seedStoryYear(todayIn(f.deps));
    const filed = unwrap(await listTaxPeriods(f.deps, f.ctx, {})).find((p) => p.state === 'filed')!;
    const gem = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'taxReturnGem', params: { taxPeriodId: filed.id } }));
    const lines = (gem.data as { lines: { line: string; value: { kind: string; rows?: Record<string, unknown>[]; cents?: number } | null }[] }).lines;
    const line54 = lines.find((l) => l.line === '54')!.value!.rows!;
    expect(line54).toEqual([expect.objectContaining({ asset: 'Kleintransporter für Vereinsfahrten', allocatedCents: expect.any(Number), balanceCents: 40000 })]);
    expect(lines.find((l) => l.line === '58')!.value!.cents).toBeGreaterThan(0);
    const statement = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'reserveStatement', params: { fiscalYearIds: filed.fiscalYearIds } }));
    expect((statement.data as { reserves: { perYear: unknown[] }[] }).reserves.length).toBeGreaterThanOrEqual(2);
    // Im Stichjahr gekauft: aufgelöst, ohne weitere Zuführung.
    const moves = rows<{ kind: string; y: string }>(`select m.kind, substr(m.movement_date, 1, 4) as y from finance_reserve_movements m join finance_reserves r on r.id = m.reserve_id where r.name = 'Ersatz Transporter' order by m.movement_date`);
    expect(moves).toEqual([...[3, 2, 1].map((n) => ({ kind: 'allocate', y: String(story - n) })), { kind: 'dissolve', y: String(story) }]);
    // Eine freie Rücklage, Zuführungen für das Jahr vor dem Vorjahr und für das Stichjahr.
    expect(rows<{ n: number }>(`select count(*) as n from finance_reserves where kind = 'free'`)[0]!.n).toBe(1);
    expect(rows<{ y: string }>(`select y.designation as y from finance_reserve_movements m join finance_fiscal_years y on y.id = m.for_fiscal_year_id order by y.starts_on`).map((r) => r.y)).toEqual([String(story - 2), String(story)]);
  });

  it('Rechenschaft D1: audits the closed year before the cash report is finalized — Mira in Kompass with her own context, a paper auditor', async () => {
    const previous = String(seedStoryYear(todayIn(f.deps)) - 1);
    const year = rows<{ id: string }>(`select id from finance_fiscal_years where designation = '${previous}'`)[0]!.id;
    expect(rows<{ mode: string }>(`select mode from finance_audit_auditors where fiscal_year_id = '${year}' order by created_at, id`).map((r) => r.mode)).toEqual(['kompass', 'paper']);
    expect(rows<{ kind: string }>(`select kind from finance_audit_baselines where fiscal_year_id = '${year}'`).map((r) => r.kind)).toEqual(['initial']);
    const mira = rows<{ id: string }>(`select id from users where email = 'mira@kompass.local'`)[0]!.id;
    expect(rows<{ n: number }>(`select count(*) as n from finance_audit_samples where fiscal_year_id = '${year}'`)[0]!.n).toBe(3);
    expect(rows<{ state: string }>(`select distinct state from finance_audit_remarks where fiscal_year_id = '${year}' order by state`).map((r) => r.state)).toEqual(['answered', 'open', 'resolved']);
    expect(rows<{ n: number }>(`select count(*) as n from finance_audit_remarks where entered_by_user_id = '${mira}'`)[0]!.n).toBe(5);
    expect(rows<{ user_id: string }>(`select user_id from audit_log where action = 'finance.audit.remark.create'`).every((r) => r.user_id === mira)).toBe(true);
    expect(rows<{ n: number }>(`select count(*) as n from finance_cash_count_witnesses`)[0]!.n).toBe(2);
    expect(rows<{ state: string; origin: string }>(`select state, origin from finance_audit_reports where fiscal_year_id = '${year}'`)).toEqual([{ state: 'filed', origin: 'kompass' }]);
    expect(rows<{ n: number }>(`select count(*) as n from finance_audit_report_scans s join finance_audit_reports r on r.id = s.report_id where r.fiscal_year_id = '${year}'`)[0]!.n).toBe(1);
    expect(unwrap(await getAuditReport(f.deps, f.ctx, { fiscalYearId: year }))!.subject.cash?.witnessAuditorIds).toHaveLength(2);
    // Der Kassenbericht ist nach der Freigabe durch den Prüfbericht festgeschrieben.
    expect(rows<{ release_basis: string }>(`select release_basis from finance_reports where report_key = 'cashReport' and fiscal_year_id = '${year}' and voided_at is null`)).toEqual([{ release_basis: 'auditReport' }]);
    // Plan D1d Task 4 (Befund MCP 5): Der festgeschriebene Kassenbericht trägt den Datenstand der Prüffassung.
    const finalized = rows<{ data_hash: string }>(`select data_hash from finance_reports where report_key = 'cashReport' and fiscal_year_id = '${year}' and voided_at is null`)[0]!.data_hash;
    const baseline = JSON.parse(rows<{ report_refs: string }>(`select report_refs from finance_audit_baselines where fiscal_year_id = '${year}'`)[0]!.report_refs) as { key: string; hash: string }[];
    expect(finalized.slice(0, 8)).toBe(baseline.find((r) => r.key === 'cashReport')!.hash.slice(0, 8));
  });

  // N18 (Nachttest 0.4.0): Im Vorjahr des Seeds ist eine Bestätigung über einen ersetzten Bescheid und eine mit
  // zurückgegebener Zeile zu korrigieren — Spendenbuch und Schritt 7 nennen beide, der Betrag nur die Rückgabe.
  it('counts the confirmations to correct of the previous year in the donation book like step 7', async () => {
    const previous = String(seedStoryYear(todayIn(f.deps)) - 1);
    const year = rows<{ id: string }>(`select id from finance_fiscal_years where designation = '${previous}'`)[0]!.id;
    const book = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'donationBook', params: { fiscalYearId: year } })).data as { reconciliation: { toCorrect: { count: number; withoutAmountCount: number } } };
    expect(book.reconciliation.toCorrect).toMatchObject({ count: 2, withoutAmountCount: 1 });
    expect(book.reconciliation.toCorrect.count).toBe(toCorrectConfirmationsOfYearInternal(f.deps.db, year).length);
  });

  // Zuletzt: läuft den Seed ein zweites Mal (idempotent).
  it('releases the closed seed year for finalizing', async () => {
    const previous = String(seedStoryYear(todayIn(f.deps)) - 1);
    const releases = () => rows<{ basis: string; revoked_at: string | null }>(`select r.basis, r.revoked_at from finance_report_releases r join finance_fiscal_years y on y.id = r.fiscal_year_id where y.designation = '${previous}'`);
    const releaseAudits = () => rows<{ n: number }>(`select count(*) as n from audit_log where action = 'finance.report.release'`)[0]!.n;
    expect(releases()).toEqual([{ basis: 'auditReport', revoked_at: null }]);
    const before = releaseAudits();
    await seedFinance(f.deps, f.ctx);
    expect(releases()).toEqual([{ basis: 'auditReport', revoked_at: null }]);
    expect(releaseAudits()).toBe(before);
  });

  it('files a statement pdf covering the year end for every bank account of the closed year, so its cash report is final', async () => {
    const previous = String(seedStoryYear(todayIn(f.deps)) - 1);
    const year = rows<{ id: string }>(`select id from finance_fiscal_years where designation = '${previous}'`)[0]!.id;
    const banks = accountStatementsForYearInternal(f.deps.db, year).filter((r) => r.kind === 'bank');
    expect(banks.length).toBeGreaterThan(0);
    expect(banks.filter((r) => !r.statement?.covers).map((r) => r.name)).toEqual([]);
    expect(unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'cashReport', params: { fiscalYearId: year } })).stage).toBe('final');
    const count = () => rows<{ n: number }>('select count(*) as n from finance_account_statement_documents')[0]!.n;
    const before = count();
    await seedFinance(f.deps, f.ctx);
    expect(count()).toBe(before);
  });

  it('seeds a coherent previous year: finalized during the year, closed < audited < assembly (Designer Runde 5, 1.3)', async () => {
    const story = seedStoryYear(todayIn(f.deps));
    const year = rows<{ id: string; endsOn: string }>(`select id, ends_on as endsOn from finance_fiscal_years where designation = '${story - 1}'`)[0]!;
    const closedAt = rows<{ at: string }>(`select at from finance_period_events where fiscal_year_id = '${year.id}' and kind = 'closed' order by at limit 1`)[0]!.at;
    const filedAt = rows<{ at: string }>(`select filed_at as at from finance_audit_reports where fiscal_year_id = '${year.id}' and kind = 'report' and state = 'filed'`)[0]!.at;
    const assemblyOn = rows<{ on: string }>(`select assembly_on as "on" from finance_assembly_results where fiscal_year_id = '${year.id}'`)[0]!.on;
    expect(closedAt.slice(0, 10) > year.endsOn).toBe(true);
    expect(closedAt < filedAt).toBe(true);
    expect(filedAt.slice(0, 10) < assemblyOn).toBe(true);
    // Festgeschrieben im Lauf des Jahres, nicht am Tag des Seeds: keine Buchung des Vorjahres nach dem Abschluss.
    const late = rows<{ n: number }>(`select count(*) as n from finance_entries where fiscal_year_id = '${year.id}' and status = 'final' and finalized_at > '${closedAt}'`)[0]!.n;
    expect(late).toBe(0);
    // Keine Testnamen in den Buchungstexten (1.3 Nr. 7).
    expect(rows<{ text: string }>(`select text from finance_entries where text like '%Altjahr%' or text like '%Vorjahr%'`)).toEqual([]);
    // Schritt 12 folgt dem abgegebenen Erklärungszeitraum, ohne Bestätigung; der Wiederöffnen-Dialog sagt dasselbe (D2).
    // Offen bleibt er nur wegen der unabgegebenen USt-Jahreserklärung des Vorjahres (Befund 34 a, Joe: bleibt offen).
    const status = unwrap(await getClosingStatus(f.deps, f.ctx, { fiscalYearId: year.id }));
    expect(status.steps.find((s) => s.key === 'taxReturn')).toMatchObject({ done: false, confirmation: null, facts: { period: { filedOn: `${story}-05-31` }, vat: { filedOn: null } } });
    expect(unwrap(await previewPeriodReopen(f.deps, f.ctx, { id: year.id })).taxReturnFiledOn).toBe(`${story}-05-31`);
  });

  it('seeds a filed and an open tax period (Rechenschaft D2)', async () => {
    const story = seedStoryYear(todayIn(f.deps));
    const periods = unwrap(await listTaxPeriods(f.deps, f.ctx, {}));
    // Über die drei abgeschlossenen Jahre (Plan seed-mehrjahre Task 5), Zeile 9 mit einem Wert je Jahr.
    expect(periods.map((p) => p.label)).toEqual([String(story), `${story - SEED_CLOSED_YEARS}–${story - 1}`]);
    const [open, filed] = periods as [TaxPeriodView, TaxPeriodView];
    expect(filed.fiscalYearIds).toHaveLength(SEED_CLOSED_YEARS);
    // Fristen aus der Regel, nicht als fester 31.07. — der fällt 2027 auf einen Samstag (§ 108 Abs. 3 AO, Bilddurchsicht r9).
    expect(filed).toMatchObject({ requestedOn: `${story}-01-12`, dueOn: declarationDueOn(story - 1, false), filedOn: `${story}-05-31`, filedReportVoided: false, noticeId: null, state: 'filed', yearsLocked: true });
    expect(Object.keys(filed.documents).sort()).toEqual(['filedReturn', 'request', 'transmissionProtocol']);
    const finalized = rows<{ at: string }>(`select finalized_at as at from finance_reports where id = '${filed.filedReportId}'`)[0]!.at;
    expect(finalized.slice(0, 10)).toBe(`${story}-04-20`);
    const gem = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'taxReturnGem', params: { taxPeriodId: filed.id } }));
    expect(gem.stage).toBe('final');
    expect((gem.data as { missingCount: number }).missingCount).toBe(0);
    const line9 = (gem.data as { lines: { line: string; value: { kind: string; perYear?: { line: string; cents: number }[] } | null }[] }).lines.find((l) => l.line === '9')!;
    expect(line9.value!.perYear!.map((y) => y.line)).toHaveLength(SEED_CLOSED_YEARS);
    expect(line9.value!.perYear!.every((y) => y.cents > 0)).toBe(true);
    expect(open).toMatchObject({ dueOn: declarationDueOn(story, false), filedOn: null, answers: {}, state: 'open' });
    // Die beiden wartenden Korrekturen am Vorjahr entstanden vor der Abgabe — ohne § 153.
    expect(rows<{ section153: number }>(`select section_153 as section153 from finance_allocation_corrections where state = 'pending'`).map((r) => r.section153)).toEqual([0, 0]);
  });

  it('seeds the closing of the previous year and a handover', async () => {
    const story = seedStoryYear(todayIn(f.deps));
    const yearOf = (designation: string) => rows<{ id: string }>(`select id from finance_fiscal_years where designation = '${designation}'`)[0]!.id;
    const status = unwrap(await getClosingStatus(f.deps, f.ctx, { fiscalYearId: yearOf(String(story - 1)) }));
    // Alles erledigt bis auf Schritt 12: Die USt-Jahreserklärung des Vorjahres bleibt bewusst offen (Befund 34 a, Motiv 323);
    // die Jahre davor sind „Fertig.“.
    expect(status.steps.filter((s) => !s.done).map((s) => s.key)).toEqual(['taxReturn']);
    expect(status.next).toBe('taxReturn');
    for (const earlier of Array.from({ length: SEED_CLOSED_YEARS - 1 }, (_, i) => story - SEED_CLOSED_YEARS + i)) {
      expect(unwrap(await getClosingStatus(f.deps, f.ctx, { fiscalYearId: yearOf(String(earlier)) })).next).toBeNull();
    }
    const assembly = status.steps.find((s) => s.key === 'assembly')!.facts;
    expect(assembly.key === 'assembly' && assembly.result).toMatchObject({ dischargeMode: 'individual', accountsApproved: 'yes', complete: true });
    const payment = status.steps.find((s) => s.key === 'statements')!.facts;
    expect(payment.key === 'statements' && payment.accounts.filter((a) => a.kind === 'paymentService').every((a) => a.confirmation?.kind === 'notReconcilable' || a.importedBalance !== null)).toBe(true);
    const handovers = unwrap(await listHandovers(f.deps, f.ctx, { fiscalYearId: yearOf(String(story)) }));
    expect(handovers).toEqual([expect.objectContaining({ handoverOn: `${story}-06-30`, state: 'open' })]);
    const handover = unwrap(await getHandover(f.deps, f.ctx, { id: handovers[0]!.id }));
    expect(handover.interimReport).not.toBeNull();
    expect(handover.cashAccounts.every((a) => a.count === null)).toBe(true);
    expect(rows<{ title: string }>(`select title from follow_ups where entity_type = 'financeFiscalYear' and entity_id = '${yearOf(String(story))}'`).map((r) => r.title)).toContain('Jahresabschluss vor der Mitgliederversammlung');
    const counts = () => rows<{ n: number }>('select (select count(*) from finance_closing_confirmations) + (select count(*) from finance_handovers) + (select count(*) from finance_assembly_discharges) + (select count(*) from follow_ups) as n')[0]!.n;
    const before = counts();
    await seedFinance(f.deps, f.ctx);
    expect(counts()).toBe(before);
  });

  it('seeds reports for the closed year', async () => {
    const previous = String(seedStoryYear(todayIn(f.deps)) - 1);
    const otherAssets = () => rows<{ kind: string; label: string }>(`select kind, label from finance_other_assets order by label`);
    const finals = () => rows<{ report_key: string; voided_at: string | null; data_hash: string }>(`select r.report_key, r.voided_at, r.data_hash from finance_reports r join finance_fiscal_years y on y.id = r.fiscal_year_id where y.designation = '${previous}'`);
    expect(otherAssets().map((a) => a.kind).sort()).toEqual(['asset', 'liability']);
    // Rechenschaft C Schritt 10: alle Berichte der Gruppe MV sind festgeschrieben; D2: dazu die Werte für die Anlage Gem.
    // E11: dazu die Voranmeldung Q4 des Vorjahres, sobald Kompass deren Kennzahlen kennt (ab 2025).
    const advance = Number(previous) >= 2025 ? ['vatAdvanceReturn'] : [];
    expect(finals().map((r) => r.report_key).sort()).toEqual(['assetOverview', 'cashReport', 'incomeStatement', 'purposeFunds', 'taxReturnGem', ...advance]);
    expect(finals().every((r) => r.voided_at === null)).toBe(true);
    const year = rows<{ id: string }>(`select id from finance_fiscal_years where designation = '${previous}'`)[0]!.id;
    const run = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'cashReport', params: { fiscalYearId: year } }));
    expect(run.stage).toBe('final');
    expect((run.data as CashReport).probe.differenceCents).toBe(0);
    expect((run.data as CashReport).otherAssets.recorded).toBe(true);
    await seedFinance(f.deps, f.ctx);
    expect(otherAssets()).toHaveLength(2);
    expect(finals()).toHaveLength(5 + advance.length);
  });

  it('seeds data for every remaining report (Rechenschaft B1)', async () => {
    const story = seedStoryYear(todayIn(f.deps));
    const yearId = (designation: number) => rows<{ id: string; ends_on: string }>(`select id, ends_on from finance_fiscal_years where designation = '${designation}'`)[0]!;
    const previous = yearId(story - 1);
    const current = yearId(story);
    const run = async (report: string, params: Record<string, unknown>) => unwrap(await runFinanceReport(f.deps, f.ctx, { report, params })).data as Record<string, unknown>;
    // Im Stichjahr: § 13b-Ausgabe, ein Beleg an zwei Buchungen, eine Korrektur an einer Vorjahresbuchung mit Zweckwechsel.
    const vat = (await run('vatSummary', { fiscalYearId: current.id })) as { byCode: { taxCode: string; reverseChargeTaxCents: number }[] };
    expect(vat.byCode.find((c) => c.taxCode === 'rc13bEu')?.reverseChargeTaxCents).toBeGreaterThan(0);
    const check = (await run('voucherCheck', { fiscalYearId: current.id })) as { reusedEvidence: unknown[] };
    expect(check.reusedEvidence.length).toBeGreaterThan(0);
    const funds = (await run('purposeFunds', { fiscalYearId: current.id })) as { purposes: { correctionsCents: number }[] };
    expect(funds.purposes.some((p) => p.correctionsCents !== 0)).toBe(true);
    // Im Vorjahr: die Zweckmittel festgeschrieben, vor der Korrektur.
    expect(rows<{ id: string }>(`select id from finance_reports where report_key = 'purposeFunds' and fiscal_year_id = '${previous.id}' and voided_at is null`)).toHaveLength(1);
    // Jeder Bericht rechnet über das Vorjahr; leer bleibt nur, was der Seed dort bewusst nicht hat.
    const nonEmpty: Record<string, (d: Record<string, unknown>) => boolean> = {
      purposeFunds: (d) => (d.purposes as unknown[]).length > 0,
      // Die Projektbuchungen liegen im Stichjahr (`seedProjectBookings`); im Vorjahr ist die Abrechnung bewusst leer.
      projectStatement: (d) => Array.isArray(d.projects),
      reserveStatement: (d) => Array.isArray(d.reserves),
      foreignActivity: (d) => Array.isArray(d.partnerPayments),
      donationBook: (d) => ((d.book as { rows: unknown[] }).rows).length > 0,
      peopleOverview: (d) => Array.isArray(d.rows),
      voucherCheck: (d) => (d.withoutVoucher as unknown[]).length > 0,
      vatSummary: (d) => Array.isArray(d.byCode),
      monthlyOverview: (d) => (d.categories as unknown[]).length > 0,
    };
    for (const [report, filled] of Object.entries(nonEmpty)) expect(filled(await run(report, { fiscalYearId: previous.id })), report).toBe(true);
    expect(((await run('projectStatement', { fiscalYearId: current.id })) as { projects: unknown[] }).projects.length).toBeGreaterThan(0);
    expect(((await run('handoverList', { date: previous.ends_on })) as { groups: unknown[] }).groups.length).toBeGreaterThan(0);
    // Idempotent: ein zweiter Lauf legt nichts doppelt an.
    const counts = () => rows<{ n: number }>(`select count(*) as n from finance_allocation_corrections`)[0]!.n;
    const before = counts();
    await seedFinance(f.deps, f.ctx);
    expect(counts()).toBe(before);
  });

  it('seeds the VAT obligations of a small business (Plan E6a Task 9)', async () => {
    const story = seedStoryYear(todayIn(f.deps));
    expect(vatProfileAt(f.deps.db, `${story}-06-30`)).toMatchObject({ taxation: 'smallBusiness', entrepreneur: true, vatId: 'DE123456788', obligations: 'section18_4a' });
    const { advance } = unwrap(await listVatPeriods(f.deps, f.ctx, { year: story }));
    const period = (q: number) => advance.find((p) => p.key === `${story}-Q${q}`);
    expect(period(2)).toMatchObject({ required: true, amendmentDue: false, amounts: { rc13bEu: { baseCents: 20000, taxCents: 3800 } } });
    expect(period(2)!.filings).toHaveLength(1);
    expect(period(3)).toMatchObject({ required: true, filings: [], dueOn: nextWorkingDay(`${story}-10-10`) });
    expect(period(3)!.amounts.rc13bOther.baseCents).toBe(4900);
    expect(period(1)!.required).toBe(false);
    expect(period(4)?.required ?? false).toBe(false);
    const keys = unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed.map((d) => d.key);
    expect(keys).toEqual(expect.arrayContaining([`vatAdvanceReturn:${story}-Q3`, `vatReturn:${story}`]));
    expect(keys).not.toContain(`vatAdvanceReturn:${story}-Q2`);
    const year = rows<{ id: string }>(`select id from finance_fiscal_years where designation = '${story}'`)[0]!;
    const vat = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'vatSummary', params: { fiscalYearId: year.id } })).data as { byCode: { taxCode: string }[] };
    expect(vat.byCode.map((c) => c.taxCode)).toEqual(expect.arrayContaining(['rc13bEu', 'rc13bOther']));
    const count = () => [rows<{ n: number }>('select count(*) as n from finance_vat_filings')[0]!.n, rows<{ n: number }>('select count(*) as n from finance_entries')[0]!.n];
    const before = count();
    await seedFinance(f.deps, f.ctx);
    expect(count()).toEqual(before);
  });

  it('seeds an e-invoice of a foreign provider without German tax as a voucher without booking: category AE, no question (Joe 2026-10-26, Motiv 074)', async () => {
    const doc = rows<{ id: string; type_key: string }>(`select id, type_key from documents where subject like 'Rechnung CW-%Cloudwerk%'`);
    expect(doc).toHaveLength(1);
    expect(rows<{ n: number }>(`select count(*) as n from finance_entry_documents where document_id = '${doc[0]!.id}'`)[0]!.n).toBe(0);
    // Die Testumgebung liest keine PDF-Anhänge (Texterkennung ist ein Platzhalter): Der Entscheider bekommt die Rechnung
    // aus dem XML des Seeds selbst — dieselbe Prüfung, die der Rechnungsleser mit dem Anhang stellt.
    const parsed = parseFacturX(new TextEncoder().encode(buildInvoiceXml(FOREIGN_INVOICE)));
    if (!parsed.ok) throw new Error(parsed.code);
    const prompt = decideReverseChargePrompt({ entrepreneur: vatProfileAt(f.deps.db, todayIn(f.deps)).entrepreneur, lines: [{ amountCents: -5900, taxCode: null }], contact: null, ibanCountry: null, pages: [], invoice: { sellerVatId: parsed.invoice.sellerVatId, taxTotalCents: parsed.invoice.taxTotalCents, taxes: parsed.invoice.taxes, germanRates: [19, 7] } });
    // Designer Runde 8, Fachlich 2: Die Kategorie AE setzt das Kennzeichen als Vorgabe aus der Rechnung — keine Prüffrage.
    expect(parsed.invoice.taxes.some((t) => t.categoryCode === 'AE')).toBe(true);
    expect(prompt).toBeNull();
  });

  it('has a § 13b service in the previous year: Q4 filed, the annual VAT return named in step 12 (Joe 2026-10-26, Motiv 323)', async () => {
    const story = seedStoryYear(todayIn(f.deps));
    const { advance, annual } = unwrap(await listVatPeriods(f.deps, f.ctx, { year: story - 1 }));
    const q4 = advance.find((p) => p.key === `${story - 1}-Q4`)!;
    expect(q4.filings).toHaveLength(1);
    // E11 (Befund 34 c): festgeschrieben vor der Abgabe, die abgegebene Fassung liegt als PDF ab — wie Q2.
    if (story - 1 >= 2025) {
      expect(q4.filings[0]).toMatchObject({ reportId: expect.any(String), figures: expect.objectContaining({ rc13bEuBase: 15000 }) });
      expect(q4.filings[0]!.documents.filedReturn?.documentNumber).toMatch(/^UST-/);
    }
    expect(annual.required).toBe(true);
    expect(annual.filings).toEqual([]);
    const year = rows<{ id: string }>(`select id from finance_fiscal_years where designation = '${story - 1}'`)[0]!.id;
    const step = unwrap(await getClosingStatus(f.deps, f.ctx, { fiscalYearId: year })).steps.find((s) => s.key === 'taxReturn')!;
    expect(step.facts).toMatchObject({ vat: { calendarYear: story - 1, reason: 'section18_4a', filedOn: null } });
  });

  it('seeds the reverse-charge answer and a finalized Q2 (Plan E6b Task 9)', async () => {
    const story = seedStoryYear(todayIn(f.deps));
    const zahlfix = rows<{ id: string }>(`select id from contacts where name = 'Zahlfix Europe S.à r.l.'`)[0]!;
    expect(unwrap(await getContactTaxDetails(f.deps, f.ctx, { contactId: zahlfix.id }))?.reverseChargeDecline?.reason).toBe('paymentServices');
    expect(unwrap(await checkReverseCharge(f.deps, f.ctx, { contactId: zahlfix.id, lines: [{ amountCents: -490, taxCode: null }] })).prompt).toBeNull();
    const { advance } = unwrap(await listVatPeriods(f.deps, f.ctx, { year: story }));
    const q2 = advance.find((p) => p.key === `${story}-Q2`)!;
    // Kennzahlen kennt Kompass ab 2025; liegt das Stichjahr davor, bleibt Q2 ohne Fassung.
    const hasForm = story >= 2025;
    expect(q2.filings.at(-1)).toMatchObject({ figures: expect.objectContaining({ rc13bEuBase: 20000 }), reportId: hasForm ? expect.any(String) : null });
    expect(q2.filings.at(-1)!.documents.transmissionProtocol?.documentNumber).toMatch(/^UST-/);
    // E9 (Board Umsatzsteuer 8b): mit festgeschriebener Fassung liegt auch die abgegebene Fassung als PDF in der Akte.
    if (hasForm) expect(q2.filings.at(-1)!.documents.filedReturn?.documentNumber).toMatch(/^UST-/);
    const stage = async (q: number) => unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'vatAdvanceReturn', params: { vatPeriod: `${story}-Q${q}` } })).stage;
    if (hasForm) {
      expect(await stage(2)).toBe('final');
      expect(await stage(3)).toBe(todayIn(f.deps) > `${story}-09-30` ? 'review' : 'preliminary');
    }
    expect(advance.find((p) => p.key === `${story}-Q3`)!.filings).toEqual([]);
    const count = () => [rows<{ n: number }>('select count(*) as n from finance_vat_filings')[0]!.n, rows<{ n: number }>('select count(*) as n from finance_reports')[0]!.n, rows<{ n: number }>('select count(*) as n from documents')[0]!.n];
    const before = count();
    await seedFinance(f.deps, f.ctx);
    expect(count()).toEqual(before);
  });

  it('seeds data exports with a data path: one of the previous year five days ago, one deleted after 40 days (Rechenschaft B2)', async () => {
    // Ohne Datenverzeichnis (der Lauf oben) überspringt der Seed still.
    expect(rows<{ n: number }>('select count(*) as n from finance_data_exports')[0]!.n).toBe(0);
    const dataPath = mkdtempSync(path.join(tmpdir(), 'kompass-seed-export-'));
    try {
      (f.deps as typeof f.deps & { dataPath?: string }).dataPath = dataPath;
      // Wie im echten Seed (alle Rechte): Der Export braucht auch `documents.export`.
      const exporter = { ...f.ctx, permissions: new Set([...f.ctx.permissions, 'documents.export']) };
      await seedFinance(f.deps, exporter);
      const exports = rows<{ designations: string; created_at: string; file_deleted_at: string | null; file_name: string }>('select designations, created_at, file_deleted_at, file_name from finance_data_exports order by created_at');
      const previous = String(seedStoryYear(todayIn(f.deps)) - 1);
      const daysAgo = (iso: string) => Math.round((f.deps.clock.now().getTime() - new Date(iso).getTime()) / 86_400_000);
      expect(exports.map((e) => ({ designations: e.designations, days: daysAgo(e.created_at), deleted: e.file_deleted_at !== null }))).toEqual([
        { designations: previous, days: 40, deleted: true },
        { designations: previous, days: 5, deleted: false },
      ]);
      expect(await f.deps.files('finance').exists(exports[1]!.file_name)).toBe(true);
      expect(await f.deps.files('finance').exists(exports[0]!.file_name)).toBe(false);
      await seedFinance(f.deps, exporter);
      expect(rows<{ n: number }>('select count(*) as n from finance_data_exports')[0]!.n).toBe(2);
    } finally {
      delete (f.deps as typeof f.deps & { dataPath?: string }).dataPath;
      rmSync(dataPath, { recursive: true, force: true });
    }
  }, 30_000);

  it('keeps every finalized report of the year before at the hash of its current run: nothing changes in a released year (Designer Runde 6, 260)', async () => {
    const finalized = rows<{ report_key: string; params: string; data_hash: string }>('select report_key, params, data_hash from finance_reports where voided_at is null');
    expect(finalized.length).toBeGreaterThan(0);
    for (const r of finalized) {
      const run = unwrap(await runFinanceReport(f.deps, f.ctx, { report: r.report_key, params: JSON.parse(r.params) }));
      expect({ report: r.report_key, hash: run.hash, stage: run.stage }).toEqual({ report: r.report_key, hash: r.data_hash, stage: 'final' });
    }
  });

  it('gives every seeded document its own content: equal bytes would be the same proof in the voucher check (Designer Runde 6, 266)', () => {
    const twins = rows<{ checksum: string; n: number }>("select file_checksum as checksum, count(*) as n from documents where file_checksum is not null and type_key like 'voucher%' group by file_checksum having count(*) > 1");
    expect(twins).toEqual([]);
  });
});

describe('seedFinance without the core seed', () => {
  // Jeder Fall spielt den ganzen Seed von vorn ein: lokal gut 1 s, auf dem CI-Läufer bis über 5 s — 30 s wie oben.
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
  }, 30_000);

  it('seeds the reserves and transfers of the story year even when the association already has others (Plan seed-mehrjahre Task 2)', async () => {
    const { deps, ctx } = setupFinance();
    insertUser(deps, { name: 'Jonas Feld', email: 'jonas@kompass.local' });
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    const pdf = textPdf(['Protokoll Vorhandene Rücklage', '', 'Erfundenes Beispiel.']);
    unwrap(await saveReserve(deps, ctx, { kind: 'projectFunds', name: 'Vorhandene Rücklage', purposeText: 'Schon da', resolutionUpload: { bytes: pdf, fileName: 'vorhanden.pdf' } }));
    await seedFinance(deps, ctx);
    const names = unwrap(await listReserves(deps, ctx, { includeInactive: true })).map((r) => r.name).sort();
    expect(names).toEqual(['Ersatz Transporter', 'Freie Rücklage', 'Projektmittel Dach', 'Vorhandene Rücklage']);
    const reasons = deps.sqlite.prepare('select reason from finance_purpose_transfers order by reason').all() as { reason: string }[];
    expect(reasons.map((r) => r.reason)).toEqual(['Rest nach Abschluss der Hilfe', 'Zusage für die Herbstfahrt']);
  }, 30_000);

  it('issues nothing without the address of the association — a module test without the core seed stays green', async () => {
    const { deps, ctx } = setupFinance();
    await seedFinance(deps, ctx);
    expect(unwrap(await listConfirmations(deps, ctx, { tab: 'issued' })).total).toBe(0);
    expect(unwrap(await listNotices(deps, ctx, {}))).toHaveLength(1);
    expect(unwrap(await listNotices(deps, ctx, { includeInactive: true }))).toHaveLength(2);
  }, 30_000);

});
