// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
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
});
