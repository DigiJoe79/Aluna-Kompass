// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const saveFeeScheduleAction = vi.fn(async (_input: unknown) => ({ status: 'success' as const, message: 'ok' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/admin/members/actions', () => ({ saveFeeScheduleAction: (input: unknown) => saveFeeScheduleAction(input) }));
const { SchedulePanel } = await import('@/app/(shell)/admin/members/schedule-panel');
afterEach(() => {
  cleanup();
  saveFeeScheduleAction.mockClear();
});

const types = [
  { id: 'T1', label: 'Ordentlich', feeExempt: false, active: true },
  { id: 'T2', label: 'Alt', feeExempt: false, active: false },
];
const lockedStand = {
  id: 'S1',
  validFrom: '2026-01-01',
  resolvedOn: null,
  resolutionDocument: { id: 'DOC-1', number: 'PRT-1' },
  note: 'Gründung',
  locked: true,
  rules: [
    { typeId: 'T1', amountCents: 6000, interval: 'yearly' as const, minimum: false, allowedIntervals: ['yearly' as const], admissionFeeCents: 1000 },
    { typeId: 'T2', amountCents: 3000, interval: 'yearly' as const, minimum: false, allowedIntervals: ['yearly' as const], admissionFeeCents: null },
  ],
};

const show = () =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <SchedulePanel schedules={[lockedStand]} types={types} today="2026-09-05" />
    </NextIntlClientProvider>,
  );

/** Backlog 97: An einem festen Stand lässt sich der Beschluss nachtragen; Tag und Regeln bleiben, wie sie sind. */
describe('SchedulePanel, fester Stand', () => {
  it('öffnet den festen Stand zum Nachtragen: Tag und Beträge gesperrt, Beschlusstag frei', () => {
    show();
    fireEvent.click(within(screen.getByTestId('schedule-panel')).getByRole('button', { name: messages.members.admin.schedule.edit }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText(messages.members.admin.schedule.validFrom) as HTMLInputElement).disabled).toBe(true);
    expect((within(dialog).getByLabelText(messages.members.admin.schedule.resolvedOn) as HTMLInputElement).disabled).toBe(false);
    for (const input of dialog.querySelectorAll('[data-testid="schedule-rule"] input, [data-testid="schedule-rule"] select')) expect((input as HTMLInputElement).disabled).toBe(true);
  });

  it('speichert den Beschlusstag mit den unveränderten Regeln, Beschluss und Notiz bleiben', async () => {
    show();
    fireEvent.click(within(screen.getByTestId('schedule-panel')).getByRole('button', { name: messages.members.admin.schedule.edit }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(messages.members.admin.schedule.resolvedOn), { target: { value: '2025-12-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: messages.common.save }));
    await waitFor(() => expect(saveFeeScheduleAction).toHaveBeenCalledTimes(1));
    expect(saveFeeScheduleAction.mock.calls[0]![0]).toEqual({
      id: 'S1',
      validFrom: '2026-01-01',
      resolvedOn: '2025-12-01',
      resolutionDocumentId: 'DOC-1',
      note: 'Gründung',
      rules: lockedStand.rules,
    });
  });
});

/** G7: Ein Stand verweist auf einen Beschluss der Gremien — Beschriftung und Link neben dem Beschlusstag. */
describe('SchedulePanel, Beschluss aus Gremien', () => {
  it('zeigt den Beschluss als Link', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <SchedulePanel schedules={[{ ...lockedStand, resolutionDocument: null, resolutionRef: { label: 'Beschluss B-2026-001', href: '/governance/resolutions/R1' } }]} types={types} today="2026-09-05" />
      </NextIntlClientProvider>,
    );
    expect(within(screen.getByTestId('schedule-panel')).getByRole('link', { name: 'Beschluss B-2026-001' }).getAttribute('href')).toBe('/governance/resolutions/R1');
  });
});
