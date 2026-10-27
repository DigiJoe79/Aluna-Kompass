// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard } from '@/components/forms/form-card';
import { Label } from '@/components/ui/label';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

describe('FormActionBar', () => {
  it('zeigt eine Ablehnung über der Leiste, nicht bei Feldfehlern', () => {
    const { rerender } = render(<form><FormActionBar state={{ status: 'error', message: 'Zeitraum geschlossen.', fieldErrors: {} }} /></form>, { wrapper });
    expect(screen.getByRole('alert').textContent).toContain('Zeitraum geschlossen.');
    rerender(<form><FormActionBar state={{ status: 'error', message: 'Zeitraum geschlossen.', fieldErrors: { a: 'b' } }} /></form>);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('im Schritt (surface plain) ist „Speichern“ ohne Änderung gesperrt, mit Änderung frei (Designer Runde 6, 15a)', () => {
    const onSave = vi.fn();
    const { rerender } = render(<FormActionBar surface="plain" count={0} onSave={onSave} />, { wrapper });
    expect((screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<FormActionBar surface="plain" count={2} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('schickt beim Bearbeiten ohne Änderung nicht ab und sagt „Nichts geändert“', () => {
    const submit = vi.fn((e: Event) => e.preventDefault());
    render(<form onSubmit={submit as never}><input name="a" defaultValue="x" /><FormActionBar /></form>, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText('Nichts geändert')).toBeTruthy();
  });

  it('schickt beim Bearbeiten mit Änderung ab', () => {
    const submit = vi.fn((e: Event) => e.preventDefault());
    render(<form onSubmit={submit as never}><input name="a" defaultValue="x" aria-label="a" /><FormActionBar /></form>, { wrapper });
    fireEvent.input(screen.getByLabelText('a'), { target: { value: 'y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(submit).toHaveBeenCalledOnce();
  });

  it('schickt beim Anlegen auch ohne Änderung ab (Review Focus 2)', () => {
    const submit = vi.fn((e: Event) => e.preventDefault());
    render(<form onSubmit={submit as never}><input name="a" /><FormActionBar mode="create" /></form>, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(submit).toHaveBeenCalledOnce();
  });

  it('Dialog-Lage: nicht klebend, kein Verwerfen, Abbrechen ruft cancel', () => {
    const cancel = vi.fn();
    const { container } = render(<form><FormActionBar cancel={cancel} /></form>, { wrapper });
    expect(container.innerHTML).not.toContain('sticky');
    expect(screen.queryByRole('button', { name: 'Verwerfen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(cancel).toHaveBeenCalled();
  });

  it('Seiten-Lage klebt erst ab 640 × 600 px (Variante stickybar), darunter steht sie am Ende der Karte', () => {
    const { container } = render(<form><FormActionBar /></form>, { wrapper });
    const bar = container.querySelector('[data-slot="form-action-bar"]')!;
    const classes = bar.className.split(/\s+/);
    expect(classes).toContain('stickybar:sticky');
    // Kein Kleben ohne die Variante — sonst klebte sie auch im quer gehaltenen Telefon.
    expect(classes.filter((c) => /(^|:)(sticky|bottom-)/.test(c) && !c.startsWith('stickybar:'))).toEqual([]);
  });

  it('klebt nur, solange die Marke am Kartenende unter dem Fenster liegt', () => {
    let notify: ((entries: Partial<IntersectionObserverEntry>[]) => void) | undefined;
    const observed: Element[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: Partial<IntersectionObserverEntry>[]) => void) {
          notify = callback;
        }
        observe(el: Element) {
          observed.push(el);
        }
        disconnect = disconnect;
        unobserve() {}
      },
    );
    try {
      const { container, unmount } = render(<FormCard><form><FormActionBar /></form></FormCard>, { wrapper });
      const bar = container.querySelector('[data-slot="form-action-bar"]') as HTMLElement;
      expect(observed).toEqual([container.querySelector('[data-slot="form-card-end"]')]);
      expect(bar.dataset.stuck).toBeUndefined();
      const rootBounds = { top: 0, bottom: 800 } as DOMRectReadOnly;
      // Kartenende unter dem Fenster: die Leiste klebt.
      act(() => notify!([{ isIntersecting: false, rootBounds, boundingClientRect: { top: 1400 } as DOMRectReadOnly }]));
      expect(bar.dataset.stuck).toBe('');
      // Kartenende im Bild: Die Leiste steht an ihrem Platz.
      act(() => notify!([{ isIntersecting: true, rootBounds, boundingClientRect: { top: 600 } as DOMRectReadOnly }]));
      expect(bar.dataset.stuck).toBeUndefined();
      // Kartenende über dem Fenster: Die Karte ist vorbei, die Leiste mit ihr.
      act(() => notify!([{ isIntersecting: false, rootBounds, boundingClientRect: { top: -50 } as DOMRectReadOnly }]));
      expect(bar.dataset.stuck).toBeUndefined();
      unmount();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Prüfseite (hideDiscard): kein Verwerfen (Designer 2026-10-10)', () => {
    render(<form><input name="a" /><FormActionBar back={{ href: '/x', label: 'Zurück' }} hideDiscard /></form>, { wrapper });
    expect(screen.queryByRole('button', { name: 'Verwerfen' })).toBeNull();
  });

  describe('Verwerfen nur bei Änderungen (Designer 2026-10-16, Teil 2 Nr. 1)', () => {
    it('beim Bearbeiten ohne Änderung kein Verwerfen', () => {
      render(<form><input name="a" aria-label="a" defaultValue="x" /><FormActionBar back={{ href: '/x', label: 'Zurück' }} /></form>, { wrapper });
      expect(screen.queryByRole('button', { name: 'Verwerfen' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Abbrechen' })).toBeTruthy();
    });

    it('mit Änderung erscheint Verwerfen als Textknopf', () => {
      render(<form><input name="a" aria-label="a" defaultValue="x" /><FormActionBar back={{ href: '/x', label: 'Zurück' }} /></form>, { wrapper });
      fireEvent.input(screen.getByLabelText('a'), { target: { value: 'y' } });
      const discard = screen.getByRole('button', { name: 'Verwerfen' });
      expect(discard.hasAttribute('disabled')).toBe(false);
      // Textknopf: ohne Rahmen und ohne Fläche (ghost), nie ein zweiter Hauptknopf.
      expect(discard.className).toContain('hover:bg-hover');
      expect(discard.className).not.toContain('bg-brand');
      expect(discard.className).not.toContain('border-line-strong');
    });

    it('beim Anlegen nur Abbrechen, auch mit Eingaben', () => {
      render(<form><input name="a" aria-label="a" /><FormActionBar mode="create" back={{ href: '/x', label: 'Zurück' }} /></form>, { wrapper });
      fireEvent.input(screen.getByLabelText('a'), { target: { value: 'y' } });
      expect(screen.queryByRole('button', { name: 'Verwerfen' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Abbrechen' })).toBeTruthy();
    });

    // Z7 (Designer Stufe 2 Nr. 7): Beim Anlegen steht statt des Zählers die Pflichtfeld-Legende; die Rückfrage beim
    // Verlassen bleibt.
    it('beim Anlegen kein Zähler, sondern „* Pflichtfeld“ — auch mit Eingaben', () => {
      render(<form><Label htmlFor="a" required>a</Label><input id="a" name="a" required /><FormActionBar mode="create" back={{ href: '/x', label: 'Zurück' }} /></form>, { wrapper });
      fireEvent.input(screen.getByLabelText('a'), { target: { value: 'y' } });
      expect(screen.queryByText(/noch nicht gespeichert/)).toBeNull();
      expect(screen.getByText('* Pflichtfeld')).toBeTruthy();
    });

    it('ein bestehender Datensatz mit `create` (Prüfung) zählt weiter', () => {
      render(<form><input name="a" aria-label="a" /><FormActionBar mode="create" loadedVersion="v1" back={{ href: '/x', label: 'Zurück' }} /></form>, { wrapper });
      fireEvent.input(screen.getByLabelText('a'), { target: { value: 'y' } });
      expect(screen.getByText('1 Änderung noch nicht gespeichert')).toBeTruthy();
    });

    it('Buchungsmaske (087, 091): beim Anlegen nur Abbrechen, ein bestehender Entwurf zeigt Verwerfen erst mit Änderung', () => {
      const { rerender } = render(<form><FormActionBar mode="create" back={{ href: '/x', label: 'Zurück' }} count={2} countHidden /></form>, { wrapper });
      expect(screen.queryByRole('button', { name: 'Verwerfen' })).toBeNull();
      rerender(<form><FormActionBar mode="create" loadedVersion="v1" back={{ href: '/x', label: 'Zurück' }} count={0} countHidden /></form>);
      expect(screen.queryByRole('button', { name: 'Verwerfen' })).toBeNull();
      rerender(<form><FormActionBar mode="create" loadedVersion="v1" back={{ href: '/x', label: 'Zurück' }} count={2} countHidden /></form>);
      expect(screen.getByRole('button', { name: 'Verwerfen' }).hasAttribute('disabled')).toBe(false);
    });
  });

  describe('Rückfrage beim Verlassen (Befund 39)', () => {
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const page = (bar: ReactNode) => (
      <>
        <a href="/anderswo" onClick={(e) => { e.preventDefault(); followed(); }}>Anderswo</a>
        <form><input name="a" aria-label="a" defaultValue="x" />{bar}</form>
      </>
    );
    const followed = vi.fn();
    afterEach(() => followed.mockReset());

    it('ohne Änderung geht ein Link einfach', () => {
      render(page(<FormActionBar />), { wrapper });
      fireEvent.click(screen.getByRole('link', { name: 'Anderswo' }));
      expect(followed).toHaveBeenCalledOnce();
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(unload()).toBe(false);
    });

    it('mit Änderung fragt ein Link nach; „Seite verlassen“ geht weiter, „Abbrechen“ bleibt', async () => {
      render(page(<FormActionBar />), { wrapper });
      fireEvent.input(screen.getByLabelText('a'), { target: { value: 'y' } });
      fireEvent.click(screen.getByRole('link', { name: 'Anderswo' }));
      expect(followed).not.toHaveBeenCalled();
      const dialog = await screen.findByRole('alertdialog');
      expect(dialog.textContent).toContain('Eine Änderung ist noch nicht gespeichert');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
      expect(followed).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('link', { name: 'Anderswo' }));
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Seite verlassen' }));
      await vi.waitFor(() => expect(followed).toHaveBeenCalledOnce());
    });

    it('mit Änderung hält der Browser beim Neuladen oder Schließen an', () => {
      render(page(<FormActionBar />), { wrapper });
      fireEvent.input(screen.getByLabelText('a'), { target: { value: 'y' } });
      expect(unload()).toBe(true);
    });

    it('verborgener Zähler: der Hinweis bleibt stehen, nachgefragt wird trotzdem — und nur mit Änderung', async () => {
      const { rerender } = render(page(<FormActionBar mode="create" count={0} countHidden note="Bargeld wird am selben Tag festgehalten." />), { wrapper });
      fireEvent.click(screen.getByRole('link', { name: 'Anderswo' }));
      expect(followed).toHaveBeenCalledOnce();
      expect(unload()).toBe(false);
      followed.mockReset();

      rerender(page(<FormActionBar mode="create" count={2} countHidden note="Bargeld wird am selben Tag festgehalten." />));
      expect(screen.getByText('Bargeld wird am selben Tag festgehalten.')).toBeTruthy();
      expect(screen.queryByText(/nicht gespeichert/)).toBeNull();
      // Anlegen: nur Abbrechen, kein Verwerfen (Designer 2026-10-16).
      expect(screen.queryByRole('button', { name: 'Verwerfen' })).toBeNull();
      expect(unload()).toBe(true);
      fireEvent.click(screen.getByRole('link', { name: 'Anderswo' }));
      expect(followed).not.toHaveBeenCalled();
      expect((await screen.findByRole('alertdialog')).textContent).toContain('2 Änderungen sind noch nicht gespeichert');
    });

    it('nicht im Dialog, nicht beim Ausführen und nicht bei laufend gesicherten Masken', () => {
      for (const bar of [<FormActionBar key="d" cancel={() => {}} />, <FormActionBar key="r" mode="run" />, <FormActionBar key="s" status={{ state: { kind: 'idle' } as never, pending: false }} />]) {
        const { unmount } = render(page(bar), { wrapper });
        fireEvent.input(screen.getByLabelText('a'), { target: { value: 'y' } });
        fireEvent.click(screen.getByRole('link', { name: 'Anderswo' }));
        expect(followed).toHaveBeenCalledOnce();
        expect(unload()).toBe(false);
        followed.mockReset();
        unmount();
      }
    });
  });

  it('ohne FormCard und im Dialog wird nichts beobachtet', () => {
    const observe = vi.fn();
    vi.stubGlobal('IntersectionObserver', class { observe = observe; disconnect() {} unobserve() {} });
    try {
      render(<form><FormActionBar /></form>, { wrapper });
      render(<FormCard><form><FormActionBar cancel={() => {}} /></form></FormCard>, { wrapper });
      expect(observe).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ohne Formular: onSave statt Absenden, gesperrt während pending', () => {
    const onSave = vi.fn();
    const { rerender } = render(<FormActionBar cancel={() => {}} onSave={onSave} saveLabel="Buchen" />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Buchen' }));
    expect(onSave).toHaveBeenCalledOnce();
    rerender(<FormActionBar cancel={() => {}} onSave={onSave} saveLabel="Buchen" pending />);
    expect((screen.getByRole('button', { name: 'Buchen' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Lage „ausführen“: kein Zähler, schickt immer ab', () => {
    const onSave = vi.fn();
    render(<FormActionBar mode="run" onSave={onSave} note="Nummern 12–30" saveLabel="19 erstellen" />, { wrapper });
    expect(screen.getByText('Nummern 12–30')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '19 erstellen' }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('zeigt den Zwischenstand links, wenn keine Notiz da ist', () => {
    render(<FormActionBar mode="create" onSave={() => {}} status={{ state: { kind: 'idle' }, pending: false }} />, { wrapper });
    expect(screen.getByTestId('save-status')).toBeTruthy();
  });

  it('bietet beim Versionskonflikt zwei Auswege auf der Seite, im Dialog nur das Neuladen', () => {
    const stale = { status: 'error' as const, message: 'x', fieldErrors: {}, code: 'staleVersion', detail: 'Der Eintrag wurde inzwischen geändert.' };
    const { rerender } = render(<form><FormActionBar state={stale} /></form>, { wrapper });
    expect(screen.getByRole('button', { name: /neben den neuen Stand/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Eingaben verwerfen/ })).toBeTruthy();
    rerender(<form><FormActionBar cancel={() => {}} state={stale} /></form>);
    expect(screen.queryByRole('button', { name: /neben den neuen Stand/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Eingaben verwerfen/ })).toBeTruthy();
  });

  it('recordAction steht links im Dialogfuß, Zähler daneben, Knöpfe rechts', () => {
    const { container } = render(<FormActionBar placement="dialog" cancel={() => {}} onSave={() => {}} count={1} recordAction={{ key: 'd', label: 'Deaktivieren', kind: 'reversible', onSelect: () => {} }} />, { wrapper });
    const bar = container.querySelector('[data-slot="form-action-bar"]')!;
    const order = Array.from(bar.querySelectorAll('button, [aria-live]')).map((el) => el.textContent);
    expect(order.slice(0, 3)).toEqual(['Deaktivieren', '1 Änderung noch nicht gespeichert', 'Abbrechen']);
  });

  it('zwei recordActions werden ein Menü an derselben Stelle', () => {
    render(<FormActionBar placement="dialog" cancel={() => {}} onSave={() => {}} recordAction={[{ key: 'a', label: 'Archivieren', kind: 'reversible', onSelect: () => {} }, { key: 'd', label: 'Löschen …', kind: 'delete', onSelect: () => {} }]} />, { wrapper });
    expect(screen.getByRole('button', { name: 'Weitere Aktionen' })).toBeTruthy();
  });

  it('recordAction auf einer Seite ist ein Typfehler', () => {
    // @ts-expect-error — nie in der Speicherleiste einer Seite (Spec Seitenkopf § 3.3)
    void (<FormActionBar recordAction={{ key: 'd', label: 'x', kind: 'delete', onSelect: () => {} }} />);
    // @ts-expect-error — auch ausdrücklich `page` nicht
    void (<FormActionBar placement="page" recordAction={{ key: 'd', label: 'x', kind: 'delete', onSelect: () => {} }} />);
  });
});

// Stern ⇔ Fußhinweis (Designer Runde 3: 034, 040, 094, 186, 188): Die Leiste nennt „* Pflichtfeld“ genau dann, wenn ein
// Feld darüber einen Stern trägt — auch neben einer Notiz und in einem Dialog ohne <form>.
describe('FormActionBar: Pflichtfeld-Legende', () => {
  it('ohne Stern keine Legende, auch wenn ein Feld technisch Pflicht ist', () => {
    render(<form><input name="a" aria-label="a" required /><FormActionBar mode="create" back={{ href: '/x', label: 'Zurück' }} /></form>, { wrapper });
    expect(screen.queryByText('* Pflichtfeld')).toBeNull();
  });

  it('mit Stern steht die Legende neben der Notiz', () => {
    render(
      <form>
        <Label htmlFor="n" required>Nachname</Label>
        <input id="n" name="n" />
        <FormActionBar cancel={() => {}} note="Wird protokolliert." />
      </form>,
      { wrapper },
    );
    expect(screen.getByText('Wird protokolliert.')).toBeTruthy();
    expect(screen.getByText('* Pflichtfeld')).toBeTruthy();
  });

  it('im Dialog ohne <form> zählt der Stern im Dialog', () => {
    render(
      <div data-slot="dialog-content">
        <Label htmlFor="b" required>Betrag</Label>
        <input id="b" />
        <FormActionBar cancel={() => {}} onSave={() => {}} pending={false} />
      </div>,
      { wrapper },
    );
    expect(screen.getByText('* Pflichtfeld')).toBeTruthy();
  });
});
