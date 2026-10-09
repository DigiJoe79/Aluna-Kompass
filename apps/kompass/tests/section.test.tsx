// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { Section } from '@/components/section';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

afterEach(cleanup);

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

const levelOf = (name: string) => Number(screen.getByRole('heading', { name }).tagName.slice(1));

/** K10 Charge 1, § 4.3: Die Ebene kommt aus dem Umfeld; `level` ist die Ausnahme. */
describe('Section', () => {
  it('steht ohne Umfeld auf Ebene 2', () => {
    render(<Section title="Allein">x</Section>, { wrapper });
    expect(levelOf('Allein')).toBe(2);
  });

  it('steht in Page auf Ebene 2 (der Seitentitel ist h1), verschachtelt eins tiefer', () => {
    render(<Page width="standard" header={<PageHeader title="Seite" />}><Section title="Außen"><Section title="Innen">x</Section></Section></Page>, { wrapper });
    expect(levelOf('Seite')).toBe(1);
    expect(levelOf('Außen')).toBe(2);
    expect(levelOf('Innen')).toBe(3);
  });

  it('steht im Dialog auf Ebene 3, auch wenn der Dialog in einer Page liegt (Review Focus 3)', () => {
    render(
      <Page width="standard">
        <Dialog open><DialogContent size="md"><DialogTitle>Dialog</DialogTitle><Section title="Im Dialog">x</Section></DialogContent></Dialog>
      </Page>,
      { wrapper },
    );
    expect(levelOf('Im Dialog')).toBe(3);
  });

  it('steht im Seitenfenster auf Ebene 3', () => {
    render(<Sheet open><SheetContent size="md"><SheetTitle>Fenster</SheetTitle><Section title="Im Fenster">x</Section></SheetContent></Sheet>, { wrapper });
    expect(levelOf('Im Fenster')).toBe(3);
  });

  it('zählt höchstens bis 4 (Review Focus 4)', () => {
    render(
      <Dialog open><DialogContent size="md"><DialogTitle>D</DialogTitle>
        <Section title="Eins"><Section title="Zwei"><Section title="Drei">x</Section></Section></Section>
      </DialogContent></Dialog>,
      { wrapper },
    );
    expect([levelOf('Eins'), levelOf('Zwei'), levelOf('Drei')]).toEqual([3, 4, 4]);
  });

  it('level übersteuert, die Kinder zählen davon weiter', () => {
    render(<Page width="standard"><Section title="Ausnahme" level={3}><Section title="Darunter">x</Section></Section></Page>, { wrapper });
    expect(levelOf('Ausnahme')).toBe(3);
    expect(levelOf('Darunter')).toBe(4);
  });

  it('Titel, Einleitung, Aktionen und Inhalt im Standard', () => {
    render(<Section title="Titel" intro="Einleitung" actions={<button type="button">Aktion</button>}><p>Inhalt</p></Section>, { wrapper });
    expect(screen.getByRole('heading', { name: 'Titel' }).className.split(' ')).toEqual(expect.arrayContaining(['font-heading', 'text-section', 'text-ink']));
    expect(screen.getByText('Einleitung').className.split(' ')).toEqual(expect.arrayContaining(['mt-1', 'text-meta', 'text-ink-2']));
    expect(screen.getByText('Inhalt').parentElement!.className.split(' ')).toContain('mt-3');
    expect(screen.getByRole('button', { name: 'Aktion' })).toBeTruthy();
  });

  it('trägt die Folgegrenze als Selektor auf sich selbst — nur direkt benachbarte Abschnitte bekommen die Linie', () => {
    const { container } = render(<><Section title="A">a</Section><Section title="B">b</Section></>, { wrapper });
    const section = container.querySelectorAll('section')[1]!.className.split(' ');
    expect(section).toEqual(expect.arrayContaining(['[&+&]:mt-5', '[&+&]:border-t', '[&+&]:border-line', '[&+&]:pt-5']));
  });
});
