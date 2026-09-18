import { coreModule, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { isNotNull } from 'drizzle-orm';
import { readTextLayer } from '@kompass/text-extraction';
import { describe, expect, it } from 'vitest';
import { countDocumentText } from '../src/index-store';
import { dmsModule } from '../src/manifest';
import { documentFolders, documents, documentTypes } from '../src/schema';
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

describe('seedDms', () => {
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

  it('läuft zweimal, ohne zu verdoppeln', async () => {
    const { deps, ctx } = setup();
    await seedDms(deps, ctx);
    const after = deps.db.select().from(documents).all().length;
    await seedDms(deps, ctx);
    expect(deps.db.select().from(documents).all().length).toBe(after);
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
    expect(deps.db.select().from(documentSnippets).all().map((s) => s.name).sort()).toEqual(['Bitte um Rückmeldung', 'Grußformel']);
    await seedDms(deps, ctx);
    expect(deps.db.select().from(documentSnippets).all()).toHaveLength(2);
  });

  /**
   * Das Beispiel im Eingangskorb soll der Worker wirklich lesen können: Die
   * Volltextsuche ist sonst in der Entwicklung leer, und der E2E-Test für die
   * Texterkennung im Image hat nichts zu finden. Bis 2026-09-16 war die Datei
   * ein PDF-Gerüst ohne Seite. Das Wort steht bewusst nicht im Betreff — nur
   * so beweist ein Treffer, dass der Inhalt gelesen wurde.
   */
  it('legt ein Eingangsdokument mit lesbarer Textebene ab', async () => {
    const { deps, ctx } = setup();
    await seedDms(deps, ctx);
    const bescheid = deps.db.select().from(documents).all().find((d) => d.subject === 'Freistellungsbescheid')!;
    expect(bescheid.subject).not.toMatch(/Tierschutz/i);
    const datei = unwrap(await getDocument(deps, ctx, bescheid.id));
    const seiten = await readTextLayer(datei.bytes, 30_000);
    expect(seiten.join(' ')).toContain('Tierschutzes');
  });
});
