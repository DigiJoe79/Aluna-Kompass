import { isoDay, paperDate, type DocumentTemplate } from '@kompass/core';
import { TRANSFER_BLOCK_LIB, transferBlock, type TransferBlockLabels } from '@kompass/documents/transfer-block';
import { addCalendarDays, bankDayOnOrAfter } from '@kompass/module-finance';
import { z } from 'zod';

/**
 * Der gemeinsame Aufbau aller Briefe des Moduls (Plan M4 Task 2, Spec § 5): Anschrift, Betreff und Datum zeichnet die
 * Basis „Briefkopf“; der Körper ist Infozeile (Mitgliedsnummer), Absätze, eine Tabelle, die Frist als eigener fetter
 * Satz, der Überweisungsblock mit GiroCode, weitere Absätze (Stufentext, Überschneidung) und der Gruß.
 *
 * Die Vorlage bekommt fertige Texte: Den Wortlaut schreibt die Sprachtabelle der jeweiligen Art (`admission.ts` …),
 * den Stufentext einer Mahnung der Textbaustein aus den Einstellungen. So bleibt `build` rein und das Dokument aus
 * seinem Schnappschuss nachvollziehbar. Deutscher Wortlaut im Modul wie bei den Briefen der Finanzen.
 */

const text = (max: number) => z.string().max(max);

export const transferSchema = z.object({
  name: text(140).min(1),
  iban: text(34).min(1),
  bic: text(11).nullable(),
  amount: text(40).min(1),
  reference: text(140).min(1),
  qr: z.array(z.string().regex(/^[01]+$/)).max(200).nullable(),
  labels: z.object({ title: text(60), recipient: text(60), iban: text(60), bic: text(60), amount: text(60), reference: text(60), qr: text(60) }),
});

export const memberLetterSchema = z.object({
  /** Anschrift als Zeilen mit `\n`; leer, wenn der Brief nur per E-Mail geht. */
  recipient: text(1000),
  subject: text(300).min(1),
  info: z.array(z.object({ label: text(60), value: text(120) })).max(6),
  intro: z.array(text(5000)).max(20),
  table: z
    .object({
      head: z.array(text(60)).min(1).max(8),
      rows: z.array(z.array(text(120))).max(200),
      foot: z.array(text(120)).nullable(),
      /** Je Spalte: Zahlen rechts. */
      align: z.array(z.enum(['left', 'right'])),
    })
    .nullable(),
  /** Die Frist als eigener fetter Satz (Handoff D7). */
  deadline: text(500).nullable(),
  transfer: transferSchema.nullable(),
  outro: z.array(text(5000)).max(20),
  closing: z.array(text(200)).max(4),
});
export type MemberLetterInput = z.infer<typeof memberLetterSchema>;
export type MemberLetterTable = NonNullable<MemberLetterInput['table']>;

/** Freitext als Typst-String-Ausdruck: Nichts darin wirkt als Markup; das Semikolon beendet den Ausdruck. */
export const typstText = (value: string): string => `#"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}";`;
/** Wie `typstText`, aber als Inhalt in eckigen Klammern verwendbar. */
const inline = (value: string): string => `[${typstText(value)}]`;

function tableTypst(table: MemberLetterTable): string {
  const align = table.head.map((_, i) => (table.align[i] === 'right' ? 'right' : 'left'));
  const cells = (row: string[]) => row.map(inline).join(', ');
  const foot = table.foot ? `, table.hline(stroke: 0.5pt), ${table.foot.map((c) => `[#strong${inline(c)}]`).join(', ')}` : '';
  return [
    '#{',
    '  set text(size: 10pt, hyphenate: false)',
    '  table(',
    `    columns: (${table.head.map((_, i) => (i === 0 ? '1fr' : 'auto')).join(', ')}),`,
    `    align: (${align.join(', ')}),`,
    '    stroke: none, inset: (x: 2mm, y: 1.5mm),',
    `    table.header(${table.head.map((h) => `[#strong${inline(h)}]`).join(', ')}), table.hline(stroke: 0.5pt),`,
    `    ${table.rows.map(cells).join(',\n    ')}${foot}`,
    '  )',
    '}',
  ].join('\n');
}

/** Der Typst-Körper eines Briefs aus den fertigen Texten. */
export function memberLetterBody(data: MemberLetterInput): string {
  const parts: string[] = [];
  if (data.transfer) parts.push(TRANSFER_BLOCK_LIB);
  if (data.info.length > 0) parts.push(`#text(size: 9pt)[${data.info.map((i) => `${typstText(i.label)} ${typstText(i.value)}`).join(' #h(6mm) ')}]`);
  for (const p of data.intro) parts.push(typstText(p));
  if (data.table) parts.push(tableTypst(data.table));
  if (data.deadline) parts.push(`#strong${inline(data.deadline)}`);
  if (data.transfer) parts.push(transferBlock(data.transfer));
  for (const p of data.outro) parts.push(typstText(p));
  if (data.closing.length > 0) parts.push(data.closing.map(typstText).join(' #linebreak() '));
  return parts.join('\n\n');
}

/** Eine Vorlage des Moduls: Art, Recht und Aufbau; die Basis ist der Briefkopf. */
export function memberLetterTemplate(key: string, type: string, permission: string): DocumentTemplate<MemberLetterInput> {
  return {
    key,
    type,
    schema: memberLetterSchema,
    permission,
    base: 'a4-mit-briefkopf',
    build: (data) => ({
      slots: { kind: 'letter', subject: data.subject, title: data.subject, recipient: data.recipient },
      body: { typst: memberLetterBody(data) },
    }),
  };
}

// ── Gemeinsamer Wortlaut ─────────────────────────────────────────────────────────────────────────────────────────

export const TRANSFER_LABELS: TransferBlockLabels = { title: 'Überweisung', recipient: 'Empfänger', iban: 'IBAN', bic: 'BIC', amount: 'Betrag', reference: 'Verwendungszweck', qr: 'GiroCode' };
export const MEMBER_NUMBER_LABEL = 'Mitgliedsnummer';
export const MEMBER_LABEL = 'Mitglied';

/** Die Infozeile: Mitgliedsnummer, bei einem Brief an die Vertretung auch der Name des Mitglieds (M3). */
export function memberInfo(f: { memberNumber: string; memberName: string | null }): { label: string; value: string }[] {
  return [{ label: MEMBER_NUMBER_LABEL, value: f.memberNumber }, ...(f.memberName ? [{ label: MEMBER_LABEL, value: f.memberName }] : [])];
}
export const CLOSING = 'Mit freundlichen Grüßen';
export const INTERVAL_WORDS = { yearly: 'jährlich', halfYearly: 'halbjährlich', quarterly: 'vierteljährlich', monthly: 'monatlich' } as const;
export const METHOD_WORDS = { transfer: 'Überweisung', directDebit: 'SEPA-Lastschrift' } as const;

/** Ein Tag als Papierdatum (`TT.MM.JJJJ`). */
export const day = (iso: string): string => paperDate(isoDay(iso));

/** `iso` plus `days` Kalendertage — die Kalenderrechnung der Finanzen, keine Uhr. */
export const addDays = (iso: string, days: number): string => addCalendarDays(iso, days);

/**
 * Der Einzugstag, den ein Brief für einen Beitrag ankündigt (Plan N1 E1): der spätere von Fälligkeit und frühestem
 * ankündbaren Tag (Briefdatum plus Vorabankündigung), auf den nächsten Bankarbeitstag. Genau diesen Tag nennt der
 * Brief, und genau an ihm deckt die Ankündigung den Einzug.
 */
export function announcedCollectionDay(dueOn: string, earliest: string | null): string {
  return bankDayOnOrAfter(earliest && earliest > dueOn ? earliest : dueOn);
}

/** Bei Lastschrift: je offenem Beitrag „Einzug am …: Betrag“. */
export const COLLECTION_ON = 'Einzug am';

/** Bei Lastschrift: Hinweis mit Mandatsreferenz und Gläubiger-ID und der Plan der Einzüge als Tabelle. */
export interface DirectDebitFacts {
  mandateReference: string;
  creditorId: string | null;
  /** M39: Gehört das Konto jemand anderem als dem Empfänger, dessen Name — die Ankündigung geht dann an ihn. */
  holderName?: string | null;
}

export function directDebitSentence(dd: DirectDebitFacts): string {
  const creditor = dd.creditorId ? `, Gläubiger-Identifikationsnummer ${dd.creditorId}` : '';
  if (dd.holderName) return `Wir ziehen die Beiträge an den genannten Tagen per SEPA-Lastschrift vom Konto von ${dd.holderName} ein (Mandatsreferenz ${dd.mandateReference}${creditor}). Die Ankündigung der Einzüge erhält ${dd.holderName} gesondert.`;
  return `Wir ziehen die Beiträge an den genannten Tagen per SEPA-Lastschrift von Ihrem Konto ein (Mandatsreferenz ${dd.mandateReference}${creditor}). Dieses Schreiben kündigt die Einzüge an.`;
}
