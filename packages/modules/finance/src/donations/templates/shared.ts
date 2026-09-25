import { documentImagePath, type DocumentImage } from '@kompass/core';
import { z } from 'zod';
import { AMOUNT_IN_WORDS_MAX_CENTS, amountInWords } from '../../ledger/amount-in-words';
import { NOTICE_KINDS } from '../../ledger/notice-validity';
import { formatCents, germanDate, typstText } from '../../typst-pure';
import * as W from './wording';

/**
 * Gemeinsames der drei Vorlagen für Zuwendungsbestätigungen: das
 * Eingabeschema und die Typst-Bausteine. Die Vorlagen sind rein — alles, was
 * sie drucken, steht in der Eingabe; `issueConfirmation` (Task 5) löst
 * Vereinsdaten, Kontakt, Bescheid, Unterzeichner und Faksimile vorher auf.
 */

export const CONFIRMATION_TEMPLATE_KEYS = ['finance-confirmation-money', 'finance-confirmation-in-kind', 'finance-confirmation-collective'] as const;
export type ConfirmationTemplateKey = (typeof CONFIRMATION_TEMPLATE_KEYS)[number];
export const CONFIRMATION_DOCUMENT_TYPE = 'finance-confirmation';
export const CONFIRMATION_BASE = 'a4-formular';
export const CONFIRMATION_PERMISSION = 'finance.donationsIssue';

// ── Eingabe ─────────────────────────────────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const cents = z.number().int().positive().max(AMOUNT_IN_WORDS_MAX_CENTS);

/** Verein oder Zuwendender: Name und Anschrift in Zeilen (Straße, PLZ Ort, ggf. Land). */
export const confirmationPartySchema = z.object({ name: text(200), addressLines: z.array(text(200)).min(1).max(4) });

/** Der jüngste am Ausstellungstag gültige Bescheid (Finanz-Spec 7.2 Nr. 5). */
export const confirmationNoticeSchema = z
  .object({
    kind: z.enum(NOTICE_KINDS),
    taxOffice: text(200),
    taxNumber: text(60),
    noticeDate: isoDate,
    assessmentPeriod: z.string().trim().min(1).max(40).nullable(),
    purposesText: text(2000),
  })
  .superRefine((n, c) => {
    if (n.kind !== 'section60a' && !n.assessmentPeriod) c.addIssue({ code: 'custom', path: ['assessmentPeriod'], message: 'assessmentPeriodRequired' });
  });

/** Das Faksimile aus dem Modulspeicher; nur die Prüfsumme wandert in den Snapshot. */
export const confirmationFacsimileSchema = z.object({
  bytes: z.instanceof(Uint8Array),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  mimeType: z.enum(['image/png', 'image/jpeg']),
});

const commonShape = {
  organization: confirmationPartySchema,
  recipient: confirmationPartySchema,
  notice: confirmationNoticeSchema,
  /** „Ort“ vor dem Datum der Unterschriftszeile — üblich: `organization.city`. */
  place: text(100),
  /** Ausstellungstag (ISO); steht als Datum neben der Unterschrift. */
  issuedOn: isoDate,
  /**
   * Maschinelles Verfahren vollständig und am Ausstellungstag gültig
   * (Unterzeichner, Faksimile, Anzeige). Nur dann Faksimile und Hinweis;
   * sonst ein Unterschriftsfeld.
   */
  machine: z.boolean(),
  /** Unterzeichnerin oder Unterzeichner; beim maschinellen Verfahren Pflicht, sonst unter dem Unterschriftsfeld, wenn bekannt. */
  signerName: text(200).nullable(),
  /** Tag der Anzeige beim Finanzamt (ISO); Pflicht beim maschinellen Verfahren. */
  machineNotifiedOn: isoDate.nullable(),
  facsimile: confirmationFacsimileSchema.optional(),
};

type Signature = { machine: boolean; signerName: string | null; machineNotifiedOn: string | null; facsimile?: unknown };

/** Maschinell heißt vollständig; ein Faksimile ohne maschinelles Verfahren ist ein Fehler des Aufrufers. */
function refineSignature(v: Signature, c: z.RefinementCtx, allowMachine: boolean): void {
  if (v.machine && !allowMachine) c.addIssue({ code: 'custom', path: ['machine'], message: 'machineNeedsHandSignature' });
  if (v.machine) {
    if (!v.signerName) c.addIssue({ code: 'custom', path: ['signerName'], message: 'machineNeedsSigner' });
    if (!v.machineNotifiedOn) c.addIssue({ code: 'custom', path: ['machineNotifiedOn'], message: 'machineNeedsNotification' });
    if (!v.facsimile) c.addIssue({ code: 'custom', path: ['facsimile'], message: 'machineNeedsFacsimile' });
  } else if (v.facsimile) {
    c.addIssue({ code: 'custom', path: ['facsimile'], message: 'facsimileWithoutMachine' });
  }
}

export const moneyConfirmationInputSchema = z
  .object({
    ...commonShape,
    /** `finance.membershipFeesCertifiable`: Aus → der Pflichtsatz zum ausgeschlossenen Mitgliedsbeitrag. */
    membershipFeesCertifiable: z.boolean(),
    amountCents: cents,
    donatedOn: isoDate,
    /** Aufwandsspende (E13): „Verzicht: Ja“ — immer mit Unterschriftsfeld. */
    expenseWaiver: z.boolean(),
  })
  .superRefine((v, c) => refineSignature(v, c, !v.expenseWaiver));
export type MoneyConfirmationInput = z.infer<typeof moneyConfirmationInputSchema>;

export const inKindConfirmationInputSchema = z
  .object({
    ...commonShape,
    /** Wert der Zuwendung. */
    amountCents: cents,
    donatedOn: isoDate,
    /** Gegenstand, Zustand/Alter, Wertermittlung (Annahme 11). */
    item: text(500),
    condition: text(500),
    valuation: text(1000),
    origin: z.enum(['private', 'business']),
    withdrawalValueCents: z.number().int().min(0).max(AMOUNT_IN_WORDS_MAX_CENTS).nullable(),
    vatCents: z.number().int().min(0).max(AMOUNT_IN_WORDS_MAX_CENTS).nullable(),
  })
  .superRefine((v, c) => {
    // Sachzuwendungen entstehen immer mit Unterschriftsfeld (Finanz-Spec 7.3).
    refineSignature(v, c, false);
    if (v.origin === 'business') {
      if (v.withdrawalValueCents === null) c.addIssue({ code: 'custom', path: ['withdrawalValueCents'], message: 'withdrawalValueRequired' });
      if (v.vatCents === null) c.addIssue({ code: 'custom', path: ['vatCents'], message: 'vatRequired' });
    }
  });
export type InKindConfirmationInput = z.infer<typeof inKindConfirmationInputSchema>;

export const collectiveLineSchema = z.object({
  donatedOn: isoDate,
  kind: z.enum(['donation', 'membershipFee']),
  expenseWaiver: z.boolean(),
  amountCents: cents,
});

export const collectiveConfirmationInputSchema = z
  .object({
    ...commonShape,
    membershipFeesCertifiable: z.boolean(),
    periodFrom: isoDate,
    periodTo: isoDate,
    lines: z.array(collectiveLineSchema).min(1).max(1000),
  })
  .superRefine((v, c) => {
    refineSignature(v, c, !v.lines.some((l) => l.expenseWaiver));
    if (v.periodFrom > v.periodTo) c.addIssue({ code: 'custom', path: ['periodTo'], message: 'periodInverted' });
    v.lines.forEach((l, i) => {
      if (l.donatedOn < v.periodFrom || l.donatedOn > v.periodTo) c.addIssue({ code: 'custom', path: ['lines', i, 'donatedOn'], message: 'outsidePeriod' });
      if (l.kind === 'membershipFee' && !v.membershipFeesCertifiable) c.addIssue({ code: 'custom', path: ['lines', i, 'kind'], message: 'membershipFeeNotCertifiable' });
    });
    if (v.lines.reduce((s, l) => s + l.amountCents, 0) > AMOUNT_IN_WORDS_MAX_CENTS) c.addIssue({ code: 'custom', path: ['lines'], message: 'totalTooLarge' });
  });
export type CollectiveConfirmationInput = z.infer<typeof collectiveConfirmationInputSchema>;

/** Was `issueConfirmation` je Art an `issueGeneratedDocument` gibt. */
export type ConfirmationTemplateInput =
  | { templateKey: 'finance-confirmation-money'; input: MoneyConfirmationInput }
  | { templateKey: 'finance-confirmation-in-kind'; input: InKindConfirmationInput }
  | { templateKey: 'finance-confirmation-collective'; input: CollectiveConfirmationInput };

// ── Formatierung (neutraler Boden: `typst-pure.ts`) ─────────────────────────

export { formatCents, germanDate, typstText } from '../../typst-pure';

const t = typstText;

/** Ein Kästchen, angekreuzt mit zwei Linien (kein Glyph, das der Schrift fehlen könnte). */
export function checkbox(checked: boolean): string {
  const cross = checked ? '#place(line(start: (0pt, 0pt), end: (3mm, 3mm), stroke: 0.6pt))#place(line(start: (0pt, 3mm), end: (3mm, 0pt), stroke: 0.6pt))' : '';
  return `#box(width: 3mm, height: 3mm, stroke: 0.6pt, baseline: 0.4mm)[${cross}]`;
}

/** „Ja ☐ Nein ☒“ des Musters. */
export function yesNoBoxes(yes: boolean): string {
  return `${t(W.YES)} ${checkbox(yes)} #h(6mm) ${t(W.NO)} ${checkbox(!yes)}`;
}

const small = (content: string) => `#text(size: 8pt)[${content}]`;
const lines = (party: { name: string; addressLines: string[] }) => [party.name, ...party.addressLines].map(t).join(' #linebreak() ');

function framed(label: string, content: string): string {
  return `#block(width: 100%, stroke: 0.5pt, inset: (x: 6pt, y: 5pt), breakable: false)[${small(t(label))} #linebreak() ${content}]`;
}

/** Aussteller, Titel mit Untertitel, Zuwendender. */
export function headBlock(title: string, input: { organization: { name: string; addressLines: string[] }; recipient: { name: string; addressLines: string[] } }): string {
  return [
    small(t(W.ISSUER_LABEL)),
    `#block(above: 2pt)[${lines(input.organization)}]`,
    '#v(5mm)',
    `#align(center)[#text(size: 13pt, weight: "bold")[${t(title)}]]`,
    `#align(center)[#text(size: 8.5pt)[${t(W.SUBTITLE)}]]`,
    '#v(4mm)',
    framed(W.DONOR_LABEL, lines(input.recipient)),
  ].join('\n');
}

/** Betrag in Ziffern, in Buchstaben und Tag bzw. Zeitraum — die Zeile unter dem Zuwendenden. */
export function amountBlock(label: string, amount: number, dateLabel: string, dateValue: string): string {
  const cell = (head: string, value: string) => `[${small(head)} #linebreak() ${value}]`;
  return [
    '#v(2mm)',
    '#table(columns: (auto, 1fr, auto), stroke: 0.5pt, inset: (x: 6pt, y: 5pt),',
    `  ${cell(`${t(label)} ${t(W.IN_FIGURES)}`, t(formatCents(amount)))},`,
    `  ${cell(t(W.IN_WORDS), t(amountInWords(amount)))},`,
    `  ${cell(t(dateLabel), t(dateValue))},`,
    ')',
  ].join('\n');
}

export function noticeBlock(notice: CollectiveConfirmationInput['notice']): string {
  return [`#par[${t(W.noticeSentence({ ...notice, noticeDate: germanDate(notice.noticeDate) }))}]`, `#par[${t(W.usageSentence(notice.purposesText))}]`].join('\n');
}

export function membershipBlock(certifiable: boolean, sentence: string): string {
  if (certifiable) return '';
  return `#par[${small(t(W.MEMBERSHIP_HEADING))} #linebreak() ${t(sentence)}]`;
}

/**
 * Unterschrift. Maschinell: Faksimile über `images.signature`, Name, Hinweis
 * mit Tag der Anzeige. Sonst: Ort und Datum vorgedruckt, Platz und Linie für
 * die eigenhändige Unterschrift.
 */
export function signatureBlock(input: { place: string; issuedOn: string; machine: boolean; signerName: string | null; machineNotifiedOn: string | null; facsimile?: { bytes: Uint8Array } ; notice: { taxOffice: string } }): string {
  const placeDate = t(`${input.place}, ${germanDate(input.issuedOn)}`);
  const signature = input.machine && input.facsimile ? `#image("${documentImagePath('signature', input.facsimile.bytes)}", height: 13mm)` : '#v(13mm)';
  const out = [
    '#v(6mm)',
    '#block(breakable: false)[',
    `  #grid(columns: (70mm, 1fr), align: (left + bottom, left + bottom), [${placeDate}], [${signature}])`,
    '  #v(-2pt)',
    '  #line(length: 100%, stroke: 0.5pt)',
    `  ${small(t(W.SIGNATURE_CAPTION))}${input.signerName ? ` #h(1fr) ${small(t(input.signerName))}` : ''}`,
    ']',
  ];
  if (input.machine && input.machineNotifiedOn) {
    out.push(`#par[${small(t(W.machineNote(input.notice.taxOffice, germanDate(input.machineNotifiedOn))))}]`);
  }
  return out.join('\n');
}

/** Haftungshinweis und Gültigkeit (§ 63 Abs. 5 AO). */
export function notesBlock(): string {
  return ['#v(4mm)', `#block(breakable: false)[#set text(size: 8pt)`, `  #strong[${t(W.NOTE_HEADING)}] #linebreak() ${t(W.LIABILITY_NOTE)}`, '', `  ${t(W.VALIDITY_NOTE)}`, ']'].join('\n');
}

/** `images.signature` nur mit Faksimile beim maschinellen Verfahren — sonst nichts. */
export function signatureImages(input: { machine: boolean; facsimile?: { bytes: Uint8Array; checksum: string } }): Record<string, DocumentImage> | undefined {
  return input.machine && input.facsimile ? { signature: { bytes: input.facsimile.bytes, checksum: input.facsimile.checksum } } : undefined;
}
