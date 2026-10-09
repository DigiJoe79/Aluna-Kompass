// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { ListTruncated } from '@/components/list-truncated';
import { MEDIA_LIST_LIMIT, capItems } from '@/app/(shell)/admin/media/types';
import messages from '../messages/de.json';

afterEach(cleanup);

/*
 * Die Mediathek zeigt höchstens 200 Dateien (Befund 0.2.4/10): Mit 1546 Dateien
 * lud „Alle Dateien“ auf dem NAS 7 s. Der Satz unter der Liste sagt, dass
 * mehr da ist und wie man eingrenzt.
 */
describe('capItems', () => {
  it('keeps the first 200 in their order and counts all matches', () => {
    const all = Array.from({ length: 1546 }, (_, i) => i);
    const { shown, matching } = capItems(all);
    expect(MEDIA_LIST_LIMIT).toBe(200);
    expect(shown).toEqual(all.slice(0, 200));
    expect(matching).toBe(1546);
  });

  it('leaves a short list alone', () => {
    expect(capItems([1, 2, 3])).toEqual({ shown: [1, 2, 3], matching: 3 });
  });
});

/** So ruft die Mediathek den Baustein auf (`library-client.tsx`). */
function Notice({ shown, matching }: { shown: number; matching: number }) {
  const t = useTranslations('media');
  return <ListTruncated shown={shown} total={matching} text={t('listTruncated', { shown, matching })} testId="media-list-truncated" />;
}

describe('ListTruncated', () => {
  const renderNotice = (shown: number, matching: number) =>
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <Notice shown={shown} matching={matching} />
      </NextIntlClientProvider>,
    );

  it('says how many of how many files are shown and how to narrow down', () => {
    renderNotice(200, 1546);
    expect(screen.getByTestId('media-list-truncated').textContent).toBe(
      'Es werden die ersten 200 von 1546 Dateien gezeigt. Grenzen Sie die Liste mit einem Ordner, der Suche oder der Art ein.',
    );
  });

  it('stays silent when everything is shown', () => {
    renderNotice(12, 12);
    expect(screen.queryByTestId('media-list-truncated')).toBeNull();
  });
});
