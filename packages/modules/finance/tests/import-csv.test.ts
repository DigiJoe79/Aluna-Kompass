import { schema, unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { csvFormatSchema, headerSignature, type CsvFormat } from '../src/import/csv';
import { saveImportProfile } from '../src/import/profiles';
import { importStatement } from '../src/import/runs';
import { createAccount } from '../src/ledger/accounts';
import { financeAccounts, financeImportRuns, financeRawTransactions } from '../src/schema';
import { setupFinance } from './helpers';

const IBAN = 'DE60999999990201051234';
const HEADER = 'Buchungstag;Name;Verwendungszweck;Betrag;Saldo';
const enc = (s: string) => new TextEncoder().encode(s);
const csv = (rows: string[], header = HEADER) => enc([header, ...rows].join('\n'));
const camt = () => new Uint8Array(readFileSync(path.resolve(import.meta.dirname, 'fixtures/camt/einfach-001-02.xml')));
const code = (r: { ok: boolean; error?: { type: string; code?: string } }) => (r.ok ? 'ok' : r.error!.type === 'conflict' ? r.error!.code : r.error!.type);

function bankFormat(header = HEADER, over: Partial<CsvFormat['columns']> = {}): CsvFormat {
  return csvFormatSchema.parse({
    encoding: 'utf-8', delimiter: ';', headerRow: 0, headerSignature: headerSignature(header.split(';')), dateFormat: 'DD.MM.YYYY', decimalSeparator: ',',
    columns: { bookingDate: 'Buchungstag', valueDate: null, amount: 'Betrag', debit: null, credit: null, debitCreditIndicator: null, counterpartyName: 'Name', counterpartyIban: null, purpose: 'Verwendungszweck', reference: null, fee: null, balance: 'Saldo', currency: null, pending: null, ...over },
    invertSign: false,
  });
}

async function csvFixture(format: CsvFormat | null = bankFormat()) {
  const { deps, ctx } = setupFinance();
  const account = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: IBAN, isMain: true }));
  const profile = format ? unwrap(await saveImportProfile(deps, ctx, { accountId: account.id, name: 'Hausbank CSV', format })) : null;
  return { deps, ctx, account, profileId: profile?.profileId ?? null };
}

const MARCH = ['02.03.2026;Erika Beispiel;Spende;50,00;1.050,00', '05.03.2026;Druckerei Muster;Flyer;-20,00;1.030,00'];

describe('importStatement with CSV', () => {
  it('a file not starting with "<" goes the CSV way; a run carries format, format id and name', async () => {
    const f = await csvFixture();
    const { runs } = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'maerz.csv', bytes: csv(MARCH) }));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ format: 'csv', formatName: 'Hausbank CSV', periodFrom: '2026-03-02', periodTo: '2026-03-05', openingCents: 100000, closingCents: 103000, counts: { new: 2, known: 0, held: 0, pendingSkipped: 0 } });
    const row = f.deps.db.select().from(financeImportRuns).where(eq(financeImportRuns.id, runs[0]!.id)).get()!;
    expect(row).toMatchObject({ format: 'csv', profileId: f.profileId, profileName: 'Hausbank CSV' });
    expect(row.fileKey).toMatch(/^import-[0-9a-f]{64}\.csv$/);
  });

  it('CSV on an account without a CSV format is refused and writes no run', async () => {
    const f = await csvFixture(null);
    expect(code(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'a.csv', bytes: csv(MARCH) }))).toBe('statementNeedsCsvFormat');
    expect(f.deps.db.select().from(financeImportRuns).all()).toHaveLength(0);
  });

  it('a file with another header is the wrong file, not a broken one: refused, no run', async () => {
    const f = await csvFixture();
    const r = await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'a.csv', bytes: csv(['02.03.2026;1,00'], 'Datum;Betrag') });
    expect(code(r)).toBe('statementCsvFormatMismatch');
    expect(!r.ok && r.error.type === 'conflict' && r.error.message).toContain('Hausbank CSV');
    expect(f.deps.db.select().from(financeImportRuns).all()).toHaveLength(0);
  });

  it('an unreadable line leaves a failed run naming format and line, and answers statementUnreadable', async () => {
    const f = await csvFixture();
    const r = await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'a.csv', bytes: csv(['31.02.2026;A;x;1,00;1.001,00']) });
    expect(code(r)).toBe('statementUnreadable');
    expect(!r.ok && r.error.type === 'conflict' && r.error.message).toContain('Zeile 2');
    const [run] = f.deps.db.select().from(financeImportRuns).all();
    expect(run).toMatchObject({ format: 'csv', profileId: f.profileId, failureCode: 'csvDate', failureLine: 2 });
    expect(run!.failedAt).not.toBeNull();
  });

  it('the same file twice is refused as already imported', async () => {
    const f = await csvFixture();
    unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'a.csv', bytes: csv(MARCH) }));
    expect(code(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'b.csv', bytes: csv(MARCH) }))).toBe('statementAlreadyImported');
  });

  it('without a balance column the answer to “balance at the bank” gives closing and opening; without it both stay empty and no gap is claimed', async () => {
    const header = 'Buchungstag;Name;Verwendungszweck;Betrag';
    const f = await csvFixture(bankFormat(header, { balance: null }));
    const rows = ['02.03.2026;Erika Beispiel;Spende;50,00', '05.03.2026;Druckerei Muster;Flyer;-20,00'];
    const first = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'a.csv', bytes: csv(rows, header), closingBalanceCents: 103000 }));
    expect(first.runs[0]).toMatchObject({ openingCents: 100000, closingCents: 103000 });
    const second = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'b.csv', bytes: csv(['10.03.2026;C;x;5,00'], header) }));
    expect(second.runs[0]).toMatchObject({ openingCents: null, closingCents: null, gap: null });
  });

  it('a later file that overlaps an earlier one knows the old lines and adds only the new one', async () => {
    const f = await csvFixture();
    unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'a.csv', bytes: csv(MARCH) }));
    const { runs } = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'b.csv', bytes: csv([...MARCH, '07.03.2026;C;Beitrag;10,00;1.040,00']) }));
    expect(runs[0]!.counts).toMatchObject({ new: 1, known: 2 });
    expect(f.deps.db.select().from(financeRawTransactions).all()).toHaveLength(3);
  });

  it('with a reference column the safe protection works through the reference, and a fee becomes its own raw transaction', async () => {
    const header = 'Datum;Name;Brutto;Gebühr;Code;Guthaben';
    const format = csvFormatSchema.parse({ ...bankFormat(), headerSignature: headerSignature(header.split(';')), columns: { ...bankFormat().columns, bookingDate: 'Datum', amount: 'Brutto', purpose: null, fee: 'Gebühr', reference: 'Code', balance: 'Guthaben' } });
    const f = await csvFixture(format);
    const { runs } = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'a.csv', bytes: csv(['05.03.2026;Erika Beispiel;50,00;-1,60;TX1;148,40'], header) }));
    expect(runs[0]!.counts.new).toBe(2);
    const raws = f.deps.db.select().from(financeRawTransactions).all();
    expect(raws.map((r) => [r.amountCents, r.bankReference]).sort()).toEqual([[-160, 'TX1:fee'], [5000, 'TX1']].sort());
    const again = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'b.csv', bytes: csv(['05.03.2026;Erika Beispiel;50,00;-1,60;TX1;148,40', '06.03.2026;B;10,00;0,00;TX2;158,40'], header) }));
    expect(again.runs[0]!.counts).toMatchObject({ new: 1, known: 2 });
  });

  it('a following file whose opening balance does not meet the last closing is reported as a gap', async () => {
    const f = await csvFixture();
    unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'a.csv', bytes: csv(MARCH) }));
    const { runs } = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'b.csv', bytes: csv(['20.03.2026;C;x;5,00;1.100,00']) }));
    expect(runs[0]!.gap).toEqual({ from: '2026-03-05', to: '2026-03-20' });
  });

  it('CAMT on a CSV account needs the confirmation and then clears the CSV format', async () => {
    const f = await csvFixture();
    expect(code(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'a.xml', bytes: camt() }))).toBe('statementFormatChange');
    unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'a.xml', bytes: camt(), confirmFormatChange: true }));
    expect(f.deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, f.account.id)).get()).toMatchObject({ importFormat: 'camt053', importProfileId: null });
  });

  it('the audit log of a CSV run names format and format id, never counterparty, purpose or file name', async () => {
    const f = await csvFixture();
    unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'geheim-maerz.csv', bytes: csv(MARCH) }));
    const log = f.deps.db.select().from(schema.auditLog).all().filter((e) => e.action === 'finance.import.run');
    expect(JSON.parse(log[0]!.after as string)).toMatchObject({ format: 'csv', profileId: f.profileId });
    expect(JSON.stringify(log)).not.toMatch(/Erika|Druckerei|Spende|Flyer|geheim/);
  });
});
