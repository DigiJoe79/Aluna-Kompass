import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BlockedNotice, editHref } from '@/app/(shell)/site/publish/blocked-notice';
import { PreviewDetails } from '@/app/(shell)/site/publish/preview-details';
import { PreviewSummary } from '@/app/(shell)/site/publish/preview-summary';
import { PublishTarget } from '@/app/(shell)/site/publish/publish-target';
import type { DetailView } from '@/lib/site-job-view';
import messages from '../messages/de.json';

const render = (ui: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {ui}
    </NextIntlClientProvider>,
  );
const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
const zero = { changed: 0, added: 0, removed: 0, violations: 0, gaps: 0, stale: 0, pendingReview: 0, skippedImages: 0 };
const list = <T,>(items: T[], total = items.length) => ({ items, total, truncated: total > items.length });
const detail = (over: Partial<DetailView> = {}) => ({ counts: zero, diff: { changed: list([]), added: list([]), removed: list([]) }, ...over }) as DetailView;

describe('PreviewSummary', () => {
  it('keeps all three counts and names the hints', () => {
    const html = render(<PreviewSummary counts={{ ...zero, changed: 12, added: 3, gaps: 2, pendingReview: 1 }} />);
    expect(text(html)).toContain('12 geändert · 3 neu · 0 entfallen');
    expect(text(html)).toContain('3 Hinweise');
    expect(text(html)).toContain('2 Übersetzungslücken');
    expect(text(html)).toContain('Hinweise halten den Publish nicht auf');
  });
  it('says nothing about hints when there are none', () => {
    expect(text(render(<PreviewSummary counts={{ ...zero, changed: 1 }} />))).not.toContain('Hinweis');
  });
});

describe('PreviewDetails', () => {
  it('is closed and sums up empty categories in one sentence', () => {
    const html = render(<PreviewDetails detail={detail({ gaps: list([{ path: 'variables.claim', locale: 'en' }]) })} />);
    expect(html).toMatch(/<details(?![^>]*open)/);
    expect(text(html)).toContain('Text fehlt auf Englisch');
    expect(text(html)).toContain('Keine veralteten Verweise, nichts zu prüfen, alle Bilder lesbar.');
  });
  it('lists changed files and cuts long lists', () => {
    const html = render(<PreviewDetails detail={detail({ diff: { changed: list(['index.html']), added: list(['a.html'], 45), removed: list([]) } })} />);
    expect(text(html)).toContain('index.html');
    expect(text(html)).toContain('und 44 weitere');
  });
});

describe('BlockedNotice', () => {
  const v = (i: number) => ({ path: `collections.posts[${i}].title.de`, term: 'popescu', excerpt: `…Frau Popescu ${i}…`, edit: { kind: 'entry' as const, collection: 'posts', id: `E${i}`, title: `Eintrag ${i}` } });
  it('links to the entry, shows three hits and a link to the list only with site.manage', () => {
    const html = render(<BlockedNotice violations={[0, 1, 2, 3].map(v)} canManage={false} />);
    expect(html).toContain('href="/site/c/posts/E0"');
    expect(text(html)).toContain('„Eintrag 0“ bearbeiten');
    expect(text(html)).toContain('und 1 weitere Stelle');
    expect(html).toContain('<mark');
    expect(html).not.toContain('/admin/site?panel=blockedTerms');
    expect(text(html)).toContain('pflegt, wer die Webseite verwaltet');
  });
  it('offers the list to those who may edit it, and the variables page for a variable', () => {
    const html = render(<BlockedNotice violations={[{ path: 'variables.claim.de', term: 'popescu', excerpt: 'Frau Popescu', edit: { kind: 'variables' } }]} canManage />);
    expect(html).toContain('href="/admin/site?panel=blockedTerms"');
    expect(html).toContain('href="/site/variables"');
    expect(text(html)).toContain('Variablen bearbeiten');
  });
  it('links a view row to its edit page', () => {
    const edit = { kind: 'view' as const, href: '/animals/A1', title: 'Bruno' };
    expect(editHref(edit)).toBe('/animals/A1');
    const html = render(<BlockedNotice violations={[{ path: 'views.animals[3].summary.de', term: 'popescu', excerpt: 'Popescu', edit }]} canManage={false} />);
    expect(html).toContain('href="/animals/A1"');
    expect(text(html)).toContain('„Bruno“ bearbeiten');
  });
  it('gives file names no link', () => {
    expect(editHref(undefined)).toBeNull();
    const html = render(<BlockedNotice violations={[{ path: 'files/popescu.png', term: 'popescu', excerpt: 'popescu.png' }]} canManage={false} />);
    expect(html).not.toContain('bearbeiten');
  });
});

describe('PublishTarget', () => {
  it('names the environment and links the address', () => {
    const html = render(<PublishTarget env="test" publicUrl="https://staging.example.org" />);
    expect(text(html)).toContain('Test');
    expect(html).toContain('href="https://staging.example.org"');
    expect(text(html)).toContain('staging.example.org');
  });
  it('works without an address', () => {
    expect(text(render(<PublishTarget env="production" publicUrl={null} />))).toContain('Produktion');
  });
});
