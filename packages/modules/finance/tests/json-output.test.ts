import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { buildSecondBankCsv } from '../src/import/csv-fixture';
import { completeFormat, guessCsvFormat, type CsvFormat } from '../src/import/csv';
import { saveImportProfile } from '../src/import/profiles';
import { countCash } from '../src/ledger/cash';
import { requestAllocationCorrection } from '../src/ledger/corrections';
import { bookEntry } from '../src/ledger/finalize';
import { createOpenItem } from '../src/ledger/open-items';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { ledgerFixture } from './helpers';

/**
 * Nachtrag Rest 0.2.0, Task 7e (MC): Was in der Datenbank als JSON-Text liegt, geben die Lesewerkzeuge als
 * Objekt aus — `denominations` kam in `finance_cash_counts_list` als Text (Muster des früheren
 * `lineTemplate`-Fehlers). Wächter über die Ausgaben mit solchen Spalten.
 */
function jsonTexts(value: unknown, at = ''): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^[[{]/.test(trimmed)) return [];
    try {
      JSON.parse(trimmed);
      return [at];
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => jsonTexts(v, `${at}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => jsonTexts(v, at ? `${at}.${k}` : k));
  return [];
}

function guessedFormat(bytes: Uint8Array): CsvFormat {
  const guess = guessCsvFormat(bytes);
  const none: CsvFormat['columns'] = { bookingDate: '', valueDate: null, amount: null, debit: null, credit: null, debitCreditIndicator: null, counterpartyName: null, counterpartyIban: null, purpose: null, reference: null, fee: null, balance: null, currency: null, pending: null };
  return completeFormat(guess, { columns: { ...none, ...guess.columns } as CsvFormat['columns'], invertSign: false, dateFormat: guess.dateFormat!, decimalSeparator: guess.decimalSeparator! });
}

async function call(name: string, deps: Parameters<(typeof FINANCE_MCP_TOOLS)[number]['handler']>[0], ctx: Parameters<(typeof FINANCE_MCP_TOOLS)[number]['handler']>[1], args: unknown = {}) {
  const tool = FINANCE_MCP_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`unknown tool ${name}`);
  return unwrap(await tool.handler(deps, ctx, args));
}

describe('finance read tools return JSON columns as objects (MC)', () => {
  it('cash counts, open items and import profiles carry no JSON text', async () => {
    const f = await ledgerFixture();
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Anfangsbestand Kasse', moneyLines: [{ accountId: f.cash.id, amountCents: 1500 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1500 }] }));
    unwrap(await countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-03-10', countedCents: 1500, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id, denominations: { '1000': 1, '500': 1 } }));
    unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-02-20', amountCents: 11900, paymentReference: 'TM-2026-0042', lineTemplate: [{ taxCode: 'standard' }] }));
    unwrap(await saveImportProfile(f.deps, f.ctx, { accountId: f.bank.id, name: 'Zweitbank CSV', format: guessedFormat(buildSecondBankCsv()) }));

    const counts = await call('finance_cash_counts_list', f.deps, f.ctx);
    expect((counts as { counts: { denominations: unknown }[] }).counts[0]!.denominations).toEqual({ '1000': 1, '500': 1 });

    const outputs = {
      finance_cash_counts_list: counts,
      finance_open_items_list: await call('finance_open_items_list', f.deps, f.ctx),
      finance_import_profiles_list: await call('finance_import_profiles_list', f.deps, f.ctx),
    };
    for (const [name, output] of Object.entries(outputs)) expect(jsonTexts(output), name).toEqual([]);
  });
});

describe('Zuordnungskorrektur: vorher/nachher als Objekt (Teil C Task 2c)', () => {
  it('finance_correction_request und finance_corrections_list tragen before/after nicht als JSON-Text', async () => {
    const f = await ledgerFixture();
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000, contactId: f.donor.id }] }));
    const lineId = entry.allocationLines[0]!.id;
    const requested = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId, changes: { contactId: f.wrongDonor.id }, note: 'Falscher Spender' }));
    expect(requested.correction.before).toMatchObject({ contactId: f.donor.id });
    expect(requested.correction.after).toEqual({ contactId: f.wrongDonor.id });
    const outputs = { request: requested, finance_corrections_list: await call('finance_corrections_list', f.deps, f.ctx) };
    for (const [name, output] of Object.entries(outputs)) expect(jsonTexts(output), name).toEqual([]);
  });
});
