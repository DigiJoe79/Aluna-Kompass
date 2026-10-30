import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFileStore, unwrap, type DbOrTx, type Deps } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createDraft, fileDocument } from '../src/drafts';
import { issueGeneratedDocument } from '../src/issue';
import { documents, documentTypes } from '../src/schema';
import { allocateDocumentNumber, getDocument } from '../src/service';
import { checksumOf, readDocumentFile } from '../src/storage';
import { setupWithProbe } from './helpers';

/**
 * Befundliste 0.4.0, N6: Zieht jemand zwischen Rendern und Festschreiben eine
 * Nummer, rendert der Dienst neu — mit der neuen Nummer. Die Ablage überschreibt
 * aber nie; blieb die Datei des ersten Anlaufs liegen, trug das festgeschriebene
 * Dokument die alte Nummer und eine Prüfsumme, die nicht zu ihr passt
 * („verändert“, nicht versendbar). Der Memory-Store hat dieselbe Semantik
 * (erster gewinnt); geprüft wird trotzdem auch gegen das Dateisystem.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type StoreKind = 'memory' | 'filesystem';

function setup(kind: StoreKind) {
  const env = setupWithProbe();
  if (kind === 'filesystem') {
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-dms-retry-'));
    dirs.push(dir);
    const store = createFileStore(dir);
    (env.deps as { files: Deps['files'] }).files = () => store;
  }
  return env;
}

/** Rendert die Nummer in die Bytes und zieht beim ersten Mal selbst eine — wie ein zweiter Vorgang dazwischen. */
function cutInOnce(deps: Deps, typeKey: string): void {
  const prefix = deps.db.select().from(documentTypes).where(eq(documentTypes.key, typeKey)).get()!.prefix;
  let first = true;
  deps.documents = {
    ...deps.documents,
    render: async ({ context, bodyTypst }) => {
      if (first) {
        first = false;
        deps.db.transaction((tx: DbOrTx) => allocateDocumentNumber(tx, prefix, Number(context.issuedAt.slice(0, 4))));
      }
      return { bytes: new TextEncoder().encode(`%PDF-1.4\nNR ${context.number}\n${bodyTypst}\n%%EOF\n`), pages: 1 };
    },
  };
}

describe.each<StoreKind>(['memory', 'filesystem'])('retry after a number moved on (%s store)', (kind) => {
  it('issueGeneratedDocument files the bytes of the retry, not of the first attempt', async () => {
    const { deps, ctx } = setup(kind);
    cutInOnce(deps, 'probe-note');
    const { document } = unwrap(await issueGeneratedDocument(deps, ctx, { templateKey: 'probe-note', input: { text: 'Hallo' }, subject: 'Notiz', documentDate: '2026-03-15' }));
    const row = deps.db.select().from(documents).where(eq(documents.id, document.id)).get()!;
    expect(row.number).toBe('NTZ-2026-002');
    const bytes = await readDocumentFile(deps, row.fileName!);
    expect(new TextDecoder().decode(bytes)).toContain('NR NTZ-2026-002');
    expect(checksumOf(bytes)).toBe(row.fileChecksum);
    expect(unwrap(await getDocument(deps, ctx, row.id)).record.number).toBe('NTZ-2026-002');
  });

  it('fileDocument files the bytes of the retry, not of the first attempt', async () => {
    const { deps, ctx } = setup(kind);
    const draft = unwrap(await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Brief', body: 'Text' }));
    cutInOnce(deps, 'letter');
    const filed = unwrap(await fileDocument(deps, ctx, { id: draft.id }));
    const row = deps.db.select().from(documents).where(eq(documents.id, filed.id)).get()!;
    expect(row.number).toMatch(/-002$/);
    const bytes = await readDocumentFile(deps, row.fileName!);
    expect(new TextDecoder().decode(bytes)).toContain(`NR ${row.number}`);
    expect(checksumOf(bytes)).toBe(row.fileChecksum);
    expect((await getDocument(deps, ctx, row.id)).ok).toBe(true);
  });
});
