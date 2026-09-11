import type { DocumentRenderContext } from '@kompass/core';
import { DEFAULT_THEME } from '@kompass/core/themes';
import { describe, expect, it } from 'vitest';
import { letterTemplate } from '../src/templates';

function renderContext(): DocumentRenderContext {
  return {
    number: 'BRF-2026-001',
    issuedAt: '2026-09-10T12:00:00.000Z',
    organization: { 'organization.name': 'Musterverein e.V.' },
    theme: DEFAULT_THEME,
    logo: null,
  };
}

describe('letterTemplate', () => {
  it('setzt Empfänger und Betreff in die Slots', () => {
    const built = letterTemplate.build(
      { subject: 'Einladung', body: '# Hallo', recipient: 'Familie Muster\nWeg 1\n12345 Stadt' },
      renderContext(),
    );
    expect(built.slots.kind).toBe('letter');
    expect(built.slots.recipient).toContain('Familie Muster');
    expect(built.slots.subject).toBe('Einladung');
    expect(built.body).toEqual({ markdown: '# Hallo' });
  });

  it('bleibt rein — zweimal gebaut ist zweimal gleich', () => {
    const data = { subject: 'A', body: 'B', recipient: 'C' };
    expect(letterTemplate.build(data, renderContext())).toEqual(letterTemplate.build(data, renderContext()));
  });
});
