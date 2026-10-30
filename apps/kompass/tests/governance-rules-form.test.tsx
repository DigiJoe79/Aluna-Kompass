// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { StatuteRules } from '@kompass/module-governance';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const update = vi.fn(async (input: { id: string; rules: StatuteRules; reason?: string }) => ({ status: 'success' as const, message: 'ok', data: input }));
const SIMPLE = { fraction: 'simple' as const, base: 'cast' as const, abstentions: 'ignored' as const, comparison: 'atLeast' as const };
const preview = vi.fn(async (id: string) => ({ statuteId: id, reasonRequired: true, affected: [{ resolutionId: 'r1', number: 'B-2025-001', kind: 'statute', decidedOn: '2025-03-20', before: { required: SIMPLE, reached: true }, after: { required: { ...SIMPLE, fraction: { num: 9, den: 10 } }, reached: false } }] }));
vi.mock('@/app/(shell)/governance/statutes/actions', () => ({ updateStatuteAction: (input: { id: string; rules: StatuteRules; reason?: string }) => update(input), previewStatuteRulesChangeAction: (id: string) => preview(id) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { RulesForm } = await import('@/app/(shell)/governance/statutes/[id]/rules/rules-form');

afterEach(() => {
  cleanup();
  update.mockClear();
  preview.mockClear();
});
const MV = 'mv';
const RULES: StatuteRules = {
  organs: { [MV]: { noticeDays: 14, quorum: { kind: 'fraction', fraction: { num: 1, den: 4 }, base: 'allMembers' }, majorities: { statute: { fraction: { num: 3, den: 4 }, base: 'cast', abstentions: 'ignored' } } } },
  references: { [MV]: { quorum: '§ 9 Satzung' } },
};
const organ = { id: MV, kind: 'assembly' as const, name: 'Mitgliederversammlung', offices: [], figures: { allMembers: 42, voting: 40, organMembers: 0, lastPresentVoting: 13 } };
const renderForm = (locked = false) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages}>
      <RulesForm statuteId="s1" rules={RULES} organs={[organ]} locked={locked} />
    </NextIntlClientProvider>,
  );
const row = (container: HTMLElement, key: string) => container.querySelector(`[data-rule="${MV}:${key}"]`) as HTMLElement;

describe('RulesForm', () => {
  it('a law row offers only “Eigene Regel eintragen”; pressing it turns purpose into a fraction field with the law value', () => {
    const { container } = renderForm();
    const purpose = row(container, 'majority.purpose');
    expect(purpose.querySelectorAll('input, select, textarea')).toHaveLength(0);
    expect(purpose.querySelectorAll('button')).toHaveLength(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Eigene Regel eintragen' }).find((b) => purpose.contains(b))!);
    const group = screen.getByRole('group', { name: 'Zweckänderung' });
    expect((group.querySelector('input[aria-label="Zähler"]') as HTMLInputElement).value).toBe('1');
  });

  it('saves purpose and keeps the quorum; × resets and the counter counts', async () => {
    const { container } = renderForm();
    const purpose = row(container, 'majority.purpose');
    fireEvent.click(purpose.querySelector('button')!);
    expect(screen.getByText(/1 Änderung/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    const saved = update.mock.calls[0]![0].rules;
    expect(saved.organs[MV]!.majorities!.purpose).toMatchObject({ fraction: { num: 1, den: 1 } });
    expect(saved.organs[MV]!.quorum).toEqual(RULES.organs[MV]!.quorum);
    expect(saved.references).toEqual(RULES.references);
    fireEvent.click(row(container, 'majority.purpose').querySelector('button[aria-label="Auf Gesetz zurücksetzen"]')!);
    expect(screen.queryByText(/1 Änderung/)).toBeNull();
    fireEvent.click(row(container, 'majority.statute').querySelector('button[aria-label="Auf Gesetz zurücksetzen"]')!);
    expect(screen.getByText(/1 Änderung/)).toBeTruthy();
  });

  it('G-5: a registered stand asks for a reason and shows which sealed resolutions the change would judge differently', async () => {
    const { container } = renderForm(true);
    expect(screen.queryByRole('textbox', { name: /Grund/ })).toBeNull();
    fireEvent.click(row(container, 'majority.purpose').querySelector('button')!);
    await waitFor(() => expect(preview).toHaveBeenCalledWith('s1'));
    expect(await screen.findByText(/B-2025-001/)).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: /Grund/ }), { target: { value: 'Tippfehler' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]![0].reason).toBe('Tippfehler');
  });

  it('a draft neither previews nor sends a reason', async () => {
    const { container } = renderForm();
    fireEvent.click(row(container, 'majority.purpose').querySelector('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]![0]).not.toHaveProperty('reason');
    expect(preview).not.toHaveBeenCalled();
  });
});
