// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChoiceCompare } from '@/components/forms/choice-compare';

afterEach(cleanup);
const labels = { current: 'Heute', proposal: 'Vorschlag' };

describe('ChoiceCompare', () => {
  it('is a named radio group with two sides; a click anywhere on a side chooses it', () => {
    const onValueChange = vi.fn();
    render(<ChoiceCompare label="Kurztext" value="current" onValueChange={onValueChange} current="Alter Text" proposed="Neuer Text" labels={labels} currentExtra={<span>Konfliktkasten</span>} />);
    const group = screen.getByRole('radiogroup', { name: 'Kurztext' });
    expect(within(group).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Heute', 'Vorschlag']);
    fireEvent.click(screen.getByText('Neuer Text'));
    expect(onValueChange).toHaveBeenCalledWith('proposal');
    expect(screen.getByText('Konfliktkasten').closest('[data-side]')!.getAttribute('data-side')).toBe('current');
  });
  it('has no label around buttons: a button in a side does its own thing and does not choose the side (M7)', () => {
    const onValueChange = vi.fn();
    const onLink = vi.fn();
    const { container } = render(<ChoiceCompare label="Kurztext" value="proposal" onValueChange={onValueChange} current="Alter Text" proposed="Neuer Text" labels={labels} currentExtra={<button type="button" onClick={onLink}>Protokoll</button>} />);
    expect(container.querySelector('label')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Protokoll' }));
    expect(onLink).toHaveBeenCalledOnce();
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Alter Text'));
    expect(onValueChange).toHaveBeenCalledWith('current');
  });
  it('marks the chosen side', () => {
    render(<ChoiceCompare label="Größe" value="proposal" onValueChange={() => {}} current="52" proposed="55" labels={labels} />);
    expect(screen.getByText('55').closest('[data-side]')!.hasAttribute('data-chosen')).toBe(true);
    expect(screen.getByText('52').closest('[data-side]')!.hasAttribute('data-chosen')).toBe(false);
  });
  it('can be read only', () => {
    render(<ChoiceCompare label="Größe" value="proposal" onValueChange={() => {}} current="52" proposed="55" labels={labels} disabled />);
    for (const radio of screen.getAllByRole('radio')) expect(radio.getAttribute('aria-disabled')).toBe('true');
  });
});
