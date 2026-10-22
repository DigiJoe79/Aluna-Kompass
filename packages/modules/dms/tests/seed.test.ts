import { coreModule, isoNow, readSetting, unwrap, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule, seedContacts } from '@kompass/module-contacts';
import { eq, isNotNull } from 'drizzle-orm';
import { readTextLayer } from '@kompass/text-extraction';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_DOCUMENT_TYPES } from '../src/catalog';
import { countDocumentText } from '../src/index-store';
import { dmsModule } from '../src/manifest';
import { dmsMailOutbox, documentFolders, documentFormerNumbers, documentLinks, documentRelations, documentRules, documents, documentTypes } from '../src/schema';
import { seedDms } from '../src/seed';
import { getDocument } from '../src/service';
import { ALL_DMS } from './helpers';

function setup() {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule] });
  const userId = insertUser(deps, { name: 'Admin', email: 'admin@kompass.local' });
  return {
    deps,
    ctx: ctxWith([...ALL_DMS, 'contacts.manage', 'followUps.view', 'followUps.manage'], userId),
  };
}

/** Mit den Kontakten des Kontakte-Seeds — so wie `seedDevelopment` die Module nacheinander fährt. */
async function setupWithContacts(now?: string) {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule], ...(now ? { now } : {}) });
  const userId = insertUser(deps, { name: 'Admin', email: 'admin@kompass.local' });
  const ctx = ctxWith([...ALL_DMS, 'contacts.manage', 'contacts.view', 'followUps.view', 'followUps.manage'], userId);
  // Die Rollen der Kontakte kommen aus eingeschalteten Modulen (`contactRoleDefinitions`).
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctx, 'modules.enabled', ['contacts', 'dms']));
  await seedContacts(deps, ctx);
  return { deps, ctx };
}

describe('seedDms', () => {
  it('the example document types carry distinct prefixes', () => {
    const prefixes = EXAMPLE_DOCUMENT_TYPES.map((t) => t.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('legt Arten, Ordner und Beispieldokumente an', async () => {
    const { deps, ctx } = setup();
    await seedDms(deps, ctx);
    expect(deps.db.select().from(documentTypes).all().length).toBeGreaterThanOrEqual(5);
    expect(deps.db.select().from(documentFolders).all().length).toBeGreaterThan(0);
    const docs = deps.db.select().from(documents).all();
    expect(docs.some((d) => d.phase === 'draft')).toBe(true);
    expect(docs.some((d) => d.phase === 'issued' && d.direction === 'outgoing')).toBe(true);
    expect(docs.some((d) => d.direction === 'incoming' && d.folder === null)).toBe(true);
  });

  it('bringt Ordner in drei Ebenen und einen langen Namen, jeder mit Elternordner', async () => {
    const { deps, ctx } = setup();
    await seedDms(deps, ctx);
    const paths = deps.db.select().from(documentFolders).all().map((f) => f.path);
    const set = new Set(paths);
    for (const path of paths) {
      if (path.includes('/')) expect(set.has(path.slice(0, path.lastIndexOf('/')))).toBe(true);
    }
    expect(paths.some((p) => p.split('/').length >= 3)).toBe(true);
    expect(paths.some((p) => p.split('/').some((segment) => segment.length > 40))).toBe(true);
    const deep = deps.db.select().from(documents).all().filter((d) => (d.folder ?? '').split('/').length >= 3);
    expect(deep.length).toBeGreaterThan(0);
    // Lesbare Namen statt Kürzeln (0.2.12, Joe 2026-10-16): Ordner haben keinen Anzeigenamen, das Pfadsegment ist der Name.
    expect(paths.some((p) => /^[a-z]/.test(p))).toBe(false);
    const rules = deps.db.select().from(documentRules).all().filter((r) => r.thenFolder);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.filter((r) => !set.has(r.thenFolder!)).map((r) => r.thenFolder)).toEqual([]);
  });

  it('legt die Briefe aus 0.1 ins Stichjahr, keine feste Jahreszahl (Befund 0.2.8/20)', async () => {
    // 2031 ist das Stichjahr: Antrag und Bescheid gelten zwei Jahre davor, der Registerordner trägt das Jahr.
    const { deps, ctx } = await setupWithContacts('2031-10-01T08:00:00.000Z');
    await seedDms(deps, ctx);
    const docs = deps.db.select().from(documents).all();
    expect(docs.filter((d) => (d.folder ?? '').includes('2031')).length).toBeGreaterThan(0);
    const texts = [...docs.flatMap((d) => [d.subject, d.folder ?? '', d.fileName ?? '']), ...deps.db.select().from(documentFolders).all().map((f) => f.path)];
    // Jede Jahreszahl hängt am Stichjahr: höchstens drei Jahre davor, nie die von 2026.
    expect(texts.flatMap((text) => text.match(/\b20\d\d\b/g) ?? []).filter((year) => Number(year) < 2028 || Number(year) > 2031)).toEqual([]);
  });

  it('bringt einen umklassifizierten Eingang mit früherer Nummer (Spec 2026-09-19)', async () => {
    const { deps, ctx } = setup();
    await seedDms(deps, ctx);
    const former = deps.db.select().from(documentFormerNumbers).all();
    expect(former.length).toBeGreaterThanOrEqual(1);
    const doc = deps.db.select().from(documents).all().find((d) => d.id === former[0]!.documentId)!;
    expect(doc).toMatchObject({ direction: 'incoming' });
    expect(former[0]!.number).toMatch(/^[A-Z]{3}-\d{4}-\d{3}$/);
  });

  it('bringt den Ausgang mit drei Zuständen: gesendet, nicht zugestellt, wartend', async () => {
    const { deps, ctx } = await setupWithContacts();
    await seedDms(deps, ctx);
    const rows = deps.db.select().from(dmsMailOutbox).all();
    expect([...new Set(rows.map((r) => r.status))].sort()).toEqual(['failed', 'queued', 'sent']);
    expect(rows.find((r) => r.status === 'failed')).toMatchObject({ lastErrorCode: 'rejected', attempts: 3 });
    expect(rows.find((r) => r.status === 'failed')!.lastErrorText).not.toContain('@');
    expect(rows.every((r) => r.toAddress.endsWith('example.org'))).toBe(true);
    expect(readSetting<string>(deps, 'dms.mail.fromAddress')).toMatch(/@.*example\.org$/);
    // Der gesendete trägt den Vermerk am Dokument.
    const sent = rows.find((r) => r.status === 'sent')!;
    expect(deps.db.select().from(documents).where(eq(documents.id, sent.documentId)).get()!.sentVia).toBe('email');
  });

  it('lässt die Beispieldokumente vom Worker lesen, statt den Index selbst zu füllen', async () => {
    const { deps, ctx } = setup();

    await seedDms(deps, ctx);

    const withFile = deps.db.select().from(documents).where(isNotNull(documents.fileName)).all();
    expect(withFile.length).toBeGreaterThan(0);
    for (const row of withFile) {
      expect(row.textStatus).toBe('pending');
      expect(countDocumentText(deps, row.id)).toBe(0);
    }
  });

  it('bringt je Neuerung ein Beispiel: Antwort, Versand, Notiz, Bausteine', async () => {
    const { deps, ctx } = setup();
    await seedDms(deps, ctx);
    const { documentNotes, documentRelations, documentSnippets } = await import('../src/schema');
    expect(deps.db.select().from(documentRelations).all().some((r) => r.kind === 'repliesTo')).toBe(true);
    expect(deps.db.select().from(documents).all().some((d) => d.sentAt !== null && d.sentVia === 'post')).toBe(true);
    expect(deps.db.select().from(documents).all().some((d) => d.direction === 'outgoing' && d.phase === 'issued' && d.sentAt === null)).toBe(true);
    expect(deps.db.select().from(documentNotes).all().length).toBeGreaterThan(0);
    expect(deps.db.select().from(documentSnippets).all().length).toBeGreaterThanOrEqual(2);
  });

  /**
   * Das Beispiel im Eingangskorb soll der Worker wirklich lesen können: Die
   * Volltextsuche ist sonst in der Entwicklung leer, und der E2E-Test für die
   * Texterkennung im Image hat nichts zu finden. Das Wort steht bewusst nicht
   * im Betreff — nur so beweist ein Treffer, dass der Inhalt gelesen wurde.
   * Seit 0.2.7 „Rechtsbehelfsbelehrung“ statt „Tierschutzes“: Den Zweck nennen
   * jetzt auch die Zuwendungsbestätigungen des Finanz-Seeds.
   */
  it('legt ein Eingangsdokument mit lesbarer Textebene ab — Steuernummer wie im Finanz-Seed', async () => {
    const { deps, ctx } = setup();
    await seedDms(deps, ctx);
    const bescheid = deps.db.select().from(documents).all().find((d) => d.subject === 'Freistellungsbescheid')!;
    expect(bescheid.subject).not.toMatch(/Rechtsbehelf/i);
    const datei = unwrap(await getDocument(deps, ctx, bescheid.id));
    const seiten = (await readTextLayer(datei.bytes, 30_000)).join(' ');
    expect(seiten).toContain('Rechtsbehelfsbelehrung');
    expect(seiten).toContain('99/999/99999');
    expect(seiten).toContain('Tierschutzes');
  });

  it('erzählt ein Vereinsjahr: Schriftverkehr in den Ordnern, Antwort und Folgeschreiben verknüpft (Spec 2026-10-06 § 4)', async () => {
    const { deps, ctx } = await setupWithContacts();
    await seedDms(deps, ctx);
    const docs = deps.db.select().from(documents).all();
    expect(docs.length).toBeGreaterThanOrEqual(20);
    const relations = deps.db.select().from(documentRelations).all();
    for (const kind of ['repliesTo', 'attachmentOf']) expect(relations.some((r) => r.kind === kind), kind).toBe(true);
    // Eine Antwort ist nie älter als das, worauf sie antwortet.
    const dateOf = new Map(docs.map((d) => [d.id, d.documentDate ?? '']));
    expect(relations.filter((r) => r.kind === 'repliesTo' && dateOf.get(r.documentId)! < dateOf.get(r.relatedDocumentId)!)).toEqual([]);
    expect(new Set(docs.flatMap((d) => (d.folder ? [d.folder.split('/')[0]] : []))).size).toBeGreaterThanOrEqual(4);
  });

  it('bringt einen Briefentwurf mit Text, Aufzählung und Empfänger — für „Brief mit Vorschau“', async () => {
    const { deps, ctx } = await setupWithContacts();
    await seedDms(deps, ctx);
    const draft = deps.db.select().from(documents).all().find((d) => d.phase === 'draft' && d.typeKey === 'letter' && (d.draftBody ?? '').length > 600 && /^- /m.test(d.draftBody!) && /\*\*[^*]+\*\*/.test(d.draftBody!));
    expect(draft).toBeDefined();
    expect(draft!.folder).not.toBeNull();
    expect(deps.db.select().from(documentLinks).where(eq(documentLinks.documentId, draft!.id)).all().map((l) => l.role)).toEqual(['recipient']);
  });

  it('legt jedes Dokument an seinem Datum ab, keines in der Zukunft, keine zwei zur selben Zeit', async () => {
    const { deps, ctx } = await setupWithContacts();
    await seedDms(deps, ctx);
    const now = isoNow(deps.clock);
    const docs = deps.db.select().from(documents).all();
    for (const d of docs) {
      expect(d.createdAt <= now, d.subject).toBe(true);
      expect(d.createdAt.slice(0, 10), d.subject).toBe(d.documentDate);
    }
    expect(new Set(docs.map((d) => d.createdAt)).size).toBe(docs.length);
  });

  it('läuft auch am 2. Januar: kein Datum nach heute, jede Nummer im Jahr ihrer Ablage', async () => {
    const { deps, ctx } = await setupWithContacts('2027-01-02T10:00:00.000Z');
    await seedDms(deps, ctx);
    const docs = deps.db.select().from(documents).all();
    for (const d of docs) expect(d.documentDate! <= '2027-01-02', d.subject).toBe(true);
    for (const d of docs.filter((x) => x.number)) expect(d.number!.slice(4, 8), d.subject).toBe(d.createdAt.slice(0, 4));
  });
});
