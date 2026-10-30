// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MeetingContext, MeetingDetail } from '@kompass/module-governance';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const replace = vi.fn(async (_meetingId: string, _reason: string) => ({ status: 'success' as const, message: 'ok' }));
vi.mock('@/app/(shell)/governance/meetings/[id]/actions', () => ({
  acceptLaterAction: vi.fn(),
  fileSignedMinutesAction: vi.fn(),
  issueAttendanceListAction: vi.fn(),
  issueRegisterDataAction: vi.fn(),
  reopenMeetingAction: vi.fn(),
  replaceSignedMinutesAction: (meetingId: string, reason: string) => replace(meetingId, reason),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/components/date-format-provider', () => ({ useDateFormat: () => ({ date: (d: string) => d }) }));

const { useMinutesStep } = await import('@/app/(shell)/governance/meetings/[id]/minutes-step');

afterEach(() => {
  cleanup();
  replace.mockClear();
});

const meeting = { id: 'm1', state: 'recorded', endedAt: '21:00', agenda: [], resolutions: [] } as unknown as MeetingDetail;
const context = (filed: boolean) =>
  ({
    organ: { kind: 'board' },
    offices: [],
    names: {},
    issued: { attendanceList: null, registerData: null },
    minutes: filed ? [{ id: 'v1', meetingId: 'm1', version: 1, documentId: 'd1', documentNumber: 'VSP-2026-001', reason: null, filedAt: '2026-09-05T20:00:00.000Z', filedByUserId: null }] : [],
  }) as unknown as MeetingContext;

function Step({ filed, state = 'recorded' }: { filed: boolean; state?: string }) {
  const slot = useMinutesStep({ meeting: { ...meeting, state } as MeetingDetail, context: context(filed), canManage: true, canRecord: true, today: '2026-09-06' });
  return <>{slot.below}</>;
}
const renderStep = (filed: boolean, state?: string) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages}>
      <Step filed={filed} state={state} />
    </NextIntlClientProvider>,
  );

describe('Protokoll-Schritt: Fassung ersetzen (G-13)', () => {
  it('offers replacing the filed version before sealing and sends the reason', async () => {
    renderStep(true);
    fireEvent.click(screen.getByRole('button', { name: /Aktionen für/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Fassung ersetzen/ }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Grund/ }), { target: { value: 'Falsche Datei' } });
    fireEvent.click(screen.getByRole('button', { name: /Ersetzen/ }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('m1', 'Falsche Datei'));
  });

  it('offers nothing to replace after sealing', () => {
    renderStep(true, 'signed');
    expect(screen.queryByRole('button', { name: /Aktionen für/ })).toBeNull();
  });
});
