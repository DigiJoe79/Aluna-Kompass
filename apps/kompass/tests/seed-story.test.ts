import { coreModule, login, schema, SEED_ADMIN_PASSWORD, seedDevelopment, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { animalPhotos, animals } from '@kompass/module-animals';
import { documents, listDocuments } from '@kompass/module-dms';
import { getProjectFinance } from '@kompass/module-finance';
import { projects } from '@kompass/module-projects';
import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';

const ULID = /[0-9A-HJKMNP-TV-Z]{26}/;

// Ohne drizzle-orm: Die App hängt nicht davon ab, gefiltert wird in JS.
/**
 * Die Entwicklungsdaten über alle Module als ein Jahr Vereinsarbeit (Spec
 * 2026-10-06 § 4) — das, was die Bilder der Pipeline voraussetzen und was kein
 * Modul allein prüfen kann: der Kopf der Akte über Akte und Finanzen, die
 * Betreffe aller Module, Tiere und Projekte mit Bildern, Nadjas Anmeldung.
 */
describe('Entwicklungsdaten als Vereinsalltag', () => {
  it('trägt die Bilder der Pipeline', async () => {
    const deps = createTestDeps({ manifests: [coreModule, ...installedModules], env: 'development' });
    await seedDevelopment(deps);
    const admin = deps.db.select().from(schema.users).all().find((u) => u.email === 'admin@kompass.local')!;
    const all = ctxWith([...deps.registry.permissionKeys], admin.id);

    // Akte (Review Focus 3): oben nur die benannten Ausnahmen des Finanz-Seeds (Task 7, 3m), dann die Tagespost der
    // Akte in ihrer Reihenfolge, danach nichts mehr, das nicht an seinem Datum liegt.
    const list = unwrap(await listDocuments(deps, all, { limit: 200 })).documents;
    const isException = (d: (typeof list)[number]) => ['finance-confirmation', 'finance-confirmation-signed', 'finance-partner-evidence'].includes(d.typeKey) || d.subject.includes('Jugendfreizeit');
    const rest = list.filter((d) => !isException(d));
    expect(rest.slice(0, 4).map((d) => d.subject)).toEqual([
      'Winterhilfe: Bitte um Unterstützung',
      'Zusage Netzwerktreffen',
      'Anfrage zu Baxter',
      'Netzwerktreffen im Herbst: Einladung des Landesverbands',
    ]);
    const firstRest = list.indexOf(rest[0]!);
    expect(list.slice(0, firstRest).every(isException)).toBe(true);
    // 8 Zuwendungsbestätigungen (eine davon die § 60a-Bestätigung mit eigenem Ausstellungsdatum), 1 unterschriebene,
    // 1 Beschluss zur wartenden Umwidmung, 2 Nachweise — beim Planen als 11 gezählt (Ausführung 2026-10-06).
    expect(firstRest).toBeLessThanOrEqual(12);
    // Plan 1: kein Betreff trägt eine ULID.
    expect(deps.db.select({ subject: documents.subject }).from(documents).all().filter((d) => ULID.test(d.subject))).toEqual([]);

    // Tiere mit Fotos, Projekt mit Bild und gebuchten Zahlen.
    for (const a of deps.db.select().from(animals).all()) {
      expect(deps.db.select().from(animalPhotos).all().filter((p) => p.animalId === a.id).length, a.name).toBeGreaterThan(0);
    }
    const winter = deps.db.select().from(projects).all().find((p) => p.slug === 'winterhilfe')!;
    expect(winter.imageAssetId).not.toBeNull();
    const finance = unwrap(await getProjectFinance(deps, all, { projectId: winter.id }));
    expect(finance.result.incomeCents).toBeGreaterThan(0);
    expect(finance.result.expenseCents).toBeGreaterThan(0);

    // Telefon „Auslage einreichen“: Nadja Vogt meldet sich mit dem Entwicklungs-Passwort an.
    const session = await login(deps, { email: 'nadja@kompass.local', password: SEED_ADMIN_PASSWORD, ipAddress: null, requestId: 'R' });
    expect(session.ok).toBe(true);
  });
});
