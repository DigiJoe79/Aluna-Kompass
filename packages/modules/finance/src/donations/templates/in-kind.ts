import type { DocumentTemplate } from '@kompass/core';
import { CONFIRMATION_BASE, CONFIRMATION_DOCUMENT_TYPE, CONFIRMATION_PERMISSION, amountBlock, checkbox, formatCents, germanDate, headBlock, inKindConfirmationInputSchema, noticeBlock, notesBlock, signatureBlock, typstText as t, type InKindConfirmationInput } from './shared';
import * as W from './wording';

/** Muster „Bestätigung über Sachzuwendungen“ (BMF 7.11.2013). Immer mit Unterschriftsfeld — das Schema lässt kein maschinelles Verfahren zu. */
export const inKindConfirmationTemplate: DocumentTemplate<InKindConfirmationInput> = {
  key: 'finance-confirmation-in-kind',
  type: CONFIRMATION_DOCUMENT_TYPE,
  schema: inKindConfirmationInputSchema,
  base: CONFIRMATION_BASE,
  permission: CONFIRMATION_PERMISSION,
  filed: true,
  build: (data) => {
    const origin =
      data.origin === 'business'
        ? `#par[${checkbox(true)} #h(1.5mm) ${t(W.IN_KIND_ORIGIN_BUSINESS)} #linebreak() ${t(W.inKindWithdrawal(formatCents(data.withdrawalValueCents ?? 0), formatCents(data.vatCents ?? 0)))}]`
        : `#par[${checkbox(true)} #h(1.5mm) ${t(W.IN_KIND_ORIGIN_PRIVATE)}]`;
    return {
      slots: { kind: 'form', title: W.TITLE_IN_KIND },
      body: {
        typst: [
          headBlock(W.TITLE_IN_KIND, data),
          amountBlock(W.IN_KIND_AMOUNT_LABEL, data.amountCents, W.DATE_LABEL, germanDate(data.donatedOn)),
          `#block(width: 100%, stroke: 0.5pt, inset: (x: 6pt, y: 5pt))[#text(size: 8pt)[${t(W.IN_KIND_ITEM_LABEL)}] #linebreak() ${t(data.item)} #linebreak() ${t(data.condition)} #linebreak() ${t(data.valuation)}]`,
          origin,
          `#par[${checkbox(true)} #h(1.5mm) ${t(W.IN_KIND_VALUATION_DOCUMENTS)}]`,
          noticeBlock(data.notice),
          signatureBlock(data),
          notesBlock(),
        ].join('\n\n'),
      },
    };
  },
};
