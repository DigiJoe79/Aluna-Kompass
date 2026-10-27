// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const releaseYearAction = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/reports/actions', () => ({ releaseYearAction, uploadAuditReportAction: vi.fn() }));
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
const { ReleaseDialog } = await import('@/app/(shell)/finance/reports/release-dialog');
afterEach(cleanup);
beforeEach(() => releaseYearAction.mockReset());

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const open = (current: React.ComponentProps<typeof ReleaseDialog>['current'] = null) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <ReleaseDialog open onOpenChange={() => undefined} year={{ id: 'y25', designation: '2025' }} current={current} />
    </NextIntlClientProvider>,
  );
const choose = (basis: string) => fireEvent.click(screen.getByRole('radio', { name: new RegExp(m(`finance.reports.release.bases.${basis}.label`)) }));
const save = () => fireEvent.click(screen.getByRole('button', { name: m('finance.reports.release.save') }));

describe('ReleaseDialog (Board 11b)', () => {
  it('offers six reasons, the written audit report first', () => {
    open();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(6);
    expect(radios[0]!.closest('label')!.textContent).toContain(m('finance.reports.release.bases.auditReport.label'));
  });

  it('asks for the scan with the audit report, for a note otherwise; the consequence only without audit report', () => {
    open();
    choose('auditReport');
    expect(screen.getAllByLabelText(new RegExp(m('finance.reports.release.scan'))).length).toBeGreaterThan(0);
    expect(screen.queryByRole('textbox', { name: new RegExp(m('finance.reports.release.note')) })).toBeNull();
    expect(screen.queryByTestId('release-consequence')).toBeNull();
    choose('notAudited');
    const note = screen.getByRole('textbox', { name: new RegExp(m('finance.reports.release.note')) });
    const starred = () => document.querySelector('label[for="release-note"]')!.closest('[data-slot="label-required"]');
    expect(note).toBeTruthy();
    expect(starred()).not.toBeNull();
    expect(screen.getByTestId('release-consequence')).toBeTruthy();
    choose('oralReport');
    expect(starred()).toBeNull();
  });

  it('never locks „Freigeben“ and puts field errors at the fields', async () => {
    releaseYearAction.mockResolvedValue({ status: 'error', message: 'x', fieldErrors: { note: 'Pflichtfeld.' } });
    open();
    choose('other');
    save();
    await waitFor(() => expect(releaseYearAction).toHaveBeenCalledWith('y25', 'other', '', null));
    expect(await screen.findByText('Pflichtfeld.')).toBeTruthy();
  });

  it('keeps the dialog open with the refusal', async () => {
    releaseYearAction.mockResolvedValue({ status: 'error', message: 'Die Freigabe lässt sich nicht mehr ändern.', fieldErrors: {} });
    open({ basis: 'oralReport', note: null, document: null });
    expect((screen.getByRole('radio', { name: new RegExp(m('finance.reports.release.bases.oralReport.label')) }) as HTMLElement).getAttribute('aria-checked')).toBe('true');
    save();
    expect(await screen.findByText('Die Freigabe lässt sich nicht mehr ändern.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
