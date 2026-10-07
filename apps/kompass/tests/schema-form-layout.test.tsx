// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { FieldSchema } from '@kompass/module-site/client';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { LocalizedField, languageColumns, localizedSize } from '@/components/forms/localized-field';
import { FormGrid } from '@/components/forms/form-grid';
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
  while (node && !node.parentElement?.className.includes('grid')) node = node.parentElement;
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

describe('LocalizedField', () => {
  it('spannt Größe je Sprache mal Zahl der Sprachen statt fest zwei Spalten', () => {
    wrap(
      <FormGrid>
        <LocalizedField name="size" label="Größe als Text" size="s" value={{}} locales={['de', 'en']} />
      </FormGrid>,
    );
    const cell = cellOf('Größe als Text');
    expect(cell.className).toContain('@[880px]:col-span-2');
    expect(cell.className).not.toContain('md:col-span-2');
    expect(cell.className).not.toContain('col-span-4');
  });

  it('nimmt für Langtext die Größe l je Sprache', () => {
    wrap(
      <FormGrid>
        <LocalizedField name="summary" label="Kurztext" kind="textarea" value={{}} locales={['de', 'en']} />
      </FormGrid>,
    );
    expect(cellOf('Kurztext').className).toContain('@[880px]:col-span-4');
  });
});

/**
 * Sprachspalten nach der Breite des Feldes, nicht des Fensters (Plan K8/K9 T2b): zwei Sprachen nebeneinander ab
 * 520 px Feldbreite, drei ab 800 px, darunter untereinander; ab vier Sprachen Reiter. Die Zelle selbst bleibt
 * dieselbe (Sprachkürzel am Label), nur die Anordnung wechselt.
 */
describe('Sprachspalten', () => {
  /** Das Raster der Sprachzellen: der Elternknoten der Zelle mit dem Sprachkürzel. */
  const languageGrid = (code: string) => {
    let node: HTMLElement | null = screen.getAllByText(code)[0]!;
    while (node && !node.className.includes('grid')) node = node.parentElement;
    return node!;
  };

  const expectColumns = (grid: HTMLElement, count: number) => {
    expect(grid.parentElement!.className).toContain('@container');
    expect(grid.className).not.toMatch(/\bmd:grid-cols-/);
    if (count === 2) {
      expect(grid.className).toContain('@[520px]:grid-cols-2');
      expect(grid.className).not.toContain('grid-cols-3');
    } else if (count === 3) {
      // Alle in einer Reihe oder alle untereinander, nie zwei oben und eine darunter.
      expect(grid.className).not.toContain('grid-cols-2');
      expect(grid.className).toContain('@[800px]:grid-cols-3');
    } else {
      expect(grid.className).not.toMatch(/grid-cols-[23]/);
    }
  };

  it('Sprachspalten haben den Abstand des Formularrasters (K10 § 4.6)', () => {
    wrap(<LocalizedField name="name" label="Name" value={{}} locales={['de', 'en']} />);
    const cls = languageGrid('DE').className.split(' ');
    expect(cls).toEqual(expect.arrayContaining(['gap-x-5', 'gap-y-4']));
    expect(cls).not.toContain('gap-3');
  });

  it.each([2, 3, 4])('LocalizedField mit %i Sprachen', (count) => {
    const locales = ['de', 'en', 'ro', 'fr'].slice(0, count);
    wrap(<LocalizedField name="summary" label="Kurztext" value={{}} locales={locales} />);
    expectColumns(languageGrid('DE'), count);
  });

  it.each([2, 3, 4])('schema-form localized mit %i Sprachen', (count) => {
    const locales = ['de', 'en', 'ro', 'fr'].slice(0, count);
    wrap(<SchemaForm schema={{ claim: { widget: 'localized', label: 'Claim' } }} value={{}} locales={locales} onChange={() => {}} />);
    expectColumns(languageGrid('DE'), count);
  });

  // Befund K9 5a: Ist schon eine Sprache `full`, stehen die Sprachen immer untereinander, jede über die volle Breite.
  it.each([2, 3])('LocalizedField der Größe full mit %i Sprachen steht untereinander', (count) => {
    const locales = ['de', 'en', 'ro'].slice(0, count);
    wrap(<LocalizedField name="lede" label="Einleitung" size="full" value={{}} locales={locales} />);
    expect(languageGrid('DE').className).not.toMatch(/grid-cols-[23]/);
  });

  it.each([2, 3])('schema-form localized der Größe full mit %i Sprachen steht untereinander', (count) => {
    const locales = ['de', 'en', 'ro'].slice(0, count);
    wrap(<SchemaForm schema={{ lede: { widget: 'localized', label: 'Einleitung', size: 'full' } }} value={{}} locales={locales} onChange={() => {}} />);
    expect(languageGrid('DE').className).not.toMatch(/grid-cols-[23]/);
    expect(cellOf('Einleitung').className).toContain('@[880px]:col-span-4');
  });

  it('languageColumns liefert bei full keine Spalten', () => {
    expect(languageColumns(2, 'full')).toBe('');
    expect(languageColumns(3, 'full')).toBe('');
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

  it('rastert jedes Feld nach seiner Größe', () => {
    wrap(<SchemaForm schema={schema} value={{}} locales={['de', 'en']} onChange={() => {}} />);
    expect(cellOf('Anzahl').className).not.toContain('col-span');
    expect(cellOf('Projekt').className).toContain('@[880px]:col-span-3');
    expect(cellOf('Vorher').className).toContain('@[880px]:col-span-2');
    // Mehrsprachiger Text: m je Sprache, zwei Sprachen nebeneinander → ganze Zeile.
    expect(cellOf('Claim').className).toContain('@[880px]:col-span-4');
    // Mehrfachverweis: jeder Platz eine Zelle, Standard m.
    expect(cellOf('Spotlight').className).toContain('@[880px]:col-span-2');
  });

  it('bildet aus aufeinanderfolgenden Feldern mit gleichem group einen Abschnitt mit Titel, ohne umzusortieren', () => {
    wrap(<SchemaForm schema={schema} value={{}} locales={['de']} onChange={() => {}} />);
    const sections = screen.getAllByRole('heading', { level: 3 });
    expect(sections.map((h) => h.textContent)).toEqual(['Bilder']);
    const bilder = sections[0]!.closest('section')!;
    expect(bilder.textContent).toContain('Vorher');
    expect(bilder.textContent).toContain('Nachher');
    expect(bilder.textContent).not.toContain('Anzahl');
    expect(bilder.textContent).not.toContain('Claim');
    expect(bilder.className).toContain('border-t');
  });

  // Befund K9 5b: Die Plätze stehen als einzelne Zellen direkt im Raster des Abschnitts, ohne eigenen Block.
  it('stellt die Plätze eines Mehrfachverweises als Zellen ins Raster des Abschnitts, je m', () => {
    wrap(<SchemaForm schema={{ count: schema.count!, spotlight: schema.spotlight! }} value={{}} locales={['de']} onChange={() => {}} />);
    const grid = cellOf('Anzahl').parentElement!;
    const first = cellOf('Spotlight');
    const second = cellOf('Platz 2');
    expect(first.parentElement).toBe(grid);
    expect(second.parentElement).toBe(grid);
    expect(first.className).toContain('@[880px]:col-span-2');
    expect(second.className).toContain('@[880px]:col-span-2');
    expect(document.querySelector('fieldset')).toBeNull();
    expect(grid.querySelectorAll('.grid')).toHaveLength(0);
    expect(screen.queryByText('Platz 1')).toBeNull();
  });

  it('gibt jedem Platz einen vollständigen zugänglichen Namen', () => {
    wrap(<SchemaForm schema={{ spotlight: schema.spotlight! }} value={{}} locales={['de']} onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Spotlight, Platz 1' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Spotlight, Platz 2' })).toBeTruthy();
  });

  it('nimmt size aus dem Template je Platz', () => {
    wrap(<SchemaForm schema={{ spotlight: { ...schema.spotlight!, size: 's', maxItems: 3 } }} value={{}} locales={['de']} onChange={() => {}} />);
    for (const label of ['Spotlight', 'Platz 2', 'Platz 3']) {
      expect(cellOf(label).className).not.toContain('col-span');
    }
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

  it('setzt Felder vor dem ersten Abschnitt ins selbe Raster', () => {
    wrap(<SchemaForm schema={{ count: schema.count! }} value={{}} locales={['de']} onChange={() => {}} leading={<span>Slug-Feld</span>} />);
    expect(screen.getByText('Slug-Feld').closest('.grid')).toBe(cellOf('Anzahl').parentElement);
  });
});

/**
 * Befund K9 16: Bei einzeiligen mehrsprachigen Feldern steht das Sprachkürzel links im Feld (Aufbau wie das „€“
 * im Betragsfeld), damit alle Eingaben einer Rasterzeile auf einer Linie liegen. Mehrzeilige Felder behalten das
 * Kürzel über dem Feld. Jede Eingabe heißt zugänglich „‹Label› (‹Sprachname›)“; „nicht übersetzt“ steht unter dem Feld.
 */
describe('Sprachkürzel', () => {
  const prefixOf = (input: HTMLElement) => input.previousElementSibling as HTMLElement | null;

  it('LocalizedField einzeilig: Kürzel als Präfix im Feld, zugänglicher Name je Sprache', () => {
    wrap(<LocalizedField name="sizeText" label="Größe als Text" value={{ de: 'mittel' }} locales={['de', 'en']} />);
    const de = screen.getByRole('textbox', { name: 'Größe als Text (Deutsch)' });
    const en = screen.getByRole('textbox', { name: 'Größe als Text (Englisch)' });
    expect(prefixOf(de)?.textContent).toBe('DE');
    expect(prefixOf(de)?.getAttribute('aria-hidden')).toBe('true');
    expect(prefixOf(en)?.textContent).toBe('EN');
    // Der Hinweis steht unter dem Feld, nicht neben dem Kürzel.
    const hint = screen.getByText('unübersetzt');
    expect(en.parentElement!.nextElementSibling).toBe(hint);
    expect(en.getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('LocalizedField mehrzeilig: Kürzel über dem Feld', () => {
    wrap(<LocalizedField name="summary" label="Kurztext" kind="textarea" value={{}} locales={['de', 'en']} />);
    const de = screen.getByRole('textbox', { name: 'Kurztext (Deutsch)' });
    expect(de.tagName).toBe('TEXTAREA');
    expect(prefixOf(de)?.tagName).toBe('LABEL');
    expect(prefixOf(de)?.textContent).toBe('DE');
  });

  it('Präfix hat eine feste Mindestbreite, auch für lange Kürzel', () => {
    wrap(<LocalizedField name="claim" label="Claim" value={{}} locales={['de', 'pt-br']} />);
    const de = prefixOf(screen.getByRole('textbox', { name: 'Claim (Deutsch)' }))!;
    const pt = prefixOf(screen.getByRole('textbox', { name: /^Claim \(Portugiesisch/ }))!;
    expect(pt.textContent).toBe('PT-BR');
    expect(de.className).toMatch(/\bmin-w-/);
    expect(de.className).toBe(pt.className);
  });

  it('schema-form localized einzeilig: Präfix und zugänglicher Name', () => {
    wrap(<SchemaForm schema={{ claim: { widget: 'localized', label: 'Claim' } }} value={{ claim: { de: 'Hallo' } }} locales={['de', 'en']} onChange={() => {}} />);
    const en = screen.getByRole('textbox', { name: 'Claim (Englisch)' });
    expect(prefixOf(en)?.textContent).toBe('EN');
    expect(en.parentElement!.nextElementSibling).toBe(screen.getByText('noch nicht übersetzt'));
  });

  it('schema-form localized Markdown: Kürzel über dem Feld', () => {
    wrap(<SchemaForm schema={{ lede: { widget: 'localized', label: 'Einleitung', markdown: true } }} value={{}} locales={['de', 'en']} onChange={() => {}} />);
    const de = screen.getByRole('textbox', { name: 'Einleitung (Deutsch)' });
    expect(de.tagName).toBe('TEXTAREA');
    expect(prefixOf(de)?.textContent).toBe('DE');
    expect(prefixOf(de)?.tagName).toBe('LABEL');
  });
});
