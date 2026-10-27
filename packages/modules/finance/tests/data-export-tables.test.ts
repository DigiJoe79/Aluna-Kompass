import { unwrap, type DbOrTx } from '@kompass/core';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { saveDraft } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { fieldDescriptionCsv, gdpduIndexXml, readmeText } from '../src/reporting/export/describe';
import { GDPDU_DTD, GDPDU_DTD_SHA256 } from '../src/reporting/export/gdpdu-dtd';
import { EXPORT_TABLES, exportCell, exportLine, type ExportScope } from '../src/reporting/export/tables';
import { csvDocument } from '@kompass/core';
import { insertRaw, insertRun, ledgerFixture } from './helpers';

async function setup() {
  const f = await ledgerFixture({ years: ['2024', '2025', '2026'] });
  const y = (d: string) => f.years[d]!;
  // 2025: festgeschriebene Ausgabe über −1.234,56 € zu einem Rohumsatz mit gefährlichem Verwendungszweck, eine Spende mit Kontakt.
  const run = insertRun(f, f.bank.id, { periodFrom: '2025-01-01', periodTo: '2025-12-31' });
  const raw = insertRaw(f, run, { accountId: f.bank.id, amountCents: -123456, purpose: '=HYPERLINK("x");"zwei"\nZeilen', date: '2025-03-05' });
  const expense = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-12-31', text: 'Futter', moneyLines: [{ accountId: f.bank.id, amountCents: -123456, rawTransactionId: raw }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -123456 }] }));
  const donation = await f.finalDonation({ date: '2025-04-01', cents: 5000, contactId: f.donor.id });
  // 2024: eine Buchung, die nicht gewählt wird; 2025: ein Entwurf mit einem anderen Kontakt.
  const other = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2024-05-01', text: 'Altjahr', moneyLines: [{ accountId: f.cash.id, amountCents: 100 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 100, contactId: f.rightDonor.id }] }));
  const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2025-06-01', text: 'Entwurf', moneyLines: [{ accountId: f.bank.id, amountCents: 200 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 200, contactId: f.wrongDonor.id }] }));
  f.closeYear(y('2025').id);
  const scope: ExportScope = {
    fiscalYears: [
      { id: y('2025').id, designation: '2025', startsOn: '2025-01-01', endsOn: '2025-12-31', open: false },
      { id: y('2026').id, designation: '2026', startsOn: '2026-01-01', endsOn: '2026-12-31', open: true },
    ],
  };
  return { f, scope, expense, donation, other, draft, raw };
}

const table = (file: string) => EXPORT_TABLES.find((t) => t.file === file)!;
const rowsOf = (db: DbOrTx, scope: ExportScope, file: string) => [...table(file).rows(db, scope)];
const value = (file: string, r: readonly (string | null)[], name: string) => r[table(file).columns.findIndex((c) => c.name === name)];

describe('Dateien des Datenexports', () => {
  it('writes amount, day and switch in the agreed form', () => {
    expect(exportCell('amount', -123456)).toBe('-1234,56');
    expect(exportCell('amount', 5)).toBe('0,05');
    expect(exportCell('amount', -5)).toBe('-0,05');
    expect(exportCell('day', '2025-12-31')).toBe('31.12.2025');
    expect(exportCell('bool', true)).toBe('ja');
    expect(exportCell('bool', false)).toBe('nein');
    expect(exportCell('text', null)).toBeNull();
  });

  it('every file carries exactly its columns as header', async () => {
    const { f, scope } = await setup();
    for (const t of EXPORT_TABLES) {
      const text = csvDocument(t.columns.map((c) => c.name), t.rows(f.deps.db, scope));
      expect(text.split('\r\n')[0]).toBe(`﻿${t.columns.map((c) => c.name).join(';')}`);
      for (const r of t.rows(f.deps.db, scope)) expect(r).toHaveLength(t.columns.length);
    }
  });

  it('lists only final entries of the chosen years', async () => {
    const { f, scope, expense, donation, other, draft } = await setup();
    const ids = rowsOf(f.deps.db, scope, 'buchungen.csv').map((r) => value('buchungen.csv', r, 'BUCHUNG_ID'));
    expect(ids.sort()).toEqual([expense.id, donation.id].sort());
    expect(ids).not.toContain(other.id);
    expect(ids).not.toContain(draft.id);
    const entry = rowsOf(f.deps.db, scope, 'buchungen.csv').find((r) => value('buchungen.csv', r, 'BUCHUNG_ID') === expense.id)!;
    expect(value('buchungen.csv', entry, 'BUCHUNGSDATUM')).toBe('31.12.2025');
    const money = rowsOf(f.deps.db, scope, 'geldzeilen.csv').find((r) => value('geldzeilen.csv', r, 'BUCHUNG_ID') === expense.id)!;
    expect(value('geldzeilen.csv', money, 'BETRAG')).toBe('-1234,56');
    // Die Formel-Sperre gilt nur für Text: Ein negativer Betrag bleibt eine Zahl für die Prüfsoftware.
    expect(exportLine(table('geldzeilen.csv'), money).split(';')).toContain('-1234,56');
  });

  it('keeps a hostile bank text in one field as text', async () => {
    const { f, scope, raw, expense } = await setup();
    const t = table('rohumsaetze.csv');
    const rows = rowsOf(f.deps.db, scope, 'rohumsaetze.csv');
    const r = rows.find((x) => value('rohumsaetze.csv', x, 'ROHUMSATZ_ID') === raw)!;
    expect(value('rohumsaetze.csv', r, 'BUCHUNG_ID')).toBe(expense.id);
    const line = csvDocument(t.columns.map((c) => c.name), [r]).split('\r\n').slice(1).join('\r\n');
    const field = line.split(';')[t.columns.findIndex((c) => c.name === 'VERWENDUNGSZWECK')] ?? '';
    expect(line).toContain(`"'=HYPERLINK(""x"");""zwei""\nZeilen"`);
    expect(field.startsWith(`"'=`)).toBe(true);
    expect(exportLine(t, r)).toContain(`"'=HYPERLINK(""x"");""zwei""\nZeilen"`);
  });

  it('lists only contacts with a link, without e-mail', async () => {
    const { f, scope } = await setup();
    const t = table('kontakte.csv');
    expect(t.columns.map((c) => c.label).join(' ')).not.toMatch(/E-Mail|Telefon/);
    expect(rowsOf(f.deps.db, scope, 'kontakte.csv').map((r) => value('kontakte.csv', r, 'KONTAKT_ID'))).toEqual([f.donor.id]);
    expect(rowsOf(f.deps.db, scope, 'nutzer.csv').map((r) => value('nutzer.csv', r, 'NUTZER_ID'))).toEqual([f.userId]);
  });

  it('describes every file in index.xml in the order of the CSV and in the field description', async () => {
    const { scope } = await setup();
    const indexXml = gdpduIndexXml(EXPORT_TABLES, { supplier: 'Verein & Co', location: 'Musterstadt', createdAt: '2026-10-25T10:00:00.000Z', scope });
    expect(XMLValidator.validate(indexXml)).toBe(true);
    const parsed = new XMLParser({ ignoreAttributes: false, isArray: (name) => ['Table', 'VariableColumn'].includes(name) }).parse(indexXml);
    const tables = parsed.DataSet.Media.Table as { URL: string; VariableLength: { VariableColumn: { Name: string }[] } }[];
    expect(tables.map((t) => t.URL)).toEqual(EXPORT_TABLES.map((t) => t.file));
    for (const [i, t] of EXPORT_TABLES.entries()) expect(tables[i]!.VariableLength.VariableColumn.map((c) => c.Name)).toEqual(t.columns.map((c) => c.name));
    expect(indexXml).toContain('<!DOCTYPE DataSet SYSTEM "gdpdu-01-09-2004.dtd">');
    const description = fieldDescriptionCsv(EXPORT_TABLES).split('\r\n').filter(Boolean);
    expect(description).toHaveLength(1 + EXPORT_TABLES.reduce((n, t) => n + t.columns.length, 0));
  });

  it('names an open year as provisional', async () => {
    const { scope } = await setup();
    expect(readmeText({ createdAt: '2026-10-25T10:00:00.000Z', scope }, EXPORT_TABLES)).toMatch(/Vorläufig[^\n]*2026/);
  });

  it('ships the official DTD byte for byte', () => {
    const asset = readFileSync(path.join(__dirname, '..', 'assets', 'gdpdu-01-09-2004.dtd'));
    expect(createHash('sha256').update(asset).digest('hex')).toBe(GDPDU_DTD_SHA256);
    expect(createHash('sha256').update(GDPDU_DTD, 'utf8').digest('hex')).toBe(GDPDU_DTD_SHA256);
  });
});
