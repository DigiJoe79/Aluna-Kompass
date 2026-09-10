# Kontakte 2 — Fristenrechnung und die beiden Manifest-Haken (Implementierungsplan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kompass kann für jede Entität ausrechnen, wie lange sie aufzubewahren ist und ob sie zur Löschung fällig ist — befragt bei den Modulen, nicht zentral geraten.

**Architecture:** Zwei Haken am `ModuleManifest`, gespiegelt auf das vorhandene `mediaReferences`: `retentionHolds` beantwortet „wer hält *dieses* Objekt", `retentionDue` „was ist bei *diesem Modul* fällig". Der Kern sammelt nur und befragt ausschließlich aktive Module. Die Fristklassen sind Einstellungen, die Rechnung selbst ist eine reine Funktion.

**Tech Stack:** TypeScript, Drizzle (SQLite), Zod 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-kontakte-design.md` (§ 3 Entscheidungen 5–10, § 5 Rollen und Fristen)

## Global Constraints

- Abgeleitete Werte werden berechnet, nie gespeichert (`AGENTS.md`, Prinzip 5). Es gibt kein Feld `deleteAfter`.
- Konfiguration statt Konstanten (Prinzip 2): Fristlängen sind Einstellungen, die Klassennamen sind Code.
- Rechteprüfung nur serverseitig, in der Service-Schicht. Die Haken selbst prüfen **keine** Rechte — sie sind synchron und nur lesend, wie `mediaReferences`.
- Fristbeginn ist der Ablauf des Kalenderjahres (§ 147 Abs. 4 AO), nicht das Datum selbst.
- TDD: kein Produktionscode ohne zuvor rot gesehenen Test.

## File Structure

| Datei | Verantwortung |
|---|---|
| `packages/core/src/retention/classes.ts` | `RetentionClass`, `retentionEnd`, Vorgabelängen |
| `packages/core/src/retention/service.ts` | `holdsFor`, `dueUntil`, `collectRetentionDue` — befragt aktive Module (die rechtegeprüfte Fassung `listRetentionDue` kommt in Plan 4) |
| `packages/core/src/modules/manifest.ts` | `RetentionHold`, `DueItem`, `ContactRoleDefinition`, die zwei Haken, `contactRoles` |
| `packages/core/src/settings/core.ts` | `retention.statutory10Y`, `retention.statutory6Y`, `retention.consent` |
| `packages/core/src/index.ts` | Re-Export des Fristenbereichs |
| `packages/core/tests/retention.test.ts` | Fristrechnung und Sammlung |
| `packages/modules/contacts/src/roles.ts` | Rollenregistry aus den aktiven Modulen |
| `packages/modules/contacts/tests/roles.test.ts` | Tests der Registry |

---

### Task 1: Die Fristrechnung

**Files:**
- Create: `packages/core/src/retention/classes.ts`
- Create: `packages/core/tests/retention.test.ts`

**Interfaces:**
- Produces: `RetentionClass = 'permanent' | 'statutory10Y' | 'statutory6Y' | 'consent'`; `RETENTION_DEFAULT_MONTHS: Record<Exclude<RetentionClass, 'permanent'>, number>`; `retentionEnd(fromIso: string, months: number): string` (ISO-Datum `YYYY-MM-DD`).

- [ ] **Step 1: Den Test schreiben**

`packages/core/tests/retention.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { RETENTION_DEFAULT_MONTHS, retentionEnd } from '../src/retention/classes';

describe('retentionEnd', () => {
  it('starts the period at the end of the calendar year, not at the date itself', () => {
    // § 147 Abs. 4 AO: die Frist beginnt mit Ablauf des Kalenderjahres.
    expect(retentionEnd('2026-03-15', 120)).toBe('2036-12-31');
    expect(retentionEnd('2026-12-31', 120)).toBe('2036-12-31');
    expect(retentionEnd('2026-01-01', 120)).toBe('2036-12-31');
  });

  it('handles the six-year and consent periods', () => {
    expect(retentionEnd('2026-03-15', 72)).toBe('2032-12-31');
    expect(retentionEnd('2026-03-15', 24)).toBe('2028-12-31');
  });

  it('clamps to the last day of the month when the period is not a full year', () => {
    expect(retentionEnd('2026-03-15', 18)).toBe('2028-06-30');
    expect(retentionEnd('2026-03-15', 2)).toBe('2027-02-28');
  });

  it('accepts a full timestamp and reads only the year', () => {
    expect(retentionEnd('2026-09-05T08:00:00.000Z', 120)).toBe('2036-12-31');
  });

  it('names a default length for every class except permanent', () => {
    expect(RETENTION_DEFAULT_MONTHS).toEqual({ statutory10Y: 120, statutory6Y: 72, consent: 24 });
  });
});
```

- [ ] **Step 2: Den Test laufen lassen und das Scheitern sehen**

Run: `pnpm --filter @kompass/core test -- retention`
Expected: FAIL — `Cannot find module '../src/retention/classes'`.

- [ ] **Step 3: Die Rechnung schreiben**

`packages/core/src/retention/classes.ts`:

```typescript
/**
 * Aufbewahrungsklassen. Die Namen sind Code, weil Services sie benennen; die
 * Längen sind Einstellungen, weil ein Verein außerhalb Deutschlands anders
 * rechnet (Prinzip 2).
 */
export type RetentionClass = 'permanent' | 'statutory10Y' | 'statutory6Y' | 'consent';

export const RETENTION_CLASSES: readonly RetentionClass[] = ['permanent', 'statutory10Y', 'statutory6Y', 'consent'];

/**
 * Vorgabelängen in Monaten.
 * - `statutory10Y`: Belege, Zuwendungsbestätigungen, Jahresabschluss (§ 147 AO).
 * - `statutory6Y`: empfangene und abgesandte Geschäftsbriefe (§ 147 Abs. 3 AO).
 * - `consent`: ohne gesetzliche Grundlage — der Interessent, aus dem nichts wurde.
 * `permanent` fehlt hier: es wird nie fällig.
 */
export const RETENTION_DEFAULT_MONTHS: Record<Exclude<RetentionClass, 'permanent'>, number> = {
  statutory10Y: 120,
  statutory6Y: 72,
  consent: 24,
};

/**
 * Das Datum, an dem eine Aufbewahrung endet.
 *
 * Die Frist beginnt nicht am Ereignistag, sondern mit Ablauf des Kalenderjahres
 * (§ 147 Abs. 4 AO) — der 15.03.2026 und der 31.12.2026 laufen beide zum
 * 31.12.2036 ab. Endet die Frist in einem kürzeren Monat, gilt dessen letzter Tag.
 *
 * @param fromIso ISO-Datum oder -Zeitstempel; gelesen wird nur das Jahr.
 * @param months  Länge in Monaten, aus der Einstellung der Klasse.
 */
export function retentionEnd(fromIso: string, months: number): string {
  const year = Number(fromIso.slice(0, 4));
  const total = 11 + months; // Dezember (0-basiert 11) als Startmonat
  const targetYear = year + Math.floor(total / 12);
  const targetMonth = total % 12; // 0-basiert
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Test laufen lassen**

Run: `pnpm --filter @kompass/core test -- retention`
Expected: PASS (fünf Tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/retention/classes.ts packages/core/tests/retention.test.ts
git commit -m "feat(core): retention classes with the end-of-calendar-year rule"
```

---

### Task 2: Die Einstellungen für die Fristlängen

**Files:**
- Modify: `packages/core/src/settings/core.ts`
- Modify: `packages/core/tests/retention.test.ts`

**Interfaces:**
- Consumes: `RETENTION_DEFAULT_MONTHS` (Task 1).
- Produces: Einstellungsschlüssel `retention.statutory10Y`, `retention.statutory6Y`, `retention.consent` (ganze Zahlen, Monate); `retentionMonths(deps, cls: RetentionClass): number | null` — `null` bei `permanent`.

- [ ] **Step 1: Den Test ergänzen**

An `packages/core/tests/retention.test.ts` anhängen:

```typescript
import { createTestDeps } from '../src/testing';
import { retentionMonths } from '../src/retention/classes';
import { setSetting } from '../src/settings/service';
import { ctxWith } from '../src/testing';
import { unwrap } from '../src/result';

describe('retentionMonths', () => {
  it('reads the configured length and treats permanent as never due', async () => {
    const deps = createTestDeps();
    expect(retentionMonths(deps, 'statutory10Y')).toBe(120);
    expect(retentionMonths(deps, 'permanent')).toBeNull();

    unwrap(await setSetting(deps, ctxWith(['settings.manage']), { key: 'retention.consent', value: 18 }));
    expect(retentionMonths(deps, 'consent')).toBe(18);
  });
});
```

Die drei `import`-Zeilen gehören nach oben zu den vorhandenen Importen; hier stehen sie beisammen, damit klar ist, was gebraucht wird.

- [ ] **Step 2: Den Test laufen lassen und das Scheitern sehen**

Run: `pnpm --filter @kompass/core test -- retention`
Expected: FAIL — `retentionMonths is not a function`, danach (nach dem Anlegen) `unknown setting key: retention.consent`.

- [ ] **Step 3: Die Einstellungen registrieren**

In `packages/core/src/settings/core.ts` einen neuen Block neben `organization` anlegen und in die exportierte Liste aufnehmen (sieh dir an, wie die vorhandenen Blöcke am Dateiende zusammengeführt werden, und folge dem):

```typescript
import { RETENTION_DEFAULT_MONTHS } from '../retention/classes';

const months = z.number().int().min(1).max(1200);

/** Aufbewahrungsfristen in Monaten. Die Klasse `permanent` hat keine Länge. */
const retention: SettingDefinition[] = [
  { key: 'retention.statutory10Y', schema: months, default: RETENTION_DEFAULT_MONTHS.statutory10Y },
  { key: 'retention.statutory6Y', schema: months, default: RETENTION_DEFAULT_MONTHS.statutory6Y },
  { key: 'retention.consent', schema: months, default: RETENTION_DEFAULT_MONTHS.consent },
];
```

- [ ] **Step 4: `retentionMonths` schreiben**

An `packages/core/src/retention/classes.ts` anhängen:

```typescript
import type { Deps } from '../deps';
import { readSetting } from '../settings/service';

/**
 * Die konfigurierte Länge einer Klasse in Monaten. `permanent` liefert `null` —
 * es wird nie fällig, und `null` zwingt jeden Aufrufer, das zu behandeln.
 */
export function retentionMonths(deps: Deps, cls: RetentionClass): number | null {
  if (cls === 'permanent') return null;
  return readSetting<number>(deps, `retention.${cls}`);
}
```

- [ ] **Step 5: Test laufen lassen**

Run: `pnpm --filter @kompass/core test -- retention`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/settings/core.ts packages/core/src/retention/classes.ts packages/core/tests/retention.test.ts
git commit -m "feat(core): retention periods as settings, not constants"
```

---

### Task 3: Die zwei Manifest-Haken und der Sammler

**Files:**
- Modify: `packages/core/src/modules/manifest.ts`
- Create: `packages/core/src/retention/service.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/tests/retention.test.ts`

**Interfaces:**
- Consumes: `enabledManifests(deps)` aus `packages/core/src/modules/service.ts`.
- Produces:
  - `RetentionHold { label: string; until: string | null; entity: string; id: string }`
  - `DueItem { entity: string; id: string; label: string; dueSince: string }`
  - `ContactRoleDefinition { key: string; retention: RetentionClass }`
  - `ModuleManifest.retentionHolds?: (deps, entityType: string, id: string) => readonly RetentionHold[]`
  - `ModuleManifest.retentionDue?: (deps) => readonly DueItem[]`
  - `ModuleManifest.contactRoles?: readonly ContactRoleDefinition[]`
  - `holdsFor(deps, entityType: string, id: string): RetentionHold[]`
  - `dueUntil(holds: readonly RetentionHold[]): string | null` — das Maximum; `null`, wenn ein Halter dauerhaft ist
  - `collectRetentionDue(deps): DueItem[]`

- [ ] **Step 1: Den Test ergänzen**

An `packages/core/tests/retention.test.ts` anhängen:

```typescript
import { defineModule, type ModuleManifest } from '../src/modules/manifest';
import { collectRetentionDue, dueUntil, holdsFor } from '../src/retention/service';
import { coreModule } from '../src/core-module';
import { writeSettingInternal } from '../src/settings/service';

const holder = (key: string, until: string | null): ModuleManifest =>
  defineModule({
    key,
    version: '1',
    permissions: [`${key}.view`],
    retentionHolds: (_deps, entityType, id) => (entityType === 'contact' ? [{ label: `${key} hält ${id}`, until, entity: key, id }] : []),
    retentionDue: () => [{ entity: key, id: 'X1', label: `${key} X1`, dueSince: '2026-01-01' }],
  });

describe('retention collection', () => {
  it('asks every enabled module and takes the longest hold', () => {
    const deps = createTestDeps({ manifests: [coreModule, holder('alpha', '2028-12-31'), holder('beta', '2036-12-31')] });
    deps.db.transaction((tx) => {
      writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['alpha', 'beta'], 'test.enable');
    });
    const holds = holdsFor(deps, 'contact', 'C1');
    expect(holds.map((h) => h.entity).sort()).toEqual(['alpha', 'beta']);
    expect(dueUntil(holds)).toBe('2036-12-31');
  });

  it('never becomes due while one holder is permanent', () => {
    expect(dueUntil([{ label: 'Satzung', until: null, entity: 'x', id: '1' }, { label: 'Brief', until: '2030-12-31', entity: 'x', id: '2' }])).toBeNull();
  });

  it('is not due when nothing holds it', () => {
    expect(dueUntil([])).toBe(null);
  });

  it('does not ask a disabled module', () => {
    const deps = createTestDeps({ manifests: [coreModule, holder('alpha', '2028-12-31'), holder('beta', '2036-12-31')] });
    deps.db.transaction((tx) => {
      writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['alpha'], 'test.enable');
    });
    expect(holdsFor(deps, 'contact', 'C1').map((h) => h.entity)).toEqual(['alpha']);
    expect(collectRetentionDue(deps).map((d) => d.entity)).toEqual(['alpha']);
  });
});
```

**Achtung bei `dueUntil([])`:** Ein Objekt ohne jeden Halter ist *sofort* fällig, nicht *nie*. Deshalb liefert `dueUntil` für die leere Liste `null` im Sinne von „kein Halter" — die Unterscheidung „nie fällig" gegen „nichts hält es" trifft nicht diese Funktion, sondern der Aufrufer, der die leere Liste vorher erkennt. Der Test hält das fest, damit niemand die beiden Fälle später verwechselt.

- [ ] **Step 2: Den Test laufen lassen und das Scheitern sehen**

Run: `pnpm --filter @kompass/core test -- retention`
Expected: FAIL — `Cannot find module '../src/retention/service'`.

- [ ] **Step 3: Die Haken am Manifest ergänzen**

In `packages/core/src/modules/manifest.ts`, direkt neben `MediaReference` und `mediaReferences`:

```typescript
import type { RetentionClass } from '../retention/classes';

export interface RetentionHold {
  /** Menschlich lesbar, für die Anzeige und die Fehlermeldung:
   *  'Zuwendungsbestätigung BST-2026-0042', 'Adoptionsvertrag für „Rocky"'. */
  label: string;
  /** ISO-Datum, bis zu dem gehalten wird; null = dauerhaft. */
  until: string | null;
  entity: string;
  id: string;
}

export interface DueItem {
  entity: string;
  id: string;
  label: string;
  /** ISO-Datum, seit wann fällig. */
  dueSince: string;
}

/** Eine Kontaktrolle, die ein Modul beisteuert, samt ihrer Aufbewahrungsklasse. */
export interface ContactRoleDefinition {
  key: string;
  retention: RetentionClass;
}
```

und im `ModuleManifest`, unter `mediaReferences`:

```typescript
  /** Was dieses Modul festhält — synchron, nur lesend, ohne Rechteprüfung.
   *  Befragt vor dem Löschen und für den Fristenbildschirm. `entityType` ist
   *  generisch: derselbe Haken trägt später Dokumente und Belege. */
  retentionHolds?: (deps: Deps, entityType: string, id: string) => readonly RetentionHold[];
  /** Was bei diesem Modul zur Löschung fällig ist. */
  retentionDue?: (deps: Deps) => readonly DueItem[];
  /** Kontaktrollen, die dieses Modul beisteuert. */
  contactRoles?: readonly ContactRoleDefinition[];
```

- [ ] **Step 4: Den Sammler schreiben**

`packages/core/src/retention/service.ts`:

```typescript
import type { Deps } from '../deps';
import { enabledManifests } from '../modules/service';
import type { DueItem, RetentionHold } from '../modules/manifest';

/**
 * Wer dieses Objekt festhält. Befragt werden nur **aktive** Module: ein
 * ausgeschaltetes Modul schweigt (wie bei `mediaReferences`). Weil Schweigen
 * hier gefährlich ist — ein ausgeschaltetes Finanzmodul dürfte keinen Spender
 * freigeben —, muss jedes Modul mit diesem Haken in `dependsOn` des haltenden
 * Moduls stehen; `setModuleEnabled` verhindert das Abschalten dann von selbst.
 */
export function holdsFor(deps: Deps, entityType: string, id: string): RetentionHold[] {
  return enabledManifests(deps).flatMap((m) => [...(m.retentionHolds?.(deps, entityType, id) ?? [])]);
}

/**
 * Bis wann gehalten wird: das **Maximum** über alle Halter. Ein dauerhafter
 * Halter (`until: null`) gewinnt immer. Eine leere Liste liefert `null` im
 * Sinne von „kein Halter" — ob das „sofort fällig" oder „gar nicht geführt"
 * heißt, entscheidet der Aufrufer, nicht diese Funktion.
 */
export function dueUntil(holds: readonly RetentionHold[]): string | null {
  if (holds.length === 0) return null;
  if (holds.some((h) => h.until === null)) return null;
  return holds.reduce((max, h) => (h.until! > max ? h.until! : max), holds[0]!.until!);
}

/** Alles, was bei den aktiven Modulen zur Löschung fällig ist. */
export function collectRetentionDue(deps: Deps): DueItem[] {
  return enabledManifests(deps).flatMap((m) => [...(m.retentionDue?.(deps) ?? [])]);
}
```

- [ ] **Step 5: Aus dem Paket exportieren**

In `packages/core/src/index.ts` zwei Zeilen ergänzen, an der Stelle, wo die übrigen Bereiche stehen:

```typescript
export * from './retention/classes';
export * from './retention/service';
```

- [ ] **Step 6: Test laufen lassen**

Run: `pnpm --filter @kompass/core test`
Expected: PASS — alle Tests des Kerns, nicht nur die neuen.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/modules/manifest.ts packages/core/src/retention packages/core/src/index.ts packages/core/tests/retention.test.ts
git commit -m "feat(core): retentionHolds and retentionDue hooks, asked only of enabled modules"
```

---

### Task 4: Die Rollenregistry

**Files:**
- Create: `packages/modules/contacts/src/roles.ts`
- Create: `packages/modules/contacts/tests/roles.test.ts`
- Modify: `packages/modules/contacts/src/manifest.ts`
- Modify: `packages/modules/contacts/src/index.ts`

**Interfaces:**
- Consumes: `ContactRoleDefinition`, `enabledManifests` (Task 3).
- Produces: `contactRoleDefinitions(deps): Map<string, ContactRoleDefinition>`; das Kontaktmodul führt `contactRoles: [{ key: 'interested', retention: 'consent' }, { key: 'partner', retention: 'consent' }, { key: 'authority', retention: 'permanent' }, { key: 'service', retention: 'consent' }]`.

- [ ] **Step 1: Den Test schreiben**

`packages/modules/contacts/tests/roles.test.ts`:

```typescript
import { coreModule, defineModule, type ModuleManifest } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { writeSettingInternal } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { contactsModule } from '../src/manifest';
import { contactRoleDefinitions } from '../src/roles';

const financeLike: ModuleManifest = defineModule({
  key: 'finance',
  version: '1',
  permissions: ['finance.view'],
  dependsOn: ['contacts'],
  contactRoles: [{ key: 'donor', retention: 'statutory10Y' }],
});

const enable = (deps: ReturnType<typeof createTestDeps>, keys: string[]) => {
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', keys, 'test.enable');
  });
};

describe('contactRoleDefinitions', () => {
  it('brings the general roles of the contacts module', () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule] });
    enable(deps, ['contacts']);
    const roles = contactRoleDefinitions(deps);
    expect([...roles.keys()].sort()).toEqual(['authority', 'interested', 'partner', 'service']);
    expect(roles.get('authority')!.retention).toBe('permanent');
  });

  it('takes roles from other enabled modules', () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule, financeLike] });
    enable(deps, ['contacts', 'finance']);
    expect(contactRoleDefinitions(deps).get('donor')!.retention).toBe('statutory10Y');
  });

  it('ignores roles of a disabled module', () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule, financeLike] });
    enable(deps, ['contacts']);
    expect(contactRoleDefinitions(deps).has('donor')).toBe(false);
  });
});
```

- [ ] **Step 2: Den Test laufen lassen und das Scheitern sehen**

Run: `pnpm --filter @kompass/module-contacts test -- roles`
Expected: FAIL — `Cannot find module '../src/roles'`.

- [ ] **Step 3: Die Registry schreiben**

`packages/modules/contacts/src/roles.ts`:

```typescript
import { enabledManifests, type ContactRoleDefinition, type Deps } from '@kompass/core';

/**
 * Alle Kontaktrollen der aktiven Module, nach Schlüssel.
 *
 * Rollen kommen aus einer Registry und nicht aus freiem Text, weil an der Rolle
 * die Aufbewahrungsfrist hängt — und eine Frist, die an einem selbstgetippten
 * Wort hängt, ist keine.
 */
export function contactRoleDefinitions(deps: Deps): Map<string, ContactRoleDefinition> {
  const byKey = new Map<string, ContactRoleDefinition>();
  for (const manifest of enabledManifests(deps)) {
    for (const role of manifest.contactRoles ?? []) byKey.set(role.key, role);
  }
  return byKey;
}
```

- [ ] **Step 4: Die allgemeinen Rollen ans Manifest hängen**

In `packages/modules/contacts/src/manifest.ts` innerhalb von `defineModule` ergänzen:

```typescript
  /**
   * Die allgemeinen Rollen. Fachliche Rollen bringen die Fachmodule mit:
   * Tiere `adopter`/`sponsor`, Finanzen `donor`, Mitglieder `member`.
   * `authority` ist `permanent`, weil eine Behörde kein personenbezogener
   * Datensatz ist und nichts an ihr abläuft.
   */
  contactRoles: [
    { key: 'interested', retention: 'consent' },
    { key: 'partner', retention: 'consent' },
    { key: 'authority', retention: 'permanent' },
    { key: 'service', retention: 'consent' },
  ],
```

In `packages/modules/contacts/src/index.ts` ergänzen:

```typescript
export * from './roles';
```

- [ ] **Step 5: Test laufen lassen**

Run: `pnpm --filter @kompass/module-contacts test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/modules/contacts
git commit -m "feat(contacts): contact roles come from a registry the modules fill"
```

---

## Self-Review

**Spec-Abdeckung.** § 5.1 Rollenregistry: Task 4. § 5.2 Fristklassen als Einstellung samt Jahresende-Regel: Tasks 1 und 2. § 5.3 beide Haken, Maximum, deaktivierte Module: Task 3. § 5.4 Löschen selbst gehört in Plan 3 — hier entsteht nur die Rechnung, auf die es sich stützt.

**Platzhalter.** Keine. Die einzige Stelle mit Leseanweisung statt wörtlichem Code ist Task 2 Schritt 3 (wo die Settings-Blöcke in `core.ts` zusammengeführt werden), weil das Dateiende gelesen werden muss.

**Typkonsistenz.** `RetentionClass` (Task 1) wird von `ContactRoleDefinition` (Task 3) und den Rollen (Task 4) benutzt. `RetentionHold`/`DueItem` (Task 3) sind die Rückgaben der Haken und werden in Plan 3 von `deleteContact` und in Plan 4 vom Fristenbildschirm gelesen. `holdsFor`/`dueUntil`/`collectRetentionDue` heißen dort genauso.

**Abweichung von der Dateiliste der Spec.** § 9 der Spec nennt
`packages/core/src/modules/registry.ts` für die Aggregation der neuen Haken.
Dieser Plan fasst die Registry nicht an: `createRegistry` kennt alle Manifeste,
auch die abgeschalteten, und genau die dürfen nicht antworten. Die Aggregation
läuft deshalb über `enabledManifests(deps)` — im Kern für die Halter, im
Kontaktmodul für die Rollen. Das ist dasselbe Muster, das `mediaReferences`
schon benutzt, und der Grund, warum Entscheidung 7 überhaupt trägt.

**Bewusste Härte.** `dueUntil([])` liefert `null` und bedeutet „kein Halter", nicht „nie fällig". Der Test hält das ausdrücklich fest, weil die Verwechslung sonst eine Löschung entweder verhindert oder zu früh erlaubt.
