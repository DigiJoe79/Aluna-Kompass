// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReviewBand } from '@/app/(shell)/animals/review-band';
import { DateFormatProvider } from '@/components/date-format-provider';
import { FormActionBar } from '@/components/forms/form-action-bar';
import messages from '../messages/de.json';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">{children}</DateFormatProvider>
    </NextIntlClientProvider>
  );
}

/** K10 Charge 2, T3.4: Der Haken „Beim Bestätigen veröffentlichen“ ist der Checkbox-Baustein, reist mit dem Formular und zählt nie als Änderung. */
it('der Haken reist mit dem Formular, zählt aber nicht als Änderung', () => {
  render(
    <>
      <ReviewBand requestedAt="2026-08-01T10:00:00.000Z" note="" canPublish formId="animal-form" />
      <form id="animal-form" data-testid="f">
        <input name="name" defaultValue="Pelle" aria-label="Name" />
        <FormActionBar />
      </form>
    </>,
    { wrapper: Wrapper },
  );
  const box = screen.getByRole('checkbox', { name: 'Beim Bestätigen veröffentlichen' });
  expect(box.getAttribute('aria-checked')).toBe('true');
  expect(new FormData(screen.getByTestId('f') as HTMLFormElement).get('publishOnConfirm')).toBe('on');
  fireEvent.click(box);
  expect(box.getAttribute('aria-checked')).toBe('false');
  expect(screen.queryByText(/Änderung/)).toBeNull();
  fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Pelle II' } });
  expect(screen.getByText(/1 Änderung/)).toBeTruthy();
});
