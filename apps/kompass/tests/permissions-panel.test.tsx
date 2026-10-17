// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { PermissionsPanel } from '@/app/(shell)/admin/finance/permissions-panel';

vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => createTranslator({ locale: 'de', messages, namespace: namespace as never }),
}));
afterEach(cleanup);

/**
 * „Wer darf was“ (Designer Frage 4, 173): eine Liste je Tätigkeit, nicht je Rolle — eine Zeile je Tätigkeit mit der
 * Unterzeile „erteilt an …“; ohne Rolle „an keine Rolle erteilt“ im Ton `warning`. „Sichtbare Navigationseinträge“
 * und „Trägt diese Rolle“ stehen im Rolleneditor.
 */
async function show(): Promise<HTMLElement> {
  const ui = (await PermissionsPanel({
    activities: [
      { key: 'read', permission: 'finance.read' },
      { key: 'approve', permission: 'finance.approve' },
    ],
    roles: [
      { id: 'R1', name: 'Administration', permissions: ['finance.read', 'finance.approve'], navigation: ['entries'], holders: ['Anna'] },
      { id: 'R2', name: 'Schatzmeister', permissions: ['finance.read'], navigation: [], holders: [] },
    ].map((r) => ({ ...r, permissions: r.name === 'Administration' ? ['finance.read'] : r.permissions })),
  })) as ReactElement;
  render(<NextIntlClientProvider locale="de" messages={messages}>{ui}</NextIntlClientProvider>);
  return screen.getByTestId('permissions-panel');
}

describe('Wer darf was', () => {
  it('eine Zeile je Tätigkeit mit „erteilt an …“', async () => {
    const panel = await show();
    const rows = within(panel).getAllByTestId('permission-activity');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain(messages.permissions.keys.finance.read.label);
    expect(rows[0]!.textContent).toContain('erteilt an Administration, Schatzmeister');
  });

  it('ohne Rolle „an keine Rolle erteilt“ in Ocker', async () => {
    const panel = await show();
    const none = within(within(panel).getAllByTestId('permission-activity')[1]!).getByText('an keine Rolle erteilt');
    expect(none.className).toContain('text-warning');
  });

  it('keine Navigationseinträge, keine Träger mehr', async () => {
    const panel = await show();
    expect(panel.textContent).not.toContain('Sichtbare Navigationseinträge');
    expect(panel.textContent).not.toContain('Trägt diese Rolle');
  });
});
