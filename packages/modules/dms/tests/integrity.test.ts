import { describe, expect, it } from 'vitest';
import { auditEntry } from '@kompass/core/testing';
import { documents } from '../src/schema';
import { getDocument } from '../src/service';
import { createDraft, fileDocument } from '../src/drafts';
import { DMS_MODULE_KEY } from '../src/storage';
import { fileFixture, setupWithTypes } from './helpers';

/**
 * Jedes festgeschriebene Dokument trägt eine SHA-256-Summe seiner Datei. Sie
 * wurde beim Ablegen gebildet, gespeichert und in der Akte angezeigt — aber
 * bis zum 2026-09-15 nie nachgerechnet. Wer im Datenvolume eine PDF austauschte,
 * bekam sie von Kompass weiter ausgeliefert, mit der alten Summe daneben.
 *
 * Eine Prüfsumme, die niemand prüft, ist schlimmer als keine: Sie sieht aus
 * wie ein Nachweis.
 */
/**
 * Andere Bytes unter demselben Namen — der Zustand, den ein Austausch im
 * Datenvolume hinterlässt.
 *
 * Nicht per `write`: Beide Dateispeicher überschreiben eine vorhandene Datei
 * bewusst nicht (`flag: 'wx'`, der Inhalt hängt am Namen). Wer im Volume
 * hantiert, geht ohnehin an der Anwendung vorbei; für die Prüfung zählt allein
 * der Zustand, den er hinterlässt.
 */
async function tauscheDateiAus(deps: Parameters<typeof getDocument>[0], fileName: string, inhalt: string): Promise<void> {
  const store = deps.files(DMS_MODULE_KEY);
  await store.delete(fileName);
  await store.write(fileName, new TextEncoder().encode(inhalt));
}

describe('Dokumente werden gegen ihre Prüfsumme gehalten', () => {
  it('liefert ein unverändertes Dokument aus', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await fileFixture(deps, ctx);

    const geholt = await getDocument(deps, ctx, doc.id);

    expect(geholt.ok).toBe(true);
    if (!geholt.ok) return;
    expect(geholt.value.record.id).toBe(doc.id);
  });

  it('verweigert ein Dokument, dessen Datei nicht mehr zur Prüfsumme passt', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await fileFixture(deps, ctx);
    const row = deps.db.select().from(documents).all().find((d) => d.id === doc.id)!;
    expect(row.fileChecksum).toMatch(/^[0-9a-f]{64}$/);

    await tauscheDateiAus(deps, row.fileName!, '%PDF-1.4 etwas ganz anderes\n%%EOF\n');

    const geholt = await getDocument(deps, ctx, doc.id);

    expect(geholt.ok).toBe(false);
    if (geholt.ok) return;
    expect(geholt.error.type).toBe('conflict');
    expect(geholt.error.type === 'conflict' && geholt.error.code).toBe('documentAltered');
  });

  /**
   * Der Verdacht gehört ins Änderungsprotokoll — es ist die Stelle, an der ein
   * Verein im Nachhinein sieht, wann etwas nicht stimmte. Im Eintrag stehen
   * beide Summen, damit man Austausch von Verwechslung unterscheiden kann.
   */
  it('hält den Fund im Änderungsprotokoll fest', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await fileFixture(deps, ctx);
    const row = deps.db.select().from(documents).all().find((d) => d.id === doc.id)!;
    await tauscheDateiAus(deps, row.fileName!, '%PDF-1.4 anders\n%%EOF\n');

    await getDocument(deps, ctx, doc.id);

    const eintrag = auditEntry(deps, 'dms.checksumMismatch');
    expect(eintrag).toMatchObject({ entityType: 'document', entityId: doc.id });
    const nachher = JSON.parse(eintrag.after!) as { expected: string; actual: string };
    expect(nachher.expected).toBe(row.fileChecksum);
    expect(nachher.actual).not.toBe(row.fileChecksum);
  });

  /**
   * Ein Entwurf hat keine Prüfsumme: Seine Datei entsteht bei jeder Vorschau
   * neu, und das ist kein Vorfall, sondern seine Natur. Erst das Festschreiben
   * bindet Datei und Summe aneinander.
   */
  it('lässt einen Entwurf ungeprüft durch, weil er keine Prüfsumme trägt', async () => {
    const { deps, ctx } = setupWithTypes();
    const entwurf = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Offen', body: 'Text' });
    if (!entwurf.ok) throw new Error('setup');

    const row = deps.db.select().from(documents).all().find((d) => d.id === entwurf.value.id)!;
    expect(row.fileChecksum).toBeNull();

    // Ohne Datei gibt es nichts auszuliefern — geprüft wird, dass die Antwort
    // „keine Datei“ lautet und nicht „verändert“.
    const geholt = await getDocument(deps, ctx, entwurf.value.id);
    expect(geholt.ok === false && geholt.error.type).toBe('notFound');
  });

  /** Ein festgeschriebenes Dokument, dessen Datei fehlt, ist kein Fälschungsverdacht. */
  it('unterscheidet eine fehlende Datei von einer veränderten', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await fileFixture(deps, ctx);
    const row = deps.db.select().from(documents).all().find((d) => d.id === doc.id)!;
    await deps.files(DMS_MODULE_KEY).delete(row.fileName!);

    const geholt = await getDocument(deps, ctx, doc.id);

    expect(geholt.ok).toBe(false);
    if (geholt.ok) return;
    expect(geholt.error.type).toBe('notFound');
  });
});
