// @vitest-environment jsdom
import type { DashboardTileView } from '@kompass/core';
import { cleanup, render, screen, within } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { TileCard } from '@/app/(shell)/dashboard/tile-card';
import { buttonVariants } from '@/components/ui/button';
import { DateFormatProvider } from '@/components/date-format-provider';
import type { DateFormatter } from '@/lib/date-format';
import { formatDate, formatDateTime, formatTime } from '@/lib/dates';

vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => createTranslator({ locale: 'de', messages, namespace: namespace as never }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('@/app/(shell)/due-actions', () => ({ completeDueAction: async () => ({ status: 'success' }) }));

/**
 * Die Widgets der Startseite nach Art (Briefing Startseite § 4, Vorgaben Teil M): Zahl als Ganzes ein Link, Liste über
 * Titel und Zeilen, Warnung mit einem Knopf mit Verb, Ruhe als gedämpfte Zeile ohne Ziel. Kein „Zu …“-Knopf.
 */
afterEach(cleanup);

const fmt: DateFormatter = {
  mode: 'locale',
  timeZone: 'Europe/Berlin',
  date: (v) => formatDate(v, 'locale', 'Europe/Berlin'),
  dateTime: (v, o) => formatDateTime(v, 'locale', 'Europe/Berlin', undefined, o),
  time: (v) => formatTime(v, 'Europe/Berlin'),
};
async function show(view: DashboardTileView): Promise<HTMLElement> {
  const ui = (await TileCard({ view, canComplete: false, fmt })) as ReactElement;
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">{ui}</DateFormatProvider>
    </NextIntlClientProvider>,
  );
  return screen.getByTestId(`dashboard-tile-${view.module}-${view.key}`);
}

const base = { variant: null, warningAction: false, column: 0, options: {}, error: false };
const backup = (tone: 'neutral' | 'warning', warningAction = true): DashboardTileView =>
  ({ ...base, module: 'core', key: 'backup', kind: 'status', warningAction, content: { kind: 'status', tone, messageKey: tone === 'neutral' ? 'recent' : 'never', values: { days: 2 }, href: '/admin/backup' } }) as DashboardTileView;
const drafts = (count: number): DashboardTileView => ({ ...base, module: 'dms', key: 'drafts', kind: 'count', content: { kind: 'count', count, href: '/dms?phase=draft' } }) as DashboardTileView;
const site = (): DashboardTileView =>
  ({ ...base, module: 'site', key: 'site', kind: 'status', warningAction: true, content: { kind: 'status', tone: 'info', messageKey: 'changed', values: { count: 2 }, href: '/site/publish' } }) as DashboardTileView;
const inbox = (total: number): DashboardTileView =>
  ({
    ...base,
    module: 'dms',
    key: 'inbox',
    kind: 'list',
    content: { kind: 'list', total, href: '/dms?inbox=1', lines: Array.from({ length: Math.min(total, 10) }, (_, i) => ({ title: `Eingang ${i + 1}`, href: `/dms/${i}` })) },
  }) as DashboardTileView;
const todo = (count: number): DashboardTileView =>
  ({
    ...base,
    module: 'finance',
    key: 'todo',
    kind: 'list',
    variant: 'work',
    content: { kind: 'list', total: count, href: '/finance/entries', lines: Array.from({ length: count }, (_, i) => ({ title: `Arbeit ${i + 1}`, href: `/x/${i}` })) },
  }) as DashboardTileView;

/** Ein Link, der wie ein Knopf aussieht: trägt alle Klassen von `buttonVariants({ variant: 'outline' })`. */
const OUTLINE = buttonVariants({ variant: 'outline' }).split(/\s+/);
const buttonLinks = (root: HTMLElement) => within(root).queryAllByRole('link').filter((a) => OUTLINE.every((c) => a.classList.contains(c)));

describe('TileCard', () => {
  it('Zahl: das ganze Widget ist der Link, die Kennung steht außen (Briefing § 4)', async () => {
    const tile = await show(drafts(2));
    expect(tile.tagName).toBe('SECTION');
    const link = within(tile).getByRole('link');
    expect(link.getAttribute('href')).toBe('/dms?phase=draft');
    expect(link.textContent).toContain('Entwürfe');
    expect(link.textContent).toContain('2');
    expect(link.className).toMatch(/\bmin-h-\[124px\]/);
    expect(link.className).toMatch(/\bhover:bg-hover\b/);
  });

  it('Ruhe: eine gedämpfte Zeile ohne Fläche und ohne Ziel — leere Zahl wie „alles in Ordnung“ (Briefing § 4)', async () => {
    for (const view of [drafts(0), backup('neutral')]) {
      const tile = await show(view);
      expect(tile.getAttribute('data-tone')).toBe('ok');
      expect(within(tile).queryAllByRole('link')).toHaveLength(0);
      expect(tile.className).toMatch(/\bborder-line-2\b/);
      expect(tile.className).not.toMatch(/\bbg-surface\b/);
      expect(within(tile).getByRole('heading').textContent).not.toBe('');
      cleanup();
    }
  });

  it('wartende Arbeit (Ton info) steht wie eine Zahl: der Satz statt der Zahl, das Widget ist der Link, kein Knopf (Vorgaben 3)', async () => {
    const tile = await show(site());
    expect(tile.getAttribute('data-tone')).not.toBe('ok');
    const link = within(tile).getByRole('link');
    expect(link.getAttribute('href')).toBe('/site/publish');
    expect(link.textContent).toContain('2 Änderungen seit dem letzten Publizieren.');
    expect(buttonLinks(tile)).toHaveLength(0);
  });

  it('Warnung: Zeichen vor dem Titel, ein Satz, ein Knopf mit Verb', async () => {
    const tile = await show(backup('warning'));
    expect(tile.getAttribute('data-tone')).toBe('warning');
    expect(within(tile).getByRole('link', { name: 'Backup erstellen' }).getAttribute('href')).toBe('/admin/backup');
    expect(buttonLinks(tile)).toHaveLength(1);
  });

  it('eine Warnung ohne Verb zeigt keinen Knopf', async () => {
    const tile = await show(backup('warning', false));
    expect(within(tile).queryAllByRole('link')).toHaveLength(0);
  });

  it('Liste: Titel mit Ziel, Zähler rechts, höchstens fünf Zeilen, dann „Alle n anzeigen“', async () => {
    const tile = await show(inbox(44));
    expect(within(tile).getByRole('link', { name: 'Eingangskorb' }).getAttribute('href')).toBe('/dms?inbox=1');
    expect(within(tile).getAllByRole('listitem')).toHaveLength(5);
    expect(within(tile).getByRole('link', { name: 'Alle 44 anzeigen' }).getAttribute('href')).toBe('/dms?inbox=1');
    expect(tile.textContent).toContain('44');
  });

  it('ein umbrechender Listentitel trägt das › am Ende seiner letzten Zeile: es hängt am letzten Wort (Befund 1, 218)', async () => {
    const partner = {
      ...base,
      module: 'finance',
      key: 'partnerPaymentsWithoutProof',
      kind: 'list',
      content: { kind: 'list', total: 1, href: '/finance/partners', lines: [{ title: 'Hilfswerk', href: '/finance/partners/1' }] },
    } as DashboardTileView;
    const tile = await show(partner);
    const link = within(tile).getByRole('link', { name: 'Zahlungen an Partner ohne Nachweis' });
    // Kein `inline-flex`: Der Link fließt als Text, sonst stünde das › mittig neben dem ganzen Titelblock.
    expect(link.className).not.toMatch(/\binline-flex\b/);
    const glued = link.querySelector('svg')!.parentElement!;
    expect(glued.className).toMatch(/\bwhitespace-nowrap\b/);
    expect(glued.textContent).toBe('Nachweis');
  });

  it('Zahl: die Kontextzeile hat höchstens eine Zeile, der volle Text steht im `title` (Befund 2)', async () => {
    const proposals = {
      ...base,
      module: 'animals',
      key: 'proposalsOpen',
      kind: 'count',
      content: { kind: 'count', count: 8, href: '/animals/proposals', note: { messageKey: 'oldest', values: { days: 5, conflicts: 1 } } },
    } as DashboardTileView;
    const tile = await show(proposals);
    // Das Wichtigere zuerst: der Konflikt vor dem Alter.
    const note = within(tile).getByText('1 mit Konflikt · ältester seit 5 Tagen');
    expect(note.className).toMatch(/\bline-clamp-1\b/);
    expect(note.getAttribute('title')).toBe('1 mit Konflikt · ältester seit 5 Tagen');
    cleanup();
    const calmer = await show({ ...proposals, content: { kind: 'count', count: 2, href: '/animals/proposals', note: { messageKey: 'oldest', values: { days: 0, conflicts: 0 } } } } as DashboardTileView);
    expect(within(calmer).getByText('ältester seit heute')).toBeTruthy();
  });

  it('Arbeit zeigt alle Zeilen, der Titel ist kein Link', async () => {
    const tile = await show(todo(13));
    expect(within(tile).getAllByRole('listitem')).toHaveLength(13);
    expect(within(tile).queryByRole('link', { name: 'Finanzen: zu tun' })).toBeNull();
    expect(within(tile).queryByText(/^Alle \d+ anzeigen$/)).toBeNull();
  });

  it('kein „Zu …“-Knopf: einen Link wie einen Knopf trägt nur eine Warnung (Briefing § 4, Plan M2)', async () => {
    for (const view of [drafts(2), drafts(0), site(), inbox(44), todo(13), backup('neutral')]) {
      const tile = await show(view);
      expect(buttonLinks(tile)).toHaveLength(0);
      for (const link of within(tile).queryAllByRole('link')) expect(link.textContent).not.toMatch(/^Zu(m|r)? /);
      cleanup();
    }
  });
});
