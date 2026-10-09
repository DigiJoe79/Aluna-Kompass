// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { orderRecordActions, RecordActions, type RecordAction, type RecordActionKind } from '@/components/record-actions';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}
const show = (ui: React.ReactElement) => render(ui, { wrapper });
const a = (key: string, kind: RecordActionKind, extra: Partial<RecordAction> = {}): RecordAction => ({ key, label: `${key} …`, kind, onSelect: vi.fn(), ...extra });

afterEach(cleanup);

describe('RecordActions', () => {
  it('ordnet umkehrbar → rückgängig machend → löschen, innerhalb der Art in Eingabefolge', () => {
    expect(orderRecordActions([a('del', 'delete'), a('void', 'undoing'), a('arch', 'reversible'), a('void2', 'undoing')]).map((x) => x.key)).toEqual(['arch', 'void', 'void2', 'del']);
  });

  it('ohne sichtbaren Eintrag kein Knopf', () => {
    const { container } = show(<RecordActions actions={[a('del', 'delete', { hidden: true })]} />);
    expect(container.innerHTML).toBe('');
  });

  it('Seitenkopf: auch bei einem Eintrag ein Menü mit „Weitere Aktionen“; Wahl ruft onSelect', async () => {
    const del = a('del', 'delete', { testId: 'del-item' });
    show(<RecordActions actions={[del]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'del …' }));
    expect(del.onSelect).toHaveBeenCalledTimes(1);
  });

  it('eigene Beschriftung des Auslösers über label', () => {
    show(<RecordActions label="Aktionen am Konto" actions={[a('del', 'delete')]} />);
    expect(screen.getByRole('button', { name: 'Aktionen am Konto' })).toBeTruthy();
  });

  it('Fuß mit single="button": genau ein Eintrag als Knopf, zwei als Menü', () => {
    show(<RecordActions single="button" actions={[a('del', 'delete')]} />);
    expect(screen.getByRole('button', { name: 'del …' })).toBeTruthy();
    cleanup();
    show(<RecordActions single="button" actions={[a('arch', 'reversible'), a('del', 'delete')]} />);
    expect(screen.getByRole('button', { name: 'Weitere Aktionen' })).toBeTruthy();
  });
});
