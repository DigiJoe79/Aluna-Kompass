// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { FileDropzone } from '@/app/(shell)/dms/receive/file-dropzone';

afterEach(cleanup);

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

const input = () => document.querySelector('input[type=file]') as HTMLInputElement;
const choose = (file: File) => fireEvent.change(input(), { target: { files: [file] } });

/** Plan K8/K9 T6: zwei Optionen, kein neuer Baustein — `accept` und `hint`. Ohne Angabe bleibt die Akte, wie sie ist. */
describe('FileDropzone', () => {
  it('nimmt ohne Angabe PDF und spricht von Texterkennung', () => {
    render(<FileDropzone id="file" name="file" />, { wrapper });
    expect(input().accept).toBe('application/pdf');
    expect(screen.getByText('PDF hierher ziehen')).toBeTruthy();
    expect(screen.getByText('Nur PDF, höchstens 10 MB.')).toBeTruthy();
    choose(new File(['%PDF'], 'brief.pdf', { type: 'application/pdf' }));
    expect(screen.getByText('Texterkennung läuft nach dem Ablegen.')).toBeTruthy();
    expect(screen.getByText(/^PDF · /)).toBeTruthy();
  });

  it('mit accept und hint: eigene Dateitypen, eigener Hinweis, keine Texterkennung', () => {
    render(<FileDropzone id="csv" name="csv" accept=".csv,text/csv" hint="Eine CSV-Datei aus dem Online-Banking." />, { wrapper });
    expect(input().accept).toBe('.csv,text/csv');
    expect(screen.queryByText('PDF hierher ziehen')).toBeNull();
    expect(screen.getByText('Datei hierher ziehen')).toBeTruthy();
    expect(screen.getByText('Eine CSV-Datei aus dem Online-Banking.')).toBeTruthy();
    expect(screen.queryByText('Nur PDF, höchstens 10 MB.')).toBeNull();
    choose(new File(['a;b'], 'umsaetze.csv', { type: 'text/csv' }));
    expect(screen.queryByText('Texterkennung läuft nach dem Ablegen.')).toBeNull();
    expect(screen.getByText(/^CSV · /)).toBeTruthy();
  });
});
