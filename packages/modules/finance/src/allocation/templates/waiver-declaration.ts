import type { DocumentTemplate } from '@kompass/core';
import { z } from 'zod';
import { formatCents, germanDate, typstText as t } from '../../typst-pure';
import * as W from './shared';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const party = z.object({ name: text(200), addressLines: z.array(text(200)).max(4) });

export const waiverDeclarationInputSchema = z.object({
  /** Der Name darf fehlen, solange der Verein ihn nicht eingetragen hat — der Formularkopf trägt ihn ohnehin. */
  organization: z.object({ name: z.string().trim().max(200), addressLines: z.array(text(200)).max(4) }),
  claimant: party,
  claimNumber: text(40),
  amountCents: z.number().int().positive().max(100_000_000),
  basisText: text(500),
  /** Datum der Vereinbarung; `null`, wenn die Grundlage des Vereins kein Datum trägt (Satzung). */
  agreedOn: isoDate.nullable(),
  declaredOn: isoDate,
  place: z.string().trim().max(100),
});
export type WaiverDeclarationInput = z.infer<typeof waiverDeclarationInputSchema>;

const lines = (p: { name: string; addressLines: string[] }) => [p.name, ...p.addressLines].map(t).join(' #linebreak() ');
const small = (content: string) => `#text(size: 8pt)[${content}]`;
const framed = (label: string, content: string) => `#block(width: 100%, stroke: 0.5pt, inset: (x: 6pt, y: 5pt), breakable: false)[${small(t(label))} #linebreak() ${content}]`;

/**
 * Die Verzichtserklärung (F8a Annahme 10): Modul-Vorlage auf dem Formular,
 * Akteneintrag `VZE` unter `finance.approve`. Die Antragstellerin erzeugt sie
 * auch selbst — der Dienst reicht ihr das Recht nur für diesen Aufruf. Immer
 * mit Unterschriftsfeld; die unterschriebene Fassung kommt als Eingang `VZU`.
 */
export const waiverDeclarationTemplate: DocumentTemplate<WaiverDeclarationInput> = {
  key: W.WAIVER_TEMPLATE_KEY,
  type: W.WAIVER_DOCUMENT_TYPE,
  schema: waiverDeclarationInputSchema,
  base: 'a4-formular',
  permission: 'finance.approve',
  filed: true,
  build: (data) => {
    const amount = formatCents(data.amountCents);
    const placeDate = [data.place, germanDate(data.declaredOn)].filter((s) => s !== '').join(', ');
    return {
      slots: { kind: 'form', title: W.TITLE },
      body: {
        typst: [
          framed(W.ORGANIZATION_LABEL, lines(data.organization)),
          '#v(4mm)',
          `#align(center)[#text(size: 13pt, weight: "bold")[${t(W.TITLE)}] #linebreak() ${t(W.SUBTITLE)}]`,
          '#v(4mm)',
          framed(W.CLAIMANT_LABEL, lines(data.claimant)),
          `#par[${t(W.claimSentence(data.claimNumber, amount))}]`,
          framed(W.BASIS_LABEL, t(data.basisText) + (data.agreedOn ? ` #linebreak() ${t(W.agreedSentence(germanDate(data.agreedOn)))}` : '')),
          `#par[${t(W.waiverSentence(amount))}]`,
          '#v(16mm)',
          `#grid(columns: (1fr, 1fr), column-gutter: 10mm, [${t(placeDate)} #line(length: 100%, stroke: 0.5pt) ${small(t(W.PLACE_DATE_LABEL))}], [#v(4.2mm) #line(length: 100%, stroke: 0.5pt) ${small(t(W.SIGNATURE_LABEL))}])`,
        ].join('\n\n'),
      },
    };
  },
};
