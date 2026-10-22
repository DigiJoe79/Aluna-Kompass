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
  it('Haken und Wort für Vorleser', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <RequirementList items={[item('d', { done: true }), item('o')]} />
      </NextIntlClientProvider>,
    );
    const done = screen.getByTestId('requirement-d');
    expect(within(done).getByText('Erledigt').className).toContain('sr-only');
    expect(done.querySelector('svg.lucide-check')).not.toBeNull();
    expect(screen.getByTestId('requirement-o').querySelector('svg.lucide-circle-dashed')).not.toBeNull();
  });
});

/** N1 (Freigabe Joe 2026-10-22): Pflichtblock des CSV-Assistenten — eine Zeile je Punkt, ohne Rahmen und ohne Knopf. */
describe('RequirementList kompakt', () => {
  it('compact: one row per item without frame, check or circle, detail beside the title, no button', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <RequirementList variant="compact" items={[item('d', { done: true, detail: '„Datum“' }), item('o', { detail: 'fehlt', extra: <button type="button">X</button> })]} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    const done = screen.getByTestId('requirement-d');
    expect(done.dataset.done).toBe('true');
    expect(within(done).getByText('Erledigt')).toBeTruthy();
    expect(within(done).getByText('„Datum“')).toBeTruthy();
    const open = screen.getByTestId('requirement-o');
    expect(open.dataset.done).toBe('false');
    expect(within(open).getByText(messages.common.requirements.open)).toBeTruthy();
    expect(within(open).getByText('fehlt')).toBeTruthy();
  });
});
