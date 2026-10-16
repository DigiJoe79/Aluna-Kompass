// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { Steps, stepsFrom, type Step } from '@/components/steps';

/**
 * E3 „Schritte und Assistent“ (Designer 2026-10-17, Notiz `entwuerfe/E3-schritte.md`): ein Baustein in zwei Dichten.
 * Ersetzt `GuidedSteps` (HANDOFF § 13.2): offen, aktiv, erledigt, fehlgeschlagen, alle erledigt.
 */
const show = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {ui}
    </NextIntlClientProvider>,
  );
afterEach(cleanup);

const FOUR: Step[] = [
  { key: 'upload', label: 'Datei hochladen', state: 'done' },
  { key: 'columns', label: 'Spalten zuordnen', state: 'active' },
  { key: 'check', label: 'Vorzeichen prüfen', state: 'todo' },
  { key: 'load', label: 'Vorschau und Einlesen', state: 'todo' },
];

describe('Steps (Leiste)', () => {
  it('geordnete Liste „Schritte“, der aktive mit aria-current="step", jeder Marker mit Zustand für Vorleser', () => {
    show(<Steps steps={FOUR} />);
    const list = screen.getByRole('list', { name: 'Schritte' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-state'))).toEqual(['done', 'active', 'todo', 'todo']);
    expect(items.filter((li) => li.getAttribute('aria-current') === 'step')).toHaveLength(1);
    expect(items[1]!.getAttribute('aria-current')).toBe('step');
    expect(items[0]!.textContent).toContain('erledigt');
    expect(items[2]!.textContent).toContain('offen');
  });

  it('Telefon: „Schritt 2 von 4“, Name des aktiven Schritts, Segmentbalken als progressbar, „Danach: …“', () => {
    show(<Steps steps={FOUR} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect(bar.getAttribute('aria-valuemax')).toBe('4');
    expect(bar.getAttribute('aria-valuetext')).toBe('Schritt 2 von 4, Spalten zuordnen');
    expect(screen.getByText('Schritt 2 von 4')).toBeTruthy();
    expect(screen.getByText('Danach: Vorzeichen prüfen')).toBeTruthy();
  });

  it('fehlgeschlagen ersetzt aktiv, mit Satz und als alert', () => {
    const failed = FOUR.map((s) => (s.key === 'columns' ? { ...s, state: 'failed' as const, failure: '3 Spalten fehlen.' } : s));
    show(<Steps steps={failed} />);
    const items = within(screen.getByRole('list', { name: 'Schritte' })).getAllByRole('listitem');
    expect(items[1]!.getAttribute('data-state')).toBe('failed');
    expect(items[1]!.getAttribute('aria-current')).toBe('step');
    expect(screen.getAllByRole('alert')[0]!.textContent).toContain('3 Spalten fehlen.');
  });

  it('alle erledigt: alle Haken, „Fertig.“ mit Ergebnis als status, am Telefon „4 von 4 erledigt“', () => {
    const all = FOUR.map((s) => ({ ...s, state: 'done' as const }));
    show(<Steps steps={all} done="128 Umsätze eingelesen." />);
    const items = within(screen.getByRole('list', { name: 'Schritte' })).getAllByRole('listitem');
    expect(items.every((li) => li.getAttribute('data-state') === 'done')).toBe(true);
    expect(items.some((li) => li.getAttribute('aria-current'))).toBe(false);
    const status = screen.getAllByRole('status');
    expect(status.some((el) => el.textContent?.includes('Fertig.') && el.textContent.includes('128 Umsätze eingelesen.'))).toBe(true);
    expect(screen.getByText('4 von 4 erledigt')).toBeTruthy();
  });

  it('ein erledigter Schritt mit Ziel ist ein Link zurück, offene Schritte nicht', () => {
    show(<Steps steps={[{ ...FOUR[0]!, href: '/zurueck' }, ...FOUR.slice(1).map((s) => ({ ...s, href: '/nein' }))]} />);
    expect(screen.getByRole('link', { name: /Datei hochladen/ }).getAttribute('href')).toBe('/zurueck');
    expect(screen.queryByRole('link', { name: /Vorzeichen/ })).toBeNull();
  });

  it('nie mehr als ein Schritt aktiv', () => {
    const two = FOUR.map((s) => ({ ...s, state: 'active' as const }));
    expect(() => show(<Steps steps={two} />)).toThrow(/at most one active step/);
  });
});

describe('Steps (kompakt)', () => {
  it('Zeilen mit Detail und Handlung am aktiven Schritt, ohne Telefon-Balken', () => {
    show(
      <Steps
        density="compact"
        steps={[
          { key: 'created', label: 'Bestätigung erzeugt', state: 'done', detail: '14.10.2026' },
          { key: 'print', label: 'Ausdrucken und unterschreiben', state: 'active', action: <a href="/pdf">PDF öffnen</a> },
          { key: 'upload', label: 'Unterschriebene Fassung ablegen', state: 'todo' },
        ]}
      />,
    );
    expect(screen.queryByRole('progressbar')).toBeNull();
    const items = within(screen.getByRole('list', { name: 'Schritte' })).getAllByRole('listitem');
    expect(items[0]!.textContent).toContain('14.10.2026');
    expect(within(items[1]!).getByRole('link', { name: 'PDF öffnen' })).toBeTruthy();
  });
});

describe('stepsFrom', () => {
  it('Zustände aus dem aktiven Schlüssel: davor erledigt, danach offen; ohne Schlüssel alle erledigt', () => {
    const base = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }];
    expect(stepsFrom(base, 'b').map((s) => s.state)).toEqual(['done', 'active', 'todo']);
    expect(stepsFrom(base, 'b', { failed: true }).map((s) => s.state)).toEqual(['done', 'failed', 'todo']);
    expect(stepsFrom(base, null).map((s) => s.state)).toEqual(['done', 'done', 'done']);
    expect(() => stepsFrom(base, 'x')).toThrow(/unknown step/);
  });
});
