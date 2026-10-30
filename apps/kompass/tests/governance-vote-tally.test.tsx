// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { DateFormatProvider } from '@/components/date-format-provider';
import { VoteTally, type VoteTallyValue } from '@/components/governance/vote-tally';

afterEach(cleanup);
const L = messages.governance.live.tally;
const threeQuarters = { value: { fraction: { num: 3, den: 4 }, base: 'cast', abstentions: 'ignored', comparison: 'atLeast' }, source: 'statute', reference: '§ 12 Satzung' } as const;
const simple = { value: { fraction: 'simple', base: 'cast', abstentions: 'ignored' }, source: 'law', norm: '§ 32 BGB' } as const;
const IDLE: VoteTallyValue = { mode: 'idle', no: 0, abstain: 0, invalid: 0, yes: null, outcome: null, reason: '', recountNote: null };

function Harness({ kind = 'simple', majority = simple, initial = IDLE, onCommit = () => {}, readOnly = false }: { kind?: 'simple' | 'statute'; majority?: typeof simple | typeof threeQuarters; initial?: VoteTallyValue; onCommit?: () => void; readOnly?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <NextIntlClientProvider locale="de" messages={messages}>
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        <VoteTally id="r1" kind={kind} unanimousLabel="adopted" voters={14} presentVoting={14} allVoting={42} excluded={0} majority={majority} tie="rejected" value={value} onChange={setValue} onCommit={onCommit} sentences={[]} time={null} readOnly={readOnly} />
      </DateFormatProvider>
    </NextIntlClientProvider>
  );
}
const counting = (over: Partial<VoteTallyValue> = {}): VoteTallyValue => ({ ...IDLE, mode: 'counting', ...over });

describe('VoteTally (N3)', () => {
  it('„Auszählen“ puts the focus into Nein (Abnahme 2)', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(L.count) }));
    expect(document.activeElement).toBe(screen.getByRole('spinbutton', { name: L.fields.no }));
  });

  it('Nein 3, Enthaltung 1 of 14: Ja 10 as a value, not a field; „Selbst zählen“ makes it a field', () => {
    render(<Harness initial={counting()} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: L.fields.no }), { target: { value: '3' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: L.fields.abstain }), { target: { value: '1' } });
    expect(screen.queryByRole('spinbutton', { name: L.fields.yes })).toBeNull();
    expect(screen.getByTestId('tally-yes-r1').textContent).toContain('10');
    fireEvent.click(screen.getByRole('button', { name: L.selfCount }));
    expect(screen.getByRole('spinbutton', { name: L.fields.yes })).toBeTruthy();
  });

  it('statute starts with Ja as a field', () => {
    render(<Harness kind="statute" majority={threeQuarters} initial={counting()} />);
    expect(screen.getByRole('spinbutton', { name: L.fields.yes })).toBeTruthy();
  });

  it('exactly on the threshold marks the knife edge (Abnahme 4)', () => {
    render(<Harness kind="statute" majority={threeQuarters} initial={counting({ no: 3, abstain: 1, yes: 10 })} />);
    expect(document.querySelector('[data-knife]')).not.toBeNull();
  });

  it('a finding against the count asks for a reason, required, and no button is disabled (Abnahme 5, 6)', () => {
    render(<Harness initial={counting({ no: 10, outcome: 'adopted' })} />);
    expect(screen.getByRole('textbox', { name: new RegExp(L.reason) }).hasAttribute('required')).toBe(true);
    for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('Enter in Ungültig commits once; tab order Nein → Enthaltung → Ungültig', () => {
    const commit = vi.fn();
    render(<Harness initial={counting()} onCommit={commit} />);
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: L.fields.invalid }), { key: 'Enter' });
    expect(commit).toHaveBeenCalledTimes(1);
    const fields = screen.getAllByRole('spinbutton').map((f) => f.getAttribute('aria-label') ?? (f as HTMLInputElement).labels?.[0]?.textContent);
    expect(fields.slice(0, 3)).toEqual([L.fields.no, L.fields.abstain, L.fields.invalid]);
  });

  it('readOnly shows values as text, no button and no field (Review Focus 3)', () => {
    render(<Harness readOnly initial={counting({ no: 3, abstain: 1 })} />);
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.queryAllByRole('spinbutton')).toEqual([]);
    expect(screen.getByTestId('tally-values-r1').textContent).toContain('10');
  });
});
