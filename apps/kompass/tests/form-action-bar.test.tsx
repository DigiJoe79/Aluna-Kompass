// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard } from '@/components/forms/form-card';

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
    expect(classes).toEqual(expect.arrayContaining(['stickybar:sticky', 'stickybar:bottom-0']));
    // Kein Kleben ohne die Variante — sonst klebte sie auch im quer gehaltenen Telefon.
    expect(classes).not.toContain('sticky');
    expect(classes).not.toContain('bottom-0');
  });

  it('Schatten nur, solange sie klebt: die Marke am Kartenende unter dem Fenster', () => {
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
      expect(bar.className).toContain('stickybar:data-[stuck]:shadow-md');
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

  it('Telefon: Speichern über die volle Breite zuerst, Verwerfen und Abbrechen darunter nebeneinander', () => {
    render(<form><input name="a" /><FormActionBar back={{ href: '/x', label: 'Zurück' }} extraActions={<button type="button">Speichern und neu</button>} /></form>, { wrapper });
    const save = screen.getByRole('button', { name: 'Speichern' });
    const discard = screen.getByRole('button', { name: 'Verwerfen' });
    const cancel = screen.getByRole('link', { name: 'Abbrechen' });
    const row = save.parentElement!;
    expect(row.className).toContain('max-sm:grid-cols-2');
    expect(row.className).not.toContain('flex-col');
    expect(save.className).toContain('max-sm:col-span-2');
    expect(save.className).toContain('max-sm:order-1');
    // Verwerfen links, Abbrechen rechts — je eine Spalte.
    expect(discard.className).toContain('max-sm:order-3');
    expect(cancel.className).toContain('max-sm:order-4');
    expect(discard.className).not.toContain('col-span-2');
    expect(cancel.className).not.toContain('col-span-2');
    // Weitere Speicherwege gleich unter „Speichern“, ebenfalls über die volle Breite.
    expect(screen.getByRole('button', { name: 'Speichern und neu' }).parentElement!.className).toContain('max-sm:[&>*]:col-span-2');
  });

  it('Telefon: steht nur einer der beiden Nebenknöpfe da, nimmt er die volle Breite', () => {
    render(<form><input name="a" /><FormActionBar /></form>, { wrapper });
    expect(screen.getByRole('button', { name: 'Verwerfen' }).className).toContain('max-sm:col-span-2');
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
      expect(screen.getByRole('button', { name: 'Verwerfen' }).hasAttribute('disabled')).toBe(false);
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
