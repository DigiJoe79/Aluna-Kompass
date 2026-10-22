// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const setMediaAiKindAction = vi.fn();
vi.mock('@/app/(shell)/admin/media/actions', () => ({ setMediaAiKindAction: (...args: unknown[]) => setMediaAiKindAction(...args) }));

const { ImageLabelingDialog } = await import('@/components/media/image-labeling-dialog');
type Props = Parameters<typeof ImageLabelingDialog>[0];

afterEach(cleanup);
beforeEach(() => setMediaAiKindAction.mockReset().mockResolvedValue({ status: 'success' }));

const Intl = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
    {children}
  </NextIntlClientProvider>
);

const items: Props['items'] = [
  { id: 'a', filename: 'a.jpg', mimeType: 'image/jpeg', aiKind: 'none', created: true },
  { id: 'p', filename: 'b.pdf', mimeType: 'application/pdf', aiKind: 'none', created: true },
  { id: 'd', filename: 'd.jpg', mimeType: 'image/jpeg', aiKind: 'edited', created: false },
];

function open(props: Partial<Props> = {}) {
  const all: Props = { open: true, onOpenChange: vi.fn(), items, description: 'Beschreibung', footer: 'Fuß', confirmLabel: 'Fertig', onConfirm: vi.fn(), onLabeled: vi.fn(), ...props };
  render(<ImageLabelingDialog {...all} />, { wrapper: Intl });
  return all;
}

describe('ImageLabelingDialog', () => {
  it('eine Zeile je Bild, kein PDF; das Duplikat mit Art zeigt die Marke statt des Umschalters', () => {
    open();
    const rows = screen.getAllByTestId('labeling-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getAllByRole('radio')).toHaveLength(3);
    expect(within(rows[0]!).getByRole('radiogroup', { name: 'a.jpg' })).toBeTruthy();
    expect(within(rows[1]!).queryByRole('radiogroup')).toBeNull();
    expect(within(rows[1]!).getByTestId('ai-kind-badge')).toBeTruthy();
  });

  it('ein Duplikat ohne Art wird gefragt wie ein neues Bild', () => {
    open({ items: [{ id: 'd', filename: 'd.jpg', mimeType: 'image/jpeg', aiKind: 'none', created: false }] });
    expect(screen.getByRole('radiogroup', { name: 'd.jpg' })).toBeTruthy();
  });

  it('„Keine“ trägt kein Symbol, die anderen Optionen je eines', () => {
    open();
    const radios = within(screen.getAllByTestId('labeling-row')[0]!).getAllByRole('radio');
    expect(radios.map((r) => r.querySelectorAll('svg').length)).toEqual([0, 1, 1]);
  });

  it('jede Wahl speichert sofort und meldet sie', async () => {
    const props = open();
    fireEvent.click(screen.getAllByRole('radio')[1]!);
    await waitFor(() => expect(props.onLabeled).toHaveBeenCalledWith('a', 'edited'));
    expect(setMediaAiKindAction).toHaveBeenCalledWith('a', 'edited');
  });

  it('scheitert das Speichern, springt die Auswahl zurück und der Grund steht an der Zeile', async () => {
    setMediaAiKindAction.mockResolvedValue({ status: 'error', message: 'Die Bildkennzeichnung ist ausgeschaltet.', fieldErrors: {} });
    const props = open();
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[2]!);
    const reason = await screen.findByText('Die Bildkennzeichnung ist ausgeschaltet.');
    expect(radios[0]!.getAttribute('aria-checked')).toBe('true');
    const group = screen.getByRole('radiogroup', { name: 'a.jpg' });
    expect(group.getAttribute('aria-invalid')).toBe('true');
    const described = (group.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id));
    expect(described.some((el) => el?.contains(reason))).toBe(true);
    expect(props.onLabeled).not.toHaveBeenCalled();
  });

  it('der Hinweis zur Schwelle steht einmal, jeder Umschalter verweist darauf', () => {
    open({ items: [items[0]!, { ...items[0]!, id: 'b', filename: 'b.jpg' }] });
    const hints = screen.getAllByText(messages.media.aiKind.hint);
    expect(hints).toHaveLength(1);
    for (const group of screen.getAllByRole('radiogroup')) expect(group.getAttribute('aria-describedby')).toContain(hints[0]!.id);
  });

  it('× schließt nur, der Knopf bestätigt', () => {
    const props = open();
    fireEvent.click(screen.getByRole('button', { name: messages.common.close }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false, expect.anything());
    expect(props.onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('nachträglich mit „Verwendet“', () => {
    open({ items: [items[0]!], usage: [{ label: 'Tier „Rex“' }] });
    expect(screen.getByText('Tier „Rex“')).toBeTruthy();
  });
});
