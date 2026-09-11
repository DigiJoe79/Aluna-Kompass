import { coreModule, fakeTextExtraction, type Deps, type TextExtraction } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { receiveDocument } from '../src/incoming';
import { dmsModule } from '../src/manifest';
import { documents } from '../src/schema';
import { extractDocumentText } from '../src/text';
import { processNextDocument, recoverRunning, requeueUnavailable, startTextWorker } from '../src/worker';
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

async function setup(textExtraction?: TextExtraction) {
  const deps = createTestDeps({
    manifests: [coreModule, contactsModule, dmsModule],
    textExtraction:
      textExtraction ?? fakeTextExtraction({ pages: [{ page: 1, text: 'Rechnung', source: 'layer' }] }),
  });
  insertUser(deps, { id: 'USER-TEST' });
  await seedTypes(deps);
  return deps;
}

/** Eine Erkennung, deren Werkzeuge im Lauf des Tests auftauchen. */
function switchableExtraction(available: boolean): { available: boolean; extraction: TextExtraction } {
  let installed = available;
  const extraction: TextExtraction = {
    probe: async () =>
      installed
        ? { ok: true, languages: ['deu'] }
        : { ok: false, error: 'tesseract ist nicht installiert' },
    extract: async () => [{ page: 1, text: 'Rechnung', source: 'layer' }],
  };
  return {
    get available() {
      return installed;
    },
    set available(value: boolean) {
      installed = value;
    },
    extraction,
  };
}

/** Scheitert nur am ersten Dokument, das es sieht — wie ein einzelnes Stub-PDF. */
function failsOnFirstDocument(): TextExtraction {
  let seen = 0;
  return {
    probe: async () => ({ ok: true, languages: ['deu'] }),
    extract: async () => {
      seen += 1;
      if (seen === 1) throw new Error('pdftotext scheiterte: No valid XRef size');
      return [{ page: 1, text: 'Rechnung', source: 'layer' }];
    },
  };
}

/** Werkzeuge da, aber das Lesen scheitert — ein zerschossenes PDF. */
function brokenExtraction(): TextExtraction {
  return {
    probe: async () => ({ ok: true, languages: ['deu'] }),
    extract: async () => {
      throw new Error('Seite 1 liess sich nicht lesen');
    },
  };
}

const statusOf = (deps: Deps, id: string) =>
  deps.db.select().from(documents).where(eq(documents.id, id)).get()?.textStatus;

const attemptsOf = (deps: Deps, id: string) =>
  deps.db.select().from(documents).where(eq(documents.id, id)).get()?.textAttempts;

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

    expect(outcome.status).toBe('done');
    const states = deps.db.select({ s: documents.textStatus }).from(documents).all().map((r) => r.s);
    expect(states.filter((s) => s === 'done')).toHaveLength(1);
    expect(states.filter((s) => s === 'pending')).toHaveLength(1);
  });

  it('meldet idle, wenn nichts zu tun ist', async () => {
    const deps = await setup();

    expect((await processNextDocument(deps)).status).toBe('idle');
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
    expect((await processNextDocument(deps)).status).toBe('idle');
  });

  it('holt zurück, was mangels Werkzeug liegen geblieben ist', async () => {
    // Der Entwicklungsrechner ohne Tesseract, auf dem später `brew install`
    // läuft: Das Dokument darf nicht auf einen Menschen warten müssen.
    const port = switchableExtraction(false);
    const deps = await setup(port.extraction);
    const id = await receive(deps, 'Vor der Installation');
    await extractDocumentText(deps, ctxWith(['dms.manage']), { documentId: id });
    expect(statusOf(deps, id)).toBe('unavailable');

    port.available = true;
    expect(await requeueUnavailable(deps)).toBe(1);

    expect(statusOf(deps, id)).toBe('pending');
    expect((await processNextDocument(deps)).status).toBe('done');
    expect(statusOf(deps, id)).toBe('done');
  });

  it('lässt es liegen, solange die Werkzeuge fehlen', async () => {
    const port = switchableExtraction(false);
    const deps = await setup(port.extraction);
    const id = await receive(deps, 'Ohne Werkzeug');
    await extractDocumentText(deps, ctxWith(['dms.manage']), { documentId: id });

    expect(await requeueUnavailable(deps)).toBe(0);

    expect(statusOf(deps, id)).toBe('unavailable');
  });

  it('verbraucht nach einem Fehlschlag nicht gleich alle Versuche', async () => {
    // Ein Fehlschlag setzt auf `pending` zurück. Griffe die Schleife in
    // derselben Runde wieder zu, wären die drei Versuche in Millisekunden
    // durch — und ein vorübergehender Fehler (Tesseract vom OOM-Killer
    // erwischt, während Typst rendert) hätte nie eine zweite Chance.
    const deps = await setup(brokenExtraction());
    const id = await receive(deps, 'Zerschossen');

    const worker = startTextWorker(deps, { intervalMs: 1_000_000 });
    await tick();
    worker.stop();

    expect(attemptsOf(deps, id)).toBe(1);
    expect(statusOf(deps, id)).toBe('pending');
  });

  it('hängt sich an einem Dokument nicht auf, das immer scheitert', async () => {
    const deps = await setup(brokenExtraction());
    const id = await receive(deps, 'Zerschossen');

    // Drei Takte, drei Versuche — danach ist Schluss, nicht vorher und nicht
    // in einer Schleife.
    for (let i = 0; i < 4; i += 1) {
      const worker = startTextWorker(deps, { intervalMs: 1_000_000 });
      await tick();
      worker.stop();
    }

    expect(attemptsOf(deps, id)).toBe(3);
    expect(statusOf(deps, id)).toBe('failed');
  });

  it('lässt ein zerschossenes Dokument die Warteschlange nicht blockieren', async () => {
    // Ein Seed-Dokument mit Stub-PDF scheitert bei jedem Lauf. Endete damit die
    // Runde, wartete alles dahinter einen vollen Takt — und beim nächsten
    // wieder, denn das Gescheiterte ist das älteste. Drei Versuche, drei
    // blockierte Takte: So kam ein frisch abgelegter Scan erst nach knapp
    // einer Minute in den Index.
    const deps = await setup(failsOnFirstDocument());
    const kaputt = await receive(deps, 'Zerschossen');
    const gut = await receive(deps, 'Danach abgelegt');

    const worker = startTextWorker(deps, { intervalMs: 1_000_000 });
    await tick();
    worker.stop();

    expect(statusOf(deps, gut)).toBe('done');
    // Das Gescheiterte wird trotzdem nicht in derselben Runde wiederholt.
    expect(statusOf(deps, kaputt)).toBe('pending');
    expect(attemptsOf(deps, kaputt)).toBe(1);
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
