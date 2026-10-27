// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Segmented } from '@/components/ui/segmented';

afterEach(cleanup);

const OPTIONS = [
  { value: 'receipt', label: 'Beleg', testId: 'kind-receipt' },
  { value: 'trip', label: 'Fahrt', testId: 'kind-trip' },
] as const;

function Controlled({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState<'receipt' | 'trip'>('receipt');
  return <Segmented aria-label="Art" options={OPTIONS} value={value} onValueChange={(v) => { setValue(v); onChange?.(v); }} />;
}

describe('Segmented', () => {
  it('ist eine Radiogruppe mit Namen, jede Option ein Radio', () => {
    render(<Controlled />);
    expect(screen.getByRole('radiogroup', { name: 'Art' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Beleg' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Fahrt' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('kind-trip')).toBe(screen.getByRole('radio', { name: 'Fahrt' }));
  });

  it('Klick wählt und meldet den Wert', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Fahrt' }));
    expect(onChange).toHaveBeenCalledWith('trip');
    expect(screen.getByRole('radio', { name: 'Fahrt' }).getAttribute('aria-checked')).toBe('true');
  });

  // Base UI setzt den Fokus in einem Microtask (nach dem `returnFocus` des FocusManagers), daher `waitFor`.
  it('Pfeiltaste wählt die nächste Option und nimmt den Fokus mit', async () => {
    render(<Controlled />);
    const first = screen.getByRole('radio', { name: 'Beleg' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const second = screen.getByRole('radio', { name: 'Fahrt' });
    await waitFor(() => expect(document.activeElement).toBe(second));
    expect(second.getAttribute('aria-checked')).toBe('true');
  });

  it('nur die gewählte Option ist per Tab erreichbar', () => {
    render(<Controlled />);
    expect(screen.getByRole('radio', { name: 'Beleg' }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('radio', { name: 'Fahrt' }).getAttribute('tabindex')).toBe('-1');
  });

  it('im Formular kommt der gewählte Wert unter name an', () => {
    render(
      <form data-testid="f">
        <Segmented aria-label="Art" name="kind" options={OPTIONS} defaultValue="trip" />
      </form>,
    );
    const data = new FormData(screen.getByTestId('f') as HTMLFormElement);
    expect(data.get('kind')).toBe('trip');
  });

  it('Symbol-Optionen tragen ein aria-label', () => {
    render(<Segmented aria-label="Breite" options={[{ value: 'm', label: <svg aria-hidden />, ariaLabel: 'Telefon' }]} defaultValue="m" />);
    expect(screen.getByRole('radio', { name: 'Telefon' })).toBeTruthy();
  });
  // 10 B27: Wer sieht, bekommt den Namen eines Symbols als Titel beim Verweilen.
  it('Symbol-Optionen nennen ihren Namen auch als title', () => {
    render(<Segmented aria-label="Breite" options={[{ value: 'm', label: <svg aria-hidden />, ariaLabel: 'Telefon' }]} defaultValue="m" />);
    expect(screen.getByRole('radio', { name: 'Telefon' }).getAttribute('title')).toBe('Telefon');
  });
});

/**
 * Designer Runde 8, 17c: Passt die Leiste nicht in die Breite, stehen die Segmente untereinander — sie scrollt nicht
 * und schneidet nichts ab. jsdom misst nichts; die Breiten setzt der Test, den ResizeObserver ersetzt er.
 */
describe('Segmented schmaler als sein Inhalt', () => {
  let widths = { scroll: 0, client: 0 };
  let resize: (() => void) | null = null;
  const proto = HTMLElement.prototype;
  const original = {
    scroll: Object.getOwnPropertyDescriptor(proto, 'scrollWidth'),
    client: Object.getOwnPropertyDescriptor(proto, 'clientWidth'),
  };
  beforeEach(() => {
    Object.defineProperty(proto, 'scrollWidth', { configurable: true, get() { return (this as HTMLElement).dataset.slot === 'segmented' ? widths.scroll : 0; } });
    Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return (this as HTMLElement).dataset.slot === 'segmented' ? widths.client : 0; } });
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { resize = cb; } observe() {} disconnect() {} });
  });
  afterEach(() => {
    if (original.scroll) Object.defineProperty(proto, 'scrollWidth', original.scroll);
    if (original.client) Object.defineProperty(proto, 'clientWidth', original.client);
    vi.unstubAllGlobals();
    resize = null;
  });

  it('passt sie, bleibt sie nebeneinander', () => {
    widths = { scroll: 300, client: 300 };
    render(<Controlled />);
    const group = screen.getByRole('radiogroup', { name: 'Art' });
    expect(group.dataset.stacked).toBeUndefined();
    expect(group.getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('zu schmal: untereinander, alle Optionen bleiben wählbar; wird es breit genug, wieder nebeneinander', () => {
    widths = { scroll: 486, client: 358 };
    render(<Controlled />);
    const group = screen.getByRole('radiogroup', { name: 'Art' });
    expect(group.dataset.stacked).toBe('true');
    expect(group.getAttribute('aria-orientation')).toBe('vertical');
    fireEvent.click(screen.getByRole('radio', { name: 'Fahrt' }));
    expect(screen.getByRole('radio', { name: 'Fahrt' }).getAttribute('aria-checked')).toBe('true');
    widths = { scroll: 600, client: 600 };
    act(() => resize?.());
    expect(group.dataset.stacked).toBeUndefined();
  });
});
