import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { conflictBody, statusFor } from '@/app/dms/export/status';

const t = createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin', onError: () => {} }) as unknown as Parameters<typeof conflictBody>[1];

describe('statusFor', () => {
  it('maps failures to HTTP', () => {
    expect(statusFor({ type: 'forbidden', permission: 'documents.export' })).toBe(403);
    expect(statusFor({ type: 'validation', issues: [] })).toBe(400);
    expect(statusFor({ type: 'conflict', code: 'bundleTooLarge', message: 'x' })).toBe(409);
    expect(statusFor({ type: 'notFound', entity: 'x', id: 'y' })).toBe(404);
  });
});

describe('conflictBody', () => {
  // Der Dialog zeigt `message` — es muss der Satz der Sprachdatei sein, nicht der Diensttext (Testdurchsicht 2026-10-22).
  it('carries the sentence of the language file, not the service text', () => {
    const empty = conflictBody({ type: 'conflict', code: 'bundleEmpty', message: 'Diensttext' }, t);
    expect(empty).toEqual({ code: 'bundleEmpty', message: t('errors.conflict.bundleEmpty') });
    expect(empty.message).not.toBe('Diensttext');

    const detail = 'Die Auswahl umfasst 900 Dokumente.';
    expect(conflictBody({ type: 'conflict', code: 'bundleTooLarge', message: detail }, t)).toEqual({ code: 'bundleTooLarge', message: t('errors.conflict.bundleTooLarge', { detail }) });
  });

  it('falls back to the general sentence for a code without one', () => {
    expect(conflictBody({ type: 'conflict', code: 'somethingNew', message: 'roh' }, t).message).toBe(t('errors.conflict.default', { detail: 'roh' }));
  });
});
