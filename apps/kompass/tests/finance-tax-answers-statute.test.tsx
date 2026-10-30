// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { DateFormatProvider } from '@/components/date-format-provider';

const linkTaxPeriodDocumentAction = vi.fn(async (_input: unknown) => ({ status: 'success' as const, message: 'ok' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/tax/actions', () => ({ saveTaxPeriodAnswersAction: vi.fn(), linkTaxPeriodDocumentAction: (input: unknown) => linkTaxPeriodDocumentAction(input) }));
const { AnswersCard } = await import('@/app/(shell)/finance/tax/answers-card');
afterEach(() => {
  cleanup();
  linkTaxPeriodDocumentAction.mockClear();
});

const years = [{ id: 'y25', designation: '2025', startsOn: '2025-01-01', endsOn: '2025-12-31' }];
const statute = { date: '2026-09-05', documentId: 'DOC-S', source: { label: 'Satzung vom 05.09.2026', href: '/governance/statutes/S1' } };
const show = (answers: Record<string, unknown>, statuteLinked = false) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        <AnswersCard period={{ id: 'p1', version: 'v1', answers }} formYear={2025} years={years} replacementReserves={[]} participationReserves={[]} memberSuggestions={null} canEdit statuteSuggestion={statute} statuteLinked={statuteLinked} />
      </DateFormatProvider>
    </NextIntlClientProvider>,
  );
const field = () => document.getElementById('answer-statuteDate') as HTMLInputElement;

/** Der Zähler der Speicherleiste („n Änderungen …“) — ohne Änderung steht er nicht da. */
const pendingCount = () => Number(document.querySelector('[aria-live="polite"]')?.textContent?.match(/^(\d+)/)?.[1] ?? 0);

/**
 * G7: „Satzung in der Fassung vom“ aus Gremien als Hinweis mit Herkunft — nie vorbelegt, nie still gespeichert. Erst
 * „Übernehmen“ füllt das Feld (Vorschlag nach MUSTER § E) und macht es zur ungespeicherten Änderung.
 */
describe('AnswersCard: Satzungsdatum aus Gremien', () => {
  it('ohne gespeichertes Datum bleibt das Feld leer und es gibt keine Änderung; „Übernehmen“ füllt es als eine Änderung', () => {
    show({});
    expect(field().value).toBe('');
    expect(pendingCount()).toBe(0);
    const hint = screen.getByTestId('answer-statuteDate-source');
    expect(within(hint).getByRole('link', { name: statute.source.label }).getAttribute('href')).toBe('/governance/statutes/S1');
    fireEvent.click(within(hint).getByRole('button'));
    expect(field().value).toBe('2026-09-05');
    expect(field().className).toContain('border-agent');
    expect(pendingCount()).toBe(1);
  });

  it('verknüpfen setzt die Satzung als Beilage', async () => {
    show({});
    fireEvent.click(screen.getByTestId('answer-statuteDate-link'));
    await waitFor(() => expect(linkTaxPeriodDocumentAction).toHaveBeenCalledWith({ id: 'p1', slot: 'statute', documentId: 'DOC-S' }));
  });

  it('ein gespeicherter, abweichender Wert bleibt; der Hinweis nennt den Vorschlag, gesetzt wird er erst auf Klick', () => {
    show({ statuteDate: '2022-03-01' }, true);
    expect(field().value).toBe('2022-03-01');
    expect(pendingCount()).toBe(0);
    expect(screen.queryByTestId('answer-statuteDate-link')).toBeNull();
    fireEvent.click(within(screen.getByTestId('answer-statuteDate-source')).getByRole('button'));
    expect(field().value).toBe('2026-09-05');
  });
});
