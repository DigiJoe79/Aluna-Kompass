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
