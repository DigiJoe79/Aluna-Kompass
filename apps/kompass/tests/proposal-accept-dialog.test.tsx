// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/animals/proposals/P1' }));

import { AcceptDialog } from '@/app/(shell)/animals/proposals/accept-dialog';
import { RejectDialog } from '@/app/(shell)/animals/proposals/reject-dialog';

function Intl({ children }: { children: ReactNode }) {
  return <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{children}</NextIntlClientProvider>;
}
afterEach(cleanup);

const accept = vi.fn();
beforeEach(() => {
  accept.mockReset();
  accept.mockResolvedValue({ status: 'success', message: 'Angenommen.' });
});
const summary = { taken: ['Status (Reserviert)', 'Größe (cm)'], kept: ['Kurztext (in Kompass geändert)'], photos: '2 dazu, 1 weg, Titelbild wechselt' };
const base = { open: true, onOpenChange: () => {}, title: 'Änderung an Bruno annehmen', summary, kind: 'update' as const, sourceName: 'Tierbörse', willChange: true, askYear: false, canFollowUp: true, photoCount: 0 };

describe('AcceptDialog (Board 6a/6b)', () => {
  it('summarises what is taken and kept and says how the source will hear it', () => {
    render(<AcceptDialog {...base} onAccept={accept} />, { wrapper: Intl });
    expect(screen.getByText('Wird als „angenommen mit Änderungen“ an Tierbörse zurückgemeldet.')).toBeTruthy();
    expect(screen.getByText('Status (Reserviert), Größe (cm)')).toBeTruthy();
    expect(screen.getByText('Kurztext (in Kompass geändert)')).toBeTruthy();
    expect(screen.getByText('2 dazu, 1 weg, Titelbild wechselt')).toBeTruthy();
  });

  it('asks for the year when the status becomes adopted', async () => {
    render(<AcceptDialog {...base} askYear onAccept={accept} />, { wrapper: Intl });
    expect((screen.getByLabelText('Vermittlungsjahr') as HTMLInputElement).value).toBe(String(new Date().getFullYear()));
    fireEvent.click(screen.getByRole('button', { name: 'Annehmen' }));
    await waitFor(() => expect(accept).toHaveBeenCalledWith(expect.objectContaining({ adoptedYear: new Date().getFullYear() })));
  });

  it('takes the year the source named instead of the current one', async () => {
    render(<AcceptDialog {...base} askYear defaultYear={2025} onAccept={accept} />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('button', { name: 'Annehmen' }));
    await waitFor(() => expect(accept).toHaveBeenCalledWith(expect.objectContaining({ adoptedYear: 2025 })));
  });

  it('preselects publishing for a new dog and sends the follow-up only when ticked', async () => {
    render(<AcceptDialog {...base} kind="create" title="Lotte anlegen" willChange={false} photoCount={3} onAccept={accept} />, { wrapper: Intl });
    expect(screen.getByText('Wird als „angenommen“ an Tierbörse zurückgemeldet. 3 Fotos gehen in die Mediathek.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Veröffentlichen/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Annehmen' }));
    await waitFor(() => expect(accept).toHaveBeenCalledWith({ publish: true, adoptedYear: undefined, followUp: undefined }));
    accept.mockClear();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Wiedervorlage anlegen' }));
    fireEvent.change(screen.getByLabelText('Notiz'), { target: { value: 'Neue Fotos ansehen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Annehmen' }));
    await waitFor(() => expect(accept).toHaveBeenCalledWith(expect.objectContaining({ followUp: { dueAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), title: 'Neue Fotos ansehen' } })));
  });

  it('offers no follow-up without the right', () => {
    render(<AcceptDialog {...base} canFollowUp={false} onAccept={accept} />, { wrapper: Intl });
    expect(screen.queryByRole('checkbox', { name: 'Wiedervorlage anlegen' })).toBeNull();
  });

  it('keeps the dialog open and shows the refusal', async () => {
    const onOpenChange = vi.fn();
    accept.mockResolvedValueOnce({ status: 'error', message: 'Der Vorschlag ist nicht mehr offen.', fieldErrors: {}, code: 'proposalNotOpen' });
    render(<AcceptDialog {...base} onOpenChange={onOpenChange} onAccept={accept} />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('button', { name: 'Annehmen' }));
    await waitFor(() => expect(screen.getByText('Der Vorschlag ist nicht mehr offen.')).toBeTruthy());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe('RejectDialog (Board 6c)', () => {
  it('sends the optional reason and is not destructive', async () => {
    const reject = vi.fn(async () => ({ status: 'success' }) as const);
    render(<RejectDialog open onOpenChange={() => {}} sourceName="Tierbörse" onReject={reject} />, { wrapper: Intl });
    expect(screen.getByText('Am Hund ändert sich nichts. Die Fotos des Vorschlags werden gelöscht.')).toBeTruthy();
    expect(screen.getByText('Tierbörse bekommt den Grund zurück.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Grund'), { target: { value: 'Kein Hund von uns.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ablehnen' }));
    await waitFor(() => expect(reject).toHaveBeenCalledWith('Kein Hund von uns.'));
  });
});
