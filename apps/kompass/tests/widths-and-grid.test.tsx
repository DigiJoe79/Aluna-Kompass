// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { Page } from '@/components/page';
import { FormCell, FormGrid, FormRowBreak } from '@/components/forms/form-grid';
import { FormField } from '@/components/forms/form-field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

afterEach(cleanup);

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

/** Handoff Konsistenz § 8a/§ 8b, docs/MUSTER.md § I und § J: drei Seitenbreiten, vier Dialoggrößen, ein Raster. */
describe('Page', () => {
  it.each([
    ['task', 'max-w-task'],
    ['standard', 'max-w-standard'],
  ] as const)('%s begrenzt Kopf und Inhalt linksbündig', (width, cls) => {
    render(<Page width={width} header={<h2>Kopf</h2>}><p>Inhalt</p></Page>);
    const frame = screen.getByText('Kopf').parentElement!;
    expect(frame.className).toContain(cls);
    expect(frame.className).not.toContain('mx-auto');
    expect(frame.contains(screen.getByText('Inhalt'))).toBe(true);
  });

  it('full setzt keine Grenze', () => {
    render(<Page width="full"><p>Inhalt</p></Page>);
    expect(screen.getByText('Inhalt').parentElement!.className).not.toMatch(/max-w-/);
  });

  // Eine volle Seite braucht keinen eigenen Rahmen: Arbeitsflächen holen ihre Höhe aus dem Hauptbereich
  // (`min-h-full`, `h-[calc(100%+3rem)]`), und ein Block dazwischen ohne Höhe nähme sie ihnen (HANDOFF § 8c).
  it('full ist ohne eigenen Kasten, damit Arbeitsflächen die Höhe des Hauptbereichs behalten', () => {
    render(<Page width="full"><p>Inhalt</p></Page>);
    expect(screen.getByText('Inhalt').parentElement!.className.split(' ')).toContain('contents');
  });

  it.each(['task', 'standard'] as const)('%s bleibt ein Block mit Grenze', (width) => {
    render(<Page width={width}><p>Inhalt</p></Page>);
    expect(screen.getByText('Inhalt').parentElement!.className.split(' ')).not.toContain('contents');
  });
});

describe('FormGrid und FormField size', () => {
  it('rastert nach Kartenbreite: eine, ab 420 zwei, ab 880 vier Spalten', () => {
    render(<FormGrid><FormField id="a" label="A"><Input id="a" /></FormField></FormGrid>);
    const grid = screen.getByLabelText('A').closest('.grid')!;
    expect(grid.className).toContain('grid-cols-1');
    expect(grid.className).toContain('@[420px]:grid-cols-2');
    expect(grid.className).toContain('@[880px]:grid-cols-4');
    expect(grid.parentElement!.className).toContain('@container');
  });

  it.each([
    ['s', [], ['col-span-2', 'col-span-3', 'col-span-4']],
    ['m', ['@[880px]:col-span-2'], ['@[420px]:col-span-2']],
    ['l', ['@[420px]:col-span-2', '@[880px]:col-span-3'], []],
    ['full', ['@[420px]:col-span-2', '@[880px]:col-span-4'], []],
  ] as const)('size %s spannt die richtigen Spalten', (size, has, hasNot) => {
    render(<FormField id="f" label="Feld" size={size}><Input id="f" /></FormField>);
    const cell = screen.getByText('Feld').parentElement!;
    for (const c of has) expect(cell.className).toContain(c);
    for (const c of hasNot) expect(cell.className).not.toContain(c);
  });

  it('m ist der Standard', () => {
    render(<FormField id="f" label="Feld"><Input id="f" /></FormField>);
    expect(screen.getByText('Feld').parentElement!.className).toContain('@[880px]:col-span-2');
  });

  it('ein Umschalter steht mit dem Label in einer Zeile, unten bündig mit den Feldern der Zeile', () => {
    render(<FormField id="t" label="Im Ausland" toggle><Switch id="t" /></FormField>);
    const row = screen.getByText('Im Ausland').parentElement!;
    expect(row.className).toContain('h-[var(--field-h)]');
    expect(row.firstElementChild).toBe(screen.getByRole('switch'));
    expect(row.parentElement!.className).toContain('self-end');
    expect(screen.getByRole('switch', { name: 'Im Ausland' })).toBeTruthy();
  });

  it('FormRowBreak erzwingt eine neue Zeile', () => {
    const { container } = render(<FormRowBreak />);
    expect((container.firstElementChild as HTMLElement).className).toContain('col-span-full');
  });
});

/** HANDOFF Konsistenz § 8c (Freigabe Joe 05.10.): alles im `FormGrid`, das selbst kein `FormField` ist. */
describe('FormCell size', () => {
  it.each([
    ['s', [], ['col-span-2', 'col-span-3', 'col-span-4']],
    ['m', ['@[880px]:col-span-2'], ['@[420px]:col-span-2']],
    ['l', ['@[420px]:col-span-2', '@[880px]:col-span-3'], []],
    ['full', ['@[420px]:col-span-2', '@[880px]:col-span-4'], []],
  ] as const)('size %s spannt dieselben Spalten wie FormField', (size, has, hasNot) => {
    render(<FormCell size={size}>Zelle</FormCell>);
    const cell = screen.getByText('Zelle');
    for (const c of has) expect(cell.className).toContain(c);
    for (const c of hasNot) expect(cell.className).not.toContain(c);
  });

  it('m ist der Standard, ein div ohne Angabe', () => {
    render(<FormCell>Zelle</FormCell>);
    const cell = screen.getByText('Zelle');
    expect(cell.tagName).toBe('DIV');
    expect(cell.className).toContain('@[880px]:col-span-2');
  });

  it('behält Element, eigene Klassen und übrige Angaben', () => {
    render(<FormCell as="p" size="full" className="text-[12px]" data-testid="hinweis">Zelle</FormCell>);
    const cell = screen.getByTestId('hinweis');
    expect(cell.tagName).toBe('P');
    expect(cell.className).toContain('text-[12px]');
    expect(cell.className).toContain('@[880px]:col-span-4');
  });
});

describe('DialogContent size', () => {
  it.each([
    ['sm', 'sm:max-w-dialog-sm', 'max-sm:bottom-0'],
    ['md', 'sm:max-w-dialog-md', 'max-sm:bottom-0'],
    ['lg', 'sm:max-w-dialog-lg', 'max-sm:h-full'],
    ['xl', 'sm:max-w-dialog-xl', 'max-sm:h-full'],
  ] as const)('%s setzt Breite, Polster und das Telefon-Verhalten', (size, width, phone) => {
    render(<Dialog open><DialogContent size={size}><DialogTitle>Titel</DialogTitle></DialogContent></Dialog>, { wrapper });
    const popup = screen.getByRole('dialog');
    expect(popup.className).toContain(width);
    expect(popup.className).toContain(phone);
    expect(popup.className).toContain('[--dialog-pad:1.25rem]');
    expect(popup.className).not.toContain('sm:max-w-sm');
  });

  it('mobile übersteuert das Telefon-Verhalten', () => {
    render(<Dialog open><DialogContent size="sm" mobile="full"><DialogTitle>Titel</DialogTitle></DialogContent></Dialog>, { wrapper });
    const popup = screen.getByRole('dialog');
    expect(popup.className).toContain('max-sm:h-full');
    expect(popup.className).not.toContain('max-sm:bottom-0');
  });

  it('hat keinen Rückfall auf die alte Breite: size ist Pflicht', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../src/components/ui/dialog.tsx'), 'utf8');
    expect(source).not.toContain('sm:max-w-sm');
    expect(source).not.toContain('[--dialog-pad:1rem]');
    // @ts-expect-error — ohne `size` übersetzt ein Dialog nicht (Handoff Konsistenz § 8c).
    void (<DialogContent><DialogTitle>Titel</DialogTitle></DialogContent>);
  });

  it('der Fuß schließt mit dem Polster des Dialogs ab', () => {
    render(<Dialog open><DialogContent size="md"><DialogTitle>Titel</DialogTitle><DialogFooter>Fuß</DialogFooter></DialogContent></Dialog>, { wrapper });
    const footer = screen.getByText('Fuß').closest('[data-slot="dialog-footer"]')!;
    expect(footer.className).toContain('-mx-5');
    expect(footer.className).toContain('-mb-5');
  });

  it('fixed-footer bleibt randlos', () => {
    render(<Dialog open><DialogContent size="lg" layout="fixed-footer"><DialogTitle>Titel</DialogTitle></DialogContent></Dialog>, { wrapper });
    expect(screen.getByRole('dialog').className).toContain('[--dialog-pad:0px]');
    expect(screen.getByRole('dialog').className).not.toContain('[--dialog-pad:1.25rem]');
  });
});

describe('SheetContent size', () => {
  it.each([
    ['sm', 'sm:max-w-sheet-sm'],
    ['md', 'sm:max-w-sheet-md'],
  ] as const)('%s setzt die Breite, auf dem Telefon volle Breite', (size, width) => {
    render(<Sheet open><SheetContent size={size}><SheetTitle>Titel</SheetTitle></SheetContent></Sheet>, { wrapper });
    const popup = screen.getByRole('dialog');
    expect(popup.className).toContain(width);
    expect(popup.className).toContain('w-full');
    expect(popup.className).not.toContain('w-3/4');
  });

  it('hat keinen Rückfall auf die alte Breite: size ist Pflicht', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../src/components/ui/sheet.tsx'), 'utf8');
    expect(source).not.toContain('w-3/4');
    expect(source).not.toContain('sm:max-w-sm');
    // @ts-expect-error — ohne `size` übersetzt ein Seitenfenster nicht.
    void (<SheetContent><SheetTitle>Titel</SheetTitle></SheetContent>);
  });
});
