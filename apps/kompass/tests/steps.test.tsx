// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

describe('Steps (kompakt, in Gruppen — Board 3a/3c, Freigabe Joe 2026-10-24)', () => {
  const TWELVE = Array.from({ length: 12 }, (_, i) => ({ key: `s${i + 1}`, label: `Schritt ${i + 1}` }));
  const GROUPS = [
    { label: 'Vor dem Abschluss', keys: TWELVE.slice(0, 7).map((s) => s.key) },
    { label: 'Abschluss', keys: ['s8'] },
    { label: 'Prüfung und Vorlage', keys: TWELVE.slice(8).map((s) => s.key) },
  ];

  it('drei Gruppen mit Etikett, je Gruppe eine Liste mit durchgehenden Nummern (start)', () => {
    show(<Steps density="compact" groups={GROUPS} steps={stepsFrom(TWELVE, 's6')} />);
    const lists = screen.getAllByRole('list');
    expect(lists.map((l) => l.getAttribute('aria-label'))).toEqual(['Vor dem Abschluss', 'Abschluss', 'Prüfung und Vorlage']);
    expect(lists.map((l) => l.getAttribute('start') ?? '1')).toEqual(['1', '8', '9']);
    expect(lists.map((l) => within(l).getAllByRole('listitem').length)).toEqual([7, 1, 4]);
    // Die Nummer im Kreis zählt über die Gruppen weiter: „9“ steht am ersten Schritt der dritten Gruppe.
    expect(within(lists[2]!).getAllByRole('listitem')[0]!.textContent).toContain('9');
    for (const label of ['Vor dem Abschluss', 'Abschluss', 'Prüfung und Vorlage']) expect(screen.getByText(label)).toBeTruthy();
  });

  it('Board 3a: die Gruppen stehen in einer Karte; ohne Gruppen gibt es keine', () => {
    show(<Steps density="compact" groups={GROUPS} steps={stepsFrom(TWELVE, 's6')} testId="closing" />);
    const card = screen.getByTestId('closing-card');
    expect(within(card).getAllByRole('list')).toHaveLength(3);
    expect(within(card).getAllByRole('listitem')).toHaveLength(12);
    cleanup();
    show(<Steps density="compact" steps={stepsFrom(TWELVE.slice(0, 3), 's2')} testId="plain" />);
    expect(screen.queryByTestId('plain-card')).toBeNull();
  });

  it('Antwort 2 Runde 6: `card` ohne Gruppen — dieselbe Karte mit Zeilen, ohne Overline; ohne `card` keine Karte', () => {
    show(<Steps density="compact" card label="Übergabe" steps={stepsFrom(TWELVE.slice(0, 3), 's2')} testId="handover" />);
    const card = screen.getByTestId('handover-card');
    const lists = within(card).getAllByRole('list');
    expect(lists).toHaveLength(1);
    expect(lists[0]!.getAttribute('aria-label')).toBe('Übergabe');
    expect(within(card).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByText('Übergabe')).toBeNull(); // kein Etikett über der Liste
    cleanup();
    show(<Steps density="compact" steps={stepsFrom(TWELVE.slice(0, 3), 's2')} testId="plain" />);
    expect(screen.queryByTestId('plain-card')).toBeNull();
  });

  it('höchstens ein aktiver Schritt über alle Gruppen', () => {
    const steps = stepsFrom(TWELVE, 's2').map((s) => (s.key === 's10' ? { ...s, state: 'active' as const } : s));
    expect(() => show(<Steps density="compact" groups={GROUPS} steps={steps} />)).toThrow(/at most one active step/);
  });

  it('Anker: jedes Listenelement trägt id="step-<key>"', () => {
    const { container } = show(<Steps density="compact" groups={GROUPS} steps={stepsFrom(TWELVE, 's8')} />);
    const target = container.querySelector('#step-s8');
    expect(target?.tagName).toBe('LI');
    expect(target?.getAttribute('aria-current')).toBe('step');
  });

  it('alle erledigt mit collapsedWhenDone: „Fertig.“ als status, Liste zu, der Knopf klappt mit aria-expanded auf', () => {
    show(<Steps density="compact" groups={GROUPS} steps={stepsFrom(TWELVE, null)} done="2025 ist geprüft." collapsedWhenDone={{ label: 'Schritte ansehen' }} />);
    expect(screen.getAllByRole('status').some((el) => el.textContent?.includes('Fertig.') && el.textContent.includes('2025 ist geprüft.'))).toBe(true);
    expect(screen.queryAllByRole('list')).toHaveLength(0);
    const toggle = screen.getByRole('button', { name: 'Schritte ansehen' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('list')).toHaveLength(3);
  });

  it('nicht alle erledigt: collapsedWhenDone ändert nichts', () => {
    show(<Steps density="compact" groups={GROUPS} steps={stepsFrom(TWELVE, 's12')} collapsedWhenDone={{ label: 'Schritte ansehen' }} />);
    expect(screen.queryByRole('button', { name: 'Schritte ansehen' })).toBeNull();
    expect(screen.getAllByRole('list')).toHaveLength(3);
  });
});

describe('stepsFrom', () => {
  it('Zustände aus dem aktiven Schlüssel: davor erledigt, danach offen; ohne Schlüssel alle erledigt', () => {
    const base = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }];
    expect(stepsFrom(base, 'b').map((s) => s.state)).toEqual(['done', 'active', 'todo']);
    expect(stepsFrom(base, 'b', { failed: true }).map((s) => s.state)).toEqual(['done', 'failed', 'todo']);
    expect(stepsFrom(base, null).map((s) => s.state)).toEqual(['done', 'done', 'done']);
    expect(() => stepsFrom(base, 'x')).toThrow(RangeError);
  });
});
