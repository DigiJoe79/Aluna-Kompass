import { describe, expect, it } from 'vitest';
import { buildLastschriftCsv, LASTSCHRIFT_CSV_HEADER } from '../src/direct-debit/csv';

/** Plan L2 Task 3 — CSV für die Lastschriftvorlagen (Musterdatei der VR-Banken, Recherche 2026-10-18). */
const HEADER =
  'Vorlagenbezeichnung;IBAN des Zahlungsempfängers;IBAN des Zahlungspflichtigen;BIC;Kreditinstitut;Zahlungspflichtiger;Strasse;Hausnummer;PLZ;Stadt;Land;Länderkennzeichen;Betrag;Verwendungszweck;LastschriftArt;Mandatsart;Mandatsreferenz;Gläubiger-ID;unterschrieben am;Abweichender Zahlungsempfänger';

const base = { creditorIban: 'DE23999999990000202051', creditorId: 'DE98ZZZ09999999999', sequence: 'recurring' as const };

describe('buildLastschriftCsv', () => {
  it('writes UTF-8 with BOM, the header verbatim, one line per item, CRLF', () => {
    const bytes = buildLastschriftCsv([
      { ...base, debtorName: 'Müller & Söhne GmbH', debtorIban: 'DE44999999990532013000', debtorBic: null, amountCents: 1200, remittance: 'Beitrag 2026 Mitglied 0001', mandateReference: 'MND-000001', signedOn: '2026-01-15' },
      { ...base, sequence: 'oneOff', debtorName: 'Erika; Beispiel', debtorIban: 'DE24999999990000300003', debtorBic: 'GENODEF1XXX', amountCents: 5, remittance: 'Spende 2026-11', mandateReference: 'MND-000003', signedOn: '2026-02-01' },
    ]);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes.slice(3));
    const lines = text.split('\r\n');
    expect(LASTSCHRIFT_CSV_HEADER).toBe(HEADER);
    expect(lines[0]).toBe(HEADER);
    expect(lines[0]!.split(';')).toHaveLength(20);
    expect(lines.slice(1)).toEqual([
      'Müller + Söhne GmbH;DE23999999990000202051;DE44999999990532013000;;;Müller + Söhne GmbH;;;;;;;12,00;Beitrag 2026 Mitglied 0001;Basis-Lastschrift;wiederholend;MND-000001;DE98ZZZ09999999999;15.01.2026;',
      'Erika Beispiel;DE23999999990000202051;DE24999999990000300003;GENODEF1XXX;;Erika Beispiel;;;;;;;0,05;Spende 2026-11;Basis-Lastschrift;einmalig;MND-000003;DE98ZZZ09999999999;01.02.2026;',
      '',
    ]);
    for (const line of lines.slice(1, 3)) expect(line.split(';')).toHaveLength(20);
  });
});
