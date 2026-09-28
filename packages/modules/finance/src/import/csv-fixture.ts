/**
 * Zwei erfundene CSV-Kontoauszüge (F4b) — für die Entwicklungsdaten
 * (`seedFinance`), die Tests und, als Byte-gleiche Kopie, die E2E-Fixtures
 * (`apps/kompass/e2e/fixtures/csv/`). Muster `camt-fixture.ts`: kein Werkzeug,
 * keine echte Bank (BLZ 99999999), keine echten Personen.
 */

const quote = (cell: string) => `"${cell.replace(/"/g, '""')}"`;

/**
 * Ein Zahlungsdienst-Export, wie ihn solche Dienste als „Aktivitäten“ liefern:
 * UTF-8 mit BOM, Komma, alles in Anführungszeichen, Brutto/Gebühr/Netto,
 * Transaktionscode, Guthaben, eine vorgemerkte Zeile ohne Guthaben und eine
 * Auszahlung aufs Bankkonto. Die Guthaben gehen als Kette auf (Saldenprobe).
 */
export function buildPaymentServiceCsv(): Uint8Array {
  const rows = [
    ['Datum', 'Uhrzeit', 'Name', 'Typ', 'Status', 'Währung', 'Brutto', 'Gebühr', 'Netto', 'Transaktionscode', 'Guthaben', 'Betreff'],
    ['05.03.2026', '10:15:00', 'Erika Beispiel', 'Spendenzahlung', 'Abgeschlossen', 'EUR', '50,00', '-1,60', '48,40', 'ZD-0001', '148,40', 'Spende März'],
    ['06.03.2026', '09:00:00', 'Max Muster', 'Spendenzahlung', 'Ausstehend', 'EUR', '20,00', '-0,85', '19,15', 'ZD-0002', '', 'Spende'],
    ['07.03.2026', '11:30:00', 'Paula Probe', 'Spendenzahlung', 'Abgeschlossen', 'EUR', '10,00', '-0,55', '9,45', 'ZD-0003', '157,85', 'Spende Tierheim'],
    ['10.03.2026', '08:00:00', '', 'Auszahlung', 'Abgeschlossen', 'EUR', '-150,00', '0,00', '-150,00', 'ZD-0004', '7,85', 'Auszahlung auf Bankkonto'],
  ];
  const text = rows.map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n';
  const body = new TextEncoder().encode(text);
  const bytes = new Uint8Array(body.length + 3);
  bytes.set([0xef, 0xbb, 0xbf], 0);
  bytes.set(body, 3);
  return bytes;
}

const WINDOWS_1252: Record<string, number> = { ä: 0xe4, ö: 0xf6, ü: 0xfc, ß: 0xdf, Ä: 0xc4, Ö: 0xd6, Ü: 0xdc, '€': 0x80 };

/** Nur die Zeichen, die diese Datei braucht — ein fremdes Zeichen wäre ein Fehler im Bauhelfer, kein stilles `?`. */
function encodeWindows1252(text: string): Uint8Array {
  return new Uint8Array(
    [...text].map((ch) => {
      const mapped = WINDOWS_1252[ch];
      if (mapped !== undefined) return mapped;
      const code = ch.charCodeAt(0);
      if (code > 0x7e) throw new Error(`buildSecondBankCsv: Zeichen ${ch} ist nicht vorgesehen`);
      return code;
    }),
  );
}

/**
 * Eine Bank mit dem, was deutsche Banken gern tun: Windows-Zeichensatz,
 * Semikolon, vier Zeilen Vorspann (Kontoinhaber, IBAN, Zeitraum, leer) und
 * getrennte Spalten für Aus- und Eingang.
 */
export function buildSecondBankCsv(): Uint8Array {
  const lines = [
    'Kontoinhaber;Musterverein e.V.',
    'IBAN;DE48999999990000404040',
    'Zeitraum;01.03.2026 - 31.03.2026',
    '',
    'Buchungstag;Wertstellung;Auftraggeber/Empfänger;Verwendungszweck;Soll;Haben',
    '03.03.2026;03.03.2026;Erika Beispiel;Mitgliedsbeitrag 2026;;60,00',
    '04.03.2026;04.03.2026;Druckerei Müller & Söhne;Rechnung 2026-17;45,90;',
  ];
  return encodeWindows1252(lines.join('\r\n') + '\r\n');
}
