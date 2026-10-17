// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { DateFormatProvider } from '@/components/date-format-provider';
import { ReceiptList, type ReceiptListItem } from '@/components/finance/receipt-list';
import messages from '../messages/de.json';

afterEach(cleanup);

const item = (patch: Partial<ReceiptListItem>): ReceiptListItem => ({
  linkId: 'l1',
  documentNumber: 'BE-2026-0007',
  title: 'Rechnung Büromaterial',
  typeLabel: 'Eingangsrechnung',
  date: '2026-03-02',
  viewHref: '/x',
  revoked: false,
  ...patch,
});

const show = (items: ReceiptListItem[], onRevoke?: (id: string) => void) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        <ReceiptList items={items} onRevoke={onRevoke} />
      </DateFormatProvider>
    </NextIntlClientProvider>,
  );

describe('ReceiptList (07-2 A5)', () => {
  it('nennt die Nummer einmal und daneben den Betreff', () => {
    show([item({})]);
    expect(screen.getAllByText('BE-2026-0007')).toHaveLength(1);
    expect(screen.getByText('Rechnung Büromaterial')).toBeTruthy();
  });

  it('wiederholt die Nummer nicht, wenn kein Betreff bekannt ist', () => {
    show([item({ title: 'BE-2026-0007', typeLabel: '' })]);
    expect(screen.getAllByText('BE-2026-0007')).toHaveLength(1);
  });

  it('„Öffnen“ ist ein Textknopf, „Entfernen“ sekundär (Runde 3, 089)', () => {
    show([item({})], () => {});
    expect(screen.getByRole('link', { name: 'Öffnen' }).className).not.toMatch(/border-line-strong/);
    expect(screen.getByRole('button', { name: 'Entfernen' }).className).toMatch(/border-line-strong/);
  });

  it('kürzt den Betreff nicht: Art und Datum stehen in einer eigenen Zeile darunter (Runde 3, 089)', () => {
    show([item({})]);
    const subject = screen.getByText('Rechnung Büromaterial');
    expect(subject.className).not.toMatch(/truncate/);
    expect(subject.closest('li')?.textContent).toContain('Rechnung Büromaterial');
  });
});
