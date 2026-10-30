// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MeetingContext } from '@kompass/module-governance';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { PersonFields, personDetails, type PersonDraft } from '@/app/(shell)/governance/meetings/[id]/live/person-fields';

afterEach(cleanup);

const context = { names: { c1: 'Anton Beispiel' }, offices: [{ id: 'o1', name: 'Kasse' }], terms: [{ id: 't1', officeId: 'o1', contactId: 'c1' }] } as unknown as MeetingContext;
const options = { members: [{ id: 'ms1', name: 'Erika Beispiel' }], memberTypes: [{ id: 'ty1', name: 'Ehrenmitglied' }] };
const empty: PersonDraft = { termId: '', membershipId: '', typeId: '' };
const renderFields = (kind: 'dismissal' | 'honoraryMember', onChange: (d: PersonDraft) => void) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages}>
      <PersonFields id="i1" kind={kind} context={context} options={options} draft={empty} readOnly={false} onChange={onChange} />
    </NextIntlClientProvider>,
  );

describe('PersonFields (G-3)', () => {
  it('a dismissal chooses the running term; the details carry its termId', () => {
    const onChange = vi.fn();
    renderFields('dismissal', onChange);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toContain('Anton Beispiel — Kasse');
    fireEvent.change(select, { target: { value: 't1' } });
    expect(onChange).toHaveBeenCalledWith({ ...empty, termId: 't1' });
    expect(personDetails('dismissal', empty)).toBeNull();
    expect(personDetails('dismissal', { ...empty, termId: 't1' })).toEqual({ termId: 't1' });
  });

  it('an honorary member chooses member and type; details only with both', () => {
    const onChange = vi.fn();
    renderFields('honoraryMember', onChange);
    const [member, type] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(member!, { target: { value: 'ms1' } });
    expect(onChange).toHaveBeenCalledWith({ ...empty, membershipId: 'ms1' });
    fireEvent.change(type!, { target: { value: 'ty1' } });
    expect(personDetails('honoraryMember', { ...empty, membershipId: 'ms1' })).toBeNull();
    expect(personDetails('honoraryMember', { ...empty, membershipId: 'ms1', typeId: 'ty1' })).toEqual({ membershipId: 'ms1', typeId: 'ty1' });
  });
});
