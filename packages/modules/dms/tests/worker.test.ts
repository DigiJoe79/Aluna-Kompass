import { coreModule, fakeTextExtraction } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { receiveDocument } from '../src/incoming';
import { dmsModule } from '../src/manifest';
import { documents } from '../src/schema';
import { processNextDocument, recoverRunning, startTextWorker } from '../src/worker';
import { seedTypes } from './helpers';

const pdf = () => new Uint8Array(Buffer.from('%PDF-1.4\n%fake\n', 'latin1'));

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

/** Was der Lauf nach `console.warn` schreibt, als eine Zeichenkette. */
async function collectWarnings(run: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void lines.push(args.map((a) => String(a)).join(' '));
  try {
    await run();
  } finally {
    console.warn = original;
  }
  return lines.join('\n');
}

async function setup() {
  const deps = createTestDeps({
    manifests: [coreModule, contactsModule, dmsModule],
    textExtraction: fakeTextExtraction({ pages: [{ page: 1, text: 'Rechnung', source: 'layer' }] }),
  });
  insertUser(deps, { id: 'USER-TEST' });
  await seedTypes(deps);
  return deps;
}

async function receive(deps: Awaited<ReturnType<typeof setup>>, subject: string) {
  const r = await receiveDocument(deps, ctxWith(['dms.create']), {
    filename: 'post.pdf',
    typeKey: 'letter',
    subject,
    documentDate: '2026-09-11',
    bytes: pdf(),
  });
  if (!r.ok) throw new Error('Aufbau fehlgeschlagen');
  return r.value.id;
}

describe('Worker', () => {
  it('nimmt ein Dokument und lässt das zweite liegen', async () => {
    const deps = await setup();
    await receive(deps, 'Erstes');
    await receive(deps, 'Zweites');

    const outcome = await processNextDocument(deps);

    expect(outcome).toBe('done');
    const states = deps.db.select({ s: documents.textStatus }).from(documents).all().map((r) => r.s);
    expect(states.filter((s) => s === 'done')).toHaveLength(1);
    expect(states.filter((s) => s === 'pending')).toHaveLength(1);
  });

  it('meldet idle, wenn nichts zu tun ist', async () => {
    const deps = await setup();

    expect(await processNextDocument(deps)).toBe('idle');
  });

  it('räumt beim Start auf, was auf running stehen geblieben ist', async () => {
    const deps = await setup();
    const id = await receive(deps, 'Abgestürzt');
    deps.db.update(documents).set({ textStatus: 'running' }).where(eq(documents.id, id)).run();

    const recovered = recoverRunning(deps);

    expect(recovered).toBe(1);
    const row = deps.db.select().from(documents).where(eq(documents.id, id)).get();
    expect(row?.textStatus).toBe('pending');
  });

  it('fasst Entwürfe nicht an', async () => {
    const deps = await setup();
    // Ein Entwurf hat textStatus null und darf nie in die Schlange geraten.
    expect(await processNextDocument(deps)).toBe('idle');
  });

  it('meldet einen Abbruch, statt ihn stumm zu verschlucken', async () => {
    const deps = await setup();
    await receive(deps, 'Erstes');
    // Wie beim Herunterfahren oder mitten im E2E-Reset.
    deps.sqlite.close();

    const warnings = await collectWarnings(async () => {
      const worker = startTextWorker(deps, { intervalMs: 1_000_000 });
      await tick();
      worker.stop();
    });

    // Ohne diese Zeile im Protokoll ist ein Fehlschlag im dritten Prüfring
    // nicht zurückzuverfolgen — genau das kostete am 11.09. einen Abend.
    expect(warnings).toMatch(/Textworker/);
  });

  it('läuft an, auch wenn die Deps gerade nicht zu haben sind', () => {
    // `getDeps()` wirft, solange der E2E-Reset läuft. Der Start darf daran
    // nicht scheitern — sonst reisst er den Serverstart mit.
    expect(() =>
      startTextWorker(
        () => {
          throw new Error('deps are being reset');
        },
        { intervalMs: 1_000_000 },
      ),
    ).not.toThrow();
  });
});
