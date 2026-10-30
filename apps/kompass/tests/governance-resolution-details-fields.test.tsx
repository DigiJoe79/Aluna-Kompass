// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { DateFormatProvider } from '@/components/date-format-provider';
import type { DetailsDraft } from '@/lib/governance/resolution-details';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }) }));
const { ResolutionDetailsFields } = await import('@/app/(shell)/governance/resolution-details-fields');
afterEach(cleanup);

const options = (ruled: string[], decidedBy = 'ASSEMBLY') => ({
  organs: [{ id: 'ASSEMBLY', name: 'Mitgliederversammlung' }, { id: 'BOARD', name: 'Vorstand' }],
  offices: [{ id: 'TREASURER', name: 'Kasse', organId: 'BOARD' }],
  fiscalYears: [],
  members: null,
  memberTypes: null,
  canPickDocuments: false,
  remunerationDeciders: Object.fromEntries(ruled.map((o) => [o, decidedBy])),
});
const draft = (patch: Partial<DetailsDraft['remuneration']>): DetailsDraft['remuneration'] => ({ statuteReference: '', decidedByOrganId: 'ASSEMBLY', officeIds: [], mode: 'flat', amount: '', validFrom: '', ...patch });
const show = (d: DetailsDraft['remuneration'], ruled: string[], decidedBy?: string, organId = 'ASSEMBLY') =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        <ResolutionDetailsFields id="d" kind="remuneration" organId={organId} draft={d} onChange={() => {}} options={options(ruled, decidedBy)} decidedOn="2026-10-29" />
      </DateFormatProvider>
    </NextIntlClientProvider>,
  );
const warned = () => screen.queryByTestId('details-remuneration-without-statute') !== null;

/** W-4: Der Formularhinweis folgt derselben Bedingung wie der Dienst — Regel `remuneration` des am Tag gültigen Stands. */
describe('ResolutionDetailsFields: Vergütung ohne Satzungsgrundlage', () => {
  it('ein eingetragener Verweis ersetzt die Regel nicht', () => {
    show(draft({ statuteReference: '§ 8 Abs. 3 Satzung' }), []);
    expect(warned()).toBe(true);
  });

  it('die Regel am Organ eines gewählten Amts genügt, auch ohne Verweis', () => {
    show(draft({ officeIds: ['TREASURER'] }), ['BOARD']);
    expect(warned()).toBe(false);
  });

  it('die Regel an einem unbeteiligten Organ genügt nicht', () => {
    show(draft({}), ['BOARD']);
    expect(warned()).toBe(true);
  });

  it('L-1: der Vorstand beschließt, die Regel nennt die Versammlung — Hinweis „anderes Organ“, nicht „ohne Grundlage“', () => {
    show(draft({ decidedByOrganId: 'BOARD', officeIds: ['TREASURER'] }), ['BOARD'], 'ASSEMBLY', 'BOARD');
    expect(screen.queryByTestId('details-remuneration-wrong-organ')).not.toBeNull();
    expect(warned()).toBe(false);
  });

  it('L-1: die Versammlung beschließt wie in der Regel — kein Hinweis', () => {
    show(draft({ officeIds: ['TREASURER'] }), ['BOARD']);
    expect(screen.queryByTestId('details-remuneration-wrong-organ')).toBeNull();
  });
});
