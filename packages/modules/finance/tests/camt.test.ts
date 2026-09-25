import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCamt053 } from '../src/import/camt';

const FIXTURES = path.resolve(import.meta.dirname, 'fixtures/camt');
const bytes = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));
const MAX = { maxBytes: 5_000_000 };

const VEREIN_IBAN = 'DE60999999990201051234';
const ERIKA_IBAN = 'DE66999999991234567890';
const BUERO_IBAN = 'DE12999999990000112233';

describe('parseCamt053', () => {
  it('reads a simple 001.02 statement: iban, period, balances, three lines with sign', () => {
    const result = parseCamt053(bytes('einfach-001-02.xml'), MAX);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.statements).toHaveLength(1);
    const stmt = result.statements[0]!;
    expect(stmt).toMatchObject({ iban: VEREIN_IBAN, currency: 'EUR', from: '2026-03-01', to: '2026-03-31', openingCents: 100000, closingCents: 115300, version: '001.02' });
    expect(stmt.lines).toHaveLength(3);
    expect(stmt.lines[0]).toMatchObject({ index: 1, amountCents: 20000, counterpartyName: 'Erika Beispiel', counterpartyIban: ERIKA_IBAN, purpose: 'Spende', pending: false, bookingDate: '2026-03-05' });
    expect(stmt.lines[1]).toMatchObject({ index: 2, amountCents: -1500, counterpartyName: 'Buerobedarf Muster GmbH', counterpartyIban: BUERO_IBAN, purpose: 'Bueromaterial' });
    expect(stmt.lines[2]).toMatchObject({ index: 3, amountCents: -3200 });
  });

  it('reads 001.08 the same way', () => {
    const a = parseCamt053(bytes('einfach-001-02.xml'), MAX);
    const b = parseCamt053(bytes('einfach-001-08.xml'), MAX);
    if (!a.ok || !b.ok) throw new Error('expected both to parse');
    expect(b.statements[0]!.version).toBe('001.08');
    expect(b.statements[0]!.lines.map((l) => ({ ...l, index: l.index }))).toEqual(a.statements[0]!.lines);
  });

  it('turns a batch entry into one line per transaction detail, each with its own reference', () => {
    const result = parseCamt053(bytes('sammelbuchung.xml'), MAX);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const lines = result.statements[0]!.lines;
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.amountCents)).toEqual([1000, 1500, 500]);
    expect(new Set(lines.map((l) => l.bankReference)).size).toBe(3);
    expect(lines.map((l) => l.counterpartyName)).toEqual(['Erika Beispiel', 'Max Muster', 'Familie Beispielhaus']);
  });

  it('refuses a batch whose details do not add up to the entry, naming the line', () => {
    const result = parseCamt053(bytes('summe-falsch.xml'), MAX);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('sumMismatch');
    expect(result.error.line).toBeDefined();
  });

  it('returns one statement per Stmt element', () => {
    const result = parseCamt053(bytes('zwei-tage.xml'), MAX);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]).toMatchObject({ from: '2026-03-01', to: '2026-03-15', openingCents: 10000, closingCents: 15000 });
    expect(result.statements[1]).toMatchObject({ from: '2026-03-16', to: '2026-03-31', openingCents: 15000, closingCents: 13000 });
    // Die Zeilennummerierung laeuft ueber die ganze Datei weiter.
    expect(result.statements[0]!.lines[0]!.index).toBe(1);
    expect(result.statements[1]!.lines[0]!.index).toBe(2);
  });

  it('carries the return reason code of a returned payment', () => {
    const result = parseCamt053(bytes('ruecklastschrift.xml'), MAX);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.statements[0]!.lines[0]).toMatchObject({ returnCode: 'MD01', amountCents: -2500 });
  });

  it('drops the placeholder NOTPROVIDED instead of keeping it as a reference', () => {
    const xml = readFileSync(path.join(FIXTURES, 'einfach-001-02.xml'), 'utf8').replace('<EndToEndId>E2E-0001</EndToEndId>', '<EndToEndId>NOTPROVIDED</EndToEndId>');
    const result = parseCamt053(new TextEncoder().encode(xml), MAX);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const lines = result.statements[0]!.lines;
    expect(lines[0]!.endToEndId).toBeNull();
    expect(lines[1]!.endToEndId).toBe('E2E-0002');
  });

  it('marks pending entries', () => {
    const result = parseCamt053(bytes('vorgemerkt.xml'), MAX);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const lines = result.statements[0]!.lines;
    expect(lines.find((l) => l.pending)).toMatchObject({ amountCents: -500, pending: true });
    expect(lines.filter((l) => !l.pending)).toHaveLength(1);
  });

  it('keeps leading zeros in references and never parses amounts as floats', () => {
    const result = parseCamt053(bytes('sammelbuchung.xml'), MAX);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const lines = result.statements[0]!.lines;
    expect(lines.map((l) => l.amountCents).reduce((a, b) => a + b, 0)).toBe(3000);
    expect(lines[0]!.bankReference).toBe('REF-BATCH-1-1');
  });

  it('checks opening plus booked lines against the closing balance', () => {
    const result = parseCamt053(bytes('einfach-001-02.xml'), MAX);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const stmt = result.statements[0]!;
    const sum = stmt.lines.reduce((s, l) => s + l.amountCents, 0);
    expect(stmt.openingCents + sum).toBe(stmt.closingCents);
  });

  it('decodes the predefined entities in counterparty and purpose', () => {
    const text = new TextDecoder()
      .decode(bytes('einfach-001-02.xml'))
      .replace('<Nm>Erika Beispiel</Nm>', '<Nm>Erika &amp; Max Beispiel</Nm>')
      .replace('<Ustrd>Spende</Ustrd>', '<Ustrd>Spende &quot;Tiere&quot; &lt;2026&gt;</Ustrd>')
      .replace('<EndToEndId>E2E-0001</EndToEndId>', '<EndToEndId>E2E&amp;0001</EndToEndId>')
      .replace('<AcctSvcrRef>REF-0001</AcctSvcrRef>', '<AcctSvcrRef>REF&amp;0001</AcctSvcrRef>');
    const result = parseCamt053(new TextEncoder().encode(text), MAX);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.statements[0]!.lines[0]).toMatchObject({
      counterpartyName: 'Erika & Max Beispiel',
      purpose: 'Spende "Tiere" <2026>',
      endToEndId: 'E2E&0001',
      bankReference: 'REF&0001',
    });
  });

  it('refuses a DOCTYPE and any ENTITY declaration before parsing', () => {
    const doctype = parseCamt053(bytes('doctype.xml'), MAX);
    expect(doctype.ok).toBe(false);
    if (!doctype.ok) expect(doctype.error.code).toBe('doctypeRefused');

    const entity = parseCamt053(bytes('entitaet.xml'), MAX);
    expect(entity.ok).toBe(false);
    if (!entity.ok) expect(entity.error.code).toBe('doctypeRefused');
  });

  it('never expands an entity', () => {
    const result = parseCamt053(bytes('entitaet.xml'), MAX);
    expect(result.ok).toBe(false);
    // Der Kanarienvogel: stuende dies irgendwo im Ergebnis, waere die Entitaet
    // trotz Ablehnung ausgewertet worden.
    expect(JSON.stringify(result)).not.toContain('LEAKED-SECRET');
  });

  it('refuses a file above the size limit without reading it', () => {
    const huge = bytes('einfach-001-02.xml');
    const result = parseCamt053(huge, { maxBytes: huge.byteLength - 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('tooLarge');
  });

  it('refuses a currency other than EUR, a pain file and an unknown camt version with their own codes', () => {
    const usd = parseCamt053(bytes('fremdwaehrung.xml'), MAX);
    expect(usd.ok).toBe(false);
    if (!usd.ok) expect(usd.error.code).toBe('currencyNotEur');

    const pain = parseCamt053(bytes('kein-camt.xml'), MAX);
    expect(pain.ok).toBe(false);
    if (!pain.ok) expect(pain.error.code).toBe('notCamt053');

    const unknownVersion = parseCamt053(bytes('unbekannte-version.xml'), MAX);
    expect(unknownVersion.ok).toBe(false);
    if (!unknownVersion.ok) expect(unknownVersion.error.code).toBe('unsupportedVersion');
  });

  it('names the line of an unreadable amount and returns nothing else', () => {
    const result = parseCamt053(bytes('kaputte-zeile.xml'), MAX);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ code: 'lineUnreadable', line: 2 });
    expect(Object.keys(result)).toEqual(['ok', 'error']);
  });

  it('decodes UTF-16 with BOM', () => {
    const result = parseCamt053(bytes('utf16.xml'), MAX);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.statements[0]).toMatchObject({ iban: VEREIN_IBAN, closingCents: 115300 });
  });

  it('refuses a statement without an iban, naming the code', () => {
    const result = parseCamt053(bytes('ohne-iban.xml'), MAX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('noIban');
  });

  it('refuses a statement without both balances, naming the code', () => {
    const result = parseCamt053(bytes('ohne-salden.xml'), MAX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('noBalances');
  });

  it('refuses input that is not xml at all', () => {
    const result = parseCamt053(new TextEncoder().encode('dies ist keine XML-Datei'), MAX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('notXml');
  });
});
