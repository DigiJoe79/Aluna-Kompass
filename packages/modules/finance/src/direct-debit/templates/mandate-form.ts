import type { DocumentTemplate } from '@kompass/core';
import { z } from 'zod';
import { typstText as t } from '../../typst-pure';
import { isValidCreditorId } from '../creditor-id';

/**
 * Das SEPA-Lastschriftmandat (Spec § 7.2, Handoff D7, 17a): ein vorausgefülltes Formular auf der Basis „Formular“.
 * Der Pflichttext ist der feste deutsche Wortlaut der SEPA-Basislastschrift (Prinzip 7, Ausnahme wie die Muster der
 * Zuwendungsbestätigungen) — nicht umformulieren. Keine Schrift unter 10 pt, Unterschriftslinie mindestens 60 mm,
 * Feldhöhe mindestens 10 mm, die IBAN in 22 Kästchen in Vierergruppen (leer, wenn unbekannt).
 */
export const MANDATE_FORM_TEMPLATE_KEY = 'sepa-mandate';
export const MANDATE_DOCUMENT_TYPE = 'sepa-mandate';

export const MANDATE_TITLE = 'SEPA-Lastschriftmandat';
export const MANDATE_AUTHORIZATION = (creditor: string) =>
  `Ich ermächtige ${creditor}, Zahlungen von meinem Konto mittels Lastschrift einzuziehen. Zugleich weise ich mein Kreditinstitut an, die von ${creditor} auf mein Konto gezogenen Lastschriften einzulösen.`;
export const MANDATE_REFUND_NOTE =
  'Hinweis: Ich kann innerhalb von acht Wochen, beginnend mit dem Belastungsdatum, die Erstattung des belasteten Betrages verlangen. Es gelten dabei die mit meinem Kreditinstitut vereinbarten Bedingungen.';
const CREDITOR_LABEL = 'Zahlungsempfänger';
const CREDITOR_ID_LABEL = 'Gläubiger-Identifikationsnummer';
const REFERENCE_LABEL = 'Mandatsreferenz';
const PAYMENT_TYPE_LABEL = 'Zahlungsart';
const PAYMENT_TYPE = 'Wiederkehrende Zahlung';
const DEBTOR_LABEL = 'Zahler (Kontoinhaber)';
const NAME_LABEL = 'Name';
const ADDRESS_LABEL = 'Anschrift';
const IBAN_LABEL = 'IBAN';
const PLACE_DATE_LABEL = 'Ort, Datum';
const SIGNATURE_LABEL = 'Unterschrift';
const RETURN_TO = (address: string, reference: string) => `Bitte unterschrieben zurück an: ${address} · ${REFERENCE_LABEL} ${reference}`;

/** So viele Kästchen hat eine deutsche IBAN; eine längere bekommt so viele, wie sie Zeichen hat. */
export const IBAN_BOXES = 22;

const line = (max: number) => z.string().trim().max(max);

export const mandateFormInputSchema = z.object({
  creditor: z.object({ name: line(70).min(1), addressLines: z.array(line(200).min(1)).max(4), creditorId: z.string().refine(isValidCreditorId, 'invalidCreditorId') }),
  reference: z.string().trim().min(1).max(35),
  /** Leer erlaubt: das Formular zum Ausfüllen von Hand. */
  debtor: z.object({ name: line(70), addressLines: z.array(line(200).min(1)).max(4), iban: z.string().trim().max(34).nullable() }),
});
export type MandateFormInput = z.infer<typeof mandateFormInputSchema>;

const SIZE = '#set text(size: 11pt)';
const label = (text: string) => `#text(size: 10pt, weight: "bold")[${t(text)}]`;
/** Eine Zeile mit Beschriftung und Wert; ohne Wert eine Schreiblinie mit 10 mm Feldhöhe. */
const field = (name: string, value: string) =>
  value !== '' ? `#grid(columns: (45mm, 1fr), ${'[' + label(name) + ']'}, [${t(value)}])` : `#grid(columns: (45mm, 1fr), ${'[' + label(name) + ']'}, [#v(10mm) #line(length: 100%, stroke: 0.5pt)])`;

/** Die IBAN in Kästchen, nach je vier eine Lücke; leer, wenn unbekannt. */
export function ibanBoxes(iban: string | null): string {
  const chars = (iban ?? '').replace(/\s+/g, '').toUpperCase().split('');
  const total = Math.max(IBAN_BOXES, chars.length);
  const boxes: string[] = [];
  for (let i = 0; i < total; i += 1) {
    if (i > 0 && i % 4 === 0) boxes.push('#h(2mm)');
    const ch = chars[i] ?? '';
    boxes.push(`#box(width: 6mm, height: 10mm, stroke: 0.5pt, inset: (top: 2.5mm))[#align(center)[#text(size: 12pt)[${ch === '' ? '' : t(ch)}]]]`);
  }
  return boxes.join('');
}

export const mandateFormTemplate: DocumentTemplate<MandateFormInput> = {
  key: MANDATE_FORM_TEMPLATE_KEY,
  type: MANDATE_DOCUMENT_TYPE,
  schema: mandateFormInputSchema,
  base: 'a4-formular',
  permission: 'finance.directDebit',
  filed: true,
  build: (data) => {
    const creditorAddress = [data.creditor.name, ...data.creditor.addressLines].join(', ');
    return {
      slots: { kind: 'form', title: MANDATE_TITLE },
      body: {
        typst: [
          SIZE,
          `#align(center)[#text(size: 14pt, weight: "bold")[${t(MANDATE_TITLE)}]]`,
          '#v(3mm)',
          `#block(width: 100%, stroke: 0.5pt, inset: 3mm, breakable: false)[${label(CREDITOR_LABEL)} #linebreak() ${[data.creditor.name, ...data.creditor.addressLines].map(t).join(' #linebreak() ')} #v(2mm) ${field(CREDITOR_ID_LABEL, data.creditor.creditorId)} ${field(REFERENCE_LABEL, data.reference)}]`,
          '#v(3mm)',
          `#par[${t(MANDATE_AUTHORIZATION(data.creditor.name))}]`,
          `#par[${t(MANDATE_REFUND_NOTE)}]`,
          field(PAYMENT_TYPE_LABEL, PAYMENT_TYPE),
          '#v(3mm)',
          `#block(width: 100%, stroke: 0.5pt, inset: 3mm, breakable: false)[${label(DEBTOR_LABEL)} #v(1mm) ${field(NAME_LABEL, data.debtor.name)} ${field(ADDRESS_LABEL, data.debtor.addressLines.join(', '))} #v(2mm) ${label(IBAN_LABEL)} #linebreak() ${ibanBoxes(data.debtor.iban)}]`,
          '#v(14mm)',
          `#grid(columns: (70mm, 1fr), column-gutter: 15mm, [#line(length: 100%, stroke: 0.5pt) ${t(PLACE_DATE_LABEL)}], [#line(length: 100%, stroke: 0.5pt) ${t(SIGNATURE_LABEL)}])`,
          '#v(10mm)',
          `#text(size: 10pt)[${t(RETURN_TO(creditorAddress, data.reference))}]`,
        ].join('\n\n'),
      },
    };
  },
};
