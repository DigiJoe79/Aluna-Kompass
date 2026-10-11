// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import type { FieldSchema } from '@kompass/module-site/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { SchemaForm } from '@/components/schema-form';

const seen: Record<string, unknown>[] = [];
vi.mock('@/components/forms/media-picker', () => ({
  MediaPicker: (props: Record<string, unknown>) => {
    seen.push(props);
    return <span>{String(props.label)}</span>;
  },
}));

afterEach(() => {
  cleanup();
  seen.length = 0;
});

const schema: Record<string, FieldSchema> = {
  photo: { widget: 'asset', label: 'Foto', accept: 'image/*', ratio: '1:1', width: 320 } as FieldSchema,
  flyer: { widget: 'asset', label: 'Flyer', accept: 'application/pdf' } as FieldSchema,
  gallery: { type: 'array', widget: 'list', label: 'Galerie', items: { widget: 'asset', label: 'Bild', accept: 'image/*', ratio: '4:3' } } as FieldSchema,
  people: { type: 'array', widget: 'objectList', label: 'Leute', items: { type: 'object', properties: { portrait: { widget: 'asset', label: 'Porträt', accept: 'image/*' } } } } as FieldSchema,
};

/** Spec Ausschnitt für alle Bilder § 4: Bildfelder des Templates bekommen ihre Stelle, auch in Listen. */
describe('SchemaForm: Bildfelder mit Ausschnitt', () => {
  it('reicht Stelle, Maße und „Gespeichert wird mit …“ an den Bildwähler; der Wert ist die abgeleitete ID', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <SchemaForm
          schema={schema}
          value={{ photo: 'A~0_0_5000_5000', flyer: 'P', gallery: ['B'], people: [{ portrait: 'C' }] }}
          locales={['de']}
          onChange={() => {}}
          media={{ sizes: { A: { width: 1500, height: 1500 } }, target: 'dem Eintrag', placeLabel: 'Team' }}
        />
      </NextIntlClientProvider>,
    );
    const by = (label: string) => seen.find((p) => p.label === label)!;
    expect(by('Foto')).toMatchObject({ value: 'A~0_0_5000_5000', derived: true, target: 'dem Eintrag', sizes: { A: { width: 1500, height: 1500 } } });
    expect((by('Foto').places as { formats: string[]; places: { label: string; minWidthPx: number }[] }).formats).toEqual(['1:1']);
    expect((by('Foto').places as { places: { label: string; minWidthPx: number }[] }).places[0]).toMatchObject({ label: 'Team', minWidthPx: 480 });
    // PDF: keine Stelle, kein Ausschnitt.
    expect(by('Flyer').places).toBeUndefined();
    // In Listen: dasselbe Feld je Eintrag.
    expect(by('Bild')).toMatchObject({ value: 'B', derived: true });
    expect((by('Bild').places as { formats: string[] }).formats).toEqual(['4:3']);
    expect(by('Porträt')).toMatchObject({ value: 'C', derived: true });
  });
});
