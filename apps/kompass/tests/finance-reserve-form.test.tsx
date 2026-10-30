// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/finance/reserves' }));
vi.mock('@/app/(shell)/finance/reserves/actions', () => ({ saveReserveAction: vi.fn(), saveReserveUploadAction: vi.fn(), updateReserveAction: vi.fn() }));
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
const { ReserveForm } = await import('@/app/(shell)/finance/reserves/reserve-form');
afterEach(cleanup);

/** Rücklagen im wGB und in der Vermögensverwaltung (Plan U2 Task 6; Designer Frage 4): „Begründung“ Pflicht, unter dem Beschluss. */
const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const wrap = (node: React.ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{node}</NextIntlClientProvider>);
const save = () => screen.getByTestId('reserve-form-save') as HTMLButtonElement;
const reason = () => screen.queryByLabelText(new RegExp(m('finance.reserves.form.reason'))) as HTMLTextAreaElement | null;

function create(kind: string) {
  wrap(<ReserveForm purposes={[]} onClose={() => undefined} onSaved={() => undefined} />);
  fireEvent.change(screen.getByLabelText(m('finance.reserves.form.kind')), { target: { value: kind } });
  fireEvent.change(screen.getByLabelText(new RegExp(m('finance.reserves.form.name'))), { target: { value: 'Ersatz Kühlschrank' } });
  fireEvent.change(screen.getByTestId('voucher-file-input'), { target: { files: [new File(['%PDF-1.4'], 'beschluss.pdf', { type: 'application/pdf' })] } });
}

describe('ReserveForm: Begründung bei Rücklagen im Betrieb', () => {
  it('business: „Begründung“ is required and stands after the resolution; save waits for it', () => {
    create('business');
    const field = reason()!;
    // Pflicht: das Label trägt den Stern (`Label required`).
    expect(document.querySelector(`label[for="${field.id}"]`)!.closest('[data-slot="label-required"]')).not.toBeNull();
    const resolution = screen.getByText(m('finance.reserves.resolution.label'));
    expect(resolution.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(save().disabled).toBe(true);
    fireEvent.change(field, { target: { value: 'Für den Ersatz des Kühlschranks im Vereinscafé.' } });
    expect(save().disabled).toBe(false);
  });

  it('free: no reason field — the purpose text stays optional as before', () => {
    create('free');
    expect(reason()).toBeNull();
    expect(save().disabled).toBe(false);
  });

  it('editing an asset management reserve: an emptied reason locks save (Review Focus 5)', () => {
    wrap(
      <ReserveForm
        purposes={[]}
        initial={{ id: 'r1', kind: 'assetManagement', name: 'Instandhaltung Wohnung', purposeText: 'Dach der vermieteten Wohnung', purposeId: null, carryForwardCents: null, carryForwardDate: null, isActive: true, updatedAt: '2026-01-01T00:00:00.000Z' }}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );
    const field = reason()!;
    expect(field.value).toBe('Dach der vermieteten Wohnung');
    fireEvent.change(field, { target: { value: '  ' } });
    expect(save().disabled).toBe(true);
  });
});
