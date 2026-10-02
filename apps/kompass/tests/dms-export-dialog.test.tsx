// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { ExportDialog } from '@/app/(shell)/dms/export-dialog';
import messages from '../messages/de.json';

afterEach(() => cleanup());

describe('ExportDialog', () => {
  it('names the folder by its name, never by a path with slashes', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <ExportDialog canExport folder="behoerden/finanzamt" currentYear={2026} open onOpenChange={() => {}} />
      </NextIntlClientProvider>
    );
    const radio = screen.getByRole('radio', { name: /Diesen Ordner/ });
    const label = radio.closest('label')!.textContent!;
    expect(label).toContain('finanzamt');
    expect(label).not.toContain('/');
  });
});
