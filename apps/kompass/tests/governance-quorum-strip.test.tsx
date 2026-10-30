// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { DateFormatProvider } from '@/components/date-format-provider';
import { QuorumStrip } from '@/components/governance/quorum-strip';

afterEach(cleanup);
const wrap = (node: React.ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages}><DateFormatProvider mode="locale" timeZone="Europe/Berlin">{node}</DateFormatProvider></NextIntlClientProvider>);

describe('QuorumStrip (N2)', () => {
  it('the number is a button that opens the attendance', () => {
    const open = vi.fn();
    wrap(<QuorumStrip title="MV 2026" voting={14} guests={2} scope={null} quorum={{ required: 11, met: true, knife: false }} save={{ state: { kind: 'idle' }, pending: false }} onAttendance={open} onEnd={null} />);
    fireEvent.click(screen.getByRole('button', { name: /14 stimmberechtigt/ }));
    expect(open).toHaveBeenCalled();
  });

  it('with a scope it shows the number of the item and the attendance (Abnahme 7); not quorate is no alert', () => {
    wrap(<QuorumStrip title="MV 2026" voting={14} guests={0} scope={{ label: 'bei TOP 5', present: 11 }} quorum={{ required: 15, met: false, knife: false }} save={{ state: { kind: 'idle' }, pending: false }} onAttendance={() => {}} onEnd={() => {}} />);
    const region = screen.getByRole('region', { name: 'Lage der Sitzung' });
    expect(region.textContent).toContain('11 stimmberechtigt bei TOP 5 · 14 anwesend');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('idle after loading says nothing about input: the meeting may already have counted votes; saving and saved still show', () => {
    const { rerender } = wrap(<QuorumStrip title="Vorstand" voting={3} guests={0} scope={null} quorum={{ required: 2, met: true, knife: false }} save={{ state: { kind: 'idle' }, pending: false }} onAttendance={() => {}} onEnd={null} />);
    expect(screen.getByTestId('save-status').textContent).toBe('');
    rerender(<NextIntlClientProvider locale="de" messages={messages}><DateFormatProvider mode="locale" timeZone="Europe/Berlin"><QuorumStrip title="Vorstand" voting={3} guests={0} scope={null} quorum={{ required: 2, met: true, knife: false }} save={{ state: { kind: 'saving' }, pending: true }} onAttendance={() => {}} onEnd={null} /></DateFormatProvider></NextIntlClientProvider>);
    expect(screen.getByTestId('save-status').textContent).not.toBe('');
  });
});
