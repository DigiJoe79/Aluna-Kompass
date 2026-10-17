// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { PageHeader } from '@/components/page-header';
import { RecordActions } from '@/components/record-actions';
import { StatusBadge } from '@/components/status-badge';

afterEach(cleanup);

describe('PageHeader status', () => {
  it('die Marke steht direkt nach dem h1, nicht darin (Spec Seitenkopf § 3.4)', () => {
    render(<PageHeader title="Partner X" status={<StatusBadge tone="neutral">archiviert</StatusBadge>} />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe('Partner X');
    expect(h1.nextElementSibling?.textContent).toBe('archiviert');
  });
});

describe('PageHeader Schrift (K10 Charge 3)', () => {
  it('das h1 trägt die Rolle Seitentitel in der Serife', () => {
    render(<PageHeader title="Spenden" />);
    expect(screen.getByRole('heading', { level: 1 }).className.split(/\s+/)).toEqual(expect.arrayContaining(['font-heading', 'text-page-title']));
  });
});

describe('PageHeader more — Kopfaktionen am Telefon (Runde 3, 018)', () => {
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        {children}
      </NextIntlClientProvider>
    );
  }
  function setPhone(phone: boolean) {
    window.matchMedia = ((query: string) => ({ matches: phone, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  }
  afterEach(() => {
    // jsdom kennt kein matchMedia; jeder Test setzt es selbst.
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  const exportAction = (onSelect = vi.fn()) => ({ key: 'export', label: 'Akte exportieren', onSelect });

  it('ab sm stehen Nebenaktionen als outline-Knöpfe vor den Aktionen, am Telefon ausgeblendet', () => {
    setPhone(false);
    render(<PageHeader title="Akte" more={[exportAction(), { key: 'receive', label: 'Post ablegen', href: '/dms/receive' }]} actions={<button type="button">Neuer Entwurf</button>} />, { wrapper });
    const exportButton = screen.getByRole('button', { name: 'Akte exportieren' });
    expect(exportButton.className).toContain('max-sm:hidden');
    expect(exportButton.hasAttribute('data-header-more-button')).toBe(true);
    const link = screen.getByRole('link', { name: 'Post ablegen' });
    expect(link.getAttribute('href')).toBe('/dms/receive');
    expect(link.className).toContain('max-sm:hidden');
    const names = screen.getAllByRole('button').concat(link).map((el) => el.textContent);
    // Reihenfolge im Kopf: Nebenaktionen, dann Primärknopf, dann ⋯ (nur am Telefon sichtbar).
    const order = [...document.querySelectorAll('[data-slot="page-header-actions"] > *')].map((el) => el.getAttribute('aria-label') ?? el.textContent);
    expect(order).toEqual(['Akte exportieren', 'Post ablegen', 'Neuer Entwurf', 'Weitere Aktionen']);
    expect(names).toContain('Neuer Entwurf');
  });

  it('ohne RecordActions trägt der Kopf ein eigenes ⋯ fürs Telefon mit den Nebenaktionen', async () => {
    setPhone(true);
    const onSelect = vi.fn();
    render(<PageHeader title="Akte" more={[exportAction(onSelect)]} actions={<button type="button">Neuer Entwurf</button>} />, { wrapper });
    const trigger = screen.getByRole('button', { name: 'Weitere Aktionen' });
    expect(trigger.hasAttribute('data-header-more')).toBe(true);
    expect(trigger.className).toContain('sm:hidden');
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Akte exportieren' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('mit RecordActions verschmelzen beide am Telefon zu einem ⋯: Nebenaktionen oben, dann die Aktionen am Datensatz', async () => {
    setPhone(true);
    render(
      <PageHeader
        title="Bello"
        more={[exportAction()]}
        actions={<RecordActions actions={[{ key: 'del', label: 'Löschen …', kind: 'delete', onSelect: vi.fn() }]} />}
      />,
      { wrapper },
    );
    const [own, header] = screen.getAllByRole('button', { name: 'Weitere Aktionen' });
    // Das eigene ⋯ (`data-header-more`) blendet globals.css aus, sobald ein RecordActions dasteht.
    expect(own!.hasAttribute('data-header-more')).toBe(false);
    expect(header!.hasAttribute('data-header-more')).toBe(true);
    fireEvent.click(own!);
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Akte exportieren', 'Löschen …']);
  });

  it('ab sm zeigt das ⋯ von RecordActions nur die Aktionen am Datensatz', async () => {
    setPhone(false);
    render(<PageHeader title="Bello" more={[exportAction()]} actions={<RecordActions actions={[{ key: 'del', label: 'Löschen …', kind: 'delete', onSelect: vi.fn() }]} />} />, { wrapper });
    fireEvent.click(screen.getAllByRole('button', { name: 'Weitere Aktionen' })[0]!);
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Löschen …']);
  });

  it('versteckte Nebenaktionen fallen weg; ohne sichtbare kein ⋯ und keine leere Aktionszeile', () => {
    render(<PageHeader title="Akte" more={[{ ...exportAction(), hidden: true }]} />, { wrapper });
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('[data-slot="page-header-actions"]')).toBeNull();
  });
});
