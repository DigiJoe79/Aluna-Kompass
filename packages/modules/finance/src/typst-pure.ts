/**
 * Formatierung und Typst-Bausteine der Modul-Vorlagen — rein, ohne Import.
 * Neutraler Boden seit F8a: Die Zuwendungsbestätigungen (`donations/`) und
 * die Verzichtserklärung (`allocation/`) brauchen dieselben, und `allocation/`
 * darf `donations/` nicht kennen (`direction.test.ts`).
 */

/** 123456 → „1.234,56 €“ — ohne Intl, damit das PDF nicht an der ICU-Fassung hängt. */
export function formatCents(value: number): string {
  const euros = String(Math.floor(value / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${euros},${String(value % 100).padStart(2, '0')} €`;
}

/**
 * Freitext als Typst-String-Ausdruck: `#"…";`. Nichts darin wirkt als Markup
 * (kein `#`, `$`, `*`, keine Liste am Zeilenanfang); das Semikolon beendet den
 * Ausdruck, damit ein folgender Punkt kein Feldzugriff wird.
 */
export function typstText(value: string): string {
  return `#"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}";`;
}

// ── Anschriftzone der Formular-Basis (Fensterumschlag, Plan 2026-09-27) ─────

/**
 * Typst-Ausdruck, beim Rendern ausgewertet: Zeichnet die Basis die
 * Anschriftzone? Die Engine legt das Manifest-Kennzeichen der Basis
 * (`bases.json`, `"slots": ["recipient", "recipientLabel", "infoBlock"]`) als
 * `baseSlots` in `data.json`. Eine eigene Formular-Basis ohne Kennzeichen
 * (alter Vertrag) zeichnet keine Anschrift — dann setzt der Körper sie selbst.
 */
export const BASE_DRAWS_ADDRESS_ZONE = '("recipient", "recipientLabel", "infoBlock").all(s => json("/data.json").at("baseSlots", default: ()).contains(s))';

/** Markup nur für eine Basis ohne Anschriftzone: der Rückfall auf den Kopf im Körper. */
export function withoutAddressZone(markup: string): string {
  return `#if not ${BASE_DRAWS_ADDRESS_ZONE} [${markup}]`;
}

type AddressParty = { name: string; addressLines: string[] };

/**
 * Die Slots der Anschriftzone: `recipient` als Klartext (Zeilen mit `\n`),
 * `recipientLabel` klein darüber, `infoBlock` als Typst-Markup rechts daneben
 * — Beschriftung klein, dann Name und Anschrift; leere Zeilen entfallen.
 */
export function addressZoneSlots(input: { recipientLabel: string; recipient: AddressParty; infoLabel: string; info: AddressParty }): { recipient: string; recipientLabel: string; infoBlock: string } {
  const info = [input.info.name, ...input.info.addressLines].filter((line) => line !== '').map(typstText);
  return {
    recipient: [input.recipient.name, ...input.recipient.addressLines].join('\n'),
    recipientLabel: input.recipientLabel,
    infoBlock: [`#text(size: 8pt)[${typstText(input.infoLabel)}]`, ...info].join(' #linebreak() '),
  };
}

/**
 * Die Anschriftzeilen einer Person für ein Schreiben — Zusatz, Straße, PLZ und
 * Ort, das Land nur bei Ausland (leer oder „DE“ gilt als Inland). Dieselbe Form
 * für die Bestätigungen und die Verzichtserklärung (Befund G).
 */
export function postalAddressLines(address: { addressExtra?: string | null; street: string | null; postalCode: string | null; city: string | null; country: string | null }): string[] {
  const clean = (v: string | null | undefined) => (v ?? '').trim();
  const country = clean(address.country).toUpperCase();
  const cityLine = [clean(address.postalCode), clean(address.city)].filter(Boolean).join(' ');
  return [clean(address.addressExtra), clean(address.street), cityLine, country !== '' && country !== 'DE' ? country : ''].filter(Boolean);
}
