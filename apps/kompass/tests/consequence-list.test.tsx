// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { ConsequenceList } from '@/components/consequence-list';

/** Folgen ohne Nullzeilen (Designer Runde 3, 079): „0 Entwürfe werden gelöscht (0 geprüft)“ steht nicht da. */
afterEach(cleanup);

describe('ConsequenceList ohne Nullzeilen', () => {
  it('eine Folge mit der Zahl 0 fällt weg', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages}>
        <ConsequenceList items={[{ label: '3 Umsätze werden gelöscht', count: 3 }, { label: '0 Entwürfe werden gelöscht', count: 0 }, { label: 'ohne Zahl' }]} />
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['3 Umsätze werden gelöscht', 'ohne Zahl']);
  });

  it('„davon geprüft“ steht nur, wenn es geprüfte gibt', () => {
    const t = createTranslator({ locale: 'de', messages, namespace: 'finance.imports.discard.consequence' as never }) as unknown as (key: string, values: Record<string, number>) => string;
    expect(t('drafts', { count: 2, reviewed: 0 })).toBe('2 Entwürfe werden gelöscht');
    expect(t('drafts', { count: 2, reviewed: 1 })).toBe('2 Entwürfe werden gelöscht (1 geprüft)');
  });
});
