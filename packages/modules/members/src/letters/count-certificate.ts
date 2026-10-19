import type { DocumentTemplate } from '@kompass/core';
import { z } from 'zod';
import { day, memberLetterBody } from './shared';

export const COUNT_CERTIFICATE_TEMPLATE_KEY = 'member-count-certificate';

export const countCertificateSchema = z.object({
  organizationName: z.string().max(200),
  date: z.iso.date(),
  total: z.number().int().min(0),
  byType: z.array(z.object({ name: z.string().max(120), count: z.number().int().min(0) })).max(50),
});
export type CountCertificateInput = z.infer<typeof countCertificateSchema>;

/** Sprachtabelle der Bescheinigung über die Zahl der Mitglieder (Spec § 3.4, § 72 BGB): ohne Namen, ohne Empfänger. */
const W = {
  title: 'Bescheinigung über die Zahl der Mitglieder',
  sentence: (org: string, date: string, total: number) => `Hiermit bescheinigen wir, dass ${org} am ${day(date)} ${total === 1 ? 'ein Mitglied' : `${total} Mitglieder`} hatte.`,
  head: ['Mitgliedsart', 'Mitglieder'],
  total: 'Gesamt',
  sign: ['Ort, Datum', 'Unterschrift Vorstand'],
};

export const countCertificateTemplate: DocumentTemplate<CountCertificateInput> = {
  key: COUNT_CERTIFICATE_TEMPLATE_KEY,
  type: 'member-count-certificate',
  schema: countCertificateSchema,
  permission: 'members.manage',
  base: 'a4-mit-briefkopf',
  build: (data) => {
    const body = memberLetterBody({
      recipient: '',
      subject: W.title,
      info: [],
      intro: [W.sentence(data.organizationName, data.date, data.total)],
      table: { head: W.head, rows: data.byType.map((t) => [t.name, String(t.count)]), foot: [W.total, String(data.total)], align: ['left', 'right'] },
      deadline: null,
      transfer: null,
      outro: [],
      closing: [],
    });
    const signature = `#v(18mm)\n#grid(columns: (70mm, 1fr), column-gutter: 15mm, [#line(length: 100%, stroke: 0.5pt) #"${W.sign[0]}";], [#line(length: 100%, stroke: 0.5pt) #"${W.sign[1]}";])`;
    return { slots: { kind: 'letter', subject: W.title, title: W.title }, body: { typst: `${body}\n\n${signature}` } };
  },
};
