// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { findingText } from '@/app/(shell)/admin/site/sync-client';

vi.mock('@/app/(shell)/site/actions', () => ({ applySyncAction: vi.fn(), previewSyncAction: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
    {children}
  </NextIntlClientProvider>
);

/** Plan C: Eine Bildstelle in `images`, die kein eingeschaltetes Modul kennt, ist ein Hinweis beim Einlesen. */
describe('findingText', () => {
  it('nennt eine unbekannte Bildstelle', () => {
    const { result } = renderHook(() => useTranslations('site.template'), { wrapper });
    expect(findingText({ kind: 'unknownImagePlace', path: 'images.shop.banner' }, result.current)).toBe('Bildstelle images.shop.banner: Diese Kompass-Fassung kennt sie nicht; die Angabe bleibt ohne Wirkung.');
  });
});
