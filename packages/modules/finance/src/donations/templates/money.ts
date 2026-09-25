import type { DocumentTemplate } from '@kompass/core';
import { CONFIRMATION_BASE, CONFIRMATION_DOCUMENT_TYPE, CONFIRMATION_PERMISSION, amountBlock, germanDate, headBlock, membershipBlock, moneyConfirmationInputSchema, noticeBlock, notesBlock, signatureBlock, signatureImages, typstText as t, yesNoBoxes, type MoneyConfirmationInput } from './shared';
import * as W from './wording';

/** Muster „Bestätigung über Geldzuwendungen/Mitgliedsbeitrag“ (BMF 7.11.2013); Aufwandsspende = „Verzicht: Ja“. */
export const moneyConfirmationTemplate: DocumentTemplate<MoneyConfirmationInput> = {
  key: 'finance-confirmation-money',
  type: CONFIRMATION_DOCUMENT_TYPE,
  schema: moneyConfirmationInputSchema,
  base: CONFIRMATION_BASE,
  permission: CONFIRMATION_PERMISSION,
  filed: true,
  build: (data) => ({
    slots: { kind: 'form', title: W.TITLE_MONEY },
    body: {
      typst: [
        headBlock(W.TITLE_MONEY, data),
        amountBlock(W.MONEY_AMOUNT_LABEL, data.amountCents, W.DATE_LABEL, germanDate(data.donatedOn)),
        `#par[${t(W.WAIVER_SENTENCE)} #h(4mm) ${yesNoBoxes(data.expenseWaiver)}]`,
        noticeBlock(data.notice),
        membershipBlock(data.membershipFeesCertifiable, W.MEMBERSHIP_SENTENCE),
        signatureBlock(data),
        notesBlock(),
      ].filter(Boolean).join('\n\n'),
    },
    images: signatureImages(data),
  }),
};
