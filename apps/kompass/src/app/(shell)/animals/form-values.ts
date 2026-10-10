/**
 * Die Felder der Tier-Maske aus einem Formular — dieselbe Lesart für Speichern (`saveAnimalAction`) und die
 * Prüfseite eines neuen Hundes (Annehmen mit den Werten der Maske). Ohne Importe aus `@kompass/*`, weil die
 * Prüfseite sie im Browser ruft.
 */
export interface AnimalFormFields {
  name: string;
  sex: string;
  birthText: Record<string, string>;
  sizeCm: number;
  sizeText: Record<string, string>;
  location: string;
  place: string;
  isEmergency: boolean;
  isSponsorable: boolean;
  traits: Record<string, string[]>;
  externalProfileUrl: string;
  summary: Record<string, string>;
  body: Record<string, string>;
}

const text = (formData: FormData, name: string) => String(formData.get(name) ?? '').trim();
const localized = (formData: FormData, name: string, locales: readonly string[]) => Object.fromEntries(locales.map((l) => [l, text(formData, `${name}.${l}`)]));
const splitList = (value: FormDataEntryValue | null) => String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export function animalFieldsFromForm(formData: FormData, locales: readonly string[]): AnimalFormFields {
  return {
    name: text(formData, 'name'),
    sex: String(formData.get('sex') ?? 'female'),
    birthText: localized(formData, 'birthText', locales),
    sizeCm: Number(formData.get('sizeCm') ?? 0),
    sizeText: localized(formData, 'sizeText', locales),
    location: String(formData.get('location') ?? 'shelter'),
    place: text(formData, 'place'),
    isEmergency: formData.get('isEmergency') === 'on',
    isSponsorable: formData.get('isSponsorable') === 'on',
    traits: Object.fromEntries(locales.map((l) => [l, splitList(formData.get(`traits__text.${l}`))])),
    externalProfileUrl: text(formData, 'externalProfileUrl'),
    summary: localized(formData, 'summary', locales),
    body: localized(formData, 'body', locales),
  };
}

const LOCALIZED_KEYS = ['birthText', 'sizeText', 'summary', 'body'] as const;
const DEFAULTS: Record<string, unknown> = { name: '', sex: 'female', sizeCm: 0, location: 'shelter', place: '', isEmergency: false, isSponsorable: false, externalProfileUrl: '' };

/** Ein Wert des Vorschlags in der Form, die die Maske liefert (alle Sprachen, Vorgaben der Maske). */
function asForm(key: keyof AnimalFormFields, value: unknown, locales: readonly string[]): unknown {
  if ((LOCALIZED_KEYS as readonly string[]).includes(key)) {
    const map = (value ?? {}) as Record<string, unknown>;
    return Object.fromEntries(locales.map((l) => [l, String(map[l] ?? '').trim()]));
  }
  if (key === 'traits') {
    const map = (value ?? {}) as Record<string, unknown>;
    return Object.fromEntries(locales.map((l) => [l, Array.isArray(map[l]) ? (map[l] as unknown[]).map(String) : []]));
  }
  return value ?? DEFAULTS[key];
}

/**
 * Nur was der Prüfer gegen den Vorschlag geändert hat (Prüfseite eines neuen Hundes). Der Dienst nimmt die übrigen
 * Werte aus dem Vorschlag; schickte die Maske alles, käme jeder neue Hund als „angenommen mit Änderungen“ zurück,
 * weil Felder und Sprachen, die die Quelle weglässt, in der Maske leer stehen.
 */
export function changedFields(form: AnimalFormFields, proposal: Record<string, unknown>, locales: readonly string[]): Partial<AnimalFormFields> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(form) as (keyof AnimalFormFields)[]) {
    if (JSON.stringify(form[key]) !== JSON.stringify(asForm(key, proposal[key], locales))) out[key] = form[key];
  }
  return out as Partial<AnimalFormFields>;
}
