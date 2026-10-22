import { coreModule, readSetting, runModuleInstalls, setModuleEnabled, unwrap, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser, systemContext } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { mailBodyFor } from '../src/mail/body';
import { dmsModule } from '../src/manifest';
import { documentSnippets } from '../src/schema';
import { createSnippet } from '../src/snippets';

async function setup() {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule] });
  const userId = insertUser(deps, { name: 'Test', email: 'test@kompass.local' });
  const ctx = ctxWith(['modules.manage', 'settings.manage', 'dms.manage', 'dms.view'], userId);
  unwrap(await setModuleEnabled(deps, ctx, { key: 'contacts', enabled: true }));
  unwrap(await setModuleEnabled(deps, ctx, { key: 'dms', enabled: true }));
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'organization.name', 'Beispielverein'));
  return { deps, ctx };
}

const doc = { typeKey: 'letter', subject: 'Beitragsmitteilung 2026', number: 'BRF-2026-007', documentDate: '2026-09-03' };
const recipient = { name: 'Lena Sommer', salutation: 'Frau' };

describe('Begleittext der E-Mail', () => {
  it('bringt die Grundausstattung genau einmal mit', async () => {
    const { deps } = await setup();
    runModuleInstalls(deps);
    runModuleInstalls(deps);
    const rows = deps.db.select().from(documentSnippets).all().filter((s) => s.name === 'Begleittext E-Mail');
    expect(rows).toHaveLength(1);
    expect(readSetting<string | null>(deps, 'dms.mail.defaultBodySnippetId')).toBe(rows[0]!.id);
  });

  it('füllt die Platzhalter der Vorgabe', async () => {
    const { deps } = await setup();
    const text = mailBodyFor(deps, doc, recipient);
    for (const filled of ['Lena Sommer', 'Beitragsmitteilung 2026', 'BRF-2026-007', 'Beispielverein']) expect(text).toContain(filled);
    expect(text).not.toMatch(/\{\w+\}/);
    // Eine Leerzeile am Ende: Mailprogramme zeigen das PDF direkt unter dem Text (Joe 2026-10-18).
    expect(text.endsWith('\n\n')).toBe(true);
  });

  it('ersetzt alle Platzhalter und lässt unbekannte stehen', async () => {
    const { deps, ctx } = await setup();
    const snippet = unwrap(await createSnippet(deps, ctx, { name: 'Alle Platzhalter', body: '{Anrede} {Name} · {Betreff} · {Datum} · {Nummer} · {Verein} · {Unbekannt}' }));
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'dms.mail.bodySnippetByType', { letter: snippet.id }));
    expect(mailBodyFor(deps, doc, recipient)).toBe('Frau Lena Sommer · Beitragsmitteilung 2026 · 03.09.2026 · BRF-2026-007 · Beispielverein · {Unbekannt}\n\n');
  });

  it('nimmt den Baustein der Dokumentart vor der Vorgabe', async () => {
    const { deps, ctx } = await setup();
    const snippet = unwrap(await createSnippet(deps, ctx, { name: 'Begleittext Mahnung', body: 'Mahnung für {Name}' }));
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'dms.mail.bodySnippetByType', { reminder: snippet.id }));
    expect(mailBodyFor(deps, { ...doc, typeKey: 'reminder' }, recipient)).toBe('Mahnung für Lena Sommer\n\n');
    expect(mailBodyFor(deps, doc, recipient)).not.toBe('Mahnung für Lena Sommer\n\n');
  });

  it('fällt ohne Baustein auf den mitgelieferten Text zurück', async () => {
    const { deps } = await setup();
    deps.db.delete(documentSnippets).run();
    expect(mailBodyFor(deps, doc, { name: 'Lena Sommer', salutation: null })).toContain('Lena Sommer');
  });

  // Dass jede Vorgabe zu ihrem Schema passt, prüft `apps/kompass/tests/module-contracts.test.ts`.
  it('begrenzt die Mails je Minute', () => {
    const rate = dmsModule.settings!.find((s) => s.key === 'dms.mail.ratePerMinute')!;
    expect(rate.schema.safeParse(121).success).toBe(false);
    expect(rate.schema.safeParse(0).success).toBe(false);
  });
});
