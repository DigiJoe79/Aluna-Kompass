import { describe, expect, it } from 'vitest';
import { fieldLabelKey, formatProposalValue } from '@/app/(shell)/animals/proposals/field-format';
import messages from '../messages/de.json';

const t = (key: string) => key.split('.').reduce<unknown>((node, k) => (node as Record<string, unknown>)?.[k], messages) as string;
const o = { t, locales: ['de', 'en'] };

describe('proposal field format', () => {
  it('reads labels from the form, short ones for size and status', () => {
    expect(t(fieldLabelKey('summary'))).toBe('Kurztext');
    expect(t(fieldLabelKey('sizeCm'))).toBe('Größe (cm)');
    expect(t(fieldLabelKey('status'))).toBe('Status');
  });
  it('formats codes with their words', () => {
    expect(formatProposalValue('status', 'reserved', o)).toEqual([{ locale: null, text: 'Reserviert' }]);
    expect(formatProposalValue('sex', 'male', o)).toEqual([{ locale: null, text: 'Rüde' }]);
    expect(formatProposalValue('location', 'shelter', o)).toEqual([{ locale: null, text: 'im Shelter' }]);
    expect(formatProposalValue('isEmergency', true, o)).toEqual([{ locale: null, text: 'Ja' }]);
    expect(formatProposalValue('sizeCm', 55, o)).toEqual([{ locale: null, text: '55' }]);
    expect(formatProposalValue('sizeCm', null, o)).toEqual([{ locale: null, text: '' }]);
  });
  it('gives each language its own line, lists joined', () => {
    expect(formatProposalValue('summary', { de: 'A', en: '' }, o)).toEqual([{ locale: 'de', text: 'A' }, { locale: 'en', text: '' }]);
    expect(formatProposalValue('traits', { de: ['a', 'b'] }, o)).toEqual([{ locale: 'de', text: 'a, b' }, { locale: 'en', text: '' }]);
  });
});
