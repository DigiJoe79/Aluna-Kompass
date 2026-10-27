import { describe, expect, it } from 'vitest';
import { assessmentYearOf, GEM_FORMS, GEM_UNVERIFIED_NOTE, gemFormFor } from '../src/reporting/gem-forms';
import { gemAnswersSchema } from '../src/ledger/tax-periods';

/** Rechenschaft D2 Task 1: die datierte Zuordnungstabelle der Anlage Gem und das Schema der „Angaben von Ihnen“. */
describe('Zuordnungstabelle der Anlage Gem', () => {
  it('picks the form by assessment year', () => {
    expect(gemFormFor(2022)).toBeNull();
    expect(gemFormFor(2023)!.line10LimitCents).toBe(4_500_000);
    expect(gemFormFor(2024)!.validFromYear).toBe(2023);
    expect(gemFormFor(2025)!.lines.find((l) => l.line === '25')!.label).toContain('25–28');
    expect(gemFormFor(2024)!.lines.find((l) => l.line === '25')!.label).toContain('25–27');
    expect(gemFormFor(2026)!.line10LimitCents).toBe(5_000_000);
    expect(gemFormFor(2031)!.validFromYear).toBe(2026);
  });

  it('takes the assessment year from the end of the fiscal year', () => {
    expect(assessmentYearOf('2026-06-30')).toBe(2026);
    expect(assessmentYearOf('2025-12-31')).toBe(2025);
  });

  it('marks lines 50 to 70 as not checked against Mein ELSTER', () => {
    for (const form of GEM_FORMS) {
      for (const line of form.lines) {
        const n = Number.parseInt(line.line, 10);
        expect(Boolean(line.unverified), `${form.validFromYear} Zeile ${line.line}`).toBe(n >= 50 && n <= 70);
      }
      expect(form.notes).toContain(GEM_UNVERIFIED_NOTE);
    }
  });

  it('keeps the table consistent', () => {
    const answerKeys = Object.keys(gemAnswersSchema.shape);
    for (const form of GEM_FORMS) {
      const numbers = form.lines.map((l) => l.line);
      expect(new Set(numbers).size, `${form.validFromYear}`).toBe(numbers.length);
      for (const line of form.lines) {
        if (line.showWhen) expect(form.lines.find((l) => l.line === line.showWhen!.line)?.kind, `${form.validFromYear} Zeile ${line.line}`).toBe('yesNo');
        if (typeof line.source === 'object') expect(answerKeys).toContain(line.source.answer);
        if (line.requiredWith) expect(answerKeys).toContain(line.requiredWith);
      }
      expect(numbers).not.toContain('50a');
      expect(form.lines.find((l) => l.line === '63')!.kind).toBe('amount');
    }
    expect(GEM_FORMS.map((f) => f.validFromYear)).toEqual([2023, 2025, 2026]);
  });
});

describe('Angaben von Ihnen', () => {
  it('accepts what the form asks and refuses what it cannot be', () => {
    expect(gemAnswersSchema.safeParse({}).success).toBe(true);
    expect(gemAnswersSchema.safeParse({ feeResolution: 'none' }).success).toBe(true);
    expect(gemAnswersSchema.safeParse({ feeResolution: { date: '2024-03-01' }, feeResolutionSubmission: 'onFile' }).success).toBe(true);
    expect(gemAnswersSchema.safeParse({ gratuitousBenefits: true, gratuitousBenefitList: [{ reason: 'Jubiläumsfeier', amountCents: -1 }] }).success).toBe(false);
    expect(gemAnswersSchema.safeParse({ participations: { R1: { company: 'x'.repeat(501), taxOffice: 'FA', taxNumber: '1' } } }).success).toBe(false);
    expect(gemAnswersSchema.safeParse({ statuteDate: '31.12.2024' }).success).toBe(false);
    expect(gemAnswersSchema.safeParse({ unknown: true }).success).toBe(false);
    const trimmed = gemAnswersSchema.parse({ replacementAssets: { R1: { asset: '  Transporter  ' } } });
    expect(trimmed.replacementAssets!.R1!.asset).toBe('Transporter');
  });
});
