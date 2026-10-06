// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { FormActionBar } from '@/components/forms/form-action-bar';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

describe('FormActionBar', () => {
  it('zeigt eine Ablehnung über der Leiste, nicht bei Feldfehlern', () => {
    const { rerender } = render(<form><FormActionBar state={{ status: 'error', message: 'Zeitraum geschlossen.', fieldErrors: {} }} /></form>, { wrapper });
    expect(screen.getByRole('alert').textContent).toContain('Zeitraum geschlossen.');
    rerender(<form><FormActionBar state={{ status: 'error', message: 'Zeitraum geschlossen.', fieldErrors: { a: 'b' } }} /></form>);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('schickt beim Bearbeiten ohne Änderung nicht ab und sagt „Nichts geändert“', () => {
    const submit = vi.fn((e: Event) => e.preventDefault());
    render(<form onSubmit={submit as never}><input name="a" defaultValue="x" /><FormActionBar /></form>, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText('Nichts geändert')).toBeTruthy();
  });

  it('schickt beim Bearbeiten mit Änderung ab', () => {
    const submit = vi.fn((e: Event) => e.preventDefault());
    render(<form onSubmit={submit as never}><input name="a" defaultValue="x" aria-label="a" /><FormActionBar /></form>, { wrapper });
    fireEvent.input(screen.getByLabelText('a'), { target: { value: 'y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(submit).toHaveBeenCalledOnce();
  });

  it('schickt beim Anlegen auch ohne Änderung ab (Review Focus 2)', () => {
    const submit = vi.fn((e: Event) => e.preventDefault());
    render(<form onSubmit={submit as never}><input name="a" /><FormActionBar mode="create" /></form>, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(submit).toHaveBeenCalledOnce();
  });

  it('Dialog-Lage: nicht klebend, kein Verwerfen, Abbrechen ruft cancel', () => {
    const cancel = vi.fn();
    const { container } = render(<form><FormActionBar cancel={cancel} /></form>, { wrapper });
    expect(container.innerHTML).not.toContain('sticky');
    expect(screen.queryByRole('button', { name: 'Verwerfen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(cancel).toHaveBeenCalled();
  });

  it('Seiten-Lage klebt', () => {
    const { container } = render(<form><FormActionBar /></form>, { wrapper });
    expect(container.innerHTML).toContain('sticky');
  });

  it('ohne Formular: onSave statt Absenden, gesperrt während pending', () => {
    const onSave = vi.fn();
    const { rerender } = render(<FormActionBar cancel={() => {}} onSave={onSave} saveLabel="Buchen" />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Buchen' }));
    expect(onSave).toHaveBeenCalledOnce();
    rerender(<FormActionBar cancel={() => {}} onSave={onSave} saveLabel="Buchen" pending />);
    expect((screen.getByRole('button', { name: 'Buchen' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Lage „ausführen“: kein Zähler, schickt immer ab', () => {
    const onSave = vi.fn();
    render(<FormActionBar mode="run" onSave={onSave} note="Nummern 12–30" saveLabel="19 erstellen" />, { wrapper });
    expect(screen.getByText('Nummern 12–30')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '19 erstellen' }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('zeigt den Zwischenstand links, wenn keine Notiz da ist', () => {
    render(<FormActionBar mode="create" onSave={() => {}} status={{ state: { kind: 'idle' }, pending: false }} />, { wrapper });
    expect(screen.getByTestId('save-status')).toBeTruthy();
  });

  it('bietet beim Versionskonflikt zwei Auswege auf der Seite, im Dialog nur das Neuladen', () => {
    const stale = { status: 'error' as const, message: 'x', fieldErrors: {}, code: 'staleVersion', detail: 'Der Eintrag wurde inzwischen geändert.' };
    const { rerender } = render(<form><FormActionBar state={stale} /></form>, { wrapper });
    expect(screen.getByRole('button', { name: /neben den neuen Stand/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Eingaben verwerfen/ })).toBeTruthy();
    rerender(<form><FormActionBar cancel={() => {}} state={stale} /></form>);
    expect(screen.queryByRole('button', { name: /neben den neuen Stand/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Eingaben verwerfen/ })).toBeTruthy();
  });
});
