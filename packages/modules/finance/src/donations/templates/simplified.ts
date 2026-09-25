import type { DocumentTemplate } from '@kompass/core';
import { z } from 'zod';
import { AMOUNT_IN_WORDS_MAX_CENTS } from '../../ledger/amount-in-words';
import { CONFIRMATION_BASE, confirmationNoticeSchema, confirmationPartySchema, formatCents, noticeBlock, typstText as t } from './shared';
import * as W from './wording';

/**
 * Der vereinfachte Zuwendungsnachweis (F6b Task 5, Spec 7.5, Annahme 10):
 * ein Vordruck ohne Spender und ohne Betrag, den der Verein Kleinspendern
 * mitgibt oder zum Herunterladen anbietet. Zusammen mit dem Kontoauszug
 * genügt er bis zur Grenze des § 50 Abs. 4 EStDV. `filed: false` — kein
 * Akteneintrag, keine Nummer, kein Personenbezug; gerendert auf Abruf
 * (`readSimplifiedReceipt`), nach dem Muster des Kern-Auszugs `audit-log-export`.
 */
export const SIMPLIFIED_RECEIPT_TEMPLATE_KEY = 'finance-simplified-receipt';

export const simplifiedReceiptInputSchema = z.object({
  organization: confirmationPartySchema,
  /** Der Bescheid, der heute trägt. */
  notice: confirmationNoticeSchema,
  /** `simplifiedReceiptLimit` am Tag des Abrufs. */
  limitCents: z.number().int().positive().max(AMOUNT_IN_WORDS_MAX_CENTS),
});
export type SimplifiedReceiptInput = z.infer<typeof simplifiedReceiptInputSchema>;

export const simplifiedReceiptTemplate: DocumentTemplate<SimplifiedReceiptInput> = {
  key: SIMPLIFIED_RECEIPT_TEMPLATE_KEY,
  type: 'finance-simplified-receipt',
  schema: simplifiedReceiptInputSchema,
  base: CONFIRMATION_BASE,
  permission: 'finance.read',
  filed: false,
  build: (data) => ({
    slots: { kind: 'form', title: W.SIMPLIFIED_TITLE },
    body: {
      typst: [
        `#text(size: 8pt)[${t(W.ISSUER_LABEL)}]`,
        `#block(above: 2pt)[${[data.organization.name, ...data.organization.addressLines].map(t).join(' #linebreak() ')}]`,
        '#v(5mm)',
        `#align(center)[#text(size: 13pt, weight: "bold")[${t(W.SIMPLIFIED_TITLE)}]]`,
        '#v(4mm)',
        noticeBlock(data.notice),
        `#par[${t(W.SIMPLIFIED_DONATION_SENTENCE)}]`,
        '#v(4mm)',
        `#par[#text(size: 9pt)[${t(W.simplifiedReceiptSentence(formatCents(data.limitCents)))}]]`,
      ].join('\n\n'),
    },
  }),
};
