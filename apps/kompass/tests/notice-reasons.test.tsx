import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Notice } from '@/components/notice';
import messages from '../messages/de.json';

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {node}
    </NextIntlClientProvider>,
  );

/** Prüfer-Fixrunde 28.09., Punkt 3: mehrere Ablehnungsgründe als Liste in der gemeinsamen Fehlerbox, einer als Satz. */
describe('Notice mit Gründen', () => {
  it('zeigt mehrere Gründe als Liste, je Grund ein Punkt', () => {
    const markup = render(<Notice level="refuse" title="Nicht freigegeben" reasons={['Erster Grund. Abhilfe eins.', 'Zweiter Grund. Abhilfe zwei.']}>fallback</Notice>);
    expect(markup.match(/<li\b/g)?.length).toBe(2);
    expect(markup).toContain('Erster Grund. Abhilfe eins.');
    expect(markup).not.toContain('fallback');
  });

  it('zeigt einen Grund als Satz, ohne Liste', () => {
    const markup = render(<Notice level="refuse" reasons={['Nur ein Grund.']}>Nur ein Grund.</Notice>);
    expect(markup).not.toContain('<li');
    expect(markup).toContain('Nur ein Grund.');
  });
});
