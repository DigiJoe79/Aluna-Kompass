import type { PartnerPaymentView, PartnerView } from '@kompass/module-finance';
import { AMOUNT_EVIDENCE_KINDS, coverageRequired, EVIDENCE_KINDS, evidenceCoverage, evidenceKindLabelKey, missingEvidence, normalizeEvidenceKind, proofDueDate, requiredEvidenceKinds, type EvidenceKind, type EvidenceRow, type PartnerBasis } from '@kompass/module-finance/evidence-rules';

/**
 * Formularzustand von Finanzen → Partner (F7 Task 6b). Kein Wert-Import aus
 * `@kompass/module-finance` — nur der reine Unterpfad `evidence-rules` (Muster
 * `expenses.ts`, `tests/client-imports.test.ts`).
 */

export { evidenceKindLabelKey, AMOUNT_EVIDENCE_KINDS, requiredEvidenceKinds, missingEvidence, evidenceCoverage, coverageRequired, normalizeEvidenceKind, proofDueDate, EVIDENCE_KINDS, type EvidenceKind, type EvidenceRow, type PartnerBasis };

export function partnerRequiredEvidenceKinds(partner: Pick<PartnerView, 'status'>, payment: Pick<PartnerPaymentView, 'basis'>, hasGoodsPositions: boolean): EvidenceKind[] {
  return requiredEvidenceKinds({ basis: payment.basis, partnerStatus: partner.status, hasGoodsPositions });
}
