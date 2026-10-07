import { describe, expect, it } from 'vitest';
import { coverageRequired, EVIDENCE_KINDS, evidenceCoverage, evidenceKindLabelKey, evidenceSubject, EVIDENCE_KIND_NAMES, missingEvidence, normalizeEvidenceKind, paymentProofSatisfied, proofDueDate, requiredEvidenceKinds } from '../src/allocation/evidence-rules';

describe('evidence-rules — pure required-evidence and coverage math (F7 Task 1)', () => {
  it('Spec 14.4 (Entscheidung 4): Auftrag — Auftrag je Vorhaben, Zahlungsnachweis, Abrechnung mit Belegen, Bericht; bei jedem Status', () => {
    for (const partnerStatus of ['taxExemptBody', 'foreignBody', 'publicBody', 'agent'] as const) {
      expect(requiredEvidenceKinds({ basis: 'agent57', partnerStatus, hasGoodsPositions: false })).toEqual(['paymentProof', 'agreement', 'settlement', 'report']);
    }
  });

  it('Spec 14.4: Förderung im Ausland — Vereinbarung, Zahlungsnachweis, Empfangsbestätigung, Rechnung oder Abrechnung, Bericht', () => {
    expect(requiredEvidenceKinds({ basis: 'transfer58', partnerStatus: 'foreignBody', hasGoodsPositions: false })).toEqual(['paymentProof', 'agreement', 'recipientReceipt', 'invoice', 'report']);
  });

  it('Spec 14.4: Förderung im Inland — nur der Zahlungsnachweis (der Bescheid ist eine Prüfung, keine Nachweisart); Sachen brauchen eine Empfangsbestätigung, nie ein Foto', () => {
    expect(requiredEvidenceKinds({ basis: 'transfer58', partnerStatus: 'taxExemptBody', hasGoodsPositions: false })).toEqual(['paymentProof']);
    expect(requiredEvidenceKinds({ basis: 'transfer58', partnerStatus: 'publicBody', hasGoodsPositions: true })).toEqual(['paymentProof', 'recipientReceipt']);
    expect(EVIDENCE_KINDS).not.toContain('photo');
    expect(EVIDENCE_KINDS).not.toContain('assignment');
  });

  it('liest alte Nachweisarten als die neuen: ein Foto ist Teil des Berichts, die Zusage ist die Vereinbarung', () => {
    expect(normalizeEvidenceKind('photo')).toBe('report');
    expect(normalizeEvidenceKind('assignment')).toBe('agreement');
    expect(normalizeEvidenceKind('invoice')).toBe('invoice');
    const legacy = [{ kind: 'assignment' as const, documentId: 'D1', foreignLanguage: false, explanationDe: null, coveredCents: null }];
    expect(missingEvidence(['paymentProof', 'agreement'], legacy).missingKinds).toEqual(['paymentProof']);
  });

  it('Nachweisfrist in Monaten: gleicher Tag n Monate später, am Monatsende auf den letzten Tag gekürzt', () => {
    expect(proofDueDate('2026-06-02', 3)).toBe('2026-09-02');
    expect(proofDueDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(proofDueDate('2026-11-30', 3)).toBe('2027-02-28');
    expect(proofDueDate('2027-12-15', 12)).toBe('2028-12-15');
  });

  it('lists a required kind as missing until a real document is attached — a gravestone does not count', () => {
    const required = requiredEvidenceKinds({ basis: 'transfer58', partnerStatus: 'foreignBody', hasGoodsPositions: false });
    expect(missingEvidence(required, []).missingKinds).toEqual(required);
    const withGravestone = [{ kind: 'paymentProof' as const, documentId: null, foreignLanguage: false, explanationDe: null, coveredCents: null }];
    expect(missingEvidence(['paymentProof'], withGravestone).missingKinds).toEqual(['paymentProof']);
    const complete = [{ kind: 'paymentProof' as const, documentId: 'D1', foreignLanguage: false, explanationDe: null, coveredCents: null }];
    expect(missingEvidence(['paymentProof'], complete).missingKinds).toEqual([]);
  });

  it('flags a foreign-language evidence without a German explanation, and an amount-bearing kind without a covered amount', () => {
    const evidence = [
      { kind: 'report' as const, documentId: 'D1', foreignLanguage: true, explanationDe: null, coveredCents: null },
      { kind: 'invoice' as const, documentId: 'D2', foreignLanguage: false, explanationDe: null, coveredCents: null },
    ];
    const { missingExplanation, missingAmount } = missingEvidence([], evidence);
    expect(missingExplanation).toEqual(['report']);
    // V (Prüfer Block 2): nur die Abrechnung mit Belegen eines Auftrags trägt einen Betrag — § 58 verlangt keine betragsgenaue Deckung.
    expect(missingAmount).toEqual([]);
    expect(missingEvidence([], [{ kind: 'settlement', documentId: 'D3', foreignLanguage: false, explanationDe: null, coveredCents: null }]).missingAmount).toEqual(['settlement']);
  });

  it('sums only the settlement toward coverage (V) — never an invoice of a funding transfer or the payment proof', () => {
    const evidence = [
      { kind: 'invoice' as const, documentId: 'D1', coveredCents: 3000 },
      { kind: 'settlement' as const, documentId: 'D2', coveredCents: 1500 },
      { kind: 'paymentProof' as const, documentId: 'D3', coveredCents: 999999 },
    ];
    expect(evidenceCoverage(evidence, 1500)).toEqual({ coveredCents: 1500, totalCents: 1500, complete: true });
    expect(evidenceCoverage(evidence, 1501)).toMatchObject({ coveredCents: 1500, complete: false });
    expect(evidenceCoverage([{ kind: 'settlement', documentId: null, coveredCents: 3000 }], 3000).coveredCents).toBe(0);
  });

  it('requires coverage only when the required kinds include an amount-bearing one — a plain funding transfer needs none', () => {
    expect(coverageRequired(['paymentProof'])).toBe(false);
    expect(coverageRequired(['paymentProof', 'agreement', 'recipientReceipt', 'invoice', 'report'])).toBe(false);
    expect(coverageRequired(['paymentProof', 'agreement', 'settlement'])).toBe(true);
  });

  it('treats the payment proof as given for a retroactive approval, and once the resulting item is settled otherwise', () => {
    expect(paymentProofSatisfied({ retroactive: true, openItemSettled: false })).toBe(true);
    expect(paymentProofSatisfied({ retroactive: false, openItemSettled: true })).toBe(true);
    expect(paymentProofSatisfied({ retroactive: false, openItemSettled: false })).toBe(false);
  });
});

describe('evidenceSubject — Betreff eines abgelegten Nachweises (AL, Recheck sha-0170e73)', () => {
  it('nennt die Art in Worten, nie den Code', () => {
    expect(evidenceSubject('paymentProof', 'transfer58', '28.09.2026', 'de')).toBe('Zahlungsnachweis vom 28.09.2026');
    expect(evidenceSubject('recipientReceipt', 'transfer58', '28.09.2026', 'de')).toBe('Empfangsbestätigung vom 28.09.2026');
    expect(evidenceSubject('invoice', 'transfer58', '28.09.2026', 'de')).toBe('Rechnung oder Abrechnung vom 28.09.2026');
    expect(evidenceSubject('report', 'agent57', '28.09.2026', 'de')).toBe('Bericht vom 28.09.2026');
    for (const kind of EVIDENCE_KINDS) for (const basis of ['transfer58', 'agent57'] as const) expect(evidenceSubject(kind, basis, '28.09.2026', 'de')).not.toContain(kind);
  });

  it('die Vereinbarung heißt beim Auftrag „Auftrag je Vorhaben“', () => {
    expect(evidenceSubject('agreement', 'transfer58', '28.09.2026', 'de')).toBe('Vereinbarung vom 28.09.2026');
    expect(evidenceSubject('agreement', 'agent57', '28.09.2026', 'de')).toBe('Auftrag je Vorhaben vom 28.09.2026');
    expect(evidenceKindLabelKey('agreement', 'agent57')).toBe('agreementAgent57');
  });

  it('eine Leitsprache ohne eigene Tabelle fällt auf Deutsch zurück', () => {
    expect(evidenceSubject('paymentProof', 'transfer58', '28.09.2026', 'en')).toBe(evidenceSubject('paymentProof', 'transfer58', '28.09.2026', 'de'));
    expect(Object.keys(EVIDENCE_KIND_NAMES.de).sort()).toEqual(['agreement', 'agreementAgent57', 'invoice', 'paymentProof', 'recipientReceipt', 'report', 'settlement']);
  });
});
