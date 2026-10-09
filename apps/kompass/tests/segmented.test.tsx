// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
});
