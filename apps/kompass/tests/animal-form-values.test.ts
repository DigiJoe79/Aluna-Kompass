import { describe, expect, it } from 'vitest';
import { animalFieldsFromForm } from '@/app/(shell)/animals/form-values';

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.set(k, v);
  return data;
};

describe('animalFieldsFromForm', () => {
  it('reads the fields of the mask like the save action', () => {
    expect(
      animalFieldsFromForm(
        form({ name: ' Lotte ', sex: 'female', 'birthText.de': '2021', sizeCm: '45', 'sizeText.de': 'mittel', location: 'germany', place: ' Köln ', isEmergency: 'on', 'traits__text.de': 'a, b,', 'traits__text.en': 'x', externalProfileUrl: ' https://x.example ', 'summary.de': ' Kurz ', 'body.de': 'Lang', 'body.en': 'Long' }),
        ['de', 'en'],
      ),
    ).toEqual({
      name: 'Lotte',
      sex: 'female',
      birthText: { de: '2021', en: '' },
      sizeCm: 45,
      sizeText: { de: 'mittel', en: '' },
      location: 'germany',
      place: 'Köln',
      isEmergency: true,
      isSponsorable: false,
      traits: { de: ['a', 'b'], en: ['x'] },
      externalProfileUrl: 'https://x.example',
      summary: { de: 'Kurz', en: '' },
      body: { de: 'Lang', en: 'Long' },
    });
  });

  it('takes the languages of the installation for the traits, not a fixed de/en', () => {
    expect(animalFieldsFromForm(form({ 'traits__text.fr': 'calme', 'traits__text.de': 'ruhig' }), ['de', 'fr']).traits).toEqual({ de: ['ruhig'], fr: ['calme'] });
  });

  it('falls back to the defaults of the mask', () => {
    expect(animalFieldsFromForm(form({}), ['de'])).toMatchObject({ name: '', sex: 'female', sizeCm: 0, location: 'shelter', isEmergency: false });
  });
});

describe('changedFields (neuer Hund: nur was sich gegen den Vorschlag geändert hat)', () => {
  it('sends nothing for an untouched form even where the source left fields or languages out', async () => {
    const { changedFields } = await import('@/app/(shell)/animals/form-values');
    const proposal = { name: 'Lotte', sex: 'female', birthText: { de: '2021' }, sizeText: { de: 'mittel' }, summary: { de: 'Fröhlich.' }, body: { de: 'Lang.' } };
    const untouched = animalFieldsFromForm(form({ name: 'Lotte', sex: 'female', 'birthText.de': '2021', 'sizeText.de': 'mittel', 'summary.de': 'Fröhlich.', 'body.de': 'Lang.', location: 'shelter', sizeCm: '0' }), ['de', 'en']);
    expect(changedFields(untouched, proposal, ['de', 'en'])).toEqual({});
    const edited = { ...untouched, name: 'Lotta', summary: { de: 'Fröhlich.', en: 'Happy.' } };
    expect(changedFields(edited, proposal, ['de', 'en'])).toEqual({ name: 'Lotta', summary: { de: 'Fröhlich.', en: 'Happy.' } });
  });
});
