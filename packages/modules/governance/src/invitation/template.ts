import type { DocumentTemplate } from '@kompass/core';
import { EMPTY } from '@kompass/core';
import { z } from 'zod';
import { typstInline, typstText } from '../typst';

const text = (max: number) => z.string().max(max);

/** Eingabe der Einladung: fertige Texte (Wortlaut aus `words.ts`, Tagesordnung aus den Nutzdaten) — `build` bleibt rein. */
export const invitationSchema = z.object({
  /** Anschrift als Zeilen mit `\n`; beim Hauptdokument „An die Mitglieder“. */
  recipient: text(1000),
  greeting: text(200).nullable(),
  organizationName: text(300),
  subject: text(300).min(1),
  intro: z.array(text(5000)).max(10),
  /** Datum, Beginn, Form, Ort bzw. Zugang. */
  head: z.array(z.object({ label: text(60), value: text(1000) })).max(8),
  agenda: z.array(z.object({ position: z.number().int().min(1).max(500), title: text(300).min(1), text: text(20000).nullable(), attachments: z.array(text(40)).max(50) })).max(200),
  hints: z.array(text(5000)).max(10),
  closing: z.array(text(200)).max(4),
  /** Anlagen mit bisherigem und neuem Wortlaut (Plan U2): je TOP mit geänderten Absätzen eine. */
  annexes: z
    .array(z.object({ title: text(300), columns: z.tuple([text(60), text(60)]), rows: z.array(z.object({ label: text(120), before: text(5000), after: text(5000) })).max(50) }))
    .max(10)
    .default([]),
});
export type InvitationInput = z.input<typeof invitationSchema>;

const AGENDA_TITLE = 'Tagesordnung';
const ATTACHMENTS = 'Anlagen:';
const ANNEX_LABEL = 'Absatz';

/** Der Typst-Körper der Einladung. */
export function invitationBody(data: InvitationInput): string {
  const parts: string[] = [];
  if (data.greeting) parts.push(typstText(data.greeting));
  for (const p of data.intro) parts.push(typstText(p));
  if (data.head.length > 0) {
    const rows = data.head.map((h) => `[#strong${typstInline(h.label)}], ${typstInline(h.value)}`).join(',\n    ');
    parts.push(['#table(', '    columns: (auto, 1fr), stroke: none, inset: (x: 0mm, y: 1mm), column-gutter: 4mm,', `    ${rows}`, ')'].join('\n'));
  }
  if (data.agenda.length > 0) {
    parts.push(`#strong${typstInline(AGENDA_TITLE)}`);
    for (const item of data.agenda) {
      const lines = [`#strong${typstInline(`${item.position}. ${item.title}`)}`];
      if (item.text) lines.push(typstText(item.text));
      if (item.attachments.length > 0) lines.push(`#text(size: 9pt)${typstInline(`${ATTACHMENTS} ${item.attachments.join(', ')}`)}`);
      parts.push(lines.join(' #linebreak() '));
    }
  }
  for (const p of data.hints) parts.push(typstText(p));
  if (data.closing.length > 0) parts.push(data.closing.map(typstText).join(' #linebreak() '));
  for (const annex of data.annexes ?? []) {
    const cell = (value: string) => typstInline(value === '' ? EMPTY : value);
    const head = [ANNEX_LABEL, ...annex.columns].map((c) => `[#strong${typstInline(c)}]`).join(', ');
    const rows = annex.rows.map((r) => `${cell(r.label)}, ${cell(r.before)}, ${cell(r.after)}`).join(',\n    ');
    parts.push(
      [
        '#pagebreak()',
        `#strong${typstInline(annex.title)}`,
        '',
        '#table(',
        '    columns: (auto, 1fr, 1fr), stroke: 0.4pt + rgb(json("/data.json").brand.line), inset: 2mm,',
        `    ${head}${rows ? `,\n    ${rows}` : ''}`,
        ')',
      ].join('\n'),
    );
  }
  return parts.join('\n\n');
}

/** Eine Vorlage der Einladung auf dem Briefkopf. */
export function invitationTemplate(key: string, type: string): DocumentTemplate<InvitationInput> {
  return {
    key,
    type,
    schema: invitationSchema,
    permission: 'governance.manage',
    base: 'a4-mit-briefkopf',
    build: (data) => ({
      slots: { kind: 'letter', subject: data.subject, title: data.subject, recipient: data.recipient },
      body: { typst: invitationBody(data) },
    }),
  };
}

/** Wortlaut der Einladung als Anlage des Protokolls (Art `ELD`). */
export const INVITATION_TEMPLATE_KEY = 'governance-invitation';
/** Brief je Mitglied (Art `ELB`) — Einladung, Nachtrag. */
export const INVITATION_LETTER_TEMPLATE_KEY = 'governance-invitation-letter';
/** Absagebrief je Mitglied (Art `ELB`). */
export const CANCELLATION_LETTER_TEMPLATE_KEY = 'governance-cancellation-letter';

export const governanceDocumentTemplates: DocumentTemplate[] = [
  invitationTemplate(INVITATION_TEMPLATE_KEY, 'governance-invitation'),
  invitationTemplate(INVITATION_LETTER_TEMPLATE_KEY, 'governance-invitation-letter'),
  invitationTemplate(CANCELLATION_LETTER_TEMPLATE_KEY, 'governance-invitation-letter'),
] as DocumentTemplate[];
