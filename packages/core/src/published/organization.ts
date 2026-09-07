import { z } from 'zod';
import type { Deps } from '../deps';
import { readAllSettings } from '../settings/service';
import { definePublishedView } from './view';

/**
 * Die Vereinsstammdaten, die auf eine Webseite gehören: was ein Impressum
 * verlangt, dazu Bankverbindung und Erreichbarkeit. Jedes Template bekommt sie,
 * ohne sie zu deklarieren — sonst pflegte jeder Verein seine Anschrift zweimal,
 * einmal in den Einstellungen und einmal als Template-Variable.
 *
 * Was fehlt, fehlt mit Absicht: Steuernummer, Finanzamt, Freistellungsbescheid
 * und Satzungszweck sind Verwaltungsdaten und nach Prinzip 4 nicht Teil einer
 * veröffentlichten Sicht.
 */
export const publishedOrganization = definePublishedView({
  name: 'organization',
  schema: z.object({
    name: z.string(),
    legalForm: z.string(),
    foundedYear: z.string(),
    street: z.string(),
    postalCode: z.string(),
    city: z.string(),
    country: z.string(),
    email: z.string(),
    phone: z.string(),
    website: z.string(),
    iban: z.string(),
    bic: z.string(),
    bankName: z.string(),
    registerCourt: z.string(),
    registerNumber: z.string(),
  }),
  load: (deps: Deps) => {
    const all = readAllSettings(deps);
    const o = (key: string) => String(all[`organization.${key}`] ?? '');
    return [
      {
        name: o('name'),
        legalForm: o('legalForm'),
        foundedYear: o('foundedYear'),
        street: o('street'),
        postalCode: o('postalCode'),
        city: o('city'),
        country: o('country'),
        email: o('email'),
        phone: o('phone'),
        website: o('website'),
        iban: o('iban'),
        bic: o('bic'),
        bankName: o('bankName'),
        registerCourt: o('registerCourt'),
        registerNumber: o('registerNumber'),
      },
    ];
  },
});
