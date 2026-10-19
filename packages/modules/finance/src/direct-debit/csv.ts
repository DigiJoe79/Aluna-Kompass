import { isoDay, paperDate } from '@kompass/core';
import { sepaText } from './charset';

/** Die Kopfzeile der Musterdatei „Lastschriftvorlagen“ der VR-Banken, wörtlich (Recherche 2026-10-18), 20 Spalten. */
export const LASTSCHRIFT_CSV_HEADER =
  'Vorlagenbezeichnung;IBAN des Zahlungsempfängers;IBAN des Zahlungspflichtigen;BIC;Kreditinstitut;Zahlungspflichtiger;Strasse;Hausnummer;PLZ;Stadt;Land;Länderkennzeichen;Betrag;Verwendungszweck;LastschriftArt;Mandatsart;Mandatsreferenz;Gläubiger-ID;unterschrieben am;Abweichender Zahlungsempfänger';

export interface LastschriftCsvItem {
  creditorIban: string;
  creditorId: string;
  debtorName: string;
  debtorIban: string;
  debtorBic?: string | null;
  amountCents: number;
  remittance: string;
  mandateReference: string;
  signedOn: string;
  sequence: 'recurring' | 'oneOff';
}

const euro = (cents: number) => `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;

/**
 * Die CSV für den Import als Lastschriftvorlagen (Rückfallweg neben pain.008, Spec § 7.4): UTF-8 mit BOM, Semikolon,
 * CRLF wie die Musterdatei; Betrag mit Komma, Datum `TT.MM.JJJJ`, „Basis-Lastschrift“, „wiederholend“ bzw. „einmalig“.
 * Texte im SEPA-Zeichensatz — ein Semikolon kann so nie in einem Feld stehen. Anschrift und abweichender Empfänger
 * bleiben leer (optional). Rein.
 */
export function buildLastschriftCsv(items: readonly LastschriftCsvItem[]): Uint8Array {
  const lines = items.map((i) => {
    const name = sepaText(i.debtorName, 70);
    return [
      name,
      i.creditorIban,
      i.debtorIban,
      i.debtorBic ?? '',
      '',
      name,
      '',
      '',
      '',
      '',
      '',
      '',
      euro(i.amountCents),
      sepaText(i.remittance, 140),
      'Basis-Lastschrift',
      i.sequence === 'oneOff' ? 'einmalig' : 'wiederholend',
      sepaText(i.mandateReference, 35),
      i.creditorId,
      paperDate(isoDay(i.signedOn)),
      '',
    ].join(';');
  });
  const text = [LASTSCHRIFT_CSV_HEADER, ...lines].map((l) => `${l}\r\n`).join('');
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf], 0);
  out.set(body, 3);
  return out;
}
