import { coreModule, type McpToolDefinition } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { coreMcpTools } from '@kompass/mcp';
import { describe, expect, it } from 'vitest';

/**
 * Prinzip 6 gilt auch fuers Lesen und auch ueber MCP. Ein Token bekommt jeder
 * angemeldete Nutzer (`createApiToken` verlangt nur eine Sitzung), also ist
 * der Rechtesatz des Nutzers die einzige Grenze — ein Werkzeug, das keinen
 * prueft, hebt sie fuer jeden auf, der eine Rolle hat.
 *
 * Geprueft wird der Handler direkt: Er ist die Stelle, an der ein Werkzeug
 * entweder einen Dienst mit `ctx` ruft oder am Dienst vorbei einen internen
 * Lesehelfer.
 */
const deps = createTestDeps({ manifests: [coreModule] });
const ohneRechte = ctxWith([], insertUser(deps, {}));
const werkzeug = (name: string): McpToolDefinition => {
  const gefunden = coreMcpTools.find((tool) => tool.name === name);
  if (!gefunden) throw new Error(`Werkzeug ${name} gibt es nicht`);
  return gefunden;
};

/**
 * Werkzeuge, die jedem angemeldeten Nutzer antworten duerfen — mit Grund.
 * Wer hier eintraegt, entscheidet bewusst; wer ein Werkzeug ergaenzt, das
 * ohne Recht Daten herausgibt, bekommt einen roten Test.
 *
 * Beide zeigen Struktur, keine Inhalte, und die Oberflaeche zeigt dieselbe
 * Auskunft ohnehin jedem: Die Startseite listet die aktiven Module
 * (`(shell)/page.tsx`), und das aktive Theme steckt im Wurzel-Layout jeder
 * Seite. Ein Recht zu verlangen, das die Oberflaeche nicht verlangt, wuerde
 * die Startseite fuer Nutzer ohne `modules.manage` zerlegen, ohne irgendetwas
 * zu schuetzen.
 *
 * `translations_list_gaps` traegt sein Recht eine Ebene tiefer: Jedes Modul
 * prueft im `translatables`-Haken sein eigenes Ansichtsrecht, und was der
 * Aufrufer nicht sehen darf, kommt unter `omitted` zurueck statt zu fehlen —
 * sonst saehe „keine Luecken“ aus wie „alles uebersetzt“. Der Test unten haelt
 * fest, dass dabei wirklich nichts durchkommt.
 */
const OHNE_RECHT = new Set(['modules_list', 'themes_list', 'translations_list_gaps']);

describe('reading tools check permissions too', () => {
  it('hands nothing to a user without any permission, except what is listed', async () => {
    const undicht: string[] = [];
    for (const tool of coreMcpTools) {
      if (OHNE_RECHT.has(tool.name)) continue;
      // Leere Argumente genuegen: Die Rechtepruefung steht vor der Validierung,
      // ein Werkzeug ohne sie antwortet also auch ohne brauchbare Eingabe. Wirft
      // eines davor (media_upload dekodiert erst, siehe Backlog), ist das kein
      // Erfolg und damit kein Leck — hier geht es nur um herausgegebene Daten.
      let ergebnis: { ok: boolean };
      try {
        ergebnis = await tool.handler(deps, ohneRechte, {} as never);
      } catch {
        continue;
      }
      if (ergebnis.ok) undicht.push(tool.name);
    }
    expect(undicht).toEqual([]);
  });

  it('lets the translation overview answer, but with nothing in it', async () => {
    const ergebnis = await werkzeug('translations_list_gaps').handler(deps, ohneRechte, {} as never);
    expect(ergebnis).toMatchObject({ ok: true, value: { gaps: [] } });
  });

  it('keeps the exception list honest: every listed tool exists and answers without a permission', async () => {
    for (const name of OHNE_RECHT) {
      const ergebnis = await werkzeug(name).handler(deps, ohneRechte, {} as never);
      expect(ergebnis.ok, `${name} prueft inzwischen ein Recht — aus der Liste nehmen`).toBe(true);
    }
  });

  it('keeps the bank and tax details from a user without settings.manage', async () => {
    const ergebnis = await werkzeug('settings_list').handler(deps, ohneRechte, {});
    expect(ergebnis).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });

  it('keeps a single setting from a user without settings.manage', async () => {
    const ergebnis = await werkzeug('settings_get').handler(deps, ohneRechte, { key: 'organization.iban' });
    expect(ergebnis).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });
});
