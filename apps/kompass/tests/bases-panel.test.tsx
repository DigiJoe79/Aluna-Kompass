// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/admin/documents/actions', () => ({ setDocumentBaseAction: vi.fn() }));
const { BasesPanel } = await import('@/app/(shell)/admin/documents/bases-panel');
afterEach(cleanup);

const bases = [
  { id: 'a4-plain-slim', label: 'A4 schlank', kind: 'report', own: false, ok: true },
  { id: 'a4-brief', label: 'A4 Brief', kind: 'letter', own: true, ok: true },
];
const row = (key: string, override: string | null) => ({
  key,
  label: key === 'export' ? 'Export' : 'Brief',
  defaultBase: 'a4-plain-slim',
  override,
  effectiveBase: override ?? 'a4-plain-slim',
  effectiveLabel: override ? 'A4 Brief' : 'A4 schlank',
  available: true,
});
const show = (rows: ReturnType<typeof row>[]) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <BasesPanel bases={bases} groups={[{ module: 'core', moduleLabel: 'Kern', rows }]} canManage />
    </NextIntlClientProvider>,
  );

/** Runde 3, 165: Normalfall ohne Marke, die Auswahl nennt den Namen der Vorlage, „Erscheint auf“ nur bei Abweichung. */
describe('BasesPanel', () => {
  it('zeigt nur „eigene“ als Marke, nicht „mitgeliefert“ und „bereit“', () => {
    show([row('export', null)]);
    const region = screen.getByRole('region', { name: 'Basis-Vorlagen' });
    expect(within(region).queryByText('mitgeliefert')).toBeNull();
    expect(within(region).queryByText('bereit')).toBeNull();
    expect(within(region).getByText('eigene')).toBeTruthy();
  });

  it('Vorgabe mit dem Namen der Basis; ohne Abweichung keine Spalte „Erscheint auf“', () => {
    show([row('export', null)]);
    const types = screen.getByRole('region', { name: 'Dokumentarten' });
    expect(within(types).getAllByRole('option')[0]!.textContent).toBe('Vorgabe der Vorlage (A4 schlank)');
    expect(within(types).queryByTestId('effective-base')?.textContent ?? '').toBe('');
  });

  it('mit Abweichung steht, worauf die Art erscheint', () => {
    show([row('export', 'a4-brief')]);
    const types = screen.getByRole('region', { name: 'Dokumentarten' });
    expect(within(types).getByTestId('effective-base').textContent).toContain('A4 Brief');
    expect(within(types).getByText('abweichend')).toBeTruthy();
  });
});
