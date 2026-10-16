import { describe, expect, it } from 'vitest';
import { isNormalInList, STATUS_TONES, statusTone } from '@/components/status-badge';

// Marken (Designer Stufe 2 Nr. 6, Z6).
describe('STATUS_TONES', () => {
  it('kein accent in Marken (6b)', () => {
    for (const tones of Object.values(STATUS_TONES)) expect(Object.values(tones)).not.toContain('accent');
  });
  it('abgelehnte Auslage ist error (6c)', () => expect(statusTone('claim', 'rejected')).toBe('error'));
  it('Rollen sind neutral (6e)', () => expect(Object.values(STATUS_TONES.role)).toEqual(['neutral', 'neutral']));
  it('ein Agent im Protokoll trägt den Agenten-Ton', () => expect(statusTone('auditChannel', 'mcp')).toBe('agent'));
});

describe('Normalzustand in Listen ohne Marke (6a)', () => {
  it.each([
    ['entry', 'final'],
    ['user', 'active'],
    ['active', 'active'],
    ['notice', 'valid'],
    ['confirmation', 'valid'],
    ['document', 'issued'],
  ] as const)('%s: %s ist normal', (kind, status) => expect(isNormalInList(kind, status as never)).toBe(true));
  it('Abweichungen bleiben', () => {
    expect(isNormalInList('entry', 'draft')).toBe(false);
    expect(isNormalInList('entry', 'reversed')).toBe(false);
    expect(isNormalInList('user', 'inactive')).toBe(false);
    expect(isNormalInList('document', 'voided')).toBe(false);
  });
});
