// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('@/app/(shell)/dms/actions', () => ({
  fileDocumentAction: vi.fn(),
  previewNumberAction: vi.fn(async (typeKey: string) => (typeKey === 'letter' ? { number: 'BRF-2026-014' } : { number: null })),
}));

const { FileDialog } = await import('@/app/(shell)/dms/[id]/file-dialog');

afterEach(() => cleanup());

function show(typeKey: string) {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <FileDialog documentId="d1" typeKey={typeKey} />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Festschreiben' }));
}

// Runde 3, 035: Der Dialog nennt die Nummer, die gezogen wird — wie „Post ablegen“.
describe('FileDialog', () => {
  it('nennt die Nummer, die das Festschreiben zieht', async () => {
    show('letter');
    expect(await screen.findByText('BRF-2026-014')).toBeTruthy();
    expect(screen.getByRole('alertdialog').textContent).toContain('Beim Festschreiben bekommt das Dokument die Nummer BRF-2026-014.');
  });

  it('ohne lesbare Nummer bleibt es beim allgemeinen Satz', async () => {
    show('protected');
    await Promise.resolve();
    expect(screen.queryByText(/BRF-/)).toBeNull();
  });
});
