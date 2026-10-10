import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRole, createUser, resolveSeedAssetsDir, schema, setRolePermissions, unwrap, writeSettingInternal, type CallContext, type Deps } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { animalProposals, animals } from '../schema';
import { updateAnimal } from '../service';
import { PROPOSAL_STACK_KEY, PROPOSALS_ENABLED_KEY } from '../settings';
import { acceptProposal, rejectProposal } from './decide';
import { stageProposalImage } from './images';
import { submitProposal, withdrawProposal } from './submit';

/*
 * Beispielvorschläge einer erfundenen Quelle (AGENTS Seed-Regel; Spec Vorschlags-Eingang § 8): je Art offen, dazu
 * angenommen, abgelehnt, zurückgezogen; ein Konflikt, Zweifelsfälle, ein neuer Hund, dem etwas fehlt, und je eine
 * Änderung und ein neuer Hund, die im Stapel mit einem Wisch durchgehen, und eine Änderung an einem langen Text. Zeiten relativ
 * zu heute (Eingang „vor n Stunden“), wie die Prüfmerker der Beispieltiere. Nicht im Barrel `proposals/index.ts`:
 * Der MCP-Paritätswächter hielte `seedProposals` sonst für einen Dienst ohne Werkzeug.
 */

const SOURCE_EMAIL = 'quelle@musterverein.example';
const SOURCE_PERMISSIONS = ['animals.view', 'animals.propose'];

const hoursAgo = (deps: Deps, h: number): Deps => ({ ...deps, clock: { now: () => new Date(deps.clock.now().getTime() - h * 3_600_000) } });

async function sourceUser(deps: Deps, ctx: CallContext): Promise<string> {
  const known = deps.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, SOURCE_EMAIL)).get();
  if (known) return known.id;
  const role = unwrap(await createRole(deps, ctx, { name: 'Quelle (Beispiel)', description: 'Ein angebundener Dienst, der Tiere nur vorschlägt.' }));
  unwrap(await setRolePermissions(deps, ctx, { roleId: role.id, permissionKeys: SOURCE_PERMISSIONS }));
  return unwrap(await createUser(deps, ctx, { name: 'Tierbörse Beispielstadt', email: SOURCE_EMAIL, roleIds: [role.id] })).user.id;
}

export async function seedProposals(deps: Deps, ctx: CallContext): Promise<void> {
  if (deps.db.select({ id: animalProposals.id }).from(animalProposals).limit(1).all().length > 0) return;
  // Der Stapel ist im Seed an, damit E2E und Bilder ihn zeigen; in einer neuen Installation ist er aus.
  deps.db.transaction((tx) => {
    unwrap(writeSettingInternal(tx, deps, ctx, PROPOSALS_ENABLED_KEY, true));
    unwrap(writeSettingInternal(tx, deps, ctx, PROPOSAL_STACK_KEY, true));
  });
  const userId = await sourceUser(deps, ctx);
  const source: CallContext = { userId, permissions: new Set(SOURCE_PERMISSIONS), channel: 'mcp', apiTokenId: null, ipAddress: null, requestId: 'SEED' };
  const idOf = (name: string) => deps.db.select({ id: animals.id }).from(animals).where(eq(animals.name, name)).get()?.id ?? null;
  const picture = (file: string) => readFile(path.join(resolveSeedAssetsDir(), file)).then((b) => new Uint8Array(b));
  const stage = async (at: Deps, file: string, sourceRef: string) => unwrap(await stageProposalImage(at, source, { originalName: file, bytes: await picture(file), sourceRef })).imageId;

  // 1. Neuer Hund mit zwei Bildern (Titelbild mit Ausschnitt) und zwei Zweifelsfällen.
  {
    const at = hoursAgo(deps, 50);
    const first = await stage(at, 'juno-1.jpg', 'tb-2041-a');
    const second = await stage(at, 'frida-1.jpg', 'tb-2041-b');
    unwrap(
      await submitProposal(at, source, {
        kind: 'create',
        sourceKey: 'tb-2041-v1',
        externalRef: 'TB-2041',
        externalUrl: 'https://tierboerse.example/hunde/2041',
        values: {
          name: 'Wilma',
          sex: 'female',
          birthText: { de: 'Frühjahr 2021', en: 'spring 2021' },
          sizeCm: 48,
          sizeText: { de: 'ca. 48 cm', en: 'approx. 48 cm' },
          location: 'shelter',
          place: 'Beispielstadt',
          traits: { de: ['freundlich', 'neugierig'], en: ['friendly', 'curious'] },
          summary: { de: 'Freundliche Hündin, die gern draußen ist.', en: 'Friendly girl who loves the outdoors.' },
          body: { de: 'Wilma lebt seit dem Winter im Tierheim und kommt mit anderen Hunden gut zurecht.', en: 'Wilma has been at the shelter since winter and gets on well with other dogs.' },
        },
        hints: [
          { field: 'birthText', quote: 'geboren ca. Frühjahr 2021, laut Tierarzt eher 2020', suggestion: '2020/21' },
          { title: 'Größe', field: 'sizeCm', quote: 'kniehoch', suggestion: '45' },
        ],
        photos: [
          { imageId: first, isPrimary: true, crop: { x: 0, y: 0.1, w: 1, h: 0.8 } },
          { imageId: second, isPrimary: false },
        ],
      }),
    );
  }

  // 2. Neuer Hund ohne Fotos und ohne Kurztext: Die Prüfung nennt, was fehlt.
  unwrap(
    await submitProposal(hoursAgo(deps, 30), source, {
      kind: 'create',
      sourceKey: 'tb-2050-v1',
      externalRef: 'TB-2050',
      externalUrl: 'https://tierboerse.example/hunde/2050',
      values: { name: 'Bodo', sex: 'male', birthText: { de: '2019', en: '' }, sizeText: { de: 'groß', en: '' }, summary: { de: '', en: '' }, body: { de: 'Bodo ist ein ruhiger, großer Rüde.', en: '' } },
    }),
  );

  // 3. Änderung an Baxter, danach ändert ein Mensch den Kurztext in Kompass → Konflikt.
  const baxter = idOf('Baxter');
  if (baxter) {
    const at = hoursAgo(deps, 120);
    const image = await stage(at, 'pelle-1.jpg', 'tb-1001-c');
    unwrap(
      await submitProposal(at, source, {
        kind: 'update',
        sourceKey: 'tb-1001-v3',
        animalId: baxter,
        externalRef: 'TB-1001',
        values: { status: 'reserved', sizeCm: 58, summary: { de: 'Fröhlicher Rüde, reserviert für eine Familie mit Garten.', en: 'Cheerful boy, reserved for a family with a garden.' } },
        hints: [{ field: 'status', quote: 'Baxter ist reserviert (Vorkontrolle steht aus)', suggestion: 'Reserviert' }],
        photos: [{ imageId: image, isPrimary: false }],
      }),
    );
    unwrap(await updateAnimal(hoursAgo(deps, 6), ctx, { id: baxter, summary: { de: 'Fröhlicher Rüde, der gern lernt und schon an der Leine läuft.', en: 'Cheerful boy who loves to learn.' } }));
  }

  // 4. Hinweis „nicht mehr gelistet“ zu Mika.
  const mika = idOf('Mika');
  if (mika) {
    unwrap(await submitProposal(hoursAgo(deps, 20), source, { kind: 'notice', sourceKey: 'tb-1002-delisted', animalId: mika, externalRef: 'TB-1002', reason: 'Mika ist bei der Tierbörse seit gestern nicht mehr gelistet. Vermutlich vermittelt.', noticeKind: 'delisted' }));
  }

  // 5. Zuordnung: Ist „Junah“ bei der Quelle Juno in Kompass?
  const juno = idOf('Juno');
  if (juno) {
    unwrap(await submitProposal(hoursAgo(deps, 10), source, { kind: 'sameAs', sourceKey: 'tb-1988-same', animalId: juno, externalRef: 'TB-1988', externalUrl: 'https://tierboerse.example/hunde/1988', reason: 'Zwei von drei Fotos gleich, Geburt und Größe passen, Name ähnlich (‚Junah‘).', values: { name: 'Junah', sizeCm: 52 } }));
  }

  // 6. Entschieden: Änderung an Frida angenommen.
  const frida = idOf('Frida');
  if (frida) {
    const at = hoursAgo(deps, 200);
    const p = unwrap(await submitProposal(at, source, { kind: 'update', sourceKey: 'tb-1003-v2', animalId: frida, externalRef: 'TB-1003', values: { traits: { de: ['verschmust', 'ruhig', 'katzenverträglich'], en: ['cuddly', 'calm', 'good with cats'] } } })).proposal;
    unwrap(await acceptProposal(hoursAgo(deps, 190), ctx, { id: p.id }));
  }

  // 7. Entschieden: neuer Hund abgelehnt.
  {
    const p = unwrap(
      await submitProposal(hoursAgo(deps, 300), source, {
        kind: 'create',
        sourceKey: 'tb-1500-v1',
        externalRef: 'TB-1500',
        values: { name: 'Rex', sex: 'male', birthText: { de: '2018', en: '' }, sizeText: { de: 'groß', en: '' }, summary: { de: 'Großer Rüde.', en: '' }, body: { de: 'Rex sucht ein Zuhause.', en: '' } },
      }),
    ).proposal;
    unwrap(await rejectProposal(hoursAgo(deps, 280), ctx, { id: p.id, note: 'Kein Hund aus unserem Partnertierheim.' }));
  }

  // 8. Zurückgezogen: Änderung an Nala.
  const nala = idOf('Nala');
  if (nala) {
    unwrap(await submitProposal(hoursAgo(deps, 96), source, { kind: 'update', sourceKey: 'tb-1004-v1', animalId: nala, values: { place: 'Beispielstadt' } }));
    unwrap(await withdrawProposal(hoursAgo(deps, 90), source, { sourceKey: 'tb-1004-v1', reason: 'Doppelt gemeldet.' }));
    // 9. Änderung an Nala ohne Konflikt und ohne Zweifelsfall: Im Stapel geht sie mit einem Wisch durch.
    unwrap(await submitProposal(hoursAgo(deps, 40), source, { kind: 'update', sourceKey: 'tb-1004-v2', animalId: nala, externalRef: 'TB-1004', values: { traits: { de: ['verspielt', 'menschenbezogen'], en: ['playful', 'people-oriented'] } } }));
  }

  // 10. Neuer Hund, vollständig (Titelbild und Kurztext), ohne Zweifelsfall: Rechts im Stapel heißt „annehmen und online“.
  {
    const at = hoursAgo(deps, 8);
    const cover = await stage(at, 'mika-3.jpg', 'tb-2060-a');
    unwrap(
      await submitProposal(at, source, {
        kind: 'create',
        sourceKey: 'tb-2060-v1',
        externalRef: 'TB-2060',
        externalUrl: 'https://tierboerse.example/hunde/2060',
        values: {
          name: 'Ronja',
          sex: 'female',
          birthText: { de: '2023', en: '2023' },
          sizeCm: 42,
          sizeText: { de: 'mittelgroß', en: 'medium' },
          location: 'shelter',
          place: 'Beispielstadt',
          traits: { de: ['fröhlich'], en: ['cheerful'] },
          summary: { de: 'Junge Hündin voller Energie.', en: 'Young girl full of energy.' },
          body: { de: 'Ronja sucht Menschen, die gern draußen sind.', en: 'Ronja is looking for people who love the outdoors.' },
        },
        photos: [{ imageId: cover, isPrimary: true }],
      }),
    );
  }

  // 11. Änderung an Pelles langem Text an drei Stellen, dazu die Geburt und ein Zweifelsfall mit Titel: Die Prüfseite
  //     zeigt den Wortunterschied („6 Stellen geändert“, je Sprache drei, aufklappbar).
  const pelle = idOf('Pelle');
  if (pelle) {
    const current = deps.db.select({ body: animals.body }).from(animals).where(eq(animals.id, pelle)).get()!.body as Record<string, string>;
    const edit = (text: string | undefined, swaps: readonly [string, string][]) => swaps.reduce((t, [from, to]) => t.replace(from, to), text ?? '');
    unwrap(
      await submitProposal(hoursAgo(deps, 60), source, {
        kind: 'update',
        sourceKey: 'tb-1005-v2',
        animalId: pelle,
        externalRef: 'TB-1005',
        externalUrl: 'https://tierboerse.example/hunde/1005',
        values: {
          birthText: { de: 'April 2023', en: 'April 2023' },
          body: {
            de: edit(current.de, [
              ['seit drei Wochen', 'seit fünf Wochen'],
              ['noch unsicher', 'schon recht sicher'],
              ['gechippt.', 'gechippt, inzwischen auch kastriert.'],
            ]),
            en: edit(current.en, [
              ['for three weeks', 'for five weeks'],
              ['still unsure', 'already fairly steady'],
              ['microchipped.', 'microchipped, and now also neutered.'],
            ]),
          },
        },
        hints: [{ title: 'Kastration', field: 'body', quote: 'Pelle wurde letzte Woche kastriert, Fäden sind gezogen', suggestion: 'inzwischen auch kastriert' }],
      }),
    );
  }
}
