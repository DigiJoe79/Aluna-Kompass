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
    expect(text).toContain('Lena Sommer');
    // M27: der Betreff als Name des Dokuments, mit Artikel — „anbei erhalten Sie das Dokument „…““.
    expect(text).toContain('anbei erhalten Sie das Dokument „Beitragsmitteilung 2026“ (BRF-2026-007) als PDF.');
    expect(text).toContain('Beispielverein');
    expect(text).not.toMatch(/\{(Name|Betreff|Verein)\}/);
    // Eine Leerzeile am Ende: Mailprogramme zeigen das PDF direkt unter dem Text (Joe 2026-10-18).
    expect(text.endsWith('Beispielverein\n\n')).toBe(true);
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

  it('führt das Recht dms.send und die Einstellungen des Versands', () => {
    expect(dmsModule.permissions).toContain('dms.send');
    const keys = (dmsModule.settings ?? []).map((s) => s.key);
    for (const key of ['dms.mail.fromAddress', 'dms.mail.fromName', 'dms.mail.replyTo', 'dms.mail.ratePerMinute', 'dms.mail.bodySnippetByType', 'dms.mail.defaultBodySnippetId', 'dms.mcpHumanOnlyAllowed']) {
      expect(keys).toContain(key);
    }
    const rate = dmsModule.settings!.find((s) => s.key === 'dms.mail.ratePerMinute')!;
    expect(rate.default).toBe(20);
    expect(rate.schema.safeParse(121).success).toBe(false);
    expect(rate.schema.safeParse(0).success).toBe(false);
  });
});
