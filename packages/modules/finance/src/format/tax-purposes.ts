/**
 * Die gemeinnützigen Zwecke nach § 52 Abs. 2 S. 1 Nr. 1–27 AO (Fassung des StÄndG 2025; Nr. 27 seit JStG 2024, Nr. 21
 * mit E-Sport seit 01.01.2026; gesetze-im-internet.de, abgerufen 26.10.2026) — Wortlaut des Gesetzes, darum
 * deutsch im Code (Prinzip 7, Ausnahme amtlicher Wortlaut) und ohne Pflege durch den Verein (Designer Runde 7,
 * Abweichung 6). Der begünstigte Zweck einer Körperschaft (Partnerprofil, Anlage Gem Zeilen 65/70) speichert die
 * Nummer; Zeile 4 der Anlage Gem ordnet den Zwecken des Bescheids dieselben Nummern zu.
 */
export const AO52_PURPOSES: readonly { number: number; text: string }[] = [
  { number: 1, text: 'die Förderung von Wissenschaft und Forschung' },
  { number: 2, text: 'die Förderung der Religion' },
  { number: 3, text: 'die Förderung des öffentlichen Gesundheitswesens und der öffentlichen Gesundheitspflege, insbesondere die Verhütung und Bekämpfung von übertragbaren Krankheiten, auch durch Krankenhäuser im Sinne des § 67, und von Tierseuchen' },
  { number: 4, text: 'die Förderung der Jugend- und Altenhilfe' },
  { number: 5, text: 'die Förderung von Kunst und Kultur' },
  { number: 6, text: 'die Förderung des Denkmalschutzes und der Denkmalpflege' },
  { number: 7, text: 'die Förderung der Erziehung, Volks- und Berufsbildung einschließlich der Studentenhilfe' },
  { number: 8, text: 'die Förderung des Naturschutzes und der Landschaftspflege im Sinne des Bundesnaturschutzgesetzes und der Naturschutzgesetze der Länder, des Umweltschutzes, einschließlich des Klimaschutzes, des Küstenschutzes und des Hochwasserschutzes' },
  { number: 9, text: 'die Förderung des Wohlfahrtswesens, insbesondere der Zwecke der amtlich anerkannten Verbände der freien Wohlfahrtspflege (§ 23 der Umsatzsteuer-Durchführungsverordnung), ihrer Unterverbände und ihrer angeschlossenen Einrichtungen und Anstalten' },
  { number: 10, text: 'die Förderung der Hilfe für politisch, rassistisch oder religiös Verfolgte, für Flüchtlinge, Vertriebene, Aussiedler, Spätaussiedler, Kriegsopfer, Kriegshinterbliebene, Kriegsbeschädigte und Kriegsgefangene, Zivilbeschädigte und Behinderte sowie Hilfe für Opfer von Straftaten; Förderung des Andenkens an Verfolgte, Kriegs- und Katastrophenopfer; Förderung des Suchdienstes für Vermisste, Förderung der Hilfe für Menschen, die auf Grund ihrer geschlechtlichen Identität oder ihrer geschlechtlichen Orientierung diskriminiert werden' },
  { number: 11, text: 'die Förderung der Rettung aus Lebensgefahr' },
  { number: 12, text: 'die Förderung des Feuer-, Arbeits-, Katastrophen- und Zivilschutzes sowie der Unfallverhütung' },
  { number: 13, text: 'die Förderung internationaler Gesinnung, der Toleranz auf allen Gebieten der Kultur und des Völkerverständigungsgedankens' },
  { number: 14, text: 'die Förderung des Tierschutzes' },
  { number: 15, text: 'die Förderung der Entwicklungszusammenarbeit' },
  { number: 16, text: 'die Förderung von Verbraucherberatung und Verbraucherschutz' },
  { number: 17, text: 'die Förderung der Fürsorge für Strafgefangene und ehemalige Strafgefangene' },
  { number: 18, text: 'die Förderung der Gleichberechtigung von Frauen und Männern' },
  { number: 19, text: 'die Förderung des Schutzes von Ehe und Familie' },
  { number: 20, text: 'die Förderung der Kriminalprävention' },
  { number: 21, text: 'die Förderung des Sports (Schach und E-Sport gelten als Sport)' },
  { number: 22, text: 'die Förderung der Heimatpflege, Heimatkunde und der Ortsverschönerung' },
  { number: 23, text: 'die Förderung der Tierzucht, der Pflanzenzucht, der Kleingärtnerei, des traditionellen Brauchtums einschließlich des Karnevals, der Fastnacht und des Faschings, der Soldaten- und Reservistenbetreuung, des Amateurfunkens, des Freifunks, des Modellflugs und des Hundesports' },
  { number: 24, text: 'die allgemeine Förderung des demokratischen Staatswesens im Geltungsbereich dieses Gesetzes; hierzu gehören nicht Bestrebungen, die nur bestimmte Einzelinteressen staatsbürgerlicher Art verfolgen oder die auf den kommunalpolitischen Bereich beschränkt sind' },
  { number: 25, text: 'die Förderung des bürgerschaftlichen Engagements zugunsten gemeinnütziger, mildtätiger und kirchlicher Zwecke' },
  { number: 26, text: 'die Förderung der Unterhaltung und Pflege von Friedhöfen und die Förderung der Unterhaltung von Gedenkstätten für nichtbestattungspflichtige Kinder und Föten' },
  // Nur der erste Satz: Die Folgesätze sind Voraussetzungen (§ 53 mit Maßgabe), keine Beschreibung des Zwecks.
  { number: 27, text: 'die Förderung wohngemeinnütziger Zwecke; dies ist die vergünstigte Wohnraumüberlassung an Personen im Sinne des § 53' },
];

/** Die gespeicherten Werte: die Nummern als Text („14“). */
export const AO52_VALUES = AO52_PURPOSES.map((p) => String(p.number)) as readonly string[];

/** Der Zweck zu einem gespeicherten Wert; ein alter Freitext oder nichts → `null` (die Oberfläche zeigt „—“). */
export function ao52PurposeOf(value: string | null | undefined): { number: number; text: string } | null {
  return AO52_PURPOSES.find((p) => String(p.number) === value) ?? null;
}

/** Der Kern eines Zwecks ohne „die (allgemeine) Förderung“: „des Tierschutzes“, „von Kunst und Kultur“. */
const coreOf = (text: string) => text.replace(/^die (allgemeine )?Förderung /, '').split(/[,;(]/)[0]!.trim().toLowerCase();

/**
 * Die Nummern der Zwecke, deren Kern im Text eines Bescheids steht („Förderung des Tierschutzes“ → 14) — für Zeile 4
 * der Anlage Gem. Was nicht passt, bleibt ohne Nummer; der Text des Bescheids steht immer dabei.
 */
export function ao52NumbersIn(text: string | null | undefined): number[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  // Genannte Nummern („§ 52 Abs. 2 Satz 1 Nr. 14 AO“) und Zwecke im Wortlaut, in der Reihenfolge des Gesetzes.
  const named = new Set([...text.matchAll(/Nr\.\s*(\d{1,2})\b/g)].map((m) => Number(m[1])));
  return AO52_PURPOSES.filter((p) => named.has(p.number) || lower.includes(coreOf(p.text))).map((p) => p.number);
}
