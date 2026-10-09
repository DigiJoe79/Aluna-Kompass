// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { FilterBar, checkFilter, filterControlClass, frameFilter, selectFilter, type FilterSlot } from '@/components/filter-bar';

const show = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {ui}
    </NextIntlClientProvider>,
  );

afterEach(cleanup);

const HUNDE = { one: 'Hund', other: 'Hunde', dative: 'Hunden' };

/** Ein Select-Filter wie auf der Hundeliste: Der gesetzte Wert steht als Text im Feld. */
function statusSlot(value: string, extra: Partial<FilterSlot> = {}): FilterSlot {
  const options = (v: string, onChange: (v: string) => void) => (
    <select aria-label="Status" value={v} onChange={(e) => onChange(e.target.value)} className={filterControlClass(v !== '')}>
      <option value="">Status: alle</option>
      <option value="home">Sucht ein Zuhause</option>
      <option value="adopted">Vermittelt</option>
    </select>
  );
  return {
    key: 'status',
    label: 'Status',
    active: value !== '',
    chip: value === 'home' ? 'Sucht ein Zuhause' : value,
    onClear: vi.fn(),
    control: options(value, vi.fn()),
    sheet: { value, render: options, apply: vi.fn() },
    ...extra,
  };
}

function checkSlot(key: string, label: string, on: boolean, extra: Partial<FilterSlot> = {}): FilterSlot {
  return {
    key,
    label,
    active: on,
    onClear: vi.fn(),
    control: <span data-testid={`control-${key}`}>{label}</span>,
    sheet: { value: on ? '1' : '', render: () => <span>{label}</span>, apply: vi.fn() },
    ...extra,
  };
}

const base = { count: { shown: 6, total: 6, noun: HUNDE }, onReset: vi.fn() };

describe('FilterBar', () => {
  const domOrder = (container: HTMLElement, elements: Element[]) => {
    const all = Array.from(container.querySelectorAll('*'));
    const positions = elements.map((el) => all.indexOf(el));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  };

  it('feste Reihenfolge: Suche, Filter, Zählzeile, Zurücksetzen, Sortierung, Ansicht', () => {
    const { container } = show(
      <FilterBar
        {...base}
        count={{ shown: 3, total: 6, noun: HUNDE }}
        search={<input data-testid="slot-search" />}
        filters={[statusSlot('home')]}
        sort={<span data-testid="slot-sort" />}
        view={<span data-testid="slot-view" />}
      />,
    );
    domOrder(container, [
      screen.getByTestId('slot-search'),
      screen.getAllByRole('combobox', { name: 'Status' })[0]!,
      screen.getByText('3 von 6 Hunden'),
      screen.getByRole('button', { name: 'Filter zurücksetzen' }),
      screen.getByTestId('slot-sort'),
      screen.getByTestId('slot-view'),
    ]);
  });

  it('mit „more“: „Weitere Filter“ hinter den Filtern, vor Sortierung und Ansicht; Zählzeile in der Chip-Zeile', () => {
    const { container } = show(
      <FilterBar
        {...base}
        count={{ shown: 3, total: 6, noun: HUNDE }}
        search={<input data-testid="slot-search" />}
        filters={[statusSlot('home')]}
        more={[checkSlot('novoucher', 'Nur ohne Beleg', false)]}
        sort={<span data-testid="slot-sort" />}
        view={<span data-testid="slot-view" />}
      />,
    );
    domOrder(container, [
      screen.getByTestId('slot-search'),
      screen.getAllByRole('combobox', { name: 'Status' })[0]!,
      screen.getByRole('button', { name: /^Weitere Filter/ }),
      screen.getByTestId('slot-sort'),
      screen.getByTestId('slot-view'),
      screen.getByText('3 von 6 Hunden'),
      screen.getByRole('button', { name: 'Filter zurücksetzen' }),
    ]);
  });

  it('Zählzeile: „6 Hunde“ ohne Filter, „3 von 6 Hunden“ mit Filter, aria-live polite, text-meta', () => {
    show(<FilterBar {...base} filters={[statusSlot('')]} />);
    const plain = screen.getByText('6 Hunde');
    expect(plain.getAttribute('aria-live')).toBe('polite');
    expect(plain.className).toContain('text-meta');
    expect(plain.className).toContain('text-muted-ink');
    cleanup();
    show(<FilterBar {...base} count={{ shown: 3, total: 6, noun: HUNDE }} filters={[statusSlot('home')]} />);
    expect(screen.getByText('3 von 6 Hunden')).toBeTruthy();
    cleanup();
    show(<FilterBar {...base} count={{ shown: 1, total: 1, noun: HUNDE }} filters={[statusSlot('')]} />);
    expect(screen.getByText('1 Hund')).toBeTruthy();
  });

  it('„Filter zurücksetzen“ nur bei gesetztem Filter oder Suche, nicht bei nur gesetzter Sortierung', () => {
    show(<FilterBar {...base} filters={[statusSlot('')]} sort={<select aria-label="Sortierung" defaultValue="name" />} />);
    expect(screen.queryByRole('button', { name: 'Filter zurücksetzen' })).toBeNull();
    cleanup();
    const onReset = vi.fn();
    show(<FilterBar {...base} onReset={onReset} filters={[statusSlot('')]} searchActive={{ chip: 'Lu', onClear: vi.fn() }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(onReset).toHaveBeenCalledTimes(1);
    cleanup();
    show(<FilterBar {...base} filters={[statusSlot('home')]} />);
    expect(screen.getAllByRole('button', { name: 'Filter zurücksetzen' }).length).toBeGreaterThan(0);
  });

  it('„Weitere Filter“ zählt die gesetzten und zeigt ihre Bedienelemente im Popover', async () => {
    show(
      <FilterBar
        {...base}
        filters={[statusSlot('')]}
        more={[checkSlot('novoucher', 'Nur ohne Beleg', true), checkSlot('agent', 'Nur vom Agenten vorbereitet', false)]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Weitere Filter 1' });
    expect(screen.queryByTestId('control-agent')).toBeNull();
    fireEvent.click(trigger);
    expect(await screen.findByTestId('control-agent')).toBeTruthy();
    expect(screen.getByTestId('control-novoucher')).toBeTruthy();
  });

  it('Chips mit „more“: je gesetztem Filter einer, „{Filter}: {Wert}“, Ja/Nein allein; ✕ ruft onClear; Zählzeile in der Chip-Zeile', () => {
    const status = statusSlot('home');
    const novoucher = checkSlot('novoucher', 'Nur ohne Beleg', true);
    const search = { chip: 'Futter', onClear: vi.fn() };
    show(<FilterBar {...base} count={{ shown: 3, total: 6, noun: HUNDE }} searchActive={search} filters={[status]} more={[novoucher]} />);
    const chips = screen.getByTestId('filter-chips');
    expect(within(chips).getAllByRole('button', { name: /^Filter „/ }).map((b) => b.textContent)).toEqual(['Suche: Futter', 'Status: Sucht ein Zuhause', 'Nur ohne Beleg']);
    fireEvent.click(within(chips).getByRole('button', { name: 'Filter „Status: Sucht ein Zuhause“ entfernen' }));
    fireEvent.click(within(chips).getByRole('button', { name: 'Filter „Nur ohne Beleg“ entfernen' }));
    fireEvent.click(within(chips).getByRole('button', { name: 'Filter „Suche: Futter“ entfernen' }));
    expect(status.onClear).toHaveBeenCalledTimes(1);
    expect(novoucher.onClear).toHaveBeenCalledTimes(1);
    expect(search.onClear).toHaveBeenCalledTimes(1);
    expect(within(chips).getByText('3 von 6 Hunden')).toBeTruthy();
  });

  it('ohne „more“ keine Chips — außer ein versteckter Filter ist gesetzt (Spendenbuch „anonym“)', () => {
    show(<FilterBar {...base} filters={[statusSlot('home')]} />);
    expect(screen.queryByTestId('filter-chips')).toBeNull();
    cleanup();
    const anonym = checkSlot('contact', 'Nur anonyme Zuwendungen', true);
    show(<FilterBar {...base} filters={[statusSlot('')]} hidden={[anonym]} />);
    const chips = screen.getByTestId('filter-chips');
    fireEvent.click(within(chips).getByRole('button', { name: 'Filter „Nur anonyme Zuwendungen“ entfernen' }));
    expect(anonym.onClear).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button', { name: 'Filter zurücksetzen' }).length).toBeGreaterThan(0);
  });

  it('gesetzter Filter: am Text erkennbar, Rahmen in Primärfarbe nur zusätzlich, Fokusring mit Abstand', () => {
    expect(filterControlClass(true)).toContain('border-brand');
    expect(filterControlClass(true)).toContain('ring-offset');
    expect(filterControlClass(false)).not.toContain('border-brand');
    expect(filterControlClass(false)).toContain('ring-offset');
    show(<FilterBar {...base} filters={[statusSlot('home')]} />);
    const select = screen.getAllByRole('combobox', { name: 'Status' })[0] as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).toBe('Sucht ein Zuhause');
  });

  describe('Telefon-Sheet', () => {
    const openSheet = async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Filter( \d+)?$/ }));
      return await screen.findByRole('dialog');
    };

    it('Schließen ohne „Anwenden“ verwirft, erneut geöffnet steht der alte Wert da', async () => {
      const slot = statusSlot('');
      show(<FilterBar {...base} filters={[slot]} />);
      let sheet = await openSheet();
      fireEvent.change(within(sheet).getByRole('combobox', { name: 'Status' }), { target: { value: 'home' } });
      fireEvent.click(within(sheet).getByRole('button', { name: 'Schließen' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(slot.sheet.apply).not.toHaveBeenCalled();
      sheet = await openSheet();
      expect((within(sheet).getByRole('combobox', { name: 'Status' }) as HTMLSelectElement).value).toBe('');
    });

    it('„Anwenden“ übernimmt den Entwurf und schließt', async () => {
      const slot = statusSlot('');
      show(<FilterBar {...base} filters={[slot]} />);
      const sheet = await openSheet();
      fireEvent.change(within(sheet).getByRole('combobox', { name: 'Status' }), { target: { value: 'home' } });
      fireEvent.click(within(sheet).getByRole('button', { name: 'Anwenden' }));
      expect(slot.sheet.apply).toHaveBeenCalledWith('home');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('mit onApply: ein Aufruf mit allen geänderten Werten statt je Slot', async () => {
      const slot = statusSlot('');
      const onApply = vi.fn();
      show(<FilterBar {...base} filters={[slot]} more={[checkSlot('agent', 'Agent', false)]} onApply={onApply} />);
      const sheet = await openSheet();
      fireEvent.change(within(sheet).getByRole('combobox', { name: 'Status' }), { target: { value: 'adopted' } });
      fireEvent.click(within(sheet).getByRole('button', { name: 'Anwenden' }));
      expect(onApply).toHaveBeenCalledExactlyOnceWith({ status: 'adopted' });
      expect(slot.sheet.apply).not.toHaveBeenCalled();
    });

    it('„Zurücksetzen“ wirkt sofort und schließt', async () => {
      const onReset = vi.fn();
      show(<FilterBar {...base} onReset={onReset} filters={[statusSlot('home')]} />);
      const sheet = await openSheet();
      fireEvent.click(within(sheet).getByRole('button', { name: 'Zurücksetzen' }));
      expect(onReset).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
  });
});

describe('selectFilter und checkFilter', () => {
  const STATUS = [
    { value: 'home', label: 'Sucht ein Zuhause' },
    { value: 'adopted', label: 'Vermittelt' },
  ];

  it('Select: Standardoption „{Filter}: alle“, gesetzter Wert als Text und Chip, Rahmen nur bei gesetztem Filter', () => {
    const onChange = vi.fn();
    const slot = selectFilter({ key: 'status', label: 'Status', value: 'home', options: STATUS, onChange });
    expect(slot.active).toBe(true);
    expect(slot.chip).toBe('Sucht ein Zuhause');
    show(<FilterBar {...base} count={{ shown: 3, total: 6, noun: HUNDE }} filters={[slot]} />);
    const select = screen.getAllByRole('combobox', { name: 'Status' })[0] as HTMLSelectElement;
    expect(select.options[0]!.textContent).toBe('Status: alle');
    expect(select.selectedOptions[0]!.textContent).toBe('Sucht ein Zuhause');
    expect(select.className).toContain('border-brand');
    fireEvent.change(select, { target: { value: 'adopted' } });
    expect(onChange).toHaveBeenCalledWith('adopted');
    slot.onClear();
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('Chip eines Selects lautet „{Filter}: {Wert}“; eine Option kann den Wert im Chip kürzen', () => {
    const state = selectFilter({ key: 'state', label: 'Zustand', value: 'final', options: [{ value: 'final', label: 'festgeschrieben' }], onChange: vi.fn() });
    const followUp = selectFilter({ key: 'followUp', label: 'Wiedervorlage', value: 'open', options: [{ value: 'open', label: 'Wiedervorlage offen', chip: 'offen' }], onChange: vi.fn() });
    expect(followUp.chip).toBe('offen');
    show(<FilterBar {...base} filters={[state]} more={[followUp]} />);
    const chips = screen.getByTestId('filter-chips');
    expect(within(chips).getAllByRole('button', { name: /^Filter „/ }).map((b) => b.textContent)).toEqual(['Zustand: festgeschrieben', 'Wiedervorlage: offen']);
  });

  it('Select ohne Wert: nicht gesetzt, kein Rahmen', () => {
    const slot = selectFilter({ key: 'status', label: 'Status', value: '', options: STATUS, onChange: vi.fn() });
    expect(slot.active).toBe(false);
    show(<FilterBar {...base} filters={[slot]} />);
    expect((screen.getAllByRole('combobox', { name: 'Status' })[0] as HTMLSelectElement).className).not.toContain('border-brand');
  });

  it('Checkbox „Nur …“: Wert „1“ setzt, Label nennt den Filter, onClear nimmt ihn zurück', () => {
    const onChange = vi.fn();
    const slot = checkFilter({ key: 'active', label: 'Nur aktive', value: true, onChange });
    expect(slot.active).toBe(true);
    expect(slot.chip).toBeUndefined(); // Ja/Nein-Filter: der Chip zeigt den Text allein
    expect(slot.sheet.value).toBe('1');
    show(<FilterBar {...base} filters={[slot]} />);
    const box = screen.getAllByRole('checkbox', { name: 'Nur aktive' })[0]!;
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(false);
    slot.onClear();
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});

describe('frameFilter (Jahr als Rahmen der Seite: Spendenbuch, Personenübersicht)', () => {
  it('ohne „alle“, nie gesetzt: kein Rahmen in Primärfarbe, kein Chip, kein Zurücksetzen, Sheet-Knopf ohne Rahmen', () => {
    const onChange = vi.fn();
    const slot = frameFilter({ key: 'year', label: 'Jahr', value: '2026', options: [{ value: '2025', label: '2025' }, { value: '2026', label: '2026' }], onChange });
    expect(slot.active).toBe(false);
    show(<FilterBar {...base} filters={[slot]} hidden={[checkSlot('anon', 'Nur anonyme Zuwendungen', false)]} />);
    const select = screen.getAllByRole('combobox', { name: 'Jahr' })[0] as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['2025', '2026']);
    expect(select.value).toBe('2026');
    expect(select.className).not.toContain('border-brand');
    expect(screen.getByRole('button', { name: /^Filter$/ }).className).not.toContain('border-brand');
    expect(screen.queryByRole('button', { name: 'Filter zurücksetzen' })).toBeNull();
    expect(screen.queryByTestId('filter-chips')).toBeNull();
    fireEvent.change(select, { target: { value: '2025' } });
    expect(onChange).toHaveBeenCalledWith('2025');
  });
});
