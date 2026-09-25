import type { DocumentTemplate } from '@kompass/core';
import { CONFIRMATION_BASE, CONFIRMATION_DOCUMENT_TYPE, CONFIRMATION_PERMISSION, amountBlock, collectiveConfirmationInputSchema, formatCents, germanDate, headBlock, membershipBlock, noticeBlock, notesBlock, signatureBlock, signatureImages, typstText as t, type CollectiveConfirmationInput } from './shared';
import * as W from './wording';

function attachment(data: CollectiveConfirmationInput, total: number): string {
  const rows = data.lines.map((l) =>
    [
      `[${t(germanDate(l.donatedOn))}]`,
      `[${t(l.kind === 'donation' ? W.ATTACHMENT_KIND_DONATION : W.ATTACHMENT_KIND_MEMBERSHIP_FEE)}]`,
      `[${t(l.expenseWaiver ? W.ATTACHMENT_YES : W.ATTACHMENT_NO)}]`,
      `[${t(formatCents(l.amountCents))}]`,
    ].join(', '),
  );
  const head = (s: string) => `[#text(size: 8.5pt, weight: "bold")[${t(s)}]]`;
  return [
    '#pagebreak()',
    `#text(size: 12pt, weight: "bold")[${t(W.ATTACHMENT_TITLE)}]`,
    '#v(3mm)',
    '#table(columns: (auto, 1fr, auto, auto), stroke: 0.5pt, inset: (x: 6pt, y: 4pt), align: (left, left, center, right),',
    `  table.header(${[W.ATTACHMENT_COLUMN_DATE, W.ATTACHMENT_COLUMN_KIND, W.ATTACHMENT_COLUMN_WAIVER, W.ATTACHMENT_COLUMN_AMOUNT].map(head).join(', ')}),`,
    ...rows.map((r) => `  ${r},`),
    `  table.cell(colspan: 3)[#strong[${t(W.ATTACHMENT_TOTAL)}]], [#strong[${t(formatCents(total))}]],`,
    ')',
  ].join('\n');
}

/** Muster „Sammelbestätigung über Geldzuwendungen/Mitgliedsbeiträge“ mit Anlage (BMF 7.11.2013). Benutzt ab F6b (Serienlauf). */
export const collectiveConfirmationTemplate: DocumentTemplate<CollectiveConfirmationInput> = {
  key: 'finance-confirmation-collective',
  type: CONFIRMATION_DOCUMENT_TYPE,
  schema: collectiveConfirmationInputSchema,
  base: CONFIRMATION_BASE,
  permission: CONFIRMATION_PERMISSION,
  filed: true,
  build: (data) => {
    const total = data.lines.reduce((s, l) => s + l.amountCents, 0);
    return {
      slots: { kind: 'form', title: W.TITLE_COLLECTIVE },
      body: {
        typst: [
          headBlock(W.TITLE_COLLECTIVE, data),
          amountBlock(W.COLLECTIVE_AMOUNT_LABEL, total, W.PERIOD_LABEL, W.periodText(germanDate(data.periodFrom), germanDate(data.periodTo))),
          noticeBlock(data.notice),
          membershipBlock(data.membershipFeesCertifiable, W.MEMBERSHIP_SENTENCE_COLLECTIVE),
          `#par[${t(W.COLLECTIVE_NO_OTHER_CONFIRMATIONS)}]`,
          `#par[${t(W.COLLECTIVE_WAIVER_REFERENCE)}]`,
          signatureBlock(data),
          notesBlock(),
          attachment(data, total),
        ].filter(Boolean).join('\n\n'),
      },
      images: signatureImages(data),
    };
  },
};
