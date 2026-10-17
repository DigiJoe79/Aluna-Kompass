// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('@/app/(shell)/profile/actions', () => ({ createTokenAction: vi.fn(), revokeTokenAction: vi.fn() }));
const { ApiTokens } = await import('@/app/(shell)/profile/api-tokens');
afterEach(cleanup);

const token = (id: string, daysSinceLastUsed: number | null) => ({
  id,
  name: `Zugang ${id}`,
  prefix: 'dev_abc',
  createdAt: '2026-01-01T10:00:00.000Z',
  lastUsedAt: daysSinceLastUsed === null ? null : '2026-01-02T10:00:00.000Z',
  revokedAt: null,
  daysSinceLastUsed,
});

/** Runde 3, 186: Ein ungenutzter Token ist keine Arbeit (gedämpft); „Token erstellen“ ist sekundär. */
describe('ApiTokens', () => {
  it('„noch nie genutzt“ gedämpft, lange nicht genutzt bleibt ocker; „Token erstellen“ als outline', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <ApiTokens tokens={[token('a', null), token('b', 120)]} />
      </NextIntlClientProvider>,
    );
    const never = screen.getByText(messages.profile.tokens.neverUsed);
    expect(never.className).not.toContain('text-warning');
    expect(never.className).toContain('text-muted-ink');
    expect(screen.getByRole('row', { name: /Zugang b/ }).querySelector('.text-warning')).not.toBeNull();
    expect(screen.getByRole('button', { name: messages.profile.tokens.create }).className).not.toContain('bg-brand');
  });
});
