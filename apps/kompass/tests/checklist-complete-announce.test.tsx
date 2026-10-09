// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/(shell)/admin/finance/actions', () => ({ applyTaxDefaultsAction: vi.fn(), confirmSetupStepAction: vi.fn() }));

const { ChecklistPanel } = await import('@/app/(shell)/admin/finance/checklist-panel');

afterEach(cleanup);
beforeEach(() => vi.mocked(toast.success).mockClear());

const panel = (complete: boolean) => (
  <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
    <ChecklistPanel steps={[]} complete={complete} />
  </NextIntlClientProvider>
);
const COMPLETE = messages.finance.admin.checklist.completeHint;

describe('Checkliste: Ansage, wenn die Einrichtung vollständig wird', () => {
  // Der Hinweis „vollständig“ hat als hint keine Rolle; erscheint er nach einer Handlung, sagt der Toast das Ergebnis
  // an (MUSTER § A, Designer 2026-10-08). Beim Laden einer schon vollständigen Einrichtung nicht.
  it('beim Wechsel von offen auf vollständig genau einmal', () => {
    const { rerender } = render(panel(false));
    expect(toast.success).not.toHaveBeenCalled();
    rerender(panel(true));
    rerender(panel(true));
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(COMPLETE, { id: 'setup-complete' });
  });

  it('nicht beim Laden einer schon vollständigen Einrichtung', () => {
    render(panel(true));
    expect(toast.success).not.toHaveBeenCalled();
  });
});
