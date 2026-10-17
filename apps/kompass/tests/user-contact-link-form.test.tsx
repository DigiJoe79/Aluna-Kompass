// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('@/app/(shell)/admin/users/actions', () => ({ linkUserAction: vi.fn(), unlinkUserAction: vi.fn() }));
vi.mock('@/components/contact-picker', () => ({ ContactPicker: () => <span>Kontaktwahl</span> }));
const { UserContactLinkForm } = await import('@/components/user-contact-link-form');

afterEach(cleanup);

/** 11-1 B27: Der Satz zur eigenen Verknüpfung steht im Dialog, nicht unter „Verknüpfen“ in der Zeile. */
describe('UserContactLinkForm', () => {
  it('erklärt „einmal“ erst im Dialog', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <UserContactLinkForm userId="U" linked={false} linkedName={null} linkedHref={null} controls={{ canLink: true, canUnlink: false, reason: 'ownOnce' }} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId('user-contact-link').textContent).not.toContain('Das geht einmal');
    fireEvent.click(screen.getByRole('button', { name: 'Verknüpfen' }));
    expect(screen.getByRole('dialog').textContent).toContain('Das geht einmal');
  });
});
