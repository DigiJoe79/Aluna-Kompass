# Startseiten-Referenzen, Plan 2: Medien-Upload über MCP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Agent kann eine Datei in die Mediathek legen (Backlog 10): Werkzeug `media_upload` mit Base64-Inhalt, das `storeMediaAsset` ruft.

**Architecture:** Ein Eintrag in `packages/mcp/src/core-tools.ts` neben `media_list`, `media_move`, `media_delete`. Das Werkzeug dekodiert, prüft die Base64-Form, ruft den bestehenden Dienst; Grenze, Typprüfung, Dedup und Audit bleiben im Dienst.

**Tech Stack:** TypeScript, Zod 4, Vitest, MCP-Werkzeugdefinitionen aus `@kompass/core`.

**Spec:** `docs/superpowers/specs/2026-09-13-startseiten-referenzen-und-nacharbeiten-design.md`, § 7.

## Global Constraints

- AGENTS.md, Prinzip 8: Werkzeug ruft den Dienst, keine Fachlogik im Adapter. Die Beschreibung nennt das Recht (`media.upload`) und ist Englisch; `apps/kompass/tests/mcp-tools.test.ts` prüft beides.
- Jedes Werkzeug trägt ein echtes Zod-Schema mit benannten Argumenten und `additionalProperties: false` (Zod-Vorgabe von `z.object`).
- Grenze: `MEDIA_MAX_BYTES` des Dienstes (zehn Megabyte dekodiert). Keine eigene Grenze im Werkzeug.
- Commit je Task, kein Push. Vor dem Commit `pnpm typecheck` und `pnpm --filter @kompass/mcp test` grün, dazu `pnpm --filter @kompass/app test -- mcp-tools`.

---

### Task 1: `media_upload`

**Files:**
- Modify: `packages/mcp/src/core-tools.ts`
- Test: `packages/mcp/tests/media-tools.test.ts`

**Interfaces:**
- Consumes: `storeMediaAsset(deps, ctx, { originalName, bytes, declaredMimeType?, folder? })` aus `@kompass/core` (`packages/core/src/media/service.ts`), `getMediaAsset(deps, ctx, id)`, `invalid` aus `@kompass/core`.
- Produces: Werkzeug `media_upload` mit Eingabe `{ filename: string, contentBase64: string, folder?: string | null }`, Antwort `MediaAssetRecord` (`id, filename, mimeType, bytes, width, height, folder, checksum, createdAt`).

- [ ] **Step 1: Test schreiben**

```ts
// packages/mcp/tests/media-tools.test.ts
import { coreModule, getMediaAsset, schema, storeMediaAsset, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { coreMcpTools } from '../src/core-tools';

const tool = (name: string) => {
  const found = coreMcpTools.find((t) => t.name === name);
  if (!found) throw new Error(`kein Werkzeug ${name}`);
  return found;
};

/** Ein 1×1-PNG, wie es auch `packages/modules/animals/tests/animals.test.ts` benutzt. */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const setup = () => {
  const deps = createTestDeps({ manifests: [coreModule] });
  insertUser(deps, { id: 'USER-TEST' });
  return deps;
};

describe('media_upload', () => {
  it('is registered, names its service and the permission', () => {
    expect(tool('media_upload').service).toBe(storeMediaAsset);
    expect(tool('media_upload').description).toContain('media.upload');
  });

  it('stores a base64 file through the service and reads it back', async () => {
    const deps = setup();
    const ctx = ctxWith(['media.upload']);
    const result = await tool('media_upload').handler(deps, ctx, { filename: 'punkt.png', contentBase64: PNG_BASE64 });
    const record = unwrap(result) as { id: string; mimeType: string; bytes: number; folder: string | null };
    expect(record).toMatchObject({ mimeType: 'image/png', bytes: 70, folder: null });
    const stored = unwrap(await getMediaAsset(deps, ctx, record.id));
    expect(Buffer.from(stored.bytes).toString('base64')).toBe(PNG_BASE64);
    expect(deps.db.select().from(schema.auditLog).all().at(-1)).toMatchObject({ action: 'media.upload', entityId: record.id, channel: ctx.channel });
  });

  it('returns the existing record when the same bytes are uploaded again', async () => {
    const deps = setup();
    const ctx = ctxWith(['media.upload']);
    const first = unwrap(await tool('media_upload').handler(deps, ctx, { filename: 'a.png', contentBase64: PNG_BASE64 })) as { id: string; filename: string };
    const second = unwrap(await tool('media_upload').handler(deps, ctx, { filename: 'b.png', contentBase64: PNG_BASE64 })) as { id: string; filename: string };
    expect(second.id).toBe(first.id);
    expect(second.filename).toBe(first.filename);
  });

  it('rejects text that is not base64 as a validation error, before touching the service', async () => {
    const deps = setup();
    const result = await tool('media_upload').handler(deps, ctxWith(['media.upload']), { filename: 'x.png', contentBase64: 'das ist kein base64!' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('validation');
      expect(result.error.type === 'validation' && result.error.issues[0]).toMatchObject({ path: 'contentBase64', message: 'invalidBase64' });
    }
    expect(deps.db.select().from(schema.mediaAssets).all()).toHaveLength(0);
  });

  it('leaves the size limit to the service', async () => {
    const deps = setup();
    const tooBig = Buffer.alloc(10 * 1024 * 1024 + 1, 1).toString('base64');
    const result = await tool('media_upload').handler(deps, ctxWith(['media.upload']), { filename: 'gross.bin', contentBase64: tooBig });
    expect(result.ok === false && result.error.type === 'validation' && result.error.issues[0]?.message).toBe('fileTooLarge');
  });

  it('is forbidden without media.upload', async () => {
    const deps = setup();
    const result = await tool('media_upload').handler(deps, ctxWith([]), { filename: 'x.png', contentBase64: PNG_BASE64 });
    expect(result.ok === false && result.error.type).toBe('forbidden');
  });
});
```

Der Bytewert `70` ist die Länge des dekodierten PNG (`Buffer.from(PNG_BASE64, 'base64').length`); rechne ihn beim ersten Lauf nach und passe ihn an, falls er abweicht. `ctx.channel` von `ctxWith` prüfen: `sed -n 1,12p packages/core/src/testing/context.ts` oder wo `ctxWith` steht (`grep -rn "export function ctxWith" packages/core/src/testing`).

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `pnpm --filter @kompass/mcp test -- media-tools`
Expected: FAIL, `kein Werkzeug media_upload`.

- [ ] **Step 3: Werkzeug schreiben**

In `packages/mcp/src/core-tools.ts`:

1. Im Import aus `@kompass/core` `storeMediaAsset` ergänzen (alphabetisch bei den anderen Medien-Diensten).
2. Über `coreMcpTools` eine Hilfsfunktion:

```ts
/**
 * Base64 ohne Data-URL-Präfix. Node's `Buffer.from(…, 'base64')` verwirft
 * fremde Zeichen still; ein Agent bekäme dann ein leeres oder verstümmeltes
 * Bild ohne Fehler. Deshalb die Form vorab prüfen.
 */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
function decodeBase64(text: string): Uint8Array | null {
  const compact = text.replace(/\s+/g, '');
  if (compact.length === 0 || compact.length % 4 !== 0 || !BASE64.test(compact)) return null;
  return new Uint8Array(Buffer.from(compact, 'base64'));
}
```

3. In `coreMcpTools` direkt vor `media_list`:

```ts
  t({
    name: 'media_upload',
    description: 'Upload a file into the media library: filename plus base64 content (no data-URL prefix), optional folder path (null or omitted = root). Same limits as the UI: 10 MB, PNG/JPEG/WebP/SVG/PDF. Identical bytes are deduplicated — the existing record comes back, with its own filename and folder. Requires media.upload. Audited.',
    inputSchema: z.object({ filename: z.string().min(1).max(200), contentBase64: z.string().min(1), folder: z.string().nullable().optional() }),
    handler: (deps, ctx, { filename, contentBase64, folder }) => {
      const bytes = decodeBase64(contentBase64);
      if (!bytes) return Promise.resolve(invalid([{ path: 'contentBase64', message: 'invalidBase64' }]));
      return storeMediaAsset(deps, ctx, { originalName: filename, bytes, folder: folder ?? null });
    },
    service: storeMediaAsset,
  }),
```

`invalid` ist in der Datei bereits importiert. Liefert `storeMediaAsset` bei `folder: undefined` ein anderes Verhalten als bei `null` (Kommentar im `StoreMediaInput`: „null/weggelassen = Wurzel"), ist `folder ?? null` richtig.

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/mcp test && pnpm --filter @kompass/app test -- mcp-tools && pnpm typecheck`
Expected: PASS. `mcp-tools.test.ts` in der App prüft, dass die Beschreibung Englisch ist, das Recht nennt und das Schema keine offenen Zusatzfelder hat.

- [ ] **Step 5: Sprachdatei**

`invalidBase64` erreicht die Oberfläche nie (nur MCP), braucht also keinen Eintrag in `de.json`. Prüfe trotzdem, ob `apps/kompass/tests/message-keys.test.ts` Meldungscodes aus `packages/mcp` einsammelt: `grep -n "packages/mcp\|invalid(" apps/kompass/tests/message-keys.test.ts`. Tut er es, ergänze unter `errors.fields` den Eintrag `"invalidBase64": "Der Inhalt ist kein gültiges Base64."`.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/src/core-tools.ts packages/mcp/tests/media-tools.test.ts apps/kompass/messages/de.json
git commit -m "feat(mcp): an agent can upload a file into the media library"
```

(`de.json` nur, wenn Step 5 sie geändert hat.)

---

### Task 2: Betriebsprobe gegen eine laufende Instanz und Backlog

**Files:**
- Modify: `docs/backlog.md` (Abschnitt `## 10.` entfernen)

- [ ] **Step 1: Ende-zu-Ende gegen den Dev-Server**

Run: `pnpm dev` in einem Terminal, dann `pnpm --filter @kompass/app mcp:check http://localhost:3000 <token>` mit einem unter Profil erzeugten API-Token. Der Check listet die Werkzeuge; `media_upload` muss darunter stehen. Danach mit einem MCP-Client (etwa dem in `apps/kompass/e2e/mcp.spec.ts` gezeigten `@modelcontextprotocol/client`) ein kleines PNG hochladen und unter Mediathek prüfen, dass es liegt.

Das ist die einzige Handprobe dieses Plans; der Vertrag ist durch Task 1 getestet. Scheitert die Probe, ist der Befund ein Test in `packages/mcp/tests/handler.test.ts`, nicht eine Handkorrektur.

- [ ] **Step 2: Backlog**

In `docs/backlog.md` den Abschnitt `## 10. Medien-Upload über MCP` löschen.

- [ ] **Step 3: Commit**

```bash
git add docs/backlog.md
git commit -m "docs(backlog): media upload over MCP is built"
```

---

## Selbstprüfung gegen die Spec

- § 7 Werkzeug, Dekodierung, Grenze im Dienst, Dedup-Erklärung in der Beschreibung, Tests für PNG, Dedup, Grenze, Base64, `forbidden`, Audit: Task 1.
- § 7 kein Seed: nichts zu tun.
- § 10 Backlog 10: Task 2.
