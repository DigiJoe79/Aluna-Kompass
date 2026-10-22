// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { Page } from '@/components/page';
import { FormCell } from '@/components/forms/form-grid';
import { FormField } from '@/components/forms/form-field';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { SheetContent, SheetTitle } from '@/components/ui/sheet';

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

describe('FormField toggle', () => {
  it('der Umschalter trägt das Label als Namen', () => {
    render(<FormField id="t" label="Im Ausland" toggle><Switch id="t" /></FormField>);
    expect(screen.getByRole('switch', { name: 'Im Ausland' })).toBeTruthy();
  });
});

/** HANDOFF Konsistenz § 8c (Freigabe Joe 05.10.): alles im `FormGrid`, das selbst kein `FormField` ist. */
describe('FormCell', () => {
  it('behält Element, eigene Klassen und übrige Angaben', () => {
    render(<FormCell as="p" size="full" className="text-[12px]" data-testid="hinweis">Zelle</FormCell>);
    const cell = screen.getByTestId('hinweis');
    expect(cell.tagName).toBe('P');
    expect(cell.className).toContain('text-[12px]');
  });
});

describe('size ist Pflicht', () => {
  it('DialogContent übersetzt ohne size nicht', () => {
    // @ts-expect-error — ohne `size` übersetzt ein Dialog nicht (Handoff Konsistenz § 8c).
    void (<DialogContent><DialogTitle>Titel</DialogTitle></DialogContent>);
  });

  it('SheetContent übersetzt ohne size nicht', () => {
    // @ts-expect-error — ohne `size` übersetzt ein Seitenfenster nicht.
    void (<SheetContent><SheetTitle>Titel</SheetTitle></SheetContent>);
  });
});

describe('Kleinfehler K10 § 4.6', () => {
  it('das Schließen-Kreuz im Dialog hat 44 px Klickfläche', () => {
    render(<Dialog open><DialogContent size="sm"><DialogTitle>Titel</DialogTitle></DialogContent></Dialog>, { wrapper });
    const close = screen.getByRole('button', { name: 'Schließen' }).className.split(' ');
    expect(close).toEqual(expect.arrayContaining(['after:absolute', 'after:-inset-2']));
  });
});
