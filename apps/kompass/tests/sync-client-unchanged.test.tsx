// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { SyncClient } from '@/app/(shell)/admin/site/sync-client';
import { previewSyncAction } from '@/app/(shell)/site/actions';

vi.mock('@/app/(shell)/site/actions', () => ({ applySyncAction: vi.fn(), previewSyncAction: vi.fn() }));
afterEach(cleanup);

/**
 * Runde 4, 175: Liest „Vorlage einlesen“ denselben Stand, gibt es nichts zu übernehmen — kein Primärknopf. Ohne Befund
 * kann sich trotzdem etwas ändern: andere Dateien (Prüfsumme) oder ein Stand, der nach einem Import ungeprüft ist.
 */
const preview = (checksum: string) => ({ status: 'preview', preview: { name: 'Verein Basis', findings: [], blocking: [], localesMissing: [], checksum } });
const show = async (props: { currentChecksum: string | null; needsReview?: boolean }, read: string) => {
  vi.mocked(previewSyncAction).mockResolvedValue(preview(read) as never);
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <SyncClient name="Verein Basis" {...props} />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Vorlage einlesen' }));
  await screen.findByRole('region', { name: messages.site.template.findings });
};

describe('Vorlage einlesen ohne Änderung (175)', () => {
  it('derselbe Stand: „Keine Änderungen“, kein „Übernehmen“', async () => {
    await show({ currentChecksum: 'abc' }, 'abc');
    expect(screen.getByText(messages.site.template.noFindings)).toBeTruthy();
    expect(screen.queryByRole('button', { name: messages.site.template.apply })).toBeNull();
  });

  it('neue Dateien ohne Befund: „Übernehmen“ bleibt', async () => {
    await show({ currentChecksum: 'abc' }, 'def');
    expect(screen.getByRole('button', { name: messages.site.template.apply })).toBeTruthy();
  });

  it('nach einem Import ungeprüft: „Übernehmen“ bleibt', async () => {
    await show({ currentChecksum: 'abc', needsReview: true }, 'abc');
    expect(screen.getByRole('button', { name: messages.site.template.apply })).toBeTruthy();
  });
});
