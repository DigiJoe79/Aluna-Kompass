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

/** Freigabe Joe 2026-10-26, Designer Runde 7 16b/16d: Zeilen mit Trennlinie in einer Karte statt Karten in der Karte. */
describe('RequirementList Zeilen', () => {
  function rows(items: RequirementListItem[], openFirstOnPhone?: boolean) {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <RequirementList variant="rows" items={items} openFirstOnPhone={openFirstOnPhone} />
      </NextIntlClientProvider>,
    );
  }

  it('eine Liste mit einem Listeneintrag je Punkt, in der gegebenen Reihenfolge', () => {
    rows([item('a', { href: null }), item('b', { href: null, done: true }), item('c', { href: null })]);
    const list = screen.getByTestId('requirement-list');
    expect(list.tagName).toBe('UL');
    expect(within(list).getAllByRole('listitem').map((li) => li.dataset.testid)).toEqual(['requirement-a', 'requirement-b', 'requirement-c']);
  });

  it('erledigt: Haken und Wort für Vorleser, offen: Kreis; Zusatz und Aktion stehen in der Zeile', () => {
    rows([item('d', { done: true, href: null, extra: <a href="/dms/1">STE-1</a> }), item('o', { href: '/ziel', detail: 'fehlt noch' })]);
    const done = screen.getByTestId('requirement-d');
    expect(within(done).getByText('Erledigt').className).toContain('sr-only');
    expect(done.querySelector('svg.lucide-check')).not.toBeNull();
    expect(within(done).getByRole('link', { name: 'STE-1' })).toBeTruthy();
    const open = screen.getByTestId('requirement-o');
    expect(open.querySelector('svg.lucide-circle')).not.toBeNull();
    expect(within(open).getByText(messages.common.requirements.open)).toBeTruthy();
    expect(within(open).getByText('fehlt noch', { exact: false })).toBeTruthy();
    expect(within(open).getByRole('link', { name: 'Erledigen' }).getAttribute('href')).toBe('/ziel');
  });

  it('wartend (blocked): nennt, worauf, und trägt weder Knopf noch Sprung — auch wenn der Aufrufer einen mitgibt', () => {
    rows([item('w', { blocked: true, blockedText: 'nach dem Festschreiben', extra: <button type="button">Ablegen …</button> })]);
    const waiting = screen.getByTestId('requirement-w');
    expect(waiting.dataset.blocked).toBe('true');
    expect(within(waiting).getByText('nach dem Festschreiben')).toBeTruthy();
    expect(within(waiting).queryByRole('button')).toBeNull();
    expect(within(waiting).queryByRole('link')).toBeNull();
  });

  // Designer Runde 8, 17a: In den Zeilen heißt gedämpft „noch nicht möglich“ — erledigt steht deshalb voll.
  it('erledigt steht voll, nur wartend ist gedämpft; wartend trägt den gestrichelten Kreis, offen den leeren', () => {
    rows([item('d', { done: true, href: null }), item('o', { href: '/ziel' }), item('w', { blocked: true, blockedText: 'nach dem Festschreiben' })]);
    expect(screen.getByTestId('requirement-d').dataset.muted).toBeUndefined();
    expect(screen.getByTestId('requirement-o').dataset.muted).toBeUndefined();
    const waiting = screen.getByTestId('requirement-w');
    expect(waiting.dataset.muted).toBe('true');
    expect(waiting.querySelector('svg.lucide-circle-dashed')).not.toBeNull();
    expect(screen.getByTestId('requirement-o').querySelector('svg.lucide-circle-dashed')).toBeNull();
  });

  // Designer Jahresrechnung Frage 5, Regel Runde 7 (307): Am Telefon steht die erste offene Zeile zuerst — nur auf Wunsch.
  it('openFirstOnPhone marks the first open row, never a waiting or done one; without the prop none', () => {
    rows([item('d', { done: true, href: null }), item('w', { blocked: true, blockedText: 'nach dem Festschreiben' }), item('o', { href: '/ziel' }), item('p', { href: '/ziel' })], true);
    const marked = screen.getAllByRole('listitem').filter((li) => li.dataset.firstOnPhone !== undefined);
    expect(marked.map((li) => li.dataset.testid)).toEqual(['requirement-o']);
    cleanup();
    rows([item('d', { done: true, href: null }), item('o', { href: '/ziel' })]);
    expect(screen.getAllByRole('listitem').some((li) => li.dataset.firstOnPhone !== undefined)).toBe(false);
  });
});
