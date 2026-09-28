import { financeConflict } from '@kompass/module-finance';
import { EVIDENCE_KIND_NAMES } from '@kompass/module-finance/evidence-rules';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { toActionState } from '@/lib/actions';
import messages from '../messages/de.json';

const t = createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin' }) as unknown as (key: string, values?: Record<string, unknown>) => string;
const text = (code: 'evidenceExplanationMissing' | 'evidenceKindMissing' | 'evidenceAmountMissing', kind: string) => {
  const state = toActionState(financeConflict(code, { kind }), t);
  return state.status === 'error' ? state.message : '';
};

/**
 * P (Prüfer Block 2, Task 6c): Die Meldungen zu Nachweisen nennen die Art so,
 * wie sie in der Oberfläche heißt — nie den Code („report“) —, und die
 * Abhilfe sagt, was zu tun ist: die Erläuterung ergänzen.
 */
describe('Meldungen zu Nachweisen nennen die Art in Worten', () => {
  it('Bericht statt „report“, Auftrag je Vorhaben beim Auftrag', () => {
    expect(text('evidenceExplanationMissing', 'report')).toContain('„Bericht“');
    expect(text('evidenceExplanationMissing', 'report')).not.toContain('report');
    expect(text('evidenceKindMissing', 'agreementAgent57')).toContain('„Auftrag je Vorhaben“');
    expect(text('evidenceAmountMissing', 'settlement')).toContain('„Abrechnung mit Belegen“');
  });

  it('die Abhilfe bei fehlender Erläuterung heißt „ergänzen“, nicht „anerkennen“', () => {
    const message = text('evidenceExplanationMissing', 'invoice');
    expect(message).toContain('ergänzen');
    expect(message).not.toContain('bevor Sie die Nachweise anerkennen');
  });
});

/**
 * AL (Recheck sha-0170e73): Der gespeicherte Betreff eines Nachweises nennt
 * die Art mit denselben Wörtern wie die Oberfläche und die Meldungen aus P —
 * die Tabelle im Modul und die Sprachdatei laufen nie auseinander.
 */
describe('Betreff und Oberfläche nennen die Art gleich', () => {
  it('jede Art der Betreff-Tabelle heißt in der Sprachdatei und in den Meldungen genauso', () => {
    for (const [key, word] of Object.entries(EVIDENCE_KIND_NAMES.de)) {
      expect(t(`finance.partners.payment.requiredEvidence.kind.${key}`)).toBe(word);
      expect(text('evidenceKindMissing', key)).toContain(`„${word}“`);
    }
  });
});

/** AM (Recheck sha-0170e73): Die Sperre vor der Zahlung sagt, was sie löst — die gebuchte Überweisung mit der Nummer. */
describe('Anerkennen vor der Zahlung', () => {
  it('nennt den Verwendungszweck statt einer Person', () => {
    const state = toActionState(financeConflict('evidenceNotYetPaid', { number: 'PZ-2026-002' }), t);
    const message = state.status === 'error' ? state.message : '';
    expect(message).toContain('Sobald die Überweisung mit dem Verwendungszweck PZ-2026-002 gebucht ist, geht es weiter.');
  });
});
