import { financeConflict } from '@kompass/module-finance';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { toActionState } from '@/lib/actions';
import { messageValues } from '@/lib/error-text';
import messages from '../messages/de.json';

/**
 * Stufe 1, Auftrag 2 (Korrektur 2026-10-11): Die Sprachdatei hat kein ICU-Datum mehr; `messageValues` schreibt einen
 * Tag in Ablehnungen und Beschriftungen fest als TT.MM.JJJJ (wie vorher `::ddMMyyyy`), über `formatDate` aus dem Kern.
 */
const t = createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin' }) as unknown as Parameters<typeof toActionState>[1];

describe('Datum und Betrag in Meldungen', () => {
  it('messageValues schreibt Tag und Betrag fertig, …Text bleibt', () => {
    expect(messageValues({ date: '2026-03-04', amount: -1250, dateText: '2026-03-04', n: 3 }, ['amount'])).toEqual({ date: '04.03.2026', amount: '−12,50\u00a0€', dateText: '2026-03-04', n: 3 });
  });

  it('eine Ablehnung nennt IBANs gruppiert, die Parameter bleiben kompakt', () => {
    const failure = financeConflict('statementMultipleAccounts', { ibans: 'DE60999999990201051234, DE12999999990000112233' });
    expect(toActionState(failure, t)).toMatchObject({ message: expect.stringContaining('DE60 9999 9999 0201 0512 34, DE12 9999 9999 0000 1122 33') });
  });

  it('eine Ablehnung zeigt das Datum als TT.MM.JJJJ', () => {
    const failure = financeConflict('noNoticeValidAt', { date: '2026-03-10' });
    expect(toActionState(failure, t)).toMatchObject({ message: expect.stringContaining('Am 10.03.2026 gilt kein Bescheid') });
  });
});
