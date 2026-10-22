// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileFields } from '@/app/(shell)/animals/animal-fields';
import { primaryIntent } from '@/app/(shell)/animals/list-params';
import { QueueNav } from '@/app/(shell)/animals/queue-nav';
import { PreviewSheet } from '@/app/(shell)/animals/proposals/[id]/preview-sheet';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/animals/proposals/actions', () => ({
  buildProposalPreviewAction: vi.fn(async () => ({ status: 'error', code: 'noAnimalPage', message: 'Die Vorlage der Webseite hat keine Seite für einzelne Hunde.', fieldErrors: {} })),
}));

afterEach(cleanup);

function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

/** Durchsicht 0.2.11, Paket 05 und 14 (Tier-Maske). */
describe('Tier-Maske', () => {
  it('Größe 0 heißt „ohne Angabe“: das Feld bleibt leer (14 A6)', () => {
    render(<ProfileFields values={{ sizeCm: 0 }} locales={['de']} errors={{}} />, { wrapper: Intl });
    expect((document.getElementById('sizeCm') as HTMLInputElement).value).toBe('');
  });

  it('„1 von 1“ zeigt nichts (05 B18)', () => {
    const { container } = render(<QueueNav queue={{ query: 'published=0', position: { index: 1, total: 1, previousId: null, nextId: null } }} />, { wrapper: Intl });
    expect(container.textContent).toBe('');
  });

  it('„Speichern und weiter“ nur, wenn es einen nächsten Eintrag gibt (05 B12)', () => {
    expect(primaryIntent(false, { index: 1, total: 1, previousId: null, nextId: null })).toBeNull();
    expect(primaryIntent(false, { index: 1, total: 2, previousId: null, nextId: 'B' })).toBe('next');
    expect(primaryIntent(true, { index: 1, total: 1, previousId: null, nextId: null })).toBe('confirm');
    expect(primaryIntent(false, null)).toBeNull();
  });

  it('Vorschau ohne Tierseite der Vorlage ist ein Hinweis, keine Ablehnung (05 A3)', async () => {
    render(<PreviewSheet proposalId="P1" name="Frida" kind="update" />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }));
    const text = await screen.findByText('Die Vorlage der Webseite hat keine Seite für einzelne Hunde.', {}, { timeout: 2000 });
    await waitFor(() => expect(text.closest('[role="alert"]')).toBeNull());
  });
});

vi.mock('@/app/(shell)/animals/actions', () => ({ setAnimalStatusAction: vi.fn() }));

describe('Status-Dialog', () => {
  it('der Dialog hat eine Beschreibung für Vorleser (05 B28)', async () => {
    const { StatusDialog } = await import('@/app/(shell)/animals/status-dialog');
    render(<StatusDialog animalId="A1" current="lookingForHome" />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('button', { name: 'Status ändern' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
  });
});
