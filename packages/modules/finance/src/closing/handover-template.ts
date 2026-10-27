import type { DocumentTemplate } from '@kompass/core';
import { z } from 'zod';
import { typstText as t } from '../typst-pure';

/**
 * Das Übergabeprotokoll zum Unterschreiben (Rechenschaft C, Spec § C Amtsübergabe, Designer 13e): auf `a4-plain-slim`,
 * `filed: false` — gültig ist der unterschriebene Scan (`fileHandoverProtocol`). Texte des Papiers fest deutsch in der
 * Modul-Vorlage (Prinzip 7). Rein: alles kommt fertig formatiert.
 */
export const HANDOVER_PROTOCOL_TYPE_KEY = 'finance-handover-protocol';
export const HANDOVER_PRINT_TEMPLATE_KEY = 'finance-handover-protocol-print';

/** Die Übergabepunkte auf dem Papier (Finanz-Spec § 9.6, § 667 BGB: Kasse, Unterlagen, Zugänge). */
export const HANDOVER_ITEM_PAPER = {
  cash: 'Kasse und Kassenbuch',
  records: 'Unterlagen, Belege und Akten',
  bankAccess: 'Zugänge zur Bank (Vollmachten, Karten, Online-Banking)',
  paymentServices: 'Zugänge zu Zahlungsdiensten',
  kompass: 'Kompass: Rolle, Agenten-Schlüssel, Unterzeichner des maschinellen Verfahrens, Wiedervorlagen',
} as const;

export const handoverPrintInputSchema = z.object({
  title: z.string().min(1),
  footerNote: z.string(),
  subject: z.array(z.object({ label: z.string(), value: z.string() })),
  items: z.array(z.object({ label: z.string(), note: z.string().nullable(), checked: z.boolean() })),
  /** Hinweis auf die Registeranmeldung (§ 67 BGB), wenn der Schatzmeister Vorstand nach § 26 BGB ist (oder unbekannt). */
  registerHint: z.boolean(),
  fromName: z.string(),
  toName: z.string(),
});
export type HandoverPrintInput = z.infer<typeof handoverPrintInputSchema>;

const box = (checked: boolean) => (checked ? '☒' : '☐');
const signature = (name: string) => `[#line(length: 100%, stroke: 0.4pt) #text(size: 8pt)[Ort, Datum, Unterschrift ${t(name)}]]`;

export function buildHandoverPrint(data: HandoverPrintInput) {
  const body: string[] = [];
  body.push('== Übergabe');
  body.push(`#table(columns: (auto, 1fr), stroke: none, inset: (x: 0pt, y: 3pt), ${data.subject.map((l) => `[${t(l.label)}], [${t(l.value)}]`).join(', ')})`);
  body.push('== Übergeben wurden');
  body.push(data.items.map((i) => `${box(i.checked)} ${t(i.label)}${i.note ? ` — ${t(i.note)}` : ''}`).join(' \\\n'));
  body.push('== Hinweise');
  const hints = [
    'Die Rechenschaft für die Zeit bis zum Übergabetag gibt der bisherige Schatzmeister mit dem Zwischenbericht (§ 666 BGB); herausgegeben wird, was er für den Verein hatte (§ 667 BGB).',
    'Entlastet die Mitgliederversammlung, sollte sie es für beide getrennt tun: für den bisherigen Schatzmeister bis zum Übergabetag, für den neuen ab dem Tag danach.',
  ];
  // § 67 Abs. 1, § 77 BGB (gesetze-im-internet.de, abgerufen 2026-10-25): Anmeldung durch Vorstandsmitglieder in
  // vertretungsberechtigter Zahl mittels öffentlich beglaubigter Erklärung, seit dem DiRUG auch per Videokommunikation
  // (§ 77 Abs. 2 BGB, § 40a BeurkG); beizufügen ist eine Abschrift der Urkunde über die Änderung (§ 67 Abs. 1 S. 2 BGB).
  if (data.registerHint) hints.push('Ist der Schatzmeister Vorstand nach § 26 BGB, ist die Änderung des Vorstands zum Vereinsregister anzumelden (§ 67 BGB), durch Vorstandsmitglieder in vertretungsberechtigter Zahl mit öffentlich beglaubigter Erklärung, auch per Video beim Notar (§ 77 BGB); beizufügen ist eine Abschrift der Urkunde über die Änderung, etwa des Wahlprotokolls.');
  body.push(hints.map((h) => `- ${t(h)}`).join('\n'));
  body.push('== Unterschriften');
  body.push(`#v(12mm) #grid(columns: (1fr, 1fr), gutter: 10mm, ${signature(data.fromName)}, ${signature(data.toName)})`);
  return {
    base: 'a4-plain-slim',
    slots: { kind: 'report' as const, title: data.title, subtitle: 'Übergabe der Kasse und der Unterlagen', stage: 'final' as const, footerNote: data.footerNote },
    body: { typst: body.join('\n\n') },
  };
}

export const handoverPrintTemplate: DocumentTemplate<HandoverPrintInput> = {
  key: HANDOVER_PRINT_TEMPLATE_KEY,
  type: HANDOVER_PROTOCOL_TYPE_KEY,
  schema: handoverPrintInputSchema,
  base: 'a4-plain-slim',
  permission: 'finance.read',
  filed: false,
  build: (data) => buildHandoverPrint(data),
};
