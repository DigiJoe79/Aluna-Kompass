import { coreModule } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { dmsModule } from '@kompass/module-dms';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { auditSentences, type SentenceTranslator } from '@/lib/audit-sentences';
import messages from '../messages/de.json';

/** Stufe 1, Auftrag 7: `toInbox` heißt „Ziel null“ wie bis 0.2.11; mit `outgoing` wurde ein Ausgang aus dem Ordner genommen. */
const t = createTranslator({ locale: 'de', messages, namespace: 'audit', timeZone: 'Europe/Berlin' }) as unknown as SentenceTranslator;

describe('Satz zu dms.move', () => {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule] });
  const ctx = ctxWith(['audit.view'], insertUser(deps, {}));
  const sentence = (params: Record<string, string | boolean>) => auditSentences(deps, ctx, t, [{ id: 'A', action: 'dms.move', params, paramUserNames: {} }], { paper: false }).A;

  it('nennt Eingangskorb, Ordner und „aus dem Ordner genommen“', () => {
    expect(sentence({ number: 'BEH-2026-001', folder: '', toInbox: true })).toBe('Dokument „BEH-2026-001“ in den Eingangskorb verschoben');
    expect(sentence({ number: 'BRF-2026-002', folder: 'vorstand', toInbox: false })).toBe('Dokument „BRF-2026-002“ nach „vorstand“ verschoben');
    expect(sentence({ number: 'BRF-2026-003', folder: '', toInbox: true, outgoing: true })).toBe('Dokument „BRF-2026-003“ aus dem Ordner genommen');
    expect(sentence({ number: 'BRF-2026-004', folder: 'vorstand', toInbox: false, outgoing: true })).toBe('Dokument „BRF-2026-004“ nach „vorstand“ verschoben');
  });

  it('alte Einträge ohne `outgoing` bleiben beim alten Satz', () => {
    expect(sentence({ number: 'BRF-2025-001', folder: '', toInbox: true })).toBe('Dokument „BRF-2025-001“ in den Eingangskorb verschoben');
  });
});
