// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { RequirementList, type RequirementListItem } from '@/components/requirement-list';

afterEach(cleanup);

const item = (key: string, over: Partial<RequirementListItem> = {}): RequirementListItem => ({
  key,
  title: `Punkt ${key}`,
  done: false,
  blocked: false,
  canSelf: true,
  canDoNames: [],
  canDoText: '',
  href: '/x',
  actionLabel: 'Erledigen',
  doneLabel: 'Erledigt',
  ...over,
});

function show(items: RequirementListItem[]) {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <RequirementList items={items} grouping="open-first" />
    </NextIntlClientProvider>,
  );
}

describe('RequirementList gruppiert', () => {
  it('„Fehlt noch“ und „Bitte ansehen“ sind benannte Gruppen ohne Überschrift, das Etikett ist eine Overline (K10 Charge 3, Designer § 8.3)', () => {
    show([item('a'), item('b', { done: true, warning: { text: 'Prüfen' } })]);
    const missing = screen.getByRole('region', { name: 'Fehlt noch' });
    expect(within(missing).queryByRole('heading')).toBeNull();
    expect(within(missing).getByText('Fehlt noch').className).toContain('text-label');
    const review = screen.getByRole('region', { name: 'Bitte ansehen' });
    expect(within(review).queryByRole('heading')).toBeNull();
  });

  it('eine leere Gruppe fehlt ganz', () => {
    show([item('a', { done: true })]);
    expect(screen.queryByRole('region', { name: 'Fehlt noch' })).toBeNull();
  });
});

/** 11-1 B33: „(optional — …)“ stand im Titel. Jetzt: Marke „Optional“ und die Erklärung als Unterzeile. */
describe('RequirementList optional', () => {
  it('zeigt die Marke und die Erklärung unter dem Titel', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <RequirementList items={[item('n', { title: 'Bescheid erfassen', optional: { label: 'Optional', note: 'Ohne Bescheid keine Zuwendungsbestätigungen.' } })]} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Bescheid erfassen').textContent).toBe('Bescheid erfassen');
    expect(screen.getByText('Optional')).toBeTruthy();
    expect(screen.getByText('Ohne Bescheid keine Zuwendungsbestätigungen.')).toBeTruthy();
  });
});

/** Runde 3, 166: Ein Zustand, eine Form — erledigt ist ein Haken (offen ein Kreis), die Zeile gedämpft; keine Marke „Erledigt“. */
describe('RequirementList erledigt', () => {
  it('Haken statt Marke, Wort für Vorleser, gedämpfte Zeile', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <RequirementList items={[item('d', { done: true }), item('o')]} />
      </NextIntlClientProvider>,
    );
    const done = screen.getByTestId('requirement-d');
    expect(within(done).queryByText('Erledigt', { selector: '[data-slot="status-badge"], .rounded-sm' })).toBeNull();
    expect(within(done).getByText('Erledigt').className).toContain('sr-only');
    expect(done.querySelector('svg.lucide-check')).not.toBeNull();
    expect(within(done).getByText('Punkt d').className).toContain('text-muted-ink');
    expect(screen.getByTestId('requirement-o').querySelector('svg.lucide-circle-dashed')).not.toBeNull();
  });
});

/**
 * Joe 2026-10-19: `sr-only` ist `position: absolute`. Ohne positionierten Vorfahren ist sein Bezugsrahmen das Fenster,
 * nicht der scrollende `main` der Shell — liegt die Zeile unter dem Falz, verlängert das Wort für Vorleser das Dokument
 * (Einrichtung › Finanzen: leere Fläche unter der Checkliste, Schiene und Zweitebene endeten darüber). Jede Zeile ist
 * deshalb selbst der Bezugsrahmen.
 */
describe('RequirementList Vorleser-Text', () => {
  it('jedes `sr-only` liegt in einer positionierten Zeile (`relative`)', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <RequirementList items={[item('o'), item('d', { done: true })]} />
      </NextIntlClientProvider>,
    );
    const hidden = Array.from(document.querySelectorAll('.sr-only'));
    expect(hidden.length).toBe(2);
    for (const el of hidden) expect(el.closest('li')?.className.split(' ')).toContain('relative');
  });
});
