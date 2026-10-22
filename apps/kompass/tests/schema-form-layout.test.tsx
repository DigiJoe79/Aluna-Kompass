// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { FieldSchema } from '@kompass/module-site/client';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { LocalizedField, languageColumns, localizedSize } from '@/components/forms/localized-field';
import { SchemaForm } from '@/components/schema-form';

// Der Medienwähler zieht die Mediathek samt Server Actions nach; für das Raster reicht ein Platzhalter.
vi.mock('@/components/forms/media-picker', () => ({ MediaPicker: ({ label }: { label: string }) => <span>{label}</span> }));

afterEach(cleanup);

function wrap(children: ReactNode) {
  return render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>,
  );
}

/** Die Zelle im Raster, in der ein Feld mit dieser Beschriftung steht. */
const cellOf = (label: string) => {
  let node: HTMLElement | null = screen.getByText(label);
  // Bis zur Zelle des Formularrasters — mehrsprachige Felder haben ein eigenes Raster der Sprachspalten darin.
  while (node && !node.parentElement?.className.includes('@[880px]:grid-cols-4')) node = node.parentElement;
  return node!;
};

/** docs/MUSTER.md § J: Größe je Sprache, nebeneinander stehende Sprachen multiplizieren, höchstens `full`. */
describe('localizedSize', () => {
  it.each([
    ['s', 1, 's'],
    ['s', 2, 'm'],
    ['m', 2, 'full'],
    ['s', 3, 'l'],
    ['l', 2, 'full'],
    ['m', 3, 'full'],
    // Ab vier Sprachen stehen sie in Reitern: dann gilt die Größe einer Sprache.
    ['s', 4, 's'],
    ['m', 5, 'm'],
  ] as const)('%s bei %i Sprachen wird %s', (size, count, expected) => {
    expect(localizedSize(size, count)).toBe(expected);
  });
});

/**
 * Sprachspalten nach der Breite des Feldes, nicht des Fensters (Plan K8/K9 T2b): zwei Sprachen nebeneinander ab
 * 520 px Feldbreite, drei ab 800 px, darunter untereinander; ab vier Sprachen Reiter. Die Zelle selbst bleibt
 * dieselbe (Sprachkürzel am Label), nur die Anordnung wechselt.
 */
describe('Sprachspalten', () => {
  // Runde 3 (128, 130, 190): auch ein Feld, das je Sprache schon die volle Breite nimmt, steht ab md nebeneinander —
  // erst ab einer breiteren Spalte, damit jede Sprache Platz behält.
  it('languageColumns stellt auch `full` ab md nebeneinander', () => {
    expect(languageColumns(2, 'full')).toBe('@[720px]:grid-cols-2');
    expect(languageColumns(3, 'full')).toBe('@[1080px]:grid-cols-3');
    expect(languageColumns(4, 'full')).toBe('');
    expect(languageColumns(2, 'l')).toContain('grid-cols-2');
  });
});

describe('SchemaForm', () => {
  const schema: Record<string, FieldSchema> = {
    count: { widget: 'number', type: 'number', label: 'Anzahl' },
    team: { widget: 'text', type: 'string', label: 'Projekt', size: 'l' },
    before: { widget: 'asset', type: ['string', 'null'], label: 'Vorher', group: 'Bilder', size: 'm' },
    after: { widget: 'asset', type: ['string', 'null'], label: 'Nachher', group: 'Bilder', size: 'm' },
    claim: { widget: 'localized', label: 'Claim' },
    spotlight: { widget: 'references', view: 'animals', key: 'slug', labelField: 'name', maxItems: 2, label: 'Spotlight' },
  };

  it('bildet aus aufeinanderfolgenden Feldern mit gleichem group einen Abschnitt mit Titel, ohne umzusortieren', () => {
    wrap(<SchemaForm schema={schema} value={{}} locales={['de']} onChange={() => {}} />);
    // Ebene aus dem Umfeld (Section, K10 Charge 3): ohne Umfeld 2.
    const sections = screen.getAllByRole('heading', { level: 2 });
    expect(sections.map((h) => h.textContent)).toEqual(['Bilder']);
    const bilder = sections[0]!.closest('section')!;
    expect(bilder.textContent).toContain('Vorher');
    expect(bilder.textContent).toContain('Nachher');
    expect(bilder.textContent).not.toContain('Anzahl');
    expect(bilder.textContent).not.toContain('Claim');
  });

  it('gibt jedem Platz einen vollständigen zugänglichen Namen', () => {
    wrap(<SchemaForm schema={{ spotlight: schema.spotlight! }} value={{}} locales={['de']} onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Spotlight, Platz 1' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Spotlight, Platz 2' })).toBeTruthy();
  });

  it('zeigt den Hinweis auf einen veralteten Wert am Platz', () => {
    wrap(
      <SchemaForm
        schema={{ spotlight: schema.spotlight! }}
        value={{ spotlight: ['bello', 'weg'] }}
        options={{ spotlight: [{ value: 'bello', label: 'Bello' }] }}
        locales={['de']}
        onChange={() => {}}
      />,
    );
    const note = screen.getByText(/„weg“ steht nicht mehr zur Auswahl/);
    expect(cellOf('Platz 2').contains(note)).toBe(true);
  });

  it('setzt den URL-Teil ans Ende des ersten Abschnitts, im selben Raster (10 B14)', () => {
    wrap(<SchemaForm schema={{ count: schema.count! }} value={{}} locales={['de']} onChange={() => {}} trailing={<span>Slug-Feld</span>} />);
    const slug = screen.getByText('Slug-Feld');
    expect(slug.closest('.grid')).toBe(cellOf('Anzahl').parentElement);
    expect(cellOf('Anzahl').compareDocumentPosition(slug) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

/**
 * Befund K9 16: Bei einzeiligen mehrsprachigen Feldern steht das Sprachkürzel links im Feld (Aufbau wie das „€“
 * im Betragsfeld), damit alle Eingaben einer Rasterzeile auf einer Linie liegen. Mehrzeilige Felder behalten das
 * Kürzel über dem Feld. Jede Eingabe heißt zugänglich „‹Label› (‹Sprachname›)“; „nicht übersetzt“ steht unter dem Feld.
 */
/** Sprachkürzel rechts in der Labelzeile, ein- wie mehrzeilig (Designer 2026-10-16, Teil 2 Nr. 8). */
describe('Sprachkürzel', () => {
  /** Das Kürzel einer Eingabe: das `<label>` am Ende der Zeile über ihr. */
  const codeOf = (input: HTMLElement) => (input.previousElementSibling as HTMLElement | null)?.querySelector(`label[for="${CSS.escape(input.id)}"]`) ?? null;

  it('LocalizedField einzeilig: Kürzel in der Labelzeile, zugänglicher Name je Sprache', () => {
    wrap(<LocalizedField name="sizeText" label="Größe als Text" value={{ de: 'mittel' }} locales={['de', 'en']} />);
    const de = screen.getByRole('textbox', { name: 'Größe als Text (Deutsch)' });
    const en = screen.getByRole('textbox', { name: 'Größe als Text (Englisch)' });
    expect(codeOf(de)?.textContent).toBe('DE');
    expect(codeOf(en)?.textContent).toBe('EN');
    // Der Hinweis steht unter dem Feld.
    const hint = screen.getByText('unübersetzt');
    expect(en.nextElementSibling).toBe(hint);
    expect(en.getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('LocalizedField mehrzeilig: dieselbe Labelzeile', () => {
    wrap(<LocalizedField name="summary" label="Kurztext" kind="textarea" value={{}} locales={['de', 'en']} />);
    const de = screen.getByRole('textbox', { name: 'Kurztext (Deutsch)' });
    expect(de.tagName).toBe('TEXTAREA');
    expect(codeOf(de)?.textContent).toBe('DE');
  });

  it('lange Kürzel stehen ebenso rechts', () => {
    wrap(<LocalizedField name="claim" label="Claim" value={{}} locales={['de', 'pt-br']} />);
    expect(codeOf(screen.getByRole('textbox', { name: /^Claim \(Portugiesisch/ }))?.textContent).toBe('PT-BR');
  });

  it('schema-form localized einzeilig: Kürzel und zugänglicher Name', () => {
    wrap(<SchemaForm schema={{ claim: { widget: 'localized', label: 'Claim' } }} value={{ claim: { de: 'Hallo' } }} locales={['de', 'en']} onChange={() => {}} />);
    const en = screen.getByRole('textbox', { name: 'Claim (Englisch)' });
    expect(codeOf(en)?.textContent).toBe('EN');
    expect(en.nextElementSibling).toBe(screen.getByText('noch nicht übersetzt'));
    // Die Gruppe heißt wie das Feld.
    expect(screen.getByRole('group', { name: 'Claim' })).toBeTruthy();
  });

  it('schema-form localized Markdown: dieselbe Labelzeile', () => {
    wrap(<SchemaForm schema={{ lede: { widget: 'localized', label: 'Einleitung', markdown: true } }} value={{}} locales={['de', 'en']} onChange={() => {}} />);
    const de = screen.getByRole('textbox', { name: 'Einleitung (Deutsch)' });
    expect(de.tagName).toBe('TEXTAREA');
    expect(codeOf(de)?.textContent).toBe('DE');
  });

  // 10 B12: Die Vorschau hat die Form von LocalizedField — „Vorschau“ und je Sprache ein Umschalter, kein Knopf im Markenstil.
  it('schema-form localized Markdown: Vorschau-Umschalter je Sprache wie LocalizedField', () => {
    wrap(<SchemaForm schema={{ lede: { widget: 'localized', label: 'Einleitung', markdown: true } }} value={{ lede: { de: 'Hallo', en: 'Hello' } }} locales={['de', 'en']} onChange={() => {}} />);
    const toggles = screen.getAllByRole('button', { pressed: undefined }).filter((b) => b.hasAttribute('aria-pressed'));
    expect(toggles.map((b) => b.textContent)).toEqual(['DE', 'EN']);
    expect(toggles[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Vorschau' })).toBeNull();
  });
});

/** Runde 3, 135 (MUSTER § E): Eine Zahl mit Einheit aus dem Template zeigt sie rechts im Feld. */
describe('SchemaForm number with unit', () => {
  it('shows the unit inside the field', () => {
    wrap(<SchemaForm schema={{ fee: { type: 'number', label: 'Mitgliedsbeitrag im Jahr', unit: '€' } as FieldSchema }} value={{ fee: 60 }} locales={['de']} onChange={() => {}} />);
    expect(screen.getByText('€').closest('[data-slot="input-unit"]')).toBeTruthy();
  });
});
