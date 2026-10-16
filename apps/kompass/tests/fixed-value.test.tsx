// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { FixedValue } from '@/components/fixed-value';
import { ManagedField } from '@/components/managed-field';

/** E2 „Fester Wert als Text“ (Designer 2026-10-17, Notiz `entwuerfe/E2-fester-wert.md`). */
const show = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {ui}
    </NextIntlClientProvider>,
  );

afterEach(cleanup);

describe('FixedValue', () => {
  it('Gruppe mit Beschriftung und Wert im Namen, Grund als Beschreibung; kein Eingabeelement', () => {
    show(<FixedValue id="art" label="Dokumentart" value="Brief" reason="Steht beim Entwurf fest." />);
    const group = screen.getByRole('group', { name: 'Dokumentart Brief' });
    expect(group.getAttribute('aria-describedby')).toBe('art-reason');
    expect(document.getElementById('art-reason')?.textContent).toBe('Steht beim Entwurf fest.');
    expect(group.querySelector('input, select, textarea, label')).toBeNull();
    expect(group.querySelector('[tabindex]')).toBeNull();
  });

  it('Wert ohne Rahmen, Höhe wie ein Feld, Textkante der Beschriftung', () => {
    show(<FixedValue id="w" label="Für wen?" value="Amira Okonkwo (Sie selbst)" reason="x" />);
    const value = document.getElementById('w-value')!;
    expect(value.className).toContain('min-h-[var(--field-h)]');
    expect(value.className).not.toMatch(/\bborder\b|\bpx-|\bbg-/);
  });

  it('leer zeigt „—“, der Grund bleibt', () => {
    show(<FixedValue id="n" label="Nummer" value={null} reason="Wird beim Ausstellen vergeben." />);
    expect(document.getElementById('n-value')?.textContent).toBe('—');
    expect(screen.getByText('Wird beim Ausstellen vergeben.')).toBeTruthy();
  });

  it('Wert mit Link: der Wert selbst ist der Link', () => {
    show(<FixedValue id="b" label="Bescheid" value="Bescheid vom 14.03.2025" href="/dms/1" reason="x" />);
    expect(screen.getByRole('link', { name: 'Bescheid vom 14.03.2025' }).getAttribute('href')).toBe('/dms/1');
  });

  it('Kennungen in Mono', () => {
    show(<FixedValue id="i" label="IBAN" value="DE02 9999" reason="x" mono />);
    expect(document.getElementById('i-value')?.className).toContain('font-mono');
  });
});

describe('ManagedField ist ein FixedValue mit „Geführt in …“', () => {
  it('Grund mit Link zur Quelle, kein Kennzeichen „geführt“ im Wert', () => {
    show(<ManagedField id="iban" label="IBAN" value="DE02 1234" managedBy={{ label: 'Bankkonten', href: '/admin/finance?panel=accounts' }} />);
    expect(screen.getByRole('group', { name: 'IBAN DE02 1234' })).toBeTruthy();
    expect(document.getElementById('iban-reason')?.textContent).toBe('Geführt in Bankkonten');
    expect(screen.getByRole('link', { name: 'Bankkonten' }).getAttribute('href')).toBe('/admin/finance?panel=accounts');
    expect(screen.queryByText('geführt')).toBeNull();
  });
});
